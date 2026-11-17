/*
 * SADIN on-prem inspection server (MVP)
 * -------------------------------------
 * Runs inside the organisation (a VM or the employee's own machine for the demo).
 * Nothing it receives is forwarded anywhere. No npm dependencies.
 *
 *   GET  /health               -> { ok, ocr }
 *   GET  /policy               -> policy JSON (policy.json next to this file, if present)
 *   POST /inspect/text         -> body: { text }            -> scan result (no values echoed)
 *   POST /inspect/image        -> body: raw image bytes      -> { action, categories, boxes[] }
 *   POST /inspect/file         -> body: raw PDF or .docx     -> { inspected, action, categories, reason }
 *   POST /events               -> body: event JSON           -> appended to events.jsonl
 *   GET  /events.cef           -> events as CEF lines for SIEM import
 *
 * Tamper resistance (see docs/TAMPER-RESISTANCE.md):
 *   POST /heartbeat            -> body: { device, user, version, installType, integrity }
 *   GET  /devices              -> device registry with the current state of each device
 *   GET  /alerts               -> administrator alerts, newest first
 *   GET  /alerts.cef           -> the same alerts as CEF lines
 *   GET  /uninstalled?device=&k= -> opened by the browser when the extension is removed
 *   GET  /admin                -> administrator page (devices and alerts)
 * Run "node server/integrity.js" after every extension release so heartbeats can be checked.
 *
 * Only the SADIN extension may call it from a browser (see access control below);
 * set SADIN_TOKEN in deployment.
 *
 * Requires: Node 18+, Tesseract 5 with the "ara" and "eng" language data.
 * Optional: ImageMagick "convert" (upscales small screenshots before OCR).
 * For /inspect/file: poppler-utils (pdfinfo, pdftotext, pdfimages, pdftoppm). See files.js.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const crypto = require("crypto");
const E = require("../extension/src/engine.js");
const F = require("./files.js");

const PORT = parseInt(process.env.SADIN_PORT || "8787", 10);
const HOST = process.env.SADIN_HOST || "127.0.0.1";
const LANGS = process.env.SADIN_OCR_LANGS || "ara+eng";
const EVENTS = path.join(__dirname, "events.jsonl");
const POLICY_FILE = path.join(__dirname, "policy.json");
const MAX_BODY = 25 * 1024 * 1024;
const DATA_DIR = process.env.SADIN_DATA_DIR || __dirname;      // devices.json and alerts.jsonl
const DEVICES_FILE = path.join(DATA_DIR, "devices.json");
const ALERTS_FILE = path.join(DATA_DIR, "alerts.jsonl");
const INTEGRITY_FILE = process.env.SADIN_INTEGRITY_FILE || path.join(__dirname, "integrity.json");
const ADMIN_PAGE = path.join(__dirname, "admin.html");
// a device that has not reported for this long is flagged (seconds, minimum 20)
const GRACE_S = Math.max(20, parseInt(process.env.SADIN_HEARTBEAT_GRACE_S || "180", 10) || 180);
// optional: every alert is also posted here as JSON (mail relay, Teams, SOAR)
const ALERT_WEBHOOK = process.env.SADIN_ALERT_WEBHOOK || "";

/*
 * Access control. Browsers attach an Origin header to cross-site requests, so a web page the
 * employee happens to visit cannot read the decision log or write fake events.
 *   SADIN_EXTENSION_IDS  comma-separated extension IDs allowed to call the server
 *                        (unset = any chrome-extension:// origin, convenient for the demo;
 *                        pin the real ID in deployment)
 *   SADIN_ALLOWED_ORIGINS extra web origins to allow (unset = none)
 *   SADIN_TOKEN          shared secret required in the X-SADIN-Token header on every endpoint
 *                        except /health (unset = not required; set it in deployment and push the
 *                        same value to the extension as the managed "serverToken" setting)
 */
const EXT_IDS = (process.env.SADIN_EXTENSION_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
const EXTRA_ORIGINS = (process.env.SADIN_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
const TOKEN = process.env.SADIN_TOKEN || "";

function originAllowed(origin) {
  if (!origin) return true;                              // not a browser page (curl, SIEM collector)
  if (EXTRA_ORIGINS.includes(origin)) return true;
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (!m) return false;
  return EXT_IDS.length === 0 || EXT_IDS.includes(m[1]);
}
// Without a token the service is in demo mode and must only answer on this machine. Checking
// the Host header stops a web page that re-points its own name at 127.0.0.1 (DNS rebinding):
// the browser would treat such requests as same-site and send no Origin header.
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
function hostAllowed(req) {
  return !!TOKEN || LOOPBACK.test(String(req.headers.host || ""));
}
function tokenOk(req) {
  if (!TOKEN) return true;
  const got = Buffer.from(String(req.headers["x-sadin-token"] || ""));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function loadPolicy() {
  try { return JSON.parse(fs.readFileSync(POLICY_FILE, "utf8")); } catch (e) { return null; }
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({ maxBuffer: 64 * 1024 * 1024 }, opts || {}), (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr })); else resolve(stdout);
    });
  });
}

