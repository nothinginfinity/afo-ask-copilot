import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const syntaxFiles = [
  "apps/gateway/src/index.js",
  "runtime/src/server.js",
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

for (const path of jsonFiles) {
  JSON.parse(await readFile(path, "utf8"));
}

console.log(`Validated ${syntaxFiles.length} JavaScript files and ${jsonFiles.length} JSON files.`);
