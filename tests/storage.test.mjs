// Saved data is untrusted: bad values must be dropped, never crash the app.
import assert from "node:assert/strict";
import * as c from "../public/core.js";

const good = c.makeEntry("TEARS");
good.boxes[0] = 2; good.locks[0] = true;
const clone = (o) => JSON.parse(JSON.stringify(o));

// a valid entry round-trips through JSON unchanged
assert.deepEqual(c.sanitizeEntry(clone(good)), good);
assert.deepEqual(c.sanitizeHistory(clone([good])), [good]);

// not-an-array / junk at the top level -> empty history, no throw
for (const junk of [null, undefined, 5, "x", {}, { length: 3 }, true]) assert.deepEqual(c.sanitizeHistory(junk), []);

// each kind of corruption is rejected
const bad = (mutate) => { const e = clone(good); mutate(e); return c.sanitizeEntry(e); };
assert.equal(bad((e) => { e.id = 5; }), null);
assert.equal(bad((e) => { e.id = ""; }), null);
assert.equal(bad((e) => { e.letters = "tears"; }), null);            // must be A-Z
assert.equal(bad((e) => { e.letters = "<script>"; }), null);
assert.equal(bad((e) => { e.letters = "A".repeat(c.MAX_LETTERS + 1); }), null);
assert.equal(bad((e) => { e.order = [0, 1, 2, 3]; }), null);          // wrong length
assert.equal(bad((e) => { e.order = [0, 0, 1, 2, 3]; }), null);       // not a permutation
assert.equal(bad((e) => { e.order = [0, 1, 2, 3, 9]; }), null);       // tile id out of range
assert.equal(bad((e) => { e.boxes = [2, 2, null, null, null]; }), null); // same tile twice
assert.equal(bad((e) => { e.boxes = ["a", null, null, null, null]; }), null);
assert.equal(bad((e) => { e.locks = [1, 0, 0, 0, 0]; }), null);
assert.equal(bad((e) => { e.locks[1] = true; }), null);              // locked but empty
assert.equal(c.sanitizeEntry(null), null);
assert.equal(c.sanitizeEntry("str"), null);
assert.equal(c.sanitizeEntry([]), null);

// optional fields are repaired rather than failing the entry
const odd = bad((e) => { e.enumStr = { not: "a string" }; e.updatedAt = "yesterday"; });
assert.equal(odd.enumStr, ""); assert.equal(odd.updatedAt, 0);
assert.equal(bad((e) => { e.enumStr = "9".repeat(500); }).enumStr.length, 60);

// bad entries are dropped but good ones kept; duplicates (same id) collapse; length is capped
const other = c.makeEntry("LISTEN");
const mixed = c.sanitizeHistory([clone(good), { garbage: true }, clone(other), clone(good), null]);
assert.deepEqual(mixed.map((e) => e.letters), ["TEARS", "LISTEN"]);
const many = Array.from({ length: 300 }, (_, i) => ({ ...clone(c.makeEntry("AB")), id: "id" + i }));
assert.equal(c.sanitizeHistory(many, 200).length, 200);

// MAX_LETTERS is what the UI enforces
assert.equal(c.MAX_LETTERS, 30);
console.log("storage ok");
