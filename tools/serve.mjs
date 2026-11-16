// Minimal static server for dist/ (mirrors Cloudflare Pages: directory index.html, 404.html fallback).
// Usage: node tools/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../src/content.mjs";
import { handleApi, memoryStore } from "../src/votes.mjs";

const DIST = path.join(ROOT, "dist");
const PORT = Number(process.argv[2] || process.env.PORT || 4321);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".xml": "application/xml", ".txt": "text/plain", ".yml": "text/yaml" };

export function start(port = PORT) {
  const store = memoryStore(); // votes live in memory here; on Cloudflare they live in a Durable Object (src/worker.mjs)
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (url.startsWith("/api/")) {
      let body = ""; for await (const chunk of req) body += chunk;
      const idsFile = path.join(DIST, "theories/ids.json");
      const ids = new Set(fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, "utf8")) : []);
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      const r = await handleApi(request, { store, ids, ip: req.headers["x-test-ip"] || req.socket.remoteAddress || "", secure: false /* x-test-ip lets local tests act as different visitors */ });
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
    }
    let file = path.normalize(path.join(DIST, url));
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!url.endsWith("/")) { res.writeHead(301, { Location: url + "/" }).end(); return; }
      file = path.join(file, "index.html");
    }
    if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": TYPES[".html"] }); fs.createReadStream(path.join(DIST, "404.html")).pipe(res); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await start();
  console.log(`Serving dist/ at http://localhost:${PORT}`);
}
