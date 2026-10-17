/* Every flex container with `gap` in app.css must have its twin in
 * legacy-layout.css.
 *
 * Chromium 69 (Tizen 5.5) has no flex gap; compat.js marks such engines with
 * `legacy-flex-gap` and legacy-layout.css stands in with margins. A new flex
 * container that uses gap without a twin there renders with its children
 * touching — on sets nobody here owns, and on none that anybody here does. */
import fs from "fs";
import { fileURLToPath } from "url";

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const app = read("../app/css/app.css");
const legacy = read("../app/css/legacy-layout.css");

const missing = [];
let containers = 0;
for (const m of app.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const body = m[2];
  if (!/(^|[;\s])gap\s*:/.test(body) || !/display\s*:\s*(inline-)?flex\b/.test(body)) { continue; }
  for (const raw of m[1].split(",")) {
    const sel = raw.trim().replace(/\s+/g, " ");
    if (!sel) { continue; }
    containers++;
    const escaped = sel.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");
    if (!new RegExp("\\.legacy-flex-gap\\s+" + escaped + "\\s*[,{]").test(legacy)) { missing.push(sel); }
  }
}

if (missing.length) {
  console.log(`✗ legacy-layout.css has no gap fallback for: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`✓ legacy flex-gap fallbacks — ${containers} containers`);
