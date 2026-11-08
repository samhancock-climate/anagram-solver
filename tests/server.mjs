// Tiny static server for tests: serves public/ and applies public/_headers exactly like Cloudflare Pages would,
// so the Content-Security-Policy is exercised for real. `transforms` lets a test change a file's body on the fly.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".txt": "text/plain; charset=utf-8",
};

function parseHeaders(file) {
  const rules = []; // [{ pattern, headers: {} }]
  let cur = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: {} }; rules.push(cur); continue; }
    const i = line.indexOf(":");
    cur.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}
const matches = (pattern, url) =>
  pattern === "/*" || pattern === url || (pattern.endsWith("/*") && url.startsWith(pattern.slice(0, -1)));

export function startServer(port = 0, host = "127.0.0.1") {
  const rules = parseHeaders(path.join(ROOT, "_headers"));
  const transforms = new Map(); // url path -> (body: string) => string
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    // Mimic Cloudflare's clean URLs: /x.html redirects to /x, and /x serves x.html. (This once hid a real bug.)
    if (url.endsWith(".html")) {
      res.writeHead(307, { Location: url === "/index.html" ? "/" : url.slice(0, -5) });
      res.end();
      return;
    }
    if (url.endsWith("/")) url += "index.html";
    else if (!path.extname(url) && fs.existsSync(path.join(ROOT, url + ".html"))) url += ".html";
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory() || url === "/_headers") {
      res.writeHead(404); res.end("not found"); return;
    }
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" };
    for (const r of rules) if (matches(r.pattern, url)) Object.assign(headers, r.headers);
    let body = fs.readFileSync(file);
    const t = transforms.get(url);
    if (t) body = Buffer.from(t(body.toString("utf8")));
    res.writeHead(200, headers);
    res.end(body);
  });
  return new Promise((resolve) =>
    server.listen(port, host, () =>
      resolve({ url: `http://localhost:${server.address().port}/`, transforms, close: () => server.close() })));
}

// `node tests/server.mjs [port]` -> serve public/ for manual testing (e.g. from your phone on the same Wi-Fi).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(Number(process.argv[2] || 8765), "0.0.0.0");
  console.log("Serving public/ at", url, "(use this Mac's LAN address from your phone)");
}
