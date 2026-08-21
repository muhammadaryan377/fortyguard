"""Deterministic spatial TCM tile extraction and cooler-candidate ranking."""

from __future__ import annotations

from datetime import UTC, datetime
from math import asin, cos, radians, sin, sqrt
from typing import Any, Callable
from zoneinfo import ZoneInfo

from app.models.fortyguard import HeatmapRequest
from app.models.risk import LiveDateTimeFilter
from app.models.spatial import (
    CoolerZoneCandidate,
    SpatialHeatRequest,
    SpatialHeatResponse,
    SpatialHeatSummary,
    SpatialHeatTile,
    SpatialSiteReference,
)
from app.services.fortyguard import FortyGuardClient, fortyguard_client, normalize_heatmap_result
from app.services.live_environment import _point_in_ring, build_site_polygon

SPATIAL_LIMITATIONS = [
    "Cooler means lower temperature in the returned sampled spatial tiles; it does not mean safe.",
    "Temperature alone does not capture Heat Index, WBGT, radiant heat, wind, accessibility, physical hazards, restricted areas, or task feasibility.",
    "Straight-line distance is not walking, travel, or route distance.",
    "Coolest mapped temperature means coolest among valid returned tiles, not a city minimum.",
    "No missing tiles or temperatures are interpolated and heatmap statistics are not used as tile temperatures.",
]
CANDIDATE_LIMITATIONS = [
    "This is a comparatively cooler sampled spatial tile, not a safe zone.",
    "Accessibility, hazards, permissions, and task feasibility have not been verified.",
]


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth = 6_371_000.0
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return earth * 2 * asin(sqrt(a))


def polygon_centroid(ring: list[list[float]]) -> tuple[float, float]:
    """Return longitude/latitude centroid using the planar shoelace formula."""
    area_twice = cx = cy = 0.0
    for first, second in zip(ring, ring[1:]):
        cross = float(first[0]) * float(second[1]) - float(second[0]) * float(first[1])
        area_twice += cross
        cx += (float(first[0]) + float(second[0])) * cross
        cy += (float(first[1]) + float(second[1])) * cross
    if abs(area_twice) < 1e-15:
        points = ring[:-1]
        return (
            sum(float(p[0]) for p in points) / len(points),
            sum(float(p[1]) for p in points) / len(points),
        )
    return cx / (3 * area_twice), cy / (3 * area_twice)


def _inside_operational_boundary(request: SpatialHeatRequest, lon: float, lat: float) -> bool | None:
    if request.operational_polygon is None:
        return None
    for feature in request.operational_polygon.features:
        if feature.geometry.coordinates and _point_in_ring(lon, lat, feature.geometry.coordinates[0]):
            return True
    return False


def _valid_tile(
    feature: Any,
    index: int,
    request: SpatialHeatRequest,
) -> tuple[int, SpatialHeatTile] | None:
    if (
        not isinstance(feature, dict)
        or not isinstance(feature.get("properties"), dict)
        or not isinstance(feature.get("geometry"), dict)
    ):
        return None
    properties, geometry = feature["properties"], feature["geometry"]
    # TCM tiles use an explicit Celsius temperature field. Generic `value` is
    # reserved for analysis heatmaps and min/max are not representative values.
    field_name = "average_temperature" if "average_temperature" in properties else "temperature"
    value = properties.get(field_name)
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or geometry.get("type") != "Polygon"
    ):
        return None
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates or not isinstance(coordinates[0], list):
        return None
    ring = coordinates[0]
    if (
        len(ring) < 4
        or any(
            not isinstance(p, list)
            or len(p) < 2
            or not all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in p[:2])
            for p in ring
        )
    ):
        return None
    if ring[0][:2] != ring[-1][:2]:
        return None

    centroid_lon, centroid_lat = polygon_centroid(ring)
    tile = SpatialHeatTile(
        tile_id=f"tile-{index:04d}",
        temperature_c=float(value),
        polygon_coordinates=coordinates,
        centroid_latitude=centroid_lat,
        centroid_longitude=centroid_lon,
        contains_site=_point_in_ring(request.location.longitude, request.location.latitude, ring),
        straight_line_distance_m=haversine_distance_m(
            request.location.latitude,
            request.location.longitude,
            centroid_lat,
            centroid_lon,
        ),
        inside_operational_boundary=_inside_operational_boundary(
            request,
            centroid_lon,
            centroid_lat,
        ),
    )
    return index, tile


