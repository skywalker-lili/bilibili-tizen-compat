/* Self-update, checked off the device. Gates every package (tools/check.sh).
 *
 * Three parts, because the three fail differently:
 *   1. what boot.js declares — a malformed public key or a version out of step
 *      with config.xml fails silently on the sofa (no update ever verifies, or
 *      an old bundle outranks a newer package);
 *   2. update.js's own verification functions, run here under node's WebCrypto
 *      exactly as the television runs them, against a throwaway key: a good
 *      update passes, and every way of tampering is refused with its own reason;
 *   3. boot.js's launch decision, against a fake page: which code runs, and that
 *      a bundle which never reached the home screen is dropped next launch.
 *
 *   node tools/update-verify.mjs */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import vm from "vm";
import { ROOT, BOOT, buildBundle, configVersion, describePublic, readBoot, sign, KEY_FILE, loadPrivateKey } from "./update-lib.mjs";

let failed = 0;
const ok = (cond, what) => { if (cond) { console.log("  ✓ " + what); } else { failed++; console.log("  ✗ " + what); } };

const bootSrc = fs.readFileSync(BOOT, "utf8");
const updateSrc = fs.readFileSync(path.join(ROOT, "app/js/update.js"), "utf8");
const boot = readBoot(bootSrc);

/* ---------------- 1. declarations ---------------- */
console.log("boot.js 的声明");
const xmlVersion = configVersion(fs.readFileSync(path.join(ROOT, "app/config.xml"), "utf8"));
ok(boot.packagedFallback === xmlVersion, `PACKAGED_FALLBACK（${boot.packagedFallback}）= config.xml 的版本（${xmlVersion}）—— 改了 config.xml 的版本，boot.js 也要改`);
let pubOk = false;
try {
  const k = crypto.createPublicKey({ key: Buffer.from(boot.pubkey, "base64"), format: "der", type: "spki" });
  pubOk = k.asymmetricKeyType === "ec" && k.asymmetricKeyDetails.namedCurve === "prime256v1";
} catch (e) { pubOk = false; }
ok(pubOk, "PUBKEY 是 P-256 的 SPKI" + (pubOk ? "（指纹 " + describePublic(Buffer.from(boot.pubkey, "base64")).fp + "）" : ""));
ok(boot.scripts.every((f) => fs.existsSync(path.join(ROOT, "app/js", f))), "SCRIPTS 里的文件都在");
ok(!boot.scripts.includes("config.js") && !boot.scripts.includes("boot.js"), "SCRIPTS 不含 config.js、boot.js（这两个永远不随更新下发）");
if (fs.existsSync(KEY_FILE)) {
  let same = false;
  try { same = describePublic(crypto.createPublicKey(loadPrivateKey()).export({ type: "spki", format: "der" })).b64 === boot.pubkey; } catch (e) { same = false; }
  ok(same, "本机的私钥和 boot.js 的公钥是一对");
}

/* ---------------- 2. update.js verification ---------------- */
function storage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

function loadUpdate() {
  const ctx = { console, TextEncoder, TextDecoder, atob, btoa, Uint8Array, Promise, JSON, Math, Date, String, parseInt,
                localStorage: storage(), Settings: { get: (k, d) => d, set() {} } };
  ctx.window = ctx;
  ctx.crypto = crypto.webcrypto;
  vm.createContext(ctx);
  vm.runInContext(bootSrc + "\n" + updateSrc + "\nthis.Boot = Boot; this.Update = Update;", ctx);
  return ctx;
}

console.log("update.js 验证（一把临时钥匙）");
const U = loadUpdate();
const sub = crypto.webcrypto.subtle;
const test = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const other = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const testPub = test.publicKey.export({ type: "spki", format: "der" }).toString("base64");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const bundle = buildBundle({ version: "9.0.0", indexHtml: read("app/index.html"), bootSrc, readFile: read });
const bundleBytes = Buffer.from(JSON.stringify(bundle), "utf8");
const payload = JSON.stringify({ version: "9.0.0", shell: 1, sha256: crypto.createHash("sha256").update(bundleBytes).digest("hex"),
  size: bundleBytes.length, date: "2026-10-18T00:00:00Z", urls: ["https://example.invalid/bundle-9.0.0.json"] });
