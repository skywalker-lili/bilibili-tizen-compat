/* Chromium 69 accepts gap for grid but does not implement flex gap. Test the
 * actual geometry: CSS.supports('gap', '1px') also accepts grid-only engines.
 * This runs after body exists and before the client initializes. */
(function () {
    "use strict";
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;display:flex;" +
        "flex-direction:column;row-gap:1px;left:-9999px;top:-9999px;";
    var a = document.createElement("div");
    var b = document.createElement("div");
    a.style.cssText = b.style.cssText = "height:1px;min-height:1px;";
    probe.appendChild(a);
    probe.appendChild(b);
    document.body.appendChild(probe);
    var supported = probe.scrollHeight === 3;
    document.body.removeChild(probe);
    if (!supported) {
        document.documentElement.className += " legacy-flex-gap";
    }
})();
