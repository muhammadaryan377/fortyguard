from unittest.mock import AsyncMock
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.fortyguard import FortyGuardJobStatus
from app.models.risk import LiveDateTimeFilter, LiveRiskAssessmentRequest, USSiteLocation
from app.services.fortyguard import FortyGuardTimeoutError
from app.services.live_environment import (
    ObservationUnavailableError,
    TemperatureUnavailableError,
    TimestampMismatchError,
    build_site_polygon,
    extract_verified_temperature,
    get_live_environment,
    match_single_observation,
)
from app.services.fortyguard import normalize_environmental_result


def phoenix_location() -> USSiteLocation:
    return USSiteLocation(
        site_id="PHX-SITE-01",
        name="Phoenix Outdoor Construction Site",
        city="Phoenix",
        state="Arizona",
        country="United States",
        latitude=33.4484,
        longitude=-112.0740,
    )


def live_time() -> LiveDateTimeFilter:
    return LiveDateTimeFilter(
        start_date="2026-08-18", start_time="12:00", filter_type=1
    )


def live_payload() -> dict:
    return {
        "location": phoenix_location().model_dump(mode="json"),
        "date_time": live_time().model_dump(mode="json"),
        "worker": {
            "worker_id": "W-101",
            "site_id": "PHX-SITE-01",
            "acclimatized": True,
        },
        "task": {
            "task_id": "TASK-1",
            "task_name": "Mock task",
            "workload_level": "heavy",
            "exposure_duration_minutes": 45,
            "outdoor": True,
            "direct_sun": True,
        },
    }


def heatmap_result(value: float | None = 41.2) -> dict:
    properties = {} if value is None else {"value": value}
    return {
        "map_data": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [-112.075, 33.447],
                            [-112.073, 33.447],
                            [-112.073, 33.449],
                            [-112.075, 33.449],
                            [-112.075, 33.447],
                        ]],
                    },
                }
            ],
        },
        "stats_data": {
            "Temperature_stats": {"Minimum": 39.0, "Maximum": 43.0, "Mean": 41.0}
        },
    }


def environment_result(timestamps=None) -> dict:
    return {
        "metadata": {"timestamps": timestamps or ["2026-08-18T12:00:00-07:00"]},
        "locations": [
            {
                "lat": 33.4484,
                "lon": -112.0740,
                "temperature": 41.2,
                "parameters": {
                    "heat_index_celsius": [42.0],
                    "relative_humidity_percent": [20.0],
                    "wet_bulb_temperature_celsius": [22.0],
                },
            }
        ],
    }


def test_live_request_does_not_require_manual_temperature():
    parsed = LiveRiskAssessmentRequest.model_validate(live_payload())
    assert not hasattr(parsed, "temperature_c")
    invalid = live_payload() | {"temperature_c": 99.0}
    with pytest.raises(Exception):
        LiveRiskAssessmentRequest.model_validate(invalid)


def test_site_polygon_is_closed_and_uses_lon_lat_order():
    polygon = build_site_polygon(33.4484, -112.0740, radius_meters=75)
    ring = polygon.features[0].geometry.coordinates[0]
    assert ring[0] == ring[-1]
    assert len(ring) == 5
    assert ring[0][0] < -112.0740
    assert ring[0][1] < 33.4484


def test_temperature_extraction_uses_containing_feature_value():
    verified = extract_verified_temperature(
        heatmap_result()["map_data"],
        latitude=33.4484,
        longitude=-112.0740,
        timestamp="2026-08-18T12:00",
        activity_id="heatmap-1",
    )
    assert verified.temperature_c == 41.2
    assert verified.activity_id == "heatmap-1"
    assert verified.extraction_method == "containing_heatmap_feature_value"


def test_site_outside_every_tile_fails_without_nearest_fallback():
    with pytest.raises(TemperatureUnavailableError, match="No containing"):
        extract_verified_temperature(
            heatmap_result()["map_data"],
            latitude=33.4600,
            longitude=-112.0900,
            timestamp="2026-08-18T12:00",
            activity_id="heatmap-1",
        )


