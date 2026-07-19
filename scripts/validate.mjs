import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  MAX_PROMPT_LENGTH,
  MAX_REQUEST_BODY_BYTES,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOLS,
} from "../apps/gateway/src/mcp.js";

const syntaxFiles = [
  "apps/gateway/src/index.js",
  "apps/gateway/src/mcp.js",
  "runtime/src/server.js",
  "tests/gateway.test.mjs",
];

const jsonFiles = [
  "package.json",
  "apps/gateway/package.json",
  "apps/gateway/mcp.manifest.json",
  "runtime/package.json",
];

for (const path of syntaxFiles) {
  const result = spawnSync(process.execPath, ["--check", path], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const parsedJson = new Map();
for (const path of jsonFiles) {
  parsedJson.set(path, JSON.parse(await readFile(path, "utf8")));
}

const rootPackage = parsedJson.get("package.json");
const gatewayPackage = parsedJson.get("apps/gateway/package.json");
const manifest = parsedJson.get("apps/gateway/mcp.manifest.json");

if (rootPackage.version !== "0.2.0" || gatewayPackage.version !== "0.2.0") {
  throw new Error("Root and gateway package versions must remain synchronized at 0.2.0");
}

if (manifest.version !== rootPackage.version) {
  throw new Error("MCP manifest version must match the root package version");
}

if (JSON.stringify(manifest.tools) !== JSON.stringify(TOOLS)) {
  throw new Error("MCP manifest tools must match the gateway tools/list contract");
}

if (
  JSON.stringify(manifest.protocol_versions) !==
  JSON.stringify(SUPPORTED_PROTOCOL_VERSIONS)
) {
  throw new Error("MCP manifest protocol versions are out of sync");
}

if (
  manifest.limits.request_body_bytes !== MAX_REQUEST_BODY_BYTES ||
  manifest.limits.prompt_characters !== MAX_PROMPT_LENGTH
) {
  throw new Error("MCP manifest request limits are out of sync");
}

if (manifest.transport.token_secret !== "AFO_ASK_COPILOT_TOKEN") {
  throw new Error("MCP manifest must use AFO_ASK_COPILOT_TOKEN");
}

console.log(
  `Validated ${syntaxFiles.length} JavaScript files, ${jsonFiles.length} JSON files, and synchronized MCP metadata.`,
);
