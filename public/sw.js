// Bump CACHE when any file changes so installed copies pick up the update.
const CACHE = "anagram-wheel-v13";
// Note: "privacy" (not privacy.html): Cloudflare redirects *.html to the clean URL, and a service worker must never
// answer a page navigation with a redirected response.
const FILES = [
  "./", "index.html", "style.css", "app.js", "core.js", "search.js", "worker.js", "manifest.webmanifest",
  "privacy", "doc.css", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];
// The big word lists (data/) are NOT fetched here, so installing never competes with the first load.
// The app requests them once it is idle, and the fetch handler below saves them for offline use.

self.addEventListener("install", (e) => {
  // No skipWaiting here: a new version waits until the user taps "Reload" (see the message handler),
  // so an update never swaps files under a page that is in use.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first: works offline instantly; falls back to network for anything unexpected.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        // Save same-origin data files on first use so they work offline afterwards.
        if (res.ok && new URL(e.request.url).pathname.includes("/data/")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    }),
  );
});
