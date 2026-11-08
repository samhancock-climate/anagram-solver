// Runs the cheat search off the main thread so the UI never janks while the word data loads/indexes.
import { buildIndex, solve } from "./search.js";

let index = null;
let loading = null;

async function load() {
  const [words, phrases] = await Promise.all([
    fetch("data/words.txt").then((r) => { if (!r.ok) throw new Error("words"); return r.text(); }),
    fetch("data/phrases.txt").then((r) => { if (!r.ok) throw new Error("phrases"); return r.text(); }),
  ]);
  index = buildIndex(words, phrases);
}

self.onmessage = async (e) => {
  const { id, query } = e.data;
  try {
    if (!index) await (loading ||= load());
    postMessage({ id, result: solve(index, query) });
  } catch (err) {
    loading = null; // allow a retry (e.g. once back online if the data was never cached)
    postMessage({ id, error: "The word lists aren't available yet. Open this once while online so they can be saved for offline use." });
  }
};
