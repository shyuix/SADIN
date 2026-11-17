/*
 * Fails (exit 1) when a text set scores worse than the published numbers.
 * eval/run.js only prints and records its results; this turns them into a pass or fail,
 * so "npm test" and CI stop when detection regresses. Run it after the four eval/run.js runs.
 *
 * The numbers below are the ones in EVALUATION.md, section 5e. Change them only together
 * with that table.
 */
"use strict";
const fs = require("fs");
const path = require("path");

//                 items caught, items, false positives allowed, clean messages
const EXPECTED = {
  "corpus":         [155, 155, 0, 100],
  "holdout":        [51, 51, 0, 50],
  "arabic-dev":     [47, 47, 0, 38],
  "arabic-holdout": [36, 36, 1, 40]
};

let failed = 0;
for (const [set, [hit, items, fpMax, clean]] of Object.entries(EXPECTED)) {
  const r = JSON.parse(fs.readFileSync(path.join(__dirname, "results-" + set + ".json"), "utf8"));
  const gotHit = Object.values(r.perCategory).reduce((n, c) => n + c.hit, 0);
  const problems = [];
  if (r.corpus.sensitiveItems !== items || r.corpus.cleanMessages !== clean) problems.push(`set size changed (${r.corpus.sensitiveItems} items, ${r.corpus.cleanMessages} clean)`);
  if (gotHit < hit) problems.push(`items caught ${gotHit} of ${items}, expected ${hit}`);
  if (r.falsePositiveMessages.count > fpMax) problems.push(`false positives ${r.falsePositiveMessages.count}, expected at most ${fpMax}`);
  if (r.residualLeakAfterRedaction.leaked > 0) problems.push(`${r.residualLeakAfterRedaction.leaked} values still readable after redaction`);
  if (r.redactedTextRescansClean.ok !== r.redactedTextRescansClean.total) problems.push(`redacted text is detected again: ${r.redactedTextRescansClean.failed.join(", ")}`);
  console.log(`[${problems.length ? "FAIL" : "PASS"}] ${set.padEnd(15)} ${gotHit}/${items} items, ${r.falsePositiveMessages.count}/${clean} false positives${problems.length ? "  -> " + problems.join("; ") : ""}`);
  if (problems.length) failed++;
}
process.exit(failed ? 1 : 0);
