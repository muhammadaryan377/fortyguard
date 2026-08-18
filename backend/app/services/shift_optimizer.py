"""Transparent exhaustive search over provider-backed sampled start slots."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from itertools import product

from app.models.optimization import CurrentShiftPlanSummary, ScheduledTaskCandidate, ShiftOptimizationRequest, ShiftOptimizationResponse, ShiftPlanCandidate

LIMITATIONS = [
    "Assignments use only available provider-backed sampled start timestamps; missing times are not interpolated.",
    "A sampled start temperature describes only the task start, not temperature across the task duration.",
    "sampled_temperature_minutes_index is a relative scheduling index, not physiological heat dose, occupational risk, or a medical metric.",
    "No future Heat Index, WBGT, continuous temperature coverage, or safe work period is inferred.",
    "Workload and direct-sun fields are context only and receive no arbitrary temperature weighting.",
]
CANDIDATE_LIMITATIONS = [
    "This feasible sampled-temperature schedule candidate does not establish work-period safety.",
    "Sampled-start temperatures do not represent task-average exposure or quantify occupational risk.",
]


def _available_slots(request: ShiftOptimizationRequest) -> dict[int, object]:
    return {point.offset_hours: point for point in request.heat_outlook.points
            if point.status == "available" and isinstance(point.temperature_c, (int, float)) and not isinstance(point.temperature_c, bool)}


def _assignment(task, offset, point) -> ScheduledTaskCandidate:
    return ScheduledTaskCandidate(task_id=task.task_id, task_name=task.task_name,
        current_planned_offset_hours=task.current_planned_offset_hours, candidate_offset_hours=offset,
        sampled_local_start_timestamp=point.requested_local_timestamp,
        sampled_utc_start_timestamp=point.requested_utc_timestamp,
        calculated_end_timestamp=point.requested_local_timestamp + timedelta(minutes=task.duration_minutes),
        duration_minutes=task.duration_minutes, sampled_start_temperature_c=point.temperature_c,
        forecast_activity_id=point.heatmap_activity_id, schedule_movement_hours=abs(offset-task.current_planned_offset_hours),
        workload_level=task.workload_level, direct_sun=task.direct_sun)


def _feasible(assignments: list[ScheduledTaskCandidate], request: ShiftOptimizationRequest) -> bool:
    by_id = {item.task_id: item for item in assignments}
    intervals = sorted((item.sampled_utc_start_timestamp,
        item.sampled_utc_start_timestamp + timedelta(minutes=item.duration_minutes)) for item in assignments)
    if any(current[0] < previous[1] for previous, current in zip(intervals, intervals[1:])): return False
    for task in request.tasks:
        current = by_id[task.task_id]
        for dependency in task.must_follow_task_ids:
            predecessor = by_id[dependency]
            if current.sampled_utc_start_timestamp < predecessor.sampled_utc_start_timestamp + timedelta(minutes=predecessor.duration_minutes): return False
    return True


def _metrics(assignments: list[ScheduledTaskCandidate]) -> tuple[float, float, int]:
    total_minutes = sum(item.duration_minutes for item in assignments)
    index = sum(item.sampled_start_temperature_c * item.duration_minutes for item in assignments)
    movement = sum(item.schedule_movement_hours for item in assignments)
    return float(index), float(index / total_minutes), movement


def _current_plan(request: ShiftOptimizationRequest, slots: dict[int, object]) -> CurrentShiftPlanSummary:
    if any(task.current_planned_offset_hours not in slots for task in request.tasks):
        return CurrentShiftPlanSummary(status="unavailable", safe_reason="A current planned offset has no available provider sample.")
    assignments = [_assignment(task, task.current_planned_offset_hours, slots[task.current_planned_offset_hours]) for task in request.tasks]
    if not _feasible(assignments, request):
        return CurrentShiftPlanSummary(status="unavailable", safe_reason="The current plan violates overlap or dependency constraints.")
    index, weighted, _ = _metrics(assignments)
    return CurrentShiftPlanSummary(status="available", sampled_temperature_minutes_index=index,
        duration_weighted_sampled_start_temperature_c=weighted)


def optimize_shift(request: ShiftOptimizationRequest, *, now: datetime | None = None) -> ShiftOptimizationResponse:
    current = now or datetime.now(UTC)
    generated = current.replace(tzinfo=UTC) if current.tzinfo is None else current.astimezone(UTC)
    slots = _available_slots(request); offsets = sorted(slots)
    unavailable_current = CurrentShiftPlanSummary(status="unavailable", safe_reason="No usable future sampled temperature evidence.")
    if not slots:
        return ShiftOptimizationResponse(status="insufficient_forecast", worker_id=request.worker_id, generated_at=generated,
            sample_offsets_considered=[], current_plan=unavailable_current, candidates=[], limitations=LIMITATIONS)
    current = _current_plan(request, slots)
    choices = []
    for task in request.tasks:
        candidate = ([task.current_planned_offset_hours] if task.current_planned_offset_hours in slots else []) if not task.flexible else offsets if task.allowed_offset_hours is None else sorted(set(offsets).intersection(task.allowed_offset_hours))
        choices.append(candidate)
    feasible = []
    if all(choices):
        for offsets_tuple in product(*choices):
            assignments = [_assignment(task, offset, slots[offset]) for task, offset in zip(request.tasks, offsets_tuple)]
            if not _feasible(assignments, request): continue
            index, weighted, movement = _metrics(assignments)
            feasible.append((index, movement, tuple(offsets_tuple), weighted, assignments))
    feasible.sort(key=lambda item: (item[0], item[1], item[2]))
    if not feasible:
        return ShiftOptimizationResponse(status="no_feasible_plan", worker_id=request.worker_id, generated_at=generated,
            sample_offsets_considered=offsets, current_plan=current, candidates=[], limitations=LIMITATIONS)
    candidates = []
    for rank, (index, movement, offset_tuple, weighted, assignments) in enumerate(feasible[:request.max_alternatives], 1):
        current_index = current.sampled_temperature_minutes_index if current.status == "available" else None
        current_weighted = current.duration_weighted_sampled_start_temperature_c if current.status == "available" else None
        candidates.append(ShiftPlanCandidate(rank=rank, assignments=assignments,
            sampled_temperature_minutes_index=index, duration_weighted_sampled_start_temperature_c=weighted,
            total_schedule_movement_hours=movement,
            difference_vs_current_temperature_minutes_index=index-current_index if current_index is not None else None,
            difference_vs_current_weighted_start_temperature_c=weighted-current_weighted if current_weighted is not None else None,
            is_strictly_lower_temperature_index_than_current=index < current_index if current_index is not None else None,
            limitations=CANDIDATE_LIMITATIONS))
    best = candidates[0]
    status = "available" if current.status == "unavailable" or best.is_strictly_lower_temperature_index_than_current else "no_better_plan"
    return ShiftOptimizationResponse(status=status, worker_id=request.worker_id, generated_at=generated,
        sample_offsets_considered=offsets, current_plan=current, candidates=candidates, best_candidate=best, limitations=LIMITATIONS)
