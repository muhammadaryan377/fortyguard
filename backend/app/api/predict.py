"""PREDICT Phase 1 API routes."""

from fastapi import APIRouter

from app.models.prediction import PredictHeatOutlookRequest, PredictHeatOutlookResponse
from app.services.predictive_heat import create_heat_outlook

router = APIRouter(prefix="/predict", tags=["Prediction"])


@router.post("/heat-outlook", response_model=PredictHeatOutlookResponse)
async def heat_outlook(payload: PredictHeatOutlookRequest) -> PredictHeatOutlookResponse:
    return await create_heat_outlook(payload)
