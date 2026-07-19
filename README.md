# AFO Ask Copilot

A private, single-user remote MCP service that lets ChatGPT delegate repository questions to GitHub Copilot through an AFO-controlled Cloudflare boundary.

## Status

**Bootstrap phase.** The repository contains the first executable gateway and container-runtime scaffold. It is not deployed and has not yet completed a live Copilot request.

## Intended architecture

```text
ChatGPT on iPhone
        |
        | Remote MCP over HTTPS
        v
AFO Ask Copilot Worker
  - bearer authentication
  - origin validation
  - MCP request validation
  - tool allowlist
  - audit boundary
        |
        | private Container binding
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

The Worker is the public control plane. The Container is the Linux execution plane required by the Copilot SDK and CLI.

## Phase-one tools

- `ask_copilot`
- `list_copilot_models`
- `start_copilot_session`
- `resume_copilot_session`
- `get_copilot_session_status`

Phase one is read-only by policy. It does not expose file writes, branch changes, commits, pull-request creation, workflow dispatch, deployment, or Cloudflare mutations.

## Repository layout

```text
apps/gateway/          Cloudflare Worker, MCP endpoint, and Container class
runtime/               Node.js Copilot SDK service and Docker image
docs/                  Architecture, security, operations, and decisions
.github/workflows/     Static validation
ROADMAP.md             Ordered delivery plan
AGENTS.md              Repository operating instructions
```

## Local prerequisites

- Node.js 22
- npm
- Docker
- Cloudflare Workers Paid account with Containers
- Wrangler authentication
- GitHub Copilot access
- A GitHub token appropriate for Copilot SDK requests

## Install

```bash
npm install
```

## Static validation

```bash
npm test
```

## Local runtime

Create `runtime/.env` from `runtime/.env.example`, then:

```bash
npm run dev:runtime
```

## Local Worker

Create `apps/gateway/.dev.vars` from `apps/gateway/.dev.vars.example`, then:

```bash
npm run dev:gateway
```

The initial MCP endpoint is:

```text
http://localhost:8787/mcp
```

## Required Cloudflare secrets

Set these from `apps/gateway` before deployment:

```bash
npx wrangler secret put MCP_BEARER_TOKEN
npx wrangler secret put COPILOT_GITHUB_TOKEN
npx wrangler secret put RUNTIME_SHARED_SECRET
```

Never commit their values.

## Deployment

Deployment is intentionally not automated in the bootstrap commit. The first deployment must happen only after:

1. dependency versions are pinned,
2. the Container image builds locally for `linux/amd64`,
3. Worker and runtime syntax checks pass,
4. authentication denial paths are tested,
5. the MCP transport is tested with the target ChatGPT client,
6. a live Copilot request succeeds without mutation capability.

See [ROADMAP.md](ROADMAP.md) and [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Design rules

- Private and single-user first.
- Deny by default.
- Keep GitHub mutation tools out of phase one.
- Keep the Copilot token inside Cloudflare secrets.
- Do not treat a successful deploy as proof the service works.
- Verify the live MCP endpoint and a real Copilot response.
- Record meaningful revisions in CairnStone and update the chain HEAD.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Operations](docs/OPERATIONS.md)
- [ADR-0001: Worker and Container boundary](docs/ADR-0001-worker-container-boundary.md)
