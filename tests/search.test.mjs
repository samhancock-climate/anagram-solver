import assert from "node:assert/strict";
import * as s from "../public/search.js";
import * as c from "../public/core.js";

assert.deepEqual(s.groupsOf("Isle of Wight"), [4, 2, 5]);
assert.deepEqual(s.groupsOf("Hot-dog stand"), [3, 3, 5]);
assert.equal(s.enumOf("Hot-dog stand"), "3-3,5");
assert.equal(s.enumOf("ice cream"), "3,5");
assert.equal(s.enumOf("Ocean's Eleven"), "6,6");

const words = ["1tears","2stare","2aster","3tares","4serta","1ice","1cream","1mica","2acre","1a","1cat","1act","3tac","1ream","2care","1crime","1ace","1sea","1the"].join("\n");
const phrases = ["Ice cream","Marie Cecca"].join("\n");
const idx = s.buildIndex(words, phrases);

let r = s.solve(idx, { letters: "TEARS", groups: null, locks: [] });
assert.deepEqual(r.words.map(w => w.w), ["tears", "aster", "stare", "tares", "serta"]); // tier, then alphabetical
r = s.solve(idx, { letters: "TEARS", groups: [5], locks: [{ pos: 0, ch: "s" }] });
assert.deepEqual(r.words.map(w => w.w), ["stare", "serta"]);

r = s.solve(idx, { letters: "icecream", groups: [3, 5], locks: [] });
assert.deepEqual(r.phrases.map(p => p.text), ["Ice cream"]); // direct phrase lookup, exact lengths
assert.ok(r.combos.some(x => x.text === "ace crime"), JSON.stringify(r.combos)); // 3 + 5 letters
assert.ok(r.combos.every(x => x.text.split(" ")[0].length === 3));
r = s.solve(idx, { letters: "icecream", groups: [5, 3], locks: [] });
assert.deepEqual(r.phrases, []); // wrong lengths -> not a match
r = s.solve(idx, { letters: "icecream", groups: null, locks: [] });
assert.equal(r.phrases.length, 1); // no lengths -> any split
assert.deepEqual(r.combos, []);    // combos need lengths
r = s.solve(idx, { letters: "icecream", groups: [3, 5], locks: [{ pos: 3, ch: "c" }] });
assert.ok(r.combos.every(x => x.text.split(" ")[1][0] === "c"), JSON.stringify(r.combos));
// tier filter: "tac" is tier 3 -> hidden unless includeRare
r = s.solve(idx, { letters: "tacact", groups: [3, 3], locks: [] });
assert.ok(!r.combos.some(x => x.text.includes("tac")));
r = s.solve(idx, { letters: "tacact", groups: [3, 3], locks: [], includeRare: true });
assert.ok(r.combos.some(x => x.text.includes("tac")));

// fillAnswer
const e = c.makeEntry("TEARS");
assert.ok(c.fillAnswer(e, "stare"));
assert.equal(c.arrangement(e), "STARE");
e.locks[0] = true; // S locked
assert.ok(c.fillAnswer(e, "SATER") === true);
assert.equal(c.arrangement(e), "SATER");
assert.ok(!c.fillAnswer(e, "tears")); // locked S in the wrong place -> refuse
assert.equal(c.arrangement(e), "SATER"); // unchanged
assert.ok(!c.fillAnswer(e, "teary")); // letters we don't have
const dup = c.makeEntry("ICECREAM");
assert.ok(c.fillAnswer(dup, "ice cream"));
assert.equal(c.arrangement(dup), "ICECREAM");
console.log("search ok");
