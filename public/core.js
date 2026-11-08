// Pure logic: no DOM, no storage. Easy to unit-test and to port to a native app later.

/** Longest answer we accept. Keeps the wheel usable and stops a huge paste freezing the page. */
export const MAX_LETTERS = 30;

/** "Tears!" -> "TEARS" (A-Z only). */
export function normalise(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/** Splits a trailing enumeration off the seed: "tears (4,1)" -> { seed: "tears", enumStr: "4,1" }. */
export function extractEnum(text) {
  const m = /^(.*?)\s*\(([\d,\s.\-]+)\)\s*$/.exec(text || "");
  if (!m) return { seed: text || "", enumStr: "" };
  return { seed: m[1], enumStr: m[2].trim() };
}

/**
 * Parses an enumeration like "3,5", "3 5", "(3-5)" or "35" for n letters.
 * Always returns usable groups; `ok` is false when the input was non-empty but unusable.
 */
export function parseEnum(str, n) {
  const cleaned = (str || "").replace(/[()]/g, "").trim();
  if (!cleaned) return { groups: [n], seps: [], ok: true, empty: true };
  const fail = { groups: [n], seps: [], ok: false };
  if (!/^[\d\s,.\-]+$/.test(cleaned)) return fail;
  let tokens = cleaned.match(/\d+/g) || [];
  // What sits between the numbers: any "-" makes it a hyphen, anything else a word break.
  let seps = cleaned.split(/\d+/).slice(1, -1).map((s) => (s.includes("-") ? "-" : " "));
  // "35" with no separators: a single number if it matches n, otherwise one digit per word.
  if (tokens.length === 1 && tokens[0].length > 1 && Number(tokens[0]) !== n) {
    tokens = tokens[0].split("");
    seps = tokens.slice(1).map(() => " ");
  }
  const groups = tokens.map(Number);
  const sum = groups.reduce((a, b) => a + b, 0);
  if (!groups.length || groups.some((g) => g < 1) || sum !== n) return fail;
  return { groups, seps, ok: true, empty: false };
}

/** Canonical text form, e.g. { groups:[3,3,5], seps:["-"," "] } -> "3-3,5". */
export function formatEnum({ groups, seps }) {
  return groups.map((g, i) => (i === 0 ? "" : seps[i - 1] === "-" ? "-" : ",") + g).join("");
}

/** Map of box index -> separator ("-" or " ") that sits before that box. */
export function breakBefore(groups, seps = []) {
  const map = new Map();
  let pos = 0;
  groups.forEach((g, gi) => {
    if (gi > 0) map.set(pos, seps[gi - 1] || " ");
    pos += g;
  });
  return map;
}

export function shuffled(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffle that tries hard to differ from the current order. */
export function reshuffle(order, letters, rand = Math.random) {
  const sig = (o) => o.map((id) => letters[id]).join("");
  const before = sig(order);
  let next = shuffled(order, rand);
  for (let i = 0; i < 8 && sig(next) === before && new Set(letters).size > 1; i++) {
    next = shuffled(order, rand);
  }
  return next;
}

let counter = 0;
export function makeEntry(letters, enumStr = "", rand = Math.random) {
  const ids = [...letters].map((_, i) => i);
  return {
    id: Date.now().toString(36) + (counter++).toString(36),
    letters,
    order: reshuffle(ids, letters, rand), // wheel position -> tile id
    boxes: ids.map(() => null), // box index -> tile id | null
    locks: ids.map(() => false),
    enumStr,
    updatedAt: Date.now(),
  };
}

/**
 * Validates one saved entry. Returns a clean copy, or null if it's malformed in any way.
 * Anything read back from localStorage is untrusted: it may be old, hand-edited or corrupted.
 */
export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { id, letters, order, boxes, locks, enumStr, updatedAt } = raw;
  if (typeof id !== "string" || id.length === 0 || id.length > 40) return null;
  if (typeof letters !== "string" || !/^[A-Z]+$/.test(letters) || letters.length > MAX_LETTERS) return null;
  const n = letters.length;
  const isIdArray = (a, allowNull) =>
    Array.isArray(a) && a.length === n && a.every((v) => (allowNull && v === null) || (Number.isInteger(v) && v >= 0 && v < n));
  const unique = (a) => new Set(a.filter((v) => v !== null)).size === a.filter((v) => v !== null).length;
  if (!isIdArray(order, false) || !unique(order)) return null; // must be a permutation of the tiles
  if (!isIdArray(boxes, true) || !unique(boxes)) return null;
  if (!Array.isArray(locks) || locks.length !== n || !locks.every((v) => typeof v === "boolean")) return null;
  if (locks.some((l, i) => l && boxes[i] === null)) return null; // a locked box must hold a tile
  return {
    id, letters, order: order.slice(), boxes: boxes.slice(), locks: locks.slice(),
    enumStr: typeof enumStr === "string" ? enumStr.slice(0, 60) : "",
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

/** Validates the whole saved history; drops bad entries and duplicates, caps the length. */
export function sanitizeHistory(raw, max = 200) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const e = sanitizeEntry(r);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/** Moves tile `id` into box `to` (swapping if needed). Returns true if state changed. */
export function placeTile(entry, id, to) {
  const { boxes, locks } = entry;
  if (locks[to]) return false;
  const from = boxes.indexOf(id);
  if (from === to) return false;
  if (from !== -1 && locks[from]) return false;
  const displaced = boxes[to];
  boxes[to] = id;
  if (from !== -1) boxes[from] = displaced; // swap (displaced may be null)
  return true;
}

/** Tap on a wheel tile: remove it if placed, else drop it in the first free box. */
export function tapWheelTile(entry, id) {
  const { boxes, locks } = entry;
  const from = boxes.indexOf(id);
  if (from !== -1) {
    if (locks[from]) return false;
    boxes[from] = null;
    return true;
  }
  const free = boxes.findIndex((b, i) => b === null && !locks[i]);
  if (free === -1) return false;
  boxes[free] = id;
  return true;
}

export function tapBox(entry, i) {
  if (entry.boxes[i] === null || entry.locks[i]) return false;
  entry.boxes[i] = null;
  return true;
}

export function toggleLock(entry, i) {
  if (entry.boxes[i] === null && !entry.locks[i]) return false;
  entry.locks[i] = !entry.locks[i];
  return true;
}

/**
 * Shuffle the answer: re-arrange the letters sitting in unlocked boxes among those boxes.
 * If nothing is placed yet there is nothing to shuffle, so lay out all letters in random order instead.
 */
export function shuffleBoxes(entry, rand = Math.random) {
  const { boxes, locks, letters } = entry;
  const slots = boxes.map((b, i) => i).filter((i) => boxes[i] !== null && !locks[i]);
  if (slots.length === 0) {
    const free = boxes.map((b, i) => i).filter((i) => boxes[i] === null && !locks[i]);
    const unused = shuffled(entry.order.filter((id) => !boxes.includes(id)), rand);
    free.forEach((i) => { if (unused.length) boxes[i] = unused.shift(); });
    return free.length > 0;
  }
  if (slots.length < 2) return false;
  const ids = slots.map((i) => boxes[i]);
  const sig = (a) => a.map((id) => letters[id]).join("");
  let next = shuffled(ids, rand);
  for (let t = 0; t < 8 && sig(next) === sig(ids) && new Set(sig(ids)).size > 1; t++) next = shuffled(ids, rand);
  slots.forEach((i, k) => { boxes[i] = next[k]; });
  return true;
}

/**
 * Lays an answer (letters only, any case) into the boxes. Locked boxes keep their tiles; every other box
 * gets an unused tile with the right letter. Returns false (and changes nothing) if it can't be done.
 */
export function fillAnswer(entry, answer) {
  const want = answer.toUpperCase().replace(/[^A-Z]/g, "");
  const { letters, locks } = entry;
  if (want.length !== letters.length) return false;
  const used = new Set();
  for (let i = 0; i < want.length; i++) {
    if (!locks[i]) continue;
    const id = entry.boxes[i];
    if (id === null || letters[id] !== want[i]) return false;
    used.add(id);
  }
  const next = entry.boxes.slice();
  for (let i = 0; i < want.length; i++) {
    if (locks[i]) continue;
    let pick = -1;
    for (let k = 0; k < letters.length; k++) if (!used.has(k) && letters[k] === want[i]) { pick = k; break; }
    if (pick === -1) return false;
    used.add(pick);
    next[i] = pick;
  }
  entry.boxes = next;
  return true;
}

/** Fills every free, unlocked box with the unused tiles, in wheel order (clockwise from the top). */
export function placeAll(entry) {
  const unused = entry.order.filter((id) => !entry.boxes.includes(id));
  let changed = false;
  entry.boxes.forEach((b, i) => {
    if (b === null && !entry.locks[i] && unused.length) {
      entry.boxes[i] = unused.shift();
      changed = true;
    }
  });
  return changed;
}

export function clearUnlocked(entry) {
  entry.boxes = entry.boxes.map((b, i) => (entry.locks[i] ? b : null));
}

/** Human-readable arrangement for the history list, e.g. "ST·R EA". */
export function arrangement(entry) {
  const { groups, seps } = parseEnum(entry.enumStr, entry.letters.length);
  const breaks = breakBefore(groups, seps);
  return entry.boxes
    .map((id, i) => (breaks.get(i) || "") + (id === null ? "·" : entry.letters[id]))
    .join("");
}
