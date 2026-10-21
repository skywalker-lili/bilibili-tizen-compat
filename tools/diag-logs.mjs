/* Read what televisions uploaded (app/js/diag.js → server/diag-worker.mjs).
 *
 *   node tools/diag-logs.mjs                     the latest 30 uploads, newest first
 *   node tools/diag-logs.mjs --device K7QM-3XTA  one television (the code 设置 shows)
 *   node tools/diag-logs.mjs --app douyin-tizen  one app
 *   node tools/diag-logs.mjs <id>                one upload, every line
 *
 * The read token lives outside the repository: ~/.bilibili-tizen-diag-token
 * (mode 600) or BILI_DIAG_TOKEN. The address comes from diag.js's ENDPOINT, or
 * BILI_DIAG_URL (the part before /v1). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

const src = fs.readFileSync(fileURLToPath(new URL("../app/js/diag.js", import.meta.url)), "utf8");
const endpoint = (/var ENDPOINT = "([^"]*)";/.exec(src) || [])[1] || "";
const base = (process.env.BILI_DIAG_URL || endpoint.replace(/\/v1\/upload$/, "")).replace(/\/$/, "");
if (!base) { console.error("没有地址：diag.js 的 ENDPOINT 是空的，也没设 BILI_DIAG_URL"); process.exit(1); }

const tokenFile = path.join(os.homedir(), ".bilibili-tizen-diag-token");
let token = process.env.BILI_DIAG_TOKEN || "";
if (!token) { try { token = fs.readFileSync(tokenFile, "utf8").trim(); } catch (e) {} }
if (!token) { console.error("没有读取令牌：写进 " + tokenFile + "（权限 600），或设 BILI_DIAG_TOKEN"); process.exit(1); }

async function get(p) {
  const res = await fetch(base + p, { headers: { Authorization: "Bearer " + token } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("HTTP " + res.status + " " + (body.error || "")); process.exit(1); }
  return body;
}

const when = (ms) => new Date(ms).toLocaleString("zh-CN", { hour12: false });
const shown = (d) => d.slice(0, 4) + "-" + d.slice(4);
/* The television's clock against the server's: an expired-signature or wbi
 * failure on a set whose clock is hours out reads very differently. */
const skew = (r) => {
  if (!r.tv_at) return "";
  const s = Math.round((r.tv_at - r.at) / 1000);
  return Math.abs(s) > 120 ? `  电视时钟${s > 0 ? "快" : "慢"} ${Math.abs(s)} 秒` : "";
};

const id = args.find((a) => /^[a-z2-9]{8}$/.test(a));
if (id) {
  const r = await get("/v1/get?id=" + id);
  console.log(`${r.id}  ${when(r.at)}  ${r.app}  电视 ${shown(r.device)}  ${r.country || "?"}/${r.colo || "?"}  ${r.via}${skew(r)}`);
  console.log(`装的 ${r.version || "?"}，跑的 ${r.running || "?"}  ${r.manual ? "手动上传" : "自动上传"}：${r.reason}`);
  console.log(`UA ${r.ua}`);
  console.log("—".repeat(40));
  console.log(r.body);
} else {
  const q = new URLSearchParams({ limit: opt("--limit") || "30" });
  if (opt("--device")) q.set("device", opt("--device"));
  if (opt("--app")) q.set("app", opt("--app"));
  const { results } = await get("/v1/list?" + q);
  if (!results.length) { console.log("（没有）"); }
  for (const r of results) {
    console.log(`${r.id}  ${when(r.at)}  ${r.app.replace("-tizen", "")}  ${shown(r.device)}  ${r.country || "?"}  ` +
      `${r.running || r.version}${r.running && r.running !== r.version ? "（装的 " + r.version + "）" : ""}  ` +
      `${r.n} 行  ${r.via}${r.manual ? "  手动" : ""}${skew(r)}  ${r.reason}`);
  }
}
