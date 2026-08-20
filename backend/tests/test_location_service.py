from app.services.location_service import _timezone, normalize_nominatim_place


def test_normalize_nominatim_us_place_enables_fortyguard(monkeypatch):
    monkeypatch.setattr("app.services.location_service._timezone", lambda *_: "America/Chicago")
    result = normalize_nominatim_place({
        "lat": "32.7767",
        "lon": "-96.7970",
        "name": "Dallas",
        "display_name": "Dallas, Dallas County, Texas, United States",
        "address": {
            "city": "Dallas",
            "state": "Texas",
            "country": "United States",
            "country_code": "us",
        },
    })
    assert result["city"] == "Dallas"
    assert result["state"] == "Texas"
    assert result["country"] == "United States"
    assert result["timezone"] == "America/Chicago"
    assert result["fortyguard_supported"] is True
    assert result["coverage"] == "fortyguard_us"


def test_normalize_nominatim_non_us_place_keeps_weather_context(monkeypatch):
    monkeypatch.setattr("app.services.location_service._timezone", lambda *_: "Asia/Karachi")
    result = normalize_nominatim_place({
        "lat": "24.8607",
        "lon": "67.0011",
        "name": "Karachi",
        "display_name": "Karachi, Sindh, Pakistan",
        "address": {
            "city": "Karachi",
            "state": "Sindh",
            "country": "Pakistan",
            "country_code": "pk",
        },
    })
    assert result["country"] == "Pakistan"
    assert result["country_code"] == "pk"
    assert result["fortyguard_supported"] is False
    assert result["coverage"] == "weather_context_only"
    assert result["timezone"] == "Asia/Karachi"


def test_timezone_lookup_uses_longitude_latitude_order(monkeypatch):
    seen = {}

    def fake_get_tz(longitude, latitude):
        seen["coordinates"] = (longitude, latitude)
        return "America/Phoenix"

    monkeypatch.setattr("app.services.location_service.get_tz", fake_get_tz)

    assert _timezone(33.4484, -112.0740) == "America/Phoenix"
    assert seen["coordinates"] == (-112.0740, 33.4484)
