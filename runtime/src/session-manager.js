import { randomUUID as defaultRandomUUID } from "node:crypto";
import {
  isTimeoutError,
  isTransportError,
  RuntimeError,
} from "./errors.js";

const READ_ONLY_PREFIX =
  "Operate in read-only advisory mode. Return text only. Do not modify files, repositories, branches, pull requests, workflows, deployments, or external systems. Do not execute shell, filesystem, MCP, or mutation tools. ";

export class CopilotSessionManager {
  constructor(options) {
    this.clientManager = options.clientManager;
    this.randomUUID = options.randomUUID || defaultRandomUUID;
    this.sessions = new Map();
  }

  async listModels() {
    const { client } = await this.clientManager.getClientRecord();
    const models = await client.listModels();
    return normalizeModels(models);
  }

  async createSession(config = {}) {
    const { client, generation } = await this.clientManager.getClientRecord();
    const sessionId = this.randomUUID();
    const model = await this.#resolveModel(config.model);
    const session = await client.createSession(
      buildSessionConfig({ sessionId, model }),
    );
    const stableId = requireSessionId(session, sessionId);
    this.sessions.set(stableId, { session, generation, model });
    return { session, sessionId: stableId, model };
  }

  async resumeSession(sessionId, config = {}) {
    const { client, generation } = await this.clientManager.getClientRecord();
    const model = await this.#resolveModel(config.model);

    try {
      const session = await client.resumeSession(
        sessionId,
        buildResumeConfig({ model }),
      );
      const stableId = requireSessionId(session, sessionId);
      this.sessions.set(stableId, { session, generation, model });
      return { session, sessionId: stableId, model };
    } catch (error) {
      if (isTransportError(error)) {
        this.clientManager.markUnhealthy(error);
        this.sessions.clear();
        throw new RuntimeError(
          "COPILOT_TRANSPORT_ERROR",
          "The Copilot transport failed while resuming the session.",
          503,
          { cause: error },
        );
      }
      throw new RuntimeError(
        "COPILOT_SESSION_RESUME_FAILED",
        "The requested Copilot session could not be resumed.",
        409,
        { cause: error },
      );
    }
  }

  async sendAndWait(options) {
    const prompt = options.prompt;
    const timeoutMs = options.timeoutMs;
    const requestedSessionId = options.sessionId;
    const requestedModel = options.model;
    const { generation } = await this.clientManager.getClientRecord();

    let record = requestedSessionId ? this.sessions.get(requestedSessionId) : null;
    if (record && record.generation !== generation) {
      this.sessions.delete(requestedSessionId);
      record = null;
    }

    let resolved;
    if (record) {
      resolved = {
        ...record,
        sessionId: requestedSessionId,
      };
      if (requestedModel && requestedModel !== record.model) {
        const model = await this.#resolveModel(requestedModel);
        if (typeof record.session.setModel === "function") {
          await record.session.setModel(model);
        }
        record.model = model;
        resolved.model = model;
      }
    } else if (requestedSessionId) {
      resolved = await this.resumeSession(requestedSessionId, {
        model: requestedModel,
      });
    } else {
      resolved = await this.createSession({ model: requestedModel });
    }

    try {
      const result = await resolved.session.sendAndWait(
        { prompt: `${READ_ONLY_PREFIX}${prompt}` },
        timeoutMs,
      );

      if (!result) {
        throw new RuntimeError(
          "COPILOT_EMPTY_RESPONSE",
          "Copilot completed without a final assistant message.",
          502,
        );
      }

      const text = result?.data?.content;
      if (typeof text !== "string" || text.length === 0) {
        throw new RuntimeError(
          "COPILOT_EMPTY_RESPONSE",
          "Copilot completed without text content.",
          502,
        );
      }

      return {
        sessionId: resolved.sessionId,
        model: resolved.model || "auto",
        text,
      };
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw error;
      }

      if (isTimeoutError(error)) {
        await Promise.resolve(resolved.session.abort?.()).catch(() => {});
        throw new RuntimeError(
          "COPILOT_TIMEOUT",
          "Copilot did not finish before the request timeout.",
          504,
          { cause: error },
        );
      }

      if (isTransportError(error)) {
        this.clientManager.markUnhealthy(error);
        this.sessions.clear();
        throw new RuntimeError(
          "COPILOT_TRANSPORT_ERROR",
          "The Copilot transport failed during the request.",
          503,
          { cause: error },
        );
      }

      throw new RuntimeError(
        "COPILOT_SESSION_ERROR",
        "The Copilot session could not complete the request.",
        502,
        { cause: error },
      );
    }
  }

  async disconnectAll() {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(
      sessions.map(({ session }) => Promise.resolve(session.disconnect?.())),
    );
  }

  async #resolveModel(requestedModel) {
    if (!requestedModel) {
      return undefined;
    }
    const models = await this.listModels();
    if (!models.some((model) => model.id === requestedModel)) {
      throw new RuntimeError(
        "COPILOT_MODEL_NOT_FOUND",
        "The requested Copilot model is not available.",
        400,
      );
    }
    return requestedModel;
  }
}

export function normalizeModels(models) {
  if (!Array.isArray(models)) {
    return [];
  }

  return models
    .filter((model) => model && (typeof model === "string" || typeof model === "object"))
    .map((model) => {
      if (typeof model === "string") {
        return {
          id: model,
          name: model,
          capabilities: null,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
        };
      }

      const id = String(model.id || model.name || "unknown");
      return {
        id,
        name: String(model.name || model.id || "unknown"),
        capabilities: model.capabilities ?? null,
        supportedReasoningEfforts:
          model.supportedReasoningEfforts ??
          model.supported_reasoning_efforts ??
          [],
        defaultReasoningEffort:
          model.defaultReasoningEffort ??
          model.default_reasoning_effort ??
          null,
      };
    });
}

function buildSessionConfig({ sessionId, model }) {
  return {
    sessionId,
    ...(model ? { model } : {}),
    streaming: false,
    availableTools: [],
  };
}

function buildResumeConfig({ model }) {
  return {
    ...(model ? { model } : {}),
    streaming: false,
    availableTools: [],
    suppressResumeEvent: false,
  };
}

function requireSessionId(session, fallback) {
  const sessionId = session?.sessionId || fallback;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new RuntimeError(
      "COPILOT_SESSION_ID_MISSING",
      "Copilot did not return a stable session identifier.",
      502,
    );
  }
  return sessionId;
}
