"""Parallel, provider-backed short-term TCM temperature sampling."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.models.fortyguard import VerifiedTemperature
from app.models.prediction import (
    ForecastTemperaturePoint,
    HeatOutlookSummary,
    PredictHeatOutlookRequest,
    PredictHeatOutlookResponse,
)
from app.models.risk import LiveDateTimeFilter
from app.services.fortyguard import FortyGuardClient, FortyGuardError, fortyguard_client
from app.services.live_environment import get_verified_temperature


OUTLOOK_LIMITATIONS = [
    "Forecast values are sampled FortyGuard TCM heatmap temperatures.",
    "This is not a continuous hourly temperature series.",
    "Highest sampled temperature means highest among requested sample times only, not a continuous-period maximum.",
    "Missing forecast temperatures are not interpolated or replaced.",
    "PREDICT Phase 1 does not forecast Heat Index or humidity.",
    "PREDICT Phase 1 does not provide WBGT or occupational risk scores.",
    "This outlook is not a medical diagnosis or legal compliance determination.",
    "This outlook is not an AI-agent decision.",
]


def build_forecast_times(
    request: PredictHeatOutlookRequest,
    *,
    now: datetime,
) -> list[tuple[int, datetime, datetime]]:
    """Return offset, local time, and UTC time using absolute elapsed hours."""

    generated_utc = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    timezone = ZoneInfo(request.timezone_name)
    return [
        (
            offset,
            (generated_utc + timedelta(hours=offset)).astimezone(timezone),
            generated_utc + timedelta(hours=offset),
        )
        for offset in request.offset_hours
    ]


def summarize_points(points: list[ForecastTemperaturePoint]) -> HeatOutlookSummary:
    available = [
        point
        for point in points
        if point.status == "available" and point.temperature_c is not None
    ]
    if not available:
        return HeatOutlookSummary(
            available_points=0,
            total_points=len(points),
            trend="insufficient_data",
        )

    highest = max(available, key=lambda point: point.temperature_c)
    lowest = min(available, key=lambda point: point.temperature_c)
    if len(available) < 2:
        trend = "insufficient_data"
        change = None
    else:
        temperatures = [point.temperature_c for point in available]
        if all(current > previous for previous, current in zip(temperatures, temperatures[1:])):
            trend = "rising"
        elif all(current < previous for previous, current in zip(temperatures, temperatures[1:])):
            trend = "falling"
        elif all(current == temperatures[0] for current in temperatures):
            trend = "flat"
        else:
            trend = "mixed"
        change = temperatures[-1] - temperatures[0]

    return HeatOutlookSummary(
        available_points=len(available),
        total_points=len(points),
        highest_sampled_temperature_c=highest.temperature_c,
        highest_sampled_offset_hours=highest.offset_hours,
        highest_sampled_local_timestamp=highest.requested_local_timestamp,
        lowest_sampled_temperature_c=lowest.temperature_c,
        lowest_sampled_offset_hours=lowest.offset_hours,
        first_to_last_temperature_change_c=change,
        trend=trend,
    )


def _available_point(
    offset: int,
    local_timestamp: datetime,
    utc_timestamp: datetime,
    verified: VerifiedTemperature,
) -> ForecastTemperaturePoint:
    return ForecastTemperaturePoint(
        status="available",
        offset_hours=offset,
        requested_local_timestamp=local_timestamp,
        requested_utc_timestamp=utc_timestamp,
        temperature_c=verified.temperature_c,
        heatmap_activity_id=verified.activity_id,
        extraction_method=verified.extraction_method,
        selected_feature=verified.raw.get("selected_feature"),
    )


async def _sample_one(
    request: PredictHeatOutlookRequest,
    offset: int,
    local_timestamp: datetime,
    utc_timestamp: datetime,
    client: FortyGuardClient,
) -> ForecastTemperaturePoint:
    date_time = LiveDateTimeFilter(
        start_date=local_timestamp.date(),
        start_time=local_timestamp.timetz().replace(tzinfo=None),
        filter_type=1,
    )
    try:
        verified = await get_verified_temperature(
            request.location,
            date_time,
            client=client,
        )
        return _available_point(offset, local_timestamp, utc_timestamp, verified)
    except FortyGuardError as exc:
        return ForecastTemperaturePoint(
            status="unavailable",
            offset_hours=offset,
            requested_local_timestamp=local_timestamp,
            requested_utc_timestamp=utc_timestamp,
            error_reason=str(exc),
        )


async def create_heat_outlook(
    request: PredictHeatOutlookRequest,
    *,
    client: FortyGuardClient = fortyguard_client,
    now: datetime | None = None,
) -> PredictHeatOutlookResponse:
    """Sample requested provider times concurrently while preserving request order."""

    current = now or datetime.now(UTC)
    generated_at = current.replace(tzinfo=UTC) if current.tzinfo is None else current.astimezone(UTC)
    forecast_times = build_forecast_times(request, now=generated_at)

    # Each point is an independent FortyGuard heatmap job. Running them together
    # avoids making the user wait for +1h to finish before +3h can even start.
    points = list(
        await asyncio.gather(
            *[
                _sample_one(request, offset, local_timestamp, utc_timestamp, client)
                for offset, local_timestamp, utc_timestamp in forecast_times
            ]
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
        location=request.location,
        timezone_name=request.timezone_name,
        generated_at=generated_at,
        forecast_horizon_hours=max(request.offset_hours),
        sample_offsets_hours=request.offset_hours,
        points=points,
        summary=summary,
        limitations=OUTLOOK_LIMITATIONS,
    )