let HAS_CONVERT = false;
run("convert", ["-version"]).then(() => { HAS_CONVERT = true; }).catch(() => {});

/* ---------- OCR ---------- */
async function ocr(buf, opts) {
  const id = crypto.randomBytes(6).toString("hex");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-"));
  const src = path.join(dir, id + ".img");
  fs.writeFileSync(src, buf);
  let input = src, scale = 1;
  try {
    if (HAS_CONVERT && !(opts && opts.upscale === false)) {
      // small UI text OCRs far better at 2x
      const up = path.join(dir, id + ".png");
      await run("convert", [src, "-resize", "200%", "-colorspace", "Gray", up]);
      input = up; scale = 2;
    }
    const tsv = await run("tesseract", [input, "stdout", "-l", LANGS, "--psm", "3", "-c", "tessedit_create_tsv=1"]);
    const words = parseTsv(tsv, scale);
    // Second pass: coloured ink (classification stamps, highlighted markings).
    // Page segmentation ignores boxed stamps, so each coloured region is cropped
    // and read on its own.
    try { words.push.apply(words, await colourPass(src, dir, id)); } catch (e) { /* optional pass */ }
    return { words: words };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // nothing is kept on disk
  }
}

async function colourPass(src, dir, id) {
  if (!HAS_CONVERT) return [];
  const mask = path.join(dir, id + "-sat.png");
  await run("convert", [src, "-colorspace", "HSL", "-channel", "G", "-separate", "+channel", "-threshold", "55%", mask]);
  const cc = await run("convert", [mask, "-define", "connected-components:verbose=true",
    "-define", "connected-components:area-threshold=300", "-connected-components", "8", "null:"]).catch(() => "");
  const out = [];
  const lines = String(cc).split("\n").slice(1);
  let idx = 0;
  for (const l of lines) {
    const m = l.match(/^\s*\d+:\s+(\d+)x(\d+)\+(\d+)\+(\d+)\s+[\d.,]+\s+(\d+)\s+(\S+)/);
    if (!m) continue;
    const w = +m[1], h = +m[2], x = +m[3], y = +m[4], area = +m[5], colour = m[6];
    if (!/gray\(255\)|white/i.test(colour)) continue;      // saturated pixels only
    if (h < 12 || w < 20 || h > 400 || area < 300) continue; // ignore noise and page-wide fills
    if (++idx > 12) break;                                   // bounded work per image
    const pad = 6;
    const crop = path.join(dir, id + "-c" + idx + ".png");
    await run("convert", [src, "-crop", `${w + 2 * pad}x${h + 2 * pad}+${Math.max(0, x - pad)}+${Math.max(0, y - pad)}`,
      "+repage", "-resize", "300%", "-colorspace", "Gray", crop]);
    // a short stamp is read twice: the mixed model and the Arabic-only model,
    // because the Latin model often wins on two or three Arabic words
    const langs = LANGS.indexOf("ara") >= 0 ? [LANGS, "ara"] : [LANGS];
    let k = 0;
    for (const lang of langs) {
      const txt = (await run("tesseract", [crop, "stdout", "-l", lang, "--psm", "7"]).catch(() => "")).trim();
      const clean = txt.replace(/[|_\\/\[\]{}]+/g, " ").replace(/\s+/g, " ").trim();
      if (clean.length < 2) continue;
      out.push({ line: "colour." + idx + "." + (k++), x: x, y: y, w: w, h: h, text: clean, conf: 60 });
    }
  }
  return out;
}

function parseTsv(tsv, scale) {
  const rows = tsv.split("\n").slice(1).map(l => l.split("\t"));
  const words = [];
  for (const r of rows) {
    if (r.length < 12 || r[0] !== "5") continue;
    const text = r[11];
    if (!text || !text.trim()) continue;
    words.push({
      line: r[2] + "." + r[3] + "." + r[4], // block.par.line
      x: Math.floor(+r[6] / scale), y: Math.floor(+r[7] / scale),
      w: Math.ceil(+r[8] / scale), h: Math.ceil(+r[9] / scale),
      text, conf: +r[10]
    });
  }
  return words;
}

