from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.fortyguard import FortyGuardJobStatus
from app.models.operations import AgentDecisionRequest, HeatShieldCycleRequest
from app.models.fortyguard import EnvironmentalConditions
from app.models.risk import USSiteLocation
from app.models.spatial import SpatialHeatRequest
from app.services.agent_decision import decide
from app.services.agent_model import ModelToolCall
from app.services.cycle_orchestrator import next_step_for_decision
from app.services.cycle_orchestrator import CycleOrchestrator
from app.services.live_environment import build_site_polygon
from app.services.spatial_heat import analyze_spatial_features, create_spatial_heat, haversine_distance_m
from app.services.state_store import InMemoryHeatShieldStateStore
from tests.test_agent_operations import FakeAgentModel, NOW, decision_request


def location():
    return USSiteLocation(site_id="S1", name="Site", city="Phoenix", state="Arizona", latitude=33.4484, longitude=-112.074)


def square(lon, lat, value, size=.0004, field="average_temperature", **properties):
    props = {field: value, **properties}
    ring = [[lon-size,lat-size],[lon+size,lat-size],[lon+size,lat+size],[lon-size,lat+size],[lon-size,lat-size]]
    return {"type":"Feature","properties":props,"geometry":{"type":"Polygon","coordinates":[ring]}}


def request(**values): return SpatialHeatRequest(location=location(), **values)


def response(features, **values):
    return analyze_spatial_features({"type":"FeatureCollection","features":features}, request(**values), generated_at=NOW, activity_id="spatial-1")


@pytest.mark.parametrize("values", [{"timezone_name":"Bad/Zone"},{"search_radius_meters":99},{"search_radius_meters":1501}])
def test_spatial_request_validation(values):
    with pytest.raises(ValidationError): request(**values)


def test_spatial_endpoint_registered():
    assert "/api/spatial/cooler-zones" in app.openapi()["paths"]


def test_containing_reference_candidates_and_sanitized_output():
    result = response(
        [square(-112.074,33.4484,40), square(-112.070,33.4484,35), square(-112.068,33.4484,38)],
        search_radius_meters=800,
    )
    assert result.status == "available" and result.site_reference.site_temperature_c == 40
    assert [c.temperature_c for c in result.candidates] == [35,38]
    assert all(c.cooler_by_c > 0 for c in result.candidates)
    body = result.model_dump_json().lower()
    assert "featurecollection" not in body and "stats_data" not in body and "api_key" not in body


def test_no_containing_tile_never_uses_nearest_or_stats():
    result = analyze_spatial_features({"type":"FeatureCollection","features":[square(-112.070,33.4484,30)],
        "stats_data":{"mean":40}}, request(), generated_at=NOW, activity_id="a")
    assert result.status == "insufficient_data" and result.site_reference.site_temperature_c is None
    assert result.candidates == []


def test_malformed_non_numeric_equal_hotter_and_site_tiles_are_not_candidates():
    malformed = {"type":"Feature","properties":{"value":20},"geometry":{"type":"Point","coordinates":[]}}
    result = response([square(-112.074,33.4484,40), square(-112.071,33.4484,"cold"), malformed,
        square(-112.069,33.4484,40), square(-112.067,33.4484,41)])
    assert result.status == "no_cooler_candidate" and result.candidates == []
    assert result.summary.valid_tile_count == 3


def test_explicit_legacy_temperature_field_is_supported():
    result = response([square(-112.074,33.4484,40,field="temperature"),
        square(-112.070,33.4484,35,field="temperature")])
    assert result.status == "available"
    assert result.site_reference.site_temperature_c == 40
    assert result.candidates[0].temperature_c == 35


def test_value_only_analysis_feature_is_not_accepted_as_tcm_temperature():
    result = response([square(-112.074,33.4484,40,field="value")])
    assert result.status == "insufficient_data"
    assert result.tiles == [] and result.site_reference.site_temperature_c is None


def test_min_and_max_without_representative_temperature_fail_closed():
    feature = square(-112.074,33.4484,40)
    feature["properties"] = {"min_temperature": 35, "max_temperature": 45}
    result = response([feature])
    assert result.status == "insufficient_data"
    assert result.tiles == [] and result.summary.valid_tile_count == 0


def test_ranking_coldest_distance_provider_order_and_limit():
    features = [square(-112.074,33.4484,40), square(-112.060,33.4484,30),
        square(-112.072,33.4484,32), square(-112.070,33.4484,30), square(-112.070,33.4484,30)]
    result = response(features, max_candidates=3, search_radius_meters=1500)
    assert [c.tile_id for c in result.candidates] == ["tile-0003","tile-0004","tile-0001"]
    assert len(result.candidates) == 3


def test_haversine_is_deterministic():
    first = haversine_distance_m(33.4484,-112.074,33.4484,-112.070)
    assert first == haversine_distance_m(33.4484,-112.074,33.4484,-112.070)
    assert 300 < first < 500


@pytest.mark.asyncio
async def test_provider_request_uses_tcm_local_time_and_large_aoi():
    client = AsyncMock()
    client.create_heatmap.return_value = "spatial-1"
    client.wait_for_result.return_value = FortyGuardJobStatus(activity_id="spatial-1",status="Completed",
        result={"map_data":{"type":"FeatureCollection","features":[square(-112.074,33.4484,40)]}})
    await create_spatial_heat(request(search_radius_meters=400), client=client, clock=lambda: datetime(2026,8,18,17,20,tzinfo=UTC))
    payload = client.create_heatmap.await_args.args[0]
    assert payload.analytic_type == "tcm" and payload.date_time.filter_type == 1
    assert payload.date_time.start_time.isoformat() == "10:20:00"
    ring = payload.polygon_aoi.features[0].geometry.coordinates[0]
    assert haversine_distance_m(33.4484,-112.074,ring[0][1],ring[0][0]) > 500


