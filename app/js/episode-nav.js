/* Adjacent parts and collection episodes. Shared by the player's shortcut
 * buttons; recommendations are intentionally excluded. ES5 for older Tizen. */
var EpisodeNav = (function () {
    "use strict";
    function adjacent(detail, cid, direction) {
        if (!detail || (direction !== -1 && direction !== 1)) { return null; }
        var pages = detail.pages || [], at = -1, i;
        for (i = 0; i < pages.length; i++) {
            if (Number(pages[i].cid) === Number(cid)) { at = i; break; }
        }
        if (at >= 0 && pages[at + direction]) {
            return { kind: "part", cid: pages[at + direction].cid, index: at + direction };
        }
        /* At the edge of a multi-part upload, continue through its collection. */
        if (at >= 0 && ((direction < 0 && at !== 0) || (direction > 0 && at !== pages.length - 1))) {
            return null;
        }
        var season = detail.season, episodes = season && season.episodes;
        if (!episodes) { return null; }
        var current = -1;
        for (i = 0; i < episodes.length; i++) {
            if (episodes[i].bvid === detail.bvid) { current = i; break; }
        }
        if (current < 0 || !episodes[current + direction]) { return null; }
        return { kind: "season", index: current + direction, cid: episodes[current + direction].cid };
    }
    return { adjacent: adjacent };
})();
