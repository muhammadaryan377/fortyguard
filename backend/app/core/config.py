from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    fortyguard_api_key: str = ""
    fortyguard_base_url: str = "https://api.fortyguard.com"
    fortyguard_timeout_seconds: float = 30.0
    fortyguard_poll_interval_seconds: float = 2.0
    fortyguard_max_poll_attempts: int = 60
    heatshield_demo_country: str = "United States"
    heatshield_demo_city: str = "Phoenix"
    heatshield_demo_state: str = "Arizona"
    heatshield_demo_latitude: float = 33.4484
    heatshield_demo_longitude: float = -112.0740
    heatshield_max_data_age_minutes: int = 30
    heatshield_max_future_skew_minutes: int = 5
    heatshield_site_polygon_radius_meters: float = 75.0
    heatshield_live_granularity_meters: Literal[60, 80, 100] = 60
    heatshield_timestamp_tolerance_minutes: int = 5

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
