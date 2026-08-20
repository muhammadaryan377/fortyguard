"""Secondary weather context endpoint for Product V4."""

from fastapi import APIRouter, HTTPException, Query

from app.services.weather_context import WeatherContextError, fetch_weather_context

router = APIRouter(tags=["weather-context"])


@router.get("/weather/context")
async def weather_context(
    latitude: float = Query(ge=-90.0, le=90.0),
    longitude: float = Query(ge=-180.0, le=180.0),
    timezone_name: str = Query(min_length=1, max_length=100),
):
    try:
        return await fetch_weather_context(latitude, longitude, timezone_name)
    except WeatherContextError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
