/* Screenshots for the README, taken in desktop Chromium: the player with
 * danmaku (03-player-danmaku), the play panel (04-panel), scrubbing
 * (03-player-scrub) and the settings page scrolled from 播放 to 自动更新
 * (06-settings). Home, search and comments (01, 02, 05) were taken by hand.
 *
 *   PICK=绵羊料理 node tools/readme-shots.mjs [outdir]    # default dist/readme-shots
 *
 * Written to dist/ to be looked at first, not straight into docs/screenshots:
 * what scrolls across the picture is whatever strangers typed (10-18: one run
 * caught a remark not fit for a public README), so PICK names the card to play
 * by a piece of its title. Also as of 10-18: the scrub thumbnail comes out as a
 * black box on the desktop (the README's scrub shot is gone; the danmaku one
 * replaced it), and the panel shows danmaku drifting behind its rows, so the
 * README keeps the older panel shot.
 *
 * Runs tools/devserver.mjs --no-auth: logged out, so no account shows. It does
 * reach bilibili — a feed, a video or two, their danmaku pools and thumbnails,
 * twenty-odd requests. Run it once, not in a loop: on 10-18 a few desktop runs
 * of the danmaku measurement got this IP a 412 for half an hour, and the
 * television shares the IP. Needs Playwright from the douyin-tizen desktop
 * harness, like tools/update-e2e.mjs.
 *
 * 1920×1080 laid out, written at 1600×900 like the rest of docs/screenshots. */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "dist/readme-shots"));
const require = createRequire(os.homedir() + "/code/tizen/douyin-tizen/spike/desktop-harness/package.json");
const { chromium } = require("playwright-core");
const CHROME = os.homedir() + "/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 8132;
const KEY = { UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, ENTER: 13, RETURN: 10009 };

