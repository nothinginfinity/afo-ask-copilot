const SERVER_INFO = Object.freeze({
  name: "afo-ask-copilot",
  version: "0.3.0",
});

export const MAX_REQUEST_BODY_BYTES = 256_000;
export const MAX_PROMPT_LENGTH = 20_000;
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  "2025-06-18",
  "2025-11-25",
]);

export const TOOLS = Object.freeze([
  Object.freeze({
    name: "ask_copilot",
    description:
      "Ask GitHub Copilot a read-only text question through the authenticated AFO Container runtime.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      properties: Object.freeze({
        prompt: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: MAX_PROMPT_LENGTH,
          description: "Question or task intended for Copilot.",
        }),
        repository: Object.freeze({
          type: "string",
          minLength: 3,
          maxLength: 200,
          pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$",
          description:
            "Optional repository metadata in owner/repo form. Repository grounding is not implied by v0.3.",
        }),
        model: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "Optional Copilot model identifier verified by the runtime.",
        }),
        session_id: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Optional resumable Copilot session identifier.",
        }),
      }),
      required: Object.freeze(["prompt"]),
    }),
  }),
]);

const RATE_LIMIT_BUCKETS = new Map();
const DEFAULT_RATE_LIMIT_REQUESTS = 60;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RUNTIME_TIMEOUT_MS = 60_000;
const MIN_RUNTIME_TIMEOUT_MS = 1_000;
const MAX_RUNTIME_TIMEOUT_MS = 120_000;
const ALLOWED_ARGUMENT_KEYS = new Set([
  "prompt",
  "repository",
  "model",
  "session_id",
]);
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createGatewayHandler(options = {}) {
  const logger = options.logger || console;
  const randomUUID = options.randomUUID || (() => crypto.randomUUID());
  const runtimeInvoker = options.runtimeInvoker || unavailableRuntimeInvoker;

  return async function handleRequest(request, env = {}) {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const url = new URL(request.url);
    let rpcMethod;
    let toolName;
    let status = 500;

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        status = 200;
        return jsonResponse(
          {
            ok: true,
            service: SERVER_INFO.name,
            version: SERVER_INFO.version,
            status: "ready",
          },
          status,
          requestId,
        );
      }

      if (url.pathname !== "/mcp") {
        status = 404;
        return jsonResponse(
          { ok: false, error: "not_found", request_id: requestId },
          status,
          requestId,
        );
      }

      if (request.method === "OPTIONS") {
        const response = handleOptions(request, env, requestId);
        status = response.status;
        return response;
      }

      if (request.method !== "POST") {
        status = 405;
        return new Response(null, {
          status,
          headers: {
            Allow: "POST, OPTIONS",
            "Cache-Control": "no-store",
            "X-Request-ID": requestId,
          },
        });
      }

      const originError = validateOrigin(request, env);
      if (originError) {
        status = 403;
        return jsonResponse(
          { ok: false, error: originError, request_id: requestId },
          status,
          requestId,
        );
      }

      if (!(await isAuthorized(request, env))) {
        status = 401;
        return jsonResponse(
          { ok: false, error: "unauthorized", request_id: requestId },
          status,
          requestId,
          { "WWW-Authenticate": 'Bearer realm="afo-ask-copilot"' },
        );
      }

      const rateLimit = checkRateLimit(request, env, Date.now());
      if (!rateLimit.allowed) {
        status = 429;
        return jsonResponse(
          { ok: false, error: "rate_limited", request_id: requestId },
          status,
          requestId,
          { "Retry-After": String(rateLimit.retryAfterSeconds) },
        );
      }

      if (!isJsonContentType(request.headers.get("content-type"))) {
        status = 415;
        return rpcError(
          null,
          -32600,
          "Content-Type must be application/json",
          requestId,
          status,
        );
      }

      const declaredLength = Number(request.headers.get("content-length") || 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
        status = 413;
        return rpcError(
          null,
          -32600,
          "Request body too large",
          requestId,
          status,
        );
      }

      let rawBody;
      try {
        rawBody = await readBodyWithLimit(request, MAX_REQUEST_BODY_BYTES);
      } catch (error) {
        if (error instanceof Error && error.message === "request_too_large") {
          status = 413;
          return rpcError(
            null,
            -32600,
            "Request body too large",
            requestId,
            status,
          );
        }
        throw error;
      }

      let message;
      try {
        message = JSON.parse(rawBody);
      } catch {
        status = 400;
        return rpcError(null, -32700, "Parse error", requestId, status);
      }

      if (!isPlainObject(message)) {
        status = 400;
        return rpcError(null, -32600, "Invalid Request", requestId, status);
      }

      rpcMethod = typeof message.method === "string" ? message.method : undefined;
      toolName =
        rpcMethod === "tools/call" && typeof message?.params?.name === "string"
          ? message.params.name
          : undefined;

      const response = await handleMcpMessage(
        message,
        requestId,
        env,
        runtimeInvoker,
      );
      status = response.status;
      return response;
    } catch {
      status = 500;
      logger.error?.(
        JSON.stringify({
          level: "error",
          event: "gateway_internal_error",
          request_id: requestId,
          route: url.pathname,
          method: request.method,
          elapsed_ms: Date.now() - startedAt,
        }),
      );
      return rpcError(null, -32603, "Internal error", requestId, status);
    } finally {
      logger.log?.(
        JSON.stringify({
          level: "info",
          event: "gateway_request",
          request_id: requestId,
          route: url.pathname,
          method: request.method,
          rpc_method: rpcMethod,
          tool_name: toolName,
          status,
          elapsed_ms: Date.now() - startedAt,
        }),
      );
    }
  };
}

