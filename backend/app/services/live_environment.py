"""Provider-driven live environmental evidence orchestration."""

from __future__ import annotations

from datetime import datetime, timedelta
from math import cos, radians
from typing import Any

from app.core.config import settings
from app.models.fortyguard import (
    EnvironmentalConditions,
    EnvironmentalParametersRequest,
    EnvironmentalProvenance,
    GeoJSONFeature,
    HeatmapRequest,
    PolygonFeatureCollection,
    PolygonGeometry,
    VerifiedTemperature,
)
from app.models.risk import LiveDateTimeFilter, USSiteLocation
from app.services.fortyguard import (
    FortyGuardAPIError,
    FortyGuardClient,
    fortyguard_client,
    normalize_environmental_result,
    normalize_heatmap_result,
)


class LiveEnvironmentDataError(FortyGuardAPIError):
    """Raised when provider data cannot safely support a live observation."""


class TemperatureUnavailableError(LiveEnvironmentDataError):
    """Raised when a site temperature cannot be extracted from heatmap tiles."""


class ObservationUnavailableError(LiveEnvironmentDataError):
    """Raised when environmental observations are missing or ambiguous."""


class TimestampMismatchError(LiveEnvironmentDataError):
    """Raised when no deterministic provider timestamp matches the request."""


def requested_timestamp(date_time: LiveDateTimeFilter) -> datetime:
    return datetime.combine(date_time.start_date, date_time.start_time)


def build_site_polygon(
    latitude: float,
    longitude: float,
    *,
    radius_meters: float | None = None,
) -> PolygonFeatureCollection:
    """Build a deterministic square GeoJSON AOI around a site point."""

    radius = settings.heatshield_site_polygon_radius_meters if radius_meters is None else radius_meters
    if radius <= 0:
        raise ValueError("Site polygon radius must be greater than zero")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("Site coordinates are out of range")
    latitude_delta = radius / 111_320.0
    longitude_scale = cos(radians(latitude))
    if abs(longitude_scale) < 1e-9:
        raise ValueError("A site polygon cannot be generated at the geographic poles")
    longitude_delta = radius / (111_320.0 * longitude_scale)
    west, east = longitude - longitude_delta, longitude + longitude_delta
    south, north = latitude - latitude_delta, latitude + latitude_delta
    if west < -180 or east > 180 or south < -90 or north > 90:
        raise ValueError("Site polygon crosses an unsupported coordinate boundary")
    ring = [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
    ]
    return PolygonFeatureCollection(
        type="FeatureCollection",
        features=[
            GeoJSONFeature(
                type="Feature",
                properties={},
                geometry=PolygonGeometry(type="Polygon", coordinates=[ring]),
            )
        ],
    )


