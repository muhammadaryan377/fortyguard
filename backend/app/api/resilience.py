"""Site-level historical heat resilience endpoint."""

from fastapi import APIRouter

from app.api.risk import _provider_error
from app.models.resilience import SiteResilienceRequest, SiteResilienceResponse
from app.services.resilience_intelligence import create_site_resilience

router = APIRouter(prefix="/resilience", tags=["Site heat resilience"])


@router.post("/site-history", response_model=SiteResilienceResponse)
async def site_history(payload: SiteResilienceRequest) -> SiteResilienceResponse:
    try:
        return await create_site_resilience(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
