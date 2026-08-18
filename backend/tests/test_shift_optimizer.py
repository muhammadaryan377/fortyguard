from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.operations import AgentDecisionRequest
from app.models.operations import ApprovalRequest, HeatShieldCycleRequest
from app.models.fortyguard import EnvironmentalConditions
from app.models.optimization import ShiftOptimizationRequest, ShiftTaskPlan
from app.models.prediction import ForecastTemperaturePoint, HeatOutlookSummary, PredictHeatOutlookResponse
from app.models.risk import USSiteLocation, WorkloadLevel
from app.services.agent_decision import decide
from app.services.agent_model import ModelToolCall
from app.services.cycle_orchestrator import CycleOrchestrator
from app.services.shift_optimizer import optimize_shift
from app.services.state_store import InMemoryHeatShieldStateStore
from tests.test_agent_operations import FakeAgentModel, NOW, decision_request


def outlook(values=((1,40.0,"available"),(3,30.0,"available"),(6,None,"unavailable"))):
    loc=USSiteLocation(site_id="S",name="Site",city="Phoenix",state="Arizona",latitude=33.4484,longitude=-112.074)
    points=[]
    for offset,temp,status in values:
        timestamp=NOW+timedelta(hours=offset)
        points.append(ForecastTemperaturePoint(status=status,offset_hours=offset,requested_local_timestamp=timestamp,
            requested_utc_timestamp=timestamp,temperature_c=temp,heatmap_activity_id=f"h{offset}" if temp is not None else None,
            extraction_method="containing_heatmap_feature_value" if temp is not None else None,error_reason="missing" if temp is None else None))
    available=[p for p in points if p.temperature_c is not None]
    summary=HeatOutlookSummary(available_points=len(available),total_points=len(points),
        highest_sampled_temperature_c=max((p.temperature_c for p in available),default=None),
        lowest_sampled_temperature_c=min((p.temperature_c for p in available),default=None),trend="mixed" if len(available)>1 else "insufficient_data")
    return PredictHeatOutlookResponse(status="partial" if len(available)<len(points) else "available",location=loc,
        timezone_name="America/Phoenix",generated_at=NOW,forecast_horizon_hours=max(p.offset_hours for p in points),
        sample_offsets_hours=[p.offset_hours for p in points],points=points,summary=summary,limitations=[])


def task(task_id="A",duration=120,current=1,flexible=True,allowed=None,follows=None):
    return ShiftTaskPlan(task_id=task_id,task_name=f"Task {task_id}",duration_minutes=duration,
        current_planned_offset_hours=current,flexible=flexible,allowed_offset_hours=allowed,
        workload_level=WorkloadLevel.HEAVY,direct_sun=True,must_follow_task_ids=follows or [])


def request(tasks=None,heat=None,**values):
    return ShiftOptimizationRequest(worker_id="W",heat_outlook=heat or outlook(),tasks=[task()] if tasks is None else tasks,**values)


def test_optimizer_endpoint_registered(): assert "/api/optimize/shift" in app.openapi()["paths"]


@pytest.mark.parametrize("tasks", [[], [task(str(i)) for i in range(7)]])
def test_task_count_limits(tasks):
    with pytest.raises(ValidationError): request(tasks=tasks)


@pytest.mark.parametrize("values", [{"duration_minutes":14},{"duration_minutes":361},{"current_planned_offset_hours":0},{"current_planned_offset_hours":13}])
def test_task_field_bounds(values):
    with pytest.raises(ValidationError): ShiftTaskPlan(task_id="A",task_name="A",workload_level="heavy",**values)


def test_allowed_offsets_and_dependencies_validation():
    with pytest.raises(ValidationError): task(allowed=[1,1])
    with pytest.raises(ValidationError): task(follows=["A"])
    with pytest.raises(ValidationError): request(tasks=[task("A",follows=["MISSING"])])
    with pytest.raises(ValidationError): request(tasks=[task("A",follows=["B"]),task("B",follows=["A"])])


def test_only_available_exact_samples_used_without_interpolation():
    result=optimize_shift(request(tasks=[task(allowed=[1,3,6])]),now=NOW)
    assert result.sample_offsets_considered == [1,3]
    assert {a.candidate_offset_hours for c in result.candidates for a in c.assignments} <= {1,3}


