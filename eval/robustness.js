// Robustness cases from the 17 November 2026 audit. Two kinds of entry:
//   expect: the outcome the engine must give (the run fails if it does not)
//   gap:    a weakness that is known and NOT fixed; recorded so nobody quotes it as covered.
//           The run prints what the engine does today and does not fail on it.
// Run: node eval/robustness.js
"use strict";
const fs = require("fs"), path = require("path");
const E = require("../extension/src/engine.js");
const PW = "Riyadh77!Qx3";
const CASES = [
  // invisible characters and tatweel (fixed in engine 0.4.1)
  ["zero-width space inside a keyword", "pass​word: " + PW, { expect: "redact" }],
  ["zero-width space inside an internal address", "server 10.20​.30.40 is down", { expect: "redact" }],
  ["zero-width space inside the secret itself", "password: Riy​adh77!Qx3", { expect: "redact", gone: "adh77" }],
  ["right-to-left mark after an Arabic keyword", "كلمة المرور:‏ " + PW, { expect: "redact" }],
  ["tatweel inside an Arabic keyword", "كلمـــة المرور: " + PW, { expect: "redact" }],
  ["tatweel inside a classification marking", "ســري للغاية", { expect: "block" }],
  ["byte-order mark at the start", "﻿password: " + PW, { expect: "redact" }],
  ["soft hyphen inside a keyword", "pass­word: " + PW, { expect: "redact" }],
  ["clean Arabic with tatweel", "مرحبـــا كيف الحال", { expect: "allow" }],
  ["clean Arabic with a direction mark", "السلام عليكم‏ كيف حالك", { expect: "allow" }],
  // everyday text that must stay clean
  ["clean: everyday use of the word secret", "what is the secret to good writing?", { expect: "allow" }],
  ["clean: a film title", "Top Secret is a 1984 comedy film", { expect: "allow" }],
  ["clean: Arabic everyday 'secret between us'", "الموضوع سري بيني وبينك لا تعلم احد", { expect: "allow" }],
  ["clean: a public DNS address", "Google DNS is 8.8.8.8", { expect: "allow" }],
  // known gaps: deliberate obfuscation, out of scope for a tool aimed at accidental leaks
  ["GAP address written with spaces", "server 10 . 20 . 30 . 40 is down", { gap: "deliberate obfuscation" }],
  ["GAP address written as 10[.]20[.]30[.]40", "server 10[.]20[.]30[.]40 is down", { gap: "deliberate obfuscation" }],
  ["GAP full-width digits", "server １０.２０.３０.４０", { gap: "deliberate obfuscation" }],
  ["GAP look-alike letter in the keyword", "pаssword: " + PW, { gap: "deliberate obfuscation" }],
  // known gaps: accidental cases the detectors do not cover
  ["GAP password with no keyword near it", "login with admin / " + PW, { gap: "no keyword, and the value alone is not random enough to flag" }],
  ["GAP bare Arabic 'سري' as a document heading", "محضر اجتماع - سري", { gap: "the single word is too common in everyday Arabic to block on; 'التصنيف: سري' and 'سري للغاية' are caught" }],
  ["GAP lower-case 'top secret' inside a sentence", "this document is top secret", { gap: "English markings are matched in capitals or as a labelled line, to avoid everyday phrases" }],
  // known false positives
  ["GAP false positive: a version number that looks like an internal address", "upgrade to version 10.2.30.4 of the driver", { gap: "redacted as an internal address; the message still goes" }],
  ["GAP false positive: everyday Arabic 'سري جداً'", "هذا رقم سري جداً بيني وبينك", { gap: "'سري جداً' is also a classification level, so the message is blocked" }],
];
let ok = 0, must = 0; const rows = [];
for (const [name, text, o] of CASES) {
  const r = E.scan(text, null);
  if (o.expect) {
    must++;
    const good = r.action === o.expect && !(o.gone && r.redactedText && r.redactedText.includes(o.gone)) && !(o.expect === "redact" && r.redactedText.includes(PW));
    if (good) ok++;
    rows.push({ name, expected: o.expect, got: r.action, ok: good });
    console.log(`${good ? "ok  " : "FAIL"} ${name.padEnd(48)} expected ${o.expect}, got ${r.action}`);
  } else {
    rows.push({ name: name.replace(/^GAP /, ""), knownGap: o.gap, engineDoes: r.action });
    console.log(`gap  ${name.replace(/^GAP /, "").padEnd(48)} engine: ${r.action}  (${o.gap})`);
  }
}
console.log(`\n${ok} of ${must} required cases as expected; ${CASES.length - must} known gaps recorded`);
fs.writeFileSync(path.join(__dirname, "results-robustness.json"), JSON.stringify({ engine: E.DEFAULT_POLICY.version, date: new Date().toISOString().slice(0, 10), required: must, ok, knownGaps: CASES.length - must, rows }, null, 1) + "\n");
process.exit(ok === must ? 0 : 1);
