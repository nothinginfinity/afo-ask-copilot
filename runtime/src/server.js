import http from "node:http";
import { Readable } from "node:stream";
import { CopilotClient } from "@github/copilot-sdk";
import { CopilotClientManager } from "./client-manager.js";
import { CopilotSessionManager } from "./session-manager.js";
import { createRuntimeService } from "./app.js";

const env = process.env;
const logger = console;
const clientManager = new CopilotClientManager({
  env,
  logger,
  createClient: (options) => new CopilotClient(options),
});
const sessionManager = new CopilotSessionManager({ clientManager });
const service = createRuntimeService({ env, clientManager, sessionManager, logger });
const host = env.HOST || "0.0.0.0";
const port = Number(env.PORT || 8080);

await service.startup();

const server = http.createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(
      incoming.url || "/",
      `http://${incoming.headers.host || "localhost"}`,
    );
    const hasBody = !["GET", "HEAD"].includes(incoming.method || "GET");
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(hasBody
        ? { body: Readable.toWeb(incoming), duplex: "half" }
        : {}),
    });
    const response = await service.handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    outgoing.end(
      JSON.stringify({
        ok: false,
        error: {
          code: "RUNTIME_HTTP_ADAPTER_ERROR",
          message: "The runtime HTTP adapter failed.",
        },
      }),
    );
  }
});

server.listen(port, host, () => {
  logger.log(
    JSON.stringify({
      level: "info",
      event: "runtime_started",
      host,
      port,
    }),
  );
});

let shutdownPromise;
async function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    logger.log(
      JSON.stringify({ level: "info", event: "runtime_shutdown", signal }),
    );
    service.beginShutdown();
    await new Promise((resolve) => server.close(resolve));
    const result = await service.shutdown(5_000);
    process.exitCode = result.forced ? 1 : 0;
  })();

  const hardStop = setTimeout(() => {
    process.exitCode = 1;
    process.exit();
  }, 10_000);
  hardStop.unref();
  await shutdownPromise;
  clearTimeout(hardStop);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