fs.mkdirSync(OUT, { recursive: true });
const dev = spawn("node", [path.join(ROOT, "tools/devserver.mjs"), "--no-auth"],
  { env: { ...process.env, DEV_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => dev.stdout.on("data", (d) => { if (String(d).includes("http://")) { resolve(); } }));

const browser = await chromium.launch({ executablePath: CHROME, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1600 / 1920 });
const t0 = Date.now();
const say = (m) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5), m);
page.on("pageerror", (e) => say("页面出错：" + e.message));
/* The app's own log lines, for when a step does not land. */
await page.route("**/__report", async (r) => {
  try {
    const b = JSON.parse(r.request().postData()), m = String((b.detail && b.detail.msg) || b.event + ": " + JSON.stringify(b.detail));
    if (/^(danmaku|player|playback|lifecycle):/.test(m) && !/传输/.test(m)) { say(m.slice(0, 200)); }
  } catch (e) {}
  r.fulfill({ status: 200, body: "ok" });
});
await page.route("**/js/config.js", (r) => r.fulfill({ contentType: "application/javascript", body:
  fs.readFileSync(path.join(ROOT, "app/js/config.js"), "utf8").replace(/var REPORT_TO = "[^"]*";/, `var REPORT_TO = "http://localhost:${PORT}/__report";`) }));

/* The remote's keys, as selftest.js sends them: keydown then keyup. */
const key = (code) => page.evaluate((c) => {
  ["keydown", "keyup"].forEach((t) => { const e = document.createEvent("Event"); e.initEvent(t, true, true); e.keyCode = c; document.dispatchEvent(e); });
}, code);
const waitFor = async (what, fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await page.evaluate(fn).catch(() => false)) { return; } await page.waitForTimeout(250); }
  throw new Error(what + "：" + ms / 1000 + " 秒没等到");
};
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + ".jpg"), type: "jpeg", quality: 88 }); say("→ " + name + ".jpg"); };
const openTab = (screen) => page.evaluate((s) => { Nav.focus(document.querySelector('.tab[data-screen="' + s + '"]')); }, screen).then(() => key(KEY.ENTER));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await waitFor("首页", () => document.querySelectorAll("#screen .card").length > 0, 20000);

  /* 美食, like the home shot. The first card that plays and keeps playing:
   * logged out, a video's web token is sometimes refused by the CDN and the
   * player gives up and returns to the grid. */
  await openTab("food");
  await waitFor("美食", () => document.querySelectorAll("#feed-grid .card").length > 0, 15000);
  const inPlayer = () => page.evaluate(() => { const s = document.getElementById("shell"); return !!s && s.offsetParent === null; });
  let playing = false;
  /* PICK=绵羊料理 puts the card whose text has it first: what scrolls across a
   * picture in a public README is whatever strangers typed, so the video is
   * worth choosing. */
  const order = await page.evaluate((pick) => {
    const cards = Array.prototype.slice.call(document.querySelectorAll("#feed-grid .card"));
    const idx = cards.map((c) => Number(c.getAttribute("data-i")));
    const first = pick ? cards.findIndex((c) => c.textContent.indexOf(pick) >= 0) : -1;
    return first >= 0 ? [idx[first]].concat(idx.filter((x, k) => k !== first)) : idx;
  }, process.env.PICK || "");
  for (let k = 0; k < 3 && !playing; k++) {
    const i = order[k];
    await page.evaluate((n) => { Nav.focus(document.querySelector('#feed-grid .card[data-i="' + n + '"]')); }, i);
    say("第 " + (i + 1) + " 张卡片：" + await page.evaluate((n) => (document.querySelector('#feed-grid .card[data-i="' + n + '"]') || {}).textContent || "", i).then((t) => t.slice(0, 30)));
    await key(KEY.ENTER);
    try {
      await waitFor("出画面", () => { const s = document.getElementById("shell"); return s && s.offsetParent === null && Player.hasPosition(); }, 30000);
      await waitFor("弹幕", () => document.querySelectorAll("#danmaku .dm").length >= 6, 30000);
      /* Long enough for the screen to fill, and to see it stays up. */
      await page.waitForTimeout(9000);
      playing = await inPlayer();
    } catch (e) { say(e.message); }
    if (!playing) {
      say("这个没放下去，换下一个");
      if (await inPlayer()) { await key(KEY.RETURN); await page.waitForTimeout(800); }
    }
  }
  if (!playing) { throw new Error("三个视频都没放下去"); }
  say("同屏弹幕 " + await page.evaluate(() => document.querySelectorAll("#danmaku .dm").length) + " 条");

  /* 04 first, while the video is playing clean: the scrub below ends in a
   * seek, and desktop Chrome's H.265 decoder has failed right after one
   * (10-18: the panel came out over a black frame and 「网络不顺」). Focus on
   * the danmaku row so it shows lit. */
  await key(KEY.DOWN);
  await waitFor("面板", () => { const p = document.getElementById("options"); return p && !p.classList.contains("hidden"); }, 5000);
  await page.waitForTimeout(800);
  await page.evaluate(() => { const c = document.querySelector("#opt-danmaku .opt.current") || document.querySelector("#opt-danmaku .opt"); if (c) { Nav.focus(c); } });
  await page.waitForTimeout(600);
  await shot("04-panel");
  await key(KEY.RETURN);
  await page.waitForTimeout(4000);

  /* Plain playback with danmaku, in case the scrub shot does not come out. */
  await shot("03-player-danmaku");

  /* 03: scrubbing, danmaku still running, the thumbnail in. Right and left in
   * turn every 350ms keep the scrub open (it commits 700ms after the last
   * press) without carrying it far; the shot is taken 250ms after a press, once
   * the thumbnail has been there for a second — waiting on the image itself
   * let the scrub commit first (10-18: a black box). */
  let had = 0;
  for (let i = 0; i < 40 && had < 3; i++) {
    await key(i % 2 ? KEY.LEFT : KEY.RIGHT);
    await page.waitForTimeout(350);
    const bg = await page.evaluate(() => { const t = document.getElementById("scrub-thumb"); return t ? getComputedStyle(t).backgroundImage : "none"; });
    had = /url\(/.test(bg) ? had + 1 : 0;
  }
  say(had >= 3 ? "缩略图到了" : "缩略图一直没到");
  await key(KEY.RIGHT);
  await page.waitForTimeout(250);
  await shot("03-player-scrub");

  /* Out of the player, onto 设置: the top of the page, and scrolled down to
   * 自动更新 — the page is taller than the screen now. */
  await page.waitForTimeout(1500);
  await key(KEY.RETURN);
  await waitFor("回到首页", () => { const s = document.getElementById("shell"); return s && s.offsetParent !== null; }, 5000);
  await openTab("settings");
  await waitFor("设置页", () => !!document.getElementById("btn-danmaku"), 5000);
  /* One shot from 播放 down to 自动更新: the page is taller than the screen
   * now. Scrolled so the 播放 heading sits under the tab bar. */
  await page.evaluate(() => {
    Nav.focus(document.getElementById("btn-danmaku"));
    const head = Array.prototype.filter.call(document.querySelectorAll("#screen .section"), (n) => n.textContent === "播放")[0];
    let box = head;
    while (box && box !== document.body && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) { box = box.parentNode; }
    if (head && box && box !== document.body) { box.scrollTop += head.getBoundingClientRect().top - 120; }
  });
  await page.waitForTimeout(600);
  await shot("06-settings");
} catch (e) {
  say("✗ " + e.message);
  await page.screenshot({ path: path.join(OUT, "readme-shots-failed.jpg"), type: "jpeg", quality: 80 });
  process.exitCode = 1;
} finally {
  await browser.close();
  dev.kill();
}
