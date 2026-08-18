"""Central occupational-rule configuration for the USA prototype.

No numeric OSHA/NIOSH risk thresholds are configured until a reviewed,
versioned rule set is supplied. The engine must not infer or invent them.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class OccupationalRiskRules:
    configuration_version: str = "usa-mvp-unconfigured-v1"
    country: str = "United States"
    authorities: tuple[str, ...] = ("OSHA", "NIOSH/CDC")
    numeric_thresholds: tuple[float, ...] = ()

    @property
    def thresholds_configured(self) -> bool:
        return bool(self.numeric_thresholds)


USA_OCCUPATIONAL_RULES = OccupationalRiskRules()
