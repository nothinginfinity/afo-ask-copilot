import { Container, getContainer } from "@cloudflare/containers";
import { env as workerEnv } from "cloudflare:workers";
import { createGatewayHandler } from "./mcp.js";

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

const handleRequest = createGatewayHandler({
  runtimeInvoker: invokeRuntime,
});

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

async function invokeRuntime({ env, payload, requestId, timeoutMs }) {
  if (!env.COPILOT_RUNTIME || typeof env.RUNTIME_SHARED_SECRET !== "string") {
    throw new Error("runtime_binding_not_configured");
  }

  const container = getContainer(env.COPILOT_RUNTIME, "single-user");
  const runtimeRequest = new Request("http://runtime.internal/v1/ask", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-afo-runtime-token": env.RUNTIME_SHARED_SECRET,
      "x-request-id": requestId,
    },
    body: JSON.stringify(payload),
  });

  return withTimeout(container.fetch(runtimeRequest), timeoutMs + 5_000);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("runtime_timeout")), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
