"""Validated API contracts and provider-independent FortyGuard data models."""

from __future__ import annotations

from datetime import date, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator


class StrictRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DateTimeFilter(StrictRequestModel):
    start_date: date
    filter_type: Literal[1, 2, 3, 4]
    end_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None

    @field_serializer("start_time", "end_time", when_used="json")
    def serialize_provider_time(self, value: time | None) -> str | None:
        """FortyGuard accepts minute-precision times, not ISO time seconds."""
        return value.strftime("%H:%M") if value is not None else None

    @model_validator(mode="after")
    def validate_filter_fields(self) -> "DateTimeFilter":
        if self.filter_type in (1, 2) and self.start_time is None:
            raise ValueError("start_time is required for filter_type 1 or 2")
        if self.filter_type == 2 and self.end_time is None:
            raise ValueError("end_time is required for filter_type 2")
        if self.filter_type == 4 and self.end_date is None:
            raise ValueError("end_date is required for filter_type 4")
        return self


class EnvironmentalDateTimeFilter(DateTimeFilter):
    filter_type: Literal[1, 2, 3]


class PolygonGeometry(StrictRequestModel):
    type: Literal["Polygon"]
    coordinates: list[list[list[float]]]

    @model_validator(mode="after")
    def validate_coordinates(self) -> "PolygonGeometry":
        if not self.coordinates:
            raise ValueError("Polygon coordinates must contain at least one ring")
        for ring in self.coordinates:
            if len(ring) < 4:
                raise ValueError("A Polygon ring must contain at least four positions")
            for position in ring:
                if len(position) < 2:
                    raise ValueError("Each position must contain longitude and latitude")
                lon, lat = position[:2]
                if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                    raise ValueError("Longitude or latitude is out of range")
            if ring[0][:2] != ring[-1][:2]:
                raise ValueError("Polygon rings must be closed")
        return self


class GeoJSONFeature(StrictRequestModel):
    type: Literal["Feature"]
    properties: dict[str, Any] = Field(default_factory=dict)
    geometry: PolygonGeometry


class PolygonFeatureCollection(StrictRequestModel):
    type: Literal["FeatureCollection"]
    features: list[GeoJSONFeature] = Field(min_length=1)


class HeatmapRequest(StrictRequestModel):
    polygon_aoi: PolygonFeatureCollection
    date_time: DateTimeFilter
    granularity: Literal[60, 80, 100]
    analytic_type: Literal["tcm", "time_of_measure", "exceedance", "persistence"] = "tcm"
    threshold: float | None = None
    direction: Literal["above", "below"] | None = None


class EnvironmentalParametersRequest(StrictRequestModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    temperature: float
    date_time: EnvironmentalDateTimeFilter


class FortyGuardJobSubmission(BaseModel):
    status: Literal["submitted"] = "submitted"
    activity_id: str


class FortyGuardJobStatus(BaseModel):
    model_config = ConfigDict(extra="allow")
    activity_id: str
    status: str
    result: dict[str, Any] | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class HeatmapResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    map_data: dict[str, Any] | None = None
    stats_data: dict[str, Any] | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class VerifiedTemperature(BaseModel):
    source: Literal["fortyguard_heatmap"] = "fortyguard_heatmap"
    latitude: float
    longitude: float
    timestamp: str
    temperature_c: float
    extraction_method: Literal[
        "containing_heatmap_feature_average_temperature",
        "containing_heatmap_feature_temperature",
        "containing_heatmap_feature_value",
    ]
    activity_id: str
    raw: dict[str, Any] = Field(default_factory=dict)


class EnvironmentalProvenance(BaseModel):
    temperature_source: Literal["fortyguard_heatmap"]
    environmental_parameters_source: Literal["fortyguard_env_params"]
    heatmap_activity_id: str
    environment_activity_id: str
    requested_timestamp: str
    matched_provider_timestamp: str
    site_timezone_name: str | None = None
    canonical_observation_timestamp: str | None = None
    temperature_extraction_method: str


class EnvironmentalConditions(BaseModel):
    source: Literal["fortyguard"] = "fortyguard"
    location: dict[str, Any] = Field(default_factory=dict)
    # Provider-orchestrated evidence uses the canonical site-time instant here;
    # the untouched provider value remains in provenance.
    timestamp: str | None = None
    temperature_c: float | None = None
    heat_index_c: float | None = None
    apparent_temperature_c: float | None = None
    # Wet-bulb temperature is not WBGT and must never be evaluated as WBGT.
    wet_bulb_temperature_c: float | None = None
    relative_humidity: float | None = None
    provenance: EnvironmentalProvenance | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