/* ---------- Image inspection ---------- */
function inspectWords(words, policy) {
  policy = Object.assign({}, policy || {}, { ocrTolerant: true });   // images only
  // Rebuild lines, keeping each word's character span
  const lines = new Map();
  for (const w of words) {
    if (!lines.has(w.line)) lines.set(w.line, { text: "", spans: [] });
    const L = lines.get(w.line);
    if (L.text) L.text += " ";
    L.spans.push({ start: L.text.length, end: L.text.length + w.text.length, w });
    L.text += w.text;
  }
  const fullText = Array.from(lines.values()).map(l => l.text).join("\n");
  const whole = E.scan(fullText, policy);           // decides the action (e.g. classification stamp anywhere)
  const boxes = [];
  const cats = Object.assign({}, whole.categories);
  for (const L of lines.values()) {
    const r = E.scan(L.text, policy);
    for (const f of r.findings) {
      if (!f.redact) continue;
      for (const sp of L.spans) {
        if (sp.start < f.end && f.start < sp.end) {
          const pad = 3;
          boxes.push({ x: Math.max(0, sp.w.x - pad), y: Math.max(0, sp.w.y - pad), w: sp.w.w + 2 * pad, h: sp.w.h + 2 * pad, category: f.category });
        }
      }
    }
  }
  return { action: whole.action, categories: cats, boxes, ocrChars: fullText.length, _text: fullText };
}

/* ---------- Events (no content, only metadata) ---------- */
// strip control characters (CR, LF, tabs...) so one event can never become two log lines
const oneLine = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").slice(0, max);
const ACTIONS = ["allow", "redact", "warn", "block", "exception-request"];

function appendEvent(ev) {
  ev = ev && typeof ev === "object" ? ev : {};
  const categories = {};
  if (ev.categories && typeof ev.categories === "object") {
    for (const [k, v] of Object.entries(ev.categories).slice(0, 20)) {
      if (/^[A-Z_]{1,32}$/.test(k)) categories[k] = Math.max(0, Math.min(1e6, Number(v) || 0));
    }
  }
  const clean = {
    time: new Date().toISOString(),
    user: oneLine(ev.user || "unknown", 120),
    device: oneLine(ev.device, 120),
    tool: oneLine(ev.tool, 120),
    channel: oneLine(ev.channel, 40),
    action: ACTIONS.includes(ev.action) ? ev.action : "unknown",
    categories,
    placeholders: Math.max(0, Math.min(1e6, Number(ev.placeholders) || 0)),
    justification: ev.justification ? oneLine(ev.justification, 500) : undefined
  };
  fs.appendFileSync(EVENTS, JSON.stringify(clean) + "\n");
  return clean;
}

function toCef(e) {
  const sev = { block: 8, redact: 5, warn: 3, allow: 1 }[e.action] || 1;
  // CEF: header fields escape \\ and |, extension values escape \\ and =, newlines become \\n
  const hdr = v => oneLine(v, 64).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const esc = v => String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\r?\n|\r/g, "\\n").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
  const act = hdr(e.action);
  return `CEF:0|SADIN|SADIN Middleware|${hdr(E.DEFAULT_POLICY.version)}|AI-${act}|AI request ${act}|${sev}|rt=${Date.parse(e.time)} suser=${esc(e.user)} dhost=${esc(e.tool)} act=${esc(e.action)} cs1Label=categories cs1=${esc(Object.keys(e.categories || {}).join(","))} cs2Label=channel cs2=${esc(e.channel)} cn1Label=redactions cn1=${Number(e.placeholders) || 0}`;
}

/* ---------- Tamper resistance: device registry and administrator alerts ---------- */
const ALERT_TYPES = {
  "heartbeat-lost":        { severity: 8, text: "The device has stopped reporting. The browser may be closed or the device off, or the extension was disabled or removed. Check the device." },
  "heartbeat-restored":    { severity: 3, text: "The device is reporting again." },
  "not-force-installed":   { severity: 7, text: "The extension on this device was not installed by policy, so the user can switch it off." },
  "integrity-mismatch":    { severity: 9, text: "The extension's files on this device differ from the released version (edited or deleted)." },
  "extension-uninstalled": { severity: 9, text: "The browser reported that the extension was removed from this device." }
};
const INSTALL_TYPES = ["admin", "normal", "development", "sideload", "other"];

