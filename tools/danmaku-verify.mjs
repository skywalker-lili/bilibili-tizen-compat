/* Verify the binary boundary and the teardown paths that matter on a TV left
 * running for hours. This uses a tiny wire-format fixture, not a live account. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = (name) => fs.readFileSync(path.join(root, "app/js", name), "utf8");
const parser = vm.runInNewContext(src("danmaku-data.js") + "\nDanmakuData", {
  TextDecoder, Uint8Array, decodeURIComponent,
});

function vint(value) {
  const out = [];
  do {
    let b = value % 128;
    value = Math.floor(value / 128);
    if (value) { b |= 128; }
    out.push(b);
  } while (value);
  return Buffer.from(out);
}
function num(field, value) { return Buffer.concat([vint(field * 8), vint(value)]); }
function bytes(field, body) {
  return Buffer.concat([vint(field * 8 + 2), vint(body.length), body]);
}
function row(at, mode, text) {
  return bytes(1, Buffer.concat([
    num(2, at), num(3, mode), bytes(7, Buffer.from(text, "utf8")),
    num(29, 12345), // an unknown future field must be safely skipped
  ]));
}
function packet() {
  const b = Buffer.concat([row(1500, 1, "第二条"), row(1000, 1, "你好"),
    row(1200, 7, "unsupported advanced")]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const rows = parser.parse(packet());
assert.equal(rows.length, 2);
assert.equal(rows[0].at, 1000);
assert.equal(rows[0].text, "你好");
assert.equal(rows[1].text, "第二条");
assert.throws(() => parser.parse(new Uint8Array([10, 10, 1]).buffer));
assert.throws(() => parser.parse(new ArrayBuffer(1024 * 1024 + 1)));

class Node {
  constructor() {
    this.style = { setProperty() {} };
    this.children = [];
    this.parentNode = null;
    this.clientWidth = 1920;
    this.clientHeight = 1080;
    this.offsetWidth = 150;
    this.className = "";
    this._text = "";
  }
  set textContent(value) {
    this._text = value;
    if (!value) {
      for (const child of this.children) { child.parentNode = null; }
      this.children = [];
    }
  }
  get textContent() { return this._text; }
  appendChild(child) { child.parentNode = this; this.children.push(child); }
  removeChild(child) {
    this.children = this.children.filter((n) => n !== child);
    child.parentNode = null;
  }
  addEventListener() {}
}
const overlay = new Node();
let clock = 100000;
function FakeDate() { this.getTime = () => clock; }
const settings = { showDanmaku: false, danmakuDensity: "low", danmakuArea: "safe" };
const calls = [];
const context = {
  Date: FakeDate,
  DanmakuData: parser,
  Settings: { get: (key, fallback) => settings[key] ?? fallback },
  document: {
    getElementById: (id) => id === "danmaku-overlay" ? overlay : null,
    createElement: () => new Node(),
  },
  API: { danmakuSegment: (cid, aid, index, ok, fail) => {
    const call = { cid, aid, index, ok, fail, aborted: false };
    calls.push(call);
    return { abort: () => { call.aborted = true; } };
  } },
};
const danmaku = vm.runInNewContext(src("danmaku.js") + "\nDanmaku", context);
danmaku.start(123, 456, 1000);
danmaku.playing(1);
danmaku.onTime(1000, true);
assert.equal(calls.length, 0, "off means no network activity");
settings.showDanmaku = true;
danmaku.refresh();
assert.match(danmaku.statusText(), /即将加载/);
clock += 4000;
danmaku.onTime(1000, true);
assert.equal(calls.length, 1, "first request waits until picture is established");
assert.match(danmaku.statusText(), /正在加载/);
assert.deepEqual([calls[0].cid, calls[0].aid, calls[0].index], [123, 456, 1]);
calls[0].ok(packet());
assert.match(danmaku.statusText(), /已读取本段 2 条/);
assert.equal(overlay.children.length, 1);
danmaku.pause(true);
assert.match(overlay.className, /danmaku-paused/);
settings.danmakuArea = "top";
danmaku.refresh();
assert.match(overlay.className, /dm-top/);
assert.equal(overlay.children.length, 0, "changing global area drops old animation");
danmaku.pause(false);
danmaku.onTime(1500, true);
assert.equal(overlay.children.length, 1);
const oldWidthNode = overlay.children[0];
overlay.clientWidth = 1216;
danmaku.viewportChanged();
assert.notEqual(overlay.children[0], oldWidthNode,
  "comment sidebar replaces the old full-width animation");
assert.equal(overlay.children[0].style.left, "1216px");
danmaku.onTime(370000, true); // seek into the next six-minute segment
clock += 4000;
danmaku.onTime(370000, true);
assert.equal(calls.length, 2);
danmaku.stop();
assert.equal(calls[1].aborted, true);
calls[1].ok(packet()); // a late network callback cannot resurrect old video
assert.equal(overlay.children.length, 0);
assert.equal(overlay.className, "hidden");
danmaku.start(123, 456, 1000);
danmaku.playing(1);
clock += 6000;
danmaku.onTime(1000, true);
assert.equal(calls.length, 3);
calls[2].fail("HTTP 403");
assert.match(danmaku.statusText(), /加载失败：HTTP 403/);
danmaku.stop();
settings.danmakuDensity = "high";
settings.danmakuArea = "full";
const dense = Buffer.concat(Array.from({ length: 80 }, (_, i) =>
  row(1000 + i * 250, 1, `弹幕 ${i + 1}`)));
const denseBuffer = dense.buffer.slice(dense.byteOffset, dense.byteOffset + dense.byteLength);
danmaku.start(123, 456, 0);
danmaku.playing(1);
clock += 6000;
danmaku.onTime(1000, true);
assert.equal(calls.length, 4);
calls[3].ok(denseBuffer);
clock += 5000; // a sparse but normal AVPlay clock update, not a seek
danmaku.onTime(6000, true);
assert.ok(overlay.children.length >= 12,
  "a sparse clock tick must render several dense comments, not only one");
clock += 16000;
danmaku.onTime(22000, true);
assert.ok(overlay.children.length <= 40,
  "high density still has a strict on-screen node limit");
danmaku.stop();
for (const [density, limit] of [["low", 12], ["medium", 25], ["high", 40]]) {
  settings.danmakuDensity = density;
  const busy = Buffer.concat(Array.from({ length: 240 }, (_, i) =>
    row(1000 + i * 50, 1, `弹幕 ${i + 1}`)));
  danmaku.start(123, 456, 0);
  danmaku.playing(1);
  clock += 6000;
  danmaku.onTime(1000, true);
  const request = calls[calls.length - 1];
  request.ok(busy.buffer.slice(busy.byteOffset, busy.byteOffset + busy.byteLength));
  clock += 9000;
  danmaku.onTime(10000, true);
  assert.equal(overlay.children.length, limit, `${density} keeps its display cap`);
  danmaku.stop();
}
settings.danmakuDensity = "low";
danmaku.start(123, 456, 370000);
danmaku.playing(1);
clock += 6000;
danmaku.onTime(370000, true);
const current = calls[calls.length - 1];
assert.equal(current.index, 2);
current.ok(packet());
danmaku.onTime(370000, true);
const previous = calls[calls.length - 1];
assert.equal(previous.index, 1, "preload previous segment after current");
previous.ok(packet());
danmaku.onTime(370000, true);
const next = calls[calls.length - 1];
assert.equal(next.index, 3, "preload next segment after previous");
next.ok(packet());
const loaded = calls.length;
danmaku.onTime(1000, true);
assert.equal(calls.length, loaded, "backward seek reuses the previous segment");
danmaku.onTime(370000, true);
assert.equal(calls.length, loaded + 1,
  "returning to the middle keeps it cached and refills the next slot");
assert.equal(calls[calls.length - 1].index, 3);
const farRequest = calls[calls.length - 1];
danmaku.onTime(3600000, true);
assert.equal(farRequest.aborted, true,
  "a seek outside the three-segment window aborts the old prefetch");
danmaku.start(999, 456, 1000);
assert.equal(overlay.children.length, 0, "new video clears previous comments");
danmaku.playing(1);
clock += 6000;
danmaku.onTime(1000, true);
assert.equal(calls[calls.length - 1].cid, 999,
  "new video cannot reuse the previous video's segments");
danmaku.stop();
console.log("✓ danmaku: bounded parser, delayed fetch, settings, seek and teardown");
