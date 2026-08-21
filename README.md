# HeatShield AI

**HeatShield AI is a supervisor-controlled heat operations system built around FortyGuard evidence.** It turns a drawn U.S. worksite, exact worker positions, current jobs and shifts into worker-specific heat plans, time/space alternatives, Premium imagery context, human-gated agent actions, fresh-evidence verification and site-level historical heat resilience analysis.

Default demo: **Phoenix, Arizona, United States**.

> HeatShield never labels a sampled cooler tile a “safe zone,” never invents missing environmental values, and never allows the AI model to execute arbitrary actions. FortyGuard supplies environmental evidence; deterministic server logic validates it; DeepSeek may select only server-defined eligible tools; a supervisor must approve operational actions.

## What the product does

```text
SUPERVISOR INPUT
full worksite polygon + exact worker locations + shifts + jobs
        ↓
FORTYGUARD EVIDENCE
current TCM + environmental parameters + forecast samples
        ↓
DETERMINISTIC HEATSHIELD ENGINE
screening + attention ordering + shift/time/space eligibility
        ↓
BOUNDED DEEPSEEK SELECTION
server-defined empty-argument tools only
        ↓
DECISION WORKBENCH
current vs better sampled time vs better sampled place
thermal digital twin + Premium satellite/street context
        ↓
SUPERVISOR APPROVAL
        ↓
FRESH-EVIDENCE VERIFY / RECHECK
```

### Operational workflow

1. **Site setup** — save/select a U.S. worksite and draw the complete operational polygon.
2. **Crew + work context** — add workers, place each exact point inside the site, and record shift, task, workload, exposure duration, PPE, sun/outdoor context, acclimatization and permitted alternate work.
3. **Review + generate** — inspect exactly what will be sent into planning, then build provider-backed plans for the active crew.
4. **Worker plans** — receive a separate attention-ordered plan and timeline for every worker.
5. **Decision Workbench** — compare the current sampled worker tile with strictly lower future samples and strictly lower in-site spatial candidates.
6. **Operational digital twin** — view the site boundary, active crew, returned FortyGuard thermal tiles and selectable candidate locations on one map.
7. **Premium inspection** — on demand, inspect a selected candidate with FortyGuard Satellite Segmentation and Street View Segmentation, including returned original/segmented images and class coverage.
8. **Human-gated ACT** — enter a supervisor ID and approve only eligible server-created actions.
9. **VERIFY / RECHECK** — obtain fresh provider evidence and preserve the original audit trail without claiming causality.
10. **Site resilience** — run historical exceedance, persistence and time-of-measure heatmaps over the exact site polygon for a selected period and threshold.

## FortyGuard usage

HeatShield uses FortyGuard as the evidence engine rather than as a decorative API call.

- **TCM heatmaps** for current site/worker temperature evidence.
- **Environmental Parameters** for provider Heat Index, humidity, wet-bulb and related context.
- **Forecast TCM heatmaps** at sampled offsets up to the provider horizon used by HeatShield (`+1`, `+3`, `+6`, `+9`, `+12` hours by default).
- **Spatial TCM heatmaps** constrained to the supervisor-drawn operational polygon and configured worker search radius.
- **Satellite Segmentation (Premium)** for provider-returned satellite imagery and segmentation context.
- **Street View Segmentation (Premium)** for provider-returned street imagery and segmentation context.
- **Historical heatmap analytics** for `exceedance`, `persistence` and `time_of_measure` site resilience views.

Missing provider values remain missing. HeatShield does not substitute aggregate heatmap statistics, nearest tiles or interpolated values for a required containing-tile observation.

## Spatial safety boundary

Spatial relocation candidates are constrained in multiple layers:

1. the exact supervisor-drawn polygon is used as the spatial heatmap AOI when available;
2. candidate centroids must be inside that operational polygon;
3. candidates must remain inside the configured worker search radius;
4. DeepSeek evidence contains only candidates explicitly marked `inside_operational_boundary = true`;
5. the cooler-zone tool rejects unverified candidates server-side;
6. the frontend independently blocks out-of-site cooler-zone actions from approval.

A candidate means **lower sampled provider temperature**, not safe, accessible, shaded, hazard-free or task-suitable. Premium imagery is contextual evidence and still requires supervisor judgment.

## Agent model boundary

DeepSeek is a bounded selector, not the source of environmental facts.

- The server computes tool eligibility before the model is called.
- Only eligible, server-defined, empty-argument tools are exposed.
- Model-supplied arguments are rejected.
- Server code constructs factual action details such as coordinates, provider temperatures and sampled timestamps.
- At most three operational actions plus supervisor review are accepted.
- Every operational action requires human approval.
- The system stores compact decisions/audit state, not chain-of-thought.
- If the model is unavailable, completed provider evidence remains available and no AI-selected action is fabricated.

Current action families include cool recovery, reduced physical demand, cooler sampled period, increased monitoring, direct-sun limitation, supervisor review, boundary-verified cooler-zone candidate and sampled shift-plan candidate.

## Historical site resilience

`POST /api/resilience/site-history` runs three independent FortyGuard heatmaps over the exact site polygon:

- **Exceedance** — hours above the selected threshold.
- **Persistence** — longest continuous run above the selected threshold.
- **Time of measure** — provider peak-temperature hour values.

