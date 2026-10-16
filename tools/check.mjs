/* One local and CI entry point. Keep this list aligned with deploy.sh's checks. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const appJs = path.join(root, "app", "js");
const scripts = [
  ...fs.readdirSync(appJs).filter((name) => name.endsWith(".js"))
    .map((name) => ["--check", path.join(appJs, name)]),
  ...["lint", "md5-verify", "accounts-verify", "mpd-verify",
      "mirrors-verify", "qr-verify", "compat-api-verify", "nav-verify"]
    .map((name) => [path.join(root, "tools", `${name}.mjs`)]),
];

for (const args of scripts) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) { throw result.error; }
  if (result.status !== 0) { process.exit(result.status || 1); }
}
console.log("✓ all repository checks passed");
