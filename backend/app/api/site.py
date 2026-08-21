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
from app.services.snapshot_agent_cycle import create_snapshot_agent_cycle

router = APIRouter(prefix="/site", tags=["Multi-worker site intelligence"])

AGENT_PLAN_WORKER_CONCURRENCY = 3
SNAPSHOT_REUSE_MAX_AGE_SECONDS = 120

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
    ],
    "include_prediction": True, "include_spatial_intelligence": True,
    "include_shift_optimization": False,
}


def get_site_orchestrator() -> SiteOperationsOrchestrator:
    return SiteOperationsOrchestrator(get_store())


def _snapshot_creation_age_seconds(snapshot_id: str) -> float | None:
    """Use the real audit creation timestamp, not the rounded thermal-analysis anchor."""
    events = get_store().get_audit(snapshot_id)
    created = next((event for event in events if event.get("event_type") == "site_snapshot_created"), None)
    if not created or not created.get("timestamp"):
        return None
    try:
        created_at = datetime.fromisoformat(str(created["timestamp"]))
    except ValueError:
        return None
    created_at = created_at.replace(tzinfo=UTC) if created_at.tzinfo is None else created_at.astimezone(UTC)
    return max(0.0, (datetime.now(UTC) - created_at).total_seconds())


@router.post("/operations-snapshot", response_model=SiteOperationsResponse)
async def create_snapshot(payload: SiteOperationsRequest = Body(openapi_examples={
        "phoenix_two_workers": {"summary": "Phoenix site with two worker assignments", "value": PHOENIX_EXAMPLE}})) -> SiteOperationsResponse:
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
    """Build bounded worker decisions from fresh snapshot evidence, with safe fresh-cycle fallback."""
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
    snapshot_workers = {worker.worker_id: worker for worker in snapshot.workers}
    cycle_orchestrator = CycleOrchestrator(get_store())
    semaphore = asyncio.Semaphore(AGENT_PLAN_WORKER_CONCURRENCY)
    snapshot_age_seconds = _snapshot_creation_age_seconds(snapshot_id)
    reuse_fresh = snapshot_age_seconds is not None and snapshot_age_seconds <= SNAPSHOT_REUSE_MAX_AGE_SECONDS

    async def run_worker(index: int, worker_id: str):
        helper = site_orchestrator.cycle_request(snapshot_id, worker_id)
        worker = snapshot_workers[worker_id]
        async with semaphore:
            reused = bool(reuse_fresh and worker.heat_outlook is not None and worker.current_assessment is not None)
            if reused:
                cycle = await create_snapshot_agent_cycle(
                    store=get_store(),
                    cycle_request=helper.cycle_request,
                    assessment=worker.current_assessment,
                    outlook=worker.heat_outlook,
                    spatial=worker.spatial_heat,
                    optimization=worker.shift_optimization,
                    snapshot_id=snapshot_id,
                    generated_at=datetime.now(UTC),
                )
            else:
                cycle = await cycle_orchestrator.plan(helper.cycle_request)
        return index, SiteWorkerAgentResult(worker_id=worker_id, cycle=cycle), reused

    try:
        completed = await asyncio.gather(
            *(run_worker(index, worker_id) for index, worker_id in enumerate(ordered))
        )
        completed = sorted(completed, key=lambda item: item[0])
        results = [item for _, item, _ in completed]
        reused_count = sum(int(reused) for _, _, reused in completed)
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
            "snapshot_evidence_reused_count": reused_count,
            "fresh_cycle_fallback_count": len(results) - reused_count,
            "snapshot_age_seconds": snapshot_age_seconds,
            "snapshot_reuse_max_age_seconds": SNAPSHOT_REUSE_MAX_AGE_SECONDS,
            "worker_decision_concurrency": AGENT_PLAN_WORKER_CONCURRENCY,
        },
    )
    return SiteAgentPlanResponse(
        snapshot_id=snapshot_id,
        generated_at=generated_at,
        worker_count=len(results),
        results=results,
        limitations=[
            f"Snapshot evidence is reused only when the actual snapshot creation age is at most {SNAPSHOT_REUSE_MAX_AGE_SECONDS} seconds; stale/incomplete workers fall back to a fresh provider cycle.",
            "Shared site forecast maps are extracted separately at each worker coordinate; temperatures are not copied from another worker.",
            "Spatial alternatives are constrained to supervisor-configured relocation-enabled work/recovery zones.",
            "Every operational action remains human-gated. VERIFY obtains fresh provider evidence and does not rely on snapshot reuse.",
        ],
    )
