/*
 * SADIN evaluation harness
 * Usage: node eval/run.js            -> prints summary, writes eval/results.json
 *        node eval/run.js --verbose  -> also prints every miss and false positive
 */
"use strict";
const fs = require("fs");
const path = require("path");
const E = require("../extension/src/engine.js");
const setArg = process.argv.find(a => a.startsWith("--set="));
const SET = setArg ? setArg.slice(6) : (process.argv.includes("--holdout") ? "holdout" : "corpus");
const QUIET = process.argv.includes("--quiet"); // summary only, no miss details (used for frozen sets)
const { SENSITIVE, CLEAN } = require("./" + SET + ".js");
const verbose = process.argv.includes("--verbose");

function covered(r, text, cat, value) {
  let from = 0, idx, any = false;
  while ((idx = text.indexOf(value, from)) >= 0) {
    any = true;
    const end = idx + value.length;
    const hit = r.findings.some(f => f.category === cat && (
      cat === "CLASSIFIED" ? (f.start < end && idx < f.end) : (f.start <= idx && f.end >= end)
    ));
    if (hit) return true;
    from = idx + 1;
  }
  if (!any) throw new Error("expected value not in text: " + value);
  return false;
}

// warm-up (JIT), not measured
for (let i = 0; i < 50; i++) E.scan(SENSITIVE[i % SENSITIVE.length].text);

const perCat = {};
let items = 0, itemsHit = 0, msgs = 0, msgsHit = 0, leaks = 0, leakChecks = 0;
let idemOk = 0, idemTotal = 0; const idemFail = [];
let clsTotal = 0, clsBlocked = 0;
const times = [];
const misses = [];
const perLang = {};

for (const s of SENSITIVE) {
  const r = E.scan(s.text);
  times.push(r.ms);
  msgs++;
  let allHit = true;
  for (const [cat, value] of s.expect) {
    items++;
    perCat[cat] = perCat[cat] || { total: 0, hit: 0 };
    perCat[cat].total++;
    const ok = covered(r, s.text, cat, value);
    const L = perLang[s.lang] = perLang[s.lang] || { items: 0, hit: 0, clean: 0, fp: 0 };
    L.items++; if (ok) L.hit++;
    if (ok) { itemsHit++; perCat[cat].hit++; } else { allHit = false; misses.push({ id: s.id, cat, value, text: s.text.slice(0, 90) }); }
    if (r.action !== "block" && cat !== "CLASSIFIED" && cat !== "SECURITY_FINDING") { // findings are flagged (warn), not redacted, by design
      leakChecks++;
      if (r.redactedText.includes(value)) leaks++;
    }
  }
  if (r.action !== "allow") msgsHit++;
  if (r.action === "redact") { idemTotal++; { const a2 = E.scan(r.redactedText).action; if (a2 === "allow" || a2 === "warn") idemOk++; else idemFail.push(s.id); } }
  if (s.expectAction === "block") { clsTotal++; if (r.action === "block") clsBlocked++; }
}

const fps = [];
for (const c of CLEAN) {
  const r = E.scan(c.text);
  const L = perLang[c.lang] = perLang[c.lang] || { items: 0, hit: 0, clean: 0, fp: 0 }; L.clean++;
  if (r.action !== "allow" || r.findings.length) L.fp++;
  times.push(r.ms);
  if (r.action !== "allow" || r.findings.length) {
    fps.push({ id: c.id, action: r.action, what: r.findings.map(f => f.detector + ":" + c.text.slice(f.start, f.end)), text: c.text.slice(0, 90) });
  }
}

// Latency on a large pasted file (about 1 MB of mixed config)
let big = "";
while (big.length < 1_000_000) big += SENSITIVE[big.length % SENSITIVE.length].text + "\n" + CLEAN[big.length % CLEAN.length].text + "\n";
const tb = [];
for (let i = 0; i < 5; i++) tb.push(E.scan(big).ms);

times.sort((a, b) => a - b);
const pct = p => times[Math.min(times.length - 1, Math.floor(p * times.length))];
const res = {
  set: SET,
  engineVersion: E.DEFAULT_POLICY.version,
  runAt: new Date().toISOString(),
  node: process.version,
  corpus: { sensitiveMessages: SENSITIVE.length, sensitiveItems: items, cleanMessages: CLEAN.length,
            arabicSensitive: SENSITIVE.filter(x => x.lang === "ar").length, arabicClean: CLEAN.filter(x => x.lang === "ar").length },
  itemRecall: itemsHit / items,
  perCategory: Object.fromEntries(Object.entries(perCat).map(([k, v]) => [k, { ...v, recall: v.hit / v.total }])),
  messageDetection: msgsHit / msgs,
  classifiedBlocked: { blocked: clsBlocked, total: clsTotal },
  residualLeakAfterRedaction: { leaked: leaks, checked: leakChecks },
  redactedTextRescansClean: { ok: idemOk, total: idemTotal, failed: idemFail },
  falsePositiveMessages: { count: fps.length, total: CLEAN.length, rate: fps.length / CLEAN.length },
  latencyMs: { median: pct(0.5), p95: pct(0.95), max: times[times.length - 1] },
  latency1MB: { medianMs: tb.sort((a, b) => a - b)[2], bytes: big.length },
  perLanguage: perLang,
  misses, falsePositives: fps
};

fs.writeFileSync(path.join(__dirname, "results-" + SET + ".json"), JSON.stringify(res, null, 2));
const pc = x => (100 * x).toFixed(1) + "%";
console.log(`[${SET}] Corpus: ${SENSITIVE.length} sensitive msgs (${items} items), ${CLEAN.length} clean msgs`);
console.log(`Item recall:        ${pc(res.itemRecall)}  (${itemsHit}/${items})`);
for (const [k, v] of Object.entries(res.perCategory)) console.log(`  ${k.padEnd(18)} ${pc(v.recall)} (${v.hit}/${v.total})`);
console.log(`Message detection:  ${pc(res.messageDetection)}`);
console.log(`Classified blocked: ${clsBlocked}/${clsTotal}`);
console.log(`Residual leaks:     ${leaks}/${leakChecks}`);
console.log(`Re-scan of redacted text clean: ${idemOk}/${idemTotal} ${idemFail.join(",")}`);
console.log(`False positives:    ${fps.length}/${CLEAN.length} = ${pc(res.falsePositiveMessages.rate)}`);
console.log(`Latency per msg:    median ${res.latencyMs.median.toFixed(2)} ms, p95 ${res.latencyMs.p95.toFixed(2)} ms`);
console.log(`1 MB paste:         ${res.latency1MB.medianMs.toFixed(0)} ms`);
for (const [k, v] of Object.entries(perLang)) console.log(`  [${k}] items ${v.hit}/${v.items}, false positives ${v.fp}/${v.clean}`);
if (verbose && !QUIET) {
  console.log("\nMISSES"); misses.forEach(m => console.log(" ", m.id, m.cat, JSON.stringify(m.value), "|", m.text.replace(/\n/g, " ")));
  console.log("\nFALSE POSITIVES"); fps.forEach(f => console.log(" ", f.id, f.action, f.what.join(", "), "|", f.text));
}
