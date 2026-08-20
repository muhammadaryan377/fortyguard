"""FastAPI routes for deterministic operational heat-risk assessment."""

import logging

from fastapi import APIRouter, HTTPException

from app.models.risk import LiveRiskAssessmentRequest, RiskAssessment, RiskAssessmentRequest
from app.services.fortyguard import (
    FortyGuardAPIError,
    FortyGuardConfigurationError,
    FortyGuardJobFailedError,
    FortyGuardTimeoutError,
)
from app.services.live_environment import get_live_environment
from app.services.risk_engine import assess_risk

router = APIRouter(prefix="/risk", tags=["Risk assessment"])
logger = logging.getLogger(__name__)


def _provider_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FortyGuardTimeoutError):
        return HTTPException(status_code=504, detail=str(exc))
    if isinstance(exc, FortyGuardConfigurationError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, (FortyGuardAPIError, FortyGuardJobFailedError)):
        return HTTPException(status_code=502, detail=str(exc))

    # Do not mislabel local programming/orchestration failures as provider errors.
    # The traceback remains server-side while the client gets a safe diagnosis.
    logger.exception(
        "heatshield_internal_orchestration_failure exception_type=%s",
        type(exc).__name__,
    )
    return HTTPException(
        status_code=500,
        detail="HeatShield internal orchestration failure",
    )


@router.post("/assess", response_model=RiskAssessment)
async def assess(payload: RiskAssessmentRequest) -> RiskAssessment:
    return assess_risk(payload.environment, payload.worker, payload.task)


@router.post("/assess-live", response_model=RiskAssessment)
async def assess_live(payload: LiveRiskAssessmentRequest) -> RiskAssessment:
    try:
        environment = await get_live_environment(
            payload.location,
            payload.date_time,
            timezone_name=payload.timezone_name,
        )
        return assess_risk(environment, payload.worker, payload.task)
    except Exception as exc:
        raise _provider_error(exc) from exc
