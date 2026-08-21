"""On-demand FortyGuard Premium imagery intelligence endpoints."""

from fastapi import APIRouter

from app.api.risk import _provider_error
from app.models.premium import PremiumLocationIntelligenceRequest, PremiumLocationIntelligenceResponse
from app.services.premium_intelligence import create_premium_location_intelligence

router = APIRouter(prefix="/premium", tags=["FortyGuard Premium intelligence"])


@router.post("/location-intelligence", response_model=PremiumLocationIntelligenceResponse)
async def location_intelligence(
    payload: PremiumLocationIntelligenceRequest,
) -> PremiumLocationIntelligenceResponse:
    try:
        return await create_premium_location_intelligence(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
