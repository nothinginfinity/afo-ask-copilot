# Architecture

## System boundary

AFO Ask Copilot has two execution layers.

### 1. Cloudflare Worker control plane

Responsibilities:

- expose the Remote MCP endpoint,
- authenticate the single approved caller,
- validate origin, content type, request size, JSON, and JSON-RPC shape,
- generate request IDs,
- enforce prompt and best-effort rate limits,
- publish a deterministic tool allowlist,
- normalize protocol errors,
- emit structured metadata-only logs,
- forward approved runtime calls to one named Container beginning in v0.3,
- later write minimal audit metadata to D1.

The Worker must not execute the Copilot SDK or CLI.

### 2. Cloudflare Container execution plane

Responsibilities beginning in v0.3:

- run Node.js in a Linux environment,
- load the GitHub Copilot SDK,
- run the SDK-bundled Copilot CLI,
- create and resume Copilot sessions,
- enforce read-only session configuration,
- return normalized JSON to the Worker.

The Container must not be publicly routable. It is reached through the Worker's named Container binding.

## v0.2 request flow

```text
1. Client sends a request to the Worker.
2. GET /health returns non-sensitive readiness metadata.
3. POST /mcp validates Origin when present.
4. Worker validates Authorization: Bearer <AFO_ASK_COPILOT_TOKEN>.
5. Worker applies an in-isolate fixed-window rate limit.
6. Worker requires application/json and caps the request body.
7. Worker parses and validates one JSON-RPC 2.0 message.
8. Worker handles initialize, notifications/initialized, ping, and tools/list locally.
9. Worker validates tools/call arguments for ask_copilot.
10. Worker returns explicit placeholder metadata stating Copilot was not contacted.
```

No v0.2 request reaches the Container.

## v0.3 request flow

```text
1. Worker completes the v0.2 control-plane checks.
2. Worker maps ask_copilot to a fixed internal runtime route.
3. Worker gets the named Container instance primary.
4. Worker authenticates the internal request with RUNTIME_SHARED_SECRET.
5. Runtime creates or resumes a Copilot SDK session.
6. Runtime sends the prompt with read-only policy constraints.
7. Runtime returns normalized content and session metadata.
8. Worker returns an MCP tool result.
```

## Protocol structure

`apps/gateway/src/index.js` contains the Cloudflare-specific Container class and delegates fetch handling to `apps/gateway/src/mcp.js`.

`apps/gateway/src/mcp.js` contains the testable protocol and control-plane core. It intentionally has no imports from `cloudflare:workers` or `@cloudflare/containers`, allowing Node's built-in test runner to exercise the real request handler without mocking the Cloudflare module loader.

The source tool definition is exported once and validated against `apps/gateway/mcp.manifest.json` to prevent manifest and `tools/list` drift.

## Session model

MCP transport state and Copilot conversation state are separate.

- The v0.2 gateway is stateless except for a best-effort in-isolate rate bucket.
- Optional `session_id` is accepted as metadata but is not used.
- Copilot session creation and resumption begin in v0.3.
- Durable session metadata belongs in D1 in a later phase.

## Authentication model

Three secrets have separate purposes:

- `AFO_ASK_COPILOT_TOKEN`: authenticates ChatGPT to the Worker.
- `COPILOT_GITHUB_TOKEN`: will authenticate the Copilot SDK/CLI in v0.3.
- `RUNTIME_SHARED_SECRET`: will authenticate Worker requests inside the Container boundary in v0.3.

All real values must be Cloudflare secrets. No real value belongs in GitHub.

## Repository metadata

The v0.2 `ask_copilot` schema accepts an optional `repository` string in `owner/repo` form. It is returned as placeholder metadata only. The Worker does not fetch, mount, authorize, or inspect that repository.

Repository-aware work will later require:

- an explicit repository allowlist,
- read-only AFO GitHub tools,
- CairnStone chain manifests and HEAD pointers,
- normalized owner/repo/ref inputs,
- prompt-injection boundaries for repository content.

## Mutation architecture

Mutation capability is intentionally absent.

A future mutation plane must:

- expose separate tools,
- require explicit user confirmation,
- use least-privilege GitHub credentials,
- create draft PRs rather than direct branch pushes,
- record immutable receipts,
- remain disabled by default.
