import test from "node:test";
import assert from "node:assert/strict";
import {
  createGatewayHandler,
  MAX_PROMPT_LENGTH,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../apps/gateway/src/mcp.js";

const TOKEN = "test-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const silentLogger = { log() {}, error() {} };
let requestSequence = 0;

function createHandler() {
  return createGatewayHandler({
    logger: silentLogger,
    now: () => new Date("2026-07-19T14:00:00.000Z"),
    randomUUID: () => `request-${++requestSequence}`,
  });
}

function env(overrides = {}) {
  return {
    AFO_ASK_COPILOT_TOKEN: TOKEN,
    ALLOWED_ORIGINS: "https://chatgpt.com,https://chat.openai.com",
    DEPLOYMENT_ENV: "test",
    RATE_LIMIT_REQUESTS: "1000",
    RATE_LIMIT_WINDOW_SECONDS: "60",
    ...overrides,
  };
}

function rpcRequest(body, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!options.omitAuth) {
    headers.set("authorization", `Bearer ${options.token || TOKEN}`);
  }
  if (!options.omitContentType) {
    headers.set("content-type", "application/json");
  }
  headers.set("cf-connecting-ip", options.ip || `192.0.2.${requestSequence + 1}`);

  return new Request("https://ask-copilot.example/mcp", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

test("GET /health returns non-sensitive readiness metadata", async () => {
  const response = await createHandler()(
    new Request("https://ask-copilot.example/health"),
    env(),
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    service: "afo-ask-copilot",
    version: "0.2.0",
    status: "ready",
  });
  assert.ok(response.headers.get("x-request-id"));
  assert.equal("auth_mode" in body, false);
  assert.equal("runtime_binding" in body, false);
});

test("POST /mcp rejects a missing bearer token", async () => {
  const response = await createHandler()(
    rpcRequest({ jsonrpc: "2.0", id: 1, method: "ping" }, { omitAuth: true }),
    env(),
  );
  const body = await readJson(response);

  assert.equal(response.status, 401);
  assert.equal(body.error, "unauthorized");
  assert.match(response.headers.get("www-authenticate"), /^Bearer /);
});

test("POST /mcp rejects an invalid bearer token", async () => {
  const response = await createHandler()(
    rpcRequest(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { token: "incorrect-token-value-abcdefghijklmnopqrstuvwxyz" },
    ),
    env(),
  );

  assert.equal(response.status, 401);
  assert.equal((await readJson(response)).error, "unauthorized");
});

test("initialize negotiates a supported protocol version", async () => {
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS[0];
  const response = await createHandler()(
    rpcRequest({
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: { protocolVersion, capabilities: {}, clientInfo: { name: "test" } },
    }),
    env(),
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.result.protocolVersion, protocolVersion);
  assert.equal(body.result.serverInfo.version, "0.2.0");
  assert.equal(body.result.capabilities.tools.listChanged, false);
});

test("tools/list exposes only the synchronized ask_copilot tool", async () => {
  const response = await createHandler()(
    rpcRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    env(),
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.result.tools.map((tool) => tool.name), ["ask_copilot"]);
  assert.equal(
    body.result.tools[0].inputSchema.properties.prompt.maxLength,
    MAX_PROMPT_LENGTH,
  );
  assert.ok(body.result.tools[0].inputSchema.properties.repository);
});

test("ask_copilot returns an honest deterministic v0.2 placeholder", async () => {
  const response = await createHandler()(
    rpcRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "ask_copilot",
        arguments: {
          prompt: "Review the repository architecture.",
          repository: "nothinginfinity/afo-ask-copilot",
          model: "auto",
          session_id: "session-test",
        },
      },
    }),
    env(),
  );
  const body = await readJson(response);
  const result = body.result.structuredContent;

  assert.equal(response.status, 200);
  assert.equal(body.result.isError, false);
  assert.equal(result.accepted, true);
  assert.equal(result.tool_name, "ask_copilot");
  assert.equal(result.repository, "nothinginfinity/afo-ask-copilot");
  assert.equal(result.model, "auto");
  assert.equal(result.session_id, "session-test");
  assert.equal(result.runtime_status, "not_contacted_placeholder_v0.2");
  assert.equal(result.timestamp, "2026-07-19T14:00:00.000Z");
  assert.match(result.message, /GitHub Copilot was not contacted/);
  assert.doesNotMatch(body.result.content[0].text, /Copilot returned|Copilot answered/);
});

test("unknown JSON-RPC methods return method-not-found", async () => {
  const response = await createHandler()(
    rpcRequest({ jsonrpc: "2.0", id: 4, method: "unknown/method" }),
    env(),
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.error.code, -32601);
  assert.equal(body.error.message, "Method not found");
});

test("malformed JSON returns a structured parse error", async () => {
  const response = await createHandler()(rpcRequest('{"jsonrpc":'), env());
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.error.code, -32700);
  assert.ok(body.error.data.request_id);
});

test("ask_copilot rejects prompts exceeding the configured limit", async () => {
  const response = await createHandler()(
    rpcRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "ask_copilot",
        arguments: { prompt: "x".repeat(MAX_PROMPT_LENGTH + 1) },
      },
    }),
    env(),
  );
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.error.code, -32602);
  assert.match(body.error.message, /maximum length/);
});

test("notifications/initialized produces no JSON-RPC response body", async () => {
  const response = await createHandler()(
    rpcRequest({ jsonrpc: "2.0", method: "notifications/initialized" }),
    env(),
  );

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("unsupported protocol versions are rejected explicitly", async () => {
  const response = await createHandler()(
    rpcRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "initialize",
      params: { protocolVersion: "1900-01-01" },
    }),
    env(),
  );
  const body = await readJson(response);

  assert.equal(body.error.code, -32602);
  assert.equal(body.error.message, "Unsupported protocol version");
  assert.deepEqual(
    body.error.data.supported_protocol_versions,
    SUPPORTED_PROTOCOL_VERSIONS,
  );
});

test("missing request IDs are handled without executing request methods", async () => {
  const response = await createHandler()(
    rpcRequest({ jsonrpc: "2.0", method: "tools/list" }),
    env(),
  );

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("authenticated MCP requests require application/json", async () => {
  const response = await createHandler()(
    rpcRequest(
      { jsonrpc: "2.0", id: 7, method: "ping" },
      { omitContentType: true },
    ),
    env(),
  );
  const body = await readJson(response);

  assert.equal(response.status, 415);
  assert.equal(body.error.code, -32600);
});
