from datetime import UTC, date, datetime
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.fortyguard import FortyGuardJobStatus
from app.models.resilience import SiteResilienceRequest
from app.models.risk import USSiteLocation
from app.services.live_environment import build_site_polygon
from app.services.resilience_intelligence import create_site_resilience


NOW = datetime(2026, 8, 21, 18, 0, tzinfo=UTC)


def request(**updates):
    values = {
        "location": USSiteLocation(
            site_id="PHX-01",
            name="Phoenix Yard",
            city="Phoenix",
            state="Arizona",
            latitude=33.4484,
            longitude=-112.0740,
        ),
        "timezone_name": "America/Phoenix",
        "site_polygon": build_site_polygon(33.4484, -112.0740, radius_meters=250),
        "start_date": date(2026, 8, 14),
        "end_date": date(2026, 8, 20),
        "threshold_c": 35.0,
        "granularity": 100,
    }
    values.update(updates)
    return SiteResilienceRequest(**values)


def map_result(values):
    features = []
    for index, value in enumerate(values):
        west = -112.075 + index * 0.001
        east = west + 0.0008
        south, north = 33.4478, 33.4486
        features.append({
            "type": "Feature",
            "properties": {"value": value},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
            },
        })
    return {"map_data": {"type": "FeatureCollection", "features": features}, "stats_data": {"units": "hour"}}


def test_resilience_endpoint_registered():
    assert "/api/resilience/site-history" in app.openapi()["paths"]


def test_resilience_request_rejects_invalid_windows():
    with pytest.raises(ValidationError):
        request(start_date=date(2018, 12, 31))
    with pytest.raises(ValidationError):
        request(start_date=date(2026, 8, 20), end_date=date(2026, 8, 19))
    with pytest.raises(ValidationError):
        request(start_date=date(2026, 7, 1), end_date=date(2026, 8, 20))


@pytest.mark.asyncio
async def test_resilience_uses_exact_site_polygon_and_documented_analytics():
    client = AsyncMock()

    async def create_heatmap(payload):
        return f"activity-{payload.analytic_type}"

    async def wait_for_result(activity_id):
        if activity_id.endswith("exceedance"):
            result = map_result([12, 18])
        elif activity_id.endswith("persistence"):
            result = map_result([4, 7])
        else:
            result = map_result([20, 21])
        return FortyGuardJobStatus(activity_id=activity_id, status="Completed", result=result)

    client.create_heatmap.side_effect = create_heatmap
    client.wait_for_result.side_effect = wait_for_result
    payload = request()
    response = await create_site_resilience(payload, client=client, clock=lambda: NOW)

    assert response.status == "available"
    assert response.exceedance.maximum_value == 18
    assert response.persistence.maximum_value == 7
    assert response.time_of_measure.maximum_value == 21
    assert client.create_heatmap.await_count == 3

    submitted = [call.args[0] for call in client.create_heatmap.await_args_list]
    assert {item.analytic_type for item in submitted} == {"exceedance", "persistence", "time_of_measure"}
    assert all(item.polygon_aoi == payload.site_polygon for item in submitted)
    assert all(item.date_time.filter_type == 4 for item in submitted)
    thresholded = [item for item in submitted if item.analytic_type in {"exceedance", "persistence"}]
    assert all(item.threshold == 35.0 and item.direction == "above" for item in thresholded)


@pytest.mark.asyncio
async def test_resilience_partial_provider_failure_does_not_fabricate_layer():
    client = AsyncMock()

    async def create_heatmap(payload):
        if payload.analytic_type == "persistence":
            raise RuntimeError("provider detail")
        return f"activity-{payload.analytic_type}"

    async def wait_for_result(activity_id):
        return FortyGuardJobStatus(activity_id=activity_id, status="Completed", result=map_result([5]))

    client.create_heatmap.side_effect = create_heatmap
    client.wait_for_result.side_effect = wait_for_result
    response = await create_site_resilience(request(), client=client, clock=lambda: NOW)

    assert response.status == "partial"
    assert response.persistence is None
    assert response.exceedance is not None and response.time_of_measure is not None
    assert any("Persistence provider analysis was unavailable" in item for item in response.limitations)
