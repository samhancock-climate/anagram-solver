// Offline "cheat" search. Pure logic (no DOM), used by worker.js and by the Node tests.
//
// Data (built by tools/build-data.mjs):
//   words.txt   one "<tier><word>" per line; tier 1 = very common ... 4 = obscure
//   phrases.txt one display string per line ("Ice cream", "Isle of Wight"), best-known first
//
// We always know the full setup up front (all the letters, usually the word lengths, and any locked
// letters), so the search is:
//   1. phrases/names whose letters match exactly (a direct lookup by sorted letters),
//   2. single words (same lookup),
//   3. combinations of common words that fit the word lengths, slot by slot.

const sortLetters = (s) => [...s].sort().join("");
const lettersOnly = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

/** "Isle of Wight" -> [4,2,5];  "hot-dog stand" -> [3,3,5] */
export function groupsOf(display) {
  return display.split(/[\s\-]+/).map((t) => lettersOnly(t).length).filter((n) => n > 0);
}

/** "Hot-dog stand" -> "3-3,5" (the word-lengths format the app uses). */
export function enumOf(display) {
  const tokens = display.match(/[^\s\-]+|[\s\-]+/g) || [];
  let out = "";
  let pendingSep = "";
  for (const t of tokens) {
    if (/^[\s\-]+$/.test(t)) { pendingSep = t.includes("-") ? "-" : ","; continue; }
    const n = lettersOnly(t).length;
    if (!n) continue;
    out += (out ? pendingSep || "," : "") + n;
    pendingSep = "";
  }
  return out;
}

export function buildIndex(wordsText, phrasesText) {
  const byLen = new Map(); // length -> [{w, t}]
  const bySig = new Map(); // sorted letters -> [{w, t}]
  for (const line of wordsText.split("\n")) {
    if (line.length < 2) continue;
    const t = line.charCodeAt(0) - 48;
    const w = line.slice(1);
    const entry = { w, t };
    (byLen.get(w.length) || byLen.set(w.length, []).get(w.length)).push(entry);
    const sig = sortLetters(w);
    (bySig.get(sig) || bySig.set(sig, []).get(sig)).push(entry);
  }
  const phraseBySig = new Map(); // sorted letters -> [{text, letters, groups}]
  for (const text of phrasesText.split("\n")) {
    if (!text) continue;
    const letters = lettersOnly(text);
    const p = { text, letters, groups: groupsOf(text) };
    const sig = sortLetters(letters);
    (phraseBySig.get(sig) || phraseBySig.set(sig, []).get(sig)).push(p); // file order = best first
  }
  return { byLen, bySig, phraseBySig };
}

const sameGroups = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const matchesLocks = (letters, locks) => locks.every(({ pos, ch }) => letters[pos] === ch);

/**
 * query: { letters: "icecream", groups: [3,5] | null, locks: [{pos, ch}], includeRare: bool }
 * returns { phrases, words, combos, truncated }
 */
export function solve(index, query, { maxCombos = 150, maxPhrases = 100, maxWords = 200, budgetMs = 1500 } = {}) {
  const letters = lettersOnly(query.letters);
  const n = letters.length;
  const groups = query.groups && query.groups.reduce((a, b) => a + b, 0) === n ? query.groups : null;
  const locks = (query.locks || []).map((l) => ({ pos: l.pos, ch: l.ch.toLowerCase() }));
  const sig = sortLetters(letters);
  const out = { phrases: [], words: [], combos: [], truncated: false };
  if (!n) return out;

  // 1. phrases and names: direct lookup
  for (const p of index.phraseBySig.get(sig) || []) {
    if (groups && !sameGroups(groups, p.groups)) continue;
    if (!matchesLocks(p.letters, locks)) continue;
    if (out.phrases.length >= maxPhrases) { out.truncated = true; break; }
    out.phrases.push({ text: p.text, enum: enumOf(p.text) });
  }

  // 2. single words
  if (!groups || groups.length === 1) {
    const hits = (index.bySig.get(sig) || []).filter((e) => matchesLocks(e.w, locks));
    hits.sort((a, b) => a.t - b.t || a.w.localeCompare(b.w));
    out.words = hits.slice(0, maxWords).map((e) => ({ w: e.w, tier: e.t }));
    if (hits.length > maxWords) out.truncated = true;
  }

  // 3. combinations of words, slot by slot (needs the word lengths)
  if (groups && groups.length > 1) {
    const maxTier = query.includeRare ? 4 : 2;
    const total = new Uint8Array(26);
    for (const c of letters) total[c.charCodeAt(0) - 97]++;
    const starts = [];
    let pos = 0;
    for (const g of groups) { starts.push(pos); pos += g; }

    const count = (w) => { const a = new Uint8Array(26); for (let i = 0; i < w.length; i++) a[w.charCodeAt(i) - 97]++; return a; };
    const slots = groups.map((len, si) => {
      const list = [];
      for (const e of index.byLen.get(len) || []) {
        if (e.t > maxTier) continue;
        let ok = true;
        for (const { pos: lp, ch } of locks) {
          const k = lp - starts[si];
          if (k >= 0 && k < len && e.w[k] !== ch) { ok = false; break; }
        }
        if (!ok) continue;
        const c = count(e.w);
        for (let i = 0; i < 26; i++) if (c[i] > total[i]) { ok = false; break; }
        if (ok) list.push({ w: e.w, t: e.t, c });
      }
      return list;
    });

    if (slots.every((s) => s.length)) {
      const rem = Uint8Array.from(total);
      const found = [];
      const deadline = performance.now() + budgetMs;
      let steps = 0;
      const dfs = (si, acc, score) => {
        if (out.truncated) return;
        if ((++steps & 1023) === 0 && performance.now() > deadline) { out.truncated = true; return; }
        if (si === groups.length) {
          if (rem.every((x) => x === 0)) found.push({ words: acc.slice(), score });
          return;
        }
        for (const f of slots[si]) {
          let ok = true;
          for (let j = 0; j < 26; j++) if (f.c[j] > rem[j]) { ok = false; break; }
          if (!ok) continue;
          for (let j = 0; j < 26; j++) rem[j] -= f.c[j];
          acc.push(f.w);
          dfs(si + 1, acc, score + f.t);
          acc.pop();
          for (let j = 0; j < 26; j++) rem[j] += f.c[j];
          if (out.truncated) return;
        }
      };
      dfs(0, [], 0);
      found.sort((a, b) => a.score - b.score);
      // Phrases already listed above don't need repeating as combinations.
      const listed = new Set(out.phrases.map((p) => p.text.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ")));
      const fresh = found.filter((f) => !listed.has(f.words.join(" ")));
      if (fresh.length > maxCombos) out.truncated = true;
      out.combos = fresh.slice(0, maxCombos).map((f) => ({ text: f.words.join(" "), score: f.score }));
    }
  }
  return out;
}
