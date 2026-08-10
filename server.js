const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const mime = {
  ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png"
};

http.createServer((req, res) => {
  let filePath;

  if (req.url.startsWith("/data/")) {
    filePath = path.join(process.cwd(), req.url);
  } else if (req.url === "/") {
    filePath = path.join(process.cwd(), "ui", "index.html");
  } else {
    filePath = path.join(process.cwd(), "ui", req.url);
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
