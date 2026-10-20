/* Exercise the fork's account-backed read/write routes without a TV or network.
 * The fake transport checks the requests that would leave the device, including
 * the no-credential case where a write must never be sent. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(fileURLToPath(new URL("../app/js/api.js", import.meta.url)), "utf8");
const calls = [];
const replies = [];
const session = { key: "tv-token", csrf: "csrf-token", jar: false };

class FakeXHR {
  constructor() { this.headers = {}; this.readyState = 0; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(body) {
    calls.push({ method: this.method, url: this.url, body, headers: this.headers });
    const reply = replies.shift();
    assert.ok(reply, `unexpected ${this.method} ${this.url}`);
    this.status = reply.status ?? 200;
    this.responseText = JSON.stringify(reply.body ?? { code: 0, data: {} });
    this.readyState = 4;
    this.onreadystatechange();
  }
}
const Auth = {
  isLoggedIn: () => !!(session.key || session.csrf),
  accessKey: () => session.key,
  csrf: () => session.csrf,
  jarIsOurs: () => session.jar,
  cookieHeader: () => "",
  signTv: (fields) => new URLSearchParams({ ...fields, appkey: "test", sign: "test" }).toString(),
};
const sandbox = { Auth, XMLHttpRequest: FakeXHR, URL, String, Number, Array,
  Object, JSON, Math, Date, RegExp, parseInt, parseFloat, isFinite,
  encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "api.js" });
const API = sandbox.API;

function respond(body, status = 200) { replies.push({ body, status }); }
function take() { const call = calls.shift(); assert.ok(call, "expected HTTP request"); return call; }
function result(run) {
  let got, failure;
  run((...args) => { got = args; }, (why) => { failure = why; });
  assert.equal(failure, undefined, `unexpected failure: ${failure}`);
  assert.ok(got, "success callback was not called");
  return got;
}
function failed(run, pattern) {
  let failure;
  run(() => assert.fail("unexpected success"), (why) => { failure = why; });
  assert.match(failure, pattern);
}
function url(call) { return new URL(call.url); }
function form(call) { return new URLSearchParams(call.body); }

// Read-side failures must not masquerade as an empty personal library.
respond({ code: -101, message: "not logged in" });
failed((ok, fail) => API.favoriteFolders(42, ok, fail), /code -101/);
assert.equal(url(take()).searchParams.get("access_key"), "tv-token");

respond({ code: 0, data: { list: [
  { id: 12, title: "Films", media_count: 3, fav_state: 1 },
  { id: 13, title: "Other", media_count: 0, fav_state: 0 },
] } });
const folders = result((ok, fail) => API.favoriteFolders(42, ok, fail, 99))[0];
assert.equal(folders.length, 2);
assert.equal(folders[0].selected, true);
assert.equal(folders[1].selected, false);
assert.equal(url(take()).searchParams.get("rid"), "99");

respond({ code: 0, data: { replies: [{ rpid: 1 }], page: { count: 41 } } });
let comments = result((ok, fail) => API.comments(99, 2, ok, fail));
assert.equal(comments[0][0].rpid, 1);
assert.equal(comments[1], true);
assert.equal(url(take()).searchParams.get("pn"), "2");
respond({ code: 0, data: { replies: [], page: { count: 20 } } });
comments = result((ok, fail) => API.commentReplies(99, 7, 1, ok, fail));
assert.equal(comments[1], false);
assert.equal(url(take()).searchParams.get("root"), "7");

respond({ code: 0, data: { medias: [
  { id: 99, type: 2, bvid: "BV1", title: "Video", cover: "http://i.example/a.jpg",
    duration: 60, pubtime: 1791849600, upper: { name: "Author", mid: 4 },
    cnt_info: { play: 12000 } },
  { id: 100, type: 12, bvid: "BV2" },
  { id: 101, type: 2, bvid: "BV3", attr: 1 },
], has_more: true } });
const favoritePage = result((ok, fail) => API.favoriteVideos(12, 1, ok, fail));
assert.equal(favoritePage[0].length, 1);
assert.equal(favoritePage[0][0].publishedAt, 1791849600);
assert.equal(favoritePage[1], true);
assert.equal(favoritePage[2], 3); // raw page size, used for pagination
take();

// No auth means no irreversible action leaves the TV.
session.key = ""; session.csrf = ""; session.jar = false;
assert.equal(API.videoActionReady(), false);
const before = calls.length;
failed((ok, fail) => API.videoLike(99, true, ok, fail), /登录凭证/);
failed((ok, fail) => API.videoCoin(99, 1, ok, fail), /登录凭证/);
failed((ok, fail) => API.videoFavorite(99, 12, true, ok, fail), /登录凭证/);
assert.equal(calls.length, before);

// A TV token takes the app routes. Coin does not opt into an automatic like.
session.key = "tv-token";
assert.equal(API.videoActionReady(), true);
respond({ code: 0, data: {} });
result((ok, fail) => API.videoLike(99, true, ok, fail));
let request = take();
assert.equal(url(request).pathname, "/x/v2/view/like");
assert.equal(form(request).get("like"), "0");
assert.equal(form(request).get("access_key"), "tv-token");
respond({ code: 0, data: {} });
result((ok, fail) => API.videoCoin(99, 2, ok, fail));
request = take();
assert.equal(url(request).pathname, "/x/v2/view/coin/add");
assert.equal(form(request).get("multiply"), "2");
assert.equal(form(request).get("select_like"), "0");
respond({ code: 0, data: {} });
/* The panel's 投币 likes too, as the web page's ticked-by-default box does. */
result((ok, fail) => API.videoCoin(99, 1, ok, fail, true));
request = take();
assert.equal(url(request).pathname, "/x/v2/view/coin/add");
assert.equal(form(request).get("multiply"), "1");
assert.equal(form(request).get("select_like"), "1");
respond({ code: 0, data: {} });
result((ok, fail) => API.videoFavorite(99, 12, false, ok, fail));
request = take();
assert.equal(url(request).pathname, "/medialist/gateway/coll/resource/deal");
assert.equal(form(request).get("del_media_ids"), "12");
assert.equal(form(request).get("add_media_ids"), "");

// An engine-jar session uses browser + CSRF routes instead of the TV token.
session.key = ""; session.csrf = "csrf-token"; session.jar = true;
respond({ code: 0, data: {} });
result((ok, fail) => API.videoLike(99, false, ok, fail));
request = take();
assert.equal(url(request).pathname, "/x/web-interface/archive/like");
assert.equal(form(request).get("like"), "2");
assert.equal(form(request).get("csrf"), "csrf-token");

// A stale state read can disagree with the server; the explicit duplicate
// response means the requested final state is already true.
session.key = "tv-token";
respond({ code: 65006, message: "already liked" });
result((ok, fail) => API.videoLike(99, true, ok, fail));
take();

// An account switch must not let a leftover browser CSRF write for another user.
session.key = ""; session.jar = false;
const after = calls.length;
failed((ok, fail) => API.videoFavorite(99, 12, false, ok, fail), /登录凭证/);
assert.equal(calls.length, after);
assert.equal(replies.length, 0);
console.log("✓ compat API: library, comments, auth boundaries and video writes");
