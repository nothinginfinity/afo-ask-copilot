# AFO Ask Copilot Roadmap

## Guiding outcome

From ChatGPT on an iPhone, securely ask GitHub Copilot questions about approved repositories, preserve resumable sessions, and later delegate tightly controlled draft-PR work.

## Current canonical phase

### v0.1.0 — Repository bootstrap

- [x] Create private repository.
- [x] Establish Worker/Container split.
- [x] Add authenticated MCP gateway scaffold.
- [x] Add Copilot SDK runtime scaffold.
- [x] Add five phase-one tool contracts.
- [x] Add security and operations documentation.
- [x] Add static CI validation.
- [ ] Pin all npm dependency versions after verified install.
- [ ] Build the Container locally.
- [ ] Validate the Worker with Wrangler.
- [ ] Create the first CairnStone repository orientation and set HEAD.

Exit criterion: the repository can be installed and statically validated without secrets.

## v0.2.0 — Local vertical slice

- [ ] Install and pin `@github/copilot-sdk`.
- [ ] Confirm bundled Copilot CLI launches in the Container.
- [ ] Verify `/health`, `/v1/models`, and `/v1/ask`.
- [ ] Verify the Worker can start and reach the named Container.
- [ ] Add automated tests for authentication, origin validation, JSON-RPC errors, and runtime failures.
- [ ] Confirm phase-one sessions cannot execute mutation tools.
- [ ] Add structured request IDs and redacted logs.

Exit criterion: a local MCP `tools/call` reaches Copilot and returns text.

## v0.3.0 — Cloudflare development deployment

- [ ] Create Cloudflare Worker/Container application.
- [ ] Configure the custom domain `ask-copilot.agentfeedoptimization.com`.
- [ ] Provision Worker secrets.
- [ ] Restrict allowed origins and hosts.
- [ ] Add rate limiting appropriate for one user.
- [ ] Add deployment metadata and health receipts.
- [ ] Curl the live endpoint after deployment.
- [ ] Verify a real Copilot request from the live Worker.

Exit criterion: authenticated live MCP requests succeed and unauthenticated requests fail.

## v0.4.0 — ChatGPT connector validation

- [ ] Register the remote MCP endpoint in ChatGPT.
- [ ] Verify tool discovery on iPhone.
- [ ] Verify all five phase-one tools.
- [ ] Validate timeout and retry behavior on Container cold starts.
- [ ] Confirm no secret appears in ChatGPT output, logs, or tool errors.
- [ ] Document iPhone recovery steps.

Exit criterion: reliable read-only use from the ChatGPT iPhone app.

## v0.5.0 — Durable session and receipt layer

- [ ] Define D1 session metadata schema.
- [ ] Persist explicit Copilot session handles.
- [ ] Add request, response, latency, model, and error receipts.
- [ ] Store no prompt or response content by default.
- [ ] Add retention and cleanup policy.
- [ ] Create CairnStone receipts for releases and live verification.

Exit criterion: sessions survive Container restarts and are auditable without leaking content.

## v0.6.0 — Repository context controls

- [ ] Add repository allowlist.
- [ ] Add owner/repo/ref validation.
- [ ] Connect approved read-only AFO GitHub MCP tools.
- [ ] Add CairnStone chain-manifest context.
- [ ] Use graph HEAD rather than timestamps for canonical project state.
- [ ] Add prompt-injection boundaries for repository content.

Exit criterion: Copilot can answer grounded questions about explicitly approved repository state.

## v0.7.0 — Observability and resilience

- [ ] Add OpenTelemetry trace propagation.
- [ ] Add Container lifecycle metrics.
- [ ] Add timeout budgets and circuit breaking.
- [ ] Add health degradation states.
- [ ] Add retry-safe idempotency keys.
- [ ] Add dependency and protocol compatibility checks.

Exit criterion: failures are diagnosable without exposing credentials or private source.

## v0.8.0 — Controlled delegation design

- [ ] Design a separate mutation authorization plane.
- [ ] Require explicit user confirmation for every mutation task.
- [ ] Use GitHub's official Copilot draft-PR workflow where available.
- [ ] Restrict target repositories, base branches, and permissions.
- [ ] Require draft PRs only.
- [ ] Require human review before merge.
- [ ] Record immutable receipts.

Exit criterion: approved tasks can create draft PRs without direct pushes to protected branches.

## v0.9.0 — Draft-PR pilot

- [ ] Add `delegate_copilot_draft_pr`.
- [ ] Add `get_copilot_pr_status`.
- [ ] Add `review_copilot_pr_result`.
- [ ] Pilot on a disposable repository.
- [ ] Verify workflow logs, resulting diff, and live behavior.
- [ ] Add rollback and cancellation controls.

Exit criterion: one end-to-end draft PR is safely delegated, reviewed, and verified.

## v1.0.0 — Private production release

- [ ] Complete threat model and recovery drill.
- [ ] Pin runtime, SDK, CLI, and Wrangler versions.
- [ ] Enable production deployment workflow with manual approval.
- [ ] Confirm backups and session cleanup.
- [ ] Publish final operator runbook.
- [ ] Create release stone, link it to source and verification stones, and set HEAD.

Exit criterion: dependable private daily use from iPhone with read-only queries and explicitly gated draft-PR delegation.
