/*
 * SADIN file inspection (PDF and Word .docx)
 * ------------------------------------------
 * Pulls the text out of a document and hands it to the same detection engine the extension
 * uses. Nothing is kept: temp files are deleted, extracted text is never returned.
 *
 * What is read
 *   PDF   text layer (pdftotext), form-field values, comments and sticky notes, link targets
 *         and document properties (qpdf); pages that carry images, and PDFs with no text
 *         layer at all, are rendered and read with OCR.
 *   docx  body, tables, text boxes, headers, footers, footnotes, endnotes, comments, tracked
 *         deletions, field instructions, external hyperlink targets, document properties,
 *         chart and diagram labels, and embedded pictures (OCR). Parts are allow-listed: a
 *         part that is not known to be read or harmless holds the whole file back.
 *
 * Fail closed. Anything that cannot be fully read is reported as { inspected: false } and the
 * extension applies the organisation's `uninspectableFiles` policy (block by default):
 * encrypted or damaged files, other formats, documents over the limits below, attachments and
 * embedded objects, macros, and picture formats OCR cannot read.
 *
 * Sensitivity labels. A label the organisation put on the document (Microsoft Purview metadata
 * or a plain classification property) is read first and decides on its own: see labels.js.
 *
 * A document cannot be redacted in place yet, so a file that holds something the engine would
 * redact in text is blocked as a whole, with the categories that were found.
 *
 * No npm dependencies. Requires poppler-utils (pdfinfo, pdftotext, pdfimages, pdftoppm) and qpdf.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFile } = require("child_process");
const E = require("../extension/src/engine.js");
const L = require("./labels.js");

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const LIMITS = {
  pdfPages: num(process.env.SADIN_MAX_PDF_PAGES, 60),        // more pages than this: not inspected
  ocrPages: num(process.env.SADIN_MAX_OCR_PAGES, 8),         // PDF pages rendered for OCR per file
  docxImages: num(process.env.SADIN_MAX_DOCX_IMAGES, 8),     // embedded pictures read per file
  zipEntries: 2000,
  zipBytes: 96 * 1024 * 1024,                                // total uncompressed size read from a docx
  minImagePx: 48,                                            // PDF images smaller than this on either side are skipped
  ocrDpi: 200,
  toolTimeoutMs: 60000
};
const RANK = { allow: 0, warn: 1, redact: 2, block: 3 };

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({ maxBuffer: 128 * 1024 * 1024, timeout: LIMITS.toolTimeoutMs }, opts || {}), (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr || "") })); else resolve(stdout);
    });
  });
}
const no = (kind, reason, extra) => Object.assign({ inspected: false, kind, reason }, extra || {});

/* ---------- type sniffing: by content, never by file name ---------- */
function sniff(buf) {
  if (buf.length >= 5 && buf.subarray(0, 1024).indexOf("%PDF-") >= 0) return "pdf";
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return "zip";
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xD0CF11E0) return "ole";   // legacy .doc/.xls, or a password-protected Office file
  return "other";
}

/* ---------- minimal ZIP reader (store + deflate), with size limits ---------- */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: no directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error("zip: zip64");
  if (count > LIMITS.zipEntries) throw new Error("zip: too many entries");
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: bad directory");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    entries.set(name, { name, flags, method, csize, usize, lho });
    p += 46 + nlen + xlen + clen;
  }
  let budget = LIMITS.zipBytes;
  function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Error("zip: encrypted entry");
    if (e.lho + 30 > buf.length || buf.readUInt32LE(e.lho) !== 0x04034b50) throw new Error("zip: bad entry");
    const start = e.lho + 30 + buf.readUInt16LE(e.lho + 26) + buf.readUInt16LE(e.lho + 28);
    const data = buf.subarray(start, start + e.csize);
    let out;
    if (e.method === 0) out = data;
    else if (e.method === 8) out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, budget) });
    else throw new Error("zip: unsupported compression");
    budget -= out.length;
    if (budget < 0) throw new Error("zip: too large");
    return out;
  }
  return { names: Array.from(entries.keys()), read };
}

