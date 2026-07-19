# Architecture

## Boundary

```text
ChatGPT
  -> Cloudflare Worker Remote MCP
  -> authenticated Container request
  -> Node 22 runtime
  -> long-lived CopilotClient
  -> session manager
  -> bundled GitHub Copilot runtime
```

The Worker is the public protocol and policy plane. The Container is the Linux execution plane.

## Worker responsibilities

- Remote MCP JSON-RPC behavior.
- `AFO_ASK_COPILOT_TOKEN` bearer authentication.
- origin, content-type, body-size, prompt-size, and rate controls.
- tool and argument allowlists.
- bounded runtime timeout metadata.
- `RUNTIME_SHARED_SECRET` on the private Container request.
- normalized MCP success and error responses.

The Worker does not construct SDK clients, launch CLI processes, own SDK sessions, cache models, perform reconnects, or receive the Copilot token in the request path.

## Container responsibilities

### Client manager

One `CopilotClient` exists for the Container lifetime. It is constructed as:

```js
new CopilotClient({
  gitHubToken: process.env.COPILOT_GITHUB_TOKEN,
  useLoggedInUser: false,
});
```

The manager starts the bundled stdio runtime, calls `getStatus()`, calls `getAuthStatus()`, reuses the client, marks it unhealthy on transport failure, stops the old client, and creates a fresh client on the next request.

### Session manager

The in-memory map stores session objects with their client generation. A new request without `session_id` gets a generated stable ID passed to `createSession`. A request with an active ID reuses the object. A cold ID calls `resumeSession`. Failed resume returns `COPILOT_SESSION_RESUME_FAILED`; it never creates unrelated state.

The initial configuration is deliberately narrow:

```js
{
  streaming: false,
  availableTools: []
}
```

No shell, filesystem, MCP, or mutation capability is enabled.

### Model discovery

The runtime calls `client.listModels()` and normalizes:

- `id`
- `name`
- `capabilities`
- `supportedReasoningEfforts`
- `defaultReasoningEffort`

The SDK remains the model cache and source of truth.

### Timeout behavior

`session.sendAndWait({ prompt }, timeoutMs)` only stops waiting. When its timeout error is detected, the runtime best-effort calls `session.abort()` before returning `COPILOT_TIMEOUT`.

### Recovery and shutdown

Transport failures invalidate all in-memory session objects tied to the old client generation. The next request creates a fresh client, and a supplied stable session ID is resumed.

On SIGTERM or SIGINT, the HTTP server stops accepting requests, waits within a bounded policy, disconnects active sessions without deleting them, calls `client.stop()`, inspects cleanup errors, and uses `forceStop()` only when graceful cleanup fails.

## Runtime HTTP contract

Unauthenticated health:

- `GET /health`

Authenticated with `x-afo-runtime-token`:

- `GET /v1/models`
- `POST /v1/sessions`
- `POST /v1/sessions/{id}/resume`
- `POST /v1/ask`

The authentication check occurs before request-body parsing.
