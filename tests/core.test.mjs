import assert from "node:assert/strict";
import * as c from "../public/core.js";

assert.equal(c.normalise("Tears, é!"), "TEARSE");
assert.deepEqual(c.extractEnum("ice cream (3,5)"), { seed: "ice cream", enumStr: "3,5" });
assert.deepEqual(c.extractEnum("tears"), { seed: "tears", enumStr: "" });
assert.deepEqual(c.parseEnum("", 8).groups, [8]);
assert.deepEqual(c.parseEnum("3,5", 8).groups, [3, 5]);
assert.deepEqual(c.parseEnum("(3 5)", 8).groups, [3, 5]);
assert.deepEqual(c.parseEnum("35", 8).groups, [3, 5]);
assert.deepEqual(c.parseEnum("15", 15).groups, [15]);
assert.deepEqual(c.parseEnum("4,5", 8), { groups: [8], seps: [], ok: false });
assert.deepEqual(c.parseEnum("x", 8), { groups: [8], seps: [], ok: false });
assert.deepEqual([...c.breakBefore([3, 2, 3]).keys()], [3, 5]);
const h = c.parseEnum("3-3,5", 11);
assert.deepEqual(h.groups, [3, 3, 5]);
assert.deepEqual(h.seps, ["-", " "]);
assert.equal(c.formatEnum(h), "3-3,5");
assert.deepEqual(c.parseEnum("4, 4", 8).seps, [" "]);
assert.deepEqual(c.parseEnum("35", 8).seps, [" "]);
assert.deepEqual(c.extractEnum("x-ray (1-3)"), { seed: "x-ray", enumStr: "1-3" });
const hy = c.makeEntry("ABCDEFG", "3-4");
hy.boxes = hy.boxes.map((_, i) => i);
assert.equal(c.arrangement(hy), "ABC-DEFG");
// shuffleBoxes: permutes placed letters among unlocked boxes only
const sh = c.makeEntry("ABCDEF");
sh.boxes = [0, 1, 2, 3, 4, 5];
sh.locks[0] = true; sh.locks[5] = true;
for (let k = 0; k < 50; k++) {
  const before = sh.boxes.slice();
  assert.ok(c.shuffleBoxes(sh));
  assert.equal(sh.boxes[0], 0); assert.equal(sh.boxes[5], 5);
  assert.deepEqual([...sh.boxes].sort(), [0, 1, 2, 3, 4, 5]);
  assert.notDeepEqual(sh.boxes, before);
}
const em = c.makeEntry("ABCD");
assert.ok(c.shuffleBoxes(em)); // empty -> lays everything out
assert.ok(em.boxes.every((b) => b !== null));
const one = c.makeEntry("ABCD"); one.boxes[0] = 0;
assert.ok(!c.shuffleBoxes(one)); // single placed letter: nothing to shuffle

const e = c.makeEntry("TEARS", "");
assert.equal(e.order.length, 5);
assert.ok(c.tapWheelTile(e, 0));
assert.equal(e.boxes[0], 0);
assert.ok(c.tapWheelTile(e, 1));
assert.ok(c.placeTile(e, 1, 0)); // swap
assert.deepEqual(e.boxes.slice(0, 2), [1, 0]);
assert.ok(c.toggleLock(e, 0));
assert.ok(!c.placeTile(e, 4, 0)); // locked
assert.ok(!c.tapBox(e, 0));
c.clearUnlocked(e);
assert.deepEqual(e.boxes, [1, null, null, null, null]);
assert.equal(c.arrangement(e), "E····");
const e2 = c.makeEntry("AAA");
assert.equal(e2.order.length, 3); // no infinite loop on identical letters
console.log("core ok");
