"""Deterministic historical heat-resilience analytics backed by FortyGuard heatmaps."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from statistics import fmean
from typing import Any

from app.models.fortyguard import DateTimeFilter, HeatmapRequest
from app.models.resilience import (
    ResilienceLayer,
    ResilienceTile,
    SiteResilienceRequest,
    SiteResilienceResponse,
)
from app.services.fortyguard import FortyGuardClient, fortyguard_client, normalize_heatmap_result
from app.services.spatial_heat import polygon_centroid


ANALYTIC_TYPES = ("exceedance", "persistence", "time_of_measure")


def _tile(feature: Any, index: int) -> ResilienceTile | None:
    if not isinstance(feature, dict):
        return None
    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        return None
    value = properties.get("value")
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if geometry.get("type") != "Polygon":
        return None
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates or not isinstance(coordinates[0], list):
        return None
    ring = coordinates[0]
    if len(ring) < 4 or ring[0][:2] != ring[-1][:2]:
        return None
    if any(
        not isinstance(point, list)
        or len(point) < 2
        or not all(isinstance(number, (int, float)) and not isinstance(number, bool) for number in point[:2])
        for point in ring
    ):
        return None
    centroid_lon, centroid_lat = polygon_centroid(ring)
    return ResilienceTile(
        tile_id=f"tile-{index:04d}",
        value=float(value),
        centroid_latitude=centroid_lat,
        centroid_longitude=centroid_lon,
        polygon_coordinates=coordinates,
    )


def _normalize_layer(
    analytic_type: str,
    activity_id: str,
    map_data: dict[str, Any] | None,
    request: SiteResilienceRequest,
) -> ResilienceLayer:
    features = (
        map_data.get("features", [])
        if isinstance(map_data, dict) and map_data.get("type") == "FeatureCollection"
        else []
    )
    tiles = [tile for index, feature in enumerate(features) if (tile := _tile(feature, index)) is not None]
    values = [tile.value for tile in tiles]
    threshold = request.threshold_c if analytic_type in {"exceedance", "persistence"} else None
    direction = "above" if analytic_type in {"exceedance", "persistence"} else None
    return ResilienceLayer(
        analytic_type=analytic_type,
        activity_id=activity_id,
        threshold_c=threshold,
        direction=direction,
        valid_tile_count=len(tiles),
        minimum_value=min(values) if values else None,
        maximum_value=max(values) if values else None,
        mean_value=fmean(values) if values else None,
        tiles=tiles,
    )


async def _run_layer(
    analytic_type: str,
    request: SiteResilienceRequest,
    *,
    client: FortyGuardClient,
) -> ResilienceLayer:
    date_time = DateTimeFilter(
        start_date=request.start_date,
        end_date=request.end_date,
        filter_type=4,
    )
    heatmap = HeatmapRequest(
        polygon_aoi=request.site_polygon,
        date_time=date_time,
        granularity=request.granularity,
        analytic_type=analytic_type,
        threshold=request.threshold_c if analytic_type in {"exceedance", "persistence"} else None,
        direction="above" if analytic_type in {"exceedance", "persistence"} else None,
    )
    activity_id = await client.create_heatmap(heatmap)
    job = await client.wait_for_result(activity_id)
    normalized = normalize_heatmap_result(job.result or {})
    return _normalize_layer(analytic_type, activity_id, normalized.map_data, request)


async def create_site_resilience(
    request: SiteResilienceRequest,
    *,
    client: FortyGuardClient = fortyguard_client,
    clock=None,
) -> SiteResilienceResponse:
    """Compare three provider analytics without inventing a composite risk score."""

    generated_at = (clock or (lambda: datetime.now(UTC)))()
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=UTC)
    else:
        generated_at = generated_at.astimezone(UTC)

    results = await asyncio.gather(
        *(_run_layer(kind, request, client=client) for kind in ANALYTIC_TYPES),
        return_exceptions=True,
    )
    layers: dict[str, ResilienceLayer | None] = {kind: None for kind in ANALYTIC_TYPES}
    limitations = [
        "Historical analytics are provider heatmap measurements for the submitted date window and threshold, not a worker-level exposure or medical-risk score.",
        "Exceedance counts hours above the selected threshold; persistence is the longest continuous run above it; time-of-measure reports the peak-temperature hour in UTC.",
        "HeatShield does not combine these layers into an invented resilience score; supervisors should inspect the underlying provider values and site context.",
    ]

    available = 0
    for kind, result in zip(ANALYTIC_TYPES, results):
        if isinstance(result, Exception):
            limitations.append(f"{kind.replace('_', ' ').title()} provider analysis was unavailable for this request.")
            continue
        if not result.tiles:
            limitations.append(f"{kind.replace('_', ' ').title()} returned no numeric heatmap tiles; no value was fabricated.")
        layers[kind] = result
        available += 1

    status = "available" if available == len(ANALYTIC_TYPES) else "partial" if available else "unavailable"
    return SiteResilienceResponse(
        status=status,
        generated_at=generated_at,
        location=request.location,
        timezone_name=request.timezone_name,
        start_date=request.start_date,
        end_date=request.end_date,
        threshold_c=request.threshold_c,
        granularity=request.granularity,
        exceedance=layers["exceedance"],
        persistence=layers["persistence"],
        time_of_measure=layers["time_of_measure"],
        limitations=limitations,
    )
