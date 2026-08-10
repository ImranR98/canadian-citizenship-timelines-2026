require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { run } = require("./scrape");
const { send: notify } = require("./notify");

const PORT = parseInt(process.env.PORT, 10) || 3000;
const INTERVAL_MS = (parseFloat(process.env.SCRAPE_INTERVAL_HOURS) || 1) * 3600000;
const NTFY_URL = process.env.NTFY_URL;
const NTFY_AUTH = process.env.NTFY_AUTH;

const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/") {
    serveFile(path.join(process.cwd(), "index.html"), res);
  } else if (url.startsWith("/data/")) {
    serveFile(path.join(process.cwd(), url), res);
  } else {
    const p = path.join(process.cwd(), url.replace(/^\//, ""));
    if (fs.existsSync(p)) {
      serveFile(p, res);
    } else if (fs.existsSync(p + ".html")) {
      serveFile(p + ".html", res);
    } else {
      serveFile(p, res);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  notify(NTFY_URL, `Server started on port ${PORT}`, { title: "CCT26 started", priority: 3, auth: NTFY_AUTH });
});

let isRunning = false;

async function runSafe() {
  if (isRunning) {
    console.log("Skipping scrape — previous run still in progress");
    return;
  }
  isRunning = true;

  let summary;
  try {
    summary = await run();
  } catch (err) {
    console.error("Scrape run failed:", err);
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

process.on("uncaughtException", (err) => {
  console.error("Fatal:", err);
  notify(NTFY_URL, err.message, { title: "CCT26 crashed", priority: 5, tags: "skull", auth: NTFY_AUTH });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Fatal rejection:", reason);
  notify(NTFY_URL, reason?.message || String(reason), { title: "CCT26 crashed", priority: 5, tags: "skull", auth: NTFY_AUTH });
  process.exit(1);
});

console.log(`Scrape interval: ${Math.round(INTERVAL_MS / 60000)} minutes`);
if (NTFY_URL) console.log(`Notifications: ${NTFY_URL}`);
runSafe();
setInterval(() => runSafe(), INTERVAL_MS);
