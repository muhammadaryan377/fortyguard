"""Secondary operational weather context for HeatShield Product V4.

FortyGuard remains the primary heat evidence provider. This module fetches
non-decision weather context (air temperature, wind, UV, precipitation,
sunrise/sunset and AQI) from Open-Meteo so supervisors can plan field work.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import httpx


FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"


class WeatherContextError(RuntimeError):
    """Raised when the secondary weather context cannot be loaded."""


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _aqi_category(value: float | None) -> str | None:
    if value is None:
        return None
    if value <= 50:
        return "good"
    if value <= 100:
        return "moderate"
    if value <= 150:
        return "unhealthy_for_sensitive_groups"
    if value <= 200:
        return "unhealthy"
    if value <= 300:
        return "very_unhealthy"
    return "hazardous"


def _weather_code_label(code: float | None) -> str | None:
    if code is None:
        return None
    value = int(code)
    if value == 0:
        return "Clear"
    if value in {1, 2}:
        return "Mostly clear"
    if value == 3:
        return "Overcast"
    if value in {45, 48}:
        return "Fog"
    if value in {51, 53, 55, 56, 57}:
        return "Drizzle"
    if value in {61, 63, 65, 66, 67, 80, 81, 82}:
        return "Rain"
    if value in {71, 73, 75, 77, 85, 86}:
        return "Snow"
    if value in {95, 96, 99}:
        return "Thunderstorm"
    return "Mixed conditions"


def _hourly_rows(payload: dict[str, Any], limit: int = 8) -> list[dict[str, Any]]:
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    rows = []
    for index, timestamp in enumerate(times[:limit]):
        def at(field: str):
            values = hourly.get(field) or []
            return values[index] if index < len(values) else None

        rows.append(
            {
                "local_time": timestamp,
                "temperature_2m_c": _number(at("temperature_2m")),
                "apparent_temperature_c": _number(at("apparent_temperature")),
                "relative_humidity_percent": _number(at("relative_humidity_2m")),
                "precipitation_probability_percent": _number(at("precipitation_probability")),
                "wind_speed_kmh": _number(at("wind_speed_10m")),
                "uv_index": _number(at("uv_index")),
                "weather_code": _number(at("weather_code")),
                "condition": _weather_code_label(_number(at("weather_code"))),
            }
        )
    return rows


def _daily_rows(payload: dict[str, Any], limit: int = 2) -> list[dict[str, Any]]:
    daily = payload.get("daily") or {}
    dates = daily.get("time") or []
    rows = []
    for index, date in enumerate(dates[:limit]):
        def at(field: str):
            values = daily.get(field) or []
            return values[index] if index < len(values) else None

        rows.append(
            {
                "date": date,
                "temperature_max_c": _number(at("temperature_2m_max")),
                "temperature_min_c": _number(at("temperature_2m_min")),
                "apparent_temperature_max_c": _number(at("apparent_temperature_max")),
                "uv_index_max": _number(at("uv_index_max")),
                "sunrise": at("sunrise"),
                "sunset": at("sunset"),
                "precipitation_probability_max_percent": _number(at("precipitation_probability_max")),
            }
        )
    return rows


def build_weather_context(
    forecast_payload: dict[str, Any],
    air_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    current = forecast_payload.get("current") or {}
    air_current = (air_payload or {}).get("current") or {}
    current_code = _number(current.get("weather_code"))
    us_aqi = _number(air_current.get("us_aqi"))

    return {
        "source": "Open-Meteo",
        "role": "secondary_operational_weather_context",
        "generated_at": datetime.now(UTC).isoformat(),
        "timezone": forecast_payload.get("timezone"),
        "current": {
            "observation_time": current.get("time"),
            "temperature_2m_c": _number(current.get("temperature_2m")),
            "apparent_temperature_c": _number(current.get("apparent_temperature")),
            "relative_humidity_percent": _number(current.get("relative_humidity_2m")),
            "precipitation_mm": _number(current.get("precipitation")),
            "wind_speed_kmh": _number(current.get("wind_speed_10m")),
            "wind_direction_degrees": _number(current.get("wind_direction_10m")),
            "wind_gusts_kmh": _number(current.get("wind_gusts_10m")),
            "cloud_cover_percent": _number(current.get("cloud_cover")),
            "pressure_msl_hpa": _number(current.get("pressure_msl")),
            "weather_code": current_code,
            "condition": _weather_code_label(current_code),
            "is_day": current.get("is_day"),
        },
        "hourly": _hourly_rows(forecast_payload),
        "daily": _daily_rows(forecast_payload),
        "air_quality": {
            "us_aqi": us_aqi,
            "category": _aqi_category(us_aqi),
            "pm2_5_ug_m3": _number(air_current.get("pm2_5")),
            "pm10_ug_m3": _number(air_current.get("pm10")),
            "ozone_ug_m3": _number(air_current.get("ozone")),
            "uv_index": _number(air_current.get("uv_index")),
            "available": bool(air_current),
        },
        "limitations": [
            "FortyGuard remains the primary HeatShield heat evidence source.",
            "Open-Meteo values are secondary weather and air-quality context, not a replacement for FortyGuard heat evidence.",
            "Weather model grid values may differ from the exact worksite microclimate.",
            "AQI context is not an occupational exposure determination.",
        ],
    }


async def fetch_weather_context(
    latitude: float,
    longitude: float,
    timezone_name: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    owns_client = client is None
    session = client or httpx.AsyncClient(timeout=12.0)

    forecast_params = {
        "latitude": latitude,
        "longitude": longitude,
        "timezone": timezone_name,
        "current": ",".join(
            [
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "is_day",
                "precipitation",
                "weather_code",
                "cloud_cover",
                "pressure_msl",
                "wind_speed_10m",
                "wind_direction_10m",
                "wind_gusts_10m",
            ]
        ),
        "hourly": ",".join(
            [
                "temperature_2m",
                "apparent_temperature",
                "relative_humidity_2m",
                "precipitation_probability",
                "weather_code",
                "wind_speed_10m",
                "uv_index",
            ]
        ),
        "daily": ",".join(
            [
                "temperature_2m_max",
                "temperature_2m_min",
                "apparent_temperature_max",
                "uv_index_max",
                "sunrise",
                "sunset",
                "precipitation_probability_max",
            ]
        ),
        "forecast_hours": 8,
        "forecast_days": 2,
    }
    air_params = {
        "latitude": latitude,
        "longitude": longitude,
        "timezone": timezone_name,
        "current": "us_aqi,pm2_5,pm10,ozone,uv_index",
    }

    async def get(url: str, params: dict[str, Any]) -> dict[str, Any]:
        response = await session.get(url, params=params)
        response.raise_for_status()
        return response.json()

    try:
        forecast_result, air_result = await asyncio.gather(
            get(FORECAST_URL, forecast_params),
            get(AIR_QUALITY_URL, air_params),
            return_exceptions=True,
        )
        if isinstance(forecast_result, Exception):
            raise WeatherContextError("Secondary weather context is unavailable.") from forecast_result
        air_payload = None if isinstance(air_result, Exception) else air_result
        return build_weather_context(forecast_result, air_payload)
    finally:
        if owns_client:
            await session.aclose()
