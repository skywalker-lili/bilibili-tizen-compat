/* D-pad focus management.
 *
 * There is no pointer on a TV, so every interactive element is a member of a
 * focus group and the remote moves between them geometrically: the next focus
 * is whichever candidate lies in the pressed direction and is closest. That
 * behaves correctly for ragged grids without anyone declaring a grid width.
 */
var Nav = (function () {
    "use strict";

    var current = null;
    var handlers = {};
    var enterHold = null;
    var LONG_ENTER_MS = 650;

    var KEY = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
        ENTER: 13, RETURN: 10009, EXIT: 10182,
        PLAY_PAUSE: 10252, PLAY: 415, PAUSE: 19,
        FF: 417, REW: 412
    };

    function focusables() {
        var modal = document.getElementById("video-actions");
        var comments = document.getElementById("comments-view");
        var scope = modal && modal.offsetParent !== null ? modal :
                    (comments && comments.offsetParent !== null ? comments : document);
        var all = scope.querySelectorAll(".focusable");
        /* The browse screen behind the player keeps its boxes (visibility, not
         * display) — present, measurable, and not a place the remote can go. */
        var veiled = document.querySelector(".veiled");
        var out = [];
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.offsetParent !== null && !(veiled && veiled.contains(el))) { out.push(el); }
        }
        return out;
    }

    function centre(el) {
        var r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r };
    }

    function setFocus(el) {
        if (!el) { return; }
        if (enterHold && !enterHold.fired && enterHold.target !== el) {
            clearTimeout(enterHold.timer);
            enterHold = null;
        }
        if (current && current !== el) { current.className = current.className.replace(/\s*focused/g, ""); }
        current = el;
        if (el.className.indexOf("focused") < 0) { el.className += " focused"; }
        scrollIntoView(el);
        scrollSideways(el);
        if (handlers.focus) { handlers.focus(el); }
    }

    /* The TV browser's own scrollIntoView jumps; easing by hand keeps the
     * selected row roughly centred, which is what makes a grid feel right.
     *
     * The container is found by the "scroll" class, so any code that rewrites a
     * scroller's className must keep it — losing it does not fail loudly, it
     * just quietly stops the panel moving when focus reaches the bottom. As a
     * backstop, an element that actually overflows counts too. */
    function scrollIntoView(el) {
        var scroller = el;
        while (scroller && scroller !== document.body) {
            /* The word, not the substring: "hscroll" rows (sideways, inside the
             * panel) contain it, and stopping at one of those left the panel
             * itself never scrolling (2026-10-18). */
            var marked = scroller.className && (" " + scroller.className + " ").indexOf(" scroll ") >= 0;
            var overflows = scroller.scrollHeight > scroller.clientHeight + 4;
            if (marked || overflows) { break; }
            scroller = scroller.parentNode;
        }
        if (!scroller || scroller === document.body) { return; }
        var er = el.getBoundingClientRect();
        var sr = scroller.getBoundingClientRect();
        var target = er.top - sr.top + scroller.scrollTop - (sr.height / 2) + (er.height / 2);
        scroller.scrollTop = Math.max(0, target);
    }

    /* A row wider than its box — the top bar's tabs, once 直播 and the chosen
     * zones outgrew 1920 (2026-10-18). Marked "hscroll"; the focused item is
     * kept clear of either edge by a margin, so the next one along shows a
     * little and the row reads as continuing. Elements past the edge are still
     * laid out where they would be, so the geometric search above reaches them
     * as the next item to the right, and focusing one brings it in. */
    function scrollSideways(el) {
        var box = el.parentNode;
        if (!box || !box.className || box.className.indexOf("hscroll") < 0) { return; }
        var er = el.getBoundingClientRect(), br = box.getBoundingClientRect(), pad = 80;
        if (er.left < br.left + pad) { box.scrollLeft = Math.max(0, box.scrollLeft - (br.left + pad - er.left)); }
        else if (er.right > br.right - pad) { box.scrollLeft += er.right - (br.right - pad); }
    }

    function move(dx, dy) {
        if (!current) { setFocus(focusables()[0]); return; }
        var from = centre(current);
        var best = null, bestScore = Infinity;
        var lane = null, laneScore = Infinity;
        var list = focusables();

        for (var i = 0; i < list.length; i++) {
            if (list[i] === current) { continue; }
            var to = centre(list[i]);
            var ox = to.x - from.x, oy = to.y - from.y;

            /* Must actually lie in the pressed direction, with a little slack so
             * that near-aligned items still count. */
            if (dx > 0 && ox <= 4) { continue; }
            if (dx < 0 && ox >= -4) { continue; }
            if (dy > 0 && oy <= 4) { continue; }
            if (dy < 0 && oy >= -4) { continue; }

            /* Distance along the axis of travel dominates; drift across it is
             * penalised so the eye follows a straight line. */
            var along = Math.abs(dx ? ox : oy);
            var across = Math.abs(dx ? oy : ox);
            var score = along + across * 3;

            /* A candidate whose box overlaps the current one across the axis of
             * travel shares its row (or column), and the eye expects a sideways
             * press to stay in the row whenever the row has anywhere to go.
             * Centre-to-centre scoring alone cannot promise that once boxes get
             * wide: the panel's part chips size to their text (up to 560px), so
             * the neighbour's centre can sit five hundred pixels away while the
             * next row is only ninety below — "right" kept landing a row down.
             * Uniform grids never hit this (the card straight below is filtered
             * out by the direction test), which is why it survived everywhere
             * except the one ragged row. Cross-row hops still work: they fall
             * back to the plain score when the row has nothing in that
             * direction. */
            var sameLane = dx
                ? (to.r.top < from.r.bottom - 6 && to.r.bottom > from.r.top + 6)
                : (to.r.left < from.r.right - 6 && to.r.right > from.r.left + 6);
            if (sameLane && score < laneScore) { laneScore = score; lane = list[i]; }
            if (score < bestScore) { bestScore = score; best = list[i]; }
        }
        if (lane) { setFocus(lane); }
        else if (best) { setFocus(best); }
    }

    document.addEventListener("keydown", function (e) {
        var k = e.keyCode;
        if (enterHold && k !== KEY.ENTER) {
            clearTimeout(enterHold.timer);
            enterHold = null;
        }
        if (handlers.key && handlers.key(k) === true) { return; }

        /* Cards keep short Enter for playback. Only a card with onlongselect
         * defers that action until release, so a hold can open its menu without
         * first starting the video. Other buttons retain immediate Enter. */
        if (k === KEY.ENTER && enterHold) {
            e.preventDefault();
            return;                 /* auto-repeat must not activate the menu */
        }
        if (k === KEY.ENTER && current && current.onlongselect) {
            var hold = { target: current, started: new Date().getTime(), fired: false, timer: null };
            enterHold = hold;
            hold.timer = setTimeout(function () {
                if (enterHold !== hold || current !== hold.target) { return; }
                hold.fired = true;
                hold.target.onlongselect();
            }, LONG_ENTER_MS);
            e.preventDefault();
            return;
        }

        switch (k) {
            case KEY.LEFT:  move(-1, 0); break;
            case KEY.RIGHT: move(1, 0);  break;
            case KEY.UP:    move(0, -1); break;
            case KEY.DOWN:  move(0, 1);  break;
            case KEY.ENTER:
                if (current && current.onselect) { current.onselect(); }
                break;
            case KEY.RETURN:
                if (handlers.back) { handlers.back(); }
                break;
            case KEY.EXIT:
                try { tizen.application.getCurrentApplication().exit(); } catch (err) {}
                break;
            default: return;
        }
        e.preventDefault();
    });

    document.addEventListener("keyup", function (e) {
        if (e.keyCode !== KEY.ENTER || !enterHold) { return; }
        var hold = enterHold;
        enterHold = null;
        clearTimeout(hold.timer);
        e.preventDefault();
        if (hold.fired || current !== hold.target) { return; }
        if (new Date().getTime() - hold.started >= LONG_ENTER_MS) {
            hold.target.onlongselect();
        } else if (hold.target.onselect) {
            hold.target.onselect();
        }
    });

    window.addEventListener("blur", function () {
        if (enterHold) { clearTimeout(enterHold.timer); enterHold = null; }
    });

    return {
        KEY: KEY,
        focus: setFocus,
        current: function () { return current; },
        /* Called after a screen swaps its DOM, to land focus somewhere sane. */
        reset: function (selector) {
            var el = selector ? document.querySelector(selector) : focusables()[0];
            /* setFocus strips the ring off whatever held it. Nulling `current`
             * first skipped that, and the tab bar is never re-rendered, so a
             * tab kept its ring while a card gained one. */
            setFocus(el || focusables()[0]);
        },
        /* Brings an element of an hscroll row into view without focusing it —
         * the highlighted tab, when focus is down in the grid. */
        reveal: function (el) { if (el) { scrollSideways(el); } },
        onBack: function (fn) { handlers.back = fn; },
        onFocus: function (fn) { handlers.focus = fn; },
        onKey: function (fn) { handlers.key = fn; },
        registerKeys: function () {
            try {
                var want = ["MediaPlayPause", "MediaPlay", "MediaPause",
                            "MediaFastForward", "MediaRewind"];
                for (var i = 0; i < want.length; i++) {
                    try { tizen.tvinputdevice.registerKey(want[i]); } catch (e) {}
                }
            } catch (e) {}
        }
    };
})();
