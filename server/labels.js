/*
 * SADIN sensitivity labels
 * ------------------------
 * A document the organisation has already classified says so in its metadata. SADIN reads that
 * label and applies the organisation's rule for the level, whatever the text looks like: a
 * labelled document needs no recognisable pattern to be held back.
 *
 * Where labels are read from
 *   Word  Microsoft Purview Information Protection metadata: custom document properties named
 *         MSIP_Label_<GUID>_<attribute> (docProps/custom.xml) and the newer label list
 *         (docMetadata/LabelInfo.xml, which carries the label GUID but not its name).
 *   PDF   the same MSIP_Label_<GUID>_<attribute> entries in the document information
 *         dictionary and in the XMP metadata.
 *   Both  plain classification properties (default names: Classification, Sensitivity, التصنيف).
 *
 * Levels follow the NDMO Data Classification Policy: top-secret, secret, restricted, public.
 * Policy (server/policy.json, key "labels"):
 *   ids        { "<label GUID>": "<level>" }     the organisation's Purview labels, by GUID
 *   names      { "<label name>": "<level>" }     extra label names, added to the built-in ones
 *   properties [ "<property name>", ... ]        plain classification properties to read
 *   actions    { "<level>": "block|warn|allow" } default: block for all but public
 *   unknown    "block|warn|allow"                a label with no rule (default: block)
 */
"use strict";

const LEVELS = ["public", "restricted", "secret", "top-secret"];
const BUILTIN_NAMES = {
  "top secret": "top-secret", "سري للغاية": "top-secret",
  "secret": "secret", "سري": "secret",
  "restricted": "restricted", "confidential": "restricted", "مقيد": "restricted",
  "public": "public", "عام": "public"
};
const DEFAULTS = {
  properties: ["Classification", "Sensitivity", "التصنيف"],
  actions: { "top-secret": "block", "secret": "block", "restricted": "block", "public": "allow" },
  unknown: "block"
};
const RANK = { allow: 0, warn: 1, block: 3 };
const ACTIONS = ["allow", "warn", "block"];

// label names are compared without case, Arabic diacritics, tatweel or hamza/ya variants
function norm(s) {
  return String(s == null ? "" : s).normalize("NFKC").toLowerCase()
    .replace(/[ً-ٰٟـ‌-‏‪-‮]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي")
    .replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}
const guid = s => { const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(String(s || "")); return m ? m[0].toLowerCase() : null; };
const xmlText = s => String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
  if (g === "amp") return "&"; if (g === "lt") return "<"; if (g === "gt") return ">"; if (g === "quot") return '"'; if (g === "apos") return "'";
  try { return String.fromCodePoint(g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)); } catch (e) { return " "; }
});
const isOff = v => /^(false|0|no)$/i.test(String(v == null ? "" : v).trim());

// name/value pairs -> labels. MSIP entries are grouped by GUID; a label that is switched off is dropped.
function fromPairs(pairs, propertyNames) {
  const msip = new Map(), out = [];
  const plain = new Set(propertyNames.map(norm));
  for (const [k, v] of pairs) {
    const m = /^MSIP_Label_([0-9a-f-]{36})_(\w+)$/i.exec(k);
    if (m) {
      const id = m[1].toLowerCase();
      if (!msip.has(id)) msip.set(id, { id, source: "msip" });
      msip.get(id)[m[2].toLowerCase()] = String(v);
    } else if (plain.has(norm(k)) && String(v).trim()) {
      out.push({ name: String(v).trim(), source: "property" });
    }
  }
  for (const l of msip.values()) if (!isOff(l.enabled)) out.push({ id: l.id, name: l.name ? l.name.trim() : undefined, source: "msip" });
  return out;
}

