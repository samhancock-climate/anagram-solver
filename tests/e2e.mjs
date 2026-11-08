// End-to-end test in headless Chrome: runs the real app against tests/server.mjs (which applies public/_headers,
// including the Content-Security-Policy). Usage: node tests/e2e.mjs   (set CHROME=/path/to/chrome if needed)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { startServer } from "./server.mjs";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TMP = fs.mkdtempSync(os.tmpdir() + "/aw-e2e-");
// E2E_URL=https://... runs the same checks against a deployed site (skips the ones that need to alter the server).
const LIVE = process.env.E2E_URL;
const server = LIVE ? { url: LIVE.replace(/\/?$/, "/"), transforms: new Map(), close() {} } : await startServer();
const URL = server.url;
const PORT = 9333;
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${TMP}/profile`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === "page")) break; } catch {} await sleep(200); }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  // Anything the browser complains about (CSP violations, uncaught errors) fails the run.
  if (d.method === "Log.entryAdded" && ["error", "warning"].includes(d.params.entry.level) && !/favicon|cloudflareinsights/.test(d.params.entry.text + (d.params.entry.url || ""))) problems.push("log: " + d.params.entry.text);
  if (d.method === "Runtime.exceptionThrown") problems.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const shot = async (name) => fs.writeFileSync(`${TMP}/${name}.png`, Buffer.from((await send("Page.captureScreenshot")).result.data, "base64"));
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const tap = async (x, y) => { await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); await sleep(50); };
const drag = async (x1, y1, x2, y2) => { await mouse("mousePressed", x1, y1); for (let s = 1; s <= 10; s++) { await mouse("mouseMoved", x1 + ((x2 - x1) * s) / 10, y1 + ((y2 - y1) * s) / 10); await sleep(10); } await mouse("mouseReleased", x2, y2); await sleep(50); };
const center = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
const submit = (text, en = "") => ev(`(()=>{const s=document.getElementById('seed');s.value=${JSON.stringify(text)};const e=document.getElementById('enum');e.value=${JSON.stringify(en)};document.getElementById('seedForm').requestSubmit();})()`);
const boxText = () => ev(`[...document.querySelectorAll('.box')].map(b=>b.textContent||'_').join('')`);
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, extra); };

await send("Log.enable");
// Test runs must not count as visits in the real analytics: block the beacon (and ignore the resulting log noise).
await send("Network.setBlockedURLs", { urls: ["*cloudflareinsights.com*"] });
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 700, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: URL }); await sleep(1500);
await ev(`window.__marker = 1`);
await sleep(2500); // let the service worker install and claim the page
check("no surprise reload on first visit", (await ev(`window.__marker === 1`)));
check("service worker controls the page", await ev(`!!navigator.serviceWorker.controller`));
// First-session update (iPhone home-screen apps stay open for days): an update that lands in the SAME page session
// as the first install must still be applied by tapping Reload. (Regression: the page started uncontrolled, so the
// reload used to be skipped.)
if (!LIVE) {
  server.transforms.set("/sw.js", (b) => b + "\n// version 1b\n");
  await ev(`navigator.serviceWorker.getRegistration().then(r => r.update())`);
  let shown1 = false;
  for (let k = 0; k < 30 && !shown1; k++) { await sleep(200); shown1 = !(await ev(`document.getElementById('updateBar').hidden`)); }
  check("first session: update bar appears", shown1);
  await ev(`document.getElementById('updateBtn').click()`);
  let reloaded1 = false;
  for (let k = 0; k < 40 && !reloaded1; k++) { await sleep(200); try { reloaded1 = (await ev(`window.__marker === undefined && document.readyState === 'complete'`)); } catch {} }
  check("first session: tapping Reload applies the update", reloaded1);
  await ev(`window.__marker = 1`);
}

{
  // The Privacy link must work while the service worker is in control (clean-URL redirects broke this once).
  await ev(`document.querySelector('.hint a').click()`); await sleep(1200);
  const ok = await ev(`document.querySelector('h1')?.textContent === 'Privacy & credits'`);
  check("privacy page opens via the link (with service worker)", ok, await ev(`location.pathname + ' | ' + document.title`));
  await send("Page.navigate", { url: URL }); await sleep(1200);
}

// 1. basic flow + tap
await submit("tears"); await sleep(200);
check("wheel has 5 tiles", (await ev(`document.querySelectorAll('.tile').length`)) === 5);
const first = await ev(`document.querySelector('.tile').dataset.tile`);
for (let i = 0; i < 3; i++) { const [x, y] = await center(`.tile:not(.used)`); await tap(x, y); }
check("3 boxes filled by tapping", (await boxText()).replace(/_/g, "").length === 3, await boxText());
// tap box 0 to remove
let [bx, by] = await center(`.box[data-box="0"]`); await tap(bx, by);
check("tap box removes letter", (await boxText())[0] === "_", await boxText());
// drag from box 1 to box 4
const before = await boxText(); [bx, by] = await center(`.box[data-box="1"]`); const [tx, ty] = await center(`.box[data-box="4"]`);
await drag(bx, by, tx, ty);
const after = await boxText();
check("drag moves letter box1->box4", after[4] === before[1] && after[1] === "_", before + " -> " + after);
// long-press lock
[bx, by] = await center(`.box[data-box="4"]`); await mouse("mousePressed", bx, by); await sleep(650); await mouse("mouseReleased", bx, by); await sleep(100);
check("long-press locks box", await ev(`document.querySelector('.box[data-box="4"]').classList.contains('locked')`));
await tap(bx, by);
check("locked box not removed by tap", (await boxText())[4] !== "_");

check("dark by default", (await ev(`document.documentElement.dataset.theme`)) === "dark");
check("title renamed", (await ev(`document.title + '|' + document.querySelector('h1').textContent`)) === "A RAGMAN Solver|A RAGMAN Solver");
check("count hint shown", (await ev(`document.getElementById('count').textContent`)) === "5 letters");
await ev(`document.getElementById('placeBtn').click()`);
check("Place all fills every box, keeps lock", (await boxText()).indexOf("_") === -1 && await ev(`document.querySelector('.box[data-box="4"]').classList.contains('locked')`), await boxText());
await ev(`document.getElementById('clearBtn').click()`);
check("Return all clears unlocked, keeps locked", (await boxText()).replace(/_/g,"").length === 1 && (await boxText())[4] !== "_", await boxText());
await ev(`document.getElementById('placeBtn').click()`);
const o1 = await boxText();
const wheelBefore = await ev(`[...document.querySelectorAll('.tile')].map(t=>t.textContent).join('')`);
let moved = false;
for (let k = 0; k < 5 && !moved; k++) { await ev(`document.querySelector('.actions [data-action=shuffle]').click()`); moved = (await boxText()) !== o1; }
const o2 = await boxText();
const wheelAfter = await ev(`[...document.querySelectorAll('.tile')].map(t=>t.textContent).join('')`);
check("locked box keeps its letter when shuffling", o2[4] === o1[4], o1 + " -> " + o2);
check("Shuffle leaves the wheel alone", wheelBefore === wheelAfter);
let wheelMoved = false;
for (let k = 0; k < 5 && !wheelMoved; k++) { await ev(`document.querySelector('.shuffle').click()`); wheelMoved = (await ev(`[...document.querySelectorAll('.tile')].map(t=>t.textContent).join('')`)) !== wheelAfter; }
check("centre arrow re-scrambles the wheel", wheelMoved);
check("centre arrow leaves the boxes alone", (await boxText()) === o2, await boxText());
check("Shuffle reorders the placed answer", moved && [...o1].sort().join("") === [...o2].sort().join(""), o1 + " -> " + o2);
await shot("shot-tears");

// 2. enumeration
await submit("ice cream (3,5)"); await sleep(200);
check("enum from seed -> input", (await ev(`document.getElementById('enum').value`)) === "3,5");
check("one word-start gap", (await ev(`document.querySelectorAll('.sep').length`)) === 1);
check("count shows enum", (await ev(`document.getElementById('count').textContent`)) === "8 letters (3,5)");
check("enum sets history entry", (await ev(`JSON.parse(localStorage.getItem('aw.history.v1'))[0].enumStr`)) === "3,5");
check("ice cream boxes not clipped", await ev(`(()=>{const w=document.querySelector('.boxes-wrap').getBoundingClientRect();return [...document.querySelectorAll('.box')].every(b=>{const r=b.getBoundingClientRect();return r.left>=w.left-0.5&&r.right<=w.right+0.5})})()`));
await shot("shot-icecream");
await submit("hot dog stand (3-3,5)"); await sleep(200);
check("hyphen separator rendered", (await ev(`document.querySelectorAll('.sep.hyphen').length`)) === 1 && (await ev(`getComputedStyle(document.querySelector('.sep.hyphen'),'::before').content`)) === '"-"');
check("count shows hyphen form", (await ev(`document.getElementById('count').textContent`)) === "11 letters (3-3,5)");
check("hyphen boxes not clipped", await ev(`(()=>{const w=document.querySelector('.boxes-wrap').getBoundingClientRect();return [...document.querySelectorAll('.box')].every(b=>{const r=b.getBoundingClientRect();return r.left>=w.left-0.5&&r.right<=w.right+0.5})})()`));
await shot("shot-hyphen");
check("clear button visible when text present", !(await ev(`document.getElementById('seedClear').hidden`)));
const [cx, cy] = await center("#seedClear"); await tap(cx, cy);
check("clear button empties the text only", (await ev(`document.getElementById('seed').value`)) === "" && (await ev(`document.querySelectorAll('.box').length`)) === 11 && (await ev(`document.getElementById('seedClear').hidden`)));
check("new seed doesn't inherit old word lengths", await (async () => { await submit("pineapple"); await sleep(100); return (await ev(`document.getElementById('enum').value`)) === ""; })());
check("history drawer narrower", await (async () => { await ev(`document.getElementById('historyBtn').click()`); await sleep(100); const w = await ev(`document.getElementById('drawer').getBoundingClientRect().width`); await ev(`document.getElementById('closeHistoryBtn').click()`); return w <= 300.5; })());
await submit("ice cream (3,5)"); await sleep(100);

// 3. single line for long answers at several widths
for (const w of [375, 320]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 700, deviceScaleFactor: 2, mobile: true });
  await submit("the quick brown foxes (3,5,6,3)"); await sleep(300);
  const info = await ev(`(()=>{const r=[...document.querySelectorAll('.box')].map(b=>b.getBoundingClientRect());return {n:r.length,tops:new Set(r.map(x=>Math.round(x.top))).size,left:Math.min(...r.map(x=>x.left)),right:Math.max(...r.map(x=>x.right)),vw:innerWidth,hscroll:document.documentElement.scrollWidth>innerWidth}})()`);
  const vis = await ev(`(()=>{const w=document.querySelector('.boxes-wrap').getBoundingClientRect();return [...document.querySelectorAll('.box')].every(b=>{const r=b.getBoundingClientRect();return r.left>=w.left-0.5&&r.right<=w.right+0.5})})()`);
  check(`${w}px: no box clipped by its container`, vis);
  check(`${w}px: ${info.n} boxes on one line, inside viewport`, info.tops === 1 && info.left >= 0 && info.right <= info.vw && !info.hscroll, JSON.stringify(info));
}
await shot("shot-long");
// mismatched enumeration
await ev(`(()=>{const e=document.getElementById('enum');e.value='4,5';e.dispatchEvent(new Event('input'))})()`); await sleep(100);
check("mismatch warns and falls back to one word", !(await ev(`document.getElementById('enumWarn').hidden`)) && (await ev(`document.querySelectorAll('.sep').length`)) === 0);

// 4. history
await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 700, deviceScaleFactor: 2, mobile: true });
await submit("tears"); await submit("listen"); await submit("ice cream (3,5)"); await sleep(200);
const hl = await ev(`JSON.parse(localStorage.getItem('aw.history.v1')).map(e=>e.letters)`);
check("history holds distinct seeds, no duplicates", new Set(hl).size === hl.length && hl.includes("TEARS") && hl.includes("LISTEN"), hl.join(","));
await ev(`document.getElementById('historyBtn').click()`); await sleep(100);
await shot("shot-history");
await ev(`[...document.querySelectorAll('.history-main')].find(b=>b.textContent.startsWith('TEARS')).click()`); await sleep(100);
check("history click restores TEARS with earlier state", (await ev(`document.getElementById('seed').value`)) === "TEARS" && (await boxText())[4] !== "_", await boxText());
await ev(`location.reload()`); await sleep(1200);
check("reload restores current entry", (await ev(`document.getElementById('seed').value`)) === "TEARS");

// 4b. cheat panel
await submit("ice cream (3,5)"); await sleep(200);
await ev(`document.getElementById('clearBtn').click()`);
await ev(`document.getElementById('cheatBtn').click()`);
let cheatText = "";
for (let k = 0; k < 40; k++) { await sleep(250); cheatText = await ev(`document.getElementById('cheatBody').innerText`); if (!/Searching/.test(cheatText) && cheatText) break; }
check("cheat finds the phrase ICE CREAM", /Phrases & names/i.test(cheatText) && /ice cream/.test(cheatText), cheatText.slice(0, 80).replace(/\n/g, " | "));
check("cheat lists word combinations", /Word combinations/i.test(cheatText));
await shot("shot-cheat");
await ev(`[...document.querySelectorAll('#cheatBody .result')].find(b=>b.textContent.startsWith('ice cream')).click()`); await sleep(150);
check("tapping a result fills the boxes", (await boxText()) === "ICECREAM", await boxText());
check("cheat panel closes after choosing", await ev(`document.getElementById('cheat').hidden`));
// locked letters narrow the search
await ev(`document.getElementById('clearBtn').click()`);
await submit("rates"); await sleep(150);
{ const [tx, ty] = await ev(`(()=>{const t=[...document.querySelectorAll('.tile')].find(t=>t.textContent==='T').getBoundingClientRect();return [t.x+t.width/2,t.y+t.height/2]})()`); await tap(tx, ty); }
{ const [x, y] = await center('.box[data-box="0"]'); await mouse("mousePressed", x, y); await sleep(650); await mouse("mouseReleased", x, y); await sleep(100); }
const firstLetter = (await boxText())[0];
await ev(`document.getElementById('cheatBtn').click()`);
for (let k = 0; k < 40; k++) { await sleep(250); cheatText = await ev(`document.getElementById('cheatBody').innerText`); if (!/Searching/.test(cheatText) && cheatText) break; }
const wordsShown = cheatText.split("\n").filter((l) => /^[A-Z]{5}( rare)?$/.test(l.trim()) && l.trim() !== "WORDS");
check("locked letter constrains cheat results", wordsShown.length > 0 && wordsShown.every((w) => w[0] === firstLetter), firstLetter + ": " + wordsShown.join(","));
await ev(`document.getElementById('closeCheatBtn').click()`);
await submit("tears"); await sleep(100);
await submit("listen"); await sleep(100);


// 4c. hardening
{
  const before = await ev(`JSON.parse(localStorage.getItem('aw.history.v1')).length`);
  await submit("A".repeat(31)); await sleep(100);
  check("31 letters rejected with a message", !(await ev(`document.getElementById('seedError').hidden`)) && (await ev(`JSON.parse(localStorage.getItem('aw.history.v1')).length`)) === before);
  await submit("A".repeat(30)); await sleep(100);
  check("30 letters accepted", (await ev(`document.getElementById('seedError').hidden`)) && (await ev(`document.querySelectorAll('.tile').length`)) === 30);
  check("30 letters still one line", await ev(`new Set([...document.querySelectorAll('.box')].map(b=>Math.round(b.getBoundingClientRect().top))).size === 1`));
  check("seed input has a length limit", (await ev(`document.getElementById('seed').maxLength`)) === 80);
}
for (const [label, junk] of [["not JSON", "{{{not json"], ["wrong type", JSON.stringify({ a: 1 })], ["bad entries", JSON.stringify([{ id: "x", letters: "<img src=x onerror=alert(1)>", order: [], boxes: [], locks: [] }, null, 5])], ["bad theme", ""]]) {
  await ev(`localStorage.setItem('aw.history.v1', ${JSON.stringify(junk)}); localStorage.setItem('aw.current.v1', '"x"'); localStorage.setItem('aw.theme', '"<b>"')`);
  await send("Page.reload"); await sleep(1200);
  const ok = (await ev(`document.querySelectorAll('.tile').length`)) === 0 && (await ev(`document.documentElement.dataset.theme`)) === "dark";
  await submit("tears"); await sleep(100);
  check(`app starts with corrupted storage (${label})`, ok && (await ev(`document.querySelectorAll('.tile').length`)) === 5);
}
await submit("listen"); await sleep(100);

// 4d. update prompt: a changed sw.js is offered, not forced
if (!LIVE) {
  await sleep(500);
  check("no update bar before an update", await ev(`document.getElementById('updateBar').hidden`));
  server.transforms.set("/sw.js", (b) => b + "\n// version 2\n");
  await ev(`navigator.serviceWorker.getRegistration().then(r => r.update())`);
  let shown = false;
  for (let k = 0; k < 30 && !shown; k++) { await sleep(200); shown = !(await ev(`document.getElementById('updateBar').hidden`)); }
  check("update bar appears when a new version is available", shown);
  await ev(`window.__marker = 1`);
  check("page not reloaded behind your back", (await ev(`window.__marker === 1`)));
  await ev(`document.getElementById('updateBtn').click()`);
  let reloaded = false;
  for (let k = 0; k < 30 && !reloaded; k++) { await sleep(200); try { reloaded = (await ev(`window.__marker === undefined && document.readyState === 'complete'`)); } catch {} }
  check("tapping Reload applies the update", reloaded);
  server.transforms.delete("/sw.js");
  check("history survives the update", (await ev(`document.getElementById('seed').value`)) === "LISTEN");
}

// 5. offline
await sleep(800);
check("service worker controls page", await ev(`!!navigator.serviceWorker.controller`));
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await send("Page.reload"); await sleep(1500);
check("loads offline", (await ev(`document.querySelectorAll('.tile').length`)) === 6);
await ev(`document.getElementById('cheatBtn').click()`);
let offText = "";
for (let k = 0; k < 40; k++) { await sleep(250); offText = await ev(`document.getElementById('cheatBody').innerText`); if (!/Searching/.test(offText) && offText) break; }
check("cheat works offline", /Words/i.test(offText) && !/aren't available/.test(offText), offText.slice(0, 60).replace(/\n/g, " | "));
await send("Page.navigate", { url: URL }); await sleep(1200);
await ev(`document.querySelector('.hint a').click()`); await sleep(1200);
check("privacy page opens offline", await ev(`document.querySelector('h1')?.textContent === 'Privacy & credits'`), await ev(`location.pathname`));
await send("Page.navigate", { url: URL }); await sleep(1000);
await shot("shot-offline");

check("no CSP violations, console errors or exceptions", problems.length === 0, problems.slice(0, 5).join(" || "));
ws.close(); proc.kill(); server.close();
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(0);
