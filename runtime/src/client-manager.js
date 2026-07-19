import { configurationError, RuntimeError } from "./errors.js";

const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export class CopilotClientManager {
  constructor(options) {
    this.env = options.env || {};
    this.createClient = options.createClient;
    this.logger = options.logger || console;
    this.stopTimeoutMs = options.stopTimeoutMs || DEFAULT_STOP_TIMEOUT_MS;
    this.client = null;
    this.clientPromise = null;
    this.healthy = false;
    this.generation = 0;
    this.lastStatus = null;
    this.lastAuthStatus = null;
  }

  validateConfiguration() {
    const token = this.env.COPILOT_GITHUB_TOKEN;
    if (typeof token !== "string" || token.trim().length === 0) {
      throw configurationError("COPILOT_GITHUB_TOKEN is not configured.");
    }
    if (typeof this.createClient !== "function") {
      throw configurationError("The Copilot SDK client factory is unavailable.");
    }
    return token;
  }

  async start() {
    return this.getClientRecord();
  }

  async getClient() {
    const record = await this.getClientRecord();
    return record.client;
  }

  async getClientRecord() {
    if (this.client && this.healthy) {
      return { client: this.client, generation: this.generation };
    }

    if (!this.clientPromise) {
      this.clientPromise = this.#createFreshClient().finally(() => {
        this.clientPromise = null;
      });
    }

    return this.clientPromise;
  }

  async #createFreshClient() {
    const token = this.validateConfiguration();
    if (this.client) {
      await this.#stopSpecificClient(this.client, true);
      this.client = null;
    }

    const client = this.createClient({
      gitHubToken: token,
      useLoggedInUser: false,
    });

    try {
      await client.start();
      this.lastStatus =
        typeof client.getStatus === "function" ? await client.getStatus() : null;
      this.lastAuthStatus =
        typeof client.getAuthStatus === "function"
          ? await client.getAuthStatus()
          : null;
      this.client = client;
      this.healthy = true;
      this.generation += 1;
      return { client, generation: this.generation };
    } catch (error) {
      this.healthy = false;
      await this.#stopSpecificClient(client, true);
      throw new RuntimeError(
        "COPILOT_CLIENT_START_FAILED",
        "The Copilot client could not start.",
        503,
        { cause: error },
      );
    }
  }

  markUnhealthy(error) {
    this.healthy = false;
    this.logger.error?.(
      JSON.stringify({
        level: "error",
        event: "copilot_client_unhealthy",
        code: "COPILOT_TRANSPORT_ERROR",
        error_name: error instanceof Error ? error.name : "Error",
      }),
    );
  }

  getState() {
    return {
      configured: Boolean(this.env.COPILOT_GITHUB_TOKEN),
      started: Boolean(this.client),
      healthy: this.healthy,
      generation: this.generation,
    };
  }

  async shutdown() {
    const client = this.client;
    this.client = null;
    this.healthy = false;
    if (!client) {
      return { forced: false, cleanup_errors: 0 };
    }
    return this.#stopSpecificClient(client, true);
  }

  async #stopSpecificClient(client, forceOnFailure) {
    let cleanupErrors = [];
    let gracefulFailed = false;

    try {
      const result = await withTimeout(
        Promise.resolve(client.stop()),
        this.stopTimeoutMs,
      );
      cleanupErrors = Array.isArray(result) ? result : [];
      gracefulFailed = cleanupErrors.length > 0;
    } catch {
      gracefulFailed = true;
    }

    if (gracefulFailed && forceOnFailure && typeof client.forceStop === "function") {
      await Promise.resolve(client.forceStop()).catch(() => {});
      return { forced: true, cleanup_errors: cleanupErrors.length };
    }

    return { forced: false, cleanup_errors: cleanupErrors.length };
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("shutdown_timeout")), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}
