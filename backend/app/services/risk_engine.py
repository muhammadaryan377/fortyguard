"""Deterministic, non-clinical occupational heat-risk assessment engine."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import settings
from app.core.risk_rules import OccupationalRiskRules, USA_OCCUPATIONAL_RULES
from app.models.fortyguard import EnvironmentalConditions
from app.models.risk import (
    OccupationalPolicy,
    RiskAssessment,
    RiskFactor,
    TaskContext,
    WorkerContext,
    WorkloadLevel,
)

ENVIRONMENT_FIELDS = (
    "temperature_c",
    "heat_index_c",
    "apparent_temperature_c",
    "wet_bulb_temperature_c",
    "relative_humidity",
)
THERMAL_FIELDS = ENVIRONMENT_FIELDS[:4]


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _factor(factor: str, value: Any, effect: str) -> RiskFactor:
    return RiskFactor(factor=factor, value=value, effect=effect)


def assess_risk(
    environment: EnvironmentalConditions,
    worker: WorkerContext,
    task: TaskContext,
    *,
    rules: OccupationalRiskRules = USA_OCCUPATIONAL_RULES,
    now: datetime | None = None,
) -> RiskAssessment:
    """Return the same auditable result for the same inputs and evaluation time."""

    current_time = (now or datetime.now(UTC)).astimezone(UTC)
    available = [name for name in ENVIRONMENT_FIELDS if getattr(environment, name) is not None]
    missing = [name for name in ENVIRONMENT_FIELDS if name not in available]
    explanations: list[str] = []
    factors: list[RiskFactor] = []

    for name in available:
        factors.append(_factor(name, getattr(environment, name), "environmental_evidence_available"))

    workload_effect = {
        WorkloadLevel.LIGHT: "lower_exposure_demand",
        WorkloadLevel.MODERATE: "moderate_exposure_demand",
        WorkloadLevel.HEAVY: "increases_exposure_demand",
        WorkloadLevel.VERY_HEAVY: "substantially_increases_exposure_demand",
    }[task.workload_level]
    factors.append(_factor("workload", task.workload_level.value, workload_effect))
    explanations.append(f"{task.workload_level.value.replace('_', ' ').title()} workload supplied.")

    factors.append(
        _factor(
            "acclimatization",
            worker.acclimatized,
            "recognized_exposure_context" if worker.acclimatized else "requires_additional_operational_caution",
        )
    )
    explanations.append(
        "Worker is acclimatized." if worker.acclimatized else "Worker is not acclimatized."
    )

    if task.direct_sun:
        factors.append(_factor("direct_sun", True, "increases_radiant_exposure"))
        explanations.append("Direct-sun exposure is enabled.")
    if task.exposure_duration_minutes:
        factors.append(
            _factor("exposure_duration_minutes", task.exposure_duration_minutes, "exposure_duration_recorded")
        )
    if worker.ppe_level is not None:
        factors.append(_factor("ppe_level", worker.ppe_level.value, "clothing_context_recorded"))
    if worker.clothing_factor is not None:
        factors.append(_factor("clothing_factor", worker.clothing_factor, "clothing_context_recorded"))

    for name in missing:
        explanations.append(f"{name.replace('_', ' ').title()} reading was unavailable.")

    timestamp = _parse_timestamp(environment.timestamp)
    stale = False
    if environment.timestamp is None:
        missing.append("timestamp")
        explanations.append("Environmental timestamp was unavailable; freshness could not be verified.")
    elif timestamp is None:
        missing.append("valid_timestamp")
        explanations.append("Environmental timestamp was malformed; freshness could not be verified.")
    else:
        stale = current_time - timestamp > timedelta(minutes=settings.heatshield_max_data_age_minutes)
        if stale:
            explanations.append(
                f"Environmental reading exceeds the configured {settings.heatshield_max_data_age_minutes}-minute freshness limit."
            )

    has_thermal_evidence = any(name in available for name in THERMAL_FIELDS)
    if not has_thermal_evidence:
        quality = "insufficient"
        risk_level = "insufficient_data"
        explanations.append("No thermal environmental reading was available for an assessment.")
    elif timestamp is None:
        quality = "partial"
        risk_level = "insufficient_data"
        explanations.append("A current operational risk classification requires a valid timestamp.")
    elif stale:
        quality = "stale"
        risk_level = "insufficient_data"
        explanations.append("A current operational risk classification was not produced from stale data.")
    else:
        quality = "good" if not missing else "partial"
        risk_level = "configuration_required"
        explanations.append("Validated occupational threshold configuration has not been supplied.")

    rules_applied: list[str] = []
    if rules.thresholds_configured:
        rules_applied.append("validated_occupational_thresholds")

    return RiskAssessment(
        risk_level=risk_level,
        data_quality=quality,
        available_inputs=available,
        factors=factors,
        missing_inputs=list(dict.fromkeys(missing)),
        explanations=explanations,
        environmental_evidence=environment,
        worker_context=worker,
        task_context=task,
        rules_applied=rules_applied,
        policy=OccupationalPolicy(
            country=rules.country,
            authorities=list(rules.authorities),
            thresholds_configured=rules.thresholds_configured,
        ),
        configuration_version=rules.configuration_version,
    )
