"use strict";

require("dotenv").config();

for (const method of ["log", "warn", "error"]) {
  const orig = console[method];
  console[method] = (...args) => {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    orig(`[${ts}]`, ...args);
  };
}

const http = require("http");
const fs = require("fs");
const path = require("path");
const { run } = require("./scrape");
const { send: notify } = require("./notify");

const PORT = parseInt(process.env.PORT, 10) || 3000;
const intervalHours = parseFloat(process.env.SCRAPE_INTERVAL_HOURS) ?? 24;
const INTERVAL_MS = Math.max(0.1, intervalHours) * 3600000;
const NTFY_URL = process.env.NTFY_URL;
const NTFY_AUTH = process.env.NTFY_AUTH;
const ROOT = process.cwd();

const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME));

const CSP = "default-src 'self'; script-src 'self' https://unpkg.com https://plausible.imranr.dev; "
  + "style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data:; "
  + "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function serveFile(filePath, res) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== path.join(ROOT, "index.html")) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  const ext = path.extname(resolved);
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (ext === ".html") {
      headers["Content-Security-Policy"] = CSP;
      headers["X-Frame-Options"] = "DENY";
      headers["X-Content-Type-Options"] = "nosniff";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function isValidPath(p) {
  if (!p) return false;
  if (p.includes("\0") || p.includes("%00")) return false;
  return true;
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url.split("?")[0];
  if (rawUrl.length > 1024) {
    res.writeHead(414);
    res.end("URI Too Long");
    return;
  }

  let filePath;

  if (rawUrl === "/") {
    filePath = path.join(ROOT, "index.html");
  } else if (rawUrl.startsWith("/data/")) {
    const sanitized = rawUrl.replace(/\.\.\//g, "");
    filePath = path.join(ROOT, sanitized);
  } else {
    const sanitized = rawUrl.replace(/^\//, "").replace(/\.\.\//g, "");
    filePath = path.join(ROOT, sanitized);
    if (fs.existsSync(filePath + ".html")) {
      filePath = filePath + ".html";
    }
  }

  if (!isValidPath(filePath)) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  serveFile(filePath, res);
});

server.maxHeadersCount = 50;
server.headersTimeout = 10000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  notify(NTFY_URL, `Server started on port ${PORT}`, { title: "CCT26 started", priority: 3, auth: NTFY_AUTH });
});

let isRunning = false;
let lastRunStart = 0;
let lastCookieWarnDate = "";
let lastSkipLog = 0;

function checkCookieExpiry(cookie) {
  if (!cookie) return;
  let minDaysLeft = Infinity;
  let found = false;
  for (const tokenName of ["reddit_session", "token_v2"]) {
    const idx = cookie.indexOf(tokenName + "=");
    if (idx === -1) continue;
    const start = idx + tokenName.length + 1;
    const end = cookie.indexOf(";", start);
    const value = end === -1 ? cookie.slice(start) : cookie.slice(start, end);
    try {
      const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
      if (payload.exp) {
        const daysLeft = Math.round((payload.exp * 1000 - Date.now()) / 86400000);
        if (daysLeft < minDaysLeft) minDaysLeft = daysLeft;
        found = true;
      }
    } catch (_) {}
  }
  if (found && minDaysLeft <= 7) {
    const today = new Date().toISOString().slice(0, 10);
    if (today === lastCookieWarnDate) return;
    lastCookieWarnDate = today;
    const msg = `Reddit cookie expires in ${minDaysLeft} day(s). Refresh it soon.`;
    console.warn(`!!! ${msg}`);
    notify(NTFY_URL, msg, { title: "CCT26 cookie expiring", priority: minDaysLeft <= 2 ? 5 : 4, tags: "warning", auth: NTFY_AUTH });
  }
}

function saveLastScrape() {
  const dir = path.join(ROOT, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "last_scrape.json"), JSON.stringify({ time: new Date().toISOString() }));
}

async function runSafe() {
  checkCookieExpiry(process.env.REDDIT_COOKIE);

  if (isRunning) {
    if (Date.now() - lastRunStart > 7200000) {
      console.warn("Forcing stale scrape reset — previous run stuck >2h");
      isRunning = false;
    } else {
      if (Date.now() - lastSkipLog > 600000) {
        console.log("Skipping scrape — previous run still in progress");
        lastSkipLog = Date.now();
      }
      return;
    }
  }
  isRunning = true;
  lastRunStart = Date.now();

  let summary;
  try {
    summary = await run();
    saveLastScrape();
  } catch (err) {
    console.error("Scrape run failed:", err.message);
    try { saveLastScrape(); } catch (e) { console.error("Failed to save last scrape:", e.message); }
    notify(NTFY_URL, `Scrape run failed: ${err.message}`, { title: "CCT26 error", priority: 4, tags: "warning", auth: NTFY_AUTH });
    isRunning = false;
    return;
  }

  isRunning = false;

  if (summary.processed > 0 || summary.failedCount > 0) {
    const lines = [
      `Scraped ${summary.scraped} comments`,
      `Skipped ${summary.skipped} unchanged`,
      `Processed ${summary.processed}`,
    ];
    if (summary.nullCount > 0) lines.push(`Not applicable ${summary.nullCount}`);
    if (summary.invalidCount > 0) lines.push(`Invalid ${summary.invalidCount}`);
    if (summary.failedCount > 0) lines.push(`Failed ${summary.failedCount}`);
    notify(NTFY_URL, lines.join(" · "), { title: "CCT26 scrape", priority: 3, auth: NTFY_AUTH });
  }
}

process.on("uncaughtException", async (err) => {
  console.error("Fatal:", err.message);
  await notify(NTFY_URL, err.message, { title: "CCT26 crashed", priority: 5, tags: "skull", auth: NTFY_AUTH });
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  const msg = reason?.message || String(reason);
  console.error("Fatal rejection:", msg);
  await notify(NTFY_URL, msg, { title: "CCT26 crashed", priority: 5, tags: "skull", auth: NTFY_AUTH });
  process.exit(1);
});

console.log(`Scrape interval: ${Math.round(INTERVAL_MS / 60000)} minutes`);
if (NTFY_URL) console.log("Notifications enabled");
runSafe();
setInterval(() => runSafe(), INTERVAL_MS);
