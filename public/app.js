import {
  MAX_LETTERS, sanitizeHistory, normalise, extractEnum, parseEnum, formatEnum, breakBefore, reshuffle, makeEntry,
  placeTile, tapWheelTile, tapBox, toggleLock, clearUnlocked, placeAll, shuffleBoxes, fillAnswer, arrangement,
} from "./core.js";
import { enumOf } from "./search.js";

const KEY_HIST = "aw.history.v1";
const KEY_CUR = "aw.current.v1";
const KEY_THEME = "aw.theme";
const MAX_HISTORY = 200;

const $ = (id) => document.getElementById(id);
const els = {
  seed: $("seed"), enum: $("enum"), warn: $("enumWarn"), wheel: $("wheel"), boxes: $("boxes"),
  count: $("count"), place: $("placeBtn"), clear: $("clearBtn"), drawer: $("drawer"), scrim: $("scrim"),
  list: $("historyList"), empty: $("historyEmpty"),
};

// ---------- storage (every access guarded: Safari private mode etc.) ----------
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// Saved data is untrusted (old, corrupted or hand-edited): validate it so a bad value can never stop the app starting.
let history = sanitizeHistory(store.get(KEY_HIST, []), MAX_HISTORY);
let cur = history.find((e) => e.id === store.get(KEY_CUR, null)) || history[0] || null;

function save() {
  if (cur) {
    cur.updatedAt = Date.now();
    const i = history.findIndex((e) => e.id === cur.id);
    if (i === -1) history.unshift(cur);
    history = history.slice(0, MAX_HISTORY);
    store.set(KEY_CUR, cur.id);
  }
  store.set(KEY_HIST, history);
}

// ---------- rendering ----------
function render() {
  renderWheel();
  renderBoxes();
  renderCount();
}

/** "8 letters (3,5)" hint, plus a warning when the word lengths don't add up. */
function renderCount() {
  if (!cur) { els.count.textContent = ""; els.warn.hidden = true; return; }
  const n = cur.letters.length;
  const p = parseEnum(els.enum.value, n);
  els.count.textContent = n + " letters" + (p.ok && !p.empty ? " (" + formatEnum(p) + ")" : "");
  els.warn.hidden = p.ok;
  els.warn.textContent = "Word lengths must add up to " + n;
}

function renderWheel() {
  els.wheel.querySelectorAll(".tile").forEach((t) => t.remove());
  if (!cur) return;
  const n = cur.letters.length;
  const W = els.wheel.clientWidth;
  const tile = Math.max(24, Math.min(52, ((2 * Math.PI * W * 0.38) / n) * 0.88));
  const R = W / 2 - tile / 2 - 6;
  cur.order.forEach((id, p) => {
    const a = -Math.PI / 2 + (2 * Math.PI * p) / n;
    const t = document.createElement("div");
    t.className = "tile" + (cur.boxes.includes(id) ? " used" : "");
    t.dataset.tile = id;
    t.textContent = cur.letters[id];
    Object.assign(t.style, {
      width: tile + "px", height: tile + "px", fontSize: tile * 0.5 + "px",
      left: W / 2 + R * Math.cos(a) - tile / 2 + "px", top: W / 2 + R * Math.sin(a) - tile / 2 + "px",
    });
    els.wheel.appendChild(t);
  });
}

function renderBoxes() {
  els.boxes.textContent = "";
  if (!cur) return;
  const n = cur.letters.length;
  const { groups, seps } = parseEnum(els.enum.value, n);
  const breaks = breakBefore(groups, seps);
  const GAP = n > 12 ? 2 : 4; // tighter spacing for long answers so tiles stay readable
  const SEP_W = { " ": 20, "-": 14 }; // width of the word-gap / hyphen element between boxes
  let extra = 0;
  breaks.forEach((s) => { extra += SEP_W[s] + GAP; }); // each separator adds its width plus one more flex gap
  const avail = els.boxes.parentElement.clientWidth;
  const size = Math.max(10, Math.min(56, Math.floor((avail - GAP * (n - 1) - extra) / n)));
  els.boxes.style.gap = GAP + "px";
  els.boxes.style.setProperty("--box", size + "px");
  cur.boxes.forEach((id, i) => {
    if (breaks.has(i)) {
      const s = document.createElement("div");
      s.className = "sep" + (breaks.get(i) === "-" ? " hyphen" : "");
      s.style.width = SEP_W[breaks.get(i)] + "px";
      s.setAttribute("aria-hidden", "true");
      els.boxes.appendChild(s);
    }
    const b = document.createElement("div");
    b.className = "box" + (id !== null ? " filled" : "") + (cur.locks[i] ? " locked" : "");
    b.dataset.box = i;
    b.textContent = id === null ? "" : cur.letters[id];
    els.boxes.appendChild(b);
  });
}

