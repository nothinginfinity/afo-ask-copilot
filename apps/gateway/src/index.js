import { Container } from "@cloudflare/containers";
import { env as workerEnv } from "cloudflare:workers";

const SERVER_INFO = {
  name: "afo-ask-copilot",
  version: "0.1.0",
};

const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-06-18",
  "2025-11-25",
]);

const TOOLS = [
  {
    name: "ask_copilot",
    description: "Ask GitHub Copilot a read-only question. This bootstrap tool does not modify repositories.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: 20000,
          description: "Question or task for Copilot.",
        },
        session_id: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Optional existing Copilot session identifier.",
        },
        model: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "Optional Copilot model identifier. Defaults to auto.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "list_copilot_models",
    description: "List Copilot models visible to the configured SDK identity.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "start_copilot_session",
    description: "Create a new read-only Copilot session and return its identifier.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        model: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "Optional Copilot model identifier. Defaults to auto.",
        },
      },
    },
  },
  {
    name: "resume_copilot_session",
    description: "Confirm that an existing Copilot session can be resumed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        session_id: {
          type: "string",
          minLength: 1,
          maxLength: 200,
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_copilot_session_status",
    description: "Get bootstrap status metadata for a Copilot session.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        session_id: {
          type: "string",
          minLength: 1,
          maxLength: 200,
        },
      },
      required: ["session_id"],
    },
  },
];

const TOOL_ROUTES = {
  ask_copilot: { method: "POST", path: "/v1/ask" },
  list_copilot_models: { method: "GET", path: "/v1/models" },
  start_copilot_session: { method: "POST", path: "/v1/sessions" },
  resume_copilot_session: {
    method: "POST",
    path: ({ session_id }) => `/v1/sessions/${encodeURIComponent(session_id)}/resume`,
  },
  get_copilot_session_status: {
    method: "GET",
    path: ({ session_id }) => `/v1/sessions/${encodeURIComponent(session_id)}`,
  },
};

export class CopilotRuntime extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
  enableInternet = true;

  envVars = {
    COPILOT_GITHUB_TOKEN: workerEnv.COPILOT_GITHUB_TOKEN,
    RUNTIME_SHARED_SECRET: workerEnv.RUNTIME_SHARED_SECRET,
    NODE_ENV: workerEnv.DEPLOYMENT_ENV || "production",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: SERVER_INFO.name,
        version: SERVER_INFO.version,
        runtime_binding: Boolean(env.COPILOT_RUNTIME),
        auth_mode: env.AUTH_MODE || "required",
      });
    }

    if (url.pathname !== "/mcp") {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    if (request.method === "GET") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
      });
    }

    if (request.method === "OPTIONS") {
      return handleOptions(request, env);
    }

    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
      });
    }

    const originError = validateOrigin(request, env);
    if (originError) {
      return jsonResponse({ ok: false, error: originError }, 403);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401, {
        "WWW-Authenticate": 'Bearer realm="afo-ask-copilot"',
      });
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 256000) {
      return jsonResponse({ ok: false, error: "request_too_large" }, 413);
    }

    let message;
    try {
      message = await request.json();
    } catch {
      return rpcError(null, -32700, "Parse error");
    }

    if (Array.isArray(message)) {
      return rpcError(null, -32600, "Batch requests are not supported");
    }

    return handleMcpMessage(message, env);
  },
};

async function handleMcpMessage(message, env) {
  const id = message?.id ?? null;
  const method = message?.method;

  if (message?.jsonrpc !== "2.0" || typeof method !== "string") {
    return rpcError(id, -32600, "Invalid Request");
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (method === "initialize") {
    const requested =
      typeof message?.params?.protocolVersion === "string"
        ? message.params.protocolVersion
        : "2025-06-18";

    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
      ? requested
      : "2025-06-18";

    return rpcResult(id, {
      protocolVersion,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: SERVER_INFO,
      instructions:
        "Private single-user read-only gateway. Mutation tools are intentionally unavailable.",
    });
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const name = message?.params?.name;
    const args = message?.params?.arguments || {};

    if (typeof name !== "string" || !(name in TOOL_ROUTES)) {
      return rpcError(id, -32602, "Unknown tool");
    }

    try {
      const data = await callRuntime(env, name, args);
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text: formatToolText(name, data),
          },
        ],
        structuredContent: data,
        isError: false,
      });
    } catch (error) {
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text: `Tool failed: ${normalizeError(error)}`,
          },
        ],
        isError: true,
      });
    }
  }

  return rpcError(id, -32601, "Method not found");
}

async function callRuntime(env, toolName, args) {
  if (!env.COPILOT_RUNTIME) {
    throw new Error("runtime_binding_unavailable");
  }

  const route = TOOL_ROUTES[toolName];
  const path =
    typeof route.path === "function" ? route.path(args) : route.path;
  const container = env.COPILOT_RUNTIME.getByName("primary");

  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });

  if (env.RUNTIME_SHARED_SECRET) {
    headers.set("x-afo-runtime-token", env.RUNTIME_SHARED_SECRET);
  }

  const request = new Request(`http://copilot-runtime${path}`, {
    method: route.method,
    headers,
    body:
      route.method === "GET"
        ? undefined
        : JSON.stringify(sanitizeArguments(args)),
  });

  const response = await container.fetch(request);
  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`runtime_invalid_json_${response.status}`);
  }

  if (!response.ok) {
    throw new Error(data?.error || `runtime_http_${response.status}`);
  }

  return data;
}

function sanitizeArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }

  const output = {};

  if (typeof args.prompt === "string") {
    output.prompt = args.prompt.slice(0, 20000);
  }
  if (typeof args.session_id === "string") {
    output.session_id = args.session_id.slice(0, 200);
  }
  if (typeof args.model === "string") {
    output.model = args.model.slice(0, 100);
  }

  return output;
}

function formatToolText(name, data) {
  if (name === "ask_copilot") {
    return data?.content || "Copilot returned no content.";
  }

  return JSON.stringify(data, null, 2);
}

function isAuthorized(request, env) {
  if (env.AUTH_MODE === "disabled" && env.DEPLOYMENT_ENV !== "production") {
    return true;
  }

  const configured = env.MCP_BEARER_TOKEN;
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";

  return (
    typeof configured === "string" &&
    configured.length >= 24 &&
    safeEqual(supplied, configured)
  );
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));

  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left[i] ^ right[i];
  }
  return result === 0;
}

function validateOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowed.includes("*") || allowed.includes(origin)) {
    return null;
  }

  return "origin_not_allowed";
}

function handleOptions(request, env) {
  const originError = validateOrigin(request, env);
  if (originError) {
    return jsonResponse({ ok: false, error: originError }, 403);
  }

  const origin = request.headers.get("origin");
  const headers = {
    "Access-Control-Allow-Headers":
      "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }

  return new Response(null, { status: 204, headers });
}

function rpcResult(id, result) {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function rpcError(id, code, message) {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function normalizeError(error) {
  const message =
    error instanceof Error && error.message ? error.message : "unknown_error";

  return message
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted-token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 300);
}
