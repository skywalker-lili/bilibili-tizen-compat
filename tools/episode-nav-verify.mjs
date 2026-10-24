/* Manual shortcuts must stay within the uploader's ordered parts/collection.
 * No recommendation is a valid previous or next episode. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(fileURLToPath(new URL("../app/js/episode-nav.js", import.meta.url)), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const adjacent = context.EpisodeNav.adjacent;
const detail = {
  bvid: "BV2",
  pages: [{ cid: 21 }, { cid: 22 }, { cid: 23 }],
  season: { episodes: [{ bvid: "BV1", cid: 11 }, { bvid: "BV2", cid: 21 }, { bvid: "BV3", cid: 31 }] },
};
const result = (d, cid, direction) => {
  const value = adjacent(d, cid, direction);
  return value && JSON.parse(JSON.stringify(value));
};
assert.deepEqual(result(detail, 22, -1), { kind: "part", cid: 21, index: 0 });
assert.deepEqual(result(detail, 22, 1), { kind: "part", cid: 23, index: 2 });
assert.deepEqual(result(detail, 21, -1), { kind: "season", cid: 11, index: 0 });
assert.deepEqual(result(detail, 23, 1), { kind: "season", cid: 31, index: 2 });
assert.deepEqual(result({ bvid: "BV1", season: detail.season }, 11, 1),
  { kind: "season", cid: 21, index: 1 });
assert.equal(result({ pages: detail.pages }, 99, 1), null, "unknown part must not jump");
assert.equal(result({ bvid: "BV3", season: detail.season }, 31, 1), null, "last episode has no next");
assert.equal(result({ bvid: "BV1", season: detail.season }, 11, -1), null, "first episode has no previous");
assert.equal(result({ bvid: "BV2", related: [{ bvid: "BV9" }] }, 21, 1), null,
  "recommendations are not episodes");
console.log("  ✓ 分 P、合集、边界与无关联推荐");
