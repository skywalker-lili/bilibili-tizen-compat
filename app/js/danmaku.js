/* Small, read-only danmaku layer for the television's HTML plane. At most the
 * previous, current and next six-minute segments are retained in memory. */
var Danmaku = (function () {
    "use strict";

    var root = null, session = null, cache = {}, pending = null, requestId = 0;
    var active = [], laneAt = [], cursor = 0, cursorSegment = 0;
    var lastMs = 0, lastWallAt = 0, lastStart = -100000, rate = 1, paused = false;
    var loadAfter = 0, failure = "", failureIndex = 0;
    var SEGMENT_MS = 360000;

    function enabled() { return Settings.get("showDanmaku", false) === true; }
    function density() {
        var v = Settings.get("danmakuDensity", "low");
        return v === "medium" || v === "high" ? v : "low";
    }
    function area() {
        var v = Settings.get("danmakuArea", "safe");
        return v === "full" || v === "top" ? v : "safe";
    }
    function element() {
        if (!root) { root = document.getElementById("danmaku-overlay"); }
        return root;
    }
    function paintClass() {
        var node = element();
        node.className = enabled() && session ? "dm-" + area() +
            (paused ? " danmaku-paused" : "") : "hidden";
    }
    function clearActive() {
        var node = element();
        node.textContent = "";
        active = [];
        laneAt = [];
        lastStart = -100000;
        cursorSegment = 0;
    }
    function cancelPending() {
        requestId++;
        if (pending && pending.handle) { pending.handle.abort(); }
        pending = null;
    }
    function stop() {
        cancelPending();
        clearActive();
        cache = {};
        session = null;
        paused = false;
        lastMs = 0;
        lastWallAt = 0;
        loadAfter = 0;
        failure = "";
        failureIndex = 0;
        paintClass();
    }
    function start(cid, aid, position) {
        stop();
        if (!cid) { return; }
        session = { cid: cid, aid: aid || 0, ready: false };
        lastMs = Math.max(0, Number(position) || 0);
        paused = true;
        paintClass();
    }
    function lowerBound(rows, position) {
        var lo = 0, hi = rows.length;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (rows[mid].at < position) { lo = mid + 1; }
            else { hi = mid; }
        }
        return lo;
    }
    function discardFar(index) {
        if (pending && (pending.index < index - 1 || pending.index > index + 1)) {
            cancelPending();
        }
        for (var key in cache) {
            if (cache.hasOwnProperty(key) && Number(key) !== index - 1 &&
                    Number(key) !== index && Number(key) !== index + 1) {
                delete cache[key];
            }
        }
    }
    function load(index) {
        if (!session || cache[index] || (pending && pending.index === index)) { return; }
        cancelPending();
        var id = requestId, owner = session;
        pending = { index: index, handle: null };
        var handle = API.danmakuSegment(owner.cid, owner.aid, index,
            function (buffer) {
                if (id !== requestId || session !== owner) { return; }
                pending = null;
                try { cache[index] = DanmakuData.parse(buffer); failure = ""; }
                catch (e) { cache[index] = []; failure = "弹幕数据解析失败"; }
                failureIndex = failure ? index : 0;
                onTime(lastMs, false);
            }, function (why) {
                if (id !== requestId || session !== owner) { return; }
                pending = null;
                /* A refused or unavailable segment must never affect video. Do
                 * not retry every timeupdate on a 403 or a bad connection. */
                cache[index] = [];
                failure = String(why || "未知错误");
                failureIndex = index;
            });
        if (pending && pending.index === index) { pending.handle = handle; }
    }
    function remove(node) {
        if (node.parentNode) { node.parentNode.removeChild(node); }
        for (var i = 0; i < active.length; i++) {
            if (active[i] === node) { active.splice(i, 1); break; }
        }
    }
    function add(row, at) {
        var node = element(), d = density();
        var max = d === "high" ? 40 : d === "medium" ? 25 : 12;
        var gap = d === "high" ? 180 : d === "medium" ? 300 : 650;
        var laneGap = d === "high" ? 1300 : d === "medium" ? 2400 : 4000;
        if (active.length >= max || at - lastStart < gap) { return; }
        var lanes = Math.max(1, Math.floor(node.clientHeight / 50));
        var pick = -1;
        for (var i = 0; i < lanes; i++) {
            if (at - (laneAt[i] || -100000) >= laneGap) { pick = i; break; }
        }
        if (pick < 0) { return; }
        var text = document.createElement("div");
        text.className = "dm-item";
        text.textContent = row.text;
        text.style.top = (pick * 50 + 4) + "px";
        text.style.left = node.clientWidth + "px";
        node.appendChild(text);
        var travel = node.clientWidth + text.offsetWidth + 24;
        text.style.setProperty("--dm-travel", "-" + travel + "px");
        text.style.animationDuration = Math.max(5500, travel * 4) / rate + "ms";
        text.addEventListener("animationend", function () { remove(text); });
        active.push(text);
        laneAt[pick] = at;
        lastStart = at;
    }
    function onTime(position, canLoad) {
        if (!session || !session.ready || !enabled()) { return; }
        var now = Math.max(0, Number(position) || 0);
        var wallNow = new Date().getTime();
        var index = Math.floor(now / SEGMENT_MS) + 1;
        /* AVPlay may report the playhead only every few seconds. Compare that
         * advance with real elapsed time instead of mistaking every sparse
         * callback for a seek and dropping all intervening comments. */
        var elapsed = lastWallAt ? Math.max(0, wallNow - lastWallAt) * rate : 0;
        var jumped = now < lastMs - 500 ||
            now > lastMs + Math.max(2500, elapsed + 1500);
        lastMs = now;
        lastWallAt = wallNow;
        if (jumped) { loadAfter = wallNow + 3000; }
        if (jumped || (cursorSegment && cursorSegment !== index)) { clearActive(); }
        discardFar(index);
        if (!cache[index]) {
            if (canLoad && wallNow >= loadAfter) { load(index); }
            return;
        }
        var rows = cache[index];
        if (cursorSegment !== index) {
            cursorSegment = index;
            cursor = lowerBound(rows, Math.max(0, now - 200));
        }
        if (!paused) {
            while (cursor < rows.length && rows[cursor].at <= now + 100) {
                /* Use the comment's own timestamp for density control. A
                 * sparse time callback can contain several seconds of rows;
                 * assigning all of them `now` admitted only the first one. */
                add(rows[cursor], rows[cursor].at);
                cursor++;
            }
        }
        /* Current playback always has priority. Once its segment has loaded,
         * fill the two adjacent slots one at a time for small seeks. */
        if (canLoad && !pending) {
            if (index > 1 && !cache[index - 1]) { load(index - 1); }
            else if (!cache[index + 1]) { load(index + 1); }
        }
    }

    return {
        start: start,
        stop: stop,
        onTime: onTime,
        playing: function (playbackRate) {
            if (!session) { return; }
            if (!session.ready) { loadAfter = new Date().getTime() + 5000; }
            session.ready = true;
            rate = playbackRate || 1;
            paused = false;
            paintClass();
            onTime(lastMs, false);
        },
        pause: function (value) { paused = !!value; paintClass(); },
        setRate: function (value) {
            rate = value || 1;
            clearActive();
            if (session && session.ready) { onTime(lastMs, false); }
        },
        statusText: function () {
            if (!enabled()) { return "弹幕已关闭"; }
            if (!session) { return "开始播放后加载弹幕"; }
            var index = Math.floor(lastMs / SEGMENT_MS) + 1;
            if (pending && pending.index === index) { return "正在加载弹幕…"; }
            if (cache[index]) {
                if (failure && failureIndex === index) {
                    return "弹幕加载失败：" + failure;
                }
                return cache[index].length ?
                    "已读取本段 " + cache[index].length + " 条弹幕" :
                    "本段没有可显示的普通滚动弹幕";
            }
            return session.ready ? "播放稳定后即将加载弹幕…" : "等待视频开始播放…";
        },
        refresh: function () {
            clearActive();
            if (!enabled()) { cancelPending(); cache = {}; }
            else { loadAfter = new Date().getTime() + 3000; }
            paintClass();
            if (enabled() && session && session.ready) { onTime(lastMs, false); }
        },
        viewportChanged: function () {
            clearActive();
            if (session && session.ready && enabled()) { onTime(lastMs, false); }
        }
    };
})();
