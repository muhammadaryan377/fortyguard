"""Server-authoritative validation of model-selected operational tools."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from app.core.config import settings
from app.models.operations import AgentAction, AgentDecisionRequest, AgentDecisionResponse, AgentEvidence, AgentToolTrace
from app.services.agent_model import AGENT_TOOLS, AgentModel, AgentModelError, DeepSeekAgentModel, ModelToolCall

LIMITATIONS = [
    "The model selects only server-defined tools; it does not create environmental facts or controls.",
    "Every proposed action requires explicit human approval before execution.",
    "A cooler sampled period candidate is not a safe-time or continuous-period minimum claim.",
    "This decision is not medical advice or a legal compliance determination.",
]
TOOL_ACTION = {
    "propose_cool_recovery": "cool_recovery",
    "propose_reduce_physical_demands": "reduce_physical_demands",
    "propose_cooler_sampled_period": "consider_cooler_sampled_period",
    "propose_worker_monitoring": "increase_monitoring",
    "propose_limit_direct_sun": "limit_direct_sun",
    "request_supervisor_review": "supervisor_review",
}


def build_agent_evidence(request: AgentDecisionRequest) -> AgentEvidence:
    assessment, outlook = request.current_assessment, request.heat_outlook
    env, screening = assessment.environmental_evidence, assessment.screening
    current = {
        "worker_id": assessment.worker_context.worker_id, "task_id": assessment.task_context.task_id,
        "task_name": assessment.task_context.task_name, "workload_level": assessment.task_context.workload_level.value,
        "exposure_duration_minutes": assessment.task_context.exposure_duration_minutes,
        "acclimatized": assessment.worker_context.acclimatized, "direct_sun": assessment.task_context.direct_sun,
        "temperature_c": env.temperature_c, "provider_heat_index_c": env.heat_index_c,
        "provider_heat_index_f": screening.heat_index_f if screening else None,
        "screening_status": screening.status if screening else None, "screening_band": screening.band if screening else None,
        "data_quality": assessment.data_quality, "contextual_flags": screening.contextual_flags if screening else [],
        "recommended_controls": screening.recommended_controls if screening else [],
        "policy_version": screening.policy_version if screening else assessment.configuration_version,
        "timestamp": env.timestamp,
    }
    available = [{"offset_hours": p.offset_hours, "requested_local_timestamp": p.requested_local_timestamp.isoformat(), "temperature_c": p.temperature_c} for p in outlook.points if p.status == "available"]
    forecast = {
        "outlook_status": outlook.status, "available_samples": available,
        "unavailable_sample_offsets": [p.offset_hours for p in outlook.points if p.status == "unavailable"],
        **outlook.summary.model_dump(mode="json", exclude={"available_points", "total_points"}),
    }
    return AgentEvidence(current=current, forecast=forecast)


def _supported(control_text: list[str], words: tuple[str, ...]) -> bool:
    text = " ".join(control_text).casefold()
    return any(word in text for word in words)


def _eligibility(tool: str, evidence: AgentEvidence) -> tuple[bool, str, dict]:
    current, forecast = evidence.current, evidence.forecast
    controls = current.get("recommended_controls") or []
    flags = current.get("contextual_flags") or []
    if tool == "request_supervisor_review": return True, "supervisor_review_always_permitted", {}
    if tool == "propose_cool_recovery": return _supported(controls, ("shade", "cool", "recovery", "rest")), "deterministic_cooling_control", {}
    if tool == "propose_reduce_physical_demands": return _supported(controls, ("strenuous", "physical demand", "workload", "pace")), "deterministic_physical_demand_control", {}
    if tool == "propose_worker_monitoring": return _supported(controls, ("monitor", "supervis", "buddy")), "deterministic_monitoring_control", {}
    if tool == "propose_limit_direct_sun": return ("direct_sun_exposure" in flags or _supported(controls, ("sun", "radiant"))), "deterministic_direct_sun_control", {}
    if tool == "propose_cooler_sampled_period":
        now_temp = current.get("temperature_c")
        samples = [p for p in forecast.get("available_samples", []) if p.get("temperature_c") is not None]
        if now_temp is None or not samples: return False, "required_temperature_evidence_unavailable", {}
        chosen = min(samples, key=lambda p: (p["temperature_c"], p["requested_local_timestamp"]))
        if chosen["temperature_c"] >= now_temp: return False, "no_strictly_cooler_sampled_period", {}
        return True, "provider_backed_cooler_sample", {**chosen, "current_temperature_c": now_temp, "difference_from_current_c": chosen["temperature_c"] - now_temp}
    return False, "unsupported_tool", {}


async def decide(request: AgentDecisionRequest, *, model: AgentModel | None = None, now: datetime | None = None) -> AgentDecisionResponse:
    evidence = build_agent_evidence(request)
    decision_id, generated = str(uuid4()), (now or datetime.now(UTC)).astimezone(UTC)
    base = dict(decision_id=decision_id, generated_at=generated, model=settings.heatshield_agent_model,
        worker_id=evidence.current["worker_id"], task_id=evidence.current["task_id"],
        current_evidence_summary=evidence.current, forecast_evidence_summary=evidence.forecast,
        policy_version=evidence.current["policy_version"], limitations=LIMITATIONS)
    screening_status = evidence.current.get("screening_status")
    if request.current_assessment.risk_level == "insufficient_data" or screening_status == "insufficient_data":
        return AgentDecisionResponse(status="insufficient_data", actions=[], tool_trace=[], **base)
    try:
        calls = await (model or DeepSeekAgentModel()).select_tools(evidence.model_dump(mode="json"), AGENT_TOOLS)
    except AgentModelError:
        return AgentDecisionResponse(status="agent_unavailable", actions=[], tool_trace=[], **base)
    actions, trace, seen, operational_count = [], [], set(), 0
    for call in calls:
        if call.name in seen:
            trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="duplicate_tool_call")); continue
        seen.add(call.name)
        if call.name not in TOOL_ACTION:
            trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="unsupported_tool")); continue
        try: arguments = json.loads(call.arguments or "{}")
        except (json.JSONDecodeError, TypeError):
            trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="invalid_json_arguments")); continue
        if arguments != {}:
            trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="tool_requires_empty_object")); continue
        action_type = TOOL_ACTION[call.name]
        if action_type != "supervisor_review" and operational_count >= 3:
            trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="operational_action_limit_reached")); continue
        eligible, reason, details = _eligibility(call.name, evidence)
        if not eligible:
            trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason=reason)); continue
        action_id = str(uuid4())
        action = AgentAction(action_id=action_id, action_type=action_type, tool_name=call.name,
            worker_id=evidence.current["worker_id"], task_id=evidence.current["task_id"],
            reason_codes=[reason], evidence_refs=["current_assessment", "heat_outlook"] if details else ["current_assessment"], details=details)
        actions.append(action); trace.append(AgentToolTrace(tool_name=call.name, status="accepted", safe_reason=reason, action_id=action_id))
        if action_type != "supervisor_review": operational_count += 1
    return AgentDecisionResponse(status="decided" if actions else "no_action_selected", actions=actions, tool_trace=trace, **base)
