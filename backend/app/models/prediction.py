"""Typed request and response contracts for provider-backed PREDICT Phase 1."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.risk import USSiteLocation


class PredictHeatOutlookRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location: USSiteLocation
    timezone_name: str = "America/Phoenix"
    offset_hours: list[int] = Field(default_factory=lambda: [1, 3, 6, 9, 12], min_length=1, max_length=5)

    @field_validator("timezone_name")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone_name must be a valid IANA timezone") from exc
        return value

    @field_validator("offset_hours")
    @classmethod
    def validate_offsets(cls, value: list[int]) -> list[int]:
        if any(offset < 1 or offset > 12 for offset in value):
            raise ValueError("offset_hours values must be between 1 and 12")
        if len(set(value)) != len(value):
            raise ValueError("offset_hours values must be unique")
        return sorted(value)


class ForecastTemperaturePoint(BaseModel):
    status: Literal["available", "unavailable"]
    offset_hours: int
    requested_local_timestamp: datetime
    requested_utc_timestamp: datetime
    temperature_c: float | None = None
    source: Literal["fortyguard_heatmap"] = "fortyguard_heatmap"
    analytic_type: Literal["tcm"] = "tcm"
    heatmap_activity_id: str | None = None
    extraction_method: Literal["containing_heatmap_feature_value"] | None = None
    error_reason: str | None = None
    selected_feature: dict | None = None


class HeatOutlookSummary(BaseModel):
    available_points: int
    total_points: int
    highest_sampled_temperature_c: float | None = None
    highest_sampled_offset_hours: int | None = None
    highest_sampled_local_timestamp: datetime | None = None
    lowest_sampled_temperature_c: float | None = None
    lowest_sampled_offset_hours: int | None = None
    first_to_last_temperature_change_c: float | None = None
    trend: Literal["rising", "falling", "flat", "mixed", "insufficient_data"]


class PredictHeatOutlookResponse(BaseModel):
    status: Literal["available", "partial", "insufficient_data"]
    source: Literal["fortyguard_heatmap"] = "fortyguard_heatmap"
    location: USSiteLocation
    timezone_name: str
    generated_at: datetime
    forecast_horizon_hours: int
    sample_offsets_hours: list[int]
    points: list[ForecastTemperaturePoint]
    summary: HeatOutlookSummary
    limitations: list[str]
