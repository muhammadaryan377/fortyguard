from datetime import UTC, datetime

import pytest

from app.models.fortyguard import EnvironmentalConditions
from app.models.operations import AgentDecisionRequest
from app.models.prediction import (
    ForecastTemperaturePoint,
    HeatOutlookSummary,
    PredictHeatOutlookResponse,
)
from app.models.risk import (
    TaskContext,
    USSiteLocation,
    WorkerContext,
    WorkloadLevel,
)
from app.services.agent_decision import decide
from app.services.agent_model import ModelToolCall
from app.services.risk_engine import assess_risk


NOW = datetime(2026, 8, 18, 17, 0, tzinfo=UTC)


class CapturingAgentModel:
    def __init__(self, calls=None):
        self.calls = calls or []
        self.evidence = None
        self.tools = None

    async def select_tools(self, evidence, tools):
        self.evidence = evidence
        self.tools = tools
        return self.calls


def request_with_evidence(*, direct_sun=True, future=(34.0, 30.0)) -> AgentDecisionRequest:
    worker = WorkerContext(worker_id="W1", site_id="S1", acclimatized=False)
    task = TaskContext(task_id="T1", task_name="roof", workload_level=WorkloadLevel.HEAVY,
        exposure_duration_minutes=120, outdoor=True, direct_sun=direct_sun)
    environment = EnvironmentalConditions(timestamp=NOW.isoformat(), temperature_c=40.0,
        heat_index_c=35.0, wet_bulb_temperature_c=25.0, relative_humidity=42.0)
    assessment = assess_risk(environment, worker, task, now=NOW)
    location = USSiteLocation(site_id="S1", name="Site", city="Phoenix", state="Arizona",
        latitude=33.4484, longitude=-112.074)
    points = [ForecastTemperaturePoint(status="available", offset_hours=offset,
        requested_local_timestamp=NOW, requested_utc_timestamp=NOW, temperature_c=temperature,
        heatmap_activity_id=f"a{offset}", extraction_method="containing_heatmap_feature_value")
        for offset, temperature in zip((1, 3), future)]
    summary = HeatOutlookSummary(available_points=2, total_points=2,
        highest_sampled_temperature_c=max(future),
        highest_sampled_offset_hours=(1, 3)[future.index(max(future))],
        highest_sampled_local_timestamp=NOW, lowest_sampled_temperature_c=min(future),
        lowest_sampled_offset_hours=(1, 3)[future.index(min(future))],
        first_to_last_temperature_change_c=future[-1] - future[0],
        trend="falling" if future[1] < future[0] else "rising")
    outlook = PredictHeatOutlookResponse(status="available", location=location,
        timezone_name="America/Phoenix", generated_at=NOW, forecast_horizon_hours=3,
        sample_offsets_hours=[1, 3], points=points, summary=summary, limitations=[])
    return AgentDecisionRequest(current_assessment=assessment, heat_outlook=outlook)


@pytest.mark.asyncio
async def test_model_receives_only_deterministically_eligible_tools():
    model = CapturingAgentModel()
    response = await decide(request_with_evidence(direct_sun=False, future=(40.0, 41.0)),
        model=model, now=NOW)
    visible_tools = {item["function"]["name"] for item in model.tools}
    assert "propose_limit_direct_sun" not in visible_tools
    assert "propose_cooler_sampled_period" not in visible_tools
    assert "request_supervisor_review" in visible_tools
    hidden = {item.tool_name for item in response.eligibility_trace if not item.eligible}
    assert "propose_limit_direct_sun" in hidden


@pytest.mark.asyncio
async def test_reasoning_summary_is_structured_and_provider_backed():
    model = CapturingAgentModel([ModelToolCall("propose_cooler_sampled_period", "{}")])
    response = await decide(request_with_evidence(), model=model, now=NOW)
    summary = response.reasoning_summary
    assert summary.thermal_interpretation and summary.guardrails and summary.evidence_signals
    assert "consider_cooler_sampled_period" in summary.selected_action_types
    assert any(item.signal == "provider_temperature" for item in summary.evidence_signals)
    assert any(item.signal == "wet_bulb_context" for item in summary.evidence_signals)
    assert "WBGT" in summary.thermal_interpretation


@pytest.mark.asyncio
async def test_server_revalidates_model_calls_even_if_model_ignores_firewall():
    model = CapturingAgentModel([ModelToolCall("propose_cooler_sampled_period", "{}")])
    response = await decide(request_with_evidence(future=(40.0, 41.0)), model=model, now=NOW)
    assert response.actions == []
    assert response.status == "no_action_selected"
    assert response.tool_trace[0].safe_reason == "no_strictly_cooler_sampled_period"
