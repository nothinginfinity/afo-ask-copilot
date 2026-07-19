# Operations

## Secret setup

From `apps/gateway`:

```bash
npx wrangler secret put MCP_BEARER_TOKEN
npx wrangler secret put COPILOT_GITHUB_TOKEN
npx wrangler secret put RUNTIME_SHARED_SECRET
```

Use different random values for the two service secrets.

## Local validation

From the repository root:

```bash
npm test
```

Build the Container:

```bash
docker build --platform linux/amd64 -t afo-ask-copilot-runtime:local runtime
```

Run the Container:

```bash
docker run --rm -p 8080:8080 --env-file runtime/.env afo-ask-copilot-runtime:local
```

Check it:

```bash
curl -sS http://127.0.0.1:8080/health
```

## Worker development

Create `apps/gateway/.dev.vars` from the example. Then:

```bash
npm run dev:gateway
```

The Worker uses the configured Container binding; Docker must be available to Wrangler.

## Minimum MCP smoke tests

Unauthenticated requests must fail:

```bash
curl -i -X POST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Authenticated tool discovery:

```bash
curl -sS -X POST http://127.0.0.1:8787/mcp \
  -H "authorization: Bearer $MCP_BEARER_TOKEN" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Copilot call:

```bash
curl -sS -X POST http://127.0.0.1:8787/mcp \
  -H "authorization: Bearer $MCP_BEARER_TOKEN" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ask_copilot","arguments":{"prompt":"Reply with the word ready."}}}'
```

## Deployment gates

Do not deploy unless:

- static validation passes,
- Container image builds,
- the runtime health check passes,
- unauthorized MCP access is denied,
- tool discovery returns only approved tools,
- a local Copilot request succeeds,
- dependencies are pinned,
- the deployment change is reviewed.

## Live verification

After deployment:

1. Check `/health`.
2. Confirm unauthorized `/mcp` returns 401.
3. Confirm authenticated `tools/list`.
4. Confirm a real `ask_copilot` response.
5. Confirm logs contain no secrets or full prompt/response bodies.
6. Confirm Container cold-start behavior.
7. Record deployment and verification receipts.
8. Re-stone the release and set CairnStone HEAD.
