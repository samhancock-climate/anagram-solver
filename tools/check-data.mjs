// Sanity checks for public/data after a rebuild. Exits non-zero (and says why) if anything looks wrong.
// Usage: node tools/check-data.mjs [data-dir]
import fs from "node:fs";
import { buildIndex, solve } from "../public/search.js";

const dir = process.argv[2] || new URL("../public/data/", import.meta.url).pathname;
const words = fs.readFileSync(`${dir}/words.txt`, "utf8");
const phrases = fs.readFileSync(`${dir}/phrases.txt`, "utf8");
const problems = [];
const expect = (ok, msg) => { if (!ok) problems.push(msg); };

const nWords = words.split("\n").filter(Boolean).length;
const nPhrases = phrases.split("\n").filter(Boolean).length;
expect(nWords > 100_000 && nWords < 250_000, `word count ${nWords} outside 100k-250k`);
expect(nPhrases > 150_000 && nPhrases < 450_000, `phrase count ${nPhrases} outside 150k-450k`);
expect(words.length < 2.5e6, `words.txt is ${words.length} bytes (limit 2.5 MB)`);
expect(phrases.length < 6e6, `phrases.txt is ${phrases.length} bytes (limit 6 MB)`);
expect(words.split("\n").filter(Boolean).every((l) => /^[1-4][a-z]+$/.test(l)), "words.txt has a malformed line");
expect(phrases.split("\n").filter(Boolean).every((l) => /^[A-Za-z][A-Za-z '\-.,&!]*$/.test(l)), "phrases.txt has a malformed line");

// Known answers must still be found (a broken download or filter usually loses these first).
const idx = buildIndex(words, phrases);
const L = (s) => s.replace(/[^a-z]/gi, "");
const phraseCases = [["Ice cream", [3, 5]], ["Marilyn Monroe", [7, 6]], ["Isle of Wight", [4, 2, 5]], ["New York City", [3, 4, 4]], ["hot dog stand", [3, 3, 5]]];
for (const [p, groups] of phraseCases) {
  const r = solve(idx, { letters: L(p), groups, locks: [] });
  expect(r.phrases.some((x) => x.text.toLowerCase() === p.toLowerCase()), `phrase not found: ${p}`);
}
for (const w of ["dormitory", "listen", "silent", "tears", "stare"]) {
  const r = solve(idx, { letters: w, groups: null, locks: [] });
  expect(r.words.some((x) => x.w === w), `word not found: ${w}`);
}
if (problems.length) { console.error("DATA CHECK FAILED:\n - " + problems.join("\n - ")); process.exit(1); }
console.log(`data ok: ${nWords} words, ${nPhrases} phrases`);
