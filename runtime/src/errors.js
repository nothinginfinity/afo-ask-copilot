export class RuntimeError extends Error {
  constructor(code, message, status = 500, options = {}) {
    super(message, options);
    this.name = "RuntimeError";
    this.code = code;
    this.status = status;
  }
}

export function configurationError(message) {
  return new RuntimeError("RUNTIME_CONFIGURATION_ERROR", message, 503);
}

export function normalizeRuntimeError(error) {
  if (error instanceof RuntimeError) {
    return error;
  }

  return new RuntimeError(
    "RUNTIME_INTERNAL_ERROR",
    "The Copilot runtime encountered an internal error.",
    500,
    { cause: error },
  );
}

export function isTimeoutError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /timed?\s*out|timeout/i.test(message);
}

export function isTransportError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const code = error && typeof error === "object" ? String(error.code || "") : "";
  return /transport|connection|disconnected|closed|json-?rpc|broken pipe|socket|econnreset|epipe/i.test(
    `${code} ${message}`,
  );
}
