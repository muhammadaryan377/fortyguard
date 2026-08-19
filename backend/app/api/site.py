"""Supervisor-ready multi-worker site snapshot endpoints."""

from fastapi import APIRouter, Body, HTTPException

from app.api.cycle import get_store
from app.api.risk import _provider_error
from app.models.site import SelectedWorkerCycleRequest, SiteOperationsRequest, SiteOperationsResponse
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
