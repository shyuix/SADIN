// Checks two start-up and access rules of the inspection service that apply when no token is set.
// Run: node eval/server-hardening-test.js   (uses port 18791)
"use strict";
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const os = require("os"), fs = require("fs"), path = require("path");
const SERVER = path.resolve(__dirname, "../server/server.js");
const PORT = 18791;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
const check = (n, what, ok, observed) => { rows.push({ n, check: what, result: ok ? "PASS" : "FAIL", observed }); console.log(`[${ok ? "PASS" : "FAIL"}] ${n} ${what} -> ${observed}`); };
// plain http so the Host header can be set freely
const get = (p, host) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method: "GET", headers: { Host: host } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
  req.on("error", reject); req.end();
});
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-hard-"));
  const env = Object.assign({}, process.env, { SADIN_PORT: String(PORT), SADIN_DATA_DIR: data });
  delete env.SADIN_TOKEN;
  const r = spawnSync(process.execPath, [SERVER], { env: Object.assign({}, env, { SADIN_HOST: "0.0.0.0" }), timeout: 5000 });
  check("H1", "refuses to start on a network address without a token", r.status === 1, "exit code " + r.status);
  const srv = spawn(process.execPath, [SERVER], { env, stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await get("/health", "127.0.0.1:" + PORT)) === 200) break; } catch (e) {} await sleep(100); }
    check("H2", "answers on this machine's own name without a token (demo mode)", (await get("/devices", "localhost:" + PORT)) === 200, "HTTP " + (await get("/devices", "localhost:" + PORT)));
    const s = await get("/events.cef", "attacker.example:" + PORT);
    check("H3", "refuses a request that arrives under another host name (DNS rebinding)", s === 403, "HTTP " + s);
  } finally { srv.kill(); fs.rmSync(data, { recursive: true, force: true }); }
  const pass = rows.filter(x => x.result === "PASS").length;
  console.log(`\n${pass} of ${rows.length} checks passed`);
  process.exit(pass === rows.length ? 0 : 1);
})();
