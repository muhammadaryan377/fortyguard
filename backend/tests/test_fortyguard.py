import json
from datetime import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.models.fortyguard import (
    DateTimeFilter,
    EnvironmentalDateTimeFilter,
    EnvironmentalParametersRequest,
    HeatmapRequest,
)
from app.services.fortyguard import (
    FortyGuardAPIError,
    FortyGuardJobFailedError,
    FortyGuardTimeoutError,
    normalize_environmental_result,
)


@pytest.mark.asyncio
async def test_successful_submission_returns_activity_id(client_factory, heatmap_payload):
    client = client_factory(
        lambda request: httpx.Response(
            200, json={"data": {"activity_id": "activity-123"}}, request=request
        )
    )
    assert await client.create_heatmap(HeatmapRequest.model_validate(heatmap_payload)) == "activity-123"
    await client._client.aclose()


@pytest.mark.asyncio
async def test_missing_activity_id(client_factory):
    client = client_factory(
        lambda request: httpx.Response(200, json={"data": {}}, request=request)
    )
    with pytest.raises(FortyGuardAPIError, match="missing activity_id"):
        await client.submit_job("/v1/heatmap", {})
    await client._client.aclose()


@pytest.mark.asyncio
async def test_processing_then_completed(client_factory):
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        status = "Processing" if calls == 1 else "completed"
        data = {"activity_id": "a1", "status": status}
        if calls > 1:
            data["result"] = {"map_data": {}, "stats_data": {}}
        return httpx.Response(200, json={"data": data}, request=request)

    client = client_factory(handler)
    job = await client.wait_for_result("a1", poll_interval=0, max_attempts=2)
    assert job.status == "completed"
    assert job.result == {"map_data": {}, "stats_data": {}}
    await client._client.aclose()


@pytest.mark.asyncio
async def test_failed_job(client_factory):
    client = client_factory(
        lambda request: httpx.Response(
            200,
            json={"data": {"activity_id": "a1", "status": "FAILED"}},
            request=request,
        )
    )
    with pytest.raises(FortyGuardJobFailedError):
        await client.wait_for_result("a1", poll_interval=0, max_attempts=1)
    await client._client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [400, 500])
async def test_provider_http_errors(client_factory, status_code):
    client = client_factory(
        lambda request: httpx.Response(status_code, text="provider error", request=request)
    )
    with pytest.raises(FortyGuardAPIError, match=f"HTTP {status_code}"):
        await client.submit_job("/v1/heatmap", {})
    await client._client.aclose()


@pytest.mark.asyncio
async def test_polling_timeout(client_factory):
    client = client_factory(
        lambda request: httpx.Response(
            200,
            json={"data": {"activity_id": "a1", "status": "processing"}},
            request=request,
        )
    )
    with pytest.raises(FortyGuardTimeoutError):
        await client.wait_for_result("a1", poll_interval=0, max_attempts=2)
    await client._client.aclose()


@pytest.mark.asyncio
async def test_malformed_provider_response(client_factory):
    client = client_factory(
        lambda request: httpx.Response(200, text="not-json", request=request)
    )
    with pytest.raises(FortyGuardAPIError, match="invalid JSON"):
        await client.submit_job("/v1/heatmap", {})
    await client._client.aclose()


def test_normalization_preserves_missing_values_as_none():
    rows = normalize_environmental_result(
        {
            "metadata": {},
            "locations": [{"lat": 33.4484, "lon": -112.0740, "parameters": {}}],
        }
    )
    assert len(rows) == 1
    assert rows[0].location == {"lat": 33.4484, "lon": -112.0740}
    assert rows[0].heat_index_c is None
    assert rows[0].wet_bulb_temperature_c is None


@pytest.mark.asyncio
async def test_api_key_is_not_in_http_error(client_factory):
    client = client_factory(
        lambda request: httpx.Response(
            401, json={"detail": "unauthorized"}, request=request
        )
    )
    with pytest.raises(FortyGuardAPIError) as captured:
        await client.submit_job("/v1/heatmap", {})
    assert "test-secret-key" not in str(captured.value)
    await client._client.aclose()


def test_api_key_is_not_in_fastapi_config_response():
    response = TestClient(app).get("/api/config-check")
    assert response.status_code == 200
    assert '"fortyguard_api_key":' not in response.text
    if settings.fortyguard_api_key:
        assert settings.fortyguard_api_key not in response.text


def test_datetime_filter_provider_times_are_minute_precision():
    date_time = DateTimeFilter(start_date="2026-08-19", start_time=time(19, 53, 13, 990580),
        end_time=time(20, 5, 59, 123456), filter_type=2)

    assert isinstance(date_time.start_time, time)
    assert isinstance(date_time.end_time, time)
    assert date_time.model_dump(mode="json") == {
        "start_date": "2026-08-19", "filter_type": 2, "end_date": None,
        "start_time": "19:53", "end_time": "20:05",
    }


def test_datetime_filter_none_end_time_and_exclude_none_are_safe():
    date_time = DateTimeFilter(start_date="2026-08-19", start_time=time(8, 5), filter_type=1)

    assert date_time.model_dump(mode="json")["end_time"] is None
    payload = date_time.model_dump(mode="json", exclude_none=True)
    assert payload["start_time"] == "08:05"
    assert "end_time" not in payload


def test_heatmap_request_payload_contains_hh_mm_only(heatmap_payload):
    heatmap_payload["date_time"] = {
        "start_date": "2026-08-19", "start_time": "19:53:13.990580",
        "end_time": "20:05:59.123456", "filter_type": 2,
    }
    request = HeatmapRequest.model_validate(heatmap_payload)
    payload = request.model_dump(mode="json", exclude_none=True)
    serialized = json.dumps(payload)

    assert payload["date_time"]["start_time"] == "19:53"
    assert payload["date_time"]["end_time"] == "20:05"
    assert "19:53:13" not in serialized and ".990580" not in serialized
    assert isinstance(request.date_time.start_time, time)


def test_environmental_parameters_payload_contains_hh_mm_only():
    request = EnvironmentalParametersRequest(latitude=33.4484, longitude=-112.074,
        temperature=41.2, date_time=EnvironmentalDateTimeFilter(start_date="2026-08-19",
            start_time=time(19, 53, 13, 990580), filter_type=1))
    payload = request.model_dump(mode="json", exclude_none=True)
    serialized = json.dumps(payload)

    assert payload["date_time"]["start_time"] == "19:53"
    assert "19:53:13" not in serialized and ".990580" not in serialized
    assert isinstance(request.date_time.start_time, time)
