require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { run } = require("./scrape");

const PORT = parseInt(process.env.PORT, 10) || 3000;
const INTERVAL_MS = parseInt(process.env.SCRAPE_INTERVAL_MS, 10) || 3600000;

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
    serveFile(path.join(process.cwd(), url.replace(/^\//, "")), res);
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

let isRunning = false;

async function runSafe() {
  if (isRunning) {
    console.log(`Skipping scrape — previous run still in progress`);
    return;
  }
  isRunning = true;
  try {
    await run();
  } catch (err) {
    console.error("Scrape run failed:", err);
  } finally {
    isRunning = false;
  }
}

console.log(`Scrape interval: ${Math.round(INTERVAL_MS / 60000)} minutes`);
runSafe();
setInterval(runSafe, INTERVAL_MS);
