import test from "node:test";
import assert from "node:assert/strict";
import { CopilotClientManager } from "../runtime/src/client-manager.js";
import { CopilotSessionManager } from "../runtime/src/session-manager.js";
import { createRuntimeService } from "../runtime/src/app.js";

const TOKEN = "ghp_test_token_that_is_never_logged_123456";
const SECRET = "runtime-shared-secret-at-least-24-characters";

function createMockSession(options = {}) {
  const state = {
    sendCalls: 0,
    abortCalls: 0,
    disconnectCalls: 0,
    setModelCalls: [],
  };
  return {
    sessionId: options.sessionId || "session-default",
    state,
    async sendAndWait(message, timeout) {
      state.sendCalls += 1;
      state.lastMessage = message;
      state.lastTimeout = timeout;
      if (options.sendError) {
        throw options.sendError;
      }
      return options.result === undefined
        ? { data: { content: "mock response" } }
        : options.result;
    },
    async abort() {
      state.abortCalls += 1;
    },
    async disconnect() {
      state.disconnectCalls += 1;
    },
    async setModel(model) {
      state.setModelCalls.push(model);
    },
  };
}

function createMockClient(options = {}) {
  const state = {
    startCalls: 0,
    stopCalls: 0,
    forceStopCalls: 0,
    createCalls: [],
    resumeCalls: [],
    listCalls: 0,
  };
  const sessions = options.sessions || new Map();
  return {
    state,
    async start() {
      state.startCalls += 1;
      if (options.startError) throw options.startError;
    },
    async stop() {
      state.stopCalls += 1;
      if (options.stopError) throw options.stopError;
      return options.cleanupErrors || [];
    },
    async forceStop() {
      state.forceStopCalls += 1;
    },
    async getStatus() {
      return { status: "connected" };
    },
    async getAuthStatus() {
      return { authenticated: true };
    },
    async listModels() {
      state.listCalls += 1;
      return (
        options.models || [
          {
            id: "model-a",
            name: "Model A",
            capabilities: { vision: false },
            supportedReasoningEfforts: ["low", "high"],
            defaultReasoningEffort: "low",
          },
        ]
      );
    },
    async createSession(config) {
      state.createCalls.push(config);
      const session = options.createSession
        ? await options.createSession(config)
        : createMockSession({ sessionId: config.sessionId });
      sessions.set(session.sessionId, session);
      return session;
    },
    async resumeSession(sessionId, config) {
      state.resumeCalls.push({ sessionId, config });
      if (options.resumeError) throw options.resumeError;
      if (options.resumeSession) return options.resumeSession(sessionId, config);
      return sessions.get(sessionId) || createMockSession({ sessionId });
    },
  };
}

function buildManagers(options = {}) {
  const clients = options.clients || [createMockClient(options.clientOptions)];
  let factoryCalls = 0;
  const clientManager = new CopilotClientManager({
    env: options.env || { COPILOT_GITHUB_TOKEN: TOKEN },
    logger: options.logger || { log() {}, error() {} },
    stopTimeoutMs: options.stopTimeoutMs || 50,
    createClient(clientOptions) {
      options.onClientOptions?.(clientOptions);
      const client = clients[Math.min(factoryCalls, clients.length - 1)];
      factoryCalls += 1;
      return client;
    },
  });
  let id = 0;
  const sessionManager = new CopilotSessionManager({
    clientManager,
    randomUUID: () => `session-${++id}`,
  });
  return { clientManager, sessionManager, clients, getFactoryCalls: () => factoryCalls };
}

function runtimeRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.secret !== false) headers.set("x-afo-runtime-token", options.secret || SECRET);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://runtime.test${path}`, {
    method: options.method || "GET",
    headers,
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body),
  });
}

test("client uses verified constructor authentication and singleton reuse", async () => {
  let constructorOptions;
  const { clientManager, clients, getFactoryCalls } = buildManagers({
    onClientOptions: (value) => {
      constructorOptions = value;
    },
  });
  const first = await clientManager.getClient();
  const second = await clientManager.getClient();
  assert.equal(first, second);
  assert.equal(getFactoryCalls(), 1);
  assert.equal(clients[0].state.startCalls, 1);
  assert.deepEqual(constructorOptions, {
    gitHubToken: TOKEN,
    useLoggedInUser: false,
  });
});

test("missing Copilot token produces deliberate startup configuration result", async () => {
  const { clientManager, sessionManager } = buildManagers({ env: {} });
  const service = createRuntimeService({
    env: { RUNTIME_SHARED_SECRET: SECRET },
    clientManager,
    sessionManager,
    logger: { log() {}, error() {} },
    randomUUID: () => "request-1",
  });
  const startup = await service.startup();
  assert.equal(startup.ok, false);
  assert.equal(startup.error.code, "RUNTIME_CONFIGURATION_ERROR");
  const health = await service.handle(runtimeRequest("/health"));
  const body = await health.json();
  assert.equal(health.status, 200);
  assert.equal(body.ready, false);
  assert.equal(body.copilot_token_configured, false);
});

