"""SENSE-to-RECHECK orchestration with human-gated internal ACT state."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Callable
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.models.operations import (
    ActionExecutionResult, AgentDecisionRequest, ApprovalRequest, ApprovalResponse,
    CyclePlanResponse, EvidenceSnapshot, HeatShieldCycleRequest, VerificationResponse,
)
from app.models.prediction import PredictHeatOutlookRequest
from app.models.risk import LiveDateTimeFilter, RiskAssessment
from app.services.agent_decision import decide
from app.services.agent_model import AgentModel
from app.services.fortyguard import FortyGuardClient, fortyguard_client
from app.services.live_environment import get_live_environment
from app.services.predictive_heat import create_heat_outlook
from app.services.risk_engine import assess_risk
from app.services.state_store import HeatShieldStateStore


def _current_filter(now: datetime, timezone_name: str) -> LiveDateTimeFilter:
    utc_now = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    local = utc_now.astimezone(ZoneInfo(timezone_name))
    return LiveDateTimeFilter(start_date=local.date(), start_time=local.timetz().replace(tzinfo=None), filter_type=1)


def _snapshot(assessment: RiskAssessment) -> EvidenceSnapshot:
    screen = assessment.screening
    return EvidenceSnapshot(
        temperature_c=assessment.environmental_evidence.temperature_c,
        heat_index_c=assessment.environmental_evidence.heat_index_c,
        screening_status=screen.status if screen else None,
        screening_band=screen.band if screen else None,
        data_quality=assessment.data_quality,
    )


class CycleOrchestrator:
    def __init__(self, store: HeatShieldStateStore, *, client: FortyGuardClient = fortyguard_client,
                 agent_model: AgentModel | None = None, clock: Callable[[], datetime] | None = None) -> None:
        self.store, self.client, self.agent_model = store, client, agent_model
        self.clock = clock or (lambda: datetime.now(UTC))

    async def plan(self, request: HeatShieldCycleRequest, *, parent_cycle_id: str | None = None) -> CyclePlanResponse:
        cycle_id, now = str(uuid4()), self.clock()
        self.store.add_audit(cycle_id, "cycle_created", {"parent_cycle_id": parent_cycle_id})
        date_time = _current_filter(now, request.timezone_name)
        environment = await get_live_environment(request.location, date_time, client=self.client)
        self.store.add_audit(cycle_id, "sense_completed")
        assessment = assess_risk(environment, request.worker, request.task, now=now)
        self.store.add_audit(cycle_id, "assessment_completed", {"data_quality": assessment.data_quality})
        predict_request = PredictHeatOutlookRequest(location=request.location, timezone_name=request.timezone_name, offset_hours=request.forecast_offset_hours)
        outlook = await create_heat_outlook(predict_request, client=self.client, now=now)
        self.store.add_audit(cycle_id, "prediction_completed", {"status": outlook.status})
        decision = await decide(AgentDecisionRequest(current_assessment=assessment, heat_outlook=outlook), model=self.agent_model, now=now)
        self.store.save_decision(decision.decision_id, cycle_id, decision.model_dump(mode="json"))
        self.store.add_audit(cycle_id, "agent_unavailable" if decision.status == "agent_unavailable" else "agent_called", {"status": decision.status})
        for item in decision.tool_trace:
            self.store.add_audit(cycle_id, "tool_selected" if item.status == "accepted" else "tool_rejected", {"tool_name": item.tool_name, "safe_reason": item.safe_reason})
        for action in decision.actions:
            self.store.save_action(cycle_id, action.model_dump(mode="json"))
            self.store.add_audit(cycle_id, "action_proposed", {"action_id": action.action_id, "action_type": action.action_type})
        response = CyclePlanResponse(cycle_id=cycle_id, parent_cycle_id=parent_cycle_id, status=decision.status,
            current_assessment=assessment, heat_outlook=outlook, agent_decision=decision)
        self.store.save_cycle(cycle_id, {"request": request.model_dump(mode="json"), "response": response.model_dump(mode="json")})
        if parent_cycle_id: self.store.add_audit(cycle_id, "recheck_created", {"parent_cycle_id": parent_cycle_id})
        return response

    def approve(self, cycle_id: str, request: ApprovalRequest) -> ApprovalResponse:
        if not self.store.get_cycle(cycle_id): raise KeyError("Cycle not found")
        actions = {a["action_id"]: a for a in self.store.get_actions(cycle_id)}
        if any(action_id not in actions for action_id in request.action_ids): raise KeyError("Unknown action or action from another cycle")
        results = []
        for action_id in request.action_ids:
            action = actions[action_id]
            existing = self.store.get_operational_record(action_id)
            if action["status"] in {"executed", "verified"} and existing:
                results.append(ActionExecutionResult(action_id=action_id, action_type=action["action_type"], status="already_executed", safe_reason="idempotent_existing_execution", operational_record=existing)); continue
            if action["status"] != "proposed": raise ValueError(f"Action {action_id} cannot be approved from status {action['status']}")
            self.store.update_action(cycle_id, action_id, "approved")
            self.store.add_audit(cycle_id, "action_approved", {"action_id": action_id, "supervisor_id": request.supervisor_id})
            try:
                record = self._execute(action)
                self.store.save_operational_record(action_id, cycle_id, record)
                self.store.update_action(cycle_id, action_id, "executed")
                self.store.add_audit(cycle_id, "action_executed", {"action_id": action_id, "record_type": record["record_type"]})
                results.append(ActionExecutionResult(action_id=action_id, action_type=action["action_type"], status="executed", safe_reason="internal_operational_state_created", operational_record=record))
            except Exception:
                self.store.update_action(cycle_id, action_id, "failed"); self.store.add_audit(cycle_id, "action_failed", {"action_id": action_id})
                results.append(ActionExecutionResult(action_id=action_id, action_type=action["action_type"], status="failed", safe_reason="internal_execution_failed"))
        return ApprovalResponse(cycle_id=cycle_id, supervisor_id=request.supervisor_id, results=results)

    @staticmethod
    def _execute(action: dict) -> dict:
        kind = action["action_type"]
        mapping = {
            "cool_recovery": ("recovery_control", "active"), "reduce_physical_demands": ("task_adjustment", "active"),
            "increase_monitoring": ("monitoring_control", "active"), "limit_direct_sun": ("direct_sun_mitigation", "active"),
            "supervisor_review": ("supervisor_review", "pending"), "consider_cooler_sampled_period": ("schedule_candidate", "approved_candidate"),
        }
        if kind not in mapping: raise ValueError("Unsupported internal action")
        record_type, state = mapping[kind]
        record = {"record_id": str(uuid4()), "action_id": action["action_id"], "record_type": record_type, "state": state}
        if kind == "consider_cooler_sampled_period": record["provider_backed_sample"] = action.get("details", {})
        return record

    async def verify(self, cycle_id: str) -> VerificationResponse:
        stored = self.store.get_cycle(cycle_id)
        if not stored: raise KeyError("Cycle not found")
        request = HeatShieldCycleRequest.model_validate(stored["request"])
        before_assessment = RiskAssessment.model_validate(stored["response"]["current_assessment"])
        actions = self.store.get_actions(cycle_id); executed = [a for a in actions if a["status"] in {"executed", "verified"}]
        now = self.clock()
        environment = await get_live_environment(request.location, _current_filter(now, request.timezone_name), client=self.client)
        after_assessment = assess_risk(environment, request.worker, request.task, now=now)
        before, after = _snapshot(before_assessment), _snapshot(after_assessment)
        temp_change = after.temperature_c - before.temperature_c if None not in (after.temperature_c, before.temperature_c) else None
        hi_change = after.heat_index_c - before.heat_index_c if None not in (after.heat_index_c, before.heat_index_c) else None
        band_changed = after.screening_band != before.screening_band if None not in (after.screening_band, before.screening_band) else None
        action_results, planned = [], None
        for action in executed:
            record = self.store.get_operational_record(action["action_id"])
            if record:
                self.store.update_action(cycle_id, action["action_id"], "verified")
                action_results.append({"action_id": action["action_id"], "status": "verified", "record_type": record["record_type"]})
                if action["action_type"] == "consider_cooler_sampled_period": planned = action.get("details", {}).get("difference_from_current_c")
        status = "insufficient_data" if after_assessment.risk_level == "insufficient_data" else "verified" if executed and len(action_results) == len(executed) else "partial"
        result = VerificationResponse(verification_id=str(uuid4()), cycle_id=cycle_id, generated_at=now,
            action_state_results=action_results, before=before, after=after,
            observed_temperature_change_c=temp_change, observed_heat_index_change_c=hi_change, screening_band_changed=band_changed,
            executed_action_count=len(executed), verified_action_count=len(action_results), planned_schedule_temperature_difference_c=planned,
            status=status, causality_disclaimer="Observed environmental changes are not attributed causally to the HeatShield action without additional evidence.",
            limitations=["Before/after values are observed environmental evidence, not proof of action effectiveness.", "This verification is not medical advice or a legal compliance determination."])
        self.store.save_verification(result.verification_id, cycle_id, result.model_dump(mode="json"))
        self.store.add_audit(cycle_id, "verification_completed", {"verification_id": result.verification_id, "status": status})
        return result

    async def recheck(self, cycle_id: str) -> CyclePlanResponse:
        stored = self.store.get_cycle(cycle_id)
        if not stored: raise KeyError("Cycle not found")
        successor = await self.plan(HeatShieldCycleRequest.model_validate(stored["request"]), parent_cycle_id=cycle_id)
        self.store.add_audit(cycle_id, "recheck_created", {"successor_cycle_id": successor.cycle_id})
        return successor
