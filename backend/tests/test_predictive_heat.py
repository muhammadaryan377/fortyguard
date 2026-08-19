from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import settings
from app.main import app
from app.models.fortyguard import FortyGuardJobStatus
from app.models.prediction import (
    ForecastTemperaturePoint,
    PredictHeatOutlookRequest,
)
from app.models.risk import USSiteLocation
from app.services.predictive_heat import (
    build_forecast_times,
    create_heat_outlook,
    summarize_points,
)


NOW = datetime(2026, 12, 31, 22, 20, tzinfo=UTC)


def location() -> USSiteLocation:
    return USSiteLocation(
        site_id="PHX-SITE-01",
        name="Phoenix Outdoor Construction Site",
        city="Phoenix",
        state="Arizona",
        country="United States",
        latitude=33.4484,
        longitude=-112.0740,
    )


def request(**overrides) -> PredictHeatOutlookRequest:
    values = {"location": location()}
    values.update(overrides)
    return PredictHeatOutlookRequest(**values)


def heatmap_result(value: float, *, contains_site: bool = True) -> dict:
    if contains_site:
        ring = [
            [-112.075, 33.447], [-112.073, 33.447], [-112.073, 33.449],
            [-112.075, 33.449], [-112.075, 33.447],
        ]
    else:
        ring = [
            [-111.1, 34.0], [-111.0, 34.0], [-111.0, 34.1],
            [-111.1, 34.1], [-111.1, 34.0],
        ]
    return {
        "map_data": {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {"average_temperature": value},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }],
        },
        "stats_data": {"Temperature_stats": {"Mean": 99.0}},
    }


def mocked_client(results: list[dict]):
    client = AsyncMock()
    client.create_heatmap.side_effect = [f"forecast-{index}" for index in range(len(results))]
    client.wait_for_result.side_effect = [
        FortyGuardJobStatus(activity_id=f"forecast-{index}", status="Completed", result=result)
        for index, result in enumerate(results)
    ]
    return client


def point(offset: int, temperature: float | None) -> ForecastTemperaturePoint:
    timestamp = datetime(2026, 8, 18, 10 + offset, tzinfo=UTC)
    return ForecastTemperaturePoint(
        status="available" if temperature is not None else "unavailable",
        offset_hours=offset,
        requested_local_timestamp=timestamp,
        requested_utc_timestamp=timestamp,
        temperature_c=temperature,
        heatmap_activity_id=f"a-{offset}" if temperature is not None else None,
        extraction_method="containing_heatmap_feature_value" if temperature is not None else None,
        error_reason=None if temperature is not None else "unavailable",
    )


def test_default_offsets_are_sorted_expected_samples():
    assert request().offset_hours == [1, 3, 6, 9, 12]


@pytest.mark.parametrize("offsets", [[0], [13], [1, 1], [1, 2, 3, 4, 5, 6]])
def test_invalid_offsets_are_rejected(offsets):
    with pytest.raises(ValidationError):
        request(offset_hours=offsets)


def test_offsets_are_sorted_ascending():
    assert request(offset_hours=[12, 1, 6]).offset_hours == [1, 6, 12]


def test_invalid_timezone_is_rejected():
    with pytest.raises(ValidationError):
        request(timezone_name="Mars/Olympus_Mons")


def test_phoenix_timestamps_and_year_rollover_are_timezone_aware():
    values = build_forecast_times(
        request(offset_hours=[1, 3, 12]), now=NOW
    )
    assert values[0][1].isoformat() == "2026-12-31T16:20:00-07:00"
    assert values[1][1].isoformat() == "2026-12-31T18:20:00-07:00"
    assert values[2][1].isoformat() == "2027-01-01T03:20:00-07:00"
    assert values[2][2].isoformat() == "2027-01-01T10:20:00+00:00"


def test_month_and_midnight_rollover():
    now = datetime(2026, 1, 31, 23, 30, tzinfo=UTC)
    values = build_forecast_times(
        request(timezone_name="UTC", offset_hours=[1, 3]), now=now
    )
    assert values[0][1].isoformat() == "2026-02-01T00:30:00+00:00"
    assert values[1][1].isoformat() == "2026-02-01T02:30:00+00:00"


@pytest.mark.asyncio
async def test_all_samples_use_tcm_single_hour_and_existing_polygon():
    client = mocked_client([heatmap_result(30.0), heatmap_result(31.0)])
    outlook = await create_heat_outlook(
        request(offset_hours=[1, 3]), client=client, now=NOW
    )
    assert outlook.status == "available"
    for call in client.create_heatmap.await_args_list:
        heatmap_request = call.args[0]
        assert heatmap_request.analytic_type == "tcm"
        assert heatmap_request.date_time.filter_type == 1
        ring = heatmap_request.polygon_aoi.features[0].geometry.coordinates[0]
        assert ring[0] == ring[-1]
        assert ring[0][0] < location().longitude < ring[1][0]
    client.get_environmental_parameters.assert_not_called()


