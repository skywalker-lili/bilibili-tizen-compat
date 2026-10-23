/* Receives diagnostics from the Tizen apps (app/js/diag.js) and keeps them for
 * 30 days. A Cloudflare Worker with one D1 database; see server/README.md for
 * how it is deployed and tools/diag-logs.mjs for reading what arrived.
 *
 * Anyone can POST here: the address ships inside a public app, so no secret in
 * it would stay secret. What bounds the damage is shape and size checks, a
 * per-device hourly limit and a global daily cap, and a 30-day lifetime.
 * Reading needs the token in READ_TOKEN (a Worker secret).
 *
 * The client scrubs before sending (names, titles, credentials); this end does
 * not store the sender's IP address — only the country Cloudflare resolves it
 * to, because "which region's CDN" is exactly the question issue #5 could not
 * answer. */

const APPS = new Set(["bilibili-tizen", "douyin-tizen", "telegram-tizen"]);
const MAX_BYTES = 600000;        // diag.js caps its ring at 160k characters; CJK is 3 bytes each
const MAX_LINES = 2000;
const MAX_LINE = 5000;
const PER_DEVICE_HOUR = 20;
const PER_DAY = 20000;            // D1's free tier writes 100k rows a day; each upload is two
const KEEP_MS = 30 * 86400000;
const ID_ALPHABET = "abcdefghjkmnpqrstvwxyz23456789";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

function str(v, n) { return String(v == null ? "" : v).slice(0, n); }

function makeId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authed(request, env) {
  const h = request.headers.get("Authorization") || "";
  return !!env.READ_TOKEN && sameString(h, "Bearer " + env.READ_TOKEN);
}

async function upload(request, env, url) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: "too large" }, 413);
  let d;
  try { d = JSON.parse(text); } catch (e) { return json({ error: "not json" }, 400); }
  if (!d || d.v !== 1 || !APPS.has(d.app) || !/^[A-Z2-9]{8}$/.test(d.device || "") ||
      !Array.isArray(d.lines) || d.lines.length > MAX_LINES ||
      !d.lines.every((l) => typeof l === "string" && l.length <= MAX_LINE)) {
    return json({ error: "bad shape" }, 400);
  }

  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads WHERE device = ? AND at > ?")
    .bind(d.device, now - 3600000).first();
  if (recent && recent.n >= PER_DEVICE_HOUR) return json({ error: "too many from this device" }, 429);
  const day = new Date(now).toISOString().slice(0, 10);
  const count = await env.DB.prepare(
    "INSERT INTO daily (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n")
    .bind(day).first();
  if (count && count.n > PER_DAY) return json({ error: "daily cap" }, 429);

  const cf = request.cf || {};
  const id = makeId();
  await env.DB.prepare(
    "INSERT INTO uploads (id, at, app, device, version, running, reason, manual, country, colo, ua, via, tv_at, tz, n, body) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, now, d.app, d.device, str(d.version, 32), str(d.running, 32), str(d.reason, 300),
          d.manual ? 1 : 0, str(cf.country, 8), str(cf.colo, 8), str(d.ua, 300),
          url.protocol.replace(":", ""), Number(d.tvAt) || 0, Number(d.tz) || 0,
          d.lines.length, d.lines.join("\n"))
    .run();
  return json({ id });
}

const COLUMNS = "id, at, app, device, version, running, reason, manual, country, colo, ua, via, tv_at, tz, n";

async function list(env, url) {
  const p = url.searchParams;
  const where = ["at > ?"], args = [Number(p.get("since")) || 0];
  const device = (p.get("device") || "").toUpperCase().replace(/-/g, "");
  if (device) { where.push("device = ?"); args.push(device); }
  if (p.get("app")) { where.push("app = ?"); args.push(p.get("app")); }
  const limit = Math.max(1, Math.min(200, Number(p.get("limit")) || 30));
  const r = await env.DB.prepare(`SELECT ${COLUMNS} FROM uploads WHERE ${where.join(" AND ")} ORDER BY at DESC LIMIT ?`)
    .bind(...args, limit).all();
  return json({ results: r.results || [] });
}

async function getOne(env, url) {
  const row = await env.DB.prepare(`SELECT ${COLUMNS}, body FROM uploads WHERE id = ?`)
    .bind(url.searchParams.get("id") || "").first();
  return row ? json(row) : json({ error: "not found" }, 404);
}

/* Self-update, relayed (2026-10-22). The apps fetch their signed manifest and
 * bundles from GitHub and jsDelivr, and on some networks neither is
 * dependable — raw.githubusercontent.com does not resolve, jsDelivr comes and
 * goes. This domain is reachable there, so it carries a copy: the
 * manifest from master, a bundle from its release tag. Nothing here can be
 * trusted by the television and nothing needs to be — the manifest is signed
 * and names the bundle's sha256, so a changed byte is refused on the set. */
const UPSTREAM = "https://raw.githubusercontent.com/titlog/";
const MANIFEST_TTL = 300;                // plus GitHub raw's own five: a release reaches every edge within ~10 min
const BUNDLE_TTL = 30 * 86400;           // a tag's bundle never changes

async function relay(url) {
  const m = /^\/v1\/update\/([a-z-]+)\/(?:manifest\.json|bundle-(\d{1,4}\.\d{1,4}\.\d{1,4})\.json)$/.exec(url.pathname);
  if (!m || !APPS.has(m[1])) return json({ error: "not found" }, 404);
  const [, app, version] = m;
  const src = version
    ? `${UPSTREAM}${app}/v${version}/update/bundle-${version}.json`
    : `${UPSTREAM}${app}/master/update/manifest.json`;
  const ttl = version ? BUNDLE_TTL : MANIFEST_TTL;
  let r;
  try {
    r = await fetch(src, { cf: { cacheTtl: ttl, cacheEverything: true } });
  } catch (e) {
    return json({ error: "upstream unreachable" }, 502);
  }
  if (!r.ok) return json({ error: "upstream " + r.status }, r.status === 404 ? 404 : 502);
  return new Response(r.body, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + ttl, ...CORS },
  });
}

async function prune(env, now = Date.now()) {
  await env.DB.prepare("DELETE FROM uploads WHERE at < ?").bind(now - KEEP_MS).run();
  await env.DB.prepare("DELETE FROM daily WHERE day < ?").bind(new Date(now - KEEP_MS).toISOString().slice(0, 10)).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/v1/upload" && request.method === "POST") return upload(request, env, url);
    if (url.pathname === "/v1/list" && request.method === "GET") {
      return authed(request, env) ? list(env, url) : json({ error: "unauthorized" }, 401);
    }
    if (url.pathname === "/v1/get" && request.method === "GET") {
      return authed(request, env) ? getOne(env, url) : json({ error: "unauthorized" }, 401);
    }
    if (url.pathname.startsWith("/v1/update/") && request.method === "GET") return relay(url);
    return json({ error: "not found" }, 404);
  },
  async scheduled(event, env) { await prune(env); },
};

export const _test = { prune, PER_DEVICE_HOUR, PER_DAY, KEEP_MS, MANIFEST_TTL, BUNDLE_TTL };
