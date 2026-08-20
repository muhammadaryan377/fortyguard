"""Bounded, explainable HeatShield tool selection with server-side safety checks."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from app.core.config import settings
from app.models.operations import (
    AgentAction, AgentDecisionRequest, AgentDecisionResponse, AgentEligibilityTrace,
    AgentEvidence, AgentEvidenceSignal, AgentReasoningSummary, AgentToolTrace,
)
from app.models.prediction import PredictHeatOutlookResponse
from app.models.risk import RiskAssessment
from app.services.agent_model import AGENT_TOOLS, AgentModel, AgentModelError, DeepSeekAgentModel

LIMITATIONS = [
    "The model selects only server-defined, deterministic-eligible tools and never creates environmental facts.",
    "Every proposed action requires explicit human approval before execution.",
    "A cooler sampled period or spatial tile is comparative provider evidence, not a safe-time or safe-zone claim.",
    "Wet-bulb temperature is not WBGT and is never evaluated as WBGT.",
    "VERIFY observes fresh evidence but does not prove action causality.",
    "The direct agent endpoint validates typed evidence but does not independently prove its provenance. Use the HeatShield cycle/site orchestration paths when provider-fetched evidence integrity is required.",
    "This decision is not medical advice or a legal compliance determination.",
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
    "propose_cool_recovery": "cool_recovery", "propose_reduce_physical_demands": "reduce_physical_demands",
    "propose_cooler_sampled_period": "cooler_sampled_period", "propose_worker_monitoring": "worker_monitoring",
    "propose_limit_direct_sun": "limit_direct_sun", "request_supervisor_review": "supervisor_review",
    "propose_cooler_zone_candidate": "cooler_zone", "propose_shift_plan_candidate": "shift_plan",
}
ACTION_EVIDENCE_REFS = {
    "cool_recovery": ["current_assessment"], "reduce_physical_demands": ["current_assessment"],
    "increase_monitoring": ["current_assessment"], "limit_direct_sun": ["current_assessment"],
    "consider_cooler_sampled_period": ["current_assessment", "heat_outlook"],
    "consider_cooler_zone": ["current_assessment", "spatial_heat"],
    "consider_shift_plan": ["current_assessment", "heat_outlook", "shift_optimization"],
    "supervisor_review": ["current_assessment"],
}
GUARDRAILS = [
    "Only deterministic-eligible tools are exposed to the model.",
    "Every model tool call is revalidated after selection.",
    "The model cannot invent temperatures, thresholds, coordinates, schedules, or worker facts.",
    "At most three operational actions plus supervisor review are accepted.",
    "ACT remains human-gated and creates auditable internal operational state.",
]


def build_agent_evidence(request: AgentDecisionRequest) -> AgentEvidence:
    a, o = request.current_assessment, request.heat_outlook
    env, screen = a.environmental_evidence, a.screening
    current = {
        "worker_id": a.worker_context.worker_id, "task_id": a.task_context.task_id,
        "task_name": a.task_context.task_name, "workload_level": a.task_context.workload_level.value,
        "exposure_duration_minutes": a.task_context.exposure_duration_minutes,
        "acclimatized": a.worker_context.acclimatized, "direct_sun": a.task_context.direct_sun,
        "temperature_c": env.temperature_c, "provider_heat_index_c": env.heat_index_c,
        "provider_heat_index_f": screen.heat_index_f if screen else None,
        "apparent_temperature_c": env.apparent_temperature_c,
        "wet_bulb_temperature_c": env.wet_bulb_temperature_c,
        "relative_humidity_percent": env.relative_humidity,
        "screening_status": screen.status if screen else None, "screening_band": screen.band if screen else None,
        "data_quality": a.data_quality, "contextual_flags": screen.contextual_flags if screen else [],
        "recommended_controls": screen.recommended_controls if screen else [],
        "policy_version": screen.policy_version if screen else a.configuration_version, "timestamp": env.timestamp,
    }
    samples = [{"offset_hours": p.offset_hours, "requested_local_timestamp": p.requested_local_timestamp.isoformat(),
                "temperature_c": p.temperature_c} for p in o.points if p.status == "available"]
    forecast = {"outlook_status": o.status, "available_samples": samples,
                "unavailable_sample_offsets": [p.offset_hours for p in o.points if p.status == "unavailable"],
                **o.summary.model_dump(mode="json", exclude={"available_points", "total_points"})}
    spatial = None
    if request.spatial_heat is not None:
        spatial = {"spatial_status": request.spatial_heat.status,
                   "site_temperature_c": request.spatial_heat.site_reference.site_temperature_c,
                   "top_candidates": [{"candidate_id": c.candidate_id, "temperature_c": c.temperature_c,
                                       "cooler_by_c": c.cooler_by_c, "straight_line_distance_m": c.straight_line_distance_m}
                                      for c in request.spatial_heat.candidates]}
    optimization = None
    if request.shift_optimization is not None:
        best = request.shift_optimization.best_candidate
        optimization = {"shift_optimization_status": request.shift_optimization.status,
                        "current_plan_status": request.shift_optimization.current_plan.status,
                        "best_candidate": None if best is None else {
                            "rank": best.rank, "sampled_temperature_minutes_index": best.sampled_temperature_minutes_index,
                            "duration_weighted_sampled_start_temperature_c": best.duration_weighted_sampled_start_temperature_c,
                            "total_schedule_movement_hours": best.total_schedule_movement_hours,
                            "difference_vs_current_temperature_minutes_index": best.difference_vs_current_temperature_minutes_index,
                            "assignments": [{"task_id": x.task_id, "candidate_offset_hours": x.candidate_offset_hours,
                                             "sampled_local_start_timestamp": x.sampled_local_start_timestamp.isoformat(),
                                             "sampled_start_temperature_c": x.sampled_start_temperature_c} for x in best.assignments]}}
    return AgentEvidence(current=current, forecast=forecast, spatial=spatial, shift_optimization=optimization)


def _supported(controls: list[str], words: tuple[str, ...]) -> bool:
    text = " ".join(controls).casefold()
    return any(word in text for word in words)


def _eligibility(tool: str, evidence: AgentEvidence, spatial=None, optimization=None):
    c, f = evidence.current, evidence.forecast
    controls, flags = c.get("recommended_controls") or [], c.get("contextual_flags") or []
    if tool == "request_supervisor_review": return True, "supervisor_review_always_permitted", {}
    if tool == "propose_cool_recovery": return _supported(controls, ("shade", "cool", "recovery", "rest")), "deterministic_cooling_control", {}
    if tool == "propose_reduce_physical_demands": return _supported(controls, ("strenuous", "physical demand", "workload", "pace")), "deterministic_physical_demand_control", {}
    if tool == "propose_worker_monitoring": return _supported(controls, ("monitor", "supervis", "buddy")), "deterministic_monitoring_control", {}
    if tool == "propose_limit_direct_sun": return ("direct_sun_exposure" in flags or _supported(controls, ("sun", "radiant"))), "deterministic_direct_sun_control", {}
    if tool == "propose_cooler_sampled_period":
        now, samples = c.get("temperature_c"), [p for p in f.get("available_samples", []) if p.get("temperature_c") is not None]
        if now is None or not samples: return False, "required_temperature_evidence_unavailable", {}
        chosen = min(samples, key=lambda p: (p["temperature_c"], p["requested_local_timestamp"]))
        if chosen["temperature_c"] >= now: return False, "no_strictly_cooler_sampled_period", {}
        return True, "provider_backed_cooler_sample", {**chosen, "current_temperature_c": now,
                                                        "difference_from_current_c": chosen["temperature_c"] - now}
    if tool == "propose_cooler_zone_candidate":
        candidates = spatial.candidates if spatial is not None and spatial.status == "available" else []
        if not candidates: return False, "spatial_candidate_unavailable", {}
        x = sorted(candidates, key=lambda item: item.rank)[0]
        return True, "provider_backed_cooler_zone_candidate", {
            "candidate_id": x.candidate_id, "temperature_c": x.temperature_c, "cooler_by_c": x.cooler_by_c,
            "centroid_latitude": x.centroid_latitude, "centroid_longitude": x.centroid_longitude,
            "straight_line_distance_m": x.straight_line_distance_m, "label": "cooler zone candidate"}
    if tool == "propose_shift_plan_candidate":
        best = optimization.best_candidate if optimization is not None else None
        if best is None: return False, "shift_plan_candidate_unavailable", {}
        if optimization.current_plan.status == "available" and not best.is_strictly_lower_temperature_index_than_current:
            return False, "no_strictly_lower_sampled_temperature_index", {}
        reason = "lower_sampled_temperature_index_than_current_plan" if optimization.current_plan.status == "available" else "feasible_candidate_without_valid_current_baseline"
        return True, reason, {"candidate_rank": best.rank, "assignments": [a.model_dump(mode="json") for a in best.assignments],
                              "sampled_temperature_minutes_index": best.sampled_temperature_minutes_index,
                              "duration_weighted_sampled_start_temperature_c": best.duration_weighted_sampled_start_temperature_c,
                              "total_schedule_movement_hours": best.total_schedule_movement_hours,
                              "difference_vs_current_temperature_minutes_index": best.difference_vs_current_temperature_minutes_index,
                              "current_plan_status": optimization.current_plan.status, "label": "sampled-temperature schedule candidate"}
    return False, "unsupported_tool", {}


def _eligibility_trace(evidence: AgentEvidence, request: AgentDecisionRequest):
    return [AgentEligibilityTrace(tool_name=tool, action_type=TOOL_ACTION[tool], eligible=ok, safe_reason=reason,
                                  evidence_refs=ACTION_EVIDENCE_REFS[TOOL_ACTION[tool]], preview_details=details)
            for tool in TOOL_ACTION
            for ok, reason, details in [_eligibility(tool, evidence, request.spatial_heat, request.shift_optimization)]]


def _reasoning(e: AgentEvidence, trace, actions, extra=None) -> AgentReasoningSummary:
    c, f = e.current, e.forecast
    band, quality = c.get("screening_band"), c.get("data_quality")
    urgency = {"below_caution": "monitor", "caution": "elevated", "extreme_caution": "high",
               "danger": "critical", "extreme_danger": "critical"}.get(band, "unknown")
    confidence = "high" if quality == "good" and c.get("screening_status") == "available" else "medium" if quality in {"good", "partial"} else "low"
    signals = []
    def add(name, source, value, implication, certainty="high"):
        if value is not None: signals.append(AgentEvidenceSignal(signal=name, source=source, value=value, implication=implication, confidence=certainty))
    add("provider_temperature", "FortyGuard heatmap", c.get("temperature_c"), "Observed provider temperature at the selected site.")
    add("provider_heat_index", "FortyGuard environmental parameters", c.get("provider_heat_index_c"), "Provider Heat Index feeds deterministic screening.")
    add("wet_bulb_context", "FortyGuard environmental parameters", c.get("wet_bulb_temperature_c"), "Wet-bulb is contextual evidence and is not WBGT.", "medium")
    add("relative_humidity", "FortyGuard environmental parameters", c.get("relative_humidity_percent"), "Humidity is retained as measured context.")
    add("screening_band", "HeatShield deterministic screening", band, "Policy screening constrains eligible controls.")
    add("sampled_outlook", "FortyGuard forecast samples", f.get("trend"), "Future samples may support comparative timing candidates.", "medium")
    thermal = []
    if c.get("temperature_c") is not None: thermal.append(f"Provider temperature is {c['temperature_c']:.1f}°C.")
    if c.get("provider_heat_index_c") is not None: thermal.append(f"Provider Heat Index is {c['provider_heat_index_c']:.1f}°C.")
    if band: thermal.append(f"Deterministic Heat Index screening is {band.replace('_', ' ')}.")
    if c.get("wet_bulb_temperature_c") is not None: thermal.append(f"Wet-bulb is {c['wet_bulb_temperature_c']:.1f}°C and is not interpreted as WBGT.")
    uncertainty = [] if quality == "good" else [f"Evidence quality is {quality or 'unknown'}." ]
    if not f.get("available_samples"): uncertainty.append("No future provider temperature samples were available.")
    uncertainty.extend(extra or [])
    return AgentReasoningSummary(
        objective="Reduce or better manage heat exposure using provider evidence, deterministic eligibility, bounded AI selection, human approval, and verification.",
        urgency=urgency, evidence_confidence=confidence,
        thermal_interpretation=" ".join(thermal) or "Thermal interpretation is limited by incomplete evidence.",
        evidence_signals=signals, eligible_action_types=[x.action_type for x in trace if x.eligible],
        selected_action_types=[x.action_type for x in actions], guardrails=GUARDRAILS,
        uncertainty=uncertainty + ["Fresh verification does not establish action causality."],
    )


def available_agent_capabilities(assessment: RiskAssessment, outlook: PredictHeatOutlookResponse | None, spatial_heat=None, shift_optimization=None) -> list[str]:
    if outlook is None:
        screen = assessment.screening
        evidence = AgentEvidence(current={"recommended_controls": screen.recommended_controls if screen else [],
                                          "contextual_flags": screen.contextual_flags if screen else [],
                                          "temperature_c": assessment.environmental_evidence.temperature_c}, forecast={"available_samples": []})
    else:
        evidence = build_agent_evidence(AgentDecisionRequest(current_assessment=assessment, heat_outlook=outlook,
                                                             spatial_heat=spatial_heat, shift_optimization=shift_optimization))
    return [CAPABILITY_LABELS[t] for t in TOOL_ACTION if _eligibility(t, evidence, spatial_heat, shift_optimization)[0]]


async def decide(request: AgentDecisionRequest, *, model: AgentModel | None = None, now: datetime | None = None) -> AgentDecisionResponse:
    evidence, decision_id = build_agent_evidence(request), str(uuid4())
    trace = _eligibility_trace(evidence, request)
    base = dict(decision_id=decision_id, generated_at=(now or datetime.now(UTC)).astimezone(UTC), model=settings.heatshield_agent_model,
                worker_id=evidence.current["worker_id"], task_id=evidence.current["task_id"], eligibility_trace=trace,
                current_evidence_summary=evidence.current, forecast_evidence_summary=evidence.forecast,
                spatial_evidence_summary=evidence.spatial, shift_optimization_evidence_summary=evidence.shift_optimization,
                policy_version=evidence.current["policy_version"], limitations=LIMITATIONS)
    def result(status, actions=None, tool_trace=None, extra=None):
        actions, tool_trace = actions or [], tool_trace or []
        return AgentDecisionResponse(status=status, actions=actions, tool_trace=tool_trace,
                                     reasoning_summary=_reasoning(evidence, trace, actions, extra), **base)
    if request.current_assessment.risk_level == "insufficient_data" or evidence.current.get("screening_status") == "insufficient_data":
        return result("insufficient_data", extra=["Model was not called because deterministic evidence was insufficient."])
    visible = {x.tool_name for x in trace if x.eligible}
    tools = [x for x in AGENT_TOOLS if x["function"]["name"] in visible]
    model_evidence = evidence.model_dump(mode="json")
    model_evidence["decision_context"] = {"eligible_tools": sorted(visible), "max_operational_actions": 3,
                                          "human_approval_required": True,
                                          "instructions": "Choose the smallest high-value set of eligible actions."}
    try:
        calls = await (model or DeepSeekAgentModel()).select_tools(model_evidence, tools)
    except AgentModelError:
        return result("agent_unavailable", extra=["Bounded model selector unavailable; no AI-selected action was created."])
    actions, tool_trace, seen, operational_count = [], [], set(), 0
    for call in calls:
        if call.name in seen:
            tool_trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="duplicate_tool_call")); continue
        seen.add(call.name)
        if call.name not in TOOL_ACTION:
            tool_trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="unsupported_tool")); continue
        try: arguments = json.loads(call.arguments or "{}")
        except (json.JSONDecodeError, TypeError):
            tool_trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="invalid_json_arguments")); continue
        if arguments != {}:
            tool_trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="tool_requires_empty_object")); continue
        action_type = TOOL_ACTION[call.name]
        if action_type != "supervisor_review" and operational_count >= 3:
            tool_trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason="operational_action_limit_reached")); continue
        ok, reason, details = _eligibility(call.name, evidence, request.spatial_heat, request.shift_optimization)
        if not ok:
            tool_trace.append(AgentToolTrace(tool_name=call.name, status="rejected", safe_reason=reason)); continue
        action_id = str(uuid4())
        actions.append(AgentAction(action_id=action_id, action_type=action_type, tool_name=call.name,
                                   worker_id=evidence.current["worker_id"], task_id=evidence.current["task_id"],
                                   reason_codes=[reason], evidence_refs=ACTION_EVIDENCE_REFS[action_type], details=details))
        tool_trace.append(AgentToolTrace(tool_name=call.name, status="accepted", safe_reason=reason, action_id=action_id))
        if action_type != "supervisor_review": operational_count += 1
    return result("decided" if actions else "no_action_selected", actions, tool_trace)