/* ---------- WordprocessingML -> text ---------- */
function xmlText(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g === "amp") return "&"; if (g === "lt") return "<"; if (g === "gt") return ">";
    if (g === "quot") return '"'; if (g === "apos") return "'";
    const cp = g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch (e) { return " "; }
  });
}
function wordXmlToText(xml) {
  const attrs = [];
  xml.replace(/\bw:instr="([^"]*)"/g, (m, v) => { attrs.push(xmlText(v)); return m; });   // simple fields, e.g. HYPERLINK "..."
  const body = xml
    .replace(/<w:(?:tab|ptab)\b[^>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<w:noBreakHyphen\b[^>]*\/>/g, "-")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:(?:p|tr)>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return xmlText(body) + (attrs.length ? "\n" + attrs.join("\n") : "");
}
function propsToText(xml) {
  return xmlText(xml.replace(/<\/[^>]+>/g, "\n").replace(/<[^>]+>/g, ""));
}
function externalTargets(xml) {
  const out = [];
  xml.replace(/<Relationship\b[^>]*>/g, (tag) => {
    if (!/TargetMode="External"/.test(tag)) return tag;
    const t = /\bTarget="([^"]*)"/.exec(tag);
    if (t) { let v = xmlText(t[1]); try { v = decodeURI(v); } catch (e) {} out.push(v); }
    return tag;
  });
  return out.join("\n");
}

const DOC_PART = /^word\/(?:glossary\/)?(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const REL_PART = /^word\/(?:glossary\/)?_rels\/[^/]+\.rels$/;
// parts whose text nodes are read as they are: properties, chart and diagram labels, content-control data
const PROP_PART = /^(?:docProps\/(?:core|custom|app)\.xml|word\/(?:charts|diagrams)\/[^/]+\.xml|customXml\/item\d+\.xml)$/;
const MEDIA_PART = /^word\/media\/[^/]+$/;
// parts that carry formatting or bookkeeping, not content
const INERT_PART = /^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/thumbnail\.\w+|docMetadata\/LabelInfo\d*\.xml|customXml\/(?:itemProps\d+\.xml|_rels\/[^/]+\.rels)|word\/(?:glossary\/)?(?:styles|stylesWithEffects|settings|webSettings|fontTable|numbering|people|commentsExtended|commentsIds|commentsExtensible)\.xml|word\/theme\/[^/]+\.xml|word\/(?:charts|diagrams)\/_rels\/[^/]+\.rels|word\/(?:charts|diagrams)\/(?:style|colors)\d*\.xml)$/;
const OCR_IMAGE = /\.(png|jpe?g|gif|bmp|tiff?)$/i;

