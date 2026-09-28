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
 *   POST /events               -> body: event JSON           -> appended to events.jsonl
 *   GET  /events.cef           -> events as CEF lines for SIEM import
 *
 * Only the SADIN extension may call it from a browser (see access control below);
 * set SADIN_TOKEN in deployment.
 *
 * Requires: Node 18+, Tesseract 5 with the "ara" and "eng" language data.
 * Optional: ImageMagick "convert" (upscales small screenshots before OCR).
 */
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const crypto = require("crypto");
const E = require("../extension/src/engine.js");

const PORT = parseInt(process.env.SADIN_PORT || "8787", 10);
const HOST = process.env.SADIN_HOST || "127.0.0.1";
const LANGS = process.env.SADIN_OCR_LANGS || "ara+eng";
const EVENTS = path.join(__dirname, "events.jsonl");
const POLICY_FILE = path.join(__dirname, "policy.json");
const MAX_BODY = 25 * 1024 * 1024;

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
async function ocr(buf) {
  const id = crypto.randomBytes(6).toString("hex");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-"));
  const src = path.join(dir, id + ".img");
  fs.writeFileSync(src, buf);
  let input = src, scale = 1;
  try {
    if (HAS_CONVERT) {
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
    if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
    const url = req.url.split("?")[0];
    if (url !== "/health" && !tokenOk(req)) return send(res, 401, { error: "missing or wrong X-SADIN-Token" });
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
  server.listen(PORT, HOST, () => console.log(`SADIN inspection server on http://${HOST}:${PORT}  (OCR: ${LANGS})`));
}
module.exports = { ocr, inspectWords, server };
