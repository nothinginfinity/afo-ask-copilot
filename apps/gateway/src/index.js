import { Container } from "@cloudflare/containers";
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

const handleRequest = createGatewayHandler();

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
