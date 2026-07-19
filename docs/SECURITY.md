# Security Model

## Secrets

Three independent secrets are required:

- `AFO_ASK_COPILOT_TOKEN`: public Worker Remote MCP bearer token.
- `RUNTIME_SHARED_SECRET`: Worker-to-Container shared secret.
- `COPILOT_GITHUB_TOKEN`: GitHub Copilot identity token available only in the Container environment.

Real values must not appear in Git history, Docker layers, tests, fixtures, logs, responses, or CairnStone content.

The application secret remains named `COPILOT_GITHUB_TOKEN`. The SDK performs its own internal translation for the spawned runtime. Do not rename the application secret to `COPILOT_SDK_AUTH_TOKEN`.

## Authentication order

The Worker validates its bearer token before parsing MCP content. The Container validates `RUNTIME_SHARED_SECRET` with a constant-time comparison before parsing the prompt body. A missing Container secret is a fail-closed configuration error. An incorrect supplied secret is unauthorized.

## Copilot authentication

v0.3 is single-user and uses client-level authentication. Session-level `gitHubToken` is not used. `RuntimeConnection.forUri()` is not used; authentication remains owned by the default bundled stdio runtime.

## Capability policy

`ask_copilot` is a text bridge, not an unrestricted coding agent. Session configuration uses `availableTools: []`. The system does not enable shell, filesystem, MCP, browser, deployment, workflow, repository-write, or other ambient execution tools.

`repository` is metadata only in v0.3. It does not grant repository access or grounding.

## Error and logging policy

Public errors contain stable codes and short messages. They do not contain SDK stacks, CLI arguments, authorization headers, prompt bodies, or transport internals. Logs contain route, method, request ID, status, elapsed time, and normalized error code only.

A successful pipeline, Docker build, Worker deploy, or health response is not evidence that GitHub Copilot was contacted. Only a successful Container response containing actual SDK-returned text may be labeled `copilot_response_received`.

## Session lifecycle

Ordinary requests do not disconnect sessions. Shutdown may disconnect active sessions so the SDK can preserve their data. `deleteSession()` is not used.

## Image policy

The runtime image uses Node 22, `npm ci`, a committed lockfile, no baked secrets, an unprivileged `node` user, one exposed application port, and a health check.
