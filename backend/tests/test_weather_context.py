from app.services.weather_context import build_weather_context


def test_build_weather_context_preserves_secondary_role_and_aqi_category():
    forecast = {
        "timezone": "America/Phoenix",
        "current": {
            "time": "2026-08-20T15:00",
            "temperature_2m": 39.0,
            "relative_humidity_2m": 30,
            "apparent_temperature": 42.0,
            "weather_code": 0,
            "wind_speed_10m": 14.0,
        },
        "hourly": {
            "time": ["2026-08-20T15:00", "2026-08-20T16:00"],
            "temperature_2m": [39.0, 38.0],
            "apparent_temperature": [42.0, 41.0],
            "relative_humidity_2m": [30, 31],
            "precipitation_probability": [0, 0],
            "weather_code": [0, 0],
            "wind_speed_10m": [14, 16],
            "uv_index": [8, 7],
        },
        "daily": {
            "time": ["2026-08-20"],
            "temperature_2m_max": [41],
            "temperature_2m_min": [30],
            "apparent_temperature_max": [44],
            "uv_index_max": [9],
            "sunrise": ["2026-08-20T05:50"],
            "sunset": ["2026-08-20T19:05"],
            "precipitation_probability_max": [0],
        },
    }
    air = {"current": {"us_aqi": 132, "pm2_5": 40.0, "uv_index": 8.0}}
    result = build_weather_context(forecast, air)
    assert result["role"] == "secondary_operational_weather_context"
    assert result["current"]["condition"] == "Clear"
    assert result["air_quality"]["category"] == "unhealthy_for_sensitive_groups"
    assert len(result["hourly"]) == 2
    assert result["daily"][0]["sunset"] == "2026-08-20T19:05"