test("missing runtime secret fails closed before prompt parsing", async () => {
  const { clientManager, sessionManager } = buildManagers();
  const service = createRuntimeService({
    env: { COPILOT_GITHUB_TOKEN: TOKEN },
    clientManager,
    sessionManager,
    logger: { log() {}, error() {} },
    randomUUID: () => "request-2",
  });
  const response = await service.handle(
    runtimeRequest("/v1/ask", {
      method: "POST",
      body: "{not-json",
      secret: false,
    }),
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "RUNTIME_CONFIGURATION_ERROR");
});

test("incorrect runtime secret is rejected before JSON parsing", async () => {
  const { clientManager, sessionManager } = buildManagers();
  const service = createRuntimeService({
    env: { COPILOT_GITHUB_TOKEN: TOKEN, RUNTIME_SHARED_SECRET: SECRET },
    clientManager,
    sessionManager,
    logger: { log() {}, error() {} },
    randomUUID: () => "request-3",
  });
  const response = await service.handle(
    runtimeRequest("/v1/ask", {
      method: "POST",
      body: "{not-json",
      secret: "wrong-secret-but-long-enough-123456",
    }),
  );
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "RUNTIME_UNAUTHORIZED");
});

test("new session creation uses stable ID and no ambient tools", async () => {
  const { sessionManager, clients } = buildManagers();
  const result = await sessionManager.createSession();
  assert.equal(result.sessionId, "session-1");
  assert.equal(clients[0].state.createCalls.length, 1);
  assert.deepEqual(clients[0].state.createCalls[0].availableTools, []);
  assert.equal(clients[0].state.createCalls[0].sessionId, "session-1");
});

test("active session is reused without resume", async () => {
  const session = createMockSession({ sessionId: "session-1" });
  const client = createMockClient({ createSession: async () => session });
  const { sessionManager } = buildManagers({ clients: [client] });
  const first = await sessionManager.sendAndWait({ prompt: "first", timeoutMs: 1000 });
  const second = await sessionManager.sendAndWait({
    prompt: "second",
    sessionId: first.sessionId,
    timeoutMs: 1000,
  });
  assert.equal(second.sessionId, "session-1");
  assert.equal(client.state.createCalls.length, 1);
  assert.equal(client.state.resumeCalls.length, 0);
  assert.equal(session.state.sendCalls, 2);
});

test("cold session is resumed and not silently replaced", async () => {
  const resumed = createMockSession({ sessionId: "existing-session" });
  const client = createMockClient({ resumeSession: async () => resumed });
  const { sessionManager } = buildManagers({ clients: [client] });
  const result = await sessionManager.sendAndWait({
    prompt: "continue",
    sessionId: "existing-session",
    timeoutMs: 1000,
  });
  assert.equal(result.sessionId, "existing-session");
  assert.equal(client.state.resumeCalls.length, 1);
  assert.equal(client.state.createCalls.length, 0);
});

test("unresumable session returns normalized error without creating a new session", async () => {
  const client = createMockClient({ resumeError: new Error("session missing") });
  const { sessionManager } = buildManagers({ clients: [client] });
  await assert.rejects(
    sessionManager.sendAndWait({
      prompt: "continue",
      sessionId: "missing-session",
      timeoutMs: 1000,
    }),
    (error) => error.code === "COPILOT_SESSION_RESUME_FAILED",
  );
  assert.equal(client.state.createCalls.length, 0);
});

test("model listing exposes normalized metadata", async () => {
  const { sessionManager } = buildManagers();
  const models = await sessionManager.listModels();
  assert.deepEqual(models, [
    {
      id: "model-a",
      name: "Model A",
      capabilities: { vision: false },
      supportedReasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "low",
    },
  ]);
});

test("requested model is verified against SDK model discovery", async () => {
  const { sessionManager, clients } = buildManagers();
  const result = await sessionManager.createSession({ model: "model-a" });
  assert.equal(result.model, "model-a");
  assert.equal(clients[0].state.listCalls, 1);
  await assert.rejects(
    sessionManager.createSession({ model: "not-real" }),
    (error) => error.code === "COPILOT_MODEL_NOT_FOUND",
  );
});

test("successful sendAndWait returns result.data.content", async () => {
  const session = createMockSession({
    sessionId: "session-1",
    result: { data: { content: "Copilot answer" } },
  });
  const client = createMockClient({ createSession: async () => session });
  const { sessionManager } = buildManagers({ clients: [client] });
  const result = await sessionManager.sendAndWait({ prompt: "hello", timeoutMs: 2345 });
  assert.equal(result.text, "Copilot answer");
  assert.equal(session.state.lastTimeout, 2345);
  assert.match(session.state.lastMessage.prompt, /read-only advisory mode/i);
});

test("undefined final assistant message is normalized", async () => {
  const session = createMockSession({ sessionId: "session-1", result: null });
  session.sendAndWait = async () => undefined;
  const client = createMockClient({ createSession: async () => session });
  const { sessionManager } = buildManagers({ clients: [client] });
  await assert.rejects(
    sessionManager.sendAndWait({ prompt: "hello", timeoutMs: 1000 }),
    (error) => error.code === "COPILOT_EMPTY_RESPONSE",
  );
});