// Grey ✕ inside the letters box: clears only the typed text (never boxes or history), then refocuses.
function syncSeedClear() { $("seedClear").hidden = els.seed.value === ""; }
els.seed.addEventListener("input", () => { syncSeedClear(); $("seedError").hidden = true; });
$("seedClear").addEventListener("pointerdown", (ev) => ev.preventDefault()); // keep keyboard open
$("seedClear").addEventListener("click", () => { els.seed.value = ""; syncSeedClear(); els.seed.focus(); });

function loadEntry(entry) {
  cur = entry;
  els.seed.value = cur ? cur.letters : "";
  syncSeedClear();
  els.enum.value = cur ? cur.enumStr : "";
  save();
  render();
  renderHistory();
}

// ---------- gestures: tap, drag (move/swap), long-press (lock) ----------
let gesture = null;

document.addEventListener("pointerdown", (ev) => {
  const el = ev.target.closest("[data-tile], [data-box]");
  if (!el || !cur || gesture) return;
  const boxIdx = el.dataset.box !== undefined ? Number(el.dataset.box) : -1;
  const id = boxIdx >= 0 ? cur.boxes[boxIdx] : Number(el.dataset.tile);
  gesture = { el, boxIdx, id, x: ev.clientX, y: ev.clientY, pid: ev.pointerId, dragging: false, handled: false, ghost: null, timer: null };
  if (boxIdx >= 0 && id !== null) {
    gesture.timer = setTimeout(() => {
      if (gesture && !gesture.dragging && toggleLock(cur, boxIdx)) { gesture.handled = true; navigator.vibrate?.(15); changed(); }
    }, 500);
  }
});

document.addEventListener("pointermove", (ev) => {
  const g = gesture;
  if (!g || ev.pointerId !== g.pid) return;
  if (!g.dragging && !g.handled && g.id !== null && Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > 8) {
    if (g.boxIdx >= 0 && cur.locks[g.boxIdx]) { g.handled = true; return; }
    g.dragging = true;
    clearTimeout(g.timer);
    const r = g.el.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.textContent = cur.letters[g.id];
    ghost.style.cssText = `width:${r.width}px;height:${r.width}px;font-size:${r.width * 0.5}px`;
    document.body.appendChild(ghost);
    g.ghost = ghost;
    g.el.classList.add("dragging");
  }
  if (g.dragging) {
    ev.preventDefault();
    g.ghost.style.left = ev.clientX + "px";
    g.ghost.style.top = ev.clientY + "px";
    document.querySelectorAll(".box.hover").forEach((b) => b.classList.remove("hover"));
    boxAt(ev.clientX, ev.clientY)?.classList.add("hover");
  }
}, { passive: false });

function boxAt(x, y) {
  return document.elementsFromPoint(x, y).map((e) => e.closest?.("[data-box]")).find(Boolean) || null;
}

function endGesture(ev, cancelled) {
  const g = gesture;
  if (!g || ev.pointerId !== g.pid) return;
  gesture = null;
  clearTimeout(g.timer);
  g.ghost?.remove();
  document.querySelectorAll(".box.hover").forEach((b) => b.classList.remove("hover"));
  let didChange = false;
  if (g.dragging && !cancelled) {
    const target = boxAt(ev.clientX, ev.clientY);
    if (target) didChange = placeTile(cur, g.id, Number(target.dataset.box));
    else if (g.boxIdx >= 0 && els.wheel.contains(document.elementFromPoint(ev.clientX, ev.clientY))) didChange = tapBox(cur, g.boxIdx); // dragged back to wheel
  } else if (!g.dragging && !g.handled && !cancelled && g.id !== null) {
    didChange = g.boxIdx >= 0 ? tapBox(cur, g.boxIdx) : tapWheelTile(cur, g.id);
  }
  if (didChange) changed(); else render();
}
document.addEventListener("pointerup", (ev) => endGesture(ev, false));
document.addEventListener("pointercancel", (ev) => endGesture(ev, true));
// stop iOS scroll/rubber-banding while dragging
document.addEventListener("touchmove", (ev) => { if (gesture?.dragging) ev.preventDefault(); }, { passive: false });
document.addEventListener("contextmenu", (ev) => { if (ev.target.closest("[data-tile], [data-box]")) ev.preventDefault(); });

