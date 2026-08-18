"""Typed inputs and auditable outputs for deterministic heat-risk assessment."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.fortyguard import EnvironmentalConditions, EnvironmentalDateTimeFilter


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WorkloadLevel(StrEnum):
    LIGHT = "light"
    MODERATE = "moderate"
    HEAVY = "heavy"
    VERY_HEAVY = "very_heavy"


class PPELevel(StrEnum):
    NONE = "none"
    LIGHT = "light"
    MODERATE = "moderate"
    HEAVY = "heavy"


class WorkerContext(StrictModel):
    worker_id: str = Field(min_length=1, max_length=100)
    site_id: str = Field(min_length=1, max_length=100)
    zone_id: str | None = Field(default=None, min_length=1, max_length=100)
    acclimatized: bool
    ppe_level: PPELevel | None = None
    clothing_factor: float | None = Field(default=None, ge=0)
    shift_start: datetime | None = None
    shift_end: datetime | None = None

    @model_validator(mode="after")
    def validate_shift(self) -> "WorkerContext":
        if self.shift_start and self.shift_end and self.shift_end <= self.shift_start:
            raise ValueError("shift_end must be later than shift_start")
        return self


class TaskContext(StrictModel):
    task_id: str = Field(min_length=1, max_length=100)
    task_name: str = Field(min_length=1, max_length=200)
    workload_level: WorkloadLevel
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    exposure_duration_minutes: int = Field(ge=0)
    outdoor: bool
    direct_sun: bool

    @model_validator(mode="after")
    def validate_schedule(self) -> "TaskContext":
        if self.planned_start and self.planned_end and self.planned_end <= self.planned_start:
            raise ValueError("planned_end must be later than planned_start")
        return self


class USSiteLocation(StrictModel):
    site_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=1, max_length=100)
    country: Literal["United States"] = "United States"
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)


class RiskFactor(BaseModel):
    factor: str
    value: Any
    effect: str


class OccupationalPolicy(BaseModel):
    country: str
    authorities: list[str]
    thresholds_configured: bool


class RiskAssessment(BaseModel):
    risk_score: float | None = None
    risk_level: Literal["configuration_required", "insufficient_data"]
    data_quality: Literal["good", "partial", "stale", "insufficient"]
    available_inputs: list[str]
    factors: list[RiskFactor]
    missing_inputs: list[str]
    explanations: list[str]
    environmental_evidence: EnvironmentalConditions
    worker_context: WorkerContext
    task_context: TaskContext
    rules_applied: list[str]
    policy: OccupationalPolicy
    configuration_version: str


class RiskAssessmentRequest(StrictModel):
    environment: EnvironmentalConditions
    worker: WorkerContext
    task: TaskContext


class LiveRiskAssessmentRequest(StrictModel):
    location: USSiteLocation
    temperature_c: float
    date_time: EnvironmentalDateTimeFilter
    worker: WorkerContext
    task: TaskContext
