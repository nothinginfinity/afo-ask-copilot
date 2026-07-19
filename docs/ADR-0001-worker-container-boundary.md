# ADR-0001: Worker and Container Boundary

- Status: Accepted
- Date: 2026-07-19

## Context

The service needs a public remote MCP endpoint and a Linux runtime capable of running the GitHub Copilot SDK and CLI. A standard Cloudflare Worker is well suited to authentication, request validation, routing, and bindings, but it is not the correct place to run a CLI child process with filesystem/runtime requirements.

## Decision

Use:

- a Cloudflare Worker as the public MCP control plane,
- a Cloudflare Container as the Copilot execution plane,
- a named Durable Object Container binding between them.

Keep the Container private and use one named instance during the single-user phase.

## Consequences

### Benefits

- no separate VPS or Railway service,
- secrets remain inside Cloudflare,
- the public boundary stays small,
- the Linux runtime can use the SDK-bundled CLI,
- later D1, R2, Queues, and other bindings remain available.

### Costs

- Docker is required for development and deployment,
- Container cold starts must be handled,
- Worker and Container version compatibility must be tested,
- session persistence requires deliberate design,
- deployment requires a Workers Paid account.

## Revisit when

- multi-user isolation is required,
- one Container cannot meet concurrency needs,
- the Copilot SDK changes its server requirements,
- a fully managed GitHub-hosted runtime becomes preferable.
