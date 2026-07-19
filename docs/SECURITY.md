# Security Model

## Assets

- GitHub Copilot entitlement and token.
- Private repository source and metadata.
- ChatGPT-to-Worker bearer token.
- Copilot prompts, responses, and session IDs.
- Cloudflare account and deployment configuration.

## Trust boundaries

1. ChatGPT client to public Worker.
2. Worker to private Container.
3. Container to GitHub/Copilot services.
4. Future repository tools to private GitHub repositories.
5. Logs and receipts to storage.

## Bootstrap controls

- Repository is private.
- MCP requires Bearer authentication unless local development explicitly disables it.
- Origin is validated when supplied.
- Tool names are allowlisted.
- Runtime routes are fixed; callers cannot supply arbitrary internal URLs.
- Runtime requires a separate shared secret.
- Phase-one tools contain no mutation operations.
- The Container receives no mounted repository by default.
- Errors returned to the client are normalized.
- Secret files are ignored by Git.

## Known bootstrap limitations

- Dependency versions are not pinned yet.
- MCP transport compatibility has not been tested with ChatGPT.
- Container startup and secret injection have not been live-tested.
- Runtime session status is in memory.
- Rate limiting and D1 receipts are not implemented.
- Prompt and response redaction has not been tested against real SDK errors.
- Read-only behavior still requires live verification against the Copilot SDK and CLI.

## Required pre-production controls

- Pin and review all dependencies.
- Add rate limiting.
- Add structured redacted logging.
- Add request size limits and timeout budgets.
- Add repository allowlists.
- Add D1 metadata receipts with minimal retention.
- Verify no mutation-capable built-in tools are available in phase one.
- Rotate all secrets after any suspected disclosure.
- Restrict production hostname and allowed origins.
- Test denial paths from outside the intended client.

## Logging policy

Do not log:

- Authorization headers,
- GitHub tokens,
- runtime shared secrets,
- complete prompts,
- complete model responses,
- private source files,
- session persistence files.

Allowed default metadata:

- request ID,
- tool name,
- response status,
- latency,
- model identifier,
- hashed or opaque session handle,
- redacted error category.

## Incident response

1. Disable the Worker route.
2. Rotate `MCP_BEARER_TOKEN`.
3. Rotate `RUNTIME_SHARED_SECRET`.
4. Revoke and replace `COPILOT_GITHUB_TOKEN`.
5. Review Cloudflare and GitHub audit logs.
6. Preserve redacted receipts.
7. Fix and verify locally.
8. Redeploy.
9. Verify the live endpoint.
10. Create and link a CairnStone incident/recovery stone.
