// Reads Wikimedia pageview lines on stdin ("en.wikipedia <Title> <id> <access> <daily> <hourly>") and prints
// "<Title> <total daily views>" for titles with at least MIN_VIEWS views that day (the long tail can't reach the top
// ~110k titles we keep, and dropping it keeps each cached day at ~20 MB instead of ~90 MB). Used via fetch-views-day.sh.
import readline from "node:readline";

const MIN_VIEWS = 25;
const totals = new Map();
for await (const line of readline.createInterface({ input: process.stdin })) {
  const f = line.split(" ");
  if (f.length < 5 || f[0] !== "en.wikipedia") continue;
  totals.set(f[1], (totals.get(f[1]) || 0) + Number(f[4]));
}
const out = [];
for (const [t, n] of totals) if (n >= MIN_VIEWS) out.push(`${t} ${n}`);
process.stdout.write(out.join("\n") + "\n");
