# Operations

## Local validation without secrets

```bash
npm ci
npm test
npm run validate
npm run verify:bundled-cli
docker build -t afo-ask-copilot-runtime -f runtime/Dockerfile runtime
```

The runtime can start without secrets for a deliberate fail-closed smoke test. `/health` remains available and reports `ready: false`. Protected operations return a normalized configuration error.

## Local no-secret smoke

```bash
docker run --rm -p 8080:8080 afo-ask-copilot-runtime
curl --fail http://127.0.0.1:8080/health
```

Do not interpret this as Copilot authentication validation.

## Manual secret injection

From `apps/gateway`:

```bash
npx wrangler secret put AFO_ASK_COPILOT_TOKEN
npx wrangler secret put RUNTIME_SHARED_SECRET
npx wrangler secret put COPILOT_GITHUB_TOKEN
```

Use different values. Do not paste them into issues, commits, CairnStone reports, or chat output.

## Development deployment verification

1. Build and test locally.
2. Confirm the GitHub Actions validation and Docker job is green.
3. Add secrets manually.
4. Deploy only after explicit approval.
5. Test unauthenticated `/mcp` denial.
6. Test authenticated `tools/list`.
7. Send a harmless `ask_copilot` prompt without a session ID.
8. Verify actual text and a new stable session ID.
9. Send a second prompt with that session ID.
10. Inspect logs for metadata-only output.
11. Record the live verification separately from the implementation receipt.

## Failure interpretation

- `RUNTIME_CONFIGURATION_ERROR`: a required Container secret is missing.
- `RUNTIME_AUTHENTICATION_FAILED`: Worker and Container shared-secret values differ.
- `COPILOT_CLIENT_START_FAILED`: bundled runtime, token, or Copilot authentication failed during client startup.
- `COPILOT_TIMEOUT`: waiting stopped and the runtime attempted `session.abort()`.
- `COPILOT_SESSION_RESUME_FAILED`: requested state could not be resumed; no replacement session was created.
- `COPILOT_TRANSPORT_ERROR`: client is marked unhealthy and will be recreated on the next request.

A Docker build alone does not prove token validity, Copilot entitlement, model availability, or end-to-end behavior.
