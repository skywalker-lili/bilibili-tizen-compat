/* An on-device walkthrough of the whole flow.
 *
 * The television blocks both dlog and the web inspector, and the remote's
 * WebSocket needs someone standing in front of the set to approve it — so the
 * only way to exercise this build without a human is from inside it. Enabled by
 * SELFTEST in config.js, which tools/deploy.sh sets with --selftest.
 *
 * Every step dispatches the same key events the remote produces, so it walks the
 * real code path rather than calling internals directly.
 */
var SelfTest = (function () {
    "use strict";

    function post(line) {
        if (!REPORT_TO) { return; }
        try {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", REPORT_TO, true);
            xhr.setRequestHeader("Content-Type", "text/plain");
            xhr.send(JSON.stringify({ event: "log", detail: { msg: "SELFTEST " + line } }));
        } catch (e) {}
    }

    /* A press is a keydown and then a keyup, as on the remote. Since PR #2, OK on
     * a card acts on the keyup — holding it opens the action menu instead — so a
     * keydown alone was a key held forever: 650ms later the menu opened over the
     * grid, and every step after "按确认键开始播放" ran inside it (2026-10-18). */
    function key(code) {
        var types = ["keydown", "keyup"];
        for (var i = 0; i < types.length; i++) {
            var e = document.createEvent("Event");
            e.initEvent(types[i], true, true);
            e.keyCode = code;
            /* preventDefault is called by the handler; a synthetic Event tolerates it. */
            document.dispatchEvent(e);
        }
    }

    var KEY = { UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, ENTER: 13, RETURN: 10009 };

    function visible(id) {
        var n = document.getElementById(id);
        return !!(n && n.offsetParent !== null);
    }

    function count(sel) { return document.querySelectorAll(sel).length; }

    /* A set with nobody signed in opens the login page instead of the switcher,
     * and the removal walk has nothing to walk. Skipping is right; failing would
     * make the run red on a television that is behaving perfectly. */
    function onAccounts() { return count("#screen .acc") > 0; }

    /* Filled by the identity check, read by the step that waits for it. Empty
     * string means it answered and agreed; null means it never answered. */
    var identityVerdict = "凭证检查没有回应";

    /* What the PR #2 steps learn on the way: which lists were there to open,
     * which video has a subtitle track, what the server said. Steps run on
     * timers, so an asynchronous answer is parked here for the next step. */
    var probe = {};

    function rect(id) {
        var n = document.getElementById(id);
        var r = n && n.getBoundingClientRect();
        return r ? [r.left, r.top, r.width, r.height].map(Math.round).join(",") : "?";
    }

    /* Walk the feed one player/v2 at a time until a video has a subtitle track.
     * One at a time, not all at once: twelve parallel calls is the kind of burst
     * the API's IP gate answers with 412. */
    function findSubtitled(items, i, done) {
        if (i >= items.length) { done(null, i); return; }
        var v = items[i];
        if (!v || !v.cid) { findSubtitled(items, i + 1, done); return; }
        API.playerV2(v.bvid, v.cid, function (r) {
            if (r.subtitles && r.subtitles.length) { done({ v: v, idx: i, tracks: r.subtitles }, i + 1); }
            else { findSubtitled(items, i + 1, done); }
        }, function () { findSubtitled(items, i + 1, done); });
    }

    /* "3:30" or "1:06:40" back into seconds, for the position readouts. */
    function secs(text) {
        var parts = String(text || "").split(":");
        var out = 0;
        for (var i = 0; i < parts.length; i++) { out = out * 60 + Number(parts[i] || 0); }
        return isFinite(out) ? out : 0;
    }

    /* Steps run on a timer rather than promises: this is ES5 on an old engine,
     * and the whole point is to be sure about what the real build does. */
    /* The decisive one: hand the very url AVPlay refuses to a plain XHR. If the
     * fetch succeeds, the url is fine and the fault is in how AVPlay asks for
     * it; if the fetch fails too, the url itself is being refused. Guessing
     * between those two cost several deploys. */
    function probeStream() {
        var card = document.querySelector("#screen .card.focused") ||
                   document.querySelector("#screen .card");
        if (!card) { post("✗ 探测：网格里没有卡片"); return; }
        var idx = Number(card.getAttribute("data-i"));
        var v = (window.__stItems || [])[idx];
        if (!v || !v.bvid) { post("✗ 探测：拿不到 bvid"); return; }

        API.playurlProgressive(v.bvid, v.cid, Settings.qnCap(), function (r) {
            var host = String(r.url).split("/")[2];
            post("探测 qn=" + r.quality + " accept=" + (r.accept || []).join(",") +
                 " 镜像数=" + (r.urls || []).length + " 主机=" + host);
            var xhr = new XMLHttpRequest();
            xhr.open("GET", r.url, true);
            xhr.setRequestHeader("Range", "bytes=0-1023");
            xhr.timeout = 15000;
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) { return; }
                post("探测 XHR 同一地址 -> HTTP " + xhr.status +
                     (xhr.status === 206 || xhr.status === 200
                        ? "（地址没问题，问题在 AVPlay 的请求）"
                        : "（地址本身被拒）"));
            };
            xhr.ontimeout = function () { post("探测 XHR 超时"); };
            xhr.onerror = function () { post("探测 XHR 传输错误"); };
            xhr.send();
        }, function (why) { post("✗ 探测：playurl 失败 " + why); });
    }

    /* The zone tabs run through the same code as 排行 with a different
     * partition id, so what can actually break is an id — and an id that
     * answers with nothing looks exactly like a network hiccup from the sofa.
     * Asking the endpoints directly is steadier than walking the tab bar with
     * the remote and trusting focus to land where the press count says. */
    var zoneProbe = null;

    function probeZones() {
        zoneProbe = {};
        var want = [["美食", 1020], ["舞蹈", 1004]];
        for (var i = 0; i < want.length; i++) {
            (function (name, rid) {
                API.ranking(rid, function (items) {
                    zoneProbe[name] = items.length;
                }, function (why) { zoneProbe[name] = "失败 " + why; });
            })(want[i][0], want[i][1]);
        }
    }

    /* A partition that answers with an empty list is the failure worth catching
     * — bilibili renumbered these once already, and a renumbered id returns
     * code 0 with nothing in it rather than an error. */
    function zoneVerdict() {
        if (!zoneProbe) { return "分区探测没有跑"; }
        var bad = [], names = ["美食", "舞蹈"], line = [];
        for (var i = 0; i < names.length; i++) {
            var v = zoneProbe[names[i]];
            line.push(names[i] + "=" + (v === undefined ? "没回来" : v));
            if (typeof v !== "number" || v === 0) { bad.push(names[i]); }
        }
        post("分区 " + line.join(" "));
        return bad.length ? ("这些分区取不到内容：" + bad.join("、")) : null;
    }

    /* The end-of-video chooser, checked and then immediately disarmed.
     *
     * The countdown is eight seconds and the video reaches its end somewhere
     * between five and nine seconds after the seek, so any step that *waits* a
     * fixed time and then presses a key is racing it: the 19:09 run found the
     * counter at 1, autoplay fired inside the 900ms before the next step, and
     * four later steps went red about a screen the run had already left. So the
     * press that stops the countdown happens in the same step as the check that
     * finds the screen — nothing can expire in between. */
    function checkChooser() {
        var f = document.querySelector("#nextup .focusable.focused");
        if (!f || f.id !== "nextup-go") { return "焦点没有落在排队的那个视频上"; }
        var n = document.getElementById("nextup-count");
        if (Settings.get("autoplayNext", true) === true) {
            if (!n || !/^\d+$/.test(n.textContent)) { return "倒计时没有在走"; }
        } else {
            if (n) { return "自动播放已关闭，却仍有倒计时"; }
            if (document.getElementById("nextup-hint").textContent.indexOf("自动播放已关闭") < 0) {
                return "没有提示等待手动播放";
            }
        }
        var row = document.getElementById("nextup-more");
        var cards = count("#nextup-related .card");
        if (row && row.className.indexOf("hidden") >= 0) {
            post("即将播放：这个视频没有相关推荐，只有中间那一张");
            window.__stNoRelated = true;
            return null;
        }
        post("即将播放：相关推荐 " + cards + " 张，" + (n ? "倒计时 " + n.textContent : "等待手动选择"));
        if (!cards) { return "相关推荐那一行在，但一张卡都没有"; }
        key(KEY.DOWN);
        return null;
    }

    var steps = [
        ["首页加载出卡片", 3500, function () {
            return count("#screen .card") > 0 ? null : "网格里没有任何卡片";
        }],
        ["焦点落在第一张卡片", 300, function () {
            var f = document.querySelector("#screen .card.focused");
            return f ? null : "没有卡片处于选中状态";
        }],
        /* Absent is allowed — nothing half-watched is a real state. Present and
         * empty is not: that is the strip having been built from a list that
         * arrived wrong, which looks from the sofa like a heading with a hole
         * under it. */
        ["首页的继续观看那一行", 200, function () {
            var row = document.getElementById("resume-row");
            if (!row) { post("首页没有续播行（可能确实没有没看完的）"); return null; }
            var n = row.querySelectorAll(".card").length;
            post("续播行 " + n + " 张");
            return n ? null : "续播行在，但一张卡都没有";
        }],
        /* Off the resume strip and into the feed before anything is played. Two
         * reasons, both learned the hard way elsewhere in this file: the strip's
         * cards carry a `data-i` into a *different* array, so probeStream would
         * measure a video nobody is playing; and this run now watches its video
         * to the end, which would mark whatever the viewer was halfway through
         * as finished and take it out of 继续观看. A test that eats the viewer's
         * place in a series is worse than no test. */
        ["焦点从续播行移进推荐网格", 400, function () {
            var f = document.querySelector("#screen .card.focused");
            if (f && f.parentNode && f.parentNode.parentNode &&
                    f.parentNode.parentNode.id === "resume-row") {
                key(KEY.DOWN);
            }
            var now = document.querySelector("#screen .card.focused");
            return (now && now.parentNode && now.parentNode.id === "feed-grid")
                ? null : "焦点没有落在推荐网格的卡片上";
        }],
        ["探测流地址", 200, function () { probeStream(); probeZones(); return null; }],
        ["等待探测结果", 4000, function () { return null; }],
        ["分区都有内容", 100, zoneVerdict],
        ["按确认键开始播放", 200, function () { key(KEY.ENTER); return null; }],
        ["播放器接管画面", 6000, function () {
            if (visible("shell")) { return "浏览界面没有让位给播放器"; }
            if (visible("player-loading")) { return "六秒后仍停在加载画面"; }
            return null;
        }],
        ["进度在走", 4000, function () {
            var t = document.getElementById("player-pos").textContent;
            return (t && t !== "0:00") ? null : "进度停在 0:00";
        }],
        ["下键拉出面板", 1200, function () {
            key(KEY.DOWN);
            return null;
        }],
        ["面板可见且有内容", 900, function () {
            if (!visible("options")) { return "面板没有出现"; }
            if (!document.getElementById("panel-title").textContent) { return "面板标题为空"; }
            return null;
        }],
        /* 播放速度 goes through Shaka's trickPlay, not the element — written to
         * the element it reverts at the first stall. What is checked is the
         * player's own answer and the badge that tells the viewer. Put back to
         * 1x afterwards: it is sticky for the app run. */
        ["面板里选 1.5 倍速", 600, function () {
            var chip = document.querySelector('#opt-speed .opt[data-rate="1.5"]');
            if (!chip) { post("跳过：这条路没有 1.5 倍（AVPlay 只有整数倍）"); window.__stNoRate = true; return null; }
            Nav.focus(chip);
            key(KEY.ENTER);
            return null;
        }],
        ["倍速生效，角标写着 1.5x", 700, function () {
            if (window.__stNoRate) { return null; }
            var r = Player.rate();
            var badge = document.getElementById("player-quality").textContent;
            /* Back to 1x the way the viewer would, so the badge follows. */
            var one = document.querySelector('#opt-speed .opt[data-rate="1"]');
            if (one && one.onselect) { one.onselect(); } else { Player.setRate(1); }
            if (r !== 1.5) { return "选了 1.5 倍，播放器说是 " + r + " 倍"; }
            if (badge.indexOf("1.5x") < 0) { return "倍速变了但角标没写（" + badge + "）"; }
            return null;
        }],
        /* 右键必须走同一行。分P切片按自己的文字定宽，宽切片的右邻居中心能在
         * 五百像素外，而下一行只在九十像素下面 —— 纯中心距评分让「右」落进了
         * 下一行。多P稿件上焦点开在正在播的那一片，正是最宽的那种；单P稿件
         * 焦点开在相关推荐上，同样的断言照走。行尾没有右邻居就跳过，不算失败。 */
        ["面板里按右键走的是同一行", 600, function () {
            if (!visible("options")) { return "面板不见了"; }
            var cur = document.querySelector("#options .focused");
            if (!cur) { return "面板里没有焦点"; }
            var cr = cur.getBoundingClientRect();
            var all = document.querySelectorAll("#options .focusable");
            var want = null, wantX = Infinity;
            for (var i = 0; i < all.length; i++) {
                if (all[i] === cur || all[i].offsetParent === null) { continue; }
                var r = all[i].getBoundingClientRect();
                var cx = r.left + r.width / 2;
                var sameRow = r.top < cr.bottom - 6 && r.bottom > cr.top + 6;
                if (!sameRow || cx <= cr.left + cr.width / 2 + 4) { continue; }
                if (cx < wantX) { wantX = cx; want = all[i]; }
            }
            if (!want) { post("跳过：焦点右边同一行没有东西"); return null; }
            key(KEY.RIGHT);
            var now = document.querySelector("#options .focused");
            if (now === want) { return null; }
            if (now === cur) { return "按右键焦点没动"; }
            var nr = now ? now.getBoundingClientRect() : { top: -1 };
            return "按右键没走到同一行右邻居（from top=" + Math.round(cr.top) +
                   " to top=" + Math.round(nr.top) + "）";
        }],
        ["面板里能往下走", 600, function () {
            var before = document.getElementById("options").scrollTop;
            key(KEY.DOWN); key(KEY.DOWN); key(KEY.DOWN);
            window.__stScroll = before;
            return null;
        }],
        ["面板确实滚动了", 700, function () {
            var after = document.getElementById("options").scrollTop;
            return after > window.__stScroll ? null
                : "焦点下移但面板没滚动（before=" + window.__stScroll + " after=" + after + "）";
        }],
        /* The panel's related grid is paged rather than capped: two rows go up
         * with the panel (over a stream that is still buffering) and the rest
         * follows the ring down. What this catches is the grid quietly refusing
         * to grow — which looks exactly like a video that only had two rows of
         * related videos, and is why the total is asked for rather than guessed
         * at from the DOM. */
        ["第一张相关推荐的下键进入下一排", 700, function () {
            var first = document.querySelector("#opt-related .card");
            var total = typeof window.__stPanelTotal === "function"
                        ? window.__stPanelTotal() : 0;
            var m = /density-([45])/.exec(document.body.className);
            var columns = m ? Number(m[1]) : 3;
            if (!first || total <= columns) { return null; }
            Nav.focus(first);
            key(KEY.DOWN);
            var focused = Nav.current();
            return focused && Number(focused.getAttribute("data-i")) >= columns
                ? null : "从第一张推荐按下键，没有进入下一排";
        }],
        ["面板里的相关推荐能一直往下翻", 700, function () {
            if (!visible("options")) { return "面板不见了"; }
            var total = typeof window.__stPanelTotal === "function"
                        ? window.__stPanelTotal() : 0;
            var cards = count("#opt-related .card");
            post("面板：相关推荐一共 " + total + " 个，已经画出 " + cards + " 张");
            if (!total) { return "面板里一个相关推荐都没有"; }
            if (total <= 6) {
                window.__stPanelShort = true;   /* legitimately short list */
                return null;
            }
            key(KEY.DOWN); key(KEY.DOWN);
            return null;
        }],
        ["面板的推荐网格接着长出来了", 700, function () {
            if (window.__stPanelShort) { return null; }
            if (!visible("options")) { return "面板不见了"; }
            var cards = count("#opt-related .card");
            post("面板：往下走之后画出 " + cards + " 张");
            return cards > 6 ? null
                : "焦点走进相关推荐深处了，网格却没有接着长（还是 " + cards + " 张）";
        }],
        ["返回键收起面板", 700, function () {
            key(KEY.RETURN);
            return null;
        }],
        ["面板已收起，仍在播放", 700, function () {
            if (visible("options")) { return "面板没有收起"; }
            if (visible("shell")) { return "收面板把播放也退出了"; }
            return null;
        }],
        ["右键进入拖动", 800, function () {
            key(KEY.RIGHT); key(KEY.RIGHT);
            return null;
        }],
        /* The head commits 700ms after the last press and takes the preview
         * down with it, and every step here waits longer than that — so this
         * one presses for itself and checks in the same tick. `paintScrub` is
         * synchronous, so by the time the press returns the thumbnail is either
         * there or it never was. The sheets are a separate request, which is
         * what this catches: a preview box that appears and stays black. */
        ["拖动时有缩略图预览", 1200, function () {
            key(KEY.RIGHT);
            var box = document.getElementById("scrub-preview");
            if (!box || box.className.indexOf("hidden") >= 0) { return "拖动时没有出现预览框"; }
            var bg = document.getElementById("scrub-thumb").style.backgroundImage;
            if (!bg || bg === "none") { return "预览框出来了但没有取到缩略图"; }
            post("预览：" + bg.replace(/^url\(["']?|["']?\)$/g, "").split("/").pop());
            return null;
        }],
        ["拖动生效并落点", 2500, function () {
            var t = document.getElementById("player-pos").textContent;
            return (t && t !== "0:00") ? null : "拖动之后进度仍是 0:00";
        }],

        /* The one that needs the segment index. A short scrub lands inside what
         * is already buffered and proves nothing; this jumps clear of it, which
         * used to be refused outright on the DASH path and — when it was the
         * resume point rather than a keypress — made the player download the
         * whole file up to that second and throw all of it away. */
        ["跨出缓冲区的远距离拖动", 900, function () {
            var dur = secs(document.getElementById("player-dur").textContent);
            var now = secs(document.getElementById("player-pos").textContent);
            window.__stFar = false;
            /* 8 presses is 3:30 (210s) by the step ladder in app.js — well past
             * the 60 s the pump keeps ahead of the playhead.
             *
             * Direction depends on where resume left us. Every run of this test
             * leaves a resume point further into the same video, and once it
             * sat near the end the forward jump clamped onto the closing
             * seconds: the video finished mid-check, autoplay pulled in the
             * next one, and the readout — now the new video's 2s — failed a
             * step whose playback was perfectly healthy (19:40 run,
             * 2026-08-03). Backwards from there is just as far outside the
             * buffer: bufferBehind keeps 120s and this jumps 210. */
            var canForward = dur - now >= 300;
            /* 345, not 330: the jump is 210s and the landing check demands
             * strictly more than 120s, so 330 lands exactly on the boundary
             * and fails a healthy player. */
            var canBack = now >= 345;
            if (!canForward && !canBack) {
                post("拖动：位置 " + now + "s/" + dur + "s 两头都不够远，跳过远距离拖动");
                return null;
            }
            window.__stFar = true;
            for (var i = 0; i < 8; i++) { key(canForward ? KEY.RIGHT : KEY.LEFT); }
            return null;
        }],
        ["跳转落在远处", 9000, function () {
            if (!window.__stFar) { return null; }
            var t = secs(document.getElementById("player-pos").textContent);
            window.__stSeekTo = t;
            return t > 120 ? null : "远距离拖动之后位置只有 " + t + "s";
        }],
        /* Fifteen seconds, because a far seek is one of the places a web-token
         * 403 shows up, and the strong-token rescue behind it measured 13s on
         * 2026-08-15 (403 → app endpoint → self-read sidx for twelve tiers →
         * rebuild). At 7s this step checked in the same second playback resumed
         * and reported 「那里没有缓冲到」 — a confident, specific, wrong diagnosis
         * of a player that was fine, which is the failure mode this file is
         * least allowed to have. The message now says what it actually knows. */
        ["跨区之后确实播得下去", 15000, function () {
            if (!window.__stFar) { return null; }
            var t = secs(document.getElementById("player-pos").textContent);
            /* If the jump was refused or nothing buffered there, the readout
             * sits exactly where the scrub left it and never advances. */
            return t > window.__stSeekTo
                ? null
                : "跳到 " + window.__stSeekTo + "s 后十五秒内进度没前进（现在 " + t +
                  "s）——要么那里取不到字节，要么救援还没跑完，去日志看这段时间有没有 403/强令牌";
        }],
        ["确认键暂停", 600, function () {
            key(KEY.ENTER);
            return null;
        }],
        ["暂停图标出现", 600, function () {
            return visible("pause-glyph") ? null : "暂停后没有暂停图标";
        }],
        ["确认键继续", 400, function () { key(KEY.ENTER); return null; }],
        ["暂停图标消失", 600, function () {
            return visible("pause-glyph") ? "继续播放后暂停图标还在" : null;
        }],
        /* The branch the first field sample landed on (08-15, three hours
         * suspended): the set slept with a video playing, so the wake was
         * deferred rather than done. What is behind the player is then last
         * night's screen, and it has to be replaced on the way out — before the
         * fix, backing out handed it straight back. */
        ["播放中来了一次挂起恢复", 300, function () {
            if (typeof window.__stWake !== "function") { return "没有 __stWake 这个入口"; }
            window.__stPlayFeedBefore = window.__stItems;
            window.__stWake();
            if (visible("shell")) { return "唤醒把正在播放的视频掀掉了"; }
            return null;
        }],
        /* The end-of-video screen, which no key press can reach inside a run
         * this short — so the video is sent to four seconds from its end and the
         * real `ended` event does the rest. It shipped on 08-15 having never run
         * on the television once. */
        ["跳到片尾，让视频自己播完", 800, function () {
            if (typeof window.__stNearEnd !== "function") { return "没有 __stNearEnd 这个入口"; }
            return window.__stNearEnd() ? null : "拿不到时长，跳不过去";
        }],
        ["播完后出现「即将播放」界面", 6000, function () {
            if (!visible("nextup")) {
                window.__stNextLate = true;
                post("即将播放界面还没出现，再等一轮");
                return null;
            }
            return checkChooser();
        }],
        ["（慢的话再等一轮）", 3500, function () {
            if (!window.__stNextLate) { return null; }
            if (!visible("nextup")) { return "视频播完了但没有出现即将播放界面"; }
            return checkChooser();
        }],
        ["下键之后焦点在相关推荐里，倒计时停住", 600, function () {
            if (window.__stNoRelated) { post("跳过：这个视频没有相关推荐"); return null; }
            if (!visible("nextup")) {
                return "即将播放界面在按下键之后不见了——倒计时抢先开播了下一个";
            }
            if (!document.querySelector("#nextup-related .card.focused")) {
                return "按下键没有走进相关推荐那一行";
            }
            if (document.getElementById("nextup-count")) {
                return "走进相关推荐了，倒计时却还在跑——它会从观众手底下自己开播";
            }
            return null;
        }],
        /* The grid is meant to keep going: one row is painted while the
         * countdown runs (those thumbnails compete with the next video's start),
         * and the rest arrives as the focus walks into it. Both halves are
         * checked here — that more cards showed up than were first painted, and
         * that the screen actually followed the focus below the fold. The second
         * half is the one that fails silently: losing the `scroll` class on
         * #nextup leaves the ring moving onto cards nobody can see. */
        ["相关推荐能一直往下翻", 700, function () {
            if (window.__stNoRelated) { post("跳过：这个视频没有相关推荐"); return null; }
            if (!visible("nextup")) { return "即将播放界面不见了"; }
            var total = typeof window.__stNextupTotal === "function"
                        ? window.__stNextupTotal() : 0;
            var cards = count("#nextup-related .card");
            post("即将播放：相关推荐一共 " + total + " 个，已经画出 " + cards + " 张");
            if (total <= 3) {
                /* A short related list is a legitimate answer, not a failure —
                 * say which one it is rather than going red on the viewer's
                 * behalf. */
                window.__stNextupShort = true;
                return null;
            }
            if (cards <= 3) {
                return "走进相关推荐了，却还是只有第一行那三张——网格没有接着长";
            }
            window.__stNextupScroll = document.getElementById("nextup").scrollTop;
            key(KEY.DOWN);
            return null;
        }],
        ["翻到第二行，屏幕跟着滚下去了", 600, function () {
            if (window.__stNoRelated || window.__stNextupShort) { return null; }
            if (!visible("nextup")) { return "即将播放界面不见了"; }
            var f = document.querySelector("#nextup-related .card.focused");
            if (!f) { return "再按下键没有停在相关推荐里"; }
            if (Number(f.getAttribute("data-i")) < 3) {
                return "再按下键没有走到第二行";
            }
            var top = document.getElementById("nextup").scrollTop;
            post("即将播放：焦点第 " + f.getAttribute("data-i") + " 张，屏幕滚到 " + Math.round(top));
            if (!(top > window.__stNextupScroll)) {
                return "焦点走到第二行了，屏幕却没有跟着滚——卡片在看不见的地方";
            }
            return null;
        }],
        ["返回键从即将播放界面退出", 900, function () { key(KEY.RETURN); return null; }],
        ["即将播放界面收干净了", 700, function () {
            if (visible("nextup")) { return "即将播放界面没有收起来"; }
            /* If autoplay won the race anyway, the run is now inside the next
             * video and every later step would fail about a screen nobody is
             * on. One press back out, and say so — a cascade of red steps is a
             * worse report than one honest note. */
            if (!visible("shell")) {
                post("提示：倒计时抢先开播了下一个，按返回退出");
                key(KEY.RETURN);
            }
            return null;
        }],

        /* Six seconds, not three and a half: what this waits for is no longer a
         * cached grid being restored but a live feed request — payOwedWake
         * clears the cache and refetches, and the wake path is allowed one
         * silent three-second retry on top. At 3500ms a slow-but-healthy fetch
         * failed the step with 「重刷没补上」, which is a confident, specific and
         * wrong diagnosis — worse than no step at all. */
        ["回到首页网格", 6000, function () {
            if (!visible("shell")) { return "没有回到浏览界面"; }
            if (!count("#screen .card")) { return "回来后网格是空的"; }
            var f = document.querySelector("#screen .card.focused");
            if (!f) { return "回来后没有任何卡片被选中"; }
            /* Owed refresh paid: a new array rather than the cache restored. */
            if (window.__stItems === window.__stPlayFeedBefore) {
                return "挂起期间欠下的重刷没补上，回来的还是老那份首页";
            }
            if (f !== document.querySelector("#screen .card")) {
                return "补刷之后光标没有回到第一张卡片";
            }
            return null;
        }],

        /* The decisive one for multiple accounts, and it can only be answered
         * here — the question is what this firmware puts on the wire.
         *
         * This step existed before 2026-08-09 and did not catch the failure it
         * was written for. It asked whether the server recognised *somebody*,
         * and called that proof that a chosen account reaches it. Those are not
         * the same claim: the engine's jar is global and holds one account, so
         * with one account on the set it answers correctly no matter which route
         * carried the request. The Cookie header had in fact never arrived, and
         * this step said 认得 X every time.
         *
         * The claim is only worth anything against *which* account. So compare
         * the mid the server answers with against the mid the login handed us —
         * a disagreement means the request carried somebody else, which is the
         * whole bug, and it is a failure rather than a note. */
        ["送达服务器的是不是当前这个账号", 200, function () {
            var acc = (typeof Accounts !== "undefined") && Accounts.active();
            if (!acc) { post("账号：这台电视上没有登录账号，跳过"); return null; }

            var route = Auth.accessKey() ? "access_key"
                      : (Auth.jarIsOurs() ? "cookie jar" : "没有可用凭证");
            post("账号：共 " + Accounts.count() + " 个，当前 " + acc.id +
                 " mid=" + acc.mid + "，走 " + route);
            API.nav(function (me) {
                if (!me.isLogin) {
                    identityVerdict = "服务器不认这个会话（route=" + route + "）";
                } else if (acc.mid && me.mid && acc.mid !== me.mid) {
                    identityVerdict = "服务器认得的是 mid=" + me.mid + " " + me.uname +
                                      "，不是当前账号 mid=" + acc.mid +
                                      " —— 请求没带上被选中的那个账号";
                } else {
                    identityVerdict = "";
                    post("账号：服务器认得 " + me.uname + " mid=" + me.mid +
                         "，与当前账号一致（route=" + route + "）");
                }
            }, function (why) { identityVerdict = "nav 失败 " + why; });
            return null;
        }],
        /* The answer arrives asynchronously, and a step only counts as failed by
         * returning a reason — so the verdict is collected here rather than
         * posted from inside the callback, where the tally would never see it. */
        ["等待凭证检查", 3500, function () { return identityVerdict; }],

        /* The switcher is reachable only by remote, so walk to it the way a
         * viewer does: up out of the grid, then right past every tab. */
        ["上键离开网格进入顶栏", 500, function () {
            key(KEY.UP);
            return null;
        }],
        ["右键走到账号位", 600, function () {
            /* One press per tab plus slack. This said 8 when there were six
             * tabs; four zone tabs later it stopped short of the chip and the
             * account steps all failed for a reason that had nothing to do with
             * accounts. */
            for (var i = 0; i < 16; i++) { key(KEY.RIGHT); }
            var f = document.getElementById("account");
            return (f && f.className.indexOf("focused") >= 0)
                ? null : "右键走到头也没停在账号位上";
        }],
        ["确认键打开账号页", 1200, function () { key(KEY.ENTER); return null; }],
        ["账号页或登录页出现", 900, function () {
            var accounts = count("#screen .accounts");
            var login = count("#screen .login");
            if (!accounts && !login) { return "既没有账号页也没有登录页"; }
            if (login) { post("账号：一个账号都没有，开的是登录页"); return null; }
            if (!count("#screen .acc")) { return "账号页上一个头像都没有"; }
            if (count("#screen .acc.on") > 1) { return "同时有多个账号标着「当前」"; }
            /* 添加账号 is always the last tile; without it a second person can
             * never get onto the television. */
            var tiles = document.querySelectorAll("#screen .acc");
            var add = tiles[tiles.length - 1].getAttribute("data-id");
            if (add !== "__add") { return "没有「添加账号」入口"; }
            post("账号：账号页有 " + (tiles.length) + " 个格子");
            return null;
        }],
        ["焦点落在某个账号上", 400, function () {
            var f = document.querySelector("#screen .acc.focused");
            return f ? null : "账号页打开了但没有任何格子被选中";
        }],

        /* Removing an account was reachable, and had never once been walked —
         * the run stopped at "the tiles are here". On 2026-08-09 it was asked
         * for as a feature that did not exist, which is what an unwalked path
         * eventually becomes. The steps below go all the way to the confirmation
         * and then press 取消: the path gets exercised, nobody's account and
         * nobody's watch history gets destroyed by a test. */
        ["下键从头像走到删除账号按钮", 500, function () {
            if (!onAccounts()) { return null; }
            key(KEY.DOWN);
            return null;
        }],
        ["焦点停在删除账号上", 400, function () {
            if (!onAccounts()) { return null; }
            var f = document.querySelector("#screen .btn.focused");
            return (f && f.id === "btn-manage") ? null : "从头像按下键没走到删除账号按钮";
        }],
        ["确认键进入删除模式", 700, function () {
            if (!onAccounts()) { return null; }
            key(KEY.ENTER);
            return null;
        }],
        ["删除模式打开，焦点回到头像上", 600, function () {
            if (!onAccounts()) { return null; }
            if (!count("#screen .accounts.managing")) { return "按了删除账号却没进入删除模式"; }
            if (!document.querySelector("#screen .acc.focused")) {
                return "删除模式里没有任何头像被选中";
            }
            /* 访客 and 添加账号 have to be gone: pressing 确认 on either here
             * would do nothing, which is the shape of failure this app is worst
             * at showing. */
            var tiles = document.querySelectorAll("#screen .acc");
            var last = tiles[tiles.length - 1].getAttribute("data-id");
            if (last === "__add" || last === "__guest") { return "删除模式里还留着删不掉的格子"; }
            return null;
        }],
        ["确认键打开删除确认框", 700, function () {
            if (!onAccounts()) { return null; }
            key(KEY.ENTER);
            return null;
        }],
        ["确认框出现，焦点停在取消上", 600, function () {
            if (!onAccounts()) { return null; }
            if (!count("#screen .acc-confirm")) { return "选中账号后没有出现删除确认框"; }
            var f = document.querySelector("#screen .btn.focused");
            return (f && f.id === "btn-cancel") ? null : "删除确认框的焦点没有停在取消上";
        }],
        ["按取消，不真的删", 700, function () {
            if (!onAccounts()) { return null; }
            key(KEY.ENTER);
            return null;
        }],
        ["取消之后回到账号列表", 700, function () {
            if (!onAccounts()) { return null; }
            if (count("#screen .acc-confirm")) { return "取消之后确认框还在"; }
            if (!count("#screen .acc")) { return "取消之后账号列表没了"; }
            return null;
        }],

        ["返回键离开账号页", 1500, function () { key(KEY.RETURN); return null; }],
        ["回到浏览界面", 2500, function () {
            if (!visible("shell")) { return "没有回到浏览界面"; }
            if (count("#screen .accounts")) { return "账号页没有关掉"; }
            return null;
        }],

        /* Switching the set off and on again, which is the one journey no key
         * press can produce: Tizen suspends instead of killing, so it comes back
         * to the same JS context — and used to come back to last night's feed
         * with the cursor wherever it was left. `__stWake` is the only internal
         * this run calls directly, because the event that drives it belongs to
         * the platform. */
        ["模拟关机再开机", 400, function () {
            if (typeof window.__stWake !== "function") { return "没有 __stWake 这个入口"; }
            window.__stFeedBefore = window.__stItems;
            window.__stWake();
            return null;
        }],
        ["醒来后首页重刷，光标回到继续观看", 5000, function () {
            if (!visible("shell")) { return "醒来后没有停在浏览界面"; }
            if (!count("#screen .card")) { return "醒来后网格是空的"; }
            /* A new array means the feed was fetched again; repainting the cache
             * would hand back the very same one, and that is the whole point of
             * this step. */
            if (window.__stItems === window.__stFeedBefore) {
                return "首页没有重新取，还是醒来之前那一份";
            }
            var f = document.querySelector("#screen .card.focused");
            if (!f) { return "醒来后没有任何卡片被选中"; }
            if (f !== document.querySelector("#screen .card")) {
                return "光标没有回到第一张卡片";
            }
            var row = document.getElementById("resume-row");
            if (row && row.querySelectorAll(".card")[0] !== f) {
                return "有继续观看那一行，光标却不在它第一张上";
            }
            post(row ? "醒来：重取了首页，光标在继续观看第一张"
                     : "醒来：重取了首页，没有续播行，光标在推荐第一张");
            return null;
        }],

        /* The uploader page, reached the way a viewer reaches it: a video is
         * playing, 下键 pulls the panel, 上键 lands on the uploader chip, 确认
         * opens the page, 返回 comes back to the tab it was opened from. Last in
         * the run because it leaves the player. What this catches: the chip
         * missing or nameless (the mid never made it onto the card), the page
         * coming up empty (the app endpoint refused — the web one is gated by
         * IP and would fail this two times in three), the tab bar still
         * highlighting a tab on a screen that has none, and 返回 going to 推荐
         * by way of a reload instead of restoring where it came from. */
        ["再开一个视频，为了走到 UP 主页", 600, function () {
            if (!visible("shell")) { return "不在浏览界面"; }
            if (!document.querySelector("#screen .card.focused")) { return "没有选中的卡片"; }
            key(KEY.ENTER);
            return null;
        }],
        ["画面起来了", 8000, function () {
            if (visible("player-loading")) { return "八秒后仍停在加载画面"; }
            if (visible("shell")) { return "没有进入播放"; }
            return null;
        }],
        ["下键拉出面板", 1200, function () { key(KEY.DOWN); return null; }],
        ["面板顶上有 UP 主芯片", 900, function () {
            if (!visible("options")) { return "面板没有出现"; }
            var chip = document.getElementById("panel-up");
            if (!chip || chip.offsetParent === null) { return "面板里没有 UP 主芯片"; }
            if (!chip.textContent) { return "UP 主芯片上没有名字"; }
            post("UP 主芯片：" + chip.textContent);
            return null;
        }],
        /* At most four presses: the ring opens on the playing part or on the
         * first related card, and the chip is the only focusable above either.
         * One press too many closes the panel, which is why each press checks
         * first. */
        ["上键走到 UP 主芯片", 600, function () {
            for (var i = 0; i < 4; i++) {
                if (document.querySelector("#panel-up.focused")) { break; }
                key(KEY.UP);
            }
            if (!visible("options")) { return "上键把面板关了，没有停在芯片上"; }
            return document.querySelector("#panel-up.focused") ? null : "焦点没有走到 UP 主芯片";
        }],
        ["确认键进 UP 主页", 600, function () { key(KEY.ENTER); return null; }],
        ["UP 主页：有页眉、有卡片、页签不高亮", 5000, function () {
            if (!visible("shell")) { return "没有离开播放器回到浏览界面"; }
            var head = document.getElementById("up-head");
            if (!head) { return "屏幕上没有 UP 主页眉"; }
            var n = count("#feed-grid .card");
            post("UP 主页：" + head.textContent.trim().slice(0, 24) + "，" + n + " 张卡片");
            if (!n) { return "UP 主页没有卡片"; }
            if (document.querySelector("#tabs .tab.active")) { return "UP 主页上还有页签在高亮"; }
            if (!document.querySelector("#feed-grid .card.focused")) { return "光标没有落在 UP 主页的卡片上"; }
            return null;
        }],
        ["返回键回到来的地方", 600, function () { key(KEY.RETURN); return null; }],
        ["回到首页：页签重新高亮，页眉没了", 2500, function () {
            if (!visible("shell")) { return "返回之后不在浏览界面"; }
            if (document.getElementById("up-head")) { return "返回之后 UP 主页眉还在"; }
            if (!document.querySelector('#tabs .tab.active[data-screen="rcmd"]')) { return "返回之后推荐页签没有高亮"; }
            if (!count("#screen .card")) { return "返回之后网格是空的"; }
            if (!document.querySelector("#screen .card.focused")) { return "返回之后没有选中的卡片"; }
            return null;
        }],
        ["设置入口能用遥控器打开", 300, function () {
            Nav.focus(document.querySelector('#tabs .tab[data-screen="search"]'));
            key(KEY.RIGHT);
            var tab = document.querySelector('#tabs .tab.focused[data-screen="settings"]');
            if (!tab) { return "右键没有到设置页签"; }
            key(KEY.ENTER);
            return document.querySelector("#btn-autoplay.focused") ? null : "设置没有把焦点放在自动播放开关";
        }],
        ["自动播放开关可切换并保留", 300, function () {
            var before = Settings.get("autoplayNext", true) === true;
            key(KEY.ENTER);
            var changed = Settings.get("autoplayNext", true) === !before;
            var label = document.getElementById("btn-autoplay").textContent;
            Nav.focus(document.querySelector('#tabs .tab[data-screen="settings"]'));
            key(KEY.ENTER);
            var retained = Settings.get("autoplayNext", true) === !before;
            var shown = document.getElementById("btn-autoplay").textContent === label;
            key(KEY.ENTER); /* Restore the viewer's preference. */
            return changed && retained && shown && Settings.get("autoplayNext", true) === before
                ? null : "开关切换、重进设置或恢复原偏好失败";
        }],
        ["退出设置回到推荐", 300, function () {
            key(KEY.RETURN);
            return document.querySelector('#tabs .tab.active[data-screen="rcmd"]') ? null : "没有回到推荐";
        }],

        /* ---- PR #2's features (2026-10-18). Read-only: nothing here writes to
         * the account, and every setting touched is put back. ---- */
        ["每行视频 3→4→5 转一圈回到原值", 600, function () {
            Nav.focus(document.querySelector('#tabs .tab[data-screen="settings"]'));
            key(KEY.ENTER);
            var btn = document.getElementById("btn-density");
            if (!btn) { return "设置页里没有每行视频按钮"; }
            var start = Settings.get("gridColumns", 3), seen = [];
            for (var i = 0; i < 3; i++) {
                Nav.focus(btn);
                key(KEY.ENTER);
                var n = Settings.get("gridColumns", 3);
                var cls = Number((/density-([45])/.exec(document.body.className) || [0, 3])[1]);
                if (cls !== n) { return "设成 " + n + " 个，页面却是 " + cls + " 列"; }
                if (btn.textContent.indexOf(n + " 个") < 0) { return "按钮上没写当前值 " + n; }
                seen.push(n);
            }
            post("每行视频：" + start + " → " + seen.join(" → "));
            return Settings.get("gridColumns", 3) === start ? null : "转一圈没有回到原值";
        }],
        /* 2026-10-18: the quality cap and 清空观看记录. The clear button is only
         * armed, never fired — a selftest must not empty someone's history. */
        ["画质上限转一圈回到原值", 600, function () {
            var btn = document.getElementById("btn-quality");
            if (!btn) { return "设置页里没有画质按钮"; }
            var start = Settings.qnCap(), seen = [];
            for (var i = 0; i < Settings.qnSteps().length; i++) {
                Nav.focus(btn);
                key(KEY.ENTER);
                seen.push(Settings.qnCap());
                if (btn.textContent.indexOf("画质上限：") !== 0) { return "按钮上没写画质上限"; }
            }
            post("画质上限：" + start + " → " + seen.join(" → "));
            return Settings.qnCap() === start ? null : "转一圈没有回到原值";
        }],
        ["清空观看记录要按两下（只按一下，不真清）", 300, function () {
            var btn = document.getElementById("btn-clear-history");
            if (!btn) { return "设置页里没有清空观看记录按钮"; }
            var before = Resume.clearedAt();
            Nav.focus(btn);
            key(KEY.ENTER);
            if (Resume.clearedAt() !== before) { return "按一下就清了"; }
            return btn.textContent.indexOf("再按一次") === 0 ? null : "按一下之后没有提示再按一次";
        }],
        ["回到推荐", 300, function () {
            Nav.focus(document.querySelector('#tabs .tab[data-screen="rcmd"]'));
            key(KEY.ENTER);
            return null;
        }],
        ["首页按设置的列数排开", 4500, function () {
            var cards = document.querySelectorAll("#feed-grid .card");
            if (cards.length < 6) { return "首页卡片不够 6 张"; }
            var top = cards[0].getBoundingClientRect().top, row = 0;
            while (row < cards.length && Math.abs(cards[row].getBoundingClientRect().top - top) < 30) { row++; }
            var want = Settings.get("gridColumns", 3);
            var src = (cards[0].querySelector("img") || {}).src || "";
            post("首页第一行 " + row + " 张（设置 " + want + "），封面 " + (src.split("@")[1] || "?"));
            return row === want ? null : "第一行 " + row + " 张，设置是 " + want;
        }],

        ["进「我的」", 300, function () {
            Nav.focus(document.querySelector('#tabs .tab[data-screen="mine"]'));
            key(KEY.ENTER);
            return null;
        }],
        ["「我的」里有收藏和关注的入口", 4000, function () {
            if (!Auth.isLoggedIn()) { probe.skipMine = true; post("跳过收藏和关注：没有登录"); return null; }
            if (!document.getElementById("mine-favorites")) { return "没有「我的收藏」按钮"; }
            if (!document.getElementById("mine-following")) { return "没有「关注的 UP 主」按钮"; }
            return null;
        }],
        ["打开我的收藏", 300, function () {
            if (probe.skipMine) { return null; }
            Nav.focus(document.getElementById("mine-favorites"));
            key(KEY.ENTER);
            return null;
        }],
        ["收藏夹列表读出来了", 3500, function () {
            if (probe.skipMine) { return null; }
            var box = document.getElementById("mine-library");
            if (!box) { return "没有进到收藏夹页面"; }
            if (/读取失败/.test(box.textContent)) { return box.textContent.trim().slice(0, 60); }
            probe.folders = count("#mine-library .library-item");
            var first = document.querySelector("#mine-library .library-item strong");
            post("收藏夹 " + probe.folders + " 个" + (first ? "，第一个「" + first.textContent + "」" : ""));
            return (probe.folders || /还没有收藏夹/.test(box.textContent)) ? null : "既没有收藏夹也没说是空的";
        }],
        ["打开第一个收藏夹", 300, function () {
            if (probe.skipMine || !probe.folders) { return null; }
            Nav.focus(document.querySelector("#mine-library .library-item"));
            key(KEY.ENTER);
            return null;
        }],
        ["收藏夹里的视频读出来了", 4000, function () {
            if (probe.skipMine || !probe.folders) { return null; }
            var box = document.getElementById("mine-library");
            if (!box) { return "没有进到收藏夹里"; }
            if (/读取失败/.test(box.textContent)) { return box.textContent.trim().slice(0, 60); }
            var n = count("#mine-library .card");
            post("这个收藏夹里 " + n + " 个视频");
            return (n || /没有可播放的视频/.test(box.textContent)) ? null : "既没有视频也没说是空的";
        }],
        ["返回键退到收藏夹列表", 300, function () {
            if (probe.skipMine || !probe.folders) { return null; }
            key(KEY.RETURN);
            return null;
        }],
        ["返回键退回「我的」", 1500, function () {
            if (probe.skipMine) { return null; }
            key(KEY.RETURN);
            return null;
        }],
        ["打开关注的 UP 主", 2500, function () {
            if (probe.skipMine) { return null; }
            var b = document.getElementById("mine-following");
            if (!b) { return "返回之后没有回到「我的」"; }
            Nav.focus(b);
            key(KEY.ENTER);
            return null;
        }],
        ["关注列表读出来了", 4000, function () {
            if (probe.skipMine) { return null; }
            var box = document.getElementById("mine-library");
            if (!box) { return "没有进到关注页面"; }
            if (/读取失败|暂时无法读取/.test(box.textContent)) { return box.textContent.trim().slice(0, 60); }
            var n = count("#mine-library .library-item");
            post("关注的 UP 主 " + n + " 位");
            return (n || /还没有关注/.test(box.textContent)) ? null : "既没有 UP 主也没说是空的";
        }],
        ["退出「我的」回到推荐", 300, function () {
            if (!probe.skipMine) { key(KEY.RETURN); }
            Nav.focus(document.querySelector('#tabs .tab[data-screen="rcmd"]'));
            key(KEY.ENTER);
            return null;
        }],

        ["开一个视频看评论", 4000, function () {
            var card = document.querySelector("#feed-grid .card.focused") ||
                       document.querySelector("#feed-grid .card");
            if (!card) { return "推荐网格没有回来"; }
            Nav.focus(card);
            key(KEY.ENTER);
            return null;
        }],
        ["画面起来了（评论）", 8000, function () {
            if (visible("player-loading")) { return "八秒后仍停在加载画面"; }
            if (visible("shell")) { return "没有进入播放"; }
            key(KEY.DOWN);
            return null;
        }],
        ["面板里的「看评论」", 1200, function () {
            if (!visible("options")) { return "面板没有出现"; }
            var b = document.getElementById("panel-comments");
            if (!b || b.offsetParent === null) { return "面板里没有「看评论」"; }
            Nav.focus(b);
            key(KEY.ENTER);
            return null;
        }],
        ["评论侧栏打开，视频缩到左边接着播", 4000, function () {
            if (!visible("comments-view")) { return "评论侧栏没有出现"; }
            if (visible("options")) { return "面板没有收起"; }
            var n = count("#comments-list [data-comment-index]");
            post("评论 " + n + " 条，视频区域 " + rect("html5-video"));
            if (!n) {
                var empty = document.getElementById("comments-empty");
                return "没有评论：" + (empty ? empty.textContent : "列表是空的");
            }
            return null;
        }],
        ["右键看楼中楼", 300, function () {
            var rows = document.querySelectorAll("#comments-list [data-comment-index]");
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].querySelector(".comment-replies")) {
                    Nav.focus(rows[i]);
                    key(KEY.RIGHT);
                    probe.replies = true;
                    return null;
                }
            }
            post("前 " + rows.length + " 条评论都没有回复，跳过楼中楼");
            return null;
        }],
        ["楼中楼读出来了", 3500, function () {
            if (!probe.replies) { return null; }
            var t = document.getElementById("comments-title").textContent;
            if (t !== "楼中楼") { return "标题是「" + t + "」"; }
            var n = count("#comments-list [data-comment-index]");
            post("楼中楼 " + n + " 条");
            return n ? null : "楼中楼是空的";
        }],
        ["返回键回到评论", 300, function () {
            if (!probe.replies) { return null; }
            key(KEY.RETURN);
            return document.getElementById("comments-title").textContent === "评论" ? null : "没有回到评论";
        }],
        ["返回键关掉评论，视频回到全屏", 400, function () {
            key(KEY.RETURN);
            if (visible("comments-view")) { return "评论还开着"; }
            if (visible("shell")) { return "关评论把播放也退出了"; }
            var v = document.getElementById("html5-video");
            var w = v ? Math.round(v.getBoundingClientRect().width) : 0;
            return (!w || w === 1920) ? null : "视频没有回到全屏（宽 " + w + "）";
        }],
        ["退出播放", 500, function () { key(KEY.RETURN); return null; }],

        ["在推荐里找一个有字幕的视频", 2500, function () {
            var items = (window.__stItems || []).slice(0, 10);
            probe.subDone = false;
            findSubtitled(items, 0, function (found, scanned) {
                probe.sub = found; probe.subScanned = scanned; probe.subDone = true;
            });
            return null;
        }],
        ["下载字幕文件", 9000, function () {
            if (!probe.subDone) { return "player/v2 九秒内没问完"; }
            if (!probe.sub) { post("跳过字幕：推荐里前 " + probe.subScanned + " 个视频都没有字幕轨"); return null; }
            var t = probe.sub.tracks;
            post("字幕轨 " + t.map(function (x) { return x.lan_doc || x.lan; }).join(" / ") +
                 "（" + probe.sub.v.bvid + "，推荐第 " + (probe.sub.idx + 1) + " 个）");
            API.subtitle(t[0].subtitle_url, function (cues) { probe.cues = cues.length; },
                         function (why) { probe.cueErr = String(why); });
            return null;
        }],
        ["字幕文件解析出了字幕行", 3000, function () {
            if (!probe.sub) { return null; }
            if (probe.cueErr) { return "字幕文件取不到：" + probe.cueErr; }
            post("字幕 " + probe.cues + " 行");
            return probe.cues ? null : "字幕文件是空的";
        }],
        ["打开字幕开关，播这个视频", 300, function () {
            if (!probe.sub) { return null; }
            probe.subWas = Settings.get("showSubtitles", false);
            Settings.set("showSubtitles", true);
            var card = document.querySelector('#feed-grid .card[data-i="' + probe.sub.idx + '"]');
            if (!card) { Settings.set("showSubtitles", probe.subWas); return "网格里找不到这张卡片"; }
            Nav.focus(card);
            key(KEY.ENTER);
            /* A line only shows while a cue is running, so look the whole time
             * rather than at one instant that might fall between two. */
            probe.subSeen = "";
            probe.subTimer = setInterval(function () {
                var tx = document.getElementById("subtitle-text");
                if (!probe.subSeen && visible("subtitle-overlay") && tx && tx.textContent) {
                    probe.subSeen = tx.textContent;
                }
            }, 250);
            return null;
        }],
        ["画面上出现了字幕", 20000, function () {
            if (!probe.sub) { return null; }
            clearInterval(probe.subTimer);
            Settings.set("showSubtitles", probe.subWas);
            if (visible("shell")) { return "没有进入播放"; }
            if (!probe.subSeen) { return "播了 20 秒，画面上一行字幕都没出现"; }
            post("字幕：「" + probe.subSeen.slice(0, 30) + "」");
            return null;
        }],
        ["退出播放，字幕开关恢复原样", 600, function () {
            if (!probe.sub) { return null; }
            key(KEY.RETURN);
            return Settings.get("showSubtitles", false) === probe.subWas ? null : "字幕开关没有恢复";
        }]
    ];

    function run() {
        var i = 0, failures = 0;
        post("开始");
        function next() {
            if (i >= steps.length) {
                post(failures ? ("结束，" + failures + " 步失败") : "结束，全部通过");
                return;
            }
            var step = steps[i++];
            setTimeout(function () {
                var why;
                try { why = step[2](); }
                catch (e) { why = "抛出异常 " + e.message; }
                if (why) { failures++; post("✗ " + step[0] + " — " + why); }
                else { post("✓ " + step[0]); }
                next();
            }, step[1]);
        }
        next();
    }

    return { run: run };
})();
