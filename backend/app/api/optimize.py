"""Deterministic sampled-start shift optimization endpoint."""

from fastapi import APIRouter

from app.models.optimization import ShiftOptimizationRequest, ShiftOptimizationResponse
from app.services.shift_optimizer import optimize_shift

router = APIRouter(prefix="/optimize", tags=["Shift optimization"])


@router.post("/shift", response_model=ShiftOptimizationResponse)
async def optimize(payload: ShiftOptimizationRequest) -> ShiftOptimizationResponse:
    return optimize_shift(payload)
