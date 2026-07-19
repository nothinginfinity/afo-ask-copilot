# Architecture

## System boundary

AFO Ask Copilot has two execution layers.

### 1. Cloudflare Worker control plane

Responsibilities:

- expose the remote MCP endpoint,
- authenticate the caller,
- validate request origin and JSON-RPC shape,
- publish a deterministic tool allowlist,
- reject unsupported methods,
- route approved calls to one named Container,
- normalize and redact errors,
- later write audit metadata to D1.

The Worker must not execute the Copilot CLI.

### 2. Cloudflare Container execution plane

Responsibilities:

- run Node.js in a Linux environment,
- load the GitHub Copilot SDK,
- run the SDK-bundled Copilot CLI,
- create and resume Copilot sessions,
- enforce read-only session configuration,
- return normalized JSON to the Worker.

The Container must not be publicly routable. It is reached through the Worker's Durable Object Container binding.

## Request flow

```text
1. ChatGPT sends an MCP JSON-RPC request to POST /mcp.
2. Worker verifies Bearer authentication.
3. Worker validates Origin when present.
4. Worker handles initialize, ping, and tools/list locally.
5. Worker maps tools/call to a fixed internal runtime route.
6. Worker gets the named Container instance `primary`.
7. Container starts on demand and receives the request.
8. Runtime creates or resumes a Copilot SDK session.
9. Runtime returns normalized content.
10. Worker returns an MCP tool result.
```

## Session model

MCP transport state and Copilot conversation state are separate.

- The gateway is designed to be stateless.
- Copilot session IDs are explicit tool arguments.
- The bootstrap runtime keeps only transient status metadata in memory.
- Durable session metadata belongs in D1 in a later phase.
- Copilot's own session persistence remains the source of conversation continuity until an AFO persistence layer is added.

## Authentication model

Three secrets have separate purposes:

- `MCP_BEARER_TOKEN`: authenticates ChatGPT to the Worker.
- `COPILOT_GITHUB_TOKEN`: authenticates the Copilot SDK/CLI.
- `RUNTIME_SHARED_SECRET`: authenticates Worker requests inside the Container boundary.

All three are Cloudflare Worker secrets. The Container class passes only the runtime-required values as environment variables.

## Repository context

Bootstrap `ask_copilot` accepts a prompt, optional model, and optional session ID. It does not yet accept arbitrary repository credentials or mount repositories.

Repository-aware work will later use:

- an explicit repository allowlist,
- read-only AFO GitHub tools,
- CairnStone chain manifests and HEAD pointers,
- normalized owner/repo/ref inputs.

## Mutation architecture

Mutation capability is intentionally absent.

A future mutation plane must:

- expose separate tools,
- require explicit user confirmation,
- use least-privilege GitHub credentials,
- create draft PRs rather than direct branch pushes,
- record immutable receipts,
- remain disabled by default.
