/*
 * Writes server/integrity.json: the expected fingerprint of the extension's code for the
 * version in extension/manifest.json. Run it after every release, before the browsers update:
 *
 *   node server/integrity.js            # write or update integrity.json
 *   node server/integrity.js --check    # exit 1 if integrity.json does not match the files
 *
 * The extension computes the same fingerprint from its files on disk and sends it in each
 * heartbeat; the server raises "integrity-mismatch" when they differ. The list of files must
 * stay the same as INTEGRITY_FILES in extension/src/background.js.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILES = ["manifest.json", "src/engine.js", "src/content.js", "src/background.js"];
const sha = b => crypto.createHash("sha256").update(b).digest("hex");

// The browser adds "key" (and the store adds "update_url") to the installed manifest, so the
// manifest is compared by content, with those two fields left out and keys in a fixed order.
const canon = v => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
  : JSON.stringify(v);

function fingerprint(extDir) {
  const parts = FILES.map(f => {
    try {
      let bytes = fs.readFileSync(path.join(extDir, f));
      if (f === "manifest.json") {
        const m = JSON.parse(bytes.toString("utf8"));
        delete m.key; delete m.update_url;
        bytes = Buffer.from(canon(m), "utf8");
      }
      return sha(bytes);
    } catch (e) { return "missing:" + f; }
  });
  return sha(Buffer.from(parts.join("\n"), "utf8"));
}

if (require.main === module) {
  const ext = path.resolve(__dirname, "../extension");
  const out = process.env.SADIN_INTEGRITY_FILE || path.join(__dirname, "integrity.json");
  const version = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json"), "utf8")).version;
  const fp = fingerprint(ext);
  let all = {};
  try { all = JSON.parse(fs.readFileSync(out, "utf8")); } catch (e) { /* first run */ }
  if (process.argv.includes("--check")) {
    const ok = all[version] === fp;
    console.log(ok ? `integrity.json matches extension ${version}` : `integrity.json is out of date for extension ${version}: run "node server/integrity.js"`);
    process.exit(ok ? 0 : 1);
  }
  all[version] = fp;
  fs.writeFileSync(out, JSON.stringify(all, null, 2) + "\n");
  console.log(`extension ${version}: ${fp}`);
}
module.exports = { fingerprint, FILES };
