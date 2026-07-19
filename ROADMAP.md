# AFO Ask Copilot Roadmap

## Goal

From ChatGPT on an iPhone, securely ask GitHub Copilot questions through a controlled Cloudflare boundary, preserve resumable sessions, and later add explicitly authorized repository context and delegation.

## Completed

### v0.1 — Repository bootstrap

- [x] Establish Worker/Container split.
- [x] Add initial MCP and runtime scaffolds.
- [x] Add architecture, security, and operations documentation.
- [x] Create the initial CairnStone orientation.

### v0.2 — Remote MCP Gateway

- [x] Implement authenticated JSON-RPC 2.0 `/mcp`.
- [x] Expose only `ask_copilot`.
- [x] Add origin, content-type, body, prompt, and rate controls.
- [x] Add metadata-only request logs.
- [x] Return an honest placeholder without contacting Copilot.

### v0.3 — Container Copilot Runtime

- [x] Pin `@github/copilot-sdk@1.0.7`.
- [x] Commit root and standalone runtime lockfiles.
- [x] Verify the bundled platform Copilot CLI package.
- [x] Use Node 22 and `npm ci` in Docker.
- [x] Run the image as a non-root user.
- [x] Add Container health behavior and SIGTERM/SIGINT handling.
- [x] Implement a long-lived client manager.
- [x] Construct `CopilotClient` with `gitHubToken` and `useLoggedInUser: false`.
- [x] Verify client status and authentication status after startup.
- [x] Recreate the client after unrecoverable transport failure.
- [x] Implement session creation, active reuse, and cold resume.
- [x] Return a normalized session error instead of silently replacing failed resume state.
- [x] Keep in-memory sessions active across requests.
- [x] Configure sessions with `availableTools: []`.
- [x] Implement normalized model discovery without a second model cache.
- [x] Read final text from `result.data.content`.
- [x] Abort the session after SDK wait timeout.
- [x] Implement bounded graceful shutdown and `forceStop()` fallback.
- [x] Authenticate Worker-to-Container traffic with `RUNTIME_SHARED_SECRET`.
- [x] Replace the v0.2 placeholder with Container forwarding.
- [x] Add mock tests that require no real GitHub token.
- [x] Add CI Docker build and smoke verification.
- [ ] Inject real secrets manually.
- [ ] Perform the first authenticated development deployment and real Copilot request.

Exit criterion for implementation: code, tests, lockfiles, Docker definition, documentation, and CairnStone graph are ready for manual secret injection. A real response is a separate post-secret verification step.

## Next

### v0.4 — Cloudflare development deployment

- [ ] Add the three secrets manually.
- [ ] Deploy the development Worker and Container.
- [ ] Verify live unauthorized denial.
- [ ] Verify live authenticated `tools/list`.
- [ ] Verify a real new-session Copilot response.
- [ ] Verify a real resumed-session response.
- [ ] Curl the live health endpoint after deployment.
- [ ] Record deployment and live-response receipts in CairnStone.

### v0.5 — ChatGPT connector validation

- [ ] Register the remote MCP endpoint in ChatGPT.
- [ ] Verify tool discovery and use on iPhone.
- [ ] Validate Container cold-start timeout behavior.
- [ ] Confirm no secret reaches ChatGPT output or logs.

### v0.6 — Durable session and receipt layer

- [ ] Define D1 session metadata.
- [ ] Persist session handles and non-sensitive receipts.
- [ ] Preserve graph-based canonical state.

### v0.7 — Approved repository context

- [ ] Add repository allowlists and owner/repo/ref validation.
- [ ] Connect approved read-only GitHub and CairnStone context tools.
- [ ] Use CairnStone HEAD rather than timestamps.
- [ ] Add repository-content prompt-injection boundaries.

### v0.8 — Observability and resilience

- [ ] Add distributed rate control.
- [ ] Add lifecycle metrics and trace propagation.
- [ ] Add restart and recovery drills.

### v0.9 — Controlled delegation design

- [ ] Design a separate mutation authorization plane.
- [ ] Require explicit confirmation for every mutation.
- [ ] Restrict any future write path to draft pull requests.

### v1.0 — Private production release

- [ ] Complete threat model, recovery drill, and live validation.
- [ ] Make the repository private again after the update window.