const manifestBytes = (pl, sig) => new Uint8Array(Buffer.from(JSON.stringify({ manifest: pl, sig }), "utf8"));
const T = U.Update._test;

const good = await T.readManifest(sub, testPub, manifestBytes(payload, sign(test.privateKey, payload)));
ok(good.manifest && good.manifest.version === "9.0.0", "签名对的 manifest 读得出来");
const gb = await T.readBundle(sub, good.manifest, new Uint8Array(bundleBytes));
ok(gb.bundle && gb.bundle.scripts.length === boot.scripts.length && typeof gb.bundle.files.body === "string",
   `bundle 对得上 sha256（${Math.round(bundleBytes.length / 1024)}KB，${gb.bundle ? gb.bundle.scripts.length : 0} 个脚本）`);

const tamperedBundle = Buffer.from(bundleBytes);
tamperedBundle[200] = tamperedBundle[200] === 0x41 ? 0x42 : 0x41;
const tb = await T.readBundle(sub, good.manifest, new Uint8Array(tamperedBundle));
ok(tb.why === "bundle sha256 不对", "改一个字节的 bundle → " + tb.why);
const sb = await T.readBundle(sub, good.manifest, new Uint8Array(bundleBytes.subarray(0, bundleBytes.length - 1)));
ok(/大小不对/.test(sb.why || ""), "短一个字节的 bundle → " + sb.why);

const forged = payload.replace('"9.0.0"', '"9.9.9"');
const tm = await T.readManifest(sub, testPub, manifestBytes(forged, sign(test.privateKey, payload)));
ok(tm.why === "manifest 签名不对", "签名后改过版本号的 manifest → " + tm.why);
const wk = await T.readManifest(sub, testPub, manifestBytes(payload, sign(other.privateKey, payload)));
ok(wk.why === "manifest 签名不对", "别的钥匙签的 manifest → " + wk.why);
const der = crypto.sign("sha256", Buffer.from(payload), test.privateKey).toString("base64");
const dr = await T.readManifest(sub, testPub, manifestBytes(payload, der));
ok(dr.why === "manifest 签名不对", "DER 格式的签名（node 的默认）→ " + dr.why + "（所以发布工具要 ieee-p1363）");
const junk = await T.readManifest(sub, testPub, new Uint8Array(Buffer.from("<html>404</html>")));
ok(junk.why === "manifest 格式不对", "不是 manifest 的东西 → " + junk.why);

const m = good.manifest;
const ctx = (o) => Object.assign({ running: "1.1.0", shell: 1, bad: {}, downloaded: "" }, o);
ok(T.judge(m, ctx()) === "", "比正在跑的新 → 下载");
ok(/^版本不更高/.test(T.judge(m, ctx({ running: "9.0.0" }))), "一样的版本 → " + T.judge(m, ctx({ running: "9.0.0" })));
ok(/^版本不更高/.test(T.judge(m, ctx({ running: "10.0" }))), "更旧的版本 → 不下");
ok(/要新的安装包/.test(T.judge(Object.assign({}, m, { shell: 2 }), ctx())), "shell 比这台的 boot.js 新 → " + T.judge(Object.assign({}, m, { shell: 2 }), ctx()));
ok(/启动失败过/.test(T.judge(m, ctx({ bad: { "9.0.0": 1 } }))), "这台电视上标坏过的版本 → " + T.judge(m, ctx({ bad: { "9.0.0": 1 } })));
ok(/已经下载好了/.test(T.judge(m, ctx({ downloaded: "9.0.0" }))), "已经下载过 → 不重下");

/* ---------------- 3. boot.js launch decisions ---------------- */
console.log("boot.js 启动时选哪份代码");
function launch(store) {
  const written = [], bodyKids = [{ nodeName: "DIV" }, { nodeName: "#text" }, { nodeName: "SCRIPT" }, { nodeName: "SCRIPT" }];
  let inserted = "", styles = 0, reloaded = false, blobs = 0;
  const links = [{ parentNode: { removeChild() { links.removed = (links.removed || 0) + 1; } } },
                 { parentNode: { removeChild() { links.removed = (links.removed || 0) + 1; } } }];
  const document = {
    write: (s) => written.push(s),
    body: { childNodes: bodyKids, removeChild: (n) => bodyKids.splice(bodyKids.indexOf(n), 1), insertAdjacentHTML: (w, h) => { inserted = h; } },
    head: { appendChild: (n) => { if (n.tag === "style") { styles++; } } },
    querySelectorAll: () => links,
    createElement: (t) => ({ tag: t }),
  };
  const c = { document, localStorage: store, JSON, parseInt, Math, Date, String,
    Blob: function () {}, URL: { createObjectURL: () => "blob:" + (++blobs) }, location: { reload: () => { reloaded = true; } } };
  vm.createContext(c);
  vm.runInContext(bootSrc + "\nthis.Boot = Boot;", c);
  return { Boot: c.Boot, written, inserted, styles, linksRemoved: links.removed || 0, reloaded, kids: bodyKids };
}
const bundleText = JSON.stringify(bundle);
const meta = (v, extra) => JSON.stringify(Object.assign({ version: v, shell: 1 }, extra));

