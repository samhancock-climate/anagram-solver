// Bumps the cache version in public/sw.js so installed copies notice the update. Usage: node tools/bump-cache.mjs
import fs from "node:fs";
const file = new URL("../public/sw.js", import.meta.url);
const src = fs.readFileSync(file, "utf8");
const m = /anagram-wheel-v(\d+)/.exec(src);
if (!m) throw new Error("CACHE name not found in public/sw.js");
fs.writeFileSync(file, src.replace(m[0], `anagram-wheel-v${Number(m[1]) + 1}`));
console.log(`cache version: v${m[1]} -> v${Number(m[1]) + 1}`);
