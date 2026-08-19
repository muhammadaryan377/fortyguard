"""Typed contracts for deterministic multi-worker site intelligence."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.fortyguard import EnvironmentalConditions
from app.models.operations import HeatShieldCycleRequest
from app.models.optimization import ShiftOptimizationResponse, ShiftTaskPlan, validate_task_dependencies
from app.models.prediction import PredictHeatOutlookResponse
from app.models.risk import RiskAssessment, TaskContext, USSiteLocation, WorkerContext, WorkloadLevel
from app.models.spatial import SpatialHeatResponse


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OperationalAttentionGroup(StrEnum):
    EVIDENCE_GAP = "evidence_gap"
    EXTREME_HEAT_SCREENING = "extreme_heat_screening"
    DANGER_HEAT_SCREENING = "danger_heat_screening"
    EXTREME_CAUTION_HEAT_SCREENING = "extreme_caution_heat_screening"
    CAUTION_HEAT_SCREENING = "caution_heat_screening"
    BELOW_CAUTION_HEAT_SCREENING = "below_caution_heat_screening"
    SCREENING_UNAVAILABLE = "screening_unavailable"


class SiteWorkerAssignment(StrictModel):
    worker: WorkerContext
    task: TaskContext
    shift_tasks: list[ShiftTaskPlan] | None = Field(default=None, min_length=1, max_length=6)
    display_label: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def valid_shift_tasks(self) -> "SiteWorkerAssignment":
        if self.shift_tasks:
            validate_task_dependencies(self.shift_tasks)
        return self


class SiteOperationsRequest(StrictModel):
    location: USSiteLocation
    timezone_name: str = "America/Phoenix"
    assignments: list[SiteWorkerAssignment] = Field(min_length=1, max_length=25)
    forecast_offset_hours: list[int] = Field(default_factory=lambda: [1, 3, 6, 9, 12], min_length=1, max_length=5)
    include_prediction: bool = True
    include_spatial_intelligence: bool = True
    spatial_search_radius_meters: int = Field(default=400, ge=100, le=1500)
    include_shift_optimization: bool = False
    max_spatial_candidates: int = Field(default=3, ge=1, le=5)

    @field_validator("timezone_name")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone_name must be a valid IANA timezone") from exc
        return value

    @field_validator("forecast_offset_hours")
    @classmethod
    def valid_offsets(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value) or any(offset < 1 or offset > 12 for offset in value):
            raise ValueError("forecast offsets must be unique values between 1 and 12")
        return sorted(value)

    @model_validator(mode="after")
    def valid_site_request(self) -> "SiteOperationsRequest":
        ids = [item.worker.worker_id for item in self.assignments]
        if len(ids) != len(set(ids)):
            raise ValueError("worker_id values must be unique within a site request")
        if self.include_shift_optimization and not self.include_prediction:
            raise ValueError("include_shift_optimization=true requires include_prediction=true")
        return self


class SiteWorkerSnapshot(BaseModel):
    worker_id: str
    display_label: str | None = None
    task_id: str
    task_name: str
    workload_level: WorkloadLevel
    direct_sun: bool
    acclimatized: bool
    exposure_duration_minutes: int
    attention_group: OperationalAttentionGroup
    attention_order: int
    current_assessment: RiskAssessment
    shift_optimization: ShiftOptimizationResponse | None = None
    contextual_flags: list[str]
    recommended_controls: list[str]
    available_agent_capabilities: list[str]


class SiteOperationsSummary(BaseModel):
    worker_count: int
    evidence_gap_count: int
    screening_band_counts: dict[str, int]
    direct_sun_worker_count: int
    non_acclimatized_worker_count: int
    workers_with_shift_candidate_count: int
    workers_with_lower_index_shift_candidate_count: int
    shared_current_temperature_c: float | None = None
    shared_provider_heat_index_c: float | None = None
    forecast_status: str
    spatial_status: str
    cooler_zone_candidate_count: int


class SiteProviderUsage(BaseModel):
    current_environment_fetches: int = 0
    prediction_heatmap_requests: int = 0
    spatial_heatmap_requests: int = 0
    worker_assessment_count: int = 0
    worker_shift_optimization_count: int = 0
    deepseek_calls: Literal[0] = 0


class SiteOperationsResponse(BaseModel):
    snapshot_id: str
    generated_at: datetime
    age_seconds: float | None = None
    status: Literal["available", "partial", "insufficient_data"]
    location: USSiteLocation
    timezone_name: str
    shared_environment: EnvironmentalConditions
    heat_outlook: PredictHeatOutlookResponse | None = None
    spatial_heat: SpatialHeatResponse | None = None
    workers: list[SiteWorkerSnapshot]
    attention_queue: list[str]
    summary: SiteOperationsSummary
    provider_usage: SiteProviderUsage
    limitations: list[str]


class SelectedWorkerCycleRequest(BaseModel):
    snapshot_id: str
    worker_id: str
    cycle_request: HeatShieldCycleRequest
    limitations: list[str]
