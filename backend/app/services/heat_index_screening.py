"""Deterministic NWS Heat Index screening with occupational context flags."""

from app.core.screening_rules import (
    BAND_CONTROLS,
    BASE_CONTROLS,
    HEAT_INDEX_BANDS,
    HEAT_INDEX_METRIC,
    HEAT_INDEX_POLICY_LAST_REVIEWED,
    HEAT_INDEX_POLICY_VERSION,
    HEAT_INDEX_SOURCES,
    HEAT_INDEX_THRESHOLD_BASIS,
    SCREENING_LIMITATIONS,
)
from app.models.fortyguard import EnvironmentalConditions
from app.models.risk import (
    HeatIndexScreening,
    ScreeningBoundary,
    ScreeningSource,
    TaskContext,
    WorkerContext,
    WorkloadLevel,
)


def celsius_to_fahrenheit(value_c: float) -> float:
    return round((value_c * 9.0 / 5.0) + 32.0, 6)


def _boundaries() -> list[ScreeningBoundary]:
    return [
        ScreeningBoundary(
            band=rule.band,
            minimum_f=rule.minimum_f,
            maximum_f=rule.maximum_f,
        )
        for rule in HEAT_INDEX_BANDS
    ]


def _sources() -> list[ScreeningSource]:
    return [ScreeningSource(name=item.name, url=item.url) for item in HEAT_INDEX_SOURCES]


def _band_for(heat_index_f: float) -> str:
    for rule in HEAT_INDEX_BANDS:
        if (rule.minimum_f is None or heat_index_f >= rule.minimum_f) and (
            rule.maximum_f is None or heat_index_f < rule.maximum_f
        ):
            return rule.band
    raise ValueError("Heat Index did not match the configured screening bands")


def _contextual_flags(worker: WorkerContext, task: TaskContext) -> list[str]:
    flags: list[str] = []
    if task.workload_level == WorkloadLevel.HEAVY:
        flags.append("strenuous_work_present")
    elif task.workload_level == WorkloadLevel.VERY_HEAVY:
        flags.append("very_strenuous_work_present")
    if not worker.acclimatized:
        flags.append("worker_not_acclimatized")
    if task.direct_sun:
        flags.append("direct_sun_exposure")
    if worker.ppe_level is not None or worker.clothing_factor is not None:
        flags.append("heat_retaining_clothing_context")
    flags.append("exposure_duration_recorded")
    return flags


def _context_controls(flags: list[str]) -> list[str]:
    controls: list[str] = []
    if "worker_not_acclimatized" in flags:
        controls.append("Apply acclimatization precautions and closer supervision.")
    if "strenuous_work_present" in flags or "very_strenuous_work_present" in flags:
        controls.append("Consider reducing physical demands and increasing recovery opportunities.")
    if "direct_sun_exposure" in flags:
        controls.append("Provide shade and limit direct sun or radiant exposure where practicable.")
    if "heat_retaining_clothing_context" in flags:
        controls.append("Account for the added heat burden of clothing or protective equipment.")
    return controls


def screen_heat_index(
    environment: EnvironmentalConditions,
    worker: WorkerContext,
    task: TaskContext,
    *,
    evidence_current: bool,
) -> HeatIndexScreening:
    flags = _contextual_flags(worker, task)
    limitations = list(SCREENING_LIMITATIONS)
    if task.direct_sun:
        limitations.append(
            "The full-sun value is an informational upper-bound screening scenario based on guidance that full sunshine can increase apparent Heat Index by up to 15°F; it is not a measured or provider-reported Heat Index."
        )
    common = {
        "metric": HEAT_INDEX_METRIC,
        "sources": _sources(),
        "policy_version": HEAT_INDEX_POLICY_VERSION,
        "last_reviewed": HEAT_INDEX_POLICY_LAST_REVIEWED,
        "threshold_basis": HEAT_INDEX_THRESHOLD_BASIS,
        "boundaries_f": _boundaries(),
        "limitations": limitations,
        "contextual_flags": flags,
        "exposure_duration_minutes": task.exposure_duration_minutes,
    }
    if not evidence_current:
        return HeatIndexScreening(
            status="insufficient_data",
            heat_index_c=environment.heat_index_c,
            recommended_controls=[],
            **common,
        )
    if environment.heat_index_c is None:
        return HeatIndexScreening(
            status="unavailable",
            recommended_controls=[],
            **common,
        )
    heat_index_f = celsius_to_fahrenheit(environment.heat_index_c)
    band = _band_for(heat_index_f)
    controls = list(dict.fromkeys((*BASE_CONTROLS, *BAND_CONTROLS[band], *_context_controls(flags))))
    return HeatIndexScreening(
        status="available",
        heat_index_c=environment.heat_index_c,
        heat_index_f=heat_index_f,
        band=band,
        full_sun_possible_upper_bound_f=(round(heat_index_f + 15.0, 6) if task.direct_sun else None),
        recommended_controls=controls,
        **common,
    )
