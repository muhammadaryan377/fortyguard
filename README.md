# HeatShield AI

HeatShield AI is an occupational heat-risk intelligence project. This repository implements the **SENSE** FortyGuard data layer and the deterministic **ASSESS** operational risk layer.

Current prototype geographic scope: **United States**. Default demo: **Phoenix, Arizona**.

No medical diagnosis, AI agent, scheduling, predictive model, or frontend behavior is implemented. No numeric OSHA/NIOSH occupational thresholds are configured because a reviewed threshold configuration has not been supplied.

## Setup

Python 3.12 is recommended.

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` at the repository root and replace the API-key placeholder. Never commit `.env`.

## Run

From `backend/`:

```powershell
python -m uvicorn app.main:app --reload
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

Expected response:

```json
{"status":"ok","service":"HeatShield AI"}
```

## FortyGuard API

Open Swagger at <http://127.0.0.1:8000/docs>. The integration exposes:

- `POST /api/fortyguard/heatmap` — validate and submit a heatmap job
- `GET /api/fortyguard/status/{activity_id}` — inspect a job
- `POST /api/fortyguard/heatmap/result` — submit and poll for a normalized final result
- `POST /api/fortyguard/environment` — submit an environmental-parameters job
- `POST /api/fortyguard/environment/result` — submit, poll, and normalize environmental observations

In Swagger, expand an endpoint, select **Try it out**, use the generated schema/example, and execute it. A successful submission resembles:

```json
{"status":"submitted","activity_id":"provider-generated-id"}
```

A completed high-level heatmap request resembles:

```json
{
  "activity_id": "provider-generated-id",
  "status": "Completed",
  "result": {
    "map_data": {},
    "stats_data": {},
    "raw": {}
  }
}
```

The actual map and statistics content is provider-defined. Missing environmental values remain `null`; HeatShield does not calculate or fabricate them.

## Deterministic risk assessment

- `POST /api/risk/assess` accepts normalized environmental evidence, worker context, and task context.
- `POST /api/risk/assess-live` accepts only a USA site, one requested hour, worker context, and task context. It does not accept a manually entered live temperature.

The live evidence flow is:

```text
Location + requested hour
  ↓
Small deterministic site polygon
  ↓
FortyGuard TCM Heatmap
  ↓
Verified containing GeoJSON tile value
  ↓
FortyGuard Environmental Parameters
  ↓
Timestamp-matched EnvironmentalConditions
  ↓
Deterministic RiskAssessment
```

Heatmap and environmental activity IDs, requested/matched timestamps, extraction method, selected containing feature, and compact provider metadata are preserved as structured provenance. The complete heatmap FeatureCollection is not embedded in live risk responses. If a containing tile value cannot be extracted, environmental observations are absent, or timestamps cannot be matched deterministically, the request fails safely. Nearest tiles and heatmap aggregate mean/minimum/maximum statistics are never substituted for a site temperature.

When environmental evidence is missing, stale, or materially ahead of the configured current-observation clock-skew window, the engine returns `insufficient_data`. Small clock skew is controlled by `HEATSHIELD_MAX_FUTURE_SKEW_MINUTES`. When fresh evidence exists but validated numeric occupational rules are absent, it returns `configuration_required` with a `null` risk score. Operational factors such as workload, acclimatization, direct sun, exposure duration, and PPE are reported without converting them into fabricated medical or numeric risk categories.

Swagger is available at <http://127.0.0.1:8000/docs>. A safe mocked/manual request shape for `/api/risk/assess` is:

```json
{
  "environment": {
    "source": "fortyguard",
    "location": {"lat": 33.4484, "lon": -112.0740},
    "timestamp": "2026-08-18T12:00:00Z",
    "temperature_c": 30.0,
    "raw": {"fixture": "mocked example; not a real observation"}
  },
  "worker": {
    "worker_id": "W-101",
    "site_id": "PHX-SITE-01",
    "zone_id": "ZONE-B",
    "acclimatized": false
  },
  "task": {
    "task_id": "TASK-1",
    "task_name": "Mock outdoor task",
    "workload_level": "heavy",
    "exposure_duration_minutes": 45,
    "outdoor": true,
    "direct_sun": true
  }
}
```

