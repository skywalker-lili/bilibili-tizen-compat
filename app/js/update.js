/* Self-update: is there a newer version, fetch it, check it is ours, keep it for
 * the next launch. boot.js decides at launch whether to run what is kept here.
 *
 * Trust comes from one place: a manifest signed with the private key whose
 * public half is in boot.js (ECDSA P-256, SHA-256). The manifest names the
 * bundle's sha256 and size, so neither the manifest host nor the bundle host is
 * trusted — GitHub, jsDelivr, a hijacked DNS answer all look the same to this
 * file: bytes that either verify or are thrown away. A set whose engine has no
 * crypto.subtle cannot verify anything and so never updates.
 *
 * Applied at the next launch, never mid-run: replacing code under a playing
 * video or an open screen is a class of bug this app does not need. Checked a
 * minute after every launch (boot-time fetches lose races to the player —
 * measured here, see CLAUDE.md), never while something is playing; while the
 * app stays open, every six hours — sooner after a check that failed
 * (waitAfter) — and a minute after it comes back from the background if the
 * last check is over an hour old.
 *
 * This file is part of every bundle, so the checking logic itself can be fixed
 * by an update; boot.js and the key cannot. tools/update-verify.mjs runs the
 * verification functions below (Update._test) under node. */
var Update = (function () {
    "use strict";

    /* Our own domain first: on some networks raw.githubusercontent.com does
     * not resolve and jsDelivr comes and goes. It relays GitHub (see
     * server/diag-worker.mjs in bilibili-tizen) and needs no trust — the
     * manifest is signed and names the bundle's sha256. */
    var MANIFESTS = [
        "https://diag.titdev.nl/v1/update/bilibili-tizen/manifest.json",
        "https://raw.githubusercontent.com/titlog/bilibili-tizen/master/update/manifest.json",
        "https://cdn.jsdelivr.net/gh/titlog/bilibili-tizen@master/update/manifest.json"
    ];
    var FIRST_DELAY = 60000;
    var EVERY = 6 * 3600 * 1000;
    var BUSY_RETRY = 10 * 60000;
    var RETRY = 15 * 60000;              /* after a failed check; doubles per failure in a row */
    var WAKE_GAP = 3600 * 1000;          /* back from the background: check again if the last one is older */
    var TIMEOUT = 20000;
    var SETTING = "autoUpdate";          /* Settings key; on unless switched off */
    var K_LAST = "bili.update.last";     /* {at, result} of the last finished check */
    var K_SOURCE = "bili.update.source"; /* dev builds only, see manifestUrls() */

    var report = function () {};
    var busy = function () { return false; };
    var timer = 0;
    var checking = false;
    var lastError = "";

    function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function put(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
    function parse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
    function now() { return new Date().getTime(); }

    function enabled() {
        try { return Settings.get(SETTING, true) !== false; } catch (e) { return true; }
    }

    function subtle() {
        try { return (window.crypto && window.crypto.subtle) || null; } catch (e) { return null; }
    }

    /* ---- verification: pure, so node can run exactly this ---- */

    function fromBase64(s) {
        var bin = atob(s), out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
        return out;
    }
    function hex(buf) {
        var b = new Uint8Array(buf), s = "";
        for (var i = 0; i < b.length; i++) { s += (b[i] < 16 ? "0" : "") + b[i].toString(16); }
        return s;
    }
    function utf8(bytes) { return new TextDecoder("utf-8").decode(bytes); }

    /* Resolves true or false; rejects only when the engine refuses the key. */
    function verifySignature(sub, pubB64, payload, sigB64) {
        return sub.importKey("spki", fromBase64(pubB64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
            .then(function (key) {
                var sig;
                try { sig = fromBase64(sigB64); } catch (e) { return false; }
                return sub.verify({ name: "ECDSA", hash: { name: "SHA-256" } }, key, sig,
                                  new TextEncoder().encode(payload));
            });
    }

    function sha256Hex(sub, bytes) {
        return sub.digest("SHA-256", bytes).then(hex);
    }

    /* Why this manifest is not to be downloaded, or "" when it is. Each reason
     * is its own sentence: "not newer" and "this set already failed on it" call
     * for opposite reactions, and a single "skipped" would hide which. */
    function judge(m, ctx) {
        if (!m || !m.version || !m.sha256 || !m.urls || !m.urls.length) { return "manifest 里缺字段（version / sha256 / urls）"; }
        if (Boot.cmp(m.version, ctx.running) <= 0) { return "版本不更高（线上 " + m.version + "，正在跑 " + ctx.running + "）"; }
        if ((m.shell || 1) > ctx.shell) { return "线上 " + m.version + " 要新的安装包（shell " + m.shell + "，这台 " + ctx.shell + "），得重装"; }
        if (ctx.bad[m.version]) { return m.version + " 在这台电视上启动失败过，不再下载"; }
        if (ctx.downloaded === m.version) { return m.version + " 已经下载好了，下次打开生效"; }
        return "";
    }

    /* manifest.json → {manifest: m} or {why}. `payload` is the exact string the
     * key signed; parsing comes after the signature, never before. */
    function readManifest(sub, pubB64, bytes) {
        var doc = parse(utf8(bytes));
        if (!doc || typeof doc.manifest !== "string" || typeof doc.sig !== "string") {
            return Promise.resolve({ why: "manifest 格式不对" });
        }
        return verifySignature(sub, pubB64, doc.manifest, doc.sig).then(function (ok) {
            if (!ok) { return { why: "manifest 签名不对" }; }
            var m = parse(doc.manifest);
            return m ? { manifest: m } : { why: "manifest 签过名但读不出来" };
        });
    }

    /* bundle bytes against the signed manifest → {bundle, text} or {why}. */
    function readBundle(sub, m, bytes) {
        if (m.size && bytes.byteLength !== m.size) {
            return Promise.resolve({ why: "bundle 大小不对（" + bytes.byteLength + "B，manifest 说 " + m.size + "B）" });
        }
        return sha256Hex(sub, bytes).then(function (h) {
            if (h !== m.sha256) { return { why: "bundle sha256 不对" }; }
            var text = utf8(bytes), b = parse(text);
            if (!b || b.version !== m.version || !b.files || !b.scripts) { return { why: "bundle 内容和 manifest 对不上" }; }
            return { bundle: b, text: text };
        });
    }

    /* ---- network ---- */

    function host(u) { var m = /^https?:\/\/([^\/]+)/.exec(u); return m ? m[1] : u; }

    function getBytes(url, onOk, onFail) {
        var xhr = new XMLHttpRequest();
        try { xhr.open("GET", url, true); } catch (e) { onFail("open 失败"); return; }
        xhr.responseType = "arraybuffer";
        xhr.timeout = TIMEOUT;
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300 && xhr.response) { onOk(new Uint8Array(xhr.response)); }
            else { onFail("HTTP " + xhr.status); }
        };
        xhr.onerror = function () { onFail("连不上（状态 0，TLS / DNS / 断网分不出来）"); };
        xhr.ontimeout = function () { onFail((TIMEOUT / 1000) + " 秒没回"); };
        try { xhr.send(); } catch (e) { onFail("send 抛异常"); }
    }

    /* First url that answers; the rest are tried only after a failure. */
    function getFirst(urls, onOk, onFail) {
        var i = 0, why = [];
        (function next() {
            if (i >= urls.length) { onFail(why.join("；")); return; }
            var u = urls[i++];
            getBytes(u, function (b) { onOk(b, u); }, function (w) { why.push(host(u) + " " + w); next(); });
        })();
    }

    /* A development build (deploy.sh wrote a report address into config.js) may
     * point at a manifest elsewhere, for testing on the set. A release package
     * has REPORT_TO empty and cannot be pointed anywhere but the repository. */
    function manifestUrls() {
        var dev = typeof REPORT_TO !== "undefined" && !!REPORT_TO;
        if (dev) {
            if (typeof UPDATE_MANIFEST !== "undefined" && UPDATE_MANIFEST) { return [UPDATE_MANIFEST]; }
            if (get(K_SOURCE)) { return [get(K_SOURCE)]; }
        }
        return MANIFESTS;
    }

    /* ---- state ---- */

    function stored() { return parse(get(Boot.keys.meta)); }
    function downloaded() {
        var m = stored(), running = Boot.info().running;
        return m && Boot.cmp(m.version, running) > 0 ? m.version : "";
    }

    /* The bundle first, the meta second: boot.js reads the meta first, so a meta
     * only ever exists for a bundle that was written in full. */
    function keep(m, text) {
        del(Boot.keys.meta);
        del(Boot.keys.bundle);
        if (!put(Boot.keys.bundle, text)) { del(Boot.keys.bundle); return false; }
        if (!put(Boot.keys.meta, JSON.stringify({ version: m.version, shell: m.shell || 1, sha256: m.sha256, size: m.size, at: now() }))) {
            del(Boot.keys.bundle);
            return false;
        }
        return true;
    }

    /* The record a finished check leaves: what it found, and how many checks
     * in a row have now failed. */
    function record(prev, result, isError, t) {
        var fails = isError ? (prev && prev.error ? (prev.fails || 1) + 1 : 1) : 0;
        return { at: t, result: result, error: !!isError, fails: fails };
    }

    /* How long until the next check is due, from the last one's record. One
     * that finished waits six hours; one that failed 15 minutes, doubling per
     * failure in a row, up to the same six. Every failure used to wait the full
     * six: a set switched on before its Wi-Fi is up fails the one-minute check
     * and then skips every launch for the rest of the evening — 2026-10-18 the
     * living-room set did exactly that after a 404 (the manifest was not pushed
     * yet), and the release an hour later reached it only by hand. Never more
     * than one interval out: a record from the future is a clock that moved
     * back, not a reason to wait longer. */
    function waitAfter(last, t) {
        if (!last || !last.at) { return 0; }
        var gap = last.error ? Math.min(EVERY, RETRY * Math.pow(2, Math.max(0, (last.fails || 1) - 1))) : EVERY;
        return Math.max(0, Math.min(gap, last.at + gap - t));
    }

    /* more.log goes to the log line only — which host answered is ours to
     * know, not something for 设置 to show. more.kind marks what 设置 words
     * differently ("reinstall": a newer version needs a new package). */
    function finish(result, isError, done, more) {
        more = more || {};
        checking = false;
        lastError = isError ? result : "";
        var rec = record(parse(get(K_LAST)), result, isError, now());
        if (more.kind) { rec.kind = more.kind; }
        put(K_LAST, JSON.stringify(rec));
        report("update", result + (more.log || "") + (isError && enabled()
            ? "；" + Math.round(waitAfter(rec, rec.at) / 60000) + " 分钟后再查（连着第 " + rec.fails + " 次没成）" : ""));
        if (done) { done(result); }
    }

    /* One check. `force` ignores the switch (the settings page's own button). */
    function check(force, done) {
        if (checking) { if (done) { done("正在查"); } return; }
        if (!force && !enabled()) { if (done) { done("自动更新关着"); } return; }
        var sub = subtle();
        if (!sub || typeof TextEncoder === "undefined" || typeof TextDecoder === "undefined") {
            finish("这台电视的引擎没有 crypto.subtle / TextEncoder，验不了签名，不更新", true, done);
            return;
        }
        if (!Boot.PUBKEY) { finish("boot.js 里没有公钥，不更新", true, done); return; }
        checking = true;
        var t0 = now();
        /* An exception inside a step would otherwise leave `checking` set and
         * every later check answering 「正在查」 for the rest of the run. */
        function safe(fn) {
            return function () {
                try { return fn.apply(null, arguments); }
                catch (e) { finish("检查时出错：" + (e && (e.message || e.name)), true, done); }
            };
        }
        getFirst(manifestUrls(), safe(function (bytes, murl) {
            readManifest(sub, Boot.PUBKEY, bytes).then(safe(function (r) {
                if (r.why) { finish(r.why + "（" + host(murl) + "）", true, done); return; }
                var m = r.manifest, info = Boot.info();
                var why = judge(m, { running: info.running, shell: Boot.SHELL, bad: parse(get(Boot.keys.bad)) || {}, downloaded: downloaded() });
                if (why) {
                    finish("不用下载：" + why, false, done,
                           { log: "（清单来自 " + host(murl) + "）", kind: (m.shell || 1) > Boot.SHELL ? "reinstall" : "" });
                    return;
                }
                getFirst(m.urls, safe(function (bb, burl) {
                    readBundle(sub, m, bb).then(safe(function (rb) {
                        if (rb.why) { finish(rb.why + "（" + host(burl) + "）", true, done); return; }
                        if (!keep(m, rb.text)) {
                            finish("存不下：localStorage 放不下 " + Math.round(rb.text.length / 1024) + "K 字的更新包，跳过", true, done);
                            return;
                        }
                        finish("已下载 " + m.version + "，下次打开生效", false, done,
                               { log: "（正在跑 " + info.running + "，" + Math.round(bb.byteLength / 1024) + "KB，清单来自 " +
                                      host(murl) + "，包来自 " + host(burl) + "，" + (now() - t0) + "ms）" });
                    }), function (e) { finish("算 sha256 出错：" + (e && (e.message || e.name)), true, done); });
                }), function (why2) { finish("取不到 bundle：" + why2, true, done); });
            }), function (e) { finish("验签名出错：" + (e && (e.message || e.name)), true, done); });
        }), function (why) { finish("取不到 manifest：" + why, true, done); });
    }

    /* ---- schedule ---- */

    function schedule(ms) {
        clearTimeout(timer);
        timer = setTimeout(tick, Math.max(1000, ms));
    }
    /* The next check follows from the last record — EVERY when it cannot be
     * read back, so a storage that refuses writes cannot spin this. */
    function rearm() { if (enabled()) { schedule(waitAfter(parse(get(K_LAST)), now()) || EVERY); } }
    /* The first check of a launch ignores the record. It used to wait out six
     * hours from the last check, across launches — and on 10-22, with fixes an
     * hour apart, a set that had checked at 19:37 said nothing on any launch
     * until 01:37, while the reply in the issue said 「用一会儿，下次打开就是新的」.
     * Its owner reinstalled every version by hand instead. One manifest per
     * launch costs a kilobyte. */
    var firstOfRun = true;

    function tick() {
        if (!enabled()) { return; }
        if (busy()) { schedule(BUSY_RETRY); return; }
        if (!firstOfRun) {
            var wait = waitAfter(parse(get(K_LAST)), now());
            if (wait > 0) { schedule(wait); return; }
        }
        firstOfRun = false;
        check(false, rearm);
    }

    return {
        /* From app.js's window.onload. opts.report(kind, text) is the app's log
         * line; opts.busy() is true while something is playing. Says how this
         * launch booted — boot.js itself has no way to report. */
        init: function (opts) {
            opts = opts || {};
            if (opts.report) { report = opts.report; }
            if (opts.busy) { busy = opts.busy; }
            var info = Boot.info(), sub = !!subtle();
            report("update", "这次跑的是" + (info.running === info.packaged ? "安装包 " + info.packaged : "更新 " + info.running + "（安装包 " + info.packaged + "）") +
                   (info.note ? "；" + info.note : "") + "；自动更新" + (enabled() ? "开" : "关") +
                   (sub ? "" : "，但引擎没有 crypto.subtle，不能更新"));
            if (enabled()) { schedule(opts.firstDelay || FIRST_DELAY); }
        },
        /* The settings page's 「现在检查」. The automatic one is re-timed from
         * its result too, so 「N 分钟后再查」 in the log stays true. */
        check: function (done) { check(true, function (r) { rearm(); if (done) { done(r); } }); },
        /* From app.js when the set comes back after a while: Tizen suspends
         * more often than it relaunches, so "every launch" alone would miss
         * a set that is never really closed. */
        wake: function () {
            if (!enabled() || checking) { return; }
            var last = parse(get(K_LAST));
            if (last && last.at && now() - last.at < WAKE_GAP) { return; }
            firstOfRun = true;
            schedule(FIRST_DELAY);
        },
        enabled: enabled,
        setEnabled: function (on) {
            try { Settings.set(SETTING, !!on); } catch (e) {}
            if (on) { schedule(FIRST_DELAY); } else { clearTimeout(timer); }
        },
        /* For the settings page. */
        status: function () {
            var info = Boot.info(), last = parse(get(K_LAST)) || {};
            return {
                packaged: info.packaged, running: info.running, downloaded: downloaded(),
                enabled: enabled(), supported: !!subtle(), checking: checking,
                lastCheck: last.at || 0, lastResult: last.result || "", lastError: lastError || (last.error ? last.result : ""),
                reinstall: !last.error && last.kind === "reinstall",
                note: info.note
            };
        },
        _test: { verifySignature: verifySignature, sha256Hex: sha256Hex, judge: judge, readManifest: readManifest, readBundle: readBundle,
                 record: record, waitAfter: waitAfter, RETRY: RETRY, EVERY: EVERY, WAKE_GAP: WAKE_GAP }
    };
})();
