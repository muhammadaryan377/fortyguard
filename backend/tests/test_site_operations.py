from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.models.fortyguard import EnvironmentalConditions
from app.models.prediction import ForecastTemperaturePoint, HeatOutlookSummary, PredictHeatOutlookResponse
from app.models.risk import TaskContext, USSiteLocation, WorkerContext
from app.models.site import SiteOperationsRequest, SiteWorkerAssignment
from app.models.spatial import SpatialHeatResponse, SpatialHeatSummary, SpatialSiteReference
from app.services.site_operations import SiteOperationsOrchestrator
from app.services.state_store import InMemoryHeatShieldStateStore

NOW = datetime(2026, 8, 19, 12, tzinfo=UTC)


def location():
    return USSiteLocation(site_id="S1", name="Phoenix", city="Phoenix", state="Arizona",
        latitude=33.4484, longitude=-112.0740)


def assignment(worker_id="W1", *, direct_sun=False, acclimatized=True):
    return SiteWorkerAssignment(worker=WorkerContext(worker_id=worker_id, site_id="S1", acclimatized=acclimatized),
        task=TaskContext(task_id=f"T-{worker_id}", task_name="Outdoor task", workload_level="moderate",
            exposure_duration_minutes=60, outdoor=True, direct_sun=direct_sun))


def outlook():
    points = [ForecastTemperaturePoint(status="available", offset_hours=offset,
        requested_local_timestamp=NOW + timedelta(hours=offset), requested_utc_timestamp=NOW + timedelta(hours=offset),
        temperature_c=temperature) for offset, temperature in ((1, 38.0), (3, 34.0))]
    return PredictHeatOutlookResponse(status="available", location=location(), timezone_name="America/Phoenix",
        generated_at=NOW, forecast_horizon_hours=3, sample_offsets_hours=[1, 3], points=points,
        summary=HeatOutlookSummary(available_points=2, total_points=2, trend="falling",
            highest_sampled_temperature_c=38, lowest_sampled_temperature_c=34), limitations=[])


def spatial():
    return SpatialHeatResponse(status="no_cooler_candidate", generated_at=NOW, location=location(),
        timezone_name="America/Phoenix", search_radius_meters=400, granularity=60,
        site_reference=SpatialSiteReference(site_temperature_c=40), tiles=[], candidates=[],
        summary=SpatialHeatSummary(valid_tile_count=1, cooler_candidate_count=0), limitations=[])


def request(count=1, **values):
    data = dict(location=location(), assignments=[assignment(f"W{i:02}") for i in range(count)],
        forecast_offset_hours=[1, 3])
    data.update(values)
    return SiteOperationsRequest(**data)


def test_site_request_constraints_and_combinations():
    with pytest.raises(ValidationError): SiteOperationsRequest(location=location(), assignments=[])
    with pytest.raises(ValidationError): request(26)
    with pytest.raises(ValidationError): SiteOperationsRequest(location=location(), assignments=[assignment(), assignment()])
    with pytest.raises(ValidationError): request(timezone_name="Mars/Olympus")
    with pytest.raises(ValidationError): request(forecast_offset_hours=[0])
    with pytest.raises(ValidationError): request(spatial_search_radius_meters=99)
    with pytest.raises(ValidationError): request(include_prediction=False, include_shift_optimization=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [1, 10, 25])
async def test_shared_services_once_and_one_assessment_per_worker(monkeypatch, count):
    calls = {"sense": 0, "predict": 0, "spatial": 0}
    environment = EnvironmentalConditions(timestamp=NOW.isoformat(), temperature_c=40, heat_index_c=42)
    async def sense(*args, **kwargs): calls["sense"] += 1; return environment
    async def predict(*args, **kwargs): calls["predict"] += 1; return outlook()
    async def spatial_call(*args, **kwargs): calls["spatial"] += 1; return spatial()
    monkeypatch.setattr("app.services.site_operations.get_live_environment", sense)
    monkeypatch.setattr("app.services.site_operations.create_heat_outlook", predict)
    monkeypatch.setattr("app.services.site_operations.create_spatial_heat", spatial_call)
    store = InMemoryHeatShieldStateStore()
    result = await SiteOperationsOrchestrator(store, clock=lambda: NOW).create(request(count))
    assert calls == {"sense": 1, "predict": 1, "spatial": 1}
    assert result.provider_usage.current_environment_fetches == 1
    assert result.provider_usage.prediction_heatmap_requests == 2
    assert result.provider_usage.spatial_heatmap_requests == 1
    assert result.provider_usage.worker_assessment_count == count
    assert result.provider_usage.deepseek_calls == 0
    assert all(worker.current_assessment.environmental_evidence == environment for worker in result.workers)


@pytest.mark.asyncio
async def test_disabled_optional_calls_attention_order_and_persistence(monkeypatch):
    calls = {"sense": 0}
    async def sense(*args, **kwargs):
        calls["sense"] += 1
        return EnvironmentalConditions(timestamp=NOW.isoformat(), temperature_c=32, heat_index_c=32)
    monkeypatch.setattr("app.services.site_operations.get_live_environment", sense)
    store = InMemoryHeatShieldStateStore()
    orchestrator = SiteOperationsOrchestrator(store, clock=lambda: NOW)
    payload = SiteOperationsRequest(location=location(), include_prediction=False,
        include_spatial_intelligence=False, assignments=[assignment("Z"), assignment("A", direct_sun=True)])
    created = await orchestrator.create(payload)
    assert created.provider_usage.prediction_heatmap_requests == 0
    assert created.provider_usage.spatial_heatmap_requests == 0
    assert created.attention_queue == ["A", "Z"]
    assert not hasattr(created.summary, "risk_score")
    later = SiteOperationsOrchestrator(store, clock=lambda: NOW + timedelta(seconds=90))
    loaded = later.get(created.snapshot_id)
    assert loaded.generated_at == created.generated_at and loaded.age_seconds == 90
    assert calls["sense"] == 1
    helper = later.cycle_request(created.snapshot_id, "A")
    assert helper.cycle_request.worker.worker_id == "A"
    assert any("fresh provider fetches" in item for item in helper.limitations)
    with pytest.raises(KeyError): later.cycle_request(created.snapshot_id, "unknown")
