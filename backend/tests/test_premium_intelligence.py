from datetime import UTC, datetime

import pytest

from app.main import app
from app.models.fortyguard import FortyGuardJobStatus
from app.models.premium import PremiumLocationIntelligenceRequest
from app.services.premium_intelligence import create_premium_location_intelligence


NOW = datetime(2026, 8, 21, 18, 0, tzinfo=UTC)


class PremiumClient:
    async def create_satellite_segmentation(self, payload):
        assert payload["sat"] == {"latitude": 33.4484, "longitude": -112.074}
        assert payload["granularity"] == 80
        return "sat-1"

    async def create_street_view_segmentation(self, payload):
        assert payload["latitude"] == 33.4484
        assert payload["longitude"] == -112.074
        assert payload["horizontal_angle"] == 90.0
        return "street-1"

    async def wait_for_result(self, activity_id):
        if activity_id == "sat-1":
            return FortyGuardJobStatus(
                activity_id=activity_id,
                status="Completed",
                result={
                    "orignal_image": ["U0FURUxMSVRF"],
                    "image_year": 2025,
                    "coordinates": {"latitude": "33.4484", "longitude": "-112.074"},
                    "segmentation": {
                        "image_content": "U0VHTUVOVEVE",
                        "segments": {"vegetation": 22.5, "road": 31.0},
                        "image_legend": {"vegetation": "green", "road": "gray"},
                        "image_dimensions": {"width": 512, "height": 512},
                    },
                },
            )
        return FortyGuardJobStatus(
            activity_id=activity_id,
            status="Completed",
            result={
                "coordinates": {"latitude": "33.4484", "longitude": "-112.074"},
                "front": {
                    "original_image": "U1RSRUVU",
                    "segmented_image": "U1RSRUVUX1NFRw==",
                    "segments": {"vegetation": 18.0, "building": 42.0},
                    "image_legend": {"vegetation": "green", "building": "blue"},
                    "image_date": "2025-06-14",
                },
            },
        )


class SatelliteOnlyClient(PremiumClient):
    async def create_street_view_segmentation(self, payload):
        raise RuntimeError("street provider unavailable")


@pytest.mark.asyncio
async def test_premium_location_intelligence_normalizes_original_and_segmented_images():
    result = await create_premium_location_intelligence(
        PremiumLocationIntelligenceRequest(
            latitude=33.4484,
            longitude=-112.074,
            timezone_name="America/Phoenix",
        ),
        client=PremiumClient(),
        clock=lambda: NOW,
    )

    assert result.status == "available"
    assert result.satellite.original_image_data_uri == "data:image/png;base64,U0FURUxMSVRF"
    assert result.satellite.segmented_image_data_uri == "data:image/png;base64,U0VHTUVOVEVE"
    assert result.satellite.image_year == 2025
    assert result.street_view.original_image_data_uri == "data:image/png;base64,U1RSRUVU"
    assert result.street_view.segmented_image_data_uri == "data:image/png;base64,U1RSRUVUX1NFRw=="
    assert result.street_view.image_date == "2025-06-14"
    assert result.street_view.segments["building"] == 42.0


@pytest.mark.asyncio
async def test_premium_location_intelligence_preserves_partial_success():
    result = await create_premium_location_intelligence(
        PremiumLocationIntelligenceRequest(
            latitude=33.4484,
            longitude=-112.074,
        ),
        client=SatelliteOnlyClient(),
        clock=lambda: NOW,
    )

    assert result.status == "partial"
    assert result.satellite is not None
    assert result.street_view is None
    assert any("Street View intelligence was unavailable" in item for item in result.limitations)


def test_premium_location_intelligence_endpoint_registered():
    assert "/api/premium/location-intelligence" in app.openapi()["paths"]
