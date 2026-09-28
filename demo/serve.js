// Serves the local test page on http://localhost:8788
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = parseInt(process.env.SADIN_DEMO_PORT || "8788", 10);
http.createServer((req, res) => {
  const f = path.join(__dirname, "index.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log("SADIN test page on http://localhost:" + PORT));