async function handleMcpMessage(message, requestId, env, runtimeInvoker) {
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = hasId ? message.id : null;

  if (
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string" ||
    (hasId && !isValidRpcId(id))
  ) {
    return rpcError(id, -32600, "Invalid Request", requestId, 400);
  }

  if (message.method === "notifications/initialized") {
    return emptyResponse(204, requestId);
  }

  if (!hasId) {
    return emptyResponse(204, requestId);
  }

  if (message.method === "initialize") {
    const requestedVersion = message?.params?.protocolVersion;
    if (
      typeof requestedVersion !== "string" ||
      !SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
    ) {
      return rpcError(
        id,
        -32602,
        "Unsupported protocol version",
        requestId,
        200,
        { supported_protocol_versions: SUPPORTED_PROTOCOL_VERSIONS },
      );
    }

    return rpcResult(
      id,
      {
        protocolVersion: requestedVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Private single-user read-only gateway. ask_copilot forwards authenticated requests to the v0.3 Copilot Container runtime.",
      },
      requestId,
    );
  }

  if (message.method === "ping") {
    return rpcResult(id, {}, requestId);
  }

  if (message.method === "tools/list") {
    return rpcResult(id, { tools: TOOLS }, requestId);
  }

  if (message.method === "tools/call") {
    return handleToolCall(
      id,
      message.params,
      requestId,
      env,
      runtimeInvoker,
    );
  }

  return rpcError(id, -32601, "Method not found", requestId);
}

async function handleToolCall(id, params, requestId, env, runtimeInvoker) {
  if (!isPlainObject(params) || params.name !== "ask_copilot") {
    return rpcError(id, -32602, "Unknown tool", requestId);
  }

  const validation = validateAskCopilotArguments(params.arguments);
  if (!validation.ok) {
    return rpcError(id, -32602, validation.error, requestId);
  }

  const { prompt, repository, model, session_id: sessionId } = validation.value;
  const timeoutMs = normalizeRuntimeTimeout(env.RUNTIME_TIMEOUT_MS);

  try {
    const runtime = await runtimeInvoker({
      env,
      requestId,
      timeoutMs,
      payload: {
        prompt,
        repository,
        model,
        session_id: sessionId,
        timeout_ms: timeoutMs,
        request_id: requestId,
      },
    });
    const normalized = await normalizeRuntimeResponse(runtime);

    return rpcResult(
      id,
      {
        content: [{ type: "text", text: normalized.text }],
        structuredContent: {
          ok: true,
          request_id: requestId,
          runtime_request_id: normalized.request_id,
          tool_name: "ask_copilot",
          repository: repository || null,
          model: normalized.model,
          session_id: normalized.session_id,
          runtime_status: "copilot_response_received",
        },
        isError: false,
      },
      requestId,
    );
  } catch (error) {
    const normalized = normalizeGatewayRuntimeError(error);
    return rpcResult(
      id,
      {
        content: [{ type: "text", text: normalized.message }],
        structuredContent: {
          ok: false,
          request_id: requestId,
          tool_name: "ask_copilot",
          runtime_status: "copilot_response_not_received",
          error: {
            code: normalized.code,
            message: normalized.message,
          },
        },
        isError: true,
      },
      requestId,
    );
  }
}

