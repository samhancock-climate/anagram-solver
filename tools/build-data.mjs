// Builds the offline cheat data files from public datasets.
//   node tools/build-data.mjs <input-dir> <output-dir>
// Input dir (downloaded separately, see tools/README.md):
//   scowl-35.txt scowl-50.txt scowl-60.txt scowl-70.txt   (SCOWL, British -ise spelling)
//   cities15000.txt                                       (GeoNames)
//   enwikt-titles.gz                                      (English Wiktionary page titles)
//   views-<yyyymmdd>.txt  (one per sample day: "<Title> <daily views>", see tools/aggregate-views.mjs)
// Also reads tools/extra-phrases.txt (hand-curated).
// Output: words.txt (one "<tier><word>" per line), phrases.txt (one display string per line, best first), meta.json.
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) throw new Error("usage: build-data.mjs <input-dir> <output-dir>");
fs.mkdirSync(OUT, { recursive: true });

const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------- words: tier 1 (very common) .. 4 (obscure), from SCOWL sizes 35/50/60/70 ----------
const info = new Map(); // lower -> { lowerTier, anyTier }
[35, 50, 60, 70].forEach((size, ti) => {
  const lines = fs.readFileSync(`${IN}/scowl-${size}.txt`, "utf8").split("\n");
  const start = lines.indexOf("---") + 1;
  for (const raw of lines.slice(start)) {
    if (!/^[A-Za-z]+$/.test(raw)) continue; // no apostrophes, hyphens, dots
    const lw = raw.toLowerCase();
    const isLower = raw === lw;
    if (!isLower && raw === raw.toUpperCase() && raw.length > 1) continue; // acronyms
    const e = info.get(lw) || { lowerTier: 0, anyTier: 0 };
    if (isLower && !e.lowerTier) e.lowerTier = ti + 1;
    if (!e.anyTier) e.anyTier = ti + 1;
    info.set(lw, e);
  }
});
const wordLines = [];
const dict = new Set();
const tierOf = new Map();
for (const [w, e] of info) {
  dict.add(w);
  // Capitalised-only entries are proper nouns: demote one tier so they rank below ordinary words.
  const tier = e.lowerTier || Math.min(e.anyTier + 1, 4);
  tierOf.set(w, tier);
  wordLines.push(tier + w);
}
wordLines.sort((a, b) => a[0].localeCompare(b[0]) || a.localeCompare(b));
fs.writeFileSync(`${OUT}/words.txt`, wordLines.join("\n") + "\n");
console.log("words:", wordLines.length);

// ---------- phrases ----------
const WIKI_MAX = 110000; // most-viewed Wikipedia titles to consider
const WIKT_MAX_TIER = 3; // idioms must be made of reasonably common words (SCOWL size <= 60)
const phrases = new Map(); // key -> { display, score, wikt }
const lettersOf = (s) => s.replace(/[^A-Za-z]/g, "");
function add(display, score, { wikt = false } = {}) {
  display = strip(display).replace(/\s+/g, " ").trim();
  if (!/^[A-Za-z][A-Za-z '\-.,&!]*$/.test(display)) return;
  const letters = lettersOf(display);
  if (letters.length < 4 || letters.length > 22) return;
  const tokens = display.split(/[\s\-]+/).filter(Boolean);
  if (tokens.length > 6) return;
  if (tokens.length === 1 && dict.has(letters.toLowerCase())) return; // plain words are in words.txt
  const key = display.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ");
  const prev = phrases.get(key);
  if (prev) {
    prev.score += score;
    if (wikt && !prev.wikt) { prev.display = display; prev.wikt = true; } // lowercase idiom form wins
  } else phrases.set(key, { display, score, wikt });
}

// Wikipedia: pageviews averaged over several sample days (views-<yyyymmdd>.txt, lines "<Title> <count>").
const viewsDays = fs.readdirSync(IN).filter((f) => /^views-\d+\.txt$/.test(f)).sort();
{
  if (!viewsDays.length) throw new Error(`no views-<date>.txt files in ${IN}`);
  const views = new Map();
  const SKIP = /^(List|Lists|Index|Outline|Timeline|Deaths|Wikipedia|Main_Page|Portal|Template|Special|Help)(_|$)/;
  for (const file of viewsDays) {
    const rl = readline.createInterface({ input: fs.createReadStream(`${IN}/${file}`) });
    for await (const line of rl) {
      const sp = line.lastIndexOf(" ");
      let t = line.slice(0, sp);
      if (t.includes(":") || SKIP.test(t) || /[0-9]/.test(t)) continue;
      try { t = decodeURIComponent(t); } catch { continue; }
      t = t.replace(/_\(.*\)$/, "").replace(/_/g, " ");
      views.set(t, (views.get(t) || 0) + Number(line.slice(sp + 1)));
    }
  }
  const top = [...views].sort((a, b) => b[1] - a[1]).slice(0, WIKI_MAX);
  for (const [t, v] of top) add(t, v / viewsDays.length); // average daily views
  console.log(`wikipedia titles kept: ${top.length} (from ${viewsDays.length} days) | lowest avg daily views: ${Math.round(top.at(-1)[1] / viewsDays.length)}`);
}

// GeoNames: towns and cities with population >= 15,000.
{
  for (const line of fs.readFileSync(`${IN}/cities15000.txt`, "utf8").split("\n")) {
    const f = line.split("\t");
    if (f.length < 15) continue;
    add(f[2] || f[1], Number(f[14]) / 50);
  }
}

// Wiktionary: multi-word lowercase entries whose every word is a known English word (idioms, phrasal verbs).
{
  const rl = readline.createInterface({ input: fs.createReadStream(`${IN}/enwikt-titles.gz`).pipe(zlib.createGunzip()) });
  let kept = 0;
  for await (const t of rl) {
    if (!/^[a-z]+(_[a-z]+){1,2}$/.test(t)) continue; // 2-3 words
    const toks = t.split("_");
    if (!toks.every((w) => (tierOf.get(w) || 9) <= WIKT_MAX_TIER)) continue;
    if (toks.join("").length > 18) continue;
    add(toks.join(" "), 30, { wikt: true });
    kept++;
  }
  console.log("wiktionary idioms kept:", kept);
}

// Hand-curated answers (tools/extra-phrases.txt): always kept, and ranked above everything else.
{
  const extra = fs.existsSync(new URL("./extra-phrases.txt", import.meta.url))
    ? fs.readFileSync(new URL("./extra-phrases.txt", import.meta.url), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];
  extra.forEach((p) => add(p, 1e12, { wikt: true }));
  console.log("curated phrases:", extra.length);
}

const ranked = [...phrases.values()].sort((a, b) => b.score - a.score || a.display.localeCompare(b.display));
fs.writeFileSync(`${OUT}/phrases.txt`, ranked.map((p) => p.display).join("\n") + "\n");
console.log("phrases:", ranked.length);
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({
  built: new Date().toISOString().slice(0, 10), viewsDays: viewsDays.map((f) => f.slice(6, -4)),
  words: wordLines.length, phrases: ranked.length,
}, null, 2) + "\n");
console.log("top 15:", ranked.slice(0, 15).map((p) => p.display).join(" | "));
