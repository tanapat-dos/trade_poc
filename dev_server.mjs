// Local dev server that mimics Netlify: serves web/ as static files and
// runs the two functions at /api/*. For testing before deploying.
//   node dev_server.mjs   ->   http://localhost:8888

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import pricesHandler from "./netlify/functions/prices.mjs";
import alpacaHandler from "./netlify/functions/alpaca.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "web");
const PORT = process.env.PORT || 8888;

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handler = url.pathname === "/api/prices" ? pricesHandler : alpacaHandler;
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const request = new Request(url, { method: req.method, headers: req.headers, body });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const p = url.pathname === "/" ? "/index.html" : normalize(url.pathname);
    const file = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log(`TradeLab dev server -> http://localhost:${PORT}`));
