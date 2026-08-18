"""Provider-backed spatial heat intelligence endpoint."""

from fastapi import APIRouter

from app.api.risk import _provider_error
from app.models.spatial import SpatialHeatRequest, SpatialHeatResponse
from app.services.spatial_heat import create_spatial_heat

router = APIRouter(prefix="/spatial", tags=["Spatial intelligence"])


@router.post("/cooler-zones", response_model=SpatialHeatResponse)
async def cooler_zones(payload: SpatialHeatRequest) -> SpatialHeatResponse:
    try: return await create_spatial_heat(payload)
    except Exception as exc: raise _provider_error(exc) from exc