@pytest.mark.parametrize(("status","count","expected"), [("decided",1,"human_approval_required"),("agent_unavailable",0,"agent_configuration_required"),("no_action_selected",0,"no_action_available"),("insufficient_data",0,"fresh_evidence_required")])
def test_truthful_next_step(status,count,expected): assert next_step_for_decision(status,count) == expected


@pytest.mark.asyncio
async def test_spatial_agent_tool_uses_rank_one_boundary_verified_server_evidence():
    base = decision_request()
    spatial = response(
        [square(-112.074,33.4484,40),square(-112.070,33.4484,30)],
        operational_polygon=build_site_polygon(33.4484, -112.074, radius_meters=800),
    )
    req = AgentDecisionRequest(current_assessment=base.current_assessment, heat_outlook=base.heat_outlook, spatial_heat=spatial)
    result = await decide(req, model=FakeAgentModel([ModelToolCall("propose_cooler_zone_candidate","{}")]), now=NOW)
    assert result.actions[0].action_type == "consider_cooler_zone"
    assert result.actions[0].details["candidate_id"] == spatial.candidates[0].candidate_id
    assert result.actions[0].details["inside_operational_boundary"] is True
    rejected = await decide(req, model=FakeAgentModel([ModelToolCall("propose_cooler_zone_candidate",'{"temperature_c":0}')]), now=NOW)
    assert rejected.actions == [] and rejected.tool_trace[0].status == "rejected"


@pytest.mark.asyncio
async def test_unverified_spatial_candidate_is_hidden_from_model_and_rejected():
    base = decision_request()
    spatial = response([square(-112.074,33.4484,40), square(-112.070,33.4484,30)])
    req = AgentDecisionRequest(current_assessment=base.current_assessment, heat_outlook=base.heat_outlook, spatial_heat=spatial)
    model = FakeAgentModel([ModelToolCall("propose_cooler_zone_candidate","{}")])
    result = await decide(req, model=model, now=NOW)
    assert model.evidence["spatial"]["top_candidates"] == []
    assert result.actions == []
    assert result.tool_trace[0].safe_reason == "spatial_candidate_not_boundary_verified"


@pytest.mark.asyncio
async def test_spatial_tool_without_evidence_rejected():
    base=decision_request()
    result=await decide(base,model=FakeAgentModel([ModelToolCall("propose_cooler_zone_candidate","{}")]),now=NOW)
    assert result.actions == [] and result.tool_trace[0].safe_reason == "spatial_candidate_unavailable"


def test_spatial_act_record_preserves_candidate_without_movement_claim():
    details={"candidate_id":"candidate-01","temperature_c":30.0,"cooler_by_c":10.0,
        "centroid_latitude":33.45,"centroid_longitude":-112.07,"straight_line_distance_m":350.0,
        "label":"cooler zone candidate"}
    record=CycleOrchestrator._execute({"action_id":"A1","action_type":"consider_cooler_zone","details":details})
    assert record["record_type"] == "relocation_candidate" and record["state"] == "approved_candidate"
    assert record["provider_backed_spatial_candidate"] == details
    assert "moved" not in str(record).lower() and "safe zone" not in str(record).lower()


@pytest.mark.asyncio
async def test_cycle_spatial_runs_once_persists_and_failure_is_nonfatal(monkeypatch):
    base=decision_request(); calls={"spatial":0}
    async def fake_environment(location,date_time,*,timezone_name,client): return EnvironmentalConditions(timestamp=NOW.isoformat(),temperature_c=40,heat_index_c=35)
    async def fake_outlook(request,*,client,now): return base.heat_outlook
    async def fake_spatial(request,*,client,clock):
        calls["spatial"] += 1
        return response(
            [square(-112.074,33.4484,40),square(-112.070,33.4484,30)],
            operational_polygon=build_site_polygon(33.4484, -112.074, radius_meters=800),
        )
    monkeypatch.setattr("app.services.cycle_orchestrator.get_live_environment",fake_environment)
    monkeypatch.setattr("app.services.cycle_orchestrator.create_heat_outlook",fake_outlook)
    monkeypatch.setattr("app.services.cycle_orchestrator.create_spatial_heat",fake_spatial)
    store=InMemoryHeatShieldStateStore(); model=FakeAgentModel([ModelToolCall("propose_cooler_zone_candidate","{}")])
    orchestrator=CycleOrchestrator(store,agent_model=model,clock=lambda:NOW)
    cycle_request=HeatShieldCycleRequest(location=base.heat_outlook.location,worker=base.current_assessment.worker_context,
        task=base.current_assessment.task_context,include_spatial_intelligence=True)
    planned=await orchestrator.plan(cycle_request)
    assert calls["spatial"] == 1 and planned.spatial_heat.status == "available"
    assert store.get_cycle(planned.cycle_id)["response"]["spatial_heat"]["status"] == "available"
    assert model.evidence["spatial"]["top_candidates"][0].keys() == {"candidate_id","temperature_c","cooler_by_c","straight_line_distance_m","inside_operational_boundary"}
    assert model.evidence["spatial"]["boundary_verified_candidate_count"] == 1

    async def failed_spatial(request,*,client,clock): raise RuntimeError("provider detail must not leak")
    monkeypatch.setattr("app.services.cycle_orchestrator.create_spatial_heat",failed_spatial)
    fallback=await orchestrator.plan(cycle_request)
    assert fallback.spatial_heat.status == "insufficient_data"
    assert fallback.current_assessment is not None and fallback.heat_outlook is not None