let s = storage();
let r = launch(s);
ok(r.written.length === boot.scripts.length && r.written.every((w, i) => w.indexOf('src="js/' + boot.scripts[i] + '"') > 0),
   "没有下载过 → 写安装包的 " + boot.scripts.length + " 个脚本，按 SCRIPTS 的顺序");
ok(r.Boot.info().running === boot.packagedFallback, "running = 安装包版本");

s = storage({ "bili.update.meta": meta("9.0.0"), "bili.update.bundle": bundleText });
r = launch(s);
ok(r.written.length === bundle.scripts.length && r.written.every((w) => /src="blob:\d+"/.test(w)), "有更新的 9.0.0 → 脚本全从 bundle 来（blob:）");
ok(r.inserted === bundle.files.body && r.kids.every((k) => k.nodeName === "SCRIPT"), "body 的静态 DOM 换成 bundle 的，脚本标签留着");
ok(r.linksRemoved === 2 && r.styles === bundle.styles.length, "样式换成 bundle 的");
ok(s.getItem("bili.update.booting") === "9.0.0", "记下 booting=9.0.0，等首页起来");
ok(r.Boot.info().running === "9.0.0", "running = 9.0.0");

r = launch(s);   /* 上一次没调 Boot.ok() */
ok(r.written.every((w) => w.indexOf('src="js/') > 0), "上次用 9.0.0 没走到首页 → 这次用安装包");
ok(r.Boot.isBad("9.0.0") && !s.getItem("bili.update.bundle") && !s.getItem("bili.update.booting"), "9.0.0 标坏、更新包删掉");
ok(/没走到首页/.test(r.Boot.info().note), "说明写在 note 里：" + r.Boot.info().note);

s = storage({ "bili.update.meta": meta("9.0.0"), "bili.update.bundle": bundleText });
r = launch(s);
r.Boot.ok();
ok(!s.getItem("bili.update.booting"), "Boot.ok() 清掉 booting");
r = launch(s);
ok(r.Boot.info().running === "9.0.0", "清掉之后下一次照样用 9.0.0");

s = storage({ "bili.update.meta": meta("1.0.9"), "bili.update.bundle": JSON.stringify(Object.assign({}, bundle, { version: "1.0.9" })) });
r = launch(s);
ok(r.Boot.info().running === boot.packagedFallback && !s.getItem("bili.update.meta"), "下载的比安装包旧（手动装了新包）→ 删掉，用安装包：" + r.Boot.info().note);

s = storage({ "bili.update.meta": meta("9.0.0", { shell: 2 }), "bili.update.bundle": bundleText });
r = launch(s);
ok(r.Boot.info().running === boot.packagedFallback && !s.getItem("bili.update.meta"), "shell 比这个 boot.js 新 → 删掉：" + r.Boot.info().note);

s = storage({ "bili.update.meta": meta("9.0.0"), "bili.update.bundle": bundleText.slice(0, 1000) });
r = launch(s);
ok(r.Boot.info().running === boot.packagedFallback && !s.getItem("bili.update.meta"), "更新包存了一半 → 删掉：" + r.Boot.info().note);

s = storage({ "bili.update.meta": meta("9.0.0"), "bili.update.bundle": bundleText, "bili.update.bad": JSON.stringify({ "9.0.0": 1 }) });
r = launch(s);
ok(r.Boot.info().running === boot.packagedFallback, "标坏过的版本 → 用安装包");

console.log(failed ? `✗ ${failed} 处不对` : "✓ 自更新全部通过");
process.exit(failed ? 1 : 0);