async function inspectDocx(buf, policy, deps) {
  let zip;
  try { zip = readZip(buf); } catch (e) { return no("zip", "damaged"); }
  if (!zip.names.includes("word/document.xml")) return no("zip", "unsupported-type");   // xlsx, pptx, plain archives...
  if (zip.names.some(n => /vbaProject\.bin$/i.test(n))) return no("docx", "macros");
  if (zip.names.some(n => /^word\/embeddings\//.test(n))) return no("docx", "embedded-object");
  // allow-list: a part this code does not know how to read is a reason to hold the file back
  const files = zip.names.filter(n => !n.endsWith("/"));
  if (files.some(n => !(DOC_PART.test(n) || REL_PART.test(n) || PROP_PART.test(n) || MEDIA_PART.test(n) || INERT_PART.test(n)))) return no("docx", "unknown-part");
  const media = files.filter(n => MEDIA_PART.test(n));
  if (media.some(n => !OCR_IMAGE.test(n))) return no("docx", "unreadable-picture");     // EMF/WMF/SVG: OCR cannot read them
  if (media.length > LIMITS.docxImages) return no("docx", "too-many-pictures");

  const parts = [];
  let label;
  try {
    label = L.decide(L.docxLabels(zip.read, files, L.config(policy)), L.config(policy));
    for (const n of zip.names) {
      if (DOC_PART.test(n)) parts.push(wordXmlToText(zip.read(n).toString("utf8")));
      else if (REL_PART.test(n)) parts.push(externalTargets(zip.read(n).toString("utf8")));
      else if (n === "docProps/custom.xml") parts.push(propsToText(L.stripLabelProperties(zip.read(n).toString("utf8"))));
      else if (PROP_PART.test(n)) parts.push(propsToText(zip.read(n).toString("utf8")));
    }
  } catch (e) { return no("docx", "damaged"); }
  const text = parts.join("\n");
  const scans = [E.scan(text, policy)];
  let ocrImages = 0;
  try {
    for (const n of media) {
      const { words } = await deps.ocr(zip.read(n));
      scans.push(deps.inspectWords(words, policy));
      ocrImages++;
    }
  } catch (e) { return no("docx", "ocr-failed"); }
  return verdict("docx", scans, { chars: text.length, ocrImages }, label);
}

/* ---------- PDF ---------- */
// pdftotext wraps direction runs in bidi control characters, and when Arabic sits in a
// left-to-right paragraph it can emit a trailing Latin run ("... : P@ss") before the Arabic
// label it belongs to. The text is scanned in both orders so "label then value" still matches.
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const FORMS = /[\ufb00-\ufb06\ufb50-\ufdff\ufe70-\ufeff]/g;      // Latin ligatures, Arabic presentation forms
function pdfTextVariants(raw) {
  raw = raw.replace(/\f/g, "\n").replace(FORMS, c => c === "\ufeff" ? "" : c.normalize("NFKC"));
  const clean = t => t.replace(BIDI, " ").replace(/[ \t]{2,}/g, " ");
  const a = clean(raw);
  const moved = raw.split("\n").map(l => {
    const m = /^(\u202b)\u202a([^\u202c]*)\u202c(.+)$/.exec(l);
    return m ? m[1] + m[3] + " " + m[2] : l;
  }).join("\n");
  const b = clean(moved);
  // pdftotext can emit the two letters of the lam-alef ligature in swapped order, so
  // "الاختراق" arrives as "االختراق" and "للأمن" as "لألمن". Undo that after the definite
  // article (also behind a one-letter prefix); scanned as an extra reading, never instead.
  const AR = "\u0621-\u064a";
  const lig1 = new RegExp("(^|[^" + AR + "])([\u0648\u0641\u0628\u0643]?)\u0627([\u0627\u0623\u0625\u0622])\u0644(?=[" + AR + "])", "gm");
  const lig2 = new RegExp("(^|[^" + AR + "])([\u0648\u0641\u0628\u0643]?)\u0644([\u0627\u0623\u0625\u0622])\u0644(?=[" + AR + "])", "gm");
  const fix = t => t.replace(lig1, "$1$2\u0627\u0644$3").replace(lig2, "$1$2\u0644\u0644$3");
  return Array.from(new Set([a, b, fix(a), fix(b)]));
}
// Strings that live outside the page text: annotation and form-field contents, link targets,
// document properties. Also reports attachments, which are not inspected.
const PDF_STRING_KEYS = new Set(["/Contents", "/RC", "/V", "/DV", "/TU", "/URI", "/Title", "/Subject", "/Keywords"]);
async function pdfObjectStrings(src) {
  const json = await new Promise((resolve, reject) => {
    execFile("qpdf", ["--json=2", "--json-key=qpdf", "--json-key=attachments", src], { maxBuffer: 256 * 1024 * 1024, timeout: LIMITS.toolTimeoutMs }, (err, stdout) => {
      if (err && !(err.code === 3 && stdout)) reject(err); else resolve(stdout);   // exit code 3: warnings only
    });
  });
  const d = JSON.parse(json);
  const out = [];
  (function walk(v, key) {
    if (typeof v === "string") { if (PDF_STRING_KEYS.has(key) && v.startsWith("u:")) out.push(v.slice(2).replace(/<[^>]+>/g, " ")); }
    else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], k);
  })(d.qpdf && d.qpdf[1]);
  // document information dictionary, for sensitivity labels
  const objs = (d.qpdf && d.qpdf[1]) || {};
  const ref = objs.trailer && objs.trailer.value && objs.trailer.value["/Info"];
  const infoObj = typeof ref === "string" ? objs["obj:" + ref] : null;
  const info = infoObj && infoObj.value && typeof infoObj.value === "object" ? infoObj.value : (ref && typeof ref === "object" ? ref : {});
  return { strings: out.join("\n"), attachments: Object.keys(d.attachments || {}).length, info };
}

function scanVariants(texts, policy) {
  let best = null;
  const categories = {};
  for (const t of texts) {
    const r = E.scan(t, policy);
    if (!best || RANK[r.action] > RANK[best.action]) best = r;
    for (const k of Object.keys(r.categories || {})) categories[k] = Math.max(categories[k] || 0, r.categories[k]);
  }
  return { action: best.action, categories };
}

