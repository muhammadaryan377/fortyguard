"""Fast, provider-backed multi-worker forecast extraction from shared site heatmaps."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.models.fortyguard import HeatmapRequest
from app.models.prediction import ForecastTemperaturePoint, PredictHeatOutlookResponse
from app.models.risk import LiveDateTimeFilter, USSiteLocation
from app.models.site import SiteOperationsRequest, SiteWorkerAssignment
from app.services.fortyguard import FortyGuardClient, normalize_heatmap_result
from app.services.live_environment import build_site_polygon, extract_verified_temperature
from app.services.predictive_heat import OUTLOOK_LIMITATIONS, summarize_points


@dataclass
class _SiteForecastMap:
    offset_hours: int
    local_timestamp: datetime
    utc_timestamp: datetime
    activity_id: str | None
    granularity: int | None
    map_data: dict | None
    attempts: int


def _worker_location(site: USSiteLocation, assignment: SiteWorkerAssignment) -> USSiteLocation:
    if assignment.position is None:
        return site
    return USSiteLocation(
        site_id=site.site_id,
        name=f"{site.name} · {assignment.display_label or assignment.worker.worker_id}",
        city=site.city,
        state=site.state,
        country="United States",
        latitude=assignment.position.latitude,
        longitude=assignment.position.longitude,
    )


async def _fetch_sample(
    request: SiteOperationsRequest,
    *,
    offset_hours: int,
    generated_at: datetime,
    client: FortyGuardClient,
) -> _SiteForecastMap:
    utc_timestamp = generated_at + timedelta(hours=offset_hours)
    local_timestamp = utc_timestamp.astimezone(ZoneInfo(request.timezone_name))
    date_time = LiveDateTimeFilter(
        start_date=local_timestamp.date(),
        start_time=local_timestamp.timetz().replace(tzinfo=None),
        filter_type=1,
    )
    polygon = request.site_polygon or build_site_polygon(
        request.location.latitude,
        request.location.longitude,
    )
    requested = int(request.heatmap_granularity)
    granularities = [requested] if requested == 100 else [requested, 100]
    attempts = 0
    for granularity in granularities:
        attempts += 1
        try:
            activity_id = await client.create_heatmap(
                HeatmapRequest(
                    polygon_aoi=polygon,
                    date_time=date_time,
                    granularity=granularity,
                    analytic_type="tcm",
                )
            )
            job = await client.wait_for_result(activity_id)
            normalized = normalize_heatmap_result(job.result or {})
            features = normalized.map_data.get("features") if isinstance(normalized.map_data, dict) else None
            if not isinstance(features, list) or not features:
                continue
            return _SiteForecastMap(
                offset_hours=offset_hours,
                local_timestamp=local_timestamp,
                utc_timestamp=utc_timestamp,
                activity_id=activity_id,
                granularity=granularity,
                map_data=normalized.map_data,
                attempts=attempts,
            )
        except Exception:
            continue
    return _SiteForecastMap(
        offset_hours=offset_hours,
        local_timestamp=local_timestamp,
        utc_timestamp=utc_timestamp,
        activity_id=None,
        granularity=None,
        map_data=None,
        attempts=attempts,
    )


def _outlook_for_worker(
    request: SiteOperationsRequest,
    assignment: SiteWorkerAssignment,
    samples: list[_SiteForecastMap],
    *,
    generated_at: datetime,
) -> PredictHeatOutlookResponse:
    location = _worker_location(request.location, assignment)
    points: list[ForecastTemperaturePoint] = []
    for sample in samples:
        if sample.map_data is None or sample.activity_id is None:
            points.append(
                ForecastTemperaturePoint(
                    status="unavailable",
                    offset_hours=sample.offset_hours,
                    requested_local_timestamp=sample.local_timestamp,
                    requested_utc_timestamp=sample.utc_timestamp,
                    error_reason="site_forecast_sample_unavailable",
                )
            )
            continue
        try:
            verified = extract_verified_temperature(
                sample.map_data,
                latitude=location.latitude,
                longitude=location.longitude,
                timestamp=sample.local_timestamp.isoformat(),
                activity_id=sample.activity_id,
            )
            points.append(
                ForecastTemperaturePoint(
                    status="available",
                    offset_hours=sample.offset_hours,
                    requested_local_timestamp=sample.local_timestamp,
                    requested_utc_timestamp=sample.utc_timestamp,
                    temperature_c=verified.temperature_c,
                    heatmap_activity_id=sample.activity_id,
                    extraction_method=verified.extraction_method,
                    selected_feature=verified.raw.get("selected_feature"),
                )
            )
        except Exception:
            points.append(
                ForecastTemperaturePoint(
                    status="unavailable",
                    offset_hours=sample.offset_hours,
                    requested_local_timestamp=sample.local_timestamp,
                    requested_utc_timestamp=sample.utc_timestamp,
                    error_reason="worker_containing_tile_unavailable",
                )
            )

    summary = summarize_points(points)
    status = (
        "insufficient_data"
        if summary.available_points == 0
        else "available"
        if summary.available_points == summary.total_points
        else "partial"
    )
    return PredictHeatOutlookResponse(
        status=status,
        location=location,
        timezone_name=request.timezone_name,
        generated_at=generated_at,
        forecast_horizon_hours=max(request.forecast_offset_hours),
        sample_offsets_hours=request.forecast_offset_hours,
        points=points,
        summary=summary,
        limitations=[
            *OUTLOOK_LIMITATIONS,
            "All workers share one full-site FortyGuard heatmap job per forecast sample; each worker temperature is extracted only from the tile containing that worker coordinate.",
        ],
    )


async def create_worker_outlooks_from_site_maps(
    request: SiteOperationsRequest,
    *,
    client: FortyGuardClient,
    now: datetime,
) -> tuple[dict[str, PredictHeatOutlookResponse], int]:
    """Use O(sample-count) provider jobs instead of O(worker-count × sample-count)."""
    generated_at = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    samples = list(
        await asyncio.gather(
            *[
                _fetch_sample(
                    request,
                    offset_hours=offset,
                    generated_at=generated_at,
                    client=client,
                )
                for offset in request.forecast_offset_hours
            ]
        )
    )
    outlooks = {
        assignment.worker.worker_id: _outlook_for_worker(
            request,
            assignment,
            samples,
            generated_at=generated_at,
        )
        for assignment in request.assignments
    }
    return outlooks, sum(sample.attempts for sample in samples)
