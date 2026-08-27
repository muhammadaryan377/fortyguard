# Development Workflow

Use focused branches and pull requests for product changes.

Recommended flow:

1. Update local `main`.
2. Create a descriptive branch such as `feat/...`, `fix/...`, `polish/...`, or `docs/...`.
3. Make one coherent change.
4. Run relevant backend/frontend checks.
5. Open a pull request describing the outcome, validation, and known limitations.
6. Merge only when the branch is ready and the repository checks are acceptable.

For HeatShield changes, keep provider evidence, deterministic rules, model/tool selection, human approval, and UI presentation clearly separated so failures can be traced to the correct layer.