function changed() { save(); render(); renderHistory(); }

// ---------- controls ----------
$("seedForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const { seed, enumStr } = extractEnum(els.seed.value);
  const letters = normalise(seed);
  if (!letters) return;
  if (letters.length > MAX_LETTERS) {
    $("seedError").textContent = "That's " + letters.length + " letters. The most I can handle is " + MAX_LETTERS + ".";
    $("seedError").hidden = false;
    return;
  }
  $("seedError").hidden = true;
  // Word lengths only come from "(3,5)" typed with the letters; a previous puzzle's lengths never carry over.
  const existing = history.find((e) => e.letters === letters);
  if (existing) {
    if (enumStr) existing.enumStr = enumStr;
    loadEntry(existing);
  } else {
    const entry = makeEntry(letters, enumStr);
    history.unshift(entry);
    loadEntry(entry);
  }
  els.seed.blur();
});

els.enum.addEventListener("input", () => {
  if (!cur) return;
  cur.enumStr = els.enum.value.trim();
  save();
  render();
  renderHistory();
});

// "Shuffle" button: re-arranges the letters placed in the answer boxes.
document.querySelectorAll('[data-action="shuffle"]').forEach((b) => b.addEventListener("click", () => {
  if (cur && shuffleBoxes(cur)) changed();
}));
// ↻ in the middle of the wheel: re-scrambles the wheel's own letters (boxes untouched).
document.querySelectorAll('[data-action="wheel-shuffle"]').forEach((b) => b.addEventListener("click", () => {
  if (!cur) return;
  cur.order = reshuffle(cur.order, cur.letters);
  changed();
}));
els.place.addEventListener("click", () => { if (cur && placeAll(cur)) changed(); });
els.clear.addEventListener("click", () => { if (cur) { clearUnlocked(cur); changed(); } });

$("themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  store.set(KEY_THEME, next);
});
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#0b0d10" : "#f6f7f8";
}
applyTheme(store.get(KEY_THEME, "dark") === "light" ? "light" : "dark"); // dark by default; the toggle remembers your choice

// ---------- history drawer ----------
function openDrawer(open, which = els.drawer) {
  els.drawer.hidden = true;
  $("cheat").hidden = true;
  els.scrim.hidden = !open;
  if (open) which.hidden = false;
}
$("historyBtn").addEventListener("click", () => { renderHistory(); openDrawer(true); });
$("closeHistoryBtn").addEventListener("click", () => openDrawer(false));
els.scrim.addEventListener("click", () => openDrawer(false));
$("clearHistoryBtn").addEventListener("click", () => {
  if (!history.length || !confirm("Delete all history?")) return;
  history = [];
  store.set(KEY_CUR, null);
  loadEntry(null);
});

function renderHistory() {
  els.list.textContent = "";
  const sorted = history.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  els.empty.hidden = sorted.length > 0;
  sorted.forEach((e) => {
    const li = document.createElement("li");
    li.className = "history-item" + (cur && e.id === cur.id ? " current" : "");
    const main = document.createElement("button");
    main.className = "history-main";
    main.innerHTML = '<div class="history-letters"></div><div class="history-arr"></div>';
    main.firstChild.textContent = e.letters;
    main.lastChild.textContent = arrangement(e);
    main.addEventListener("click", () => { loadEntry(e); openDrawer(false); });
    const del = document.createElement("button");
    del.className = "history-del";
    del.setAttribute("aria-label", "Delete " + e.letters);
    del.textContent = "×";
    del.addEventListener("click", () => {
      history = history.filter((x) => x.id !== e.id);
      if (cur && cur.id === e.id) loadEntry(history[0] || null); else { save(); renderHistory(); }
    });
    li.append(main, del);
    els.list.appendChild(li);
  });
}

// ---------- cheat: offline word / phrase / combination finder (runs in worker.js) ----------
let worker = null;
let reqId = 0;
const cheatBody = $("cheatBody");

function cheatQuery() {
  const n = cur.letters.length;
  const p = parseEnum(els.enum.value, n);
  const locks = [];
  cur.locks.forEach((locked, i) => { if (locked && cur.boxes[i] !== null) locks.push({ pos: i, ch: cur.letters[cur.boxes[i]] }); });
  return { letters: cur.letters, groups: p.ok && !p.empty ? p.groups : null, locks, includeRare: $("rareToggle").checked };
}

