import { randomUUID as defaultRandomUUID, timingSafeEqual } from "node:crypto";
import { normalizeRuntimeError, RuntimeError } from "./errors.js";

export const RUNTIME_VERSION = "0.3.0";
export const MAX_REQUEST_BODY_BYTES = 256_000;
export const MAX_PROMPT_LENGTH = 20_000;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 120_000;

export function createRuntimeService(options) {
  const env = options.env || {};
  const clientManager = options.clientManager;
  const sessionManager = options.sessionManager;
  const logger = options.logger || console;
  const randomUUID = options.randomUUID || defaultRandomUUID;
  let accepting = true;
  let inFlight = 0;
  let startupError = null;

  async function startup() {
    try {
      await clientManager.start();
      startupError = null;
      return { ok: true };
    } catch (error) {
      startupError = normalizeRuntimeError(error);
      logger.error?.(
        JSON.stringify({
          level: "error",
          event: "runtime_startup_not_ready",
          code: startupError.code,
        }),
      );
      return { ok: false, error: startupError };
    }
  }

  async function handle(request) {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const url = new URL(request.url);
    inFlight += 1;

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const state = clientManager.getState();
        const configured = hasSecret(env.RUNTIME_SHARED_SECRET) && state.configured;
        return jsonResponse(
          {
            ok: true,
            service: "afo-ask-copilot-runtime",
            version: RUNTIME_VERSION,
            ready: accepting && configured && state.healthy && !startupError,
            accepting_requests: accepting,
            copilot_token_configured: state.configured,
            runtime_secret_configured: hasSecret(env.RUNTIME_SHARED_SECRET),
            client_started: state.started,
            client_healthy: state.healthy,
          },
          200,
          requestId,
        );
      }

      if (!accepting) {
        throw new RuntimeError(
          "RUNTIME_SHUTTING_DOWN",
          "The Copilot runtime is shutting down.",
          503,
        );
      }

      validateRuntimeAuthorization(request, env.RUNTIME_SHARED_SECRET);

      if (request.method === "GET" && url.pathname === "/v1/models") {
        const models = await sessionManager.listModels();
        return jsonResponse({ ok: true, models, request_id: requestId }, 200, requestId);
      }

      if (request.method === "POST" && url.pathname === "/v1/sessions") {
        const body = await readJsonBody(request);
        const model = optionalString(body.model, "model", 100);
        const created = await sessionManager.createSession({ model });
        return jsonResponse(
          {
            ok: true,
            session_id: created.sessionId,
            model: created.model || "auto",
            request_id: requestId,
          },
          201,
          requestId,
        );
      }

      const resumeMatch =
        request.method === "POST"
          ? url.pathname.match(/^\/v1\/sessions\/([^/]+)\/resume$/)
          : null;
      if (resumeMatch) {
        const body = await readJsonBody(request);
        const sessionId = validateSessionId(decodeURIComponent(resumeMatch[1]));
        const model = optionalString(body.model, "model", 100);
        const resumed = await sessionManager.resumeSession(sessionId, { model });
        return jsonResponse(
          {
            ok: true,
            session_id: resumed.sessionId,
            model: resumed.model || "auto",
            request_id: requestId,
          },
          200,
          requestId,
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/ask") {
        const body = await readJsonBody(request);
        const prompt = requiredString(body.prompt, "prompt", MAX_PROMPT_LENGTH);
        const sessionId = optionalString(body.session_id, "session_id", 200);
        const model = optionalString(body.model, "model", 100);
        const timeoutMs = normalizeTimeout(body.timeout_ms);
        const result = await sessionManager.sendAndWait({
          prompt,
          sessionId,
          model,
          timeoutMs,
        });

        return jsonResponse(
          {
            ok: true,
            session_id: result.sessionId,
            model: result.model,
            text: result.text,
            request_id: requestId,
          },
          200,
          requestId,
        );
      }

      return errorResponse(
        new RuntimeError("RUNTIME_NOT_FOUND", "Runtime route not found.", 404),
        requestId,
      );
    } catch (error) {
      const normalized = normalizeRuntimeError(error);
      logger.error?.(
        JSON.stringify({
          level: "error",
          event: "runtime_request_failed",
          request_id: requestId,
          route: url.pathname,
          method: request.method,
          code: normalized.code,
          elapsed_ms: Date.now() - startedAt,
        }),
      );
      return errorResponse(normalized, requestId);
    } finally {
      inFlight -= 1;
    }
  }

  function beginShutdown() {
    accepting = false;
  }

  async function shutdown(timeoutMs = 5_000) {
    accepting = false;
    const deadline = Date.now() + timeoutMs;
    while (inFlight > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await sessionManager.disconnectAll();
    return clientManager.shutdown();
  }

  function state() {
    return { accepting, inFlight, startupError: startupError?.code || null };
  }

  return { startup, handle, beginShutdown, shutdown, state };
}

function validateRuntimeAuthorization(request, configuredSecret) {
  if (!hasSecret(configuredSecret)) {
    throw new RuntimeError(
      "RUNTIME_CONFIGURATION_ERROR",
      "RUNTIME_SHARED_SECRET is not configured.",
      503,
    );
  }

  const supplied = request.headers.get("x-afo-runtime-token") || "";
  if (!constantTimeEqual(supplied, configuredSecret)) {
    throw new RuntimeError(
      "RUNTIME_UNAUTHORIZED",
      "Worker-to-Container authentication failed.",
      401,
    );
  }
}

function constantTimeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  if (left.length !== right.length) {
    const padded = Buffer.alloc(right.length);
    left.copy(padded, 0, 0, Math.min(left.length, padded.length));
    timingSafeEqual(padded, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

function hasSecret(value) {
  return typeof value === "string" && value.length >= 24;
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new RuntimeError(
      "RUNTIME_REQUEST_TOO_LARGE",
      "Runtime request body is too large.",
      413,
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new RuntimeError(
      "RUNTIME_REQUEST_TOO_LARGE",
      "Runtime request body is too large.",
      413,
    );
  }
  if (bytes.byteLength === 0) {
    return {};
  }

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not_object");
    }
    return value;
  } catch {
    throw new RuntimeError(
      "RUNTIME_INVALID_JSON",
      "Runtime request body must be a JSON object.",
      400,
    );
  }
}

function requiredString(value, name, maxLength) {
  const result = optionalString(value, name, maxLength);
  if (!result) {
    throw new RuntimeError(
      "RUNTIME_INVALID_ARGUMENT",
      `${name} is required.`,
      400,
    );
  }
  return result;
}

function optionalString(value, name, maxLength) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RuntimeError(
      "RUNTIME_INVALID_ARGUMENT",
      `${name} must be a string.`,
      400,
    );
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new RuntimeError(
      "RUNTIME_INVALID_ARGUMENT",
      `${name} is invalid.`,
      400,
    );
  }
  return trimmed;
}

function validateSessionId(value) {
  return requiredString(value, "session_id", 200);
}

function normalizeTimeout(value) {
  if (value === undefined || value === null) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new RuntimeError(
      "RUNTIME_INVALID_ARGUMENT",
      "timeout_ms must be an integer.",
      400,
    );
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
}

function errorResponse(error, requestId) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
      request_id: requestId,
    },
    error.status,
    requestId,
  );
}

function jsonResponse(value, status, requestId) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
