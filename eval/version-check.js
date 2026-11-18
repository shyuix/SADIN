/*
 * Checks that the version numbers written in different files agree, and that the two copies
 * of the integrity file list are the same. Exit 1 on any difference.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const first = (text, re, what) => { const m = text.match(re); if (!m) throw new Error("not found: " + what); return m[1]; };

const E = require("../extension/src/engine.js");
const { FILES } = require("../server/integrity.js");

const release = JSON.parse(read("package.json")).version;
const engine = E.DEFAULT_POLICY.version;
const readme = read("README.md");
const rows = [
  ["extension/manifest.json version", JSON.parse(read("extension/manifest.json")).version, release],
  ["server/integrity.json has an entry", Object.keys(JSON.parse(read("server/integrity.json"))).includes(release) ? release : "missing", release],
  ["README release badge", first(readme, /badge\/release-v([\d.]+)-/, "release badge"), release],
  ["README release badge alt text", first(readme, /alt="Release v([\d.]+)"/, "release badge alt"), release],
  ["CHANGELOG.md has an entry", new RegExp("^## " + release.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)", "m").test(read("CHANGELOG.md")) ? release : "missing", release], 
  ["README engine badge", first(readme, /badge\/engine-v([\d.]+)-/, "engine badge"), engine],
  ["README engine badge alt text", first(readme, /alt="Engine v([\d.]+)"/, "engine badge alt"), engine],
  ["integrity file list in background.js", JSON.stringify(JSON.parse(first(read("extension/src/background.js"), /const INTEGRITY_FILES = (\[[^\]]*\]);/, "INTEGRITY_FILES"))), JSON.stringify(FILES)]
];

let failed = 0;
for (const [what, got, want] of rows) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${what}: ${got}${ok ? "" : "  (expected " + want + ")"}`);
}
console.log(`\nrelease ${release}, engine ${engine}: ${rows.length - failed} of ${rows.length} checks passed`);
process.exit(failed ? 1 : 0);