function runCheat() {
  if (!cur) { cheatBody.textContent = ""; $("cheatInfo").textContent = "Enter some letters first."; return; }
  const q = cheatQuery();
  const lockText = q.locks.length ? " · locked: " + q.locks.map((l) => l.ch.toUpperCase() + "@" + (l.pos + 1)).join(" ") : "";
  $("cheatInfo").textContent = cur.letters + (q.groups ? " (" + formatEnum({ groups: q.groups, seps: parseEnum(els.enum.value, cur.letters.length).seps }) + ")" : "") + lockText;
  cheatBody.textContent = "Searching…";
  worker ||= new Worker("worker.js", { type: "module" });
  const id = ++reqId;
  const onMsg = (ev) => {
    if (ev.data.id !== id) return;
    worker.removeEventListener("message", onMsg);
    renderCheat(ev.data);
  };
  worker.addEventListener("message", onMsg);
  worker.postMessage({ id, query: q });
}

function resultSection(title, items, toNode) {
  if (!items.length) return;
  const h = document.createElement("h3");
  h.textContent = title;
  const ul = document.createElement("ul");
  ul.className = "results";
  items.forEach((it) => { const li = document.createElement("li"); li.appendChild(toNode(it)); ul.appendChild(li); });
  cheatBody.append(h, ul);
}

function resultButton(text, note, rare, onTap) {
  const b = document.createElement("button");
  b.className = "result" + (rare ? " rare" : "");
  const span = document.createElement("span");
  span.textContent = text;
  b.appendChild(span);
  if (note) { const s = document.createElement("small"); s.textContent = note; b.appendChild(s); }
  b.addEventListener("click", onTap);
  return b;
}

function chooseAnswer(text, enumStr) {
  if (!cur || !fillAnswer(cur, text)) return;
  // A multi-word answer fills in the word lengths if you hadn't entered any.
  if (/[,-]/.test(enumStr) && !els.enum.value.trim()) { cur.enumStr = enumStr; els.enum.value = enumStr; }
  openDrawer(false);
  changed();
}

function renderCheat({ result, error }) {
  cheatBody.textContent = "";
  if (error) { cheatBody.textContent = error; return; }
  const { phrases, words, combos, truncated } = result;
  resultSection("Phrases & names", phrases, (p) => resultButton(p.text, "(" + p.enum + ")", false, () => chooseAnswer(p.text, p.enum)));
  resultSection("Words", words, (w) => resultButton(w.w.toUpperCase(), w.tier >= 3 ? "rare" : "", w.tier >= 3, () => chooseAnswer(w.w, "")));
  resultSection("Word combinations", combos, (c) => resultButton(c.text, "", false, () => chooseAnswer(c.text, enumOf(c.text))));
  if (!phrases.length && !words.length && !combos.length) {
    const hasEnum = cheatQuery().groups;
    cheatBody.textContent = hasEnum || cur.letters.length < 4
      ? "Nothing found. Try ticking “Include rarer words”, or check the letters and lengths."
      : "Nothing found as a single word or phrase. Add word lengths (e.g. 3,5) to search for word combinations.";
  } else if (truncated) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Showing the best matches only. Lock letters or add word lengths to narrow it down.";
    cheatBody.appendChild(p);
  }
}

$("cheatBtn").addEventListener("click", () => { openDrawer(true, $("cheat")); runCheat(); });
$("closeCheatBtn").addEventListener("click", () => openDrawer(false));
$("rareToggle").addEventListener("change", runCheat);

// ---------- boot ----------
let raf = 0;
window.addEventListener("resize", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); });
loadEntry(cur);
navigator.storage?.persist?.().catch(() => {});
setupServiceWorker();

// ---------- offline + updates ----------
function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller; // false on the very first visit
  let waiting = null;
  const offerUpdate = (sw) => { waiting = sw; $("updateBar").hidden = false; };
  $("updateBtn").addEventListener("click", () => waiting?.postMessage("SKIP_WAITING"));

  navigator.serviceWorker.register("sw.js").then((reg) => {
    if (reg.waiting && hadController) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      sw?.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(sw);
      });
    });
    // Look for a new version whenever the app comes back to the foreground.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    // Save the word lists for offline use once the app is up and the browser is idle (not during install).
    navigator.serviceWorker.ready.then(() => {
      const warm = () => ["data/words.txt", "data/phrases.txt"].forEach((u) => fetch(u).catch(() => {}));
      "requestIdleCallback" in window ? requestIdleCallback(warm, { timeout: 5000 }) : setTimeout(warm, 3000);
    });
  }).catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return; // first install also fires this; don't reload then
    reloading = true;
    location.reload();
  });
}