test("SDK timeout triggers best-effort session.abort", async () => {
  const session = createMockSession({
    sessionId: "session-1",
    sendError: new Error("Timed out waiting for session to become idle"),
  });
  const client = createMockClient({ createSession: async () => session });
  const { sessionManager } = buildManagers({ clients: [client] });
  await assert.rejects(
    sessionManager.sendAndWait({ prompt: "slow", timeoutMs: 1000 }),
    (error) => error.code === "COPILOT_TIMEOUT",
  );
  assert.equal(session.state.abortCalls, 1);
});

test("generic session error is normalized without raw stack", async () => {
  const session = createMockSession({
    sessionId: "session-1",
    sendError: new Error("private internal detail"),
  });
  const client = createMockClient({ createSession: async () => session });
  const { sessionManager } = buildManagers({ clients: [client] });
  await assert.rejects(
    sessionManager.sendAndWait({ prompt: "fail", timeoutMs: 1000 }),
    (error) =>
      error.code === "COPILOT_SESSION_ERROR" &&
      !error.message.includes("private internal detail"),
  );
});

test("transport failure marks client unhealthy and recreates it on next request", async () => {
  const brokenSession = createMockSession({
    sessionId: "session-1",
    sendError: new Error("connection closed"),
  });
  const recoveredSession = createMockSession({
    sessionId: "session-1",
    result: { data: { content: "recovered" } },
  });
  const firstClient = createMockClient({ createSession: async () => brokenSession });
  const secondClient = createMockClient({ resumeSession: async () => recoveredSession });
  const { sessionManager, getFactoryCalls } = buildManagers({
    clients: [firstClient, secondClient],
  });
  await assert.rejects(
    sessionManager.sendAndWait({ prompt: "first", timeoutMs: 1000 }),
    (error) => error.code === "COPILOT_TRANSPORT_ERROR",
  );
  const result = await sessionManager.sendAndWait({
    prompt: "retry",
    sessionId: "session-1",
    timeoutMs: 1000,
  });
  assert.equal(result.text, "recovered");
  assert.equal(getFactoryCalls(), 2);
  assert.equal(firstClient.state.stopCalls, 1);
});

test("graceful shutdown disconnects sessions and stops client", async () => {
  const session = createMockSession({ sessionId: "session-1" });
  const client = createMockClient({ createSession: async () => session });
  const { clientManager, sessionManager } = buildManagers({ clients: [client] });
  await sessionManager.createSession();
  await sessionManager.disconnectAll();
  const result = await clientManager.shutdown();
  assert.equal(session.state.disconnectCalls, 1);
  assert.equal(client.state.stopCalls, 1);
  assert.equal(client.state.forceStopCalls, 0);
  assert.equal(result.forced, false);
});

test("forceStop is fallback when graceful cleanup fails", async () => {
  const client = createMockClient({ stopError: new Error("stop failed") });
  const { clientManager } = buildManagers({ clients: [client] });
  await clientManager.start();
  const result = await clientManager.shutdown();
  assert.equal(client.state.stopCalls, 1);
  assert.equal(client.state.forceStopCalls, 1);
  assert.equal(result.forced, true);
});

test("runtime HTTP ask success returns compact normalized contract", async () => {
  const session = createMockSession({
    sessionId: "session-1",
    result: { data: { content: "runtime answer" } },
  });
  const client = createMockClient({ createSession: async () => session });
  const { clientManager, sessionManager } = buildManagers({ clients: [client] });
  const service = createRuntimeService({
    env: { COPILOT_GITHUB_TOKEN: TOKEN, RUNTIME_SHARED_SECRET: SECRET },
    clientManager,
    sessionManager,
    logger: { log() {}, error() {} },
    randomUUID: () => "runtime-request-id",
  });
  await service.startup();
  const response = await service.handle(
    runtimeRequest("/v1/ask", {
      method: "POST",
      body: { prompt: "question" },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    session_id: "session-1",
    model: "auto",
    text: "runtime answer",
    request_id: "runtime-request-id",
  });
});

test("runtime responses and logs do not expose secret values", async () => {
  const logs = [];
  const client = createMockClient({ startError: new Error(`failed ${TOKEN} ${SECRET}`) });
  const { clientManager, sessionManager } = buildManagers({
    clients: [client],
    logger: { log: (value) => logs.push(value), error: (value) => logs.push(value) },
  });
  const service = createRuntimeService({
    env: { COPILOT_GITHUB_TOKEN: TOKEN, RUNTIME_SHARED_SECRET: SECRET },
    clientManager,
    sessionManager,
    logger: { log: (value) => logs.push(value), error: (value) => logs.push(value) },
    randomUUID: () => "runtime-request-id",
  });
  await service.startup();
  const response = await service.handle(
    runtimeRequest("/v1/ask", { method: "POST", body: { prompt: "question" } }),
  );
  const serialized = `${JSON.stringify(await response.json())}\n${logs.join("\n")}`;
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes(SECRET), false);
});