@pytest.mark.asyncio
async def test_containing_feature_temperature_and_compact_evidence():
    client = mocked_client([heatmap_result(41.2)])
    outlook = await create_heat_outlook(
        request(offset_hours=[1]), client=client, now=NOW
    )
    forecast = outlook.points[0]
    assert forecast.status == "available"
    assert forecast.temperature_c == 41.2
    assert forecast.extraction_method == "containing_heatmap_feature_average_temperature"
    assert forecast.selected_feature["properties"]["average_temperature"] == 41.2
    assert "FeatureCollection" not in outlook.model_dump_json()
    assert "stats_data" not in outlook.model_dump_json()


@pytest.mark.asyncio
async def test_outside_tile_is_unavailable_without_nearest_stats_or_interpolation():
    client = mocked_client([
        heatmap_result(30.0),
        heatmap_result(99.0, contains_site=False),
        heatmap_result(34.0),
    ])
    outlook = await create_heat_outlook(
        request(offset_hours=[1, 3, 6]), client=client, now=NOW
    )
    assert outlook.status == "partial"
    assert [item.temperature_c for item in outlook.points] == [30.0, None, 34.0]
    assert outlook.points[1].status == "unavailable"
    assert "containing" in outlook.points[1].error_reason
    assert 99.0 not in [item.temperature_c for item in outlook.points]
    client.get_environmental_parameters.assert_not_called()


@pytest.mark.asyncio
async def test_all_unavailable_is_insufficient_data():
    client = mocked_client([
        heatmap_result(90.0, contains_site=False),
        heatmap_result(91.0, contains_site=False),
    ])
    outlook = await create_heat_outlook(
        request(offset_hours=[1, 3]), client=client, now=NOW
    )
    assert outlook.status == "insufficient_data"
    assert outlook.summary.available_points == 0
    assert outlook.summary.highest_sampled_temperature_c is None
    assert outlook.summary.trend == "insufficient_data"


@pytest.mark.parametrize(
    ("temperatures", "expected_trend", "expected_change"),
    [
        ([30.0, 31.0, 32.0], "rising", 2.0),
        ([32.0, 31.0, 30.0], "falling", -2.0),
        ([30.0, 30.0, 30.0], "flat", 0.0),
        ([30.0, 32.0, 31.0], "mixed", 1.0),
    ],
)
def test_deterministic_trends_and_summary(temperatures, expected_trend, expected_change):
    summary = summarize_points([
        point(offset, temperature)
        for offset, temperature in zip([1, 3, 6], temperatures)
    ])
    assert summary.trend == expected_trend
    assert summary.first_to_last_temperature_change_c == expected_change
    assert summary.highest_sampled_temperature_c == max(temperatures)
    assert summary.lowest_sampled_temperature_c == min(temperatures)
    assert summary.highest_sampled_offset_hours == [1, 3, 6][temperatures.index(max(temperatures))]
    assert summary.lowest_sampled_offset_hours == [1, 3, 6][temperatures.index(min(temperatures))]


def test_fewer_than_two_points_has_insufficient_trend():
    summary = summarize_points([point(1, None), point(3, 32.0)])
    assert summary.available_points == 1
    assert summary.trend == "insufficient_data"
    assert summary.first_to_last_temperature_change_c is None


@pytest.mark.asyncio
async def test_response_contains_no_future_heat_index_wbgt_risk_or_secret():
    client = mocked_client([heatmap_result(35.0)])
    outlook = await create_heat_outlook(
        request(offset_hours=[1]), client=client, now=NOW
    )
    body = outlook.model_dump_json().lower()
    assert "heat_index_c" not in body
    assert "wet_bulb" not in body
    assert "risk_score" not in body
    if settings.fortyguard_api_key:
        assert settings.fortyguard_api_key not in body
    client.get_environmental_parameters.assert_not_called()


def test_prediction_route_is_registered_and_validates_without_provider_call():
    response = TestClient(app).post(
        "/api/predict/heat-outlook",
        json={
            "location": location().model_dump(mode="json"),
            "timezone_name": "Invalid/Timezone",
            "offset_hours": [1],
        },
    )
    assert response.status_code == 422
    if settings.fortyguard_api_key:
        assert settings.fortyguard_api_key not in response.text
