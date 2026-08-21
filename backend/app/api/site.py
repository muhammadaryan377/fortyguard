"""Supervisor-ready multi-worker site snapshot endpoints."""

import asyncio
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
from app.services.spatial_context import operational_polygon_context

router = APIRouter(prefix="/site", tags=["Multi-worker site intelligence"])

# Each worker cycle already fans out independent provider forecast jobs. Keeping
# this small gives the UI a substantial latency reduction without creating an
# unbounded provider burst when a supervisor plans a larger crew.
AGENT_PLAN_WORKER_CONCURRENCY = 2

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
        helper = get_site_orchestrator().cycle_request(snapshot_id, worker_id)
        snapshot = get_site_orchestrator().get(snapshot_id)
        if helper.cycle_request.include_spatial_intelligence and snapshot.site_polygon is not None:
            helper.cycle_request = helper.cycle_request.model_copy(
                update={"operational_polygon": snapshot.site_polygon}
            )
        return helper
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/operations-snapshot/{snapshot_id}/agent-plan", response_model=SiteAgentPlanResponse)
async def create_site_agent_plan(snapshot_id: str, payload: SiteAgentPlanRequest) -> SiteAgentPlanResponse:
    """Run bounded worker cycles concurrently while preserving attention order.

    Each selected worker still refreshes provider evidence at the submitted
    coordinate before DeepSeek may select a server-defined tool. Concurrency is
    intentionally bounded because a single worker cycle already creates several
    independent provider jobs.
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
    semaphore = asyncio.Semaphore(AGENT_PLAN_WORKER_CONCURRENCY)

    async def run_worker(index: int, worker_id: str) -> tuple[int, SiteWorkerAgentResult]:
        helper = site_orchestrator.cycle_request(snapshot_id, worker_id)
        cycle_request = helper.cycle_request
        if cycle_request.include_spatial_intelligence and snapshot.site_polygon is not None:
            cycle_request = cycle_request.model_copy(
                update={"operational_polygon": snapshot.site_polygon}
            )

        async with semaphore:
            token = operational_polygon_context.set(cycle_request.operational_polygon)
            try:
                cycle = await cycle_orchestrator.plan(cycle_request)
            finally:
                operational_polygon_context.reset(token)
        return index, SiteWorkerAgentResult(worker_id=worker_id, cycle=cycle)

    try:
        completed = await asyncio.gather(
            *(run_worker(index, worker_id) for index, worker_id in enumerate(ordered))
        )
        # asyncio.gather preserves input order, but sort explicitly so this remains
        # deterministic even if the implementation later changes to as_completed.
        results = [item for _, item in sorted(completed, key=lambda pair: pair[0])]
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
            "site_boundary_applied_to_spatial_cycles": snapshot.site_polygon is not None,
            "worker_cycle_concurrency": AGENT_PLAN_WORKER_CONCURRENCY,
        },
    )
    return SiteAgentPlanResponse(
        snapshot_id=snapshot_id,
        generated_at=generated_at,
        worker_count=len(results),
        results=results,
        limitations=[
            "Worker cycles refresh provider evidence independently and may differ from the earlier site snapshot.",
            "Worker cycles use bounded concurrency; result order still follows the deterministic attention queue.",
            "Spatial relocation candidates are eligible only when verified inside the submitted operational polygon.",
            "Every proposed action remains human-gated and must be approved before it is recorded operationally.",
        ],
    )
