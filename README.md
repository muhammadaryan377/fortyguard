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
- `POST /api/risk/assess-live` uses the existing FortyGuard client, normalizes its result, and passes it into the same deterministic engine.

When environmental evidence is missing or stale, the engine returns `insufficient_data`. When fresh evidence exists but validated numeric occupational rules are absent, it returns `configuration_required` with a `null` risk score. Operational factors such as workload, acclimatization, direct sun, exposure duration, and PPE are reported without converting them into fabricated medical or numeric risk categories.

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
