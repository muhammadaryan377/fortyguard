"""Human-gated operational cycle endpoints."""

from functools import lru_cache

from fastapi import APIRouter, HTTPException

from app.api.risk import _provider_error
from app.models.operations import ApprovalRequest, ApprovalResponse, AuditEvent, CyclePlanResponse, HeatShieldCycleRequest, VerificationResponse
from app.services.cycle_orchestrator import CycleOrchestrator
from app.services.spatial_context import operational_polygon_context
from app.services.state_store import SQLiteHeatShieldStateStore

router = APIRouter(prefix="/cycle", tags=["Operational cycle"])


@lru_cache
def get_store() -> SQLiteHeatShieldStateStore:
    return SQLiteHeatShieldStateStore()


def get_orchestrator() -> CycleOrchestrator:
    return CycleOrchestrator(get_store())


@router.post("/plan", response_model=CyclePlanResponse)
async def plan(payload: HeatShieldCycleRequest) -> CyclePlanResponse:
    token = operational_polygon_context.set(payload.operational_polygon)
    try:
        return await get_orchestrator().plan(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    finally:
        operational_polygon_context.reset(token)


@router.post("/{cycle_id}/approve", response_model=ApprovalResponse)
async def approve(cycle_id: str, payload: ApprovalRequest) -> ApprovalResponse:
    try: return get_orchestrator().approve(cycle_id, payload)
    except KeyError as exc: raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{cycle_id}/verify", response_model=VerificationResponse)
async def verify(cycle_id: str) -> VerificationResponse:
    try: return await get_orchestrator().verify(cycle_id)
    except KeyError as exc: raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc: raise _provider_error(exc) from exc


@router.post("/{cycle_id}/recheck", response_model=CyclePlanResponse)
async def recheck(cycle_id: str) -> CyclePlanResponse:
    try: return await get_orchestrator().recheck(cycle_id)
    except KeyError as exc: raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc: raise _provider_error(exc) from exc


@router.get("/{cycle_id}/audit", response_model=list[AuditEvent])
async def audit(cycle_id: str) -> list[AuditEvent]:
    if not get_store().get_cycle(cycle_id): raise HTTPException(status_code=404, detail="Cycle not found")
    return [AuditEvent.model_validate(item) for item in get_store().get_audit(cycle_id)]