let devices = {};
try { devices = JSON.parse(fs.readFileSync(DEVICES_FILE, "utf8")); } catch (e) { devices = {}; }
function saveDevices() {
  try { fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 1)); } catch (e) { /* registry stays in memory */ }
}
// expected code fingerprint per extension version, written by "node server/integrity.js"
function expectedIntegrity(version) {
  try { return JSON.parse(fs.readFileSync(INTEGRITY_FILE, "utf8"))[version] || null; } catch (e) { return null; }
}
function stateOf(d) {
  return d.flags.uninstalled ? "uninstalled" : d.flags.lost ? "silent" : d.flags.integrity ? "modified" : d.flags.notForced ? "not-forced" : "ok";
}
function raiseAlert(type, d, detail) {
  const a = {
    time: new Date().toISOString(), type, severity: ALERT_TYPES[type].severity,
    device: d.device, user: d.user, text: ALERT_TYPES[type].text, detail: detail || undefined
  };
  try { fs.appendFileSync(ALERTS_FILE, JSON.stringify(a) + "\n"); } catch (e) { /* still printed below */ }
  console.log(`[alert] ${a.type} device=${a.device} user=${a.user}`);
  if (ALERT_WEBHOOK) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    fetch(ALERT_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a), signal: ctl.signal })
      .catch(e => console.log("[alert] webhook failed: " + (e.message || e)))
      .finally(() => clearTimeout(t));
  }
  return a;
}
function readAlerts() {
  if (!fs.existsSync(ALERTS_FILE)) return [];
  return fs.readFileSync(ALERTS_FILE, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)).reverse();
}
function heartbeat(hb) {
  hb = hb && typeof hb === "object" ? hb : {};
  const device = oneLine(hb.device, 120).trim();
  if (!device) return null;
  const d = devices[device] || (devices[device] = { device, firstSeen: new Date().toISOString(), flags: {} });
  d.user = oneLine(hb.user || "unknown", 120);
  d.version = /^[0-9.]{1,20}$/.test(String(hb.version)) ? String(hb.version) : "unknown";
  d.installType = INSTALL_TYPES.includes(hb.installType) ? hb.installType : "other";
  d.integrity = oneLine(hb.integrity, 64).replace(/[^0-9a-f]/g, "");
  d.browser = oneLine(hb.browser, 60);
  d.lastSeen = new Date().toISOString();
  d.beats = (d.beats || 0) + 1;
  if (d.flags.lost || d.flags.uninstalled) {
    d.flags.lost = false; d.flags.uninstalled = false;
    raiseAlert("heartbeat-restored", d);
  }
  if (d.installType !== "admin") {
    if (!d.flags.notForced) { d.flags.notForced = true; raiseAlert("not-force-installed", d, "install type: " + d.installType); }
  } else d.flags.notForced = false;
  const want = expectedIntegrity(d.version);
  d.integrityStatus = !want ? "unchecked" : want === d.integrity ? "ok" : "mismatch";
  if (d.integrityStatus === "mismatch") {
    if (!d.flags.integrity) { d.flags.integrity = true; raiseAlert("integrity-mismatch", d, "version " + d.version); }
  } else d.flags.integrity = false;
  saveDevices();
  return { ok: true, state: stateOf(d), integrity: d.integrityStatus, graceSeconds: GRACE_S };
}
// called on a timer: a registered device that has gone quiet is flagged once
function sweep(now) {
  now = now || Date.now();
  let changed = false;
  for (const d of Object.values(devices)) {
    if (d.flags.lost || d.flags.uninstalled || !d.lastSeen) continue;
    const quiet = Math.round((now - Date.parse(d.lastSeen)) / 1000);
    if (quiet > GRACE_S) { d.flags.lost = true; changed = true; raiseAlert("heartbeat-lost", d, "no heartbeat for " + quiet + " s"); }
  }
  if (changed) saveDevices();
}
// The uninstall address cannot carry the token header, so it carries a key derived from it.
function uninstallKey(device) {
  return crypto.createHash("sha256").update(TOKEN + "|" + device).digest("hex").slice(0, 16);
}
function uninstalled(device, k) {
  device = oneLine(device, 120).trim();
  const d = devices[device];
  if (!d || String(k) !== uninstallKey(device)) return false;
  if (!d.flags.uninstalled) { d.flags.uninstalled = true; raiseAlert("extension-uninstalled", d); saveDevices(); }
  return true;
}
function alertToCef(a) {
  const hdr = v => oneLine(v, 64).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const esc = v => oneLine(v, 500).replace(/\\/g, "\\\\").replace(/=/g, "\\=");
  return `CEF:0|SADIN|SADIN Middleware|${hdr(E.DEFAULT_POLICY.version)}|TAMPER-${hdr(a.type)}|${hdr(a.type)}|${Number(a.severity) || 1}|rt=${Date.parse(a.time)} suser=${esc(a.user)} shost=${esc(a.device)} msg=${esc(a.text)}`;
}

