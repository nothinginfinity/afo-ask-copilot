# AFO Ask Copilot

A private, single-user Remote MCP service that will let ChatGPT delegate approved repository questions to GitHub Copilot through an AFO-controlled Cloudflare boundary.

## Status

**v0.2 Remote MCP Gateway implementation.** The Cloudflare Worker now has a real authenticated JSON-RPC 2.0 `/mcp` boundary with one `ask_copilot` tool. The tool currently returns an explicit placeholder. It does not contact GitHub Copilot, execute the Container runtime, read repositories, or mutate external systems.

The project has not been deployed live. Copilot SDK and CLI execution remain a v0.3 responsibility of the Container.

## Architecture

```text
ChatGPT on iPhone
        |
        | Remote MCP over HTTPS
        v
AFO Ask Copilot Worker
  - bearer authentication
  - origin and content-type validation
  - JSON-RPC request validation
  - request IDs and structured redacted logs
  - request, prompt, and rate controls
  - deterministic tool allowlist
        |
        | private Container binding (v0.3 execution)
        v
Cloudflare Container
  - Node.js runtime
  - GitHub Copilot SDK
  - bundled Copilot CLI
  - session lifecycle
        |
        v
GitHub / approved AFO GitHub tools
```

The Worker is the public control plane. The Container is the Linux execution plane required by the Copilot SDK and CLI. Copilot SDK execution must not be moved into the normal Worker runtime.

## v0.2 HTTP surface

- `GET /health` returns non-sensitive service readiness metadata.
- `POST /mcp` accepts authenticated MCP JSON-RPC requests.
- `OPTIONS /mcp` supports configured browser origins.

The MCP endpoint supports:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`

Batch JSON-RPC requests are not supported. Notifications return no JSON-RPC response body.

## v0.2 tool

### `ask_copilot`

Input:

```json
{
  "prompt": "Review the repository architecture.",
  "repository": "nothinginfinity/afo-ask-copilot",
  "model": "optional-model",
  "session_id": "optional-session"
}
```

Only `prompt` is required. The placeholder response includes a request ID, tool name, repository, model, session ID, runtime status, prompt length, and timestamp. It always states that GitHub Copilot was not contacted.

## Authentication

Send:

```text
Authorization: Bearer <AFO_ASK_COPILOT_TOKEN>
```

For local development, copy `apps/gateway/.dev.vars.example` to `apps/gateway/.dev.vars` and replace placeholders locally. Never commit `.dev.vars` or real credentials.

For a future Cloudflare deployment, create the gateway secret from `apps/gateway`:

```bash
npx wrangler secret put AFO_ASK_COPILOT_TOKEN
```

`COPILOT_GITHUB_TOKEN` and `RUNTIME_SHARED_SECRET` are reserved for v0.3 Container integration and must also be stored as Cloudflare secrets when that phase is approved.

## Request controls

Default v0.2 controls:

- maximum request body: 256,000 bytes,
- maximum prompt length: 20,000 characters,
- content type: `application/json`,
- fixed-window in-isolate rate limit: 60 authenticated requests per 60 seconds,
- generated `X-Request-ID` on responses,
- structured JSON logs containing metadata only.

The Worker does not log authorization headers or full prompts. The v0.2 rate limiter is a best-effort single-isolate control, not a distributed production quota system.

## Repository layout

```text
apps/gateway/          Cloudflare Worker and Remote MCP protocol implementation
runtime/               Node.js Copilot SDK service and Docker image for v0.3
tests/                 Node built-in gateway tests
docs/                  Architecture, security, operations, and decisions
.github/workflows/     Test and validation CI
ROADMAP.md             Ordered delivery plan
AGENTS.md              Repository operating instructions
```

## Validation

No real secrets are required for the v0.2 automated tests.

```bash
npm test
npm run validate
node --check apps/gateway/src/index.js
node --check runtime/src/server.js
```

`npm run validate` checks JavaScript syntax, parses the tracked JSON files, and verifies that the MCP manifest, `tools/list`, protocol versions, request limits, package versions, and token secret name remain synchronized.

## Deployment boundary

Production deployment is intentionally outside v0.2. Do not deploy without explicit approval. Before a later live release, build and validate the Container, validate Wrangler configuration, provision secrets, test live unauthorized denial, test live authenticated `tools/list`, and verify actual runtime behavior separately from pipeline status.

## Design rules

- Private and single-user first.
- Deny by default.
- Keep mutation tools unavailable.
- Keep the Copilot token out of the Worker request path and Git history.
- Keep Copilot SDK and CLI execution in the Container.
- Do not treat a successful commit, CI run, or deployment as proof of live behavior.
- Record meaningful revisions in CairnStone and update the chain HEAD.

## Documentation

- [Roadmap](ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Operations](docs/OPERATIONS.md)
- [ADR-0001: Worker and Container boundary](docs/ADR-0001-worker-container-boundary.md)
