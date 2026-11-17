/*
 * File-inspection evaluation (PDF and Word .docx), run against server/files.js.
 *
 *   node eval/files-eval.js                 structural set: eval/file-fixtures/ + manifest.json
 *   node eval/files-eval.js --bulk <dir>    extraction fidelity on the frozen held-out sets
 *                                           (<dir> built by: node eval/files-build.js bulk <dir>)
 *
 * Structural set: where a secret can hide in a document, and which files must not be let
 * through unread. Each file has one expected outcome, written before the run.
 *
 * Bulk set: every item of holdout.js and arabic-holdout.js as a .docx, a LibreOffice PDF and a
 * Chrome PDF. The engine is unchanged, so the question is only whether the document path gives
 * the same decision as the same text pasted directly. The held-out sets stay frozen.
 *
 * Needs the same tools as the server: Tesseract (ara+eng), poppler-utils, qpdf.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const E = require("../extension/src/engine.js");
const S = require("../server/server.js");
const F = require("../server/files.js");
const deps = { ocr: S.ocr, inspectWords: S.inspectWords };
const outcome = r => r.inspected ? r.action : "uninspectable";

async function structural() {
  const dir = path.join(__dirname, "file-fixtures");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const rows = [], byExpect = {};
  for (const m of manifest) {
    // most files run with the default policy; the label tests that need the organisation's
    // own label map name a policy file
    const policy = m.policy ? JSON.parse(fs.readFileSync(path.join(dir, m.policy), "utf8")) : null;
    const r = await F.inspectFile(fs.readFileSync(path.join(dir, m.file)), policy, deps);
    const got = outcome(r), ok = got === m.expect && (!m.reason || r.reason === m.reason);
    rows.push({ file: m.file, where: m.where, expect: m.expect, expectReason: m.reason || null, got, ok, reason: r.reason || null, label: r.label || null, categories: r.categories || {}, ocr: (r.ocrPages || 0) + (r.ocrImages || 0), ms: r.ms });
    const b = byExpect[m.expect] = byExpect[m.expect] || { total: 0, ok: 0 };
    b.total++; if (ok) b.ok++;
    console.log(`${ok ? "ok  " : "FAIL"} ${m.file.padEnd(48)} expect=${m.expect.padEnd(13)} got=${got.padEnd(13)} ${r.reason || ""} ${r.ms}ms`);
  }
  const ms = rows.map(r => r.ms).sort((a, b) => a - b);
  const text = rows.filter(r => !r.ocr).map(r => r.ms).sort((a, b) => a - b), ocr = rows.filter(r => r.ocr).map(r => r.ms).sort((a, b) => a - b);
  const med = a => a.length ? a[Math.floor(a.length / 2)] : null;
  const res = {
    set: "file-fixtures (structural)", engine: E.DEFAULT_POLICY.version, date: new Date().toISOString().slice(0, 10),
    files: rows.length, correct: rows.filter(r => r.ok).length, byExpect,
    wronglyAllowed: rows.filter(r => r.expect !== "allow" && r.got === "allow").map(r => r.file),
    knownGaps: manifest.filter(m => m.gap).map(m => m.file),
    wronglyHeld: rows.filter(r => r.expect === "allow" && r.got !== "allow").map(r => r.file),
    timingMs: { medianNoOcr: med(text), medianWithOcr: med(ocr), max: ms[ms.length - 1] },
    rows
  };
  fs.writeFileSync(path.join(__dirname, "results-files.json"), JSON.stringify(res, null, 1) + "\n");
  console.log(`\n${res.correct} of ${res.files} files got the expected outcome`);
  for (const k of Object.keys(byExpect)) console.log(`  expected ${k}: ${byExpect[k].ok} of ${byExpect[k].total}`);
  if (res.knownGaps.length) console.log(`  known gaps (a harmless file whose label was lost before it reached SADIN, let through): ${res.knownGaps.length}`);
  console.log(`  let through by mistake: ${res.wronglyAllowed.length}   held back by mistake: ${res.wronglyHeld.length}`);
  console.log(`  median time: ${res.timingMs.medianNoOcr} ms without OCR, ${res.timingMs.medianWithOcr} ms with OCR, max ${res.timingMs.max} ms`);
  return res.correct === res.files;
}

async function bulk(dir) {
  const items = JSON.parse(fs.readFileSync(path.join(dir, "items.json"), "utf8"));
  const formats = { docx: ".docx", "pdf-libreoffice": ".libreoffice.pdf", "pdf-chrome": ".chrome.pdf" };
  const res = { set: "holdout.js + arabic-holdout.js as documents", engine: E.DEFAULT_POLICY.version, date: new Date().toISOString().slice(0, 10), items: items.length, formats: {} };
  for (const [fmt, ext] of Object.entries(formats)) {
    const st = { flaggedAsText: 0, flaggedStillFlagged: 0, cleanAsText: 0, cleanStillClean: 0, sameDecision: 0, byLang: {}, lost: [], gained: [], notInspected: [] };
    for (const it of items) {
      const t = E.scan(it.text, null).action;                       // decision on the same text, pasted
      const r = await F.inspectFile(fs.readFileSync(path.join(dir, it.id + ext)), null, deps);
      const f = r.inspected ? r.engineAction : "uninspectable";
      const L = st.byLang[it.lang] = st.byLang[it.lang] || { flaggedAsText: 0, flaggedStillFlagged: 0, cleanAsText: 0, cleanStillClean: 0 };
      if (!r.inspected) st.notInspected.push(it.id);
      if (t === f) st.sameDecision++;
      if (t !== "allow") { st.flaggedAsText++; L.flaggedAsText++; if (f !== "allow") { st.flaggedStillFlagged++; L.flaggedStillFlagged++; } else st.lost.push(it.id); }
      else { st.cleanAsText++; L.cleanAsText++; if (f === "allow") { st.cleanStillClean++; L.cleanStillClean++; } else st.gained.push(it.id); }
    }
    res.formats[fmt] = st;
    console.log(`${fmt.padEnd(16)} flagged as text ${st.flaggedAsText}, still flagged in the file ${st.flaggedStillFlagged}; clean as text ${st.cleanAsText}, still clean ${st.cleanStillClean}; same decision ${st.sameDecision} of ${items.length}`);
    for (const [l, v] of Object.entries(st.byLang)) console.log(`   ${l}: flagged ${v.flaggedStillFlagged}/${v.flaggedAsText}, clean ${v.cleanStillClean}/${v.cleanAsText}`);
    if (st.lost.length) console.log("   lost in the file:", st.lost.join(", "));
    if (st.gained.length) console.log("   flagged only in the file:", st.gained.join(", "));
  }
  fs.writeFileSync(path.join(__dirname, "results-files-bulk.json"), JSON.stringify(res, null, 1) + "\n");
}

(async () => {
  const i = process.argv.indexOf("--bulk");
  if (i >= 0) { await bulk(path.resolve(process.argv[i + 1])); process.exit(0); }
  process.exit((await structural()) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