export function validateAskCopilotArguments(value) {
  if (!isPlainObject(value)) {
    return { ok: false, error: "arguments must be an object" };
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_ARGUMENT_KEYS.has(key)) {
      return { ok: false, error: `unsupported argument: ${key}` };
    }
  }

  const prompt = validateRequiredString(value.prompt, "prompt", MAX_PROMPT_LENGTH);
  if (!prompt.ok) {
    return prompt;
  }

  const repository = validateOptionalString(value.repository, "repository", 200);
  if (!repository.ok) {
    return repository;
  }
  if (repository.value && !REPOSITORY_PATTERN.test(repository.value)) {
    return { ok: false, error: "repository must use owner/repo format" };
  }

  const model = validateOptionalString(value.model, "model", 100);
  if (!model.ok) {
    return model;
  }

  const sessionId = validateOptionalString(value.session_id, "session_id", 200);
  if (!sessionId.ok) {
    return sessionId;
  }

  return {
    ok: true,
    value: {
      prompt: prompt.value,
      repository: repository.value,
      model: model.value,
      session_id: sessionId.value,
    },
  };
}

async function normalizeRuntimeResponse(response) {
  if (!(response instanceof Response)) {
    throw new GatewayRuntimeError(
      "RUNTIME_UNAVAILABLE",
      "The Copilot runtime did not return an HTTP response.",
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new GatewayRuntimeError(
      "RUNTIME_INVALID_RESPONSE",
      "The Copilot runtime returned an invalid response.",
    );
  }

  if (response.status === 401) {
    throw new GatewayRuntimeError(
      "RUNTIME_AUTHENTICATION_FAILED",
      "Worker-to-Container authentication failed.",
    );
  }

  if (!response.ok || !body?.ok) {
    const code = normalizeErrorCode(body?.error?.code);
    const message = normalizeErrorMessage(code, body?.error?.message);
    throw new GatewayRuntimeError(code, message);
  }

  if (
    typeof body.text !== "string" ||
    typeof body.session_id !== "string" ||
    typeof body.request_id !== "string"
  ) {
    throw new GatewayRuntimeError(
      "RUNTIME_INVALID_RESPONSE",
      "The Copilot runtime returned an incomplete success response.",
    );
  }

  return {
    text: body.text,
    session_id: body.session_id,
    model: typeof body.model === "string" ? body.model : "auto",
    request_id: body.request_id,
  };
}

function normalizeGatewayRuntimeError(error) {
  if (error instanceof GatewayRuntimeError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out/i.test(message)) {
    return new GatewayRuntimeError(
      "RUNTIME_TIMEOUT",
      "The Copilot runtime did not respond before the gateway timeout.",
    );
  }
  return new GatewayRuntimeError(
    "RUNTIME_UNAVAILABLE",
    "The Copilot runtime is unavailable.",
  );
}

function normalizeErrorCode(value) {
  const code = typeof value === "string" ? value : "RUNTIME_ERROR";
  return /^[A-Z0-9_]{3,80}$/.test(code) ? code : "RUNTIME_ERROR";
}

function normalizeErrorMessage(code, value) {
  const safeMessages = {
    COPILOT_TIMEOUT: "Copilot did not finish before the request timeout.",
    COPILOT_SESSION_RESUME_FAILED:
      "The requested Copilot session could not be resumed.",
    COPILOT_MODEL_NOT_FOUND: "The requested Copilot model is not available.",
    RUNTIME_CONFIGURATION_ERROR: "The Copilot runtime is not configured.",
    RUNTIME_UNAUTHORIZED: "Worker-to-Container authentication failed.",
  };
  if (safeMessages[code]) {
    return safeMessages[code];
  }
  if (typeof value === "string" && value.length > 0 && value.length <= 200) {
    return value;
  }
  return "The Copilot runtime could not complete the request.";
}

class GatewayRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GatewayRuntimeError";
    this.code = code;
  }
}

