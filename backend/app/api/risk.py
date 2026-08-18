"""FastAPI routes for deterministic operational heat-risk assessment."""

from fastapi import APIRouter, HTTPException

from app.models.fortyguard import EnvironmentalParametersRequest
from app.models.risk import LiveRiskAssessmentRequest, RiskAssessment, RiskAssessmentRequest
from app.services.fortyguard import (
    FortyGuardAPIError,
    FortyGuardConfigurationError,
    FortyGuardJobFailedError,
    FortyGuardTimeoutError,
    fortyguard_client,
    normalize_environmental_result,
)
from app.services.risk_engine import assess_risk

router = APIRouter(prefix="/risk", tags=["Risk assessment"])


def _provider_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FortyGuardTimeoutError):
        return HTTPException(status_code=504, detail=str(exc))
    if isinstance(exc, FortyGuardConfigurationError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, (FortyGuardAPIError, FortyGuardJobFailedError)):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=502, detail="Unexpected FortyGuard failure")


@router.post("/assess", response_model=RiskAssessment)
async def assess(payload: RiskAssessmentRequest) -> RiskAssessment:
    return assess_risk(payload.environment, payload.worker, payload.task)


@router.post("/assess-live", response_model=RiskAssessment)
async def assess_live(payload: LiveRiskAssessmentRequest) -> RiskAssessment:
    provider_request = EnvironmentalParametersRequest(
        latitude=payload.location.latitude,
        longitude=payload.location.longitude,
        temperature=payload.temperature_c,
        date_time=payload.date_time,
    )
    try:
        activity_id = await fortyguard_client.get_environmental_parameters(provider_request)
        job = await fortyguard_client.wait_for_result(activity_id)
        observations = normalize_environmental_result(job.result or {})
        if not observations:
            raise FortyGuardAPIError("FortyGuard returned no environmental observations")
        return assess_risk(observations[0], payload.worker, payload.task)
    except Exception as exc:
        raise _provider_error(exc) from exc
