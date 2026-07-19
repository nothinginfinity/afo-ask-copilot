# Copilot Runtime

Private Node.js service intended to run inside the Cloudflare Container bound to the gateway Worker.

## Routes

- `GET /health`
- `GET /v1/models`
- `POST /v1/ask`
- `POST /v1/sessions`
- `POST /v1/sessions/:id/resume`
- `GET /v1/sessions/:id`

All `/v1/*` routes require `x-afo-runtime-token` when `RUNTIME_SHARED_SECRET` is configured.

## Bootstrap limitations

- Uses the SDK-bundled Copilot CLI.
- Uses in-memory status metadata.
- Does not mount repositories.
- Does not expose mutation routes.
- Dependency version must be pinned after the first verified installation.
- Live read-only behavior must be verified before deployment.
