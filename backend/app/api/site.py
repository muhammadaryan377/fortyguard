"""Supervisor-ready multi-worker site snapshot endpoints."""

from datetime import UTC, datetime

from fastapi import APIRouter, Body, HTTPException

from app.api.cycle import get_store
from app.api.risk import _provider_error
from app.models.site import (
    SelectedWorkerCycleRequest,
    SiteAgentPlanRequest,
    SiteAgentPlanResponse,
    SiteOperationsRequest,
    SiteOperationsResponse,
    SiteWorkerAgentResult,
)
from app.services.cycle_orchestrator import CycleOrchestrator
from app.services.site_operations import SiteOperationsOrchestrator

router = APIRouter(prefix="/site", tags=["Multi-worker site intelligence"])

PHOENIX_EXAMPLE = {
    "location": {"site_id": "PHX-01", "name": "Phoenix Operations Site", "city": "Phoenix",
        "state": "Arizona", "latitude": 33.4484, "longitude": -112.0740},
    "timezone_name": "America/Phoenix",
    "assignments": [
        {"display_label": "Roof crew", "worker": {"worker_id": "W-001", "site_id": "PHX-01", "acclimatized": False},
         "task": {"task_id": "T-ROOF", "task_name": "Roof material handling", "workload_level": "heavy",
             "exposure_duration_minutes": 90, "outdoor": True, "direct_sun": True}},
        {"display_label": "Yard inspection", "worker": {"worker_id": "W-002", "site_id": "PHX-01", "acclimatized": True},
         "task": {"task_id": "T-YARD", "task_name": "Outdoor equipment inspection", "workload_level": "moderate",
             "exposure_duration_minutes": 60, "outdoor": True, "direct_sun": False}},
        {"display_label": "Gate records", "worker": {"worker_id": "W-003", "site_id": "PHX-01", "acclimatized": True},
         "task": {"task_id": "T-GATE", "task_name": "Gate inventory records", "workload_level": "light",
             "exposure_duration_minutes": 45, "outdoor": True, "direct_sun": False}},
    ],
    "include_prediction": True, "include_spatial_intelligence": True,
    "include_shift_optimization": False,
}


def get_site_orchestrator() -> SiteOperationsOrchestrator:
    return SiteOperationsOrchestrator(get_store())


@router.post("/operations-snapshot", response_model=SiteOperationsResponse)
async def create_snapshot(payload: SiteOperationsRequest = Body(openapi_examples={
        "phoenix_three_workers": {"summary": "Phoenix site with three worker assignments", "value": PHOENIX_EXAMPLE}})) -> SiteOperationsResponse:
    try:
        return await get_site_orchestrator().create(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc


@router.get("/operations-snapshot/{snapshot_id}", response_model=SiteOperationsResponse)
async def get_snapshot(snapshot_id: str) -> SiteOperationsResponse:
    try:
        return get_site_orchestrator().get(snapshot_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/operations-snapshot/{snapshot_id}/worker/{worker_id}/cycle-request",
             response_model=SelectedWorkerCycleRequest)
async def selected_worker_cycle_request(snapshot_id: str, worker_id: str) -> SelectedWorkerCycleRequest:
    try:
        return get_site_orchestrator().cycle_request(snapshot_id, worker_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/operations-snapshot/{snapshot_id}/agent-plan", response_model=SiteAgentPlanResponse)
async def create_site_agent_plan(snapshot_id: str, payload: SiteAgentPlanRequest) -> SiteAgentPlanResponse:
    """Run bounded worker cycles in deterministic attention order.

    The site snapshot remains the shared supervisor view. Each selected worker
    cycle deliberately refreshes provider evidence at that worker's submitted
    coordinates before DeepSeek is allowed to select from server-defined tools.
    """

    site_orchestrator = get_site_orchestrator()
    try:
        snapshot = site_orchestrator.get(snapshot_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    available = {worker.worker_id for worker in snapshot.workers}
    unknown = [worker_id for worker_id in payload.worker_ids if worker_id not in available]
    if unknown:
        raise HTTPException(status_code=404, detail=f"Workers not found in site snapshot: {', '.join(unknown)}")

    requested = set(payload.worker_ids)
    ordered = [worker_id for worker_id in snapshot.attention_queue if worker_id in requested]
    cycle_orchestrator = CycleOrchestrator(get_store())
    results: list[SiteWorkerAgentResult] = []

    try:
        for worker_id in ordered:
            helper = site_orchestrator.cycle_request(snapshot_id, worker_id)
            cycle = await cycle_orchestrator.plan(helper.cycle_request)
            results.append(SiteWorkerAgentResult(worker_id=worker_id, cycle=cycle))
    except Exception as exc:
        raise _provider_error(exc) from exc

    generated_at = datetime.now(UTC)
    get_store().add_audit(
        snapshot_id,
        "site_agent_plan_created",
        {
            "worker_ids": ordered,
            "worker_count": len(results),
            "cycle_ids": [item.cycle.cycle_id for item in results],
        },
    )
    return SiteAgentPlanResponse(
        snapshot_id=snapshot_id,
        generated_at=generated_at,
        worker_count=len(results),
        results=results,
        limitations=[
            "Worker cycles refresh provider evidence independently and may differ from the earlier site snapshot.",
            "Every proposed action remains human-gated and must be approved before it is recorded operationally.",
        ],
    )