async function unavailableRuntimeInvoker() {
  throw new GatewayRuntimeError(
    "RUNTIME_UNAVAILABLE",
    "The Copilot runtime binding is unavailable.",
  );
}

function normalizeRuntimeTimeout(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_RUNTIME_TIMEOUT_MS;
  }
  return Math.min(MAX_RUNTIME_TIMEOUT_MS, Math.max(MIN_RUNTIME_TIMEOUT_MS, parsed));
}

function validateRequiredString(value, name, maxLength) {
  if (typeof value !== "string") {
    return { ok: false, error: `${name} must be a string` };
  }
  if (value.length === 0) {
    return { ok: false, error: `${name} must not be empty` };
  }
  if (value.length > maxLength) {
    return { ok: false, error: `${name} exceeds maximum length` };
  }
  return { ok: true, value };
}

function validateOptionalString(value, name, maxLength) {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  return validateRequiredString(value, name, maxLength);
}

async function isAuthorized(request, env) {
  if (env.AUTH_MODE === "disabled" && env.DEPLOYMENT_ENV !== "production") {
    return true;
  }

  const configured = env.AFO_ASK_COPILOT_TOKEN;
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (typeof configured !== "string" || configured.length < 24 || !supplied) {
    return false;
  }

  return safeEqual(supplied, configured);
}

async function safeEqual(leftValue, rightValue) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(leftValue))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(rightValue))),
  ]);
  const left = new Uint8Array(leftDigest);
  const right = new Uint8Array(rightDigest);
  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }

  return mismatch === 0;
}

function checkRateLimit(request, env, nowMs) {
  const maximum = parsePositiveInteger(
    env.RATE_LIMIT_REQUESTS,
    DEFAULT_RATE_LIMIT_REQUESTS,
  );
  const windowSeconds = parsePositiveInteger(
    env.RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  );
  const windowMs = windowSeconds * 1000;
  const clientKey = request.headers.get("cf-connecting-ip") || "single-user";
  const current = RATE_LIMIT_BUCKETS.get(clientKey);

  if (!current || nowMs >= current.resetAt) {
    RATE_LIMIT_BUCKETS.set(clientKey, { count: 1, resetAt: nowMs + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= maximum) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validateOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return allowed.includes(origin) ? null : "origin_not_allowed";
}

function handleOptions(request, env, requestId) {
  const originError = validateOrigin(request, env);
  if (originError) {
    return jsonResponse(
      { ok: false, error: originError, request_id: requestId },
      403,
      requestId,
    );
  }

  const origin = request.headers.get("origin");
  const headers = {
    "Access-Control-Allow-Headers":
      "authorization, content-type, mcp-protocol-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "X-Request-ID": requestId,
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }

  return new Response(null, { status: 204, headers });
}

function isJsonContentType(value) {
  if (!value) {
    return false;
  }
  return value.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

async function readBodyWithLimit(request, maximumBytes) {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    output += decoder.decode(value, { stream: true });
  }

  output += decoder.decode();
  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidRpcId(value) {
  return value === null || typeof value === "string" || typeof value === "number";
}

function rpcResult(id, result, requestId) {
  return jsonResponse({ jsonrpc: "2.0", id, result }, 200, requestId);
}

function rpcError(id, code, message, requestId, status = 200, details = {}) {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        data: { request_id: requestId, ...details },
      },
    },
    status,
    requestId,
  );
}

function emptyResponse(status, requestId) {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-ID": requestId,
    },
  });
}

function jsonResponse(value, status, requestId, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-ID": requestId,
      ...extraHeaders,
    },
  });
}