async function inspectPdf(buf, policy, deps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-file-"));
  const src = path.join(dir, "in.pdf");
  try {
    fs.writeFileSync(src, buf);
    let info;
    try { info = await run("pdfinfo", [src]); }
    catch (e) { return no("pdf", /password/i.test(e.stderr) ? "encrypted" : "damaged"); }
    if (/^Encrypted:\s+yes/m.test(info)) return no("pdf", "encrypted");
    const pages = parseInt((/^Pages:\s+(\d+)/m.exec(info) || [])[1] || "0", 10);
    if (!pages) return no("pdf", "damaged");
    if (pages > LIMITS.pdfPages) return no("pdf", "too-many-pages", { pages });

    let text, list, objs;
    try {
      text = await run("pdftotext", ["-enc", "UTF-8", src, "-"]);
      list = await run("pdfimages", ["-list", src]);
      objs = await pdfObjectStrings(src);
    } catch (e) { return no("pdf", e && e.code === "ENOENT" ? "tool-missing" : "damaged", { pages }); }
    if (objs.attachments) return no("pdf", "embedded-object", { pages });
    let xmp = "";
    try { xmp = await run("pdfinfo", ["-meta", src]); } catch (e) { /* no XMP packet */ }
    const cfg = L.config(policy);
    const label = L.decide(L.pdfLabels(objs.info, xmp, cfg), cfg);

    // pages that need OCR: every page when there is no text layer, otherwise the pages with pictures
    const ocrSet = new Set();
    if (!text.replace(/\s+/g, "")) { for (let i = 1; i <= pages; i++) ocrSet.add(i); }
    for (const line of list.split("\n").slice(2)) {
      const c = line.trim().split(/\s+/);
      if (c.length < 5 || c[2] === "smask" || c[2] === "stencil") continue;
      if (+c[3] >= LIMITS.minImagePx && +c[4] >= LIMITS.minImagePx) ocrSet.add(+c[0]);
    }
    if (ocrSet.size > LIMITS.ocrPages) return no("pdf", "too-many-scanned-pages", { pages });

    const scans = [scanVariants(pdfTextVariants(text), policy)];
    if (objs.strings.trim()) scans.push(E.scan(objs.strings, policy));
    try {
      for (const pg of Array.from(ocrSet).sort((a, b) => a - b)) {
        const base = path.join(dir, "p" + pg);
        await run("pdftoppm", ["-r", String(LIMITS.ocrDpi), "-gray", "-png", "-singlefile", "-f", String(pg), "-l", String(pg), src, base]);
        const { words } = await deps.ocr(fs.readFileSync(base + ".png"), { upscale: false });
        scans.push(deps.inspectWords(words, policy));
      }
    } catch (e) { return no("pdf", "ocr-failed", { pages }); }
    return verdict("pdf", scans, { pages, chars: text.length, ocrPages: ocrSet.size }, label);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });       // nothing is kept on disk
  }
}

function verdict(kind, scans, extra, label) {
  let engineAction = "allow";
  const categories = {};
  for (const r of scans) {
    if (RANK[r.action] > RANK[engineAction]) engineAction = r.action;
    for (const k of Object.keys(r.categories || {})) categories[k] = (categories[k] || 0) + r.categories[k];
  }
  // no in-place redaction for documents yet: "redact" becomes a whole-file block
  let action = engineAction === "redact" ? "block" : engineAction;
  let reason = action === "block" ? (engineAction === "redact" ? "secret-in-file" : "blocked-content") : undefined;
  // the label decides on its own; the content can only make the outcome stricter
  if (label && RANK[label.action] > RANK[action]) { action = label.action; }
  if (label && label.action !== "allow" && label.action === action) {
    reason = label.known ? "labelled" : "unknown-label";
    categories.CLASSIFIED = (categories.CLASSIFIED || 0) + 1;
  }
  const out = Object.assign({ inspected: true, kind, action, engineAction, categories, reason }, extra || {});
  if (label) out.label = { level: label.level, name: label.name ? String(label.name).slice(0, 80) : null, known: label.known, action: label.action };
  return out;
}

/* deps: { ocr(buf, opts) -> { words }, inspectWords(words, policy) -> { action, categories } } */
async function inspectFile(buf, policy, deps) {
  const t0 = Date.now();
  const kind = sniff(buf);
  let r;
  if (kind === "pdf") r = await inspectPdf(buf, policy, deps);
  else if (kind === "zip") r = await inspectDocx(buf, policy, deps);
  else r = no(kind, kind === "ole" ? "legacy-or-password-protected" : "unsupported-type");
  r.ms = Date.now() - t0;
  return r;
}

module.exports = { inspectFile, sniff, readZip, wordXmlToText, pdfTextVariants, LIMITS };
