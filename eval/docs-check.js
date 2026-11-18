/*
 * Compares the figures quoted in README.md and EVALUATION.md with the recorded result files
 * (eval/results-*.json). Exit 1 if a quoted figure differs from its result file, or if the
 * quoted sentence is no longer found where this script expects it.
 *
 *   node eval/docs-check.js
 *
 * This script only reads. When a figure disagrees, find out which side is wrong; do not edit
 * a result file, and above all not a FIRST-RUN, BASELINE or HELDOUT one, to make it pass.
 * When the wording of a quoted row changes, update the pattern here in the same change.
 *
 * In "npm test" it runs last, so the four text sets, the robustness cases and the tamper
 * server test are compared as they were just run; the other files are the committed records.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const doc = {};
const text = f => doc[f] || (doc[f] = fs.readFileSync(path.join(ROOT, f), "utf8"));
const res = name => JSON.parse(fs.readFileSync(path.join(__dirname, "results-" + name + ".json"), "utf8"));
const pct = x => (100 * x).toFixed(1);
const hits = r => Object.values(r.perCategory).reduce((n, c) => n + c.hit, 0);

// text sets
const corpus = res("corpus"), holdout = res("holdout"), holdoutFirst = res("holdout-FIRST-RUN-v0.3.0");
const arDev = res("arabic-dev"), arHold = res("arabic-holdout"), arHoldFirst = res("arabic-holdout-FIRST-RUN-v0.4.0");
// screenshots
const ocrFirst = res("ocr-HELDOUT-seed990011"), ocrV040 = res("ocr-seed990011-RERUN-v0.4.0"), ocrNov = res("ocr-seed990011-RERUN-2026-11-17");
// documents
const files = res("files"), bulk = res("files-bulk"), bulkFirst = res("files-bulk-FIRST-RUN");
const e2eFiles = res("e2e-files"), e2eDown = res("e2e-files-server-down"), audit = res("e2e-audit");
// tamper resistance and robustness
const lab = res("tamper-lab"), labRun1 = res("tamper-lab-RUN1"), tamperServer = res("tamper-server"), robust = res("robustness");

// The document set has three parts (EVALUATION.md, sections 5b and 5c): the label files are
// d40 to d53 and p60 to p65, the two known gaps are listed in the result file, the rest is
// the structural set.
const isGap = r => files.knownGaps.includes(r.file);
const isLabel = r => /^(d(4\d|5[0-3])|p6[0-5])-/.test(r.file);
const labelled = files.rows.filter(r => isLabel(r) && !isGap(r));
const structural = files.rows.filter(r => !isLabel(r) && !isGap(r));
const ok = (rows, expect) => rows.filter(r => r.ok && (!expect || r.expect === expect)).length;

const README = "README.md", EVAL = "EVALUATION.md";
// [document, what is quoted, pattern with one group per figure, the figures from the result files]
const CHECKS = [
  [README, "held-out text, first run: items caught", /\| Sensitive items caught in text \| \*\*([\d.]+)%\*\* \((\d+) of (\d+)\) \|/,
    [pct(holdoutFirst.itemRecall), hits(holdoutFirst), holdoutFirst.corpus.sensitiveItems]],
  [README, "held-out text, first run: false positives", /\| False positives on clean business prompts \| \*\*(\d+) of (\d+)\*\* \|/,
    [holdoutFirst.falsePositiveMessages.count, holdoutFirst.falsePositiveMessages.total]],
  [README, "screenshots, first run: values masked", /\| Screenshot values masked \(on-prem OCR\) \| \*\*([\d.]+)%\*\* \((\d+) of (\d+)\) \|/,
    [pct(ocrFirst.maskRecall), ocrFirst.valuesMasked, ocrFirst.seededValues]],
  [README, "screenshots, first run: classified memos blocked", /\| Classified Arabic memos blocked in screenshots \| \*\*(\d+) of (\d+)\*\*/,
    [ocrFirst.classifiedBlocked, ocrFirst.classifiedImages]],
  [README, "Arabic held-out set, first run", /\| Arabic items caught \(Arabic held-out set\) \| \*\*(\d+) of (\d+)\*\*, (\d+) false positive in (\d+) \|/,
    [hits(arHoldFirst), arHoldFirst.corpus.sensitiveItems, arHoldFirst.falsePositiveMessages.count, arHoldFirst.falsePositiveMessages.total]],
  [README, "structural test documents", /\*\*(\d+) of (\d+)\*\* \((\d+) held back, (\d+) let through, (\d+) refused as uninspectable\) \|/,
    [ok(structural), structural.length, ok(structural, "block"), ok(structural, "allow"), ok(structural, "uninspectable")]],
  [README, "labelled test documents", /\*\*(\d+) of (\d+)\*\* \((\d+) held back, (\d+) let through\); (\d+) more files record a known gap/,
    [ok(labelled), labelled.length, ok(labelled, "block"), ok(labelled, "allow"), files.knownGaps.length]],
  [README, "held-out items as .docx", /same decision in a \.docx as for the same text pasted \| \*\*(\d+) of (\d+)\*\* \|/,
    [bulkFirst.formats.docx.sameDecision, bulkFirst.items]],
  [README, "held-out items as PDF, first run", /same decision in a PDF \(first run\) \| \*\*(\d+) of (\d+)\*\* \(LibreOffice\), \*\*(\d+) of (\d+)\*\* \(Chrome\) \|/,
    [bulkFirst.formats["pdf-libreoffice"].sameDecision, bulkFirst.items, bulkFirst.formats["pdf-chrome"].sameDecision, bulkFirst.items]],
  [README, "clean documents held back by mistake", /\| Clean documents held back by mistake \| \*\*(\d+)\*\* \|/,
    [files.wronglyHeld.length]],
  [README, "tamper lab", /\| \*\*(\d+) of (\d+)\*\* checks passed, run twice with the same outcome \|/,
    [lab.counts.PASS, lab.rows.length]],
  [README, "tamper lab, first of the two runs", /\| \*\*(\d+) of (\d+)\*\* checks passed, run twice with the same outcome \|/,
    [labRun1.counts.PASS, labRun1.rows.length]],
  [README, "tamper server checks", /\| Server-side checks:[^|]*\| \*\*(\d+) of (\d+)\*\* \|/,
    [tamperServer.passed, tamperServer.total]],
  [README, "audit: real-browser checks and engine cases", /\*\*(\d+) of (\d+)\*\* real-browser checks and \*\*(\d+) of (\d+)\*\* engine cases/,
    [audit.passed, audit.total, robust.ok, robust.required]],

  [EVAL, "English development set", /\| English development set \| (\d+) of (\d+) items, (\d+) of (\d+) false positives \| Same \|/,
    [hits(corpus), corpus.corpus.sensitiveItems, corpus.falsePositiveMessages.count, corpus.falsePositiveMessages.total]],
  [EVAL, "English held-out set, first run", /\| English held-out set, first run on v0\.3\.0 \(the headline\) \| (\d+) of (\d+) items \(([\d.]+)%\), (\d+) of (\d+) false positives \|/,
    [hits(holdoutFirst), holdoutFirst.corpus.sensitiveItems, pct(holdoutFirst.itemRecall), holdoutFirst.falsePositiveMessages.count, holdoutFirst.falsePositiveMessages.total]],
  [EVAL, "English held-out set, current engine", /\| English held-out set on the current engine[^|]*\| (\d+) of (\d+), (\d+) of (\d+) \| Same \|/,
    [hits(holdout), holdout.corpus.sensitiveItems, holdout.falsePositiveMessages.count, holdout.falsePositiveMessages.total]],
  [EVAL, "Arabic development set", /\| Arabic development set \| (\d+) of (\d+) items, (\d+) of (\d+) false positives \| Same \|/,
    [hits(arDev), arDev.corpus.sensitiveItems, arDev.falsePositiveMessages.count, arDev.falsePositiveMessages.total]],
  [EVAL, "Arabic held-out set", /\| Arabic held-out set \| (\d+) of (\d+) items, (\d+) false positive in (\d+) \| Same \|/,
    [hits(arHold), arHold.corpus.sensitiveItems, arHold.falsePositiveMessages.count, arHold.falsePositiveMessages.total]],
  [EVAL, "screenshots: values masked, first run and 17 November", /\| Screenshots, held-out seed: values masked \| (\d+) of (\d+) \(([\d.]+)%\) \| (\d+) of (\d+) \|/,
    [ocrFirst.valuesMasked, ocrFirst.seededValues, pct(ocrFirst.maskRecall), ocrNov.valuesMasked, ocrNov.seededValues]],
  [EVAL, "screenshots: values still readable", /\| Screenshots: values still readable after masking \| (\d+) of (\d+) \(first run\), (\d+) \(v0\.4\.0 re-run\) \| (\d+) of (\d+) \|/,
    [ocrFirst.readableAfterMasking, ocrFirst.seededValues, ocrV040.readableAfterMasking, ocrNov.readableAfterMasking, ocrNov.seededValues]],
  [EVAL, "screenshots: classified memos blocked", /\| Screenshots: classified memos blocked \| (\d+) of (\d+) \| \*\*(\d+) of (\d+)\*\*/,
    [ocrFirst.classifiedBlocked, ocrFirst.classifiedImages, ocrNov.classifiedBlocked, ocrNov.classifiedImages]],
  [EVAL, "document test set", /\| Document test set \((\d+) structural \+ (\d+) labelled \+ (\d+) known gaps\) \| (\d+) of (\d+) as expected \| Same \|/,
    [structural.length, labelled.length, files.knownGaps.length, files.correct, files.files]],
  [EVAL, "held-out items as documents, after fixes", /\| Held-out items as documents \| (\d+) of (\d+) \(\.docx\), (\d+) \(LibreOffice PDF\), (\d+) \(Chrome PDF\) after fixes \| Same \|/,
    [bulk.formats.docx.sameDecision, bulk.items, bulk.formats["pdf-libreoffice"].sameDecision, bulk.formats["pdf-chrome"].sameDecision]],
  [EVAL, "real browser, uploads", /\| Real browser, uploads \| (\d+) of (\d+), and (\d+) of (\d+) with the service stopped \| Same \|/,
    [e2eFiles.ok, e2eFiles.cases, e2eDown.ok, e2eDown.cases]],
  [EVAL, "tamper lab", /\| Tamper lab \|[^|]*\| (\d+) of (\d+), twice \|/,
    [lab.counts.PASS, lab.rows.length]],
  [EVAL, "tamper lab, first of the two runs", /\| Tamper lab \|[^|]*\| (\d+) of (\d+), twice \|/,
    [labRun1.counts.PASS, labRun1.rows.length]],
  [EVAL, "tamper server test", /\| Tamper server test \|[^|]*\| (\d+) of (\d+) \|/,
    [tamperServer.passed, tamperServer.total]],
  [EVAL, "audit: real-browser checks", /`eval\/e2e-audit\.js` in a real browser, (\d+) of (\d+) /,
    [audit.passed, audit.total]],
  [EVAL, "audit: engine cases", /`eval\/robustness\.js` on the engine, (\d+) of (\d+) required cases/,
    [robust.ok, robust.required]]
];

let failed = 0;
for (const [file, what, re, want] of CHECKS) {
  const m = text(file).match(re);
  const expected = want.map(String);
  let problem = null;
  if (!m) problem = "the quoted sentence was not found (wording changed?)";
  else {
    const quoted = m.slice(1);
    if (quoted.join(" ") !== expected.join(" ")) problem = `document says ${quoted.join(", ")}; result files say ${expected.join(", ")}`;
  }
  if (problem) failed++;
  console.log(`[${problem ? "FAIL" : "PASS"}] ${file.padEnd(13)} ${what}${problem ? "  -> " + problem : ": " + expected.join(", ")}`);
}
console.log(`\n${CHECKS.length - failed} of ${CHECKS.length} quoted figures agree with the result files`);
process.exit(failed ? 1 : 0);
