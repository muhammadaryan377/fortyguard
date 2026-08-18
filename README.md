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

## PREDICT Phase 1

`POST /api/predict/heat-outlook` queries separate future FortyGuard TCM heatmaps for a small set of site-specific sample times up to 12 hours ahead. The default offsets are `+1`, `+3`, `+6`, `+9`, and `+12` hours. These are sparse forecast sample points, not a continuous hourly series.

Phoenix example request:

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
  "timezone_name": "America/Phoenix",
  "offset_hours": [1, 3, 6, 9, 12]
}
```

Each forecast temperature must come from a TCM GeoJSON tile that spatially contains the requested site. Missing points remain unavailable: HeatShield does not use nearest tiles, heatmap statistics, interpolation, or invented values. Partial provider success produces a partial outlook and retains every failed sample point with a safe reason.

Phase 1 is temperature-only. It does not call Environmental Parameters as a temperature forecast, does not forecast Heat Index or humidity, and does not provide future WBGT, occupational risk scores, medical prediction, legal compliance classification, or AI-agent decisions. “Highest sampled temperature” means the highest value among requested sample times only; it is not guaranteed to be the maximum over the continuous forecast period.

Automated prediction tests use mocked provider jobs and consume zero FortyGuard API credits.

## Tests

## Backend operational loop

HeatShield now implements the human-gated backend loop:

`SENSE → ASSESS → PREDICT → DECIDE → ACT → VERIFY → RECHECK`

- FortyGuard supplies current environmental evidence and future TCM temperature samples.
- **AI model provider: DeepSeek V4 Flash.** DECIDE uses non-thinking mode and permits the model to select only six server-defined, argument-free tools. Server code validates every tool call and constructs every factual action detail.
- Every proposed ACT action requires explicit supervisor approval. ACT currently creates only auditable HeatShield internal operational state; SMS, email, calendar, and external scheduling connectors are intentionally not wired.
- VERIFY obtains fresh FortyGuard evidence and reports before/after observations without claiming that an action caused an environmental change.
- RECHECK creates a successor cycle from fresh provider evidence and preserves the original historical cycle.
- SQLite stores compact cycles, decisions, actions, operational records, and audit events. It never stores API keys, chain-of-thought, or full provider FeatureCollections.

Operational endpoints:

```text
POST /api/risk/assess-live
POST /api/predict/heat-outlook
POST /api/spatial/cooler-zones
POST /api/optimize/shift
POST /api/agent/decide
POST /api/cycle/plan
POST /api/cycle/{cycle_id}/approve
POST /api/cycle/{cycle_id}/verify
POST /api/cycle/{cycle_id}/recheck
GET  /api/cycle/{cycle_id}/audit
```

DeepSeek is used only for constrained tool selection. Model prose and chain-of-thought are not used or returned. Missing current evidence skips the model, while a missing/unavailable DeepSeek service leaves completed SENSE, ASSESS, and PREDICT evidence intact. Automated tests mock both providers and consume no FortyGuard or DeepSeek credits.

## SPATIAL INTELLIGENCE Phase 1

`POST /api/spatial/cooler-zones` requests one current FortyGuard TCM heatmap over a wider deterministic worksite AOI. HeatShield keeps only valid polygon tiles with numeric `properties.value`, identifies the site-containing reference tile, and ranks strictly cooler tiles by temperature, straight-line distance, then provider feature order.

```json
{
  "location": {
    "site_id": "PHX-SITE-01",
    "name": "Phoenix Outdoor Construction Site",
    "city": "Phoenix",
    "state": "Arizona",
    "country": "United States",
    "latitude": 33.4484,
    "longitude": -112.074
  },
  "timezone_name": "America/Phoenix",
  "search_radius_meters": 400,
  "granularity": 60,
  "max_candidates": 3
}
```

The response contains sanitized polygon geometry for the future map, compact tile temperatures, the containing site reference, and deterministic cooler-zone candidates. It never uses a nearest tile as the site temperature, heatmap statistics as tile temperatures, or interpolation.

**“Cooler” does not mean “safe.”** Temperature alone does not establish Heat Index, WBGT, radiant exposure, wind, accessibility, physical hazards, permissions, or task feasibility. Straight-line distance is not a walking or routing distance.

Cycle planning can opt in using:

```json
{
  "include_spatial_intelligence": true,
  "spatial_search_radius_meters": 400
}
```

The default is `false`, avoiding an additional provider request. When enabled, the constrained agent may select `propose_cooler_zone_candidate`; the server selects rank 1 and constructs all coordinates, temperatures, differences, and distance. After supervisor approval, ACT stores an internal `relocation_candidate` in `approved_candidate` state. This does not claim a worker moved, the area is safe, or relocation occurred. VERIFY confirms only the internal record state; physical location verification is outside Phase 1.

## SMART SHIFT OPTIMIZER — Phase 1

`POST /api/optimize/shift` consumes an existing PREDICT response and generates deterministic schedules using only exact, available FortyGuard sampled start timestamps. It does not call FortyGuard or DeepSeek, interpolate missing hours, or assign tasks to unavailable samples.

```json
{
  "worker_id": "WORKER-01",
  "heat_outlook": {
    "status": "available",
    "source": "fortyguard_heatmap",
    "location": {
      "site_id": "PHX-SITE-01",
      "name": "Phoenix Outdoor Construction Site",
      "city": "Phoenix",
      "state": "Arizona",
      "country": "United States",
      "latitude": 33.4484,
      "longitude": -112.074
    },
    "timezone_name": "America/Phoenix",
    "generated_at": "2026-08-18T17:00:00Z",
    "forecast_horizon_hours": 3,
    "sample_offsets_hours": [1, 3],
    "points": [
      {
        "status": "available",
        "offset_hours": 1,
        "requested_local_timestamp": "2026-08-18T11:00:00-07:00",
        "requested_utc_timestamp": "2026-08-18T18:00:00Z",
        "temperature_c": 40,
        "source": "fortyguard_heatmap",
        "analytic_type": "tcm",
        "heatmap_activity_id": "forecast-1",
        "extraction_method": "containing_heatmap_feature_value"
      },
      {
        "status": "available",
        "offset_hours": 3,
        "requested_local_timestamp": "2026-08-18T13:00:00-07:00",
        "requested_utc_timestamp": "2026-08-18T20:00:00Z",
        "temperature_c": 32,
        "source": "fortyguard_heatmap",
        "analytic_type": "tcm",
        "heatmap_activity_id": "forecast-3",
        "extraction_method": "containing_heatmap_feature_value"
      }
    ],
    "summary": {
      "available_points": 2,
      "total_points": 2,
      "highest_sampled_temperature_c": 40,
      "lowest_sampled_temperature_c": 32,
      "first_to_last_temperature_change_c": -8,
      "trend": "falling"
    },
    "limitations": []
  },
  "tasks": [
    {
      "task_id": "TASK-01",
      "task_name": "Material handling",
      "duration_minutes": 120,
      "current_planned_offset_hours": 1,
      "flexible": true,
      "allowed_offset_hours": [1, 3],
      "workload_level": "heavy",
      "direct_sun": true,
      "must_follow_task_ids": []
    }
  ],
  "max_alternatives": 3
}
```

The `sampled_temperature_minutes_index` is:

`sum(sampled_start_temperature_c × duration_minutes)`

It is a relative scheduling/planning index—not physiological heat dose, an occupational risk score, a medical metric, WBGT exposure, or Heat Index exposure. Each temperature describes only the exact sampled task-start timestamp, not average temperature over the task duration or continuous forecast coverage.

Schedules must not overlap and must satisfy fixed-task, allowed-offset, and dependency ordering constraints. Feasible plans rank by lowest planning index, then least total offset movement, then the lexicographic offset tuple. No workload or direct-sun multiplier is invented.

Cycle planning can opt in with `include_shift_optimization: true` and a non-empty `shift_tasks` list. It reuses the already-created `heat_outlook`, so optimization adds no provider request. DeepSeek may select only `propose_shift_plan_candidate`; the server supplies the validated best candidate. Supervisor approval stores an internal `shift_plan_candidate` in `approved_candidate` state. It does not mutate a calendar, prove task movement, or demonstrate real-world exposure change.

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
