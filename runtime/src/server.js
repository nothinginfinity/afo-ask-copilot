import http from "node:http";
import { randomUUID } from "node:crypto";
import { CopilotClient } from "@github/copilot-sdk";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const READ_ONLY_PREFIX =
  "Operate in read-only advisory mode. Do not modify files, repositories, branches, pull requests, workflows, deployments, or external systems. Do not execute mutation tools. ";

let clientPromise;
const sessionStatus = new Map();

const server = http.createServer(async (request, response) => {
  const requestId = randomUUID();
  const startedAt = Date.now();

  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "afo-ask-copilot-runtime",
        version: "0.1.0",
        sdk_configured: Boolean(process.env.COPILOT_GITHUB_TOKEN),
      });
    }

    if (!isRuntimeAuthorized(request)) {
      return sendJson(response, 401, {
        ok: false,
        error: "unauthorized",
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      const client = await getClient();
      const models =
        typeof client.listModels === "function" ? await client.listModels() : [];

      return sendJson(response, 200, {
        ok: true,
        models: normalizeModels(models),
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/ask") {
      const body = await readJsonBody(request);
      const prompt = requireString(body.prompt, "prompt", 20000);
      const model = optionalString(body.model, 100) || "auto";
      const requestedSessionId = optionalString(body.session_id, 200);
      const client = await getClient();
      const sessionId = requestedSessionId || randomUUID();
      const session = await createOrResumeSession(client, sessionId, model);

      sessionStatus.set(sessionId, {
        status: "running",
        model,
        updated_at: new Date().toISOString(),
      });

      try {
        const result = await session.sendAndWait({
          prompt: `${READ_ONLY_PREFIX}${prompt}`,
        });

        const content = result?.data?.content;
        sessionStatus.set(sessionId, {
          status: "idle",
          model,
          updated_at: new Date().toISOString(),
        });

        return sendJson(response, 200, {
          ok: true,
          session_id: sessionId,
          model,
          content:
            typeof content === "string"
              ? content
              : "Copilot completed without text content.",
        });
      } finally {
        if (typeof session.disconnect === "function") {
          await session.disconnect().catch(() => {});
        }
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/sessions") {
      const body = await readJsonBody(request);
      const model = optionalString(body.model, 100) || "auto";
      const sessionId = randomUUID();
      const client = await getClient();
      const session = await client.createSession(
        buildSessionConfig(sessionId, model),
      );

      sessionStatus.set(sessionId, {
        status: "idle",
        model,
        updated_at: new Date().toISOString(),
      });

      if (typeof session.disconnect === "function") {
        await session.disconnect().catch(() => {});
      }

      return sendJson(response, 201, {
        ok: true,
        session_id: sessionId,
        status: "idle",
        model,
      });
    }

    const resumeMatch =
      request.method === "POST"
        ? url.pathname.match(/^\/v1\/sessions\/([^/]+)\/resume$/)
        : null;

    if (resumeMatch) {
      const sessionId = decodeURIComponent(resumeMatch[1]);
      const client = await getClient();
      const session = await client.resumeSession(sessionId);

      sessionStatus.set(sessionId, {
        ...(sessionStatus.get(sessionId) || {}),
        status: "idle",
        updated_at: new Date().toISOString(),
      });

      if (typeof session.disconnect === "function") {
        await session.disconnect().catch(() => {});
      }

      return sendJson(response, 200, {
        ok: true,
        session_id: sessionId,
        status: "idle",
      });
    }

    const statusMatch =
      request.method === "GET"
        ? url.pathname.match(/^\/v1\/sessions\/([^/]+)$/)
        : null;

    if (statusMatch) {
      const sessionId = decodeURIComponent(statusMatch[1]);
      const status = sessionStatus.get(sessionId);

      if (!status) {
        return sendJson(response, 404, {
          ok: false,
          error: "session_status_not_found",
          session_id: sessionId,
        });
      }

      return sendJson(response, 200, {
        ok: true,
        session_id: sessionId,
        ...status,
      });
    }

    return sendJson(response, 404, {
      ok: false,
      error: "not_found",
    });
  } catch (error) {
    const category = normalizeError(error);
    console.error(
      JSON.stringify({
        level: "error",
        request_id: requestId,
        category,
        elapsed_ms: Date.now() - startedAt,
      }),
    );

    return sendJson(response, category === "request_too_large" ? 413 : 500, {
      ok: false,
      error: category,
      request_id: requestId,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "runtime_started",
      host: HOST,
      port: PORT,
    }),
  );
});

async function getClient() {
  if (!process.env.COPILOT_GITHUB_TOKEN) {
    throw new Error("copilot_token_not_configured");
  }

  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new CopilotClient({
        env: {
          COPILOT_GITHUB_TOKEN: process.env.COPILOT_GITHUB_TOKEN,
        },
      });

      if (typeof client.start === "function") {
        await client.start();
      }

      return client;
    })().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }

  return clientPromise;
}

function buildSessionConfig(sessionId, model) {
  return {
    sessionId,
    model,
    streaming: false,
    availableTools: [],
  };
}

async function createOrResumeSession(client, sessionId, model) {
  try {
    return await client.resumeSession(sessionId);
  } catch {
    return client.createSession(buildSessionConfig(sessionId, model));
  }
}

function normalizeModels(models) {
  if (!Array.isArray(models)) {
    return [];
  }

  return models.map((model) => {
    if (typeof model === "string") {
      return { id: model };
    }

    if (model && typeof model === "object") {
      return {
        id: model.id || model.name || "unknown",
        name: model.name || model.id || "unknown",
      };
    }

    return { id: "unknown" };
  });
}

function isRuntimeAuthorized(request) {
  const configured = process.env.RUNTIME_SHARED_SECRET;

  if (!configured) {
    return process.env.NODE_ENV !== "production";
  }

  const supplied = request.headers["x-afo-runtime-token"];
  return safeEqual(String(supplied || ""), configured);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left[index] ^ right[index];
  }
  return result === 0;
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256000) {
      throw new Error("request_too_large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requireString(value, name, maxLength) {
  const result = optionalString(value, maxLength);
  if (!result) {
    throw new Error(`invalid_${name}`);
  }
  return result;
}

function optionalString(value, maxLength) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error("invalid_string");
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error("invalid_string");
  }

  return trimmed;
}

function sendJson(response, status, value) {
  if (response.writableEnded) {
    return;
  }

  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function normalizeError(error) {
  const message =
    error instanceof Error && error.message ? error.message : "unknown_error";

  if (message === "request_too_large") {
    return message;
  }

  return message
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted-token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 200);
}

async function shutdown(signal) {
  console.log(JSON.stringify({ level: "info", message: "shutdown", signal }));

  try {
    const client = await clientPromise;
    if (client && typeof client.stop === "function") {
      await client.stop();
    }
  } catch {
    // Shutdown must continue even if the SDK failed to initialize.
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
