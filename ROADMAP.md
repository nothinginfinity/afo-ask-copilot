# AFO Ask Copilot Roadmap

## Guiding outcome

From ChatGPT on an iPhone, securely ask GitHub Copilot questions about approved repositories, preserve resumable sessions, and later delegate tightly controlled draft-PR work.

## Completed foundation

### v0.1.0 — Repository bootstrap

- [x] Create private repository.
- [x] Establish Worker/Container split.
- [x] Add initial MCP gateway scaffold.
- [x] Add Copilot SDK runtime scaffold.
- [x] Add security and operations documentation.
- [x] Add static CI validation.
- [x] Create the first CairnStone repository orientation and set HEAD.

Exit criterion: repository architecture and safety boundaries are documented and statically valid.

## Current phase

### v0.2.0 — Remote MCP Gateway

- [x] Add a testable JSON-RPC 2.0 gateway core independent of Cloudflare-only imports.
- [x] Add `GET /health` and authenticated `POST /mcp`.
- [x] Standardize the Worker bearer secret as `AFO_ASK_COPILOT_TOKEN`.
- [x] Support `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`.
- [x] Expose only the `ask_copilot` tool during the placeholder phase.
- [x] Return an honest placeholder that states Copilot was not contacted.
- [x] Add request-body, prompt-length, content-type, origin, and rate controls.
- [x] Add generated request IDs and structured metadata-only logs.
- [x] Add Node built-in tests for success and denial/error paths.
- [x] Synchronize the manifest, gateway contract, limits, versions, and README.
- [ ] Verify the implementation commit in GitHub Actions.
- [ ] Re-stone changed files, link graph edges, and set the new chain HEAD.

Exit criterion: the authenticated Worker protocol boundary is locally tested and CI-verified without contacting Copilot or deploying live.

## Next phase

### v0.3.0 — Container Copilot Runtime

- [ ] Install and pin a verified `@github/copilot-sdk` version.
- [ ] Confirm the bundled Copilot CLI launches in the Container.
- [ ] Implement and test `createSession`, `resumeSession`, `sendAndWait`, and `listModels`.
- [ ] Forward approved `ask_copilot` calls from Worker to the named Container.
- [ ] Authenticate the Worker-to-Container boundary with `RUNTIME_SHARED_SECRET`.
- [ ] Verify the Container receives `COPILOT_GITHUB_TOKEN` only through Cloudflare secrets.
- [ ] Confirm read-only session configuration and absence of mutation tools.
- [ ] Add runtime timeout, failure normalization, and redaction tests.
- [ ] Build the Container locally.

Exit criterion: a local authenticated MCP `tools/call` reaches the Container, contacts Copilot, and returns normalized text without mutation capability.

## v0.4.0 — Cloudflare development deployment

- [ ] Create the Cloudflare Worker/Container application.
- [ ] Configure `ask-copilot.agentfeedoptimization.com`.
- [ ] Provision Worker and Container secrets.
- [ ] Restrict allowed origins and hosts.
- [ ] Replace or augment the in-isolate limiter with a durable production control.
- [ ] Add deployment metadata and health receipts.
- [ ] Curl the live endpoint after deployment.
- [ ] Verify a real Copilot request from the live Worker.

Exit criterion: authenticated live MCP requests succeed and unauthenticated requests fail.

## v0.5.0 — ChatGPT connector validation

- [ ] Register the remote MCP endpoint in ChatGPT.
- [ ] Verify tool discovery on iPhone.
- [ ] Verify `ask_copilot` from the ChatGPT iPhone app.
- [ ] Validate timeout and retry behavior on Container cold starts.
- [ ] Confirm no secret appears in ChatGPT output, logs, or tool errors.
- [ ] Document iPhone recovery steps.

Exit criterion: reliable read-only use from the ChatGPT iPhone app.

## v0.6.0 — Durable session and receipt layer

- [ ] Define D1 session metadata schema.
- [ ] Persist explicit Copilot session handles.
- [ ] Add request, response, latency, model, and error receipts.
- [ ] Store no prompt or response content by default.
- [ ] Add retention and cleanup policy.
- [ ] Create CairnStone receipts for releases and live verification.

Exit criterion: sessions survive Container restarts and are auditable without leaking content.

## v0.7.0 — Repository context controls

- [ ] Add repository allowlist.
- [ ] Add owner/repo/ref validation beyond metadata acceptance.
- [ ] Connect approved read-only AFO GitHub MCP tools.
- [ ] Add CairnStone chain-manifest context.
- [ ] Use graph HEAD rather than timestamps for canonical project state.
- [ ] Add prompt-injection boundaries for repository content.

Exit criterion: Copilot can answer grounded questions about explicitly approved repository state.

## v0.8.0 — Observability and resilience

- [ ] Add OpenTelemetry trace propagation.
- [ ] Add Container lifecycle metrics.
- [ ] Add timeout budgets and circuit breaking.
- [ ] Add health degradation states.
- [ ] Add retry-safe idempotency keys.
- [ ] Add dependency and protocol compatibility checks.

Exit criterion: failures are diagnosable without exposing credentials or private source.

## v0.9.0 — Controlled delegation design

- [ ] Design a separate mutation authorization plane.
- [ ] Require explicit user confirmation for every mutation task.
- [ ] Use GitHub's official Copilot draft-PR workflow where available.
- [ ] Restrict target repositories, base branches, and permissions.
- [ ] Require draft PRs only.
- [ ] Require human review before merge.
- [ ] Record immutable receipts.

Exit criterion: approved tasks can create draft PRs without direct pushes to protected branches.

## v1.0.0 — Private production release

- [ ] Complete threat model and recovery drill.
- [ ] Pin runtime, SDK, CLI, and Wrangler versions.
- [ ] Enable production deployment workflow with manual approval.
- [ ] Confirm backups and session cleanup.
- [ ] Publish final operator runbook.
- [ ] Create release stone, link it to source and verification stones, and set HEAD.

Exit criterion: dependable private daily use from iPhone with read-only queries and explicitly gated draft-PR delegation.
