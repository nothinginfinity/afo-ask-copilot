import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const platformPackages = {
  "linux-x64": "@github/copilot-linux-x64",
  "linux-arm64": "@github/copilot-linux-arm64",
  "darwin-x64": "@github/copilot-darwin-x64",
  "darwin-arm64": "@github/copilot-darwin-arm64",
  "win32-x64": "@github/copilot-win32-x64",
  "win32-arm64": "@github/copilot-win32-arm64",
};

const platformKey = `${process.platform}-${process.arch}`;
const packageName = platformPackages[platformKey];
if (!packageName) {
  throw new Error(`Unsupported Copilot CLI platform: ${platformKey}`);
}

const sdkEntry = require.resolve("@github/copilot-sdk");
const nodeModules = findNodeModulesRoot(path.dirname(sdkEntry));
const packagePath = path.join(nodeModules, ...packageName.split("/"), "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const binValue =
  typeof packageJson.bin === "string"
    ? packageJson.bin
    : packageJson.bin?.copilot || Object.values(packageJson.bin || {})[0];
if (typeof binValue !== "string") {
  throw new Error(`${packageName} does not declare a Copilot binary.`);
}

const binaryPath = path.resolve(path.dirname(packagePath), binValue);
await access(binaryPath, process.platform === "win32" ? constants.F_OK : constants.X_OK);

console.log(
  JSON.stringify({
    ok: true,
    sdk_version: "1.0.7",
    cli_package: packageName,
    cli_version: packageJson.version,
    binary: path.relative(nodeModules, binaryPath),
  }),
);

function findNodeModulesRoot(start) {
  let current = start;
  while (true) {
    if (path.basename(current) === "node_modules") {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate node_modules for Copilot SDK.");
    }
    current = parent;
  }
}
