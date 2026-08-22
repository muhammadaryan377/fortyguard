"""On-demand FortyGuard Premium satellite and street-view intelligence."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.models.premium import (
    PremiumLocationIntelligenceRequest,
    PremiumLocationIntelligenceResponse,
    SegmentationFrame,
)
from app.services.fortyguard import FortyGuardClient, fortyguard_client


def _image_data_uri(value: Any) -> str | None:
    """Normalize provider Base64 image fields for safe browser rendering."""
    if isinstance(value, list):
        value = next((item for item in value if isinstance(item, str) and item.strip()), None)
    if not isinstance(value, str) or not value.strip():
        return None
    stripped = value.strip()
    if stripped.startswith("data:image/"):
        return stripped
    return f"data:image/png;base64,{stripped}"


def _analysis_local(request: PremiumLocationIntelligenceRequest, generated_at: datetime) -> datetime:
    source = request.analysis_datetime or generated_at
    if source.tzinfo is None:
        source = source.replace(tzinfo=UTC)
    return source.astimezone(ZoneInfo(request.timezone_name)).replace(second=0, microsecond=0)


async def _satellite_frame(
    request: PremiumLocationIntelligenceRequest,
    *,
    client: FortyGuardClient,
    generated_at: datetime,
) -> SegmentationFrame:
    local = _analysis_local(request, generated_at)
    payload = {
        "sat": {"latitude": request.latitude, "longitude": request.longitude},
        "date_time": {
            "start_date": local.date().isoformat(),
            "start_time": local.strftime("%H:%M"),
            "filter_type": 1,
        },
        "granularity": request.granularity,
    }
    activity_id = await client.create_satellite_segmentation(payload)
    job = await client.wait_for_result(activity_id)
    result = job.result or {}
    segmentation = result.get("segmentation") if isinstance(result.get("segmentation"), dict) else {}

    # FortyGuard's current documented response spells this field `orignal_image`.
    # Accept the corrected spelling too so a provider schema cleanup does not break us.
    original = result.get("orignal_image")
    if original is None:
        original = result.get("original_image")

    return SegmentationFrame(
        source="fortyguard_satellite",
        activity_id=activity_id,
        original_image_data_uri=_image_data_uri(original),
        segmented_image_data_uri=_image_data_uri(segmentation.get("image_content")),
        segments=segmentation.get("segments") if isinstance(segmentation.get("segments"), dict) else {},
        image_legend=segmentation.get("image_legend") if isinstance(segmentation.get("image_legend"), dict) else {},
        image_year=result.get("image_year") if isinstance(result.get("image_year"), int) else None,
        metadata={
            "coordinates": result.get("coordinates") if isinstance(result.get("coordinates"), dict) else {},
            "image_dimensions": segmentation.get("image_dimensions") if isinstance(segmentation.get("image_dimensions"), dict) else {},
            "processing_time_seconds": segmentation.get("processing_time_seconds"),
        },
    )


async def _street_view_frame(
    request: PremiumLocationIntelligenceRequest,
    *,
    client: FortyGuardClient,
) -> SegmentationFrame:
    payload = {
        "latitude": request.latitude,
        "longitude": request.longitude,
        "vertical_angle": request.street_vertical_angle,
        "horizontal_angle": request.street_horizontal_angle,
        "back_view": request.street_back_view,
    }
    activity_id = await client.create_street_view_segmentation(payload)
    job = await client.wait_for_result(activity_id)
    result = job.result or {}
    front = result.get("front") if isinstance(result.get("front"), dict) else {}

    return SegmentationFrame(
        source="fortyguard_streetview",
        activity_id=activity_id,
        original_image_data_uri=_image_data_uri(front.get("original_image")),
        segmented_image_data_uri=_image_data_uri(front.get("segmented_image")),
        segments=front.get("segments") if isinstance(front.get("segments"), dict) else {},
        image_legend=front.get("image_legend") if isinstance(front.get("image_legend"), dict) else {},
        image_date=front.get("image_date") if isinstance(front.get("image_date"), str) else None,
        metadata={
            "coordinates": result.get("coordinates") if isinstance(result.get("coordinates"), dict) else {},
            "horizontal_angle": request.street_horizontal_angle,
            "vertical_angle": request.street_vertical_angle,
            "back_view": request.street_back_view,
        },
    )


async def create_premium_location_intelligence(
    request: PremiumLocationIntelligenceRequest,
    *,
    client: FortyGuardClient = fortyguard_client,
    clock=None,
) -> PremiumLocationIntelligenceResponse:
    """Fetch Premium imagery only when explicitly requested by the supervisor UI.

    Satellite and street-view jobs are independent. A failure in one does not hide
    a valid result from the other, and no missing imagery or segmentation metric is
    fabricated.
    """

    generated_at = (clock or (lambda: datetime.now(UTC)))()
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=UTC)
    else:
        generated_at = generated_at.astimezone(UTC)

    tasks: list[tuple[str, Any]] = []
    if request.include_satellite:
        tasks.append(("satellite", _satellite_frame(request, client=client, generated_at=generated_at)))
    if request.include_street_view:
        tasks.append(("street_view", _street_view_frame(request, client=client)))

    results = await asyncio.gather(*(task for _, task in tasks), return_exceptions=True)
    satellite = None
    street_view = None
    limitations = [
        "Segmentation imagery is provider context, not proof that a location is safe, accessible, shaded, or suitable for a task.",
        "HeatShield does not infer occupational controls directly from segmentation classes without supervisor verification.",
    ]

    for (name, _), result in zip(tasks, results):
        if isinstance(result, Exception):
            limitations.append(f"{name.replace('_', ' ').title()} intelligence was unavailable for this request.")
            continue
        if name == "satellite":
            satellite = result
        else:
            street_view = result

    available_count = int(satellite is not None) + int(street_view is not None)
    requested_count = len(tasks)
    status = "available" if available_count == requested_count else "partial" if available_count else "unavailable"

    return PremiumLocationIntelligenceResponse(
        status=status,
        latitude=request.latitude,
        longitude=request.longitude,
        generated_at=generated_at,
        satellite=satellite,
        street_view=street_view,
        limitations=limitations,
    )
