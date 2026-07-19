const workerUrl = requireEnvironment("WORKER_URL").replace(/\/+$/, "");
const bearerToken = requireEnvironment("AFO_ASK_COPILOT_TOKEN");
const mcpUrl = `${workerUrl}/mcp`;

await verifyHealth();
await verifyUnauthorizedRequest();
await verifyInitialize();
await verifyToolList();
const sessionId = await askCopilotWithRetry();
await resumeCopilotSession(sessionId);

console.log(
  JSON.stringify({
    ok: true,
    worker_url: workerUrl,
    checks: [
      "health",
      "unauthorized_401",
      "initialize",
      "tools_list",
      "copilot_response",
      "session_resume",
    ],
    session_id_prefix: sessionId.slice(0, 12),
  }),
);

async function verifyHealth() {
  const response = await fetch(`${workerUrl}/health`, {
    headers: { Accept: "application/json" },
  });
  const body = await readJson(response, "health");

  assert(response.status === 200, `health returned HTTP ${response.status}`);
  assert(body?.ok === true, "health response did not report ok=true");
  assert(body?.service === "afo-ask-copilot", "health service name was unexpected");
}

async function verifyUnauthorizedRequest() {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(initializeRequest("unauthorized")),
  });
  const body = await readJson(response, "unauthorized request");

  assert(response.status === 401, `unauthorized MCP request returned HTTP ${response.status}`);
  assert(body?.error === "unauthorized", "unauthorized MCP response was unexpected");
  assert(
    response.headers.get("www-authenticate")?.includes("Bearer"),
    "unauthorized MCP response did not include a Bearer challenge",
  );
}

async function verifyInitialize() {
  const { response, body } = await authenticatedRpc(initializeRequest("initialize"));

  assert(response.status === 200, `initialize returned HTTP ${response.status}`);
  assert(body?.result?.protocolVersion === "2025-11-25", "initialize protocol version mismatch");
  assert(body?.result?.serverInfo?.name === "afo-ask-copilot", "initialize server name mismatch");
}

async function verifyToolList() {
  const { response, body } = await authenticatedRpc({
    jsonrpc: "2.0",
    id: "tools-list",
    method: "tools/list",
    params: {},
  });

  assert(response.status === 200, `tools/list returned HTTP ${response.status}`);
  assert(
    body?.result?.tools?.some((tool) => tool?.name === "ask_copilot"),
    "tools/list did not expose ask_copilot",
  );
}

async function askCopilotWithRetry() {
  const request = toolCallRequest("copilot-first", {
    prompt: "Reply with exactly: AFO_COPILOT_LIVE_OK",
  });

  let latestError = "Copilot runtime did not become ready";

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const { response, body } = await authenticatedRpc(request);
    const structured = body?.result?.structuredContent;
    const text = body?.result?.content?.[0]?.text;

    if (
      response.status === 200 &&
      body?.result?.isError === false &&
      structured?.ok === true &&
      typeof structured?.session_id === "string" &&
      structured.session_id.length > 0 &&
      typeof text === "string" &&
      text.includes("AFO_COPILOT_LIVE_OK")
    ) {
      return structured.session_id;
    }

    latestError =
      structured?.error?.code ||
      body?.error?.message ||
      `HTTP ${response.status} with no successful Copilot response`;
    console.log(`Copilot readiness attempt ${attempt}/30: ${latestError}`);
    await sleep(10_000);
  }

  throw new Error(latestError);
}

async function resumeCopilotSession(sessionId) {
  const { response, body } = await authenticatedRpc(
    toolCallRequest("copilot-resume", {
      prompt: "Reply with exactly: AFO_COPILOT_RESUME_OK",
      session_id: sessionId,
    }),
  );
  const structured = body?.result?.structuredContent;
  const text = body?.result?.content?.[0]?.text;

  assert(response.status === 200, `resumed tools/call returned HTTP ${response.status}`);
  assert(body?.result?.isError === false, "resumed tools/call reported isError=true");
  assert(structured?.ok === true, "resumed tools/call did not report ok=true");
  assert(structured?.session_id === sessionId, "resumed tools/call returned a different session_id");
  assert(
    typeof text === "string" && text.includes("AFO_COPILOT_RESUME_OK"),
    "resumed Copilot response did not contain the expected marker",
  );
}

async function authenticatedRpc(body) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    response,
    body: await readJson(response, body.method),
  };
}

function initializeRequest(id) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "afo-ask-copilot-live-smoke",
        version: "0.4.0",
      },
    },
  };
}

function toolCallRequest(id, argumentsValue) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "ask_copilot",
      arguments: argumentsValue,
    },
  };
}

async function readJson(response, label) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON content with HTTP ${response.status}`);
  }
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
