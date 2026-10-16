/* Remote-control regressions: a hold opens the secondary menu, while D-pad
 * movement goes straight to the next card in a four-column grid. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(fileURLToPath(new URL("../app/js/nav.js", import.meta.url)), "utf8");
const events = {};
const windowEvents = {};
const timers = new Map();
let nextTimer = 1;
const body = { className: "", scrollHeight: 0, clientHeight: 0 };
const cards = [];
function card(index, x, y) {
  const node = {
    className: "card focusable", offsetParent: body, parentNode: body,
    scrollHeight: 0, clientHeight: 0,
    getBoundingClientRect: () => ({ left: x, top: y, right: x + 200,
      bottom: y + 120, width: 200, height: 120 }),
    getAttribute: (name) => name === "data-i" ? String(index) : null,
  };
  cards.push(node);
  return node;
}
const document = {
  body,
  getElementById: () => null,
  querySelectorAll: () => cards,
  querySelector: () => cards[0],
  addEventListener: (name, fn) => { events[name] = fn; },
};
const window = { addEventListener: (name, fn) => { windowEvents[name] = fn; } };
const sandbox = { document, window, Date, Math, Infinity,
  setTimeout: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
  clearTimeout: (id) => { timers.delete(id); } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "nav.js" });
const Nav = sandbox.Nav;
function press(type, keyCode) {
  assert.ok(events[type], `${type} listener missing`);
  events[type]({ keyCode, preventDefault() {} });
}

const first = card(0, 0, 0);
const secondRow = card(4, 0, 145);
let plays = 0, menus = 0;
first.onselect = () => { plays++; };
first.onlongselect = () => { menus++; };
Nav.focus(first);

press("keydown", 40);
assert.equal(Nav.current(), secondRow, "Down from first card must enter next row");
Nav.focus(first);
press("keydown", 13);
assert.equal(plays, 0, "keydown must not play before hold is resolved");
press("keyup", 13);
assert.equal(plays, 1, "short Enter plays exactly once");
assert.equal(menus, 0);

press("keydown", 13);
press("keydown", 13); // Samsung remote repeat must not start another action
assert.equal(timers.size, 1);
for (const callback of [...timers.values()]) { callback(); }
assert.equal(menus, 1, "long Enter opens the menu");
assert.equal(plays, 1, "long Enter must not start playback");
press("keyup", 13);
assert.equal(menus, 1, "keyup after hold must not open a second menu");

press("keydown", 13);
press("keydown", 40); // moving focus cancels a pending hold
for (const callback of [...timers.values()]) { callback(); }
press("keyup", 13);
assert.equal(Nav.current(), secondRow);
assert.equal(menus, 1);
assert.equal(plays, 1);
assert.ok(windowEvents.blur, "blur handler should cancel an in-flight hold");
console.log("✓ navigation: next row, short Enter, long Enter and repeat");