/* ---------- readers ---------- */
function customXmlPairs(xml) {
  const pairs = [];
  String(xml).replace(/<property\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g, (m, name, body) => {
    pairs.push([xmlText(name), xmlText(body.replace(/<[^>]+>/g, "")).trim()]);
    return m;
  });
  return pairs;
}
function labelInfoLabels(xml) {
  const out = [];
  String(xml).replace(/<(?:\w+:)?label\b([^>]*)>/g, (m, attrs) => {
    const a = {};
    attrs.replace(/([\w:]+)="([^"]*)"/g, (x, k, v) => { a[k.replace(/^\w+:/, "")] = xmlText(v); return x; });
    const id = guid(a.id);
    if (id && !isOff(a.enabled === undefined ? "1" : a.enabled) && !/^(1|true)$/i.test(a.removed || "0")) out.push({ id, source: "labelinfo" });
    return m;
  });
  return out;
}
// the MSIP_Label_ properties are handled here, so they are kept out of the text scan (their GUIDs are not content)
const stripLabelProperties = xml => String(xml).replace(/<property\b[^>]*\bname="MSIP_Label_[^"]*"[^>]*>[\s\S]*?<\/property>/g, "");

function docxLabels(read, names, cfg) {
  const labels = [];
  if (names.includes("docProps/custom.xml")) labels.push(...fromPairs(customXmlPairs(read("docProps/custom.xml").toString("utf8")), cfg.properties));
  for (const n of names) if (/^docMetadata\/LabelInfo\d*\.xml$/i.test(n)) labels.push(...labelInfoLabels(read(n).toString("utf8")));
  return labels;
}
// info: the PDF's document information dictionary as { "/Key": "u:value" }; xmp: the XMP packet as text
function pdfLabels(info, xmp, cfg) {
  const pairs = [];
  for (const [k, v] of Object.entries(info || {})) if (typeof v === "string" && v.startsWith("u:")) pairs.push([k.replace(/^\//, ""), v.slice(2)]);
  const x = String(xmp || "");
  x.replace(/<(?:[\w.-]+:)?([\w؀-ۿ-]+)>([^<]*)<\/(?:[\w.-]+:)?\1>/g, (m, k, v) => { pairs.push([k, xmlText(v)]); return m; });
  x.replace(/\b(?:[\w.-]+:)?(MSIP_Label_[0-9a-f-]{36}_\w+)="([^"]*)"/gi, (m, k, v) => { pairs.push([k, xmlText(v)]); return m; });
  return fromPairs(pairs, cfg.properties);
}

/* ---------- decision ---------- */
function config(policy) {
  const p = (policy && policy.labels) || {};
  const names = Object.assign({}, BUILTIN_NAMES);
  for (const [k, v] of Object.entries(p.names || {})) if (LEVELS.includes(v)) names[norm(k)] = v;
  const ids = {};
  for (const [k, v] of Object.entries(p.ids || {})) { const g = guid(k); if (g && LEVELS.includes(v)) ids[g] = v; }
  const actions = Object.assign({}, DEFAULTS.actions);
  for (const [k, v] of Object.entries(p.actions || {})) if (LEVELS.includes(k) && ACTIONS.includes(v)) actions[k] = v;
  return {
    names, ids, actions,
    properties: Array.isArray(p.properties) && p.properties.length ? p.properties.map(String) : DEFAULTS.properties,
    unknown: ACTIONS.includes(p.unknown) ? p.unknown : DEFAULTS.unknown
  };
}
function levelOf(label, cfg) {
  if (label.id && cfg.ids[label.id]) return cfg.ids[label.id];
  if (!label.name) return null;
  const n = norm(label.name);
  if (cfg.names[n]) return cfg.names[n];
  // sub-labels: "Confidential \ Finance", "Secret / Board", "Restricted - HR"
  for (const part of String(label.name).split(/\s*[\\/|>:]\s*|\s+-\s+/)) { const k = norm(part); if (cfg.names[k]) return cfg.names[k]; }
  return null;
}
/* -> null when the document carries no label, otherwise
 *    { action, level, name, known, labels: n }  for the strictest label found */
function decide(labels, cfg) {
  if (!labels.length) return null;
  let best = null;
  for (const l of labels) {
    const level = levelOf(l, cfg);
    const action = level ? cfg.actions[level] : cfg.unknown;
    const cand = { action, level: level || null, name: l.name || null, known: !!level, labels: labels.length };
    if (!best || RANK[action] > RANK[best.action] || (RANK[action] === RANK[best.action] && LEVELS.indexOf(level) > LEVELS.indexOf(best.level))) best = cand;
  }
  return best;
}

module.exports = { config, decide, docxLabels, pdfLabels, stripLabelProperties, norm, LEVELS, BUILTIN_NAMES };