/* ---------- HTTP ---------- */
function send(res, code, obj, type) {
  const body = type ? obj : JSON.stringify(obj);
  const headers = {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin"
  };
  const origin = res.req && res.req.headers.origin;
  if (origin && originAllowed(origin)) {             // never "*": only the extension (or listed origins)
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-SADIN-Token";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!originAllowed(req.headers.origin)) return send(res, 403, { error: "origin not allowed" });
    if (!hostAllowed(req)) return send(res, 403, { error: "host not allowed without SADIN_TOKEN" });
    if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
    const url = req.url.split("?")[0];
    // the admin page itself holds no data (it asks for the token and then calls /devices and /alerts)
    if (req.method === "GET" && url === "/admin") {
      return send(res, 200, fs.readFileSync(ADMIN_PAGE, "utf8"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url === "/uninstalled") {
      const q = new URL(req.url, "http://x").searchParams;
      uninstalled(q.get("device") || "", q.get("k") || "");
      return send(res, 200, "SADIN was removed from this browser. Your administrator has been notified.\n", "text/plain; charset=utf-8");
    }
    if (url !== "/health" && !tokenOk(req)) return send(res, 401, { error: "missing or wrong X-SADIN-Token" });
    if (req.method === "POST" && url === "/heartbeat") {
      const r = heartbeat(JSON.parse((await readBody(req)).toString("utf8") || "{}"));
      return r ? send(res, 200, r) : send(res, 400, { error: "device is required" });
    }
    if (req.method === "GET" && url === "/devices") {
      return send(res, 200, Object.values(devices).map(d => Object.assign({}, d, { state: stateOf(d), flags: undefined })));
    }
    if (req.method === "GET" && url === "/alerts") return send(res, 200, readAlerts());
    if (req.method === "GET" && url === "/alerts.cef") {
      return send(res, 200, readAlerts().reverse().map(alertToCef).join("\n") + "\n", "text/plain; charset=utf-8");
    }
    if (req.method === "GET" && url === "/health") return send(res, 200, { ok: true, ocr: LANGS, engine: E.DEFAULT_POLICY.version });
    if (req.method === "GET" && url === "/policy") return send(res, 200, loadPolicy() || E.DEFAULT_POLICY);
    if (req.method === "POST" && url === "/inspect/text") {
      const { text } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const r = E.scan(String(text || ""), loadPolicy());
      return send(res, 200, { action: r.action, categories: r.categories, redactedText: r.redactedText, placeholders: r.placeholders, ms: r.ms });
    }
    if (req.method === "POST" && url === "/inspect/image") {
      const t0 = Date.now();
      const buf = await readBody(req);
      if (!buf.length) return send(res, 400, { error: "empty body" });
      const { words } = await ocr(buf);
      const r = inspectWords(words, loadPolicy());
      delete r._text;                       // never echo recognised text
      r.ms = Date.now() - t0;
      return send(res, 200, r);
    }
    if (req.method === "POST" && url === "/inspect/file") {
      const buf = await readBody(req);
      if (!buf.length) return send(res, 400, { error: "empty body" });
      // extracted text is never returned: only the decision, the categories and counters
      return send(res, 200, await F.inspectFile(buf, loadPolicy(), { ocr, inspectWords }));
    }
    if (req.method === "POST" && url === "/events") {
      const ev = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return send(res, 200, appendEvent(ev));
    }
    if (req.method === "GET" && url === "/events.cef") {
      const lines = fs.existsSync(EVENTS) ? fs.readFileSync(EVENTS, "utf8").trim().split("\n").filter(Boolean).map(l => toCef(JSON.parse(l))) : [];
      return send(res, 200, lines.join("\n") + "\n", "text/plain; charset=utf-8");
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

if (require.main === module) {
  if (!TOKEN && !/^(127\.0\.0\.1|localhost|::1)$/i.test(HOST)) {
    console.error("SADIN_TOKEN is required when the service listens on a network address (SADIN_HOST=" + HOST + ").");
    process.exit(1);
  }
  server.listen(PORT, HOST, () => console.log(`SADIN inspection server on http://${HOST}:${PORT}  (OCR: ${LANGS})`));
  setInterval(sweep, Math.min(10000, GRACE_S * 250)).unref();   // heartbeat watchdog
}
module.exports = { ocr, inspectWords, server, heartbeat, sweep };
