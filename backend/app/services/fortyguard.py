"""Async FortyGuard API client and provider-data normalization."""

from __future__ import annotations

import asyncio
import logging
from time import monotonic
from typing import Any

import httpx

from app.core.config import settings
from app.models.fortyguard import (
    EnvironmentalConditions,
    EnvironmentalParametersRequest,
    FortyGuardJobStatus,
    HeatmapRequest,
    HeatmapResult,
)

logger = logging.getLogger(__name__)


class FortyGuardError(Exception):
    """Base exception for controlled FortyGuard failures."""


class FortyGuardConfigurationError(FortyGuardError):
    """Raised when required client configuration is unavailable."""


class FortyGuardAPIError(FortyGuardError):
    """Raised for transport, HTTP, or malformed-response errors."""


class FortyGuardJobFailedError(FortyGuardError):
    """Raised when FortyGuard reports a failed job."""


class FortyGuardTimeoutError(FortyGuardError):
    """Raised when polling does not complete within configured limits."""


class FortyGuardClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = settings.fortyguard_api_key if api_key is None else api_key
        self.base_url = (base_url or settings.fortyguard_base_url).rstrip("/")
        self.timeout = timeout or settings.fortyguard_timeout_seconds
        self._client = client

    @property
    def headers(self) -> dict[str, str]:
        if not self.api_key:
            raise FortyGuardConfigurationError("FortyGuard API key is not configured")
        return {"api-key": self.api_key, "Content-Type": "application/json"}

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=self.timeout)
        try:
            response = await client.request(
                method, f"{self.base_url}{path}", headers=self.headers, **kwargs
            )
            response.raise_for_status()
            try:
                body = response.json()
            except ValueError as exc:
                raise FortyGuardAPIError("FortyGuard returned invalid JSON") from exc
            if not isinstance(body, dict):
                raise FortyGuardAPIError("FortyGuard returned an invalid response object")
            return body
        except httpx.TimeoutException as exc:
            raise FortyGuardTimeoutError("FortyGuard request timed out") from exc
        except httpx.HTTPStatusError as exc:
            raise FortyGuardAPIError(
                f"FortyGuard returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.RequestError as exc:
            raise FortyGuardAPIError("Unable to reach FortyGuard") from exc
        finally:
            if owns_client:
                await client.aclose()

    async def submit_job(self, endpoint: str, payload: dict[str, Any]) -> str:
        started = monotonic()
        body = await self._request("POST", endpoint, json=payload)
        data = body.get("data")
        activity_id = data.get("activity_id") if isinstance(data, dict) else None
        if not isinstance(activity_id, str) or not activity_id.strip():
            raise FortyGuardAPIError("FortyGuard response is missing activity_id")
        logger.info(
            "fortyguard_job_submitted endpoint=%s activity_id=%s duration_ms=%d",
            endpoint,
            activity_id,
            int((monotonic() - started) * 1000),
        )
        return activity_id

    async def get_status(self, activity_id: str) -> FortyGuardJobStatus:
        body = await self._request("GET", f"/v1/status/{activity_id}")
        data = body.get("data")
        if not isinstance(data, dict):
            raise FortyGuardAPIError("FortyGuard status response is missing data")
        status = data.get("status")
        provider_activity_id = data.get("activity_id", activity_id)
        if not isinstance(status, str) or not status.strip():
            raise FortyGuardAPIError("FortyGuard status response is missing status")
        result = data.get("result")
        if result is not None and not isinstance(result, dict):
            raise FortyGuardAPIError("FortyGuard result has an invalid shape")
        logger.info("fortyguard_job_status activity_id=%s status=%s", activity_id, status)
        return FortyGuardJobStatus(
            activity_id=str(provider_activity_id), status=status, result=result, raw=body
        )

    async def wait_for_result(
        self,
        activity_id: str,
        *,
        poll_interval: float | None = None,
        max_attempts: int | None = None,
    ) -> FortyGuardJobStatus:
        interval = settings.fortyguard_poll_interval_seconds if poll_interval is None else poll_interval
        attempts = settings.fortyguard_max_poll_attempts if max_attempts is None else max_attempts
        if attempts < 1 or interval < 0:
            raise ValueError("Polling controls must be non-negative and include an attempt")
        for attempt in range(1, attempts + 1):
            job = await self.get_status(activity_id)
            normalized_status = job.status.strip().casefold()
            if normalized_status in {"completed", "succeeded"}:
                if job.result is None:
                    raise FortyGuardAPIError("Completed FortyGuard job is missing result")
                return job
            if normalized_status in {"failed", "error"}:
                raise FortyGuardJobFailedError(
                    f"FortyGuard activity {activity_id} failed with status {job.status}"
                )
            if attempt < attempts:
                await asyncio.sleep(interval)
        raise FortyGuardTimeoutError(
            f"FortyGuard activity {activity_id} did not complete after {attempts} attempts"
        )

    async def create_heatmap(self, request: HeatmapRequest) -> str:
        return await self.submit_job(
            "/v1/heatmap", request.model_dump(mode="json", exclude_none=True)
        )

    async def get_environmental_parameters(
        self, request: EnvironmentalParametersRequest
    ) -> str:
        return await self.submit_job(
            "/v1/env_params", request.model_dump(mode="json", exclude_none=True)
        )


def normalize_heatmap_result(result: dict[str, Any]) -> HeatmapResult:
    map_data = result.get("map_data")
    stats_data = result.get("stats_data")
    return HeatmapResult(
        map_data=map_data if isinstance(map_data, dict) else None,
        stats_data=stats_data if isinstance(stats_data, dict) else None,
        raw=result,
    )


def _number_at(value: Any, index: int) -> float | None:
    candidate = value[index] if isinstance(value, list) and index < len(value) else value
    if isinstance(candidate, (int, float)) and not isinstance(candidate, bool):
        return float(candidate)
    return None


def normalize_environmental_result(result: dict[str, Any]) -> list[EnvironmentalConditions]:
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    timestamps = metadata.get("timestamps") if isinstance(metadata.get("timestamps"), list) else []
    locations = result.get("locations") if isinstance(result.get("locations"), list) else []
    normalized: list[EnvironmentalConditions] = []
    for location in locations:
        if not isinstance(location, dict):
            continue
        parameters = location.get("parameters") if isinstance(location.get("parameters"), dict) else {}
        series_lengths = [len(value) for value in parameters.values() if isinstance(value, list)]
        count = max(1, len(timestamps), *series_lengths)
        for index in range(count):
            normalized.append(
                EnvironmentalConditions(
                    location={key: location[key] for key in ("lat", "lon", "elevation") if key in location},
                    timestamp=str(timestamps[index]) if index < len(timestamps) else None,
                    temperature_c=_number_at(location.get("temperature"), index),
                    heat_index_c=_number_at(parameters.get("heat_index_celsius"), index),
                    apparent_temperature_c=_number_at(parameters.get("apparent_temperature_celsius"), index),
                    wet_bulb_temperature_c=_number_at(parameters.get("wet_bulb_temperature_celsius"), index),
                    relative_humidity=_number_at(parameters.get("relative_humidity_percent"), index),
                    raw={"location": location, "metadata": metadata},
                )
            )
    return normalized


fortyguard_client = FortyGuardClient()
