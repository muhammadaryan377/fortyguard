from datetime import UTC, datetime, timedelta

import pytest

from app.core.screening_rules import HEAT_INDEX_POLICY_VERSION
from app.models.fortyguard import EnvironmentalConditions
from app.models.risk import TaskContext, WorkerContext
from app.services.heat_index_screening import celsius_to_fahrenheit, screen_heat_index
from app.services.risk_engine import assess_risk


NOW = datetime(2026, 8, 18, 12, 0, tzinfo=UTC)


def fahrenheit_to_celsius(value_f: float) -> float:
    return (value_f - 32.0) * 5.0 / 9.0


def worker(**overrides) -> WorkerContext:
    values = {
        "worker_id": "W-101",
        "site_id": "PHX-SITE-01",
        "acclimatized": True,
    }
    values.update(overrides)
    return WorkerContext(**values)


def task(**overrides) -> TaskContext:
    values = {
        "task_id": "TASK-1",
        "task_name": "Mock outdoor task",
        "workload_level": "moderate",
        "exposure_duration_minutes": 45,
        "outdoor": True,
        "direct_sun": False,
    }
    values.update(overrides)
    return TaskContext(**values)


def environment_at_f(value_f: float, **overrides) -> EnvironmentalConditions:
    values = {
        "timestamp": NOW.isoformat(),
        "temperature_c": 30.0,
        "heat_index_c": fahrenheit_to_celsius(value_f),
        "raw": {"fixture": "mocked; not a real FortyGuard observation"},
    }
    values.update(overrides)
    return EnvironmentalConditions(**values)


@pytest.mark.parametrize(
    ("value_f", "expected_band"),
    [
        (79.999, "below_caution"),
        (80.0, "caution"),
        (89.999, "caution"),
        (90.0, "extreme_caution"),
        (102.999, "extreme_caution"),
        (103.0, "danger"),
        (124.999, "danger"),
        (125.0, "extreme_danger"),
    ],
)
def test_official_nws_boundaries(value_f, expected_band):
    screening = screen_heat_index(
        environment_at_f(value_f), worker(), task(), evidence_current=True
    )
    assert screening.status == "available"
    assert screening.band == expected_band
    assert screening.policy_version == HEAT_INDEX_POLICY_VERSION


def test_celsius_fahrenheit_conversion_is_deterministic():
    assert celsius_to_fahrenheit(0.0) == 32.0
    assert celsius_to_fahrenheit(40.0) == 104.0


def test_missing_heat_index_is_unavailable_without_derivation():
    environment = EnvironmentalConditions(
        timestamp=NOW.isoformat(), temperature_c=35.0, relative_humidity=40.0
    )
    screening = screen_heat_index(environment, worker(), task(), evidence_current=True)
    assert screening.status == "unavailable"
    assert screening.heat_index_c is None
    assert screening.band is None


def test_stale_and_future_evidence_cannot_produce_available_screening():
    stale = assess_risk(
        environment_at_f(100.0, timestamp=(NOW - timedelta(hours=2)).isoformat()),
        worker(),
        task(),
        now=NOW,
    )
    future = assess_risk(
        environment_at_f(100.0, timestamp=(NOW + timedelta(minutes=6)).isoformat()),
        worker(),
        task(),
        now=NOW,
    )
    assert stale.risk_level == "insufficient_data"
    assert stale.screening.status == "insufficient_data"
    assert future.risk_level == "insufficient_data"
    assert future.screening.status == "insufficient_data"


@pytest.mark.parametrize(
    ("worker_overrides", "task_overrides", "expected_flag"),
    [
        ({}, {"workload_level": "heavy"}, "strenuous_work_present"),
        ({}, {"workload_level": "very_heavy"}, "very_strenuous_work_present"),
        ({"acclimatized": False}, {}, "worker_not_acclimatized"),
        ({}, {"direct_sun": True}, "direct_sun_exposure"),
        ({"ppe_level": "heavy"}, {}, "heat_retaining_clothing_context"),
        ({"clothing_factor": 1.0}, {}, "heat_retaining_clothing_context"),
    ],
)
def test_contextual_flags(worker_overrides, task_overrides, expected_flag):
    screening = screen_heat_index(
        environment_at_f(95.0),
        worker(**worker_overrides),
        task(**task_overrides),
        evidence_current=True,
    )
    assert expected_flag in screening.contextual_flags


def test_direct_sun_upper_bound_is_informational_not_provider_value():
    screening = screen_heat_index(
        environment_at_f(90.0), worker(), task(direct_sun=True), evidence_current=True
    )
    assert screening.heat_index_f == 90.0
    assert screening.full_sun_possible_upper_bound_f == 105.0
    assert screening.band == "extreme_caution"
    assert any("not a measured or provider-reported" in item for item in screening.limitations)


def test_same_input_is_deterministic_and_no_score_is_invented():
    inputs = (environment_at_f(103.0), worker(), task(workload_level="heavy"))
    first = assess_risk(*inputs, now=NOW)
    second = assess_risk(*inputs, now=NOW)
    assert first.model_dump() == second.model_dump()
    assert first.risk_score is None
    assert first.risk_level == "configuration_required"


def test_wet_bulb_temperature_is_never_interpreted_as_wbgt_or_heat_index():
    environment = EnvironmentalConditions(
        timestamp=NOW.isoformat(), temperature_c=30.0, wet_bulb_temperature_c=24.0
    )
    result = assess_risk(environment, worker(), task(), now=NOW)
    assert result.screening.status == "unavailable"
    assert result.screening.heat_index_c is None
    assert any("not WBGT" in item for item in result.screening.limitations)


def test_recommendations_are_operational_not_clinical():
    screening = screen_heat_index(
        environment_at_f(125.0),
        worker(acclimatized=False),
        task(workload_level="very_heavy", direct_sun=True),
        evidence_current=True,
    )
    joined = " ".join(screening.recommended_controls).lower()
    assert "hydration" in joined
    assert "rescheduling" in joined
    assert "diagnos" not in joined
    assert "treat" not in joined
