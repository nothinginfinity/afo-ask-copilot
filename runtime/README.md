# AFO Ask Copilot Runtime

Node 22 Container service for `@github/copilot-sdk@1.0.7` using the bundled stdio runtime.

## Environment

- `COPILOT_GITHUB_TOKEN` — required for Copilot operations.
- `RUNTIME_SHARED_SECRET` — required on every protected HTTP route.
- `HOST` — defaults to `0.0.0.0`.
- `PORT` — defaults to `8080`.

The service starts without secrets so `/health` can report a deliberate fail-closed state. It will not process Copilot requests until both secrets are configured.

## Routes

- `GET /health`
- `GET /v1/models`
- `POST /v1/sessions`
- `POST /v1/sessions/{session_id}/resume`
- `POST /v1/ask`

All routes except health require `x-afo-runtime-token`.

## Build

```bash
npm ci
npm run verify:bundled-cli
docker build -t afo-ask-copilot-runtime .
```