The frontend exposes 7/14/30-day presets, custom dates and a Fahrenheit threshold for U.S. operators; the backend converts the threshold to Celsius for FortyGuard. HeatShield intentionally does **not** collapse these into an invented composite resilience score.

## Human-gated closed loop

```text
SENSE → ASSESS → PREDICT → DECIDE → APPROVE/ACT → VERIFY → RECHECK
```

ACT creates auditable HeatShield operational records. It does not silently move a worker, mutate a calendar or prove that a control was physically followed. VERIFY compares fresh environmental evidence and internal action state while explicitly avoiding causal claims.

## Important safety scope

HeatShield is an operational decision-support prototype for the hackathon. It is **not** medical advice, a medical diagnosis, a WBGT instrument, a NIOSH REL/RAL determination or a legal compliance determination.

Provider `wet_bulb_temperature_c` is ordinary wet-bulb temperature and is never treated as WBGT. Heat Index screening is kept separate from task/worker context and from sparse future temperature samples.

## Repository structure

```text
backend/
  app/api/                 FastAPI routes
  app/models/              strict request/response contracts
  app/services/            FortyGuard, deterministic analytics, agent orchestration
  tests/                   provider-mocked automated tests

frontend/heatshield/
  src/api/                 backend clients
  src/product/mobile/      site, crew, plan and decision workbench UI

notebooks/                 FortyGuard exploration/reference notebooks
.github/workflows/ci.yml   backend + frontend quality gate
```

## Setup

### 1. Environment

Copy `.env.example` to `.env` at the repository root and provide keys locally. Never commit `.env`.

Minimum live configuration:

```env
FORTYGUARD_API_KEY=...
DEEPSEEK_API_KEY=...
```

The complete supported configuration is documented in `.env.example`, including FortyGuard polling, demo site, CORS and agent settings.

### 2. Backend

Python 3.12 is recommended.

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Swagger: `http://127.0.0.1:8000/docs`

Health check: `http://127.0.0.1:8000/api/health`

### 3. Frontend

```bash
cd frontend/heatshield
npm ci
npm run dev
```

Default Vite URL: `http://127.0.0.1:5173`

If the frontend is deployed elsewhere, add its origin to `HEATSHIELD_CORS_ORIGINS`.

## Key product endpoints

```text
POST /api/risk/assess-live
POST /api/predict/heat-outlook
POST /api/spatial/cooler-zones
POST /api/optimize/shift
POST /api/site/operations-snapshot
POST /api/site/operations-snapshot/{snapshot_id}/agent-plan
POST /api/premium/location-intelligence
POST /api/resilience/site-history
POST /api/agent/decide
POST /api/cycle/plan
POST /api/cycle/{cycle_id}/approve
POST /api/cycle/{cycle_id}/verify
POST /api/cycle/{cycle_id}/recheck
GET  /api/cycle/{cycle_id}/audit
```

Low-level FortyGuard submit/status routes are also available under `/api/fortyguard` for debugging and Swagger inspection.

## Demo path

For the strongest hackathon walkthrough:

1. Open the product and select/create a Phoenix-area worksite.
2. Draw a realistic full site boundary.
3. Add 2–3 workers in different parts of the polygon with different tasks/shift contexts.
4. Review inputs and generate worker plans.
5. Open the Decision Workbench for the highest-attention worker.
6. Compare **Current / Better Time / Better Place**.
7. Run the in-site spatial comparison and inspect the thermal digital twin.
8. Select a candidate and request **Premium Context** to show satellite + street segmentation.
9. Review bounded agent actions, authorize with a supervisor ID, then run **Verify with Fresh Evidence**.
10. Run the historical Site Resilience panel to show repeated heat burden and persistence over the same operational polygon.

This sequence demonstrates that the product uses FortyGuard across **current evidence, forecast, spatial intelligence, Premium imagery and historical analytics**, while keeping action selection explainable and human-controlled.

## Tests and CI

Backend tests:

```bash
cd backend
pytest -q
```

Frontend quality:

```bash
cd frontend/heatshield
npx eslint src/api/decisionIntelligenceApi.js src/product/mobile/CrewSetupScreen.jsx src/product/mobile/DecisionComparisonStrip.jsx src/product/mobile/DecisionTwinMap.jsx src/product/mobile/DecisionWorkbench.jsx src/product/mobile/PlanMapEditor.jsx src/product/mobile/PlanScreen.jsx src/product/mobile/SiteResiliencePanel.jsx src/product/mobile/planWorkspace.js
npm run build
```

GitHub Actions runs the complete backend pytest suite, the focused product-slice lint gate and a complete Vite production build. Automated tests use mocked provider/model calls and do not require live FortyGuard or DeepSeek credits.

## Evidence philosophy

HeatShield follows a fail-closed rule throughout the system:

- no fabricated provider values;
- no nearest-tile substitution for current site temperature;
- no interpolation of missing forecast samples;
- no “safe time” claim from a cooler forecast sample;
- no “safe zone” claim from a cooler spatial tile;
- no medical-risk score invented from workload/PPE/acclimatization;
- no unverified out-of-boundary spatial action;
- no causal effectiveness claim from before/after observations.

That constraint is intentional: the product is designed to make **real FortyGuard evidence operationally useful without overstating what the evidence proves**.
