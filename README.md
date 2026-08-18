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
