import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const javascriptFiles = [
  "apps/gateway/src/index.js",
  "apps/gateway/src/mcp.js",
  "runtime/src/errors.js",
  "runtime/src/client-manager.js",
  "runtime/src/session-manager.js",
  "runtime/src/app.js",
  "runtime/src/server.js",
  "runtime/src/verify-bundled-cli.js",
  "scripts/validate.mjs",
  "tests/gateway.test.mjs",
  "tests/runtime.test.mjs",
];

for (const file of javascriptFiles) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

const rootPackage = await readJson("package.json");
const gatewayPackage = await readJson("apps/gateway/package.json");
const runtimePackage = await readJson("runtime/package.json");
const manifest = await readJson("apps/gateway/mcp.manifest.json");
const rootLock = await readJson("package-lock.json");
const runtimeLock = await readJson("runtime/package-lock.json");
const wrangler = await readJson("apps/gateway/wrangler.jsonc");
const dockerfile = await readFile("runtime/Dockerfile", "utf8");
const gatewaySource = await readFile("apps/gateway/src/mcp.js", "utf8");
const runtimeSource = await readFile("runtime/src/client-manager.js", "utf8");

assert(rootPackage.version === "0.3.0", "root package version must be 0.3.0");
assert(gatewayPackage.version === "0.3.0", "gateway package version must be 0.3.0");
assert(runtimePackage.version === "0.3.0", "runtime package version must be 0.3.0");
assert(manifest.version === "0.3.0", "manifest version must be 0.3.0");
assert(
  runtimePackage.dependencies["@github/copilot-sdk"] === "1.0.7",
  "runtime must pin @github/copilot-sdk@1.0.7",
);
assertLock(rootLock, "root");
assertLock(runtimeLock, "runtime");
assert(
  gatewayPackage.dependencies["@cloudflare/containers"] === "0.3.7",
  "gateway Container dependency must be pinned",
);
assert(manifest.tools.length === 1, "manifest must expose exactly one tool");
assert(manifest.tools[0].name === "ask_copilot", "manifest tool must be ask_copilot");
assert(manifest.mutation_tools_enabled === false, "mutation tools must remain disabled");
assert(
  manifest.transport.token_secret === "AFO_ASK_COPILOT_TOKEN",
  "gateway bearer secret name must remain synchronized",
);
assert(
  manifest.limits.request_body_bytes === 256000 &&
    manifest.limits.prompt_characters === 20000,
  "manifest request limits must remain synchronized",
);
assert(
  wrangler.vars.RUNTIME_TIMEOUT_MS === "60000",
  "Wrangler runtime timeout must be explicit",
);
assert(
  dockerfile.includes("FROM node:22-") && dockerfile.includes("npm ci"),
  "Dockerfile must use Node 22 and npm ci",
);
assert(dockerfile.includes("USER node"), "Dockerfile must run as non-root node user");
assert(dockerfile.includes("HEALTHCHECK"), "Dockerfile must define a health check");
assert(
  !dockerfile.includes("COPILOT_GITHUB_TOKEN=") &&
    !dockerfile.includes("RUNTIME_SHARED_SECRET="),
  "Dockerfile must not bake secret values",
);
assert(
  gatewaySource.includes('runtime_status: "copilot_response_received"') &&
    gatewaySource.includes('runtime_status: "copilot_response_not_received"'),
  "gateway must distinguish successful Copilot responses from failures",
);
assert(
  runtimeSource.includes("gitHubToken: token") &&
    runtimeSource.includes("useLoggedInUser: false"),
  "runtime must use verified client-level authentication",
);

console.log(
  JSON.stringify({
    ok: true,
    version: "0.3.0",
    javascript_files_checked: javascriptFiles.length,
    sdk_version: rootLock.packages["node_modules/@github/copilot-sdk"].version,
    copilot_runtime_version: rootLock.packages["node_modules/@github/copilot"].version,
    bundled_cli_version:
      rootLock.packages["node_modules/@github/copilot-linux-x64"]?.version || null,
  }),
);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertLock(lock, name) {
  assert(
    lock.packages["node_modules/@github/copilot-sdk"]?.version === "1.0.7",
    `${name} lockfile must resolve @github/copilot-sdk@1.0.7`,
  );
  assert(
    lock.packages["node_modules/@github/copilot"]?.version === "1.0.71",
    `${name} lockfile must resolve @github/copilot@1.0.71`,
  );
  assert(
    lock.packages["node_modules/@github/copilot-linux-x64"]?.version === "1.0.71",
    `${name} lockfile must include the Linux x64 bundled Copilot CLI`,
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
