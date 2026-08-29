"""Typed contracts for constrained decisions and the operational cycle."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.fortyguard import PolygonFeatureCollection
from app.models.optimization import (
    ShiftOptimizationResponse,
    ShiftTaskPlan,
    validate_task_dependencies,
)
from app.models.prediction import PredictHeatOutlookResponse
from app.models.risk import (
    RiskAssessment,
    TaskContext,
    USSiteLocation,
    WorkerContext,
)
from app.models.spatial import SpatialHeatResponse


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


ActionType = Literal[
    "cool_recovery",
    "reduce_physical_demands",
    "consider_cooler_sampled_period",
    "increase_monitoring",
    "limit_direct_sun",
    "supervisor_review",
    "consider_cooler_zone",
    "consider_shift_plan",
]


class AgentDecisionRequest(StrictModel):
    current_assessment: RiskAssessment
    heat_outlook: PredictHeatOutlookResponse
    supervisor_id: str | None = Field(default=None, min_length=1, max_length=100)
    notes: str | None = Field(default=None, max_length=1000)
    spatial_heat: SpatialHeatResponse | None = None
    shift_optimization: ShiftOptimizationResponse | None = None


class AgentEvidence(BaseModel):
    current: dict[str, Any]
    forecast: dict[str, Any]
    spatial: dict[str, Any] | None = None
    shift_optimization: dict[str, Any] | None = None


class AgentEvidenceSignal(BaseModel):
    signal: str
    source: str
    value: Any = None
    implication: str
    confidence: Literal["high", "medium", "low"]


class AgentEligibilityTrace(BaseModel):
    tool_name: str
    action_type: ActionType
    eligible: bool
    safe_reason: str
    evidence_refs: list[str] = Field(default_factory=list)
    preview_details: dict[str, Any] = Field(default_factory=dict)


class AgentReasoningSummary(BaseModel):
    objective: str
    urgency: Literal["monitor", "elevated", "high", "critical", "unknown"]
    evidence_confidence: Literal["high", "medium", "low"]
    thermal_interpretation: str
    evidence_signals: list[AgentEvidenceSignal]
    eligible_action_types: list[ActionType]
    selected_action_types: list[ActionType]
    guardrails: list[str]
    uncertainty: list[str]


class AgentAction(BaseModel):
    action_id: str
    action_type: ActionType
    status: Literal[
        "proposed",
        "approved",
        "executed",
        "rejected",
        "failed",
        "verified",
    ] = "proposed"
    tool_name: str
    worker_id: str
    task_id: str
    requires_human_approval: Literal[True] = True
    reason_codes: list[str]
    evidence_refs: list[str]
    details: dict[str, Any] = Field(default_factory=dict)


class AgentToolTrace(BaseModel):
    tool_name: str
    status: Literal["accepted", "rejected"]
    safe_reason: str
    action_id: str | None = None


class AgentDecisionResponse(BaseModel):
    status: Literal[
        "decided",
        "insufficient_data",
        "agent_unavailable",
        "no_action_selected",
    ]
    decision_id: str
    generated_at: datetime
    model: str
    worker_id: str
    task_id: str
    actions: list[AgentAction]
    tool_trace: list[AgentToolTrace]
    eligibility_trace: list[AgentEligibilityTrace]
    reasoning_summary: AgentReasoningSummary
    current_evidence_summary: dict[str, Any]
    forecast_evidence_summary: dict[str, Any]
    spatial_evidence_summary: dict[str, Any] | None = None
    shift_optimization_evidence_summary: dict[str, Any] | None = None
    policy_version: str
    requires_human_approval: Literal[True] = True
    limitations: list[str]


class HeatShieldCycleRequest(StrictModel):
    location: USSiteLocation
    timezone_name: str = "America/Phoenix"

    worker: WorkerContext
    task: TaskContext

    # Normally None = current provider hour.
    #
    # When HeatShield intentionally replays a known provider observation,
    # the frontend may send an offset-aware timestamp such as:
    #
    # 2024-07-15T14:00:00-07:00
    #
    # The entire SENSE → ASSESS → PREDICT → DECIDE cycle will then use
    # the same historical analysis anchor instead of mixing old and current data.
    analysis_datetime: datetime | None = None

    forecast_offset_hours: list[int] = Field(
        default_factory=lambda: [1, 3, 6, 9, 12],
        min_length=1,
        max_length=5,
    )

    include_spatial_intelligence: bool = False
    spatial_search_radius_meters: int = Field(
        default=400,
        ge=100,
        le=1500,
    )
    operational_polygon: PolygonFeatureCollection | None = None

    include_shift_optimization: bool = False
    shift_tasks: list[ShiftTaskPlan] | None = Field(
        default=None,
        min_length=1,
        max_length=6,
    )

    @field_validator("forecast_offset_hours")
    @classmethod
    def offsets(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("forecast offsets must be unique")

        if any(item < 1 or item > 12 for item in value):
            raise ValueError(
                "forecast offsets must be values between 1 and 12"
            )

        return sorted(value)

    @field_validator("timezone_name")
    @classmethod
    def timezone(cls, value: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(
                "timezone_name must be a valid IANA timezone"
            ) from exc

        return value

    @field_validator("analysis_datetime")
    @classmethod
    def analysis_datetime_requires_timezone(
        cls,
        value: datetime | None,
    ) -> datetime | None:
        if value is None:
            return None

        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError(
                "analysis_datetime must include a timezone offset"
            )

        return value

    @model_validator(mode="after")
    def optimization_tasks_required(self) -> "HeatShieldCycleRequest":
        if self.include_shift_optimization and not self.shift_tasks:
            raise ValueError(
                "shift_tasks is required when shift optimization is enabled"
            )

        if self.shift_tasks:
            validate_task_dependencies(self.shift_tasks)

        return self


class CyclePlanResponse(BaseModel):
    cycle_id: str
    parent_cycle_id: str | None = None
    status: str

    current_assessment: RiskAssessment
    heat_outlook: PredictHeatOutlookResponse

    spatial_heat: SpatialHeatResponse | None = None
    shift_optimization: ShiftOptimizationResponse | None = None

    agent_decision: AgentDecisionResponse

    next_step: Literal[
        "human_approval_required",
        "agent_configuration_required",
        "no_action_available",
        "fresh_evidence_required",
    ]


class ApprovalRequest(StrictModel):
    supervisor_id: str = Field(
        min_length=1,
        max_length=100,
    )

    action_ids: list[str] = Field(
        min_length=1,
    )

    @field_validator("action_ids")
    @classmethod
    def unique_actions(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError(
                "action_ids must be unique"
            )

        return value


class ActionExecutionResult(BaseModel):
    action_id: str
    action_type: str

    status: Literal[
        "executed",
        "failed",
        "already_executed",
    ]

    safe_reason: str

    operational_record: dict[str, Any] | None = None


class ApprovalResponse(BaseModel):
    cycle_id: str
    supervisor_id: str
    results: list[ActionExecutionResult]


class EvidenceSnapshot(BaseModel):
    temperature_c: float | None = None
    heat_index_c: float | None = None
    screening_status: str | None = None
    screening_band: str | None = None
    data_quality: str


class VerificationResponse(BaseModel):
    verification_id: str
    cycle_id: str
    generated_at: datetime

    action_state_results: list[dict[str, Any]]

    before: EvidenceSnapshot
    after: EvidenceSnapshot

    observed_temperature_change_c: float | None = None
    observed_heat_index_change_c: float | None = None

    screening_band_changed: bool | None = None

    executed_action_count: int
    verified_action_count: int

    planned_schedule_temperature_difference_c: float | None = None

    status: Literal[
        "verified",
        "partial",
        "insufficient_data",
    ]

    causality_disclaimer: str
    limitations: list[str]


class AuditEvent(BaseModel):
    event_id: str
    cycle_id: str
    timestamp: datetime
    event_type: str
    safe_details: dict[str, Any] = Field(default_factory=dict)
