// Server-side test for the tamper endpoints. No browser: it starts the inspection server with a
// short grace period, plays the part of the extension with plain HTTP calls, and checks the
// alerts, the access rules and the webhook. Run: node eval/tamper/server-test.js
"use strict";
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../..");
const { fingerprint } = require(path.join(ROOT, "server/integrity.js"));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "extension/manifest.json"), "utf8")).version;
const GOOD = fingerprint(path.join(ROOT, "extension"));
const PORT = 18787, HOOK_PORT = 18789, TOKEN = "test-" + crypto.randomBytes(8).toString("hex"), GRACE = 20;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
function check(n, what, ok, observed) {
  rows.push({ n, check: what, result: ok ? "PASS" : "FAIL", observed });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n} ${what} -> ${observed}`);
}
async function call(method, p, body, headers) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ "X-SADIN-Token": TOKEN }, body ? { "Content-Type": "application/json" } : {}, headers || {}), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text };
}
const alerts = async (type, device) => (await call("GET", "/alerts")).json.filter(a => (!type || a.type === type) && (!device || a.device === device));
const state = async device => ((await call("GET", "/devices")).json.find(d => d.device === device) || {}).state;
const beat = (device, over) => call("POST", "/heartbeat", Object.assign({ device, user: "employee@corp.example.sa", version: VERSION, installType: "admin", integrity: GOOD, browser: "Chrome 153" }, over || {}));

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-tamper-"));
  const integrityFile = path.join(data, "integrity.json");
  fs.writeFileSync(integrityFile, JSON.stringify({ [VERSION]: GOOD }));
  const hooked = [];
  const hook = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { hooked.push(JSON.parse(b)); } catch (e) {} res.end("ok"); }); });
  await new Promise(r => hook.listen(HOOK_PORT, "127.0.0.1", r));
  const srv = spawn(process.execPath, [path.join(ROOT, "server/server.js")], {
    env: Object.assign({}, process.env, { SADIN_PORT: String(PORT), SADIN_TOKEN: TOKEN, SADIN_HEARTBEAT_GRACE_S: String(GRACE), SADIN_DATA_DIR: data, SADIN_INTEGRITY_FILE: integrityFile, SADIN_ALERT_WEBHOOK: `http://127.0.0.1:${HOOK_PORT}/hook` }),
    stdio: "ignore"
  });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + "/health")).ok) break; } catch (e) {} await sleep(100); }

    // access rules
    let r = await fetch(BASE + "/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: "X" }) });
    check("S1", "heartbeat without the token is refused", r.status === 401, "HTTP " + r.status);
    r = await fetch(BASE + "/alerts"); check("S2", "alerts without the token are refused", r.status === 401, "HTTP " + r.status);
    r = await fetch(BASE + "/devices", { headers: { "X-SADIN-Token": TOKEN, Origin: "https://evil.example" } });
    check("S3", "a web page cannot read the device registry", r.status === 403, "HTTP " + r.status);
    r = await call("POST", "/heartbeat", { user: "x" }); check("S4", "heartbeat without a device name is rejected", r.status === 400, "HTTP " + r.status);

    // healthy device
    r = await beat("PC-OK");
    check("S5", "healthy force-installed device is registered with no alert", r.json.state === "ok" && r.json.integrity === "ok" && (await alerts(null, "PC-OK")).length === 0, `state ${r.json.state}, files ${r.json.integrity}, alerts ${(await alerts(null, "PC-OK")).length}`);

    // installed by hand
    r = await beat("PC-MANUAL", { installType: "normal" });
    let a = await alerts("not-force-installed", "PC-MANUAL");
    check("S6", "extension not installed by policy raises not-force-installed", a.length === 1 && r.json.state === "not-forced", `alerts ${a.length}, state ${r.json.state}`);
    await beat("PC-MANUAL", { installType: "normal" });
    check("S7", "the same condition is not alerted twice", (await alerts("not-force-installed", "PC-MANUAL")).length === 1, `alerts ${(await alerts("not-force-installed", "PC-MANUAL")).length}`);

    // edited files
    r = await beat("PC-EDITED", { integrity: "0".repeat(64) });
    a = await alerts("integrity-mismatch", "PC-EDITED");
    check("S8", "wrong file fingerprint raises integrity-mismatch", a.length === 1 && r.json.state === "modified", `alerts ${a.length}, state ${r.json.state}`);
    r = await beat("PC-EDITED");
    check("S9", "state returns to ok when the fingerprint is right again", r.json.state === "ok", `state ${r.json.state}`);
    r = await beat("PC-OLD", { version: "0.0.1" });
    check("S10", "a version with no recorded fingerprint is marked unchecked, not alerted", r.json.integrity === "unchecked" && (await alerts("integrity-mismatch", "PC-OLD")).length === 0, `files ${r.json.integrity}`);

    // silence
    await beat("PC-QUIET");
    const t0 = Date.now();
    let lost = [];
    while (Date.now() - t0 < (GRACE + 25) * 1000) { lost = await alerts("heartbeat-lost", "PC-QUIET"); if (lost.length) break; await sleep(1000); }
    const waited = Math.round((Date.now() - t0) / 1000);
    check("S11", `silent device raises heartbeat-lost (grace ${GRACE} s)`, lost.length === 1 && waited >= GRACE && (await state("PC-QUIET")) === "silent", `alert after ${waited} s, state ${await state("PC-QUIET")}`);
    r = await beat("PC-QUIET");
    check("S12", "next heartbeat raises heartbeat-restored", (await alerts("heartbeat-restored", "PC-QUIET")).length === 1 && r.json.state === "ok", `alerts ${(await alerts("heartbeat-restored", "PC-QUIET")).length}, state ${r.json.state}`);

    // uninstall address
    await beat("PC-GONE");
    await fetch(BASE + "/uninstalled?device=PC-GONE&k=0000000000000000");
    check("S13", "uninstall address with a wrong key is ignored", (await alerts("extension-uninstalled", "PC-GONE")).length === 0, `alerts ${(await alerts("extension-uninstalled", "PC-GONE")).length}`);
    const k = crypto.createHash("sha256").update(TOKEN + "|PC-GONE").digest("hex").slice(0, 16);
    await fetch(BASE + "/uninstalled?device=PC-GONE&k=" + k);
    check("S14", "uninstall address with the right key raises extension-uninstalled", (await alerts("extension-uninstalled", "PC-GONE")).length === 1 && (await state("PC-GONE")) === "uninstalled", `alerts ${(await alerts("extension-uninstalled", "PC-GONE")).length}, state ${await state("PC-GONE")}`);

    // log forging, CEF, admin page, webhook
    await beat("PC-A\nPC-FAKE", { user: "a@b.sa\n{\"type\":\"fake\"}", installType: "normal" });
    const raw = fs.readFileSync(path.join(data, "alerts.jsonl"), "utf8").trim().split("\n");
    let parsed = true; try { raw.forEach(l => JSON.parse(l)); } catch (e) { parsed = false; }
    check("S15", "line breaks in a device or user name cannot forge an alert line", parsed && raw.length === (await alerts()).length && !(await alerts()).some(x => x.type === "fake"), `${raw.length} lines, ${(await alerts()).length} alerts`);
    r = await call("GET", "/alerts.cef");
    const cef = r.text.trim().split("\n");
    check("S16", "alerts export as CEF, one line each", cef.length === raw.length && cef.every(l => /^CEF:0\|SADIN\|SADIN Middleware\|[\d.]+\|TAMPER-[a-z-]+\|/.test(l)), `${cef.length} CEF lines`);
    r = await fetch(BASE + "/admin"); const html = await r.text();
    check("S17", "admin page is served and holds no data itself", r.status === 200 && /SADIN administrator/.test(html) && !html.includes("PC-OK"), "HTTP " + r.status);
    await sleep(500);
    const total = (await alerts()).length;
    check("S18", "every alert was posted to the webhook", hooked.length === total && hooked.every(h => h.type && h.device && h.time), `${hooked.length} of ${total} alerts received`);
    // registry survives a restart
    check("S19", "device registry is written to disk", Object.keys(JSON.parse(fs.readFileSync(path.join(data, "devices.json"), "utf8"))).length >= 6, `${Object.keys(JSON.parse(fs.readFileSync(path.join(data, "devices.json"), "utf8"))).length} devices`);
  } finally {
    srv.kill(); hook.close(); fs.rmSync(data, { recursive: true, force: true });
  }
  const pass = rows.filter(x => x.result === "PASS").length;
  const res = { date: new Date().toISOString(), extensionVersion: VERSION, graceSeconds: GRACE, passed: pass, total: rows.length, rows };
  fs.writeFileSync(path.join(ROOT, "eval/results-tamper-server.json"), JSON.stringify(res, null, 1) + "\n");
  console.log(`\n${pass} of ${rows.length} checks passed`);
  process.exit(pass === rows.length ? 0 : 1);
})();
