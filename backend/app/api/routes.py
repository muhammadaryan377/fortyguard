"""HeatShield system and FortyGuard integration routes."""

import logging
from time import monotonic

from fastapi import APIRouter, HTTPException, Path

from app.core.config import settings
from app.models.fortyguard import (
    EnvironmentalParametersRequest,
    FortyGuardJobStatus,
    FortyGuardJobSubmission,
    HeatmapRequest,
)
from app.services.fortyguard import (
    FortyGuardAPIError,
    FortyGuardConfigurationError,
    FortyGuardJobFailedError,
    FortyGuardTimeoutError,
    fortyguard_client,
    normalize_environmental_result,
    normalize_heatmap_result,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _upstream_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FortyGuardTimeoutError):
        return HTTPException(status_code=504, detail=str(exc))
    if isinstance(exc, FortyGuardConfigurationError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, (FortyGuardAPIError, FortyGuardJobFailedError)):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=502, detail="Unexpected FortyGuard failure")


@router.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "HeatShield AI"}


@router.get("/config-check")
async def config_check() -> dict[str, str | bool]:
    return {
        "fortyguard_api_key_loaded": bool(settings.fortyguard_api_key),
        "fortyguard_base_url": settings.fortyguard_base_url,
    }


@router.post("/fortyguard/heatmap", response_model=FortyGuardJobSubmission)
async def create_heatmap(payload: HeatmapRequest) -> FortyGuardJobSubmission:
    try:
        activity_id = await fortyguard_client.create_heatmap(payload)
        return FortyGuardJobSubmission(activity_id=activity_id)
    except Exception as exc:
        raise _upstream_error(exc) from exc


@router.get("/fortyguard/status/{activity_id}", response_model=FortyGuardJobStatus)
async def get_heatmap_status(
    activity_id: str = Path(min_length=1, max_length=200),
) -> FortyGuardJobStatus:
    try:
        return await fortyguard_client.get_status(activity_id)
    except Exception as exc:
        raise _upstream_error(exc) from exc


@router.post("/fortyguard/heatmap/result")
async def create_heatmap_result(payload: HeatmapRequest) -> dict[str, object]:
    started = monotonic()
    try:
        activity_id = await fortyguard_client.create_heatmap(payload)
        job = await fortyguard_client.wait_for_result(activity_id)
        result = normalize_heatmap_result(job.result or {})
        logger.info(
            "fortyguard_heatmap_completed activity_id=%s duration_ms=%d",
            activity_id,
            int((monotonic() - started) * 1000),
        )
        return {
            "activity_id": activity_id,
            "status": job.status,
            "result": result.model_dump(),
        }
    except Exception as exc:
        raise _upstream_error(exc) from exc


@router.post("/fortyguard/environment", response_model=FortyGuardJobSubmission)
async def create_environmental_parameters(
    payload: EnvironmentalParametersRequest,
) -> FortyGuardJobSubmission:
    try:
        activity_id = await fortyguard_client.get_environmental_parameters(payload)
        return FortyGuardJobSubmission(activity_id=activity_id)
    except Exception as exc:
        raise _upstream_error(exc) from exc


@router.post("/fortyguard/environment/result")
async def create_environmental_result(
    payload: EnvironmentalParametersRequest,
) -> dict[str, object]:
    try:
        activity_id = await fortyguard_client.get_environmental_parameters(payload)
        job = await fortyguard_client.wait_for_result(activity_id)
        return {
            "activity_id": activity_id,
            "status": job.status,
            "conditions": [
                item.model_dump() for item in normalize_environmental_result(job.result or {})
            ],
            "raw": job.result,
        }
    except Exception as exc:
        raise _upstream_error(exc) from exc