def test_fixed_unavailable_slot_and_no_forecast_statuses():
    no_fixed=optimize_shift(request(tasks=[task(current=6,flexible=False)]),now=NOW)
    assert no_fixed.status == "no_feasible_plan"
    empty=optimize_shift(request(heat=outlook(((1,None,"unavailable"),))),now=NOW)
    assert empty.status == "insufficient_forecast"


def test_touching_intervals_allowed_and_overlap_rejected():
    touching=optimize_shift(request(tasks=[task("A",duration=120,current=1,flexible=False),task("B",duration=60,current=3,flexible=False)]),now=NOW)
    assert touching.current_plan.status == "available" and touching.best_candidate is not None
    overlap=optimize_shift(request(tasks=[task("A",duration=180,current=1,flexible=False),task("B",duration=60,current=3,flexible=False)]),now=NOW)
    assert overlap.status == "no_feasible_plan" and overlap.current_plan.status == "unavailable"


def test_dependency_ordering_enforced():
    result=optimize_shift(request(tasks=[task("A",duration=120,current=1),task("B",duration=60,current=3,follows=["A"])]),now=NOW)
    assert all(c.assignments[1].sampled_utc_start_timestamp >= c.assignments[0].sampled_utc_start_timestamp+timedelta(minutes=120) for c in result.candidates)


def test_metrics_improvement_and_ranking_are_deterministic():
    req=request(tasks=[task("A",duration=120,current=1),task("B",duration=60,current=3)])
    first=optimize_shift(req,now=NOW); second=optimize_shift(req,now=NOW)
    assert first.current_plan.sampled_temperature_minutes_index == 6600
    assert first.best_candidate.sampled_temperature_minutes_index == 6000
    assert first.best_candidate.duration_weighted_sampled_start_temperature_c == pytest.approx(33.3333333333)
    assert first.best_candidate.total_schedule_movement_hours == 4
    assert first.status == "available"
    assert first.model_dump(mode="json") == second.model_dump(mode="json")


def test_no_better_and_baseline_unavailable_comparisons():
    best=optimize_shift(request(tasks=[task(current=3)]),now=NOW)
    assert best.status == "no_better_plan"
    unavailable=optimize_shift(request(tasks=[task(current=6,flexible=True)]),now=NOW)
    assert unavailable.status == "available" and unavailable.current_plan.status == "unavailable"
    assert unavailable.best_candidate.difference_vs_current_temperature_minutes_index is None
    assert unavailable.best_candidate.is_strictly_lower_temperature_index_than_current is None


def test_max_alternatives_and_safe_language():
    result=optimize_shift(request(max_alternatives=1),now=NOW)
    assert len(result.candidates) == 1
    body=result.model_dump_json().lower()
    assert "safe schedule" not in body and "risk reduction" not in body and "wbgt forecast" not in body
    assert "sampled start" in body


@pytest.mark.asyncio
async def test_eighth_tool_server_selects_best_and_rejects_arguments_or_missing_evidence():
    base=decision_request(); optimization=optimize_shift(request(tasks=[task("A",120,1),task("B",60,3)]),now=NOW)
    agent_request=AgentDecisionRequest(current_assessment=base.current_assessment,heat_outlook=base.heat_outlook,shift_optimization=optimization)
    accepted=await decide(agent_request,model=FakeAgentModel([ModelToolCall("propose_shift_plan_candidate","{}")]),now=NOW)
    assert accepted.actions[0].action_type == "consider_shift_plan"
    assert accepted.actions[0].details["sampled_temperature_minutes_index"] == optimization.best_candidate.sampled_temperature_minutes_index
    rejected=await decide(agent_request,model=FakeAgentModel([ModelToolCall("propose_shift_plan_candidate",'{"offset":12}')]),now=NOW)
    assert rejected.actions == []
    missing=await decide(base,model=FakeAgentModel([ModelToolCall("propose_shift_plan_candidate","{}")]),now=NOW)
    assert missing.actions == [] and missing.tool_trace[0].safe_reason == "shift_plan_candidate_unavailable"


