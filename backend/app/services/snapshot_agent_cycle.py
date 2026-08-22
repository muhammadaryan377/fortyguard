"""Create auditable agent cycles from a just-created site snapshot without duplicate provider calls."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.models.operations import AgentDecisionRequest, CyclePlanResponse, HeatShieldCycleRequest
from app.models.optimization import ShiftOptimizationResponse
from app.models.prediction import PredictHeatOutlookResponse
from app.models.risk import RiskAssessment
from app.models.spatial import SpatialHeatResponse
from app.services.agent_decision import decide
from app.services.agent_model import AgentModel
from app.services.cycle_orchestrator import next_step_for_decision
from app.services.state_store import HeatShieldStateStore


async def create_snapshot_agent_cycle(
    *,
    store: HeatShieldStateStore,
    cycle_request: HeatShieldCycleRequest,
    assessment: RiskAssessment,
    outlook: PredictHeatOutlookResponse,
    spatial: SpatialHeatResponse | None,
    optimization: ShiftOptimizationResponse | None,
    snapshot_id: str,
    generated_at: datetime,
    agent_model: AgentModel | None = None,
) -> CyclePlanResponse:
    """Run DECIDE only; SENSE/ASSESS/PREDICT/SPATIAL were completed seconds earlier in the site snapshot."""
    cycle_id = str(uuid4())
    now = generated_at.replace(tzinfo=UTC) if generated_at.tzinfo is None else generated_at.astimezone(UTC)
    store.add_audit(
        cycle_id,
        "cycle_created_from_site_snapshot",
        {
            "snapshot_id": snapshot_id,
            "analysis_anchor_utc": now.isoformat(),
            "provider_refetch_skipped": True,
        },
    )
    store.add_audit(cycle_id, "sense_reused_from_snapshot", {"snapshot_id": snapshot_id})
    store.add_audit(
        cycle_id,
        "assessment_reused_from_snapshot",
        {"data_quality": assessment.data_quality, "risk_level": assessment.risk_level},
    )
    store.add_audit(
        cycle_id,
        "prediction_reused_from_snapshot",
        {
            "status": outlook.status,
            "available_points": outlook.summary.available_points,
            "total_points": outlook.summary.total_points,
        },
    )
    if spatial is not None:
        store.add_audit(
            cycle_id,
            "spatial_reused_from_snapshot",
            {
                "status": spatial.status,
                "candidate_count": len(spatial.candidates),
                "activity_id": spatial.heatmap_activity_id,
            },
        )
    if optimization is not None:
        store.add_audit(
            cycle_id,
            "shift_optimization_reused_from_snapshot",
            {"status": optimization.status, "candidate_count": len(optimization.candidates)},
        )

    decision = await decide(
        AgentDecisionRequest(
            current_assessment=assessment,
            heat_outlook=outlook,
            spatial_heat=spatial,
            shift_optimization=optimization,
        ),
        model=agent_model,
        now=now,
    )
    store.save_decision(decision.decision_id, cycle_id, decision.model_dump(mode="json"))
    store.add_audit(
        cycle_id,
        "agent_unavailable" if decision.status == "agent_unavailable" else "agent_called",
        {"status": decision.status, "evidence_source": "site_snapshot"},
    )
    for item in decision.tool_trace:
        store.add_audit(
            cycle_id,
            "tool_selected" if item.status == "accepted" else "tool_rejected",
            {"tool_name": item.tool_name, "safe_reason": item.safe_reason},
        )
    for action in decision.actions:
        store.save_action(cycle_id, action.model_dump(mode="json"))
        store.add_audit(
            cycle_id,
            "action_proposed",
            {"action_id": action.action_id, "action_type": action.action_type},
        )

    response = CyclePlanResponse(
        cycle_id=cycle_id,
        parent_cycle_id=None,
        status=decision.status,
        current_assessment=assessment,
        heat_outlook=outlook,
        spatial_heat=spatial,
        shift_optimization=optimization,
        agent_decision=decision,
        next_step=next_step_for_decision(decision.status, len(decision.actions)),
    )
    store.save_cycle(
        cycle_id,
        {
            "request": cycle_request.model_dump(mode="json"),
            "response": response.model_dump(mode="json"),
            "snapshot_id": snapshot_id,
            "snapshot_evidence_reused": True,
        },
    )
    return response
