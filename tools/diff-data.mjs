// Summarises what changed between two builds. Usage: node tools/diff-data.mjs <old-dir> <new-dir>
import fs from "node:fs";
const [, , A, B] = process.argv;
const read = (d, f) => (fs.existsSync(`${d}/${f}`) ? fs.readFileSync(`${d}/${f}`, "utf8").split("\n").filter(Boolean) : []);
for (const f of ["words.txt", "phrases.txt"]) {
  const a = new Set(read(A, f)), b = new Set(read(B, f));
  const added = [...b].filter((x) => !a.has(x)), removed = [...a].filter((x) => !b.has(x));
  console.log(`\n${f}: ${a.size} -> ${b.size}  (+${added.length} / -${removed.length})`);
  if (f === "phrases.txt") {
    console.log("  added (first 20):  ", added.slice(0, 20).join(" | ") || "-");
    console.log("  removed (first 20):", removed.slice(0, 20).join(" | ") || "-");
  }
}