The timestamp must be current enough for the configured freshness window when performing a live manual test.

A live request to `/api/risk/assess-live` uses this shape:

```json
{
  "location": {
    "site_id": "PHX-SITE-01",
    "name": "Phoenix Outdoor Construction Site",
    "city": "Phoenix",
    "state": "Arizona",
    "country": "United States",
    "latitude": 33.4484,
    "longitude": -112.0740
  },
  "date_time": {
    "start_date": "2026-08-18",
    "start_time": "12:00",
    "filter_type": 1
  },
  "worker": {
    "worker_id": "W-101",
    "site_id": "PHX-SITE-01",
    "acclimatized": false
  },
  "task": {
    "task_id": "TASK-1",
    "task_name": "Outdoor construction task",
    "workload_level": "heavy",
    "exposure_duration_minutes": 45,
    "outdoor": true,
    "direct_sun": true
  }
}
```

Only `filter_type: 1` is supported by the current live endpoint. Multi-period analysis is intentionally deferred to PREDICT.

## Heat Index screening policy

Fresh, provider-reported `heat_index_c` evidence is converted deterministically to Fahrenheit and assigned a National Weather Service environmental screening band. The policy version is `heat-index-screening-nws-2026-v1` and uses lower-inclusive, upper-exclusive software boundaries:

- Below Caution: below 80°F
- Caution: 80°F to below 90°F
- Extreme Caution: 90°F to below 103°F
- Danger: 103°F to below 125°F
- Extreme Danger: 125°F and above

HeatShield does not recalculate a missing Heat Index from temperature and humidity. A missing provider Heat Index produces an `unavailable` screening result. Stale, malformed, missing-timestamp, or materially future evidence produces `insufficient_data` and cannot become an available current screening.

The screening result includes occupational context flags for strenuous workload, acclimatization, direct sun, PPE/clothing, and recorded exposure duration. Recommendations are deterministic operational controls concerning hydration, shade/cool recovery, rest, monitoring, workload reduction, exposure reduction, acclimatization, and cooler-period scheduling. They are not clinical treatment or mandatory legal work/rest schedules.

For direct-sun tasks, the response may show `full_sun_possible_upper_bound_f = heat_index_f + 15`. This is clearly labeled as an informational upper-bound scenario based on NWS/NIOSH guidance; it is not a measured Heat Index and does not replace the provider value or its screening band.

Authoritative sources:

- [OSHA Heat Hazard Recognition](https://www.osha.gov/heat-exposure/hazards)
- [CDC/NIOSH OSHA-NIOSH Heat Safety Tool](https://www.cdc.gov/niosh/heat-stress/communication-resources/app.html)
- [CDC/NIOSH Workplace Recommendations](https://www.cdc.gov/niosh/heat-stress/recommendations/)
- [National Weather Service Heat Index](https://www.weather.gov/ama/heatindex)

Heat Index is a screening metric. OSHA notes that WBGT is more accurate for occupational heat assessment, and NIOSH recommends WBGT for REL/RAL assessment. HeatShield does **not** currently provide a WBGT measurement, NIOSH REL/RAL determination, medical diagnosis, legal compliance determination, predictive risk, or AI-agent decision. FortyGuard `wet_bulb_temperature_c` is ordinary wet-bulb temperature and is never interpreted as WBGT.

## Tests

Tests use mocked HTTP transports and do not consume FortyGuard credits:

```powershell
cd backend
python -m pytest -q
```

## Provider schema source

Request and result fields are based on the official FortyGuard documentation:

- [Create Heatmap](https://docs-api.fortyguard.com/docs/create-heatmap)
- [Environmental Parameters](https://docs-api.fortyguard.com/docs/environmental-parameters)
- [Check Status](https://docs-api.fortyguard.com/docs/check-status)

Provider responses allow unknown extra fields so additions do not break the integration. Heatmap `map_data` and `stats_data` internals, environmental sentinel values, plan-specific parameter selection, and provider failure-detail fields are deliberately preserved as raw data rather than modeled beyond the published schema.
