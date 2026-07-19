import test from "node:test";
import assert from "node:assert/strict";
import {
  createGatewayHandler,
  MAX_PROMPT_LENGTH,
  TOOLS,
} from "../apps/gateway/src/mcp.js";

const TOKEN = "gateway-bearer-token-at-least-24-characters";
const RUNTIME_SECRET = "runtime-shared-secret-at-least-24-characters";

function createLogger() {
  const entries = [];
  return {
    entries,
    log(value) {
      entries.push(value);
    },
    error(value) {
      entries.push(value);
    },
  };
}

function rpcRequest(message, options = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    authorization: `Bearer ${options.token || TOKEN}`,
    "cf-connecting-ip": options.ip || `test-${Math.random()}`,
  });
  return new Request("https://ask.example/mcp", {
    method: "POST",
    headers,
    body: typeof message === "string" ? message : JSON.stringify(message),
  });
}

function toolCall(argumentsValue = { prompt: "hello" }) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "ask_copilot", arguments: argumentsValue },
  };
}

const baseEnv = {
  AFO_ASK_COPILOT_TOKEN: TOKEN,
  RUNTIME_SHARED_SECRET: RUNTIME_SECRET,
  AUTH_MODE: "required",
  DEPLOYMENT_ENV: "development",
  RATE_LIMIT_REQUESTS: "1000",
  RATE_LIMIT_WINDOW_SECONDS: "60",
  RUNTIME_TIMEOUT_MS: "60000",
};

test("tools/list preserves one read-only ask_copilot tool", async () => {
  const handler = createGatewayHandler({
    logger: createLogger(),
    randomUUID: () => "gateway-request",
  });
  const response = await handler(
    rpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    baseEnv,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.result.tools, TOOLS);
  assert.equal(body.result.tools.length, 1);
});

test("missing gateway bearer token is rejected", async () => {
  const handler = createGatewayHandler({ logger: createLogger() });
  const request = rpcRequest(toolCall());
  request.headers.delete("authorization");
  const response = await handler(request, baseEnv);
  assert.equal(response.status, 401);
});

test("gateway validates prompt bounds before contacting runtime", async () => {
  let invoked = false;
  const handler = createGatewayHandler({
    logger: createLogger(),
    runtimeInvoker: async () => {
      invoked = true;
      return new Response();
    },
  });
  const response = await handler(
    rpcRequest(toolCall({ prompt: "x".repeat(MAX_PROMPT_LENGTH + 1) })),
    baseEnv,
  );
  const body = await response.json();
  assert.equal(body.error.code, -32602);
  assert.equal(invoked, false);
});

test("Worker-to-Container success becomes structured MCP success", async () => {
  let invocation;
  const handler = createGatewayHandler({
    logger: createLogger(),
    randomUUID: () => "gateway-request",
    runtimeInvoker: async (value) => {
      invocation = value;
      return Response.json({
        ok: true,
        session_id: "session-123",
        model: "model-a",
        text: "Copilot response",
        request_id: "runtime-request",
      });
    },
  });
  const response = await handler(
    rpcRequest(
      toolCall({
        prompt: "question",
        repository: "nothinginfinity/afo-ask-copilot",
        model: "model-a",
      }),
    ),
    baseEnv,
  );
  const body = await response.json();
  assert.equal(body.result.isError, false);
  assert.equal(body.result.content[0].text, "Copilot response");
  assert.equal(body.result.structuredContent.runtime_status, "copilot_response_received");
  assert.equal(invocation.payload.prompt, "question");
  assert.equal(invocation.payload.timeout_ms, 60000);
  assert.equal(invocation.env.COPILOT_GITHUB_TOKEN, undefined);
});

test("Container authentication failure becomes stable MCP tool error", async () => {
  const handler = createGatewayHandler({
    logger: createLogger(),
    randomUUID: () => "gateway-request",
    runtimeInvoker: async () =>
      Response.json(
        {
          ok: false,
          error: { code: "RUNTIME_UNAUTHORIZED", message: "detail" },
          request_id: "runtime-request",
        },
        { status: 401 },
      ),
  });
  const response = await handler(rpcRequest(toolCall()), baseEnv);
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.equal(
    body.result.structuredContent.error.code,
    "RUNTIME_AUTHENTICATION_FAILED",
  );
  assert.equal(
    body.result.structuredContent.runtime_status,
    "copilot_response_not_received",
  );
});

test("Container Copilot timeout is normalized", async () => {
  const handler = createGatewayHandler({
    logger: createLogger(),
    randomUUID: () => "gateway-request",
    runtimeInvoker: async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "COPILOT_TIMEOUT",
            message: "internal timeout detail",
          },
          request_id: "runtime-request",
        },
        { status: 504 },
      ),
  });
  const response = await handler(rpcRequest(toolCall()), baseEnv);
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.equal(body.result.structuredContent.error.code, "COPILOT_TIMEOUT");
  assert.equal(
    body.result.content[0].text,
    "Copilot did not finish before the request timeout.",
  );
});

test("gateway transport timeout is normalized without claiming Copilot contact", async () => {
  const handler = createGatewayHandler({
    logger: createLogger(),
    randomUUID: () => "gateway-request",
    runtimeInvoker: async () => {
      throw new Error("runtime_timeout");
    },
  });
  const response = await handler(rpcRequest(toolCall()), baseEnv);
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.equal(body.result.structuredContent.error.code, "RUNTIME_TIMEOUT");
  assert.equal(
    body.result.structuredContent.runtime_status,
    "copilot_response_not_received",
  );
});

test("invalid runtime success response is rejected", async () => {
  const handler = createGatewayHandler({
    logger: createLogger(),
    runtimeInvoker: async () => Response.json({ ok: true, text: "missing ids" }),
  });
  const response = await handler(rpcRequest(toolCall()), baseEnv);
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.equal(body.result.structuredContent.error.code, "RUNTIME_INVALID_RESPONSE");
});

test("gateway logs and responses never expose bearer or runtime secret", async () => {
  const logger = createLogger();
  const handler = createGatewayHandler({
    logger,
    randomUUID: () => "gateway-request",
    runtimeInvoker: async () => {
      throw new Error(`${TOKEN} ${RUNTIME_SECRET}`);
    },
  });
  const response = await handler(rpcRequest(toolCall()), baseEnv);
  const serialized = `${JSON.stringify(await response.json())}\n${logger.entries.join("\n")}`;
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes(RUNTIME_SECRET), false);
});

test("initialize reports v0.3 runtime forwarding instructions", async () => {
  const handler = createGatewayHandler({ logger: createLogger() });
  const response = await handler(
    rpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    }),
    baseEnv,
  );
  const body = await response.json();
  assert.equal(body.result.serverInfo.version, "0.3.0");
  assert.match(body.result.instructions, /Container runtime/);
});
