from unittest.mock import AsyncMock
import json
from datetime import UTC, datetime
from math import cos, radians

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import Settings, settings
from app.models.fortyguard import FortyGuardJobStatus
from app.models.risk import LiveDateTimeFilter, LiveRiskAssessmentRequest, TaskContext, USSiteLocation, WorkerContext
from app.services.fortyguard import FortyGuardTimeoutError
from app.services.live_environment import (
    ObservationUnavailableError,
    TemperatureUnavailableError,
    TimestampMismatchError,
    build_site_polygon,
    canonical_observation_timestamp,
    extract_verified_temperature,
    get_live_environment,
    match_single_observation,
)
from app.services.fortyguard import normalize_environmental_result
from app.services.risk_engine import assess_risk


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


def los_angeles_location() -> USSiteLocation:
    return USSiteLocation(site_id="LA-1", name="Los Angeles site", city="Los Angeles",
        state="California", latitude=34.0522, longitude=-118.2430)


def live_payload() -> dict:
    return {
        "location": phoenix_location().model_dump(mode="json"),
        "timezone_name": "America/Phoenix",
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


def heatmap_result(value: float | None = 41.2, *, field: str = "average_temperature") -> dict:
    properties = {} if value is None else {field: value}
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


def test_live_request_requires_an_explicit_valid_site_timezone():
    missing = live_payload()
    missing.pop("timezone_name")
    with pytest.raises(Exception):
        LiveRiskAssessmentRequest.model_validate(missing)
    with pytest.raises(Exception):
        LiveRiskAssessmentRequest.model_validate(
            live_payload() | {"timezone_name": "Invalid/Timezone"}
        )


def _polygon_dimensions_meters(polygon, latitude):
    ring = polygon.features[0].geometry.coordinates[0]
    width = (max(point[0] for point in ring) - min(point[0] for point in ring)) * (
        111_320.0 * cos(radians(latitude))
    )
    height = (max(point[1] for point in ring) - min(point[1] for point in ring)) * 111_320.0
    return width, height


def test_site_polygon_default_is_validated_300_meter_radius(monkeypatch):
    assert Settings.model_fields["heatshield_site_polygon_radius_meters"].default == 300.0
    monkeypatch.setattr(settings, "heatshield_site_polygon_radius_meters", 300.0)
    polygon = build_site_polygon(33.4484, -112.0740)
    width, height = _polygon_dimensions_meters(polygon, 33.4484)
    assert width == pytest.approx(600.0)
    assert height == pytest.approx(600.0)


def test_site_polygon_explicit_radius_override_is_preserved(monkeypatch):
    monkeypatch.setattr(settings, "heatshield_site_polygon_radius_meters", 300.0)
    polygon = build_site_polygon(33.4484, -112.0740, radius_meters=75)
    ring = polygon.features[0].geometry.coordinates[0]
    width, height = _polygon_dimensions_meters(polygon, 33.4484)
    assert ring[0] == ring[-1]
    assert len(ring) == 5
    assert ring[0][0] < -112.0740
    assert ring[0][1] < 33.4484
    assert width == pytest.approx(150.0)
    assert height == pytest.approx(150.0)


def test_temperature_extraction_uses_containing_average_temperature():
    verified = extract_verified_temperature(
        heatmap_result()["map_data"],
        latitude=33.4484,
        longitude=-112.0740,
        timestamp="2026-08-18T12:00",
        activity_id="heatmap-1",
    )
    assert verified.temperature_c == 41.2
    assert verified.activity_id == "heatmap-1"
    assert verified.extraction_method == "containing_heatmap_feature_average_temperature"
    assert verified.raw["selected_feature"]["properties"]["average_temperature"] == 41.2


def test_temperature_extraction_supports_explicit_legacy_temperature_field():
    verified = extract_verified_temperature(
        heatmap_result(field="temperature")["map_data"], latitude=33.4484,
        longitude=-112.0740, timestamp="2026-08-18T12:00", activity_id="heatmap-1")
    assert verified.temperature_c == 41.2
    assert verified.extraction_method == "containing_heatmap_feature_temperature"


def test_value_only_analysis_feature_is_not_tcm_temperature():
    with pytest.raises(TemperatureUnavailableError):
        extract_verified_temperature(
            heatmap_result(field="value")["map_data"], latitude=33.4484,
            longitude=-112.0740, timestamp="2026-08-18T12:00", activity_id="heatmap-1")


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


def test_canonical_timestamp_uses_site_timezone_for_summer_and_winter_dst():
    summer = canonical_observation_timestamp("2024-07-15T14:00:00-08:00", "America/Los_Angeles")
    winter = canonical_observation_timestamp("2024-01-15T14:00:00-07:00", "America/Los_Angeles")
    assert summer.isoformat() == "2024-07-15T14:00:00-07:00"
    assert summer.astimezone(UTC) == datetime(2024, 7, 15, 21, tzinfo=UTC)
    assert winter.isoformat() == "2024-01-15T14:00:00-08:00"
    assert winter.astimezone(UTC) == datetime(2024, 1, 15, 22, tzinfo=UTC)


@pytest.mark.parametrize(
    "provider_timestamp, expected_error",
    [
        ("2024-03-10T02:30:00-08:00", "nonexistent"),
        ("2024-11-03T01:30:00-07:00", "ambiguous"),
    ],
)
def test_canonical_timestamp_fails_closed_at_dst_transition(
    provider_timestamp, expected_error
):
    with pytest.raises(TimestampMismatchError, match=expected_error):
        canonical_observation_timestamp(provider_timestamp, "America/Los_Angeles")


@pytest.mark.asyncio
async def test_la_summer_provider_offset_is_preserved_but_assessment_uses_canonical_instant():
    client = AsyncMock()
    heatmap = heatmap_result(33.1689)
    heatmap["map_data"]["features"][0]["geometry"]["coordinates"] = [[
        [-118.244,34.051],[-118.242,34.051],[-118.242,34.053],
        [-118.244,34.053],[-118.244,34.051]]]
    environment = environment_result(["2024-07-15T14:00:00-08:00"])
    environment["locations"][0]["lat"] = 34.0522
    environment["locations"][0]["lon"] = -118.2430
    client.create_heatmap.return_value = "heatmap-la"
    client.get_environmental_parameters.return_value = "environment-la"
    client.wait_for_result.side_effect = [
        FortyGuardJobStatus(activity_id="heatmap-la", status="Completed", result=heatmap),
        FortyGuardJobStatus(activity_id="environment-la", status="Completed", result=environment),
    ]
    date_time = LiveDateTimeFilter(start_date="2024-07-15", start_time="14:00", filter_type=1)
    observation = await get_live_environment(los_angeles_location(), date_time,
        timezone_name="America/Los_Angeles", client=client)

    assert observation.timestamp == "2024-07-15T14:00:00-07:00"
    assert observation.provenance.matched_provider_timestamp == "2024-07-15T14:00:00-08:00"
    assert observation.provenance.canonical_observation_timestamp == observation.timestamp
    assert observation.provenance.site_timezone_name == "America/Los_Angeles"
    worker = WorkerContext(worker_id="W-LA", site_id="LA-1", acclimatized=True)
    task = TaskContext(task_id="T-LA", task_name="LA task", workload_level="moderate",
        exposure_duration_minutes=30, outdoor=True, direct_sun=False)
    fresh = assess_risk(observation, worker, task, now=datetime(2024, 7, 15, 21, tzinfo=UTC))
    stale = assess_risk(observation, worker, task, now=datetime(2024, 7, 15, 22, tzinfo=UTC))
    future = assess_risk(observation, worker, task, now=datetime(2024, 7, 15, 20, 53, tzinfo=UTC))
    assert fresh.risk_level == "configuration_required"
    assert stale.data_quality == "stale" and stale.risk_level == "insufficient_data"
    assert future.data_quality == "insufficient" and future.risk_level == "insufficient_data"


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
        phoenix_location(), live_time(), timezone_name="America/Phoenix", client=client
    )
    assert events == ["heatmap_submit", "env_submit"]
    assert observation.temperature_c == 41.2
    assert observation.provenance.heatmap_activity_id == "heatmap-activity"
    assert observation.provenance.environment_activity_id == "environment-activity"
    assert observation.provenance.matched_provider_timestamp == "2026-08-18T12:00:00-07:00"
    assert observation.provenance.canonical_observation_timestamp == "2026-08-18T12:00:00-07:00"
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
        await get_live_environment(phoenix_location(), live_time(),
            timezone_name="America/Phoenix", client=client)
    client.get_environmental_parameters.assert_not_awaited()


def test_live_timeout_maps_to_504(monkeypatch):
    live_environment = AsyncMock(
        side_effect=FortyGuardTimeoutError("FortyGuard request timed out")
    )
    monkeypatch.setattr("app.api.risk.get_live_environment", live_environment)
    payload = live_payload() | {"timezone_name": "America/Los_Angeles"}
    response = TestClient(app).post("/api/risk/assess-live", json=payload)
    assert response.status_code == 504
    assert "api-key" not in response.text.lower()
    assert live_environment.await_args.kwargs["timezone_name"] == "America/Los_Angeles"
