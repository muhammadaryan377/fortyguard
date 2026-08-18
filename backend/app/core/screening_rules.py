"""Versioned, source-backed Heat Index screening policy.

Bands use lower-inclusive and upper-exclusive boundaries so every numeric
input maps deterministically. This boundary convention resolves shared table
endpoints; it does not create new health thresholds.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ScreeningSource:
    name: str
    url: str


@dataclass(frozen=True)
class HeatIndexBandRule:
    band: str
    minimum_f: float | None
    maximum_f: float | None


HEAT_INDEX_POLICY_VERSION = "heat-index-screening-nws-2026-v1"
HEAT_INDEX_POLICY_LAST_REVIEWED = "2026-08-18"
HEAT_INDEX_METRIC = "provider_heat_index"
HEAT_INDEX_THRESHOLD_BASIS = (
    "National Weather Service Heat Index categories; software boundaries are "
    "lower-inclusive and upper-exclusive."
)

HEAT_INDEX_SOURCES = (
    ScreeningSource(
        "OSHA Heat Hazard Recognition",
        "https://www.osha.gov/heat-exposure/hazards",
    ),
    ScreeningSource(
        "CDC/NIOSH OSHA-NIOSH Heat Safety Tool",
        "https://www.cdc.gov/niosh/heat-stress/communication-resources/app.html",
    ),
    ScreeningSource(
        "CDC/NIOSH Workplace Recommendations",
        "https://www.cdc.gov/niosh/heat-stress/recommendations/",
    ),
    ScreeningSource(
        "National Weather Service Heat Index",
        "https://www.weather.gov/ama/heatindex",
    ),
)

HEAT_INDEX_BANDS = (
    HeatIndexBandRule("below_caution", None, 80.0),
    HeatIndexBandRule("caution", 80.0, 90.0),
    HeatIndexBandRule("extreme_caution", 90.0, 103.0),
    HeatIndexBandRule("danger", 103.0, 125.0),
    HeatIndexBandRule("extreme_danger", 125.0, None),
)

BASE_CONTROLS = (
    "Ensure appropriate hydration is available near the work area.",
    "Monitor changing worksite conditions and worker exposure context.",
)

BAND_CONTROLS = {
    "below_caution": (),
    "caution": (
        "Provide access to shade or a cool recovery area.",
        "Encourage appropriate rest breaks for cooling and hydration.",
    ),
    "extreme_caution": (
        "Increase worker monitoring and recovery opportunities.",
        "Consider reducing strenuous work where operationally appropriate.",
        "Consider scheduling hot work during cooler periods.",
    ),
    "danger": (
        "Increase recovery time in a cool area and limit heat exposure where practicable.",
        "Limit direct sun and other radiant heat exposure where practicable.",
    ),
    "extreme_danger": (
        "Consider rescheduling non-essential hot work to cooler conditions.",
        "Use engineering and work-practice controls to reduce heat exposure.",
    ),
}

SCREENING_LIMITATIONS = (
    "Heat Index is a screening metric and does not determine total occupational heat stress.",
    "This screening is not a WBGT measurement or a NIOSH REL/RAL determination.",
    "Provider wet-bulb temperature is not WBGT and is not used as WBGT.",
    "This result is not a medical diagnosis or legal compliance determination.",
    "Heat Index does not fully account for workload, radiant heat, wind, or heat-retaining clothing.",
)
