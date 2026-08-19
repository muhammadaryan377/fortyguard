"""Server-authoritative validation of model-selected operational tools."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from app.core.config import settings
from app.models.operations import AgentAction, AgentDecisionRequest, AgentDecisionResponse, AgentEvidence, AgentToolTrace
from app.models.prediction import PredictHeatOutlookResponse
from app.models.risk import RiskAssessment
from app.services.agent_model import AGENT_TOOLS, AgentModel, AgentModelError, DeepSeekAgentModel, ModelToolCall

LIMITATIONS = [
    "The model selects only server-defined tools; it does not create environmental facts or controls.",
    "Every proposed action requires explicit human approval before execution.",
    "A cooler sampled period candidate is not a safe-time or continuous-period minimum claim.",
    "This decision is not medical advice or a legal compliance determination.",
    "The direct agent endpoint validates typed evidence but does not independently prove its provenance. Use the HeatShield cycle/site orchestration paths when provider-fetched evidence integrity is required.",
]
TOOL_ACTION = {
    "propose_cool_recovery": "cool_recovery",
    "propose_reduce_physical_demands": "reduce_physical_demands",
    "propose_cooler_sampled_period": "consider_cooler_sampled_period",
    "propose_worker_monitoring": "increase_monitoring",
    "propose_limit_direct_sun": "limit_direct_sun",
    "request_supervisor_review": "supervisor_review",
    "propose_cooler_zone_candidate": "consider_cooler_zone",
    "propose_shift_plan_candidate": "consider_shift_plan",
}
CAPABILITY_LABELS = {
    "propose_cool_recovery": "cool_recovery",
    "propose_reduce_physical_demands": "reduce_physical_demands",
    "propose_cooler_sampled_period": "cooler_sampled_period",
    "propose_worker_monitoring": "worker_monitoring",
    "propose_limit_direct_sun": "limit_direct_sun",
    "request_supervisor_review": "supervisor_review",
    "propose_cooler_zone_candidate": "cooler_zone",
    "propose_shift_plan_candidate": "shift_plan",
}
ACTION_EVIDENCE_REFS = {
    "cool_recovery": ["current_assessment"],
    "reduce_physical_demands": ["current_assessment"],
    "increase_monitoring": ["current_assessment"],
    "limit_direct_sun": ["current_assessment"],
    "consider_cooler_sampled_period": ["current_assessment", "heat_outlook"],
    "consider_cooler_zone": ["current_assessment", "spatial_heat"],
    "consider_shift_plan": ["current_assessment", "heat_outlook", "shift_optimization"],
    "supervisor_review": ["current_assessment"],
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
    spatial = None
    if request.spatial_heat is not None:
        spatial = {
            "spatial_status": request.spatial_heat.status,
            "site_temperature_c": request.spatial_heat.site_reference.site_temperature_c,
            "top_candidates": [
                {"candidate_id": c.candidate_id, "temperature_c": c.temperature_c,
                 "cooler_by_c": c.cooler_by_c, "straight_line_distance_m": c.straight_line_distance_m}
                for c in request.spatial_heat.candidates
            ],
        }
    optimization = None
    if request.shift_optimization is not None:
        best = request.shift_optimization.best_candidate
        optimization = {
            "shift_optimization_status": request.shift_optimization.status,
            "current_plan_status": request.shift_optimization.current_plan.status,
            "best_candidate": None if best is None else {
                "rank": best.rank,
                "sampled_temperature_minutes_index": best.sampled_temperature_minutes_index,
                "duration_weighted_sampled_start_temperature_c": best.duration_weighted_sampled_start_temperature_c,
                "total_schedule_movement_hours": best.total_schedule_movement_hours,
                "difference_vs_current_temperature_minutes_index": best.difference_vs_current_temperature_minutes_index,
                "difference_vs_current_weighted_start_temperature_c": best.difference_vs_current_weighted_start_temperature_c,
                "assignments": [{"task_id": a.task_id, "candidate_offset_hours": a.candidate_offset_hours,
                    "sampled_local_start_timestamp": a.sampled_local_start_timestamp.isoformat(),
                    "sampled_start_temperature_c": a.sampled_start_temperature_c} for a in best.assignments],
            },
        }
    return AgentEvidence(current=current, forecast=forecast, spatial=spatial, shift_optimization=optimization)


def _supported(control_text: list[str], words: tuple[str, ...]) -> bool:
    text = " ".join(control_text).casefold()
    return any(word in text for word in words)


def _eligibility(tool: str, evidence: AgentEvidence, spatial_heat=None, shift_optimization=None) -> tuple[bool, str, dict]:
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
    if tool == "propose_cooler_zone_candidate":
        candidates = spatial_heat.candidates if spatial_heat is not None and spatial_heat.status == "available" else []
        if not candidates: return False, "spatial_candidate_unavailable", {}
        chosen = sorted(candidates, key=lambda item: item.rank)[0]
        return True, "provider_backed_cooler_zone_candidate", {
            "candidate_id": chosen.candidate_id, "temperature_c": chosen.temperature_c,
            "cooler_by_c": chosen.cooler_by_c, "centroid_latitude": chosen.centroid_latitude,
            "centroid_longitude": chosen.centroid_longitude,
            "straight_line_distance_m": chosen.straight_line_distance_m,
            "label": "cooler zone candidate",
        }
    if tool == "propose_shift_plan_candidate":
        best = shift_optimization.best_candidate if shift_optimization is not None else None
        if best is None: return False, "shift_plan_candidate_unavailable", {}
        if shift_optimization.current_plan.status == "available":
            if not best.is_strictly_lower_temperature_index_than_current:
                return False, "no_strictly_lower_sampled_temperature_index", {}
            reason = "lower_sampled_temperature_index_than_current_plan"
        else:
            reason = "feasible_candidate_without_valid_current_baseline"
        return True, reason, {
            "candidate_rank": best.rank,
            "assignments": [assignment.model_dump(mode="json") for assignment in best.assignments],
            "sampled_temperature_minutes_index": best.sampled_temperature_minutes_index,
            "duration_weighted_sampled_start_temperature_c": best.duration_weighted_sampled_start_temperature_c,
            "total_schedule_movement_hours": best.total_schedule_movement_hours,
            "difference_vs_current_temperature_minutes_index": best.difference_vs_current_temperature_minutes_index,
            "current_plan_status": shift_optimization.current_plan.status,
            "label": "sampled-temperature schedule candidate",
        }
    return False, "unsupported_tool", {}


def available_agent_capabilities(assessment: RiskAssessment, outlook: PredictHeatOutlookResponse | None,
                                 spatial_heat=None, shift_optimization=None) -> list[str]:
    """Preview existing tool categories without invoking an agent model."""
    if outlook is not None:
        evidence = build_agent_evidence(AgentDecisionRequest(current_assessment=assessment,
            heat_outlook=outlook, spatial_heat=spatial_heat, shift_optimization=shift_optimization))
    else:
        screen = assessment.screening
        evidence = AgentEvidence(current={
            "recommended_controls": screen.recommended_controls if screen else [],
            "contextual_flags": screen.contextual_flags if screen else [],
            "temperature_c": assessment.environmental_evidence.temperature_c,
        }, forecast={"available_samples": []})
    return [CAPABILITY_LABELS[tool] for tool in TOOL_ACTION
            if _eligibility(tool, evidence, spatial_heat, shift_optimization)[0]]


async def decide(request: AgentDecisionRequest, *, model: AgentModel | None = None, now: datetime | None = None) -> AgentDecisionResponse:
    evidence = build_agent_evidence(request)
    decision_id, generated = str(uuid4()), (now or datetime.now(UTC)).astimezone(UTC)
    base = dict(decision_id=decision_id, generated_at=generated, model=settings.heatshield_agent_model,
        worker_id=evidence.current["worker_id"], task_id=evidence.current["task_id"],
        current_evidence_summary=evidence.current, forecast_evidence_summary=evidence.forecast,
        spatial_evidence_summary=evidence.spatial,
        shift_optimization_evidence_summary=evidence.shift_optimization,
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
        eligible, reason, details = _eligibility(call.name, evidence, request.spatial_heat, request.shift_optimization)
        if not eligible:
            trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason=reason)); continue
        action_id = str(uuid4())
        action = AgentAction(action_id=action_id, action_type=action_type, tool_name=call.name,
            worker_id=evidence.current["worker_id"], task_id=evidence.current["task_id"],
            reason_codes=[reason], evidence_refs=ACTION_EVIDENCE_REFS[action_type], details=details)
        actions.append(action); trace.append(AgentToolTrace(tool_name=call.name, status="accepted", safe_reason=reason, action_id=action_id))
        if action_type != "supervisor_review": operational_count += 1
    return AgentDecisionResponse(status="decided" if actions else "no_action_selected", actions=actions, tool_trace=trace, **base)