def analyze_spatial_features(
    map_data: dict[str, Any] | None,
    request: SpatialHeatRequest,
    *,
    generated_at: datetime,
    activity_id: str | None,
) -> SpatialHeatResponse:
    features = (
        map_data.get("features", [])
        if isinstance(map_data, dict) and map_data.get("type") == "FeatureCollection"
        else []
    )
    indexed = [
        item
        for i, feature in enumerate(features)
        if (item := _valid_tile(feature, i, request)) is not None
    ]
    tiles = [item[1] for item in indexed]
    containing = [item for item in indexed if item[1].contains_site]
    limitations = list(SPATIAL_LIMITATIONS)
    if request.operational_polygon is not None:
        limitations.append(
            "Cooler candidates are limited to tile centroids inside the submitted operational site boundary; a tile can still straddle that boundary."
        )

    base = dict(
        generated_at=generated_at,
        location=request.location,
        timezone_name=request.timezone_name,
        search_radius_meters=request.search_radius_meters,
        granularity=request.granularity,
        heatmap_activity_id=activity_id,
        tiles=tiles,
        limitations=limitations,
    )
    if not containing:
        return SpatialHeatResponse(
            status="insufficient_data",
            site_reference=SpatialSiteReference(),
            candidates=[],
            summary=SpatialHeatSummary(
                valid_tile_count=len(tiles),
                cooler_candidate_count=0,
                coolest_mapped_temperature_c=min((t.temperature_c for t in tiles), default=None),
            ),
            **base,
        )

    site_index, site_tile = containing[0]
    eligible = [
        (i, t)
        for i, t in indexed
        if i != site_index
        and not t.contains_site
        and t.temperature_c < site_tile.temperature_c
        and t.straight_line_distance_m <= request.search_radius_meters
        and t.inside_operational_boundary is not False
    ]
    eligible.sort(key=lambda item: (item[1].temperature_c, item[1].straight_line_distance_m, item[0]))

    candidates = [
        CoolerZoneCandidate(
            candidate_id=f"candidate-{rank:02d}",
            tile_id=t.tile_id,
            temperature_c=t.temperature_c,
            site_temperature_c=site_tile.temperature_c,
            cooler_by_c=site_tile.temperature_c - t.temperature_c,
            centroid_latitude=t.centroid_latitude,
            centroid_longitude=t.centroid_longitude,
            straight_line_distance_m=t.straight_line_distance_m,
            polygon_coordinates=t.polygon_coordinates,
            rank=rank,
            inside_operational_boundary=t.inside_operational_boundary,
            limitations=CANDIDATE_LIMITATIONS,
        )
        for rank, (_, t) in enumerate(eligible[: request.max_candidates], 1)
    ]
    summary = SpatialHeatSummary(
        valid_tile_count=len(tiles),
        cooler_candidate_count=len(candidates),
        coolest_mapped_temperature_c=min((t.temperature_c for t in tiles), default=None),
        coolest_candidate_cooler_by_c=max((c.cooler_by_c for c in candidates), default=None),
        nearest_cooler_candidate_distance_m=min(
            (c.straight_line_distance_m for c in candidates),
            default=None,
        ),
    )
    return SpatialHeatResponse(
        status="available" if candidates else "no_cooler_candidate",
        site_reference=SpatialSiteReference(
            site_temperature_c=site_tile.temperature_c,
            containing_tile_id=site_tile.tile_id,
        ),
        candidates=candidates,
        summary=summary,
        **base,
    )


def _granularity_candidates(configured: int) -> list[int]:
    return [configured] if configured == 100 else [configured, 100]


async def create_spatial_heat(
    request: SpatialHeatRequest,
    *,
    client: FortyGuardClient = fortyguard_client,
    clock: Callable[[], datetime] | None = None,
) -> SpatialHeatResponse:
    now = (clock or (lambda: datetime.now(UTC)))()
    generated = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    local = generated.astimezone(ZoneInfo(request.timezone_name))
    date_time = LiveDateTimeFilter(
        start_date=local.date(),
        start_time=local.timetz().replace(tzinfo=None),
        filter_type=1,
    )
    last_response: SpatialHeatResponse | None = None

    for granularity in _granularity_candidates(int(request.granularity)):
        candidate_request = (
            request
            if granularity == request.granularity
            else request.model_copy(update={"granularity": granularity})
        )
        polygon_aoi = request.operational_polygon or build_site_polygon(
            request.location.latitude,
            request.location.longitude,
            radius_meters=request.search_radius_meters,
        )
        heatmap_request = HeatmapRequest(
            polygon_aoi=polygon_aoi,
            date_time=date_time,
            granularity=granularity,
            analytic_type="tcm",
        )
        activity_id = await client.create_heatmap(heatmap_request)
        job = await client.wait_for_result(activity_id)
        result = normalize_heatmap_result(job.result or {})
        response = analyze_spatial_features(
            result.map_data,
            candidate_request,
            generated_at=generated,
            activity_id=activity_id,
        )
        last_response = response
        if response.status in {"available", "no_cooler_candidate"}:
            return response

    if last_response is not None:
        return last_response
    return analyze_spatial_features(None, request, generated_at=generated, activity_id=None)