def test_shift_act_record_preserves_validated_plan_without_external_claim():
    details={"candidate_rank":1,"assignments":[{"task_id":"A","candidate_offset_hours":3}],"sampled_temperature_minutes_index":3600.0}
    record=CycleOrchestrator._execute({"action_id":"A1","action_type":"consider_shift_plan","details":details})
    assert record["record_type"] == "shift_plan_candidate" and record["state"] == "approved_candidate"
    assert record["validated_shift_plan_candidate"] == details
    assert "calendar" not in str(record).lower() and "implemented" not in str(record).lower()


@pytest.mark.asyncio
async def test_cycle_optimizer_runs_once_reuses_outlook_persists_and_verifies(monkeypatch):
    base=decision_request(); calls={"sense":0,"predict":0,"optimize":0}
    async def fake_environment(location,date_time,*,client):
        calls["sense"]+=1; return EnvironmentalConditions(timestamp=NOW.isoformat(),temperature_c=40,heat_index_c=35)
    async def fake_outlook(request,*,client,now): calls["predict"]+=1; return base.heat_outlook
    real_optimize=optimize_shift
    def counted_optimize(request,*,now): calls["optimize"]+=1; return real_optimize(request,now=now)
    monkeypatch.setattr("app.services.cycle_orchestrator.get_live_environment",fake_environment)
    monkeypatch.setattr("app.services.cycle_orchestrator.create_heat_outlook",fake_outlook)
    monkeypatch.setattr("app.services.cycle_orchestrator.optimize_shift",counted_optimize)
    store=InMemoryHeatShieldStateStore(); model=FakeAgentModel([ModelToolCall("propose_shift_plan_candidate","{}")])
    orchestrator=CycleOrchestrator(store,agent_model=model,clock=lambda:NOW)
    cycle_request=HeatShieldCycleRequest(location=base.heat_outlook.location,worker=base.current_assessment.worker_context,
        task=base.current_assessment.task_context,include_shift_optimization=True,
        shift_tasks=[task("A",duration=60,current=1)])
    planned=await orchestrator.plan(cycle_request)
    assert calls == {"sense":1,"predict":1,"optimize":1}
    assert planned.shift_optimization.best_candidate is not None
    assert store.get_cycle(planned.cycle_id)["response"]["shift_optimization"] is not None
    assert model.evidence["shift_optimization"]["best_candidate"] is not None
    action=planned.agent_decision.actions[0]
    approved=orchestrator.approve(planned.cycle_id,ApprovalRequest(supervisor_id="SUP",action_ids=[action.action_id]))
    assert approved.results[0].operational_record["record_type"] == "shift_plan_candidate"
    verified=await orchestrator.verify(planned.cycle_id)
    assert verified.verified_action_count == 1
    assert any("does not verify tasks moved" in item for item in verified.limitations)


@pytest.mark.asyncio
async def test_cycle_optimizer_failure_isolated_and_disabled_does_not_run(monkeypatch):
    base=decision_request(); calls={"optimize":0}
    async def fake_environment(location,date_time,*,client): return EnvironmentalConditions(timestamp=NOW.isoformat(),temperature_c=40,heat_index_c=35)
    async def fake_outlook(request,*,client,now): return base.heat_outlook
    def failed_optimizer(request,*,now): calls["optimize"]+=1; raise RuntimeError("internal search failure")
    monkeypatch.setattr("app.services.cycle_orchestrator.get_live_environment",fake_environment)
    monkeypatch.setattr("app.services.cycle_orchestrator.create_heat_outlook",fake_outlook)
    monkeypatch.setattr("app.services.cycle_orchestrator.optimize_shift",failed_optimizer)
    orchestrator=CycleOrchestrator(InMemoryHeatShieldStateStore(),agent_model=FakeAgentModel([]),clock=lambda:NOW)
    common=dict(location=base.heat_outlook.location,worker=base.current_assessment.worker_context,task=base.current_assessment.task_context)
    disabled=await orchestrator.plan(HeatShieldCycleRequest(**common))
    assert calls["optimize"] == 0 and disabled.shift_optimization is None
    enabled=await orchestrator.plan(HeatShieldCycleRequest(**common,include_shift_optimization=True,shift_tasks=[task()]))
    assert calls["optimize"] == 1 and enabled.shift_optimization.status == "no_feasible_plan"
    assert enabled.current_assessment is not None and enabled.heat_outlook is not None
