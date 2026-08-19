"""SENSE-to-RECHECK orchestration with human-gated internal ACT state."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Callable
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.core.config import settings

from app.models.operations import (
    ActionExecutionResult,
    AgentDecisionRequest,
    ApprovalRequest,
    ApprovalResponse,
    CyclePlanResponse,
    EvidenceSnapshot,
    HeatShieldCycleRequest,
    VerificationResponse,
)

from app.models.optimization import (
    CurrentShiftPlanSummary,
    ShiftOptimizationRequest,
    ShiftOptimizationResponse,
)

from app.models.prediction import PredictHeatOutlookRequest

from app.models.risk import (
    LiveDateTimeFilter,
    RiskAssessment,
)

from app.models.spatial import (
    SpatialHeatRequest,
    SpatialHeatResponse,
    SpatialHeatSummary,
    SpatialSiteReference,
)

from app.services.agent_decision import decide
from app.services.agent_model import AgentModel

from app.services.fortyguard import (
    FortyGuardClient,
    fortyguard_client,
)

from app.services.live_environment import get_live_environment
from app.services.predictive_heat import create_heat_outlook
from app.services.risk_engine import assess_risk
from app.services.shift_optimizer import optimize_shift
from app.services.spatial_heat import create_spatial_heat
from app.services.state_store import HeatShieldStateStore


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)

    return value.astimezone(UTC)


def _analysis_anchor(
    request: HeatShieldCycleRequest,
    clock_value: datetime,
) -> datetime:
    """
    Produce one deterministic hour-aligned instant for the complete cycle.

    Current analysis:
        system clock -> site timezone -> top of current hour.

    Historical replay:
        request.analysis_datetime -> site timezone -> top of requested hour.

    This prevents SENSE, ASSESS and PREDICT from using different timestamps.
    """

    source = (
        request.analysis_datetime
        if request.analysis_datetime is not None
        else clock_value
    )

    timezone = ZoneInfo(request.timezone_name)

    local = _to_utc(source).astimezone(timezone)

    local_hour = local.replace(
        minute=0,
        second=0,
        microsecond=0,
    )

    return local_hour.astimezone(UTC)


def _current_filter(
    now: datetime,
    timezone_name: str,
) -> LiveDateTimeFilter:
    """
    Build a single-hour FortyGuard request.

    FortyGuard data is treated as hourly provider evidence, so minute/second
    values are deliberately normalized to the start of the site-local hour.
    """

    utc_now = _to_utc(now)

    local = utc_now.astimezone(
        ZoneInfo(timezone_name)
    ).replace(
        minute=0,
        second=0,
        microsecond=0,
    )

    return LiveDateTimeFilter(
        start_date=local.date(),
        start_time=local.timetz().replace(
            tzinfo=None
        ),
        filter_type=1,
    )


def _snapshot(
    assessment: RiskAssessment,
) -> EvidenceSnapshot:
    screen = assessment.screening

    return EvidenceSnapshot(
        temperature_c=assessment.environmental_evidence.temperature_c,
        heat_index_c=assessment.environmental_evidence.heat_index_c,
        screening_status=screen.status if screen else None,
        screening_band=screen.band if screen else None,
        data_quality=assessment.data_quality,
    )


def next_step_for_decision(
    status: str,
    action_count: int,
) -> str:
    if status == "decided":
        return (
            "human_approval_required"
            if action_count
            else "no_action_available"
        )

    return {
        "agent_unavailable": "agent_configuration_required",
        "no_action_selected": "no_action_available",
        "insufficient_data": "fresh_evidence_required",
    }[status]


class CycleOrchestrator:
    def __init__(
        self,
        store: HeatShieldStateStore,
        *,
        client: FortyGuardClient = fortyguard_client,
        agent_model: AgentModel | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.store = store
        self.client = client
        self.agent_model = agent_model

        self.clock = clock or (
            lambda: datetime.now(UTC)
        )

    async def plan(
        self,
        request: HeatShieldCycleRequest,
        *,
        parent_cycle_id: str | None = None,
    ) -> CyclePlanResponse:
        cycle_id = str(uuid4())

        now = _analysis_anchor(
            request,
            self.clock(),
        )

        analysis_mode = (
            "historical_replay"
            if request.analysis_datetime is not None
            else "current_hour"
        )

        self.store.add_audit(
            cycle_id,
            "cycle_created",
            {
                "parent_cycle_id": parent_cycle_id,
                "analysis_mode": analysis_mode,
                "analysis_anchor_utc": now.isoformat(),
            },
        )

        # ------------------------------------------------------------------
        # SENSE
        # ------------------------------------------------------------------

        date_time = _current_filter(
            now,
            request.timezone_name,
        )

        environment = await get_live_environment(
            request.location,
            date_time,
            timezone_name=request.timezone_name,
            client=self.client,
        )

        self.store.add_audit(
            cycle_id,
            "sense_completed",
            {
                "analysis_mode": analysis_mode,
                "requested_date": str(date_time.start_date),
                "requested_time": (
                    date_time.start_time.strftime("%H:%M")
                    if date_time.start_time
                    else None
                ),
            },
        )

        # ------------------------------------------------------------------
        # ASSESS
        #
        # Important:
        # The same analysis anchor is passed here so a 2024 replay is not
        # incorrectly classified as stale relative to the machine's 2026 clock.
        # ------------------------------------------------------------------

        assessment = assess_risk(
            environment,
            request.worker,
            request.task,
            now=now,
        )

        self.store.add_audit(
            cycle_id,
            "assessment_completed",
            {
                "data_quality": assessment.data_quality,
                "risk_level": assessment.risk_level,
            },
        )

        # ------------------------------------------------------------------
        # PREDICT
        #
        # Again use exactly the same anchor. +1 / +3 / +6 hours therefore
        # become historical provider samples when replaying historical evidence.
        # ------------------------------------------------------------------

        predict_request = PredictHeatOutlookRequest(
            location=request.location,
            timezone_name=request.timezone_name,
            offset_hours=request.forecast_offset_hours,
        )

        outlook = await create_heat_outlook(
            predict_request,
            client=self.client,
            now=now,
        )

        self.store.add_audit(
            cycle_id,
            "prediction_completed",
            {
                "status": outlook.status,
                "available_points": outlook.summary.available_points,
                "total_points": outlook.summary.total_points,
            },
        )

        # ------------------------------------------------------------------
        # OPTIONAL SPATIAL INTELLIGENCE
        # ------------------------------------------------------------------

        spatial = None

        if request.include_spatial_intelligence:
            self.store.add_audit(
                cycle_id,
                "spatial_query_started",
            )

            spatial_request = SpatialHeatRequest(
                location=request.location,
                timezone_name=request.timezone_name,
                search_radius_meters=request.spatial_search_radius_meters,
                granularity=settings.heatshield_live_granularity_meters,
            )

            try:
                spatial = await create_spatial_heat(
                    spatial_request,
                    client=self.client,
                    clock=lambda: now,
                )

                if spatial.status == "available":
                    event = "spatial_completed"
                elif spatial.status == "no_cooler_candidate":
                    event = "spatial_no_cooler_candidate"
                else:
                    event = "spatial_unavailable"

                self.store.add_audit(
                    cycle_id,
                    event,
                    {
                        "activity_id": spatial.heatmap_activity_id,
                        "valid_tile_count": spatial.summary.valid_tile_count,
                        "candidate_count": spatial.summary.cooler_candidate_count,
                    },
                )

            except Exception:
                spatial = SpatialHeatResponse(
                    status="insufficient_data",
                    generated_at=now,
                    location=request.location,
                    timezone_name=request.timezone_name,
                    search_radius_meters=request.spatial_search_radius_meters,
                    granularity=settings.heatshield_live_granularity_meters,
                    site_reference=SpatialSiteReference(),
                    tiles=[],
                    candidates=[],
                    summary=SpatialHeatSummary(
                        valid_tile_count=0,
                        cooler_candidate_count=0,
                    ),
                    limitations=[
                        (
                            "Spatial provider evidence was unavailable; "
                            "no cooler zone candidate was created."
                        )
                    ],
                )

                self.store.add_audit(
                    cycle_id,
                    "spatial_unavailable",
                )

        # ------------------------------------------------------------------
        # OPTIONAL SHIFT OPTIMIZATION
        # ------------------------------------------------------------------

        optimization = None

        if request.include_shift_optimization:
            self.store.add_audit(
                cycle_id,
                "shift_optimization_started",
                {
                    "task_count": len(
                        request.shift_tasks or []
                    ),
                    "available_slot_count": sum(
                        point.status == "available"
                        for point in outlook.points
                    ),
                },
            )

            try:
                optimization = optimize_shift(
                    ShiftOptimizationRequest(
                        worker_id=request.worker.worker_id,
                        heat_outlook=outlook,
                        tasks=request.shift_tasks or [],
                    ),
                    now=now,
                )

            except Exception:
                optimization = ShiftOptimizationResponse(
                    status="optimizer_unavailable",
                    worker_id=request.worker.worker_id,
                    generated_at=now,
                    sample_offsets_considered=[],
                    current_plan=CurrentShiftPlanSummary(
                        status="unavailable",
                        safe_reason=(
                            "Shift optimization was unavailable."
                        ),
                    ),
                    candidates=[],
                    best_candidate=None,
                    limitations=[
                        (
                            "Shift optimization was unavailable; "
                            "no schedule candidate was fabricated."
                        )
                    ],
                )

            if optimization.status == "available":
                event = "shift_optimization_completed"

            elif optimization.status == "no_better_plan":
                event = "shift_optimization_no_better_plan"

            elif optimization.status == "optimizer_unavailable":
                event = "shift_optimization_unavailable"

            else:
                event = "shift_optimization_no_feasible_plan"

            self.store.add_audit(
                cycle_id,
                event,
                {
                    "candidate_count": len(
                        optimization.candidates
                    ),
                    "best_planning_index": (
                        optimization.best_candidate.sampled_temperature_minutes_index
                        if optimization.best_candidate
                        else None
                    ),
                    "comparison_index": (
                        optimization.best_candidate.difference_vs_current_temperature_minutes_index
                        if optimization.best_candidate
                        else None
                    ),
                },
            )

        # ------------------------------------------------------------------
        # DECIDE — DeepSeek constrained tool selection
        # ------------------------------------------------------------------

        decision = await decide(
            AgentDecisionRequest(
                current_assessment=assessment,
                heat_outlook=outlook,
                spatial_heat=spatial,
                shift_optimization=optimization,
            ),
            model=self.agent_model,
            now=now,
        )

        self.store.save_decision(
            decision.decision_id,
            cycle_id,
            decision.model_dump(
                mode="json"
            ),
        )

        self.store.add_audit(
            cycle_id,
            (
                "agent_unavailable"
                if decision.status == "agent_unavailable"
                else "agent_called"
            ),
            {
                "status": decision.status,
                "analysis_mode": analysis_mode,
            },
        )

        for item in decision.tool_trace:
            self.store.add_audit(
                cycle_id,
                (
                    "tool_selected"
                    if item.status == "accepted"
                    else "tool_rejected"
                ),
                {
                    "tool_name": item.tool_name,
                    "safe_reason": item.safe_reason,
                },
            )

        for action in decision.actions:
            self.store.save_action(
                cycle_id,
                action.model_dump(
                    mode="json"
                ),
            )

            self.store.add_audit(
                cycle_id,
                "action_proposed",
                {
                    "action_id": action.action_id,
                    "action_type": action.action_type,
                },
            )

            if action.action_type == "consider_cooler_zone":
                self.store.add_audit(
                    cycle_id,
                    "cooler_zone_proposed",
                    {
                        "candidate_id": action.details.get(
                            "candidate_id"
                        ),
                        "temperature_difference_c": action.details.get(
                            "cooler_by_c"
                        ),
                        "distance_m": action.details.get(
                            "straight_line_distance_m"
                        ),
                    },
                )

            if action.action_type == "consider_shift_plan":
                self.store.add_audit(
                    cycle_id,
                    "shift_plan_proposed",
                    {
                        "action_id": action.action_id,
                        "best_planning_index": action.details.get(
                            "sampled_temperature_minutes_index"
                        ),
                    },
                )

        next_step = next_step_for_decision(
            decision.status,
            len(decision.actions),
        )

        response = CyclePlanResponse(
            cycle_id=cycle_id,
            parent_cycle_id=parent_cycle_id,
            status=decision.status,
            current_assessment=assessment,
            heat_outlook=outlook,
            spatial_heat=spatial,
            shift_optimization=optimization,
            agent_decision=decision,
            next_step=next_step,
        )

        self.store.save_cycle(
            cycle_id,
            {
                "request": request.model_dump(
                    mode="json"
                ),
                "response": response.model_dump(
                    mode="json"
                ),
            },
        )

        if parent_cycle_id:
            self.store.add_audit(
                cycle_id,
                "recheck_created",
                {
                    "parent_cycle_id": parent_cycle_id,
                },
            )

        return response

    def approve(
        self,
        cycle_id: str,
        request: ApprovalRequest,
    ) -> ApprovalResponse:
        if not self.store.get_cycle(
            cycle_id
        ):
            raise KeyError(
                "Cycle not found"
            )

        actions = {
            action["action_id"]: action
            for action in self.store.get_actions(
                cycle_id
            )
        }

        if any(
            action_id not in actions
            for action_id in request.action_ids
        ):
            raise KeyError(
                "Unknown action or action from another cycle"
            )

        results = []

        for action_id in request.action_ids:
            action = actions[
                action_id
            ]

            existing = (
                self.store.get_operational_record(
                    action_id
                )
            )

            if (
                action["status"]
                in {
                    "executed",
                    "verified",
                }
                and existing
            ):
                results.append(
                    ActionExecutionResult(
                        action_id=action_id,
                        action_type=action[
                            "action_type"
                        ],
                        status="already_executed",
                        safe_reason=(
                            "idempotent_existing_execution"
                        ),
                        operational_record=existing,
                    )
                )

                continue

            if action["status"] != "proposed":
                raise ValueError(
                    (
                        f"Action {action_id} cannot be approved "
                        f"from status {action['status']}"
                    )
                )

            self.store.update_action(
                cycle_id,
                action_id,
                "approved",
            )

            self.store.add_audit(
                cycle_id,
                "action_approved",
                {
                    "action_id": action_id,
                    "supervisor_id": request.supervisor_id,
                },
            )

            try:
                record = self._execute(
                    action
                )

                self.store.save_operational_record(
                    action_id,
                    cycle_id,
                    record,
                )

                self.store.update_action(
                    cycle_id,
                    action_id,
                    "executed",
                )

                self.store.add_audit(
                    cycle_id,
                    "action_executed",
                    {
                        "action_id": action_id,
                        "record_type": record[
                            "record_type"
                        ],
                    },
                )

                if (
                    action["action_type"]
                    == "consider_cooler_zone"
                ):
                    self.store.add_audit(
                        cycle_id,
                        "relocation_candidate_approved",
                        {
                            "candidate_id": action.get(
                                "details",
                                {},
                            ).get(
                                "candidate_id"
                            ),
                            "temperature_difference_c": action.get(
                                "details",
                                {},
                            ).get(
                                "cooler_by_c"
                            ),
                            "distance_m": action.get(
                                "details",
                                {},
                            ).get(
                                "straight_line_distance_m"
                            ),
                        },
                    )

                if (
                    action["action_type"]
                    == "consider_shift_plan"
                ):
                    self.store.add_audit(
                        cycle_id,
                        "shift_plan_approved",
                        {
                            "action_id": action_id,
                        },
                    )

                results.append(
                    ActionExecutionResult(
                        action_id=action_id,
                        action_type=action[
                            "action_type"
                        ],
                        status="executed",
                        safe_reason=(
                            "internal_operational_state_created"
                        ),
                        operational_record=record,
                    )
                )

            except Exception:
                self.store.update_action(
                    cycle_id,
                    action_id,
                    "failed",
                )

                self.store.add_audit(
                    cycle_id,
                    "action_failed",
                    {
                        "action_id": action_id,
                    },
                )

                results.append(
                    ActionExecutionResult(
                        action_id=action_id,
                        action_type=action[
                            "action_type"
                        ],
                        status="failed",
                        safe_reason=(
                            "internal_execution_failed"
                        ),
                    )
                )

        return ApprovalResponse(
            cycle_id=cycle_id,
            supervisor_id=request.supervisor_id,
            results=results,
        )

    @staticmethod
    def _execute(
        action: dict,
    ) -> dict:
        kind = action[
            "action_type"
        ]

        mapping = {
            "cool_recovery": (
                "recovery_control",
                "active",
            ),
            "reduce_physical_demands": (
                "task_adjustment",
                "active",
            ),
            "increase_monitoring": (
                "monitoring_control",
                "active",
            ),
            "limit_direct_sun": (
                "direct_sun_mitigation",
                "active",
            ),
            "supervisor_review": (
                "supervisor_review",
                "pending",
            ),
            "consider_cooler_sampled_period": (
                "schedule_candidate",
                "approved_candidate",
            ),
            "consider_cooler_zone": (
                "relocation_candidate",
                "approved_candidate",
            ),
            "consider_shift_plan": (
                "shift_plan_candidate",
                "approved_candidate",
            ),
        }

        if kind not in mapping:
            raise ValueError(
                "Unsupported internal action"
            )

        record_type, state = mapping[
            kind
        ]

        record = {
            "record_id": str(
                uuid4()
            ),
            "action_id": action[
                "action_id"
            ],
            "record_type": record_type,
            "state": state,
        }

        if (
            kind
            == "consider_cooler_sampled_period"
        ):
            record[
                "provider_backed_sample"
            ] = action.get(
                "details",
                {},
            )

        if (
            kind
            == "consider_cooler_zone"
        ):
            record[
                "provider_backed_spatial_candidate"
            ] = action.get(
                "details",
                {},
            )

        if (
            kind
            == "consider_shift_plan"
        ):
            record[
                "validated_shift_plan_candidate"
            ] = action.get(
                "details",
                {},
            )

        return record

    async def verify(
        self,
        cycle_id: str,
    ) -> VerificationResponse:
        stored = self.store.get_cycle(
            cycle_id
        )

        if not stored:
            raise KeyError(
                "Cycle not found"
            )

        request = HeatShieldCycleRequest.model_validate(
            stored["request"]
        )

        before_assessment = RiskAssessment.model_validate(
            stored["response"][
                "current_assessment"
            ]
        )

        actions = self.store.get_actions(
            cycle_id
        )

        executed = [
            action
            for action in actions
            if action["status"]
            in {
                "executed",
                "verified",
            }
        ]

        # VERIFY intentionally uses fresh current evidence, even when the
        # original cycle was a historical replay.
        now = self.clock()

        environment = await get_live_environment(
            request.location,
            _current_filter(
                now,
                request.timezone_name,
            ),
            timezone_name=request.timezone_name,
            client=self.client,
        )

        after_assessment = assess_risk(
            environment,
            request.worker,
            request.task,
            now=now,
        )

        before = _snapshot(
            before_assessment
        )

        after = _snapshot(
            after_assessment
        )

        temp_change = (
            after.temperature_c
            - before.temperature_c
            if None
            not in (
                after.temperature_c,
                before.temperature_c,
            )
            else None
        )

        hi_change = (
            after.heat_index_c
            - before.heat_index_c
            if None
            not in (
                after.heat_index_c,
                before.heat_index_c,
            )
            else None
        )

        band_changed = (
            after.screening_band
            != before.screening_band
            if None
            not in (
                after.screening_band,
                before.screening_band,
            )
            else None
        )

        action_results = []
        planned = None

        for action in executed:
            record = (
                self.store.get_operational_record(
                    action[
                        "action_id"
                    ]
                )
            )

            if record:
                expected = {
                    "recovery_control": "active",
                    "task_adjustment": "active",
                    "monitoring_control": "active",
                    "direct_sun_mitigation": "active",
                    "schedule_candidate": "approved_candidate",
                    "relocation_candidate": "approved_candidate",
                    "shift_plan_candidate": "approved_candidate",
                }

                internal_verified = (
                    expected.get(
                        record[
                            "record_type"
                        ]
                    )
                    == record.get(
                        "state"
                    )
                )

                if internal_verified:
                    self.store.update_action(
                        cycle_id,
                        action[
                            "action_id"
                        ],
                        "verified",
                    )

                action_results.append(
                    {
                        "action_id": action[
                            "action_id"
                        ],
                        "status": (
                            "internal_state_verified"
                            if internal_verified
                            else "pending_requires_review"
                        ),
                        "internal_state_verified": internal_verified,
                        "record_type": record[
                            "record_type"
                        ],
                    }
                )

                if (
                    action[
                        "action_type"
                    ]
                    == "consider_cooler_sampled_period"
                ):
                    planned = action.get(
                        "details",
                        {},
                    ).get(
                        "difference_from_current_c"
                    )

        verified_count = sum(
            bool(
                item.get(
                    "internal_state_verified"
                )
            )
            for item in action_results
        )

        if (
            after_assessment.risk_level
            == "insufficient_data"
        ):
            status = "insufficient_data"

        elif (
            executed
            and verified_count
            == len(executed)
        ):
            status = "verified"

        else:
            status = "partial"

        result = VerificationResponse(
            verification_id=str(
                uuid4()
            ),
            cycle_id=cycle_id,
            generated_at=now,
            action_state_results=action_results,
            before=before,
            after=after,
            observed_temperature_change_c=temp_change,
            observed_heat_index_change_c=hi_change,
            screening_band_changed=band_changed,
            executed_action_count=len(
                executed
            ),
            verified_action_count=verified_count,
            planned_schedule_temperature_difference_c=planned,
            status=status,
            causality_disclaimer=(
                "Observed environmental changes are not attributed "
                "causally to the HeatShield action without additional evidence."
            ),
            limitations=[
                (
                    "Before/after values are observed environmental evidence, "
                    "not proof of action effectiveness."
                ),
                (
                    "Internal action state verified does not mean a worker "
                    "physically followed the control."
                ),
                (
                    "A relocation candidate record does not verify worker movement; "
                    "fresh evidence remains tied to the original site coordinate."
                ),
                (
                    "A shift-plan candidate record does not verify tasks moved, "
                    "the schedule was implemented, or temperature or risk decreased."
                ),
                (
                    "This verification is not medical advice or a legal "
                    "compliance determination."
                ),
            ],
        )

        self.store.save_verification(
            result.verification_id,
            cycle_id,
            result.model_dump(
                mode="json"
            ),
        )

        self.store.add_audit(
            cycle_id,
            "verification_completed",
            {
                "verification_id": result.verification_id,
                "status": status,
            },
        )

        return result

    async def recheck(
        self,
        cycle_id: str,
    ) -> CyclePlanResponse:
        stored = self.store.get_cycle(
            cycle_id
        )

        if not stored:
            raise KeyError(
                "Cycle not found"
            )

        original_request = HeatShieldCycleRequest.model_validate(
            stored["request"]
        )

        # RECHECK means fresh evidence.
        #
        # Do not accidentally replay the historical timestamp stored in the
        # original cycle.
        fresh_request = original_request.model_copy(
            update={
                "analysis_datetime": None
            }
        )

        successor = await self.plan(
            fresh_request,
            parent_cycle_id=cycle_id,
        )

        self.store.add_audit(
            cycle_id,
            "recheck_created",
            {
                "successor_cycle_id": successor.cycle_id,
            },
        )

        return successor