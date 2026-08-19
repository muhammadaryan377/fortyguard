"""Typed contracts for deterministic sampled-start shift optimization."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.prediction import PredictHeatOutlookResponse
from app.models.risk import WorkloadLevel


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShiftTaskPlan(StrictModel):
    task_id: str = Field(min_length=1, max_length=100)
    task_name: str = Field(min_length=1, max_length=200)
    duration_minutes: int = Field(ge=15, le=360)
    current_planned_offset_hours: int = Field(ge=1, le=12)
    flexible: bool = True
    allowed_offset_hours: list[int] | None = Field(default=None, max_length=5)
    workload_level: WorkloadLevel
    direct_sun: bool = False
    must_follow_task_ids: list[str] = Field(default_factory=list)

    @field_validator("allowed_offset_hours")
    @classmethod
    def allowed_offsets(cls, value: list[int] | None) -> list[int] | None:
        if value is None: return value
        if len(value) != len(set(value)): raise ValueError("allowed_offset_hours must be unique")
        if any(offset < 1 or offset > 12 for offset in value): raise ValueError("allowed offsets must be between 1 and 12")
        return sorted(value)

    @field_validator("must_follow_task_ids")
    @classmethod
    def dependencies(cls, value: list[str], info) -> list[str]:
        if len(value) != len(set(value)): raise ValueError("dependency IDs must be unique")
        if info.data.get("task_id") in value: raise ValueError("task cannot depend on itself")
        return value


def validate_task_dependencies(tasks: list[ShiftTaskPlan]) -> None:
    ids = [task.task_id for task in tasks]
    if len(ids) != len(set(ids)): raise ValueError("task_id values must be unique")
    known = set(ids)
    if any(dependency not in known for task in tasks for dependency in task.must_follow_task_ids):
        raise ValueError("every dependency must reference another task in this request")
    graph = {task.task_id: task.must_follow_task_ids for task in tasks}
    visiting, visited = set(), set()
    def visit(task_id: str) -> None:
        if task_id in visiting: raise ValueError("task dependency graph must not contain cycles")
        if task_id in visited: return
        visiting.add(task_id)
        for dependency in graph[task_id]: visit(dependency)
        visiting.remove(task_id); visited.add(task_id)
    for task_id in ids: visit(task_id)


class ShiftOptimizationRequest(StrictModel):
    worker_id: str = Field(min_length=1, max_length=100)
    heat_outlook: PredictHeatOutlookResponse
    tasks: list[ShiftTaskPlan] = Field(min_length=1, max_length=6)
    max_alternatives: int = Field(default=3, ge=1, le=5)

    @model_validator(mode="after")
    def validate_task_graph(self) -> "ShiftOptimizationRequest":
        validate_task_dependencies(self.tasks)
        return self


class ScheduledTaskCandidate(BaseModel):
    task_id: str
    task_name: str
    current_planned_offset_hours: int
    candidate_offset_hours: int
    sampled_local_start_timestamp: datetime
    sampled_utc_start_timestamp: datetime
    calculated_end_timestamp: datetime
    duration_minutes: int
    sampled_start_temperature_c: float
    temperature_source: Literal["fortyguard_heatmap"] = "fortyguard_heatmap"
    forecast_activity_id: str | None = None
    schedule_movement_hours: int
    workload_level: WorkloadLevel
    direct_sun: bool


class ShiftPlanCandidate(BaseModel):
    rank: int
    assignments: list[ScheduledTaskCandidate]
    sampled_temperature_minutes_index: float
    duration_weighted_sampled_start_temperature_c: float
    total_schedule_movement_hours: int
    difference_vs_current_temperature_minutes_index: float | None = None
    difference_vs_current_weighted_start_temperature_c: float | None = None
    is_strictly_lower_temperature_index_than_current: bool | None = None
    limitations: list[str]


class CurrentShiftPlanSummary(BaseModel):
    status: Literal["available", "unavailable"]
    sampled_temperature_minutes_index: float | None = None
    duration_weighted_sampled_start_temperature_c: float | None = None
    safe_reason: str | None = None


class ShiftOptimizationResponse(BaseModel):
    status: Literal["available", "no_better_plan", "no_feasible_plan", "insufficient_forecast", "optimizer_unavailable"]
    worker_id: str
    generated_at: datetime
    source: Literal["fortyguard_predict_samples"] = "fortyguard_predict_samples"
    sample_offsets_considered: list[int]
    current_plan: CurrentShiftPlanSummary
    candidates: list[ShiftPlanCandidate]
    best_candidate: ShiftPlanCandidate | None = None
    limitations: list[str]
