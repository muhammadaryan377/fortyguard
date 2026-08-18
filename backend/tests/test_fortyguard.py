import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.models.fortyguard import HeatmapRequest
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
        {"metadata": {}, "locations": [{"lat": 25.2, "lon": 55.3, "parameters": {}}]}
    )
    assert len(rows) == 1
    assert rows[0].location == {"lat": 25.2, "lon": 55.3}
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
