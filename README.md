# AFO Ask Copilot

A private, single-user Remote MCP service that lets ChatGPT send read-only text questions to GitHub Copilot through an AFO-controlled Cloudflare Worker and Container boundary.

## Status

**v0.3 implementation is ready for manual secret injection and an authenticated development test.**

The repository now contains:

- an authenticated JSON-RPC 2.0 Remote MCP Worker,
- an authenticated Worker-to-Container boundary,
- a Node 22 Container runtime pinned to `@github/copilot-sdk@1.0.7`,
- a long-lived `CopilotClient` manager,
- in-memory session create, reuse, and cold-resume behavior,
- model discovery and verification,
- timeout-to-`session.abort()` handling,
- transport-failure client recreation,
- bounded graceful shutdown with `forceStop()` fallback,
- deterministic tests that do not require real secrets,
- reproducible root and runtime npm lockfiles,
- Docker and bundled Copilot CLI verification in CI.

No live deployment or authenticated Copilot response is claimed by this commit.

## Architecture

```text
ChatGPT
    |
    v
Cloudflare Worker Remote MCP
  - AFO_ASK_COPILOT_TOKEN bearer authentication
  - origin, JSON-RPC, argument, size, and rate controls
  - stable MCP success/error normalization
    |
    | x-afo-runtime-token: RUNTIME_SHARED_SECRET
    v
Cloudflare Container
  - Node.js 22
  - long-lived CopilotClient singleton
  - in-memory session manager
  - no ambient tools
    |
    v
Bundled GitHub Copilot runtime / CLI
```

The Worker never owns Copilot SDK objects, CLI processes, sessions, model caching, reconnect logic, or the GitHub token. Those responsibilities remain inside the Container.

## Remote MCP surface

- `GET /health`
- authenticated `POST /mcp`
- `OPTIONS /mcp`

Supported MCP methods:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`

The only exposed tool is `ask_copilot`.

```json
{
  "prompt": "Review this architecture.",
  "repository": "nothinginfinity/afo-ask-copilot",
  "model": "optional-runtime-verified-model-id",
  "session_id": "optional-existing-session-id"
}
```

Only `prompt` is required. `repository` is metadata in v0.3 and does not imply repository grounding or repository access.

## Runtime HTTP contract

Protected Container routes require `x-afo-runtime-token` with `RUNTIME_SHARED_SECRET`.

- `GET /health`
- `GET /v1/models`
- `POST /v1/sessions`
- `POST /v1/sessions/{session_id}/resume`
- `POST /v1/ask`

Successful ask response:

```json
{
  "ok": true,
  "session_id": "stable-session-id",
  "model": "resolved-model-id-or-auto",
  "text": "Copilot response",
  "request_id": "runtime-request-id"
}
```

Normalized error response:

```json
{
  "ok": false,
  "error": {
    "code": "COPILOT_TIMEOUT",
    "message": "Copilot did not finish before the request timeout."
  },
  "request_id": "runtime-request-id"
}
```

## Security boundaries

- `COPILOT_GITHUB_TOKEN` exists only in the Container environment.
- The Worker never forwards the Copilot token in an HTTP request.
- `RUNTIME_SHARED_SECRET` authenticates Worker-to-Container traffic.
- `AFO_ASK_COPILOT_TOKEN` authenticates the public Remote MCP boundary.
- Session configuration uses `availableTools: []`.
- No shell, filesystem, MCP, repository mutation, workflow, deployment, or Cloudflare mutation tool is enabled.
- Raw SDK stacks, authorization headers, prompts, and secret values are not returned or logged.

## Install and validate

Prerequisites:

- Node.js `^20.19.0 || >=22.12.0`; Node 22 is preferred.
- npm.
- Docker for local image verification.

```bash
npm ci
npm test
npm run validate
npm run verify:bundled-cli
docker build -t afo-ask-copilot-runtime -f runtime/Dockerfile runtime
```

The lockfiles resolve:

- `@github/copilot-sdk@1.0.7`
- `@github/copilot@1.0.71`
- `@github/copilot-linux-x64@1.0.71` on Linux x64

## Manual secrets required before authenticated deployment

From `apps/gateway`, add these Cloudflare secrets manually:

```bash
npx wrangler secret put AFO_ASK_COPILOT_TOKEN
npx wrangler secret put RUNTIME_SHARED_SECRET
npx wrangler secret put COPILOT_GITHUB_TOKEN
```

Use three different values. Do not commit them. The value entered for `RUNTIME_SHARED_SECRET` is injected into the Container and used by the Worker on the private request boundary. The Copilot token is injected into the Container environment and is not sent through the Worker request body or headers.

## First authenticated test after secret injection

1. Deploy only to the approved development environment.
2. Confirm unauthenticated `POST /mcp` returns `401`.
3. Confirm authenticated `tools/list` returns only `ask_copilot`.
4. Call `ask_copilot` with a harmless text prompt and no session ID.
5. Verify a successful response contains a newly created `session_id` and actual Copilot text.
6. Call again with that `session_id` and verify conversation continuity.
7. Verify logs contain request metadata but no token, authorization header, full prompt, CLI arguments, or stack trace.

See [ROADMAP.md](ROADMAP.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), and [docs/OPERATIONS.md](docs/OPERATIONS.md).