def test_temperature_extraction_never_falls_back_to_stats():
    with pytest.raises(TemperatureUnavailableError):
        extract_verified_temperature(
            heatmap_result(value=None)["map_data"],
            latitude=33.4484,
            longitude=-112.0740,
            timestamp="2026-08-18T12:00",
            activity_id="heatmap-1",
        )


def test_observation_matching_is_deterministic_not_first_item():
    result = environment_result(
        ["2026-08-18T11:00:00-07:00", "2026-08-18T12:00:00-07:00"]
    )
    result["locations"][0]["parameters"]["heat_index_celsius"] = [39.0, 42.0]
    result["locations"][0]["parameters"]["relative_humidity_percent"] = [22.0, 20.0]
    result["locations"][0]["parameters"]["wet_bulb_temperature_celsius"] = [21.0, 22.0]
    observations = normalize_environmental_result(result)
    selected = match_single_observation(
        observations, location=phoenix_location(), date_time=live_time()
    )
    assert selected.timestamp == "2026-08-18T12:00:00-07:00"
    assert selected.heat_index_c == 42.0


def test_missing_and_mismatched_observations_fail_safely():
    with pytest.raises(ObservationUnavailableError):
        match_single_observation([], location=phoenix_location(), date_time=live_time())
    observations = normalize_environmental_result(environment_result(["2026-08-18T13:00:00-07:00"]))
    with pytest.raises(TimestampMismatchError):
        match_single_observation(
            observations, location=phoenix_location(), date_time=live_time()
        )


def test_equally_valid_observations_are_rejected_as_ambiguous():
    result = environment_result(
        ["2026-08-18T12:00:00-07:00", "2026-08-18T12:00:00-07:00"]
    )
    for values in result["locations"][0]["parameters"].values():
        values.append(values[0])
    observations = normalize_environmental_result(result)
    with pytest.raises(TimestampMismatchError, match="ambiguous"):
        match_single_observation(
            observations, location=phoenix_location(), date_time=live_time()
        )


@pytest.mark.asyncio
async def test_heatmap_precedes_env_params_and_provenance_is_preserved():
    events = []
    client = AsyncMock()

    async def create_heatmap(request):
        events.append("heatmap_submit")
        return "heatmap-activity"

    async def get_environmental_parameters(request):
        events.append("env_submit")
        assert request.temperature == 41.2
        return "environment-activity"

    client.create_heatmap.side_effect = create_heatmap
    client.get_environmental_parameters.side_effect = get_environmental_parameters
    client.wait_for_result.side_effect = [
        FortyGuardJobStatus(
            activity_id="heatmap-activity", status="Completed", result=heatmap_result()
        ),
        FortyGuardJobStatus(
            activity_id="environment-activity", status="Completed", result=environment_result()
        ),
    ]
    observation = await get_live_environment(
        phoenix_location(), live_time(), client=client
    )
    assert events == ["heatmap_submit", "env_submit"]
    assert observation.temperature_c == 41.2
    assert observation.provenance.heatmap_activity_id == "heatmap-activity"
    assert observation.provenance.environment_activity_id == "environment-activity"
    assert observation.provenance.matched_provider_timestamp == "2026-08-18T12:00:00-07:00"
    serialized_raw = json.dumps(observation.raw)
    assert "selected_heatmap_feature" in observation.raw
    assert "FeatureCollection" not in serialized_raw
    assert "stats_data" not in serialized_raw


@pytest.mark.asyncio
async def test_failed_temperature_extraction_stops_before_env_params():
    client = AsyncMock()
    client.create_heatmap.return_value = "heatmap-activity"
    client.wait_for_result.return_value = FortyGuardJobStatus(
        activity_id="heatmap-activity",
        status="Completed",
        result=heatmap_result(value=None),
    )
    with pytest.raises(TemperatureUnavailableError):
        await get_live_environment(phoenix_location(), live_time(), client=client)
    client.get_environmental_parameters.assert_not_awaited()


def test_live_timeout_maps_to_504(monkeypatch):
    monkeypatch.setattr(
        "app.api.risk.get_live_environment",
        AsyncMock(side_effect=FortyGuardTimeoutError("FortyGuard request timed out")),
    )
    response = TestClient(app).post("/api/risk/assess-live", json=live_payload())
    assert response.status_code == 504
    assert "api-key" not in response.text.lower()
