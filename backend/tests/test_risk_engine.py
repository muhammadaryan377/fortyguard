from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import settings
from app.main import app
from app.models.fortyguard import EnvironmentalConditions, FortyGuardJobStatus
from app.models.risk import TaskContext, WorkerContext
from app.services.risk_engine import assess_risk


NOW = datetime(2026, 8, 18, 12, 0, tzinfo=UTC)


def worker(**overrides):
    values = {
        "worker_id": "W-101",
        "site_id": "PHX-SITE-01",
        "zone_id": "ZONE-B",
        "acclimatized": True,
    }
    values.update(overrides)
    return WorkerContext(**values)


def task(**overrides):
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


def environment(**overrides):
    values = {
        "timestamp": NOW.isoformat(),
        "temperature_c": 30.0,
        "raw": {"fixture": "mocked; not a real FortyGuard observation"},
    }
    values.update(overrides)
    return EnvironmentalConditions(**values)


def request_body():
    return {
        "environment": environment().model_dump(mode="json"),
        "worker": worker().model_dump(mode="json"),
        "task": task().model_dump(mode="json"),
    }


def test_missing_environmental_data_is_insufficient():
    result = assess_risk(
        EnvironmentalConditions(timestamp=NOW.isoformat()), worker(), task(), now=NOW
    )
    assert result.risk_level == "insufficient_data"
    assert result.data_quality == "insufficient"


def test_invalid_workload_is_rejected():
    with pytest.raises(ValidationError):
        task(workload_level="extreme")


def test_negative_exposure_duration_is_rejected():
    with pytest.raises(ValidationError):
        task(exposure_duration_minutes=-1)


def test_operational_factors_are_reported():
    result = assess_risk(
        environment(),
        worker(acclimatized=False),
        task(workload_level="heavy", direct_sun=True),
        now=NOW,
    )
    factors = {item.factor: item for item in result.factors}
    assert factors["workload"].value == "heavy"
    assert factors["workload"].effect == "increases_exposure_demand"
    assert factors["acclimatization"].value is False
    assert factors["direct_sun"].value is True


def test_missing_optional_values_do_not_crash():
    result = assess_risk(environment(), worker(), task(), now=NOW)
    assert "heat_index_c" in result.missing_inputs
    assert result.data_quality == "partial"


def test_identical_input_is_deterministic():
    inputs = (environment(), worker(), task())
    first = assess_risk(*inputs, now=NOW)
    second = assess_risk(*inputs, now=NOW)
    assert first.model_dump() == second.model_dump()


def test_stale_data_is_identified():
    stale = environment(timestamp=(NOW - timedelta(hours=2)).isoformat())
    result = assess_risk(stale, worker(), task(), now=NOW)
    assert result.data_quality == "stale"
    assert result.risk_level == "insufficient_data"


def test_unconfigured_rules_do_not_invent_numeric_thresholds():
    result = assess_risk(environment(), worker(), task(), now=NOW)
    assert result.risk_level == "configuration_required"
    assert result.risk_score is None
    assert result.rules_applied == []
    assert result.policy.thresholds_configured is False


def test_assess_api_and_secret_protection(monkeypatch):
    monkeypatch.setattr("app.services.risk_engine.datetime", FixedDateTime)
    response = TestClient(app).post("/api/risk/assess", json=request_body())
    assert response.status_code == 200
    assert response.json()["risk_level"] == "configuration_required"
    if settings.fortyguard_api_key:
        assert settings.fortyguard_api_key not in response.text


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz else NOW.replace(tzinfo=None)


@pytest.mark.asyncio
async def test_assess_live_uses_mocked_existing_fortyguard_client(monkeypatch):
    submit = AsyncMock(return_value="mock-activity")
    wait = AsyncMock(
        return_value=FortyGuardJobStatus(
            activity_id="mock-activity",
            status="Completed",
            result={
                "metadata": {"timestamps": [NOW.isoformat()]},
                "locations": [
                    {
                        "lat": 33.4484,
                        "lon": -112.0740,
                        "temperature": 30.0,
                        "parameters": {"relative_humidity_percent": [25.0]},
                    }
                ],
            },
        )
    )
    monkeypatch.setattr(
        "app.api.risk.fortyguard_client.get_environmental_parameters", submit
    )
    monkeypatch.setattr("app.api.risk.fortyguard_client.wait_for_result", wait)
    monkeypatch.setattr("app.services.risk_engine.datetime", FixedDateTime)

    payload = {
        "location": {
            "site_id": "PHX-SITE-01",
            "name": "Phoenix Outdoor Construction Site",
            "city": "Phoenix",
            "state": "Arizona",
            "country": "United States",
            "latitude": 33.4484,
            "longitude": -112.0740,
        },
        "temperature_c": 30.0,
        "date_time": {
            "start_date": "2026-08-18",
            "start_time": "12:00",
            "filter_type": 1,
        },
        "worker": worker().model_dump(mode="json"),
        "task": task(workload_level="heavy", direct_sun=True).model_dump(mode="json"),
    }
    response = TestClient(app).post("/api/risk/assess-live", json=payload)
    assert response.status_code == 200
    assert response.json()["risk_level"] == "configuration_required"
    submit.assert_awaited_once()
    wait.assert_awaited_once_with("mock-activity")
