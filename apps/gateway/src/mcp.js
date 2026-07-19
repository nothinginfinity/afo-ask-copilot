const SERVER_INFO = Object.freeze({
  name: "afo-ask-copilot",
  version: "0.2.0",
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
      "Accept a read-only question for GitHub Copilot. In v0.2 the gateway returns an explicit placeholder and does not contact Copilot.",
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
          description: "Optional repository in owner/repo form.",
        }),
        model: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "Optional future Copilot model identifier.",
        }),
        session_id: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Optional future resumable Copilot session identifier.",
        }),
      }),
      required: Object.freeze(["prompt"]),
    }),
  }),
]);

const RATE_LIMIT_BUCKETS = new Map();
const DEFAULT_RATE_LIMIT_REQUESTS = 60;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const ALLOWED_ARGUMENT_KEYS = new Set([
  "prompt",
  "repository",
  "model",
  "session_id",
]);
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createGatewayHandler(options = {}) {
  const logger = options.logger || console;
  const now = options.now || (() => new Date());
  const randomUUID = options.randomUUID || (() => crypto.randomUUID());

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

      const response = handleMcpMessage(message, requestId, now);
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
      return rpcError(
        null,
        -32603,
        "Internal error",
        requestId,
        status,
      );
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

function handleMcpMessage(message, requestId, now) {
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
          "Private single-user read-only gateway. v0.2 accepts ask_copilot requests but does not contact the Copilot runtime.",
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
    return handleToolCall(id, message.params, requestId, now);
  }

  return rpcError(id, -32601, "Method not found", requestId);
}

function handleToolCall(id, params, requestId, now) {
  if (!isPlainObject(params) || params.name !== "ask_copilot") {
    return rpcError(id, -32602, "Unknown tool", requestId);
  }

  const validation = validateAskCopilotArguments(params.arguments);
  if (!validation.ok) {
    return rpcError(id, -32602, validation.error, requestId);
  }

  const { prompt, repository, model, session_id: sessionId } = validation.value;
  const timestamp = now().toISOString();
  const metadata = {
    accepted: true,
    request_id: requestId,
    tool_name: "ask_copilot",
    repository: repository || null,
    model: model || "auto",
    session_id: sessionId || null,
    runtime_status: "not_contacted_placeholder_v0.2",
    timestamp,
    prompt_length: prompt.length,
    message:
      "The Remote MCP gateway accepted and validated this request. GitHub Copilot was not contacted; Container runtime execution is scheduled for v0.3.",
  };

  return rpcResult(
    id,
    {
      content: [{ type: "text", text: metadata.message }],
      structuredContent: metadata,
      isError: false,
    },
    requestId,
  );
}

function validateAskCopilotArguments(value) {
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