def _point_in_ring(longitude: float, latitude: float, ring: list[list[Any]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, position in enumerate(ring):
        previous = ring[j]
        
        if len(position) < 2 or len(previous) < 2:
            return False
        xi, yi = position[0], position[1]
        xj, yj = previous[0], previous[1]
        if not all(isinstance(value, (int, float)) for value in (xi, yi, xj, yj)):
            return False
        intersects = (yi > latitude) != (yj > latitude) and longitude < (
            (xj - xi) * (latitude - yi) / (yj - yi) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _feature_candidate(
    feature: Any, latitude: float, longitude: float
) -> tuple[float, dict[str, Any], str] | None:
    if not isinstance(feature, dict):
        return None
    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        return None
    # TCM uses an explicit temperature field. Generic `value` belongs to
    # analysis heatmaps (for example exceedance/persistence hours) and must not
    # be interpreted as degrees Celsius here.
    field_name = "average_temperature" if "average_temperature" in properties else "temperature"
    value = properties.get(field_name)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if geometry.get("type") != "Polygon":
        return None
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates or not isinstance(coordinates[0], list):
        return None
    ring = coordinates[0]
    valid_positions = [
        position
        for position in ring
        if isinstance(position, list)
        and len(position) >= 2
        and all(isinstance(item, (int, float)) for item in position[:2])
    ]
    if len(valid_positions) < 4:
        return None
    if not _point_in_ring(longitude, latitude, ring):
        return None
    return float(value), feature, field_name


def extract_verified_temperature(
    map_data: dict[str, Any] | None,
    *,
    latitude: float,
    longitude: float,
    timestamp: str,
    activity_id: str,
) -> VerifiedTemperature:
    if not isinstance(map_data, dict) or map_data.get("type") != "FeatureCollection":
        raise TemperatureUnavailableError("Unsupported FortyGuard heatmap map_data shape")
    features = map_data.get("features")
    if not isinstance(features, list) or not features:
        raise TemperatureUnavailableError("FortyGuard heatmap contains no spatial features")
    containing = [
        candidate
        for feature in features
        if (candidate := _feature_candidate(feature, latitude, longitude)) is not None
    ]
    if not containing:
        raise TemperatureUnavailableError(
            "No containing FortyGuard TCM tile supplied average_temperature or temperature"
        )
    # Overlapping containing tiles are resolved deterministically in provider order;
    # unlike a nearest-tile fallback, every candidate spatially contains the site.
    chosen = containing[0]
    return VerifiedTemperature(
        latitude=latitude,
        longitude=longitude,
        timestamp=timestamp,
        temperature_c=chosen[0],
        extraction_method=f"containing_heatmap_feature_{chosen[2]}",
        activity_id=activity_id,
        raw={"selected_feature": chosen[1]},
    )


async def get_verified_temperature(
    location: USSiteLocation,
    date_time: LiveDateTimeFilter,
    *,
    client: FortyGuardClient = fortyguard_client,
) -> VerifiedTemperature:
    heatmap_request = HeatmapRequest(
        polygon_aoi=build_site_polygon(location.latitude, location.longitude),
        date_time=date_time,
        granularity=settings.heatshield_live_granularity_meters,
        analytic_type="tcm",
    )
    activity_id = await client.create_heatmap(heatmap_request)
    job = await client.wait_for_result(activity_id)
    heatmap = normalize_heatmap_result(job.result or {})
    requested = requested_timestamp(date_time).isoformat(timespec="minutes")
    verified = extract_verified_temperature(
        heatmap.map_data,
        latitude=location.latitude,
        longitude=location.longitude,
        timestamp=requested,
        activity_id=activity_id,
    )
    return verified


def _parse_provider_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    # FortyGuard request times have no timezone field. Compare provider-local wall
    # time so an explicit offset does not shift the requested local hour.
    return parsed.replace(tzinfo=None)


def match_single_observation(
    observations: list[EnvironmentalConditions],
    *,
    location: USSiteLocation,
    date_time: LiveDateTimeFilter,
    tolerance_minutes: int | None = None,
) -> EnvironmentalConditions:
    if not observations:
        raise ObservationUnavailableError("FortyGuard returned no environmental observations")
    tolerance = settings.heatshield_timestamp_tolerance_minutes if tolerance_minutes is None else tolerance_minutes
    requested = requested_timestamp(date_time)
    matches: list[tuple[float, EnvironmentalConditions]] = []
    for observation in observations:
        observed = _parse_provider_timestamp(observation.timestamp)
        lat, lon = observation.location.get("lat"), observation.location.get("lon")
        if observed is None or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        if abs(float(lat) - location.latitude) > 0.001 or abs(float(lon) - location.longitude) > 0.001:
            continue
        difference = abs((observed - requested).total_seconds())
        if difference <= timedelta(minutes=tolerance).total_seconds():
            matches.append((difference, observation))
    if not matches:
        raise TimestampMismatchError("No environmental observation matched the requested site and timestamp")
    matches.sort(key=lambda item: item[0])
    if len(matches) > 1 and matches[0][0] == matches[1][0]:
        raise TimestampMismatchError("Environmental observation match is ambiguous")
    return matches[0][1]


async def get_live_environment(
    location: USSiteLocation,
    date_time: LiveDateTimeFilter,
    *,
    client: FortyGuardClient = fortyguard_client,
) -> EnvironmentalConditions:
    verified = await get_verified_temperature(location, date_time, client=client)
    environment_request = EnvironmentalParametersRequest(
        latitude=location.latitude,
        longitude=location.longitude,
        temperature=verified.temperature_c,
        date_time=date_time,
    )
    environment_activity_id = await client.get_environmental_parameters(environment_request)
    job = await client.wait_for_result(environment_activity_id)
    observations = normalize_environmental_result(job.result or {})
    selected = match_single_observation(
        observations, location=location, date_time=date_time
    )
    selected.temperature_c = verified.temperature_c
    selected.provenance = EnvironmentalProvenance(
        temperature_source="fortyguard_heatmap",
        environmental_parameters_source="fortyguard_env_params",
        heatmap_activity_id=verified.activity_id,
        environment_activity_id=environment_activity_id,
        requested_timestamp=verified.timestamp,
        matched_provider_timestamp=selected.timestamp or "",
        temperature_extraction_method=verified.extraction_method,
    )
    provider_metadata = selected.raw.get("metadata", {})
    compact_metadata = {
        key: provider_metadata[key]
        for key in ("timezone", "timezone_offset_hours", "time_range")
        if key in provider_metadata
    }
    selected.raw = {
        "selected_heatmap_feature": verified.raw.get("selected_feature"),
        "selected_heatmap_temperature_c": verified.temperature_c,
        "environmental_metadata": compact_metadata,
    }
    return selected
