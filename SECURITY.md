# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose credentials, private data, authentication tokens, provider secrets, or production infrastructure details.

When reporting a security issue, include:

- the affected component or endpoint;
- a concise description of the impact;
- reproducible steps where safe;
- any relevant logs with secrets and personal data removed;
- a suggested mitigation if known.

## Sensitive data

Do not commit or post:

- API keys or OAuth tokens;
- `.env` files;
- private worker/user data;
- provider credentials;
- session cookies or JWTs;
- chain-of-thought or other private model reasoning.

## HeatShield-specific integrity rules

Security and evidence integrity overlap in this project. Contributions must not silently fabricate missing provider evidence, bypass human approval for operational actions, or turn comparative heat observations into unsupported safety claims.

## Dependency and secret hygiene

Keep dependencies reviewed and pinned appropriately, rotate exposed credentials immediately, and use environment-based secret injection for local and deployed environments.
