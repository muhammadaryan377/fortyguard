import pytest

from app.services.location_service import UnsupportedLocationError, normalize_nominatim_place


def test_normalize_nominatim_us_place_builds_heatshield_location(monkeypatch):
    monkeypatch.setattr("app.services.location_service._timezone", lambda *_: "America/Chicago")
    result = normalize_nominatim_place({
        "lat": "32.7767",
        "lon": "-96.7970",
        "name": "Dallas",
        "display_name": "Dallas, Dallas County, Texas, United States",
        "address": {
            "city": "Dallas",
            "state": "Texas",
            "country_code": "us",
        },
    })
    assert result["city"] == "Dallas"
    assert result["state"] == "Texas"
    assert result["country"] == "United States"
    assert result["timezone"] == "America/Chicago"


def test_normalize_nominatim_rejects_non_us(monkeypatch):
    monkeypatch.setattr("app.services.location_service._timezone", lambda *_: "Asia/Karachi")
    with pytest.raises(UnsupportedLocationError):
        normalize_nominatim_place({
            "lat": "24.8607",
            "lon": "67.0011",
            "display_name": "Karachi, Pakistan",
            "address": {"city": "Karachi", "state": "Sindh", "country_code": "pk"},
        })
