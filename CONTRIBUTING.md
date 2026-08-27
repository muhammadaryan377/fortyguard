# Contributing to HeatShield AI

Thanks for helping improve HeatShield AI. This project handles occupational heat-risk evidence, so contributions should preserve evidence integrity, deterministic safety boundaries, and clear separation between provider facts and application decisions.

## Development setup

1. Create a Python 3.12 virtual environment in `backend/`.
2. Install backend dependencies from `backend/requirements.txt`.
3. Copy `.env.example` to `.env` and add local credentials. Never commit secrets.
4. Run the FastAPI app locally and verify `/api/health`.
5. For frontend changes, install the frontend dependencies and run the local development server.

## Before opening a pull request

- Keep changes focused and explain the product or engineering outcome.
- Add or update tests for behavior changes.
- Run the backend test suite when backend code changes.
- Run frontend lint/build checks when frontend code changes.
- Do not fabricate missing provider evidence or convert unavailable values into defaults.
- Do not treat ordinary wet-bulb temperature as WBGT.
- Preserve human approval for operational actions.
- Never commit API keys, tokens, `.env`, private user data, or chain-of-thought.

## Branch and commit style

Use short descriptive branch names, for example:

```text
feat/site-operations
fix/provider-timeout
polish/evidence-labels
docs/contributing-guide
```

Prefer clear commit messages such as:

```text
feat: add worker plan validation
fix: preserve missing provider values
docs: clarify local setup
```

## Pull request checklist

A useful pull request should include:

- what changed;
- why the change is needed;
- affected backend/frontend areas;
- provider or safety implications, if any;
- tests or validation performed;
- any known limitations or follow-up work.

## Evidence and safety rules

HeatShield should remain explicit about what is observed, derived, proposed, approved, and verified. A cooler time or place is a comparative candidate, not automatically a safe work condition. AI/model output must not invent temperatures, coordinates, schedules, thresholds, worker facts, or provider evidence.

## Review philosophy

Prefer small, understandable pull requests. Keep provider adapters, deterministic business rules, AI/tool selection, and frontend presentation separated enough that each layer can be tested independently.
