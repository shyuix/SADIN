# Changelog

## Unreleased

Repository checks and two small changes to the inspection service. The extension is unchanged.

- The inspection service prints a warning at start when ImageMagick (`convert`) is not found.
  Without it the service skips upscaling and the stamp pass, so classification stamps in images
  are not read; it used to do this silently. The README, the deployment guide and the detection
  notes now describe ImageMagick as needed for images.
- A failed request is answered with "internal error"; the error code or name goes to the service
  log instead of to the caller (CodeQL finding). The version number is fully escaped before it
  is used in a regular expression in `scripts/release.js` and `eval/version-check.js`.
- CI has a second job that runs the document tests, the browser tests and the screenshot
  benchmark with the held-out seed. On the CI machine (18 November 2026) the benchmark masked
  70 of 72 values, left none readable and blocked 7 of 8 classified memos, close to the
  17 November re-run. This seed had been used before, so it is a regression check and the
  September figures stay the ones to quote.
- `package-lock.json` is committed, so every install gets the same versions of the two
  test-only packages (Playwright 1.65.1, sharp 0.35.5), and the second CI job installs with
  `npm ci`. The screenshot benchmark depends on the browser build, so this keeps its numbers
  comparable between runs. The extension and the inspection service still have no dependencies.
- Dependabot opens one grouped pull request a week for npm and one for GitHub Actions, in
  place of one per package.

- `npm test` now fails when a text set scores below the published numbers
  (`eval/check-results.js`). Before, `eval/run.js` printed and recorded its results but a
  regression did not stop the run.
- `eval/docs-check.js` compares thirty figures quoted in `README.md` and `EVALUATION.md` (text
  sets, screenshots, documents, real-browser, audit and tamper tests) with the recorded
  `eval/results-*.json` files, and `npm test` fails when one differs or when a quoted row is
  reworded without updating the check. It only reads; no figure and no result file was changed
  to add it.
- `eval/version-check.js`: the version in `package.json`, the manifest, `integrity.json`, the
  README badges and this file must agree, and the integrity file list in `background.js` must
  equal the one in `server/integrity.js`.
- `eval/FROZEN-english.sha256`: a checksum for the English held-out set, as the Arabic sets
  already had. It was written on 17 November 2026 from the file as published in v0.7.0, so
  it guards against changes from now on; it does not prove anything about earlier dates.
- A pre-commit hook (`npm run hooks` to enable it) refuses commits that change a frozen test
  set or a recorded first-run result, and checks `integrity.json` when extension code changes.
- GitHub Actions runs `npm test` on Node 18, 20 and 22 on every push and pull request.
- `npm version <x.y.z>` runs the tests, copies the version into the manifest and the README
  badge, and regenerates `integrity.json` (`scripts/release.js`).
- Pushing a tag such as `v0.7.1` runs a release workflow: it checks that the tag equals the
  version in `package.json`, runs `npm test`, zips `extension/` and attaches the zip to a GitHub
  Release. The release notes carry the fingerprint from `server/integrity.json` and the SHA-256
  of the zip, so an administrator can compare both with what the devices report.
- Dependabot configuration, a pull-request checklist and an `.editorconfig`. A compiled Python
  file that had been committed by mistake was removed.

## 0.7.0 (17 November 2026, after the SAIF submission)

**Tamper resistance and administrator alerts.**
This is the feature first built as 0.5.0 on 11 November; see the note under 0.5.0 below.
- The extension sends a heartbeat to the inspection service with how it was installed and a
  SHA-256 fingerprint of `manifest.json`, `engine.js`, `content.js` and `background.js` as they
  are on disk. New managed settings: `deviceId`, `heartbeatSeconds`. New permissions: `alarms`,
  `management`. Minimum Chrome version is now 120.
- The service keeps a device registry and raises administrator alerts: `heartbeat-lost`,
  `heartbeat-restored`, `not-force-installed`, `integrity-mismatch`, `extension-uninstalled`.
  New endpoints `/heartbeat`, `/devices`, `/alerts`, `/alerts.cef`, `/uninstalled`, and an
  `/admin` page. New settings `SADIN_HEARTBEAT_GRACE_S`, `SADIN_ALERT_WEBHOOK`,
  `SADIN_DATA_DIR`, `SADIN_INTEGRITY_FILE`.
- `node server/integrity.js` records the expected fingerprint of a release;
  `--check` verifies it.
- Lock-down policy templates in `deploy/policies/` (Chrome on Linux and Windows, Edge on
  Windows; the Windows and Edge files are untested).
- Managed settings that arrive after start-up are picked up immediately.
- Tests: lab run on Chrome under a real managed policy, 19 of 19 checks, run twice
  (`eval/tamper/tamper_test.py`); server test, 19 of 19 (`eval/tamper/server-test.js`).
  See `docs/TAMPER-RESISTANCE.md`.

**Audit fixes (17 November 2026).** A review of the merged code found these, all fixed and
each covered by a test (`eval/e2e-audit.js`, 16 of 16; `eval/robustness.js`, 14 of 14;
`eval/server-hardening-test.js`, 3 of 3):
- A PDF or Office file renamed to a text extension (`.txt`, `.log`, `.md`...) was scanned as
  unreadable bytes and passed. The first bytes of a file now decide how it is inspected.
- UTF-16 text files, as Notepad and PowerShell write them, were read as UTF-8 and passed
  unread. They are now decoded before scanning.
- **Detection engine 0.4.1:** zero-width characters, direction marks, the soft hyphen, the
  byte-order mark and the Arabic tatweel are ignored when matching, so "ســري للغاية" or a
  keyword with a hidden character in it is caught. Results on the four text sets are unchanged.
- Typed text was only checked when the send button carried a recognisable label. Every button
  click and form submission is now checked against the composer.
- The upload listener ran after listeners a page puts on `window`, so a page could read the
  original files. It now runs first.
- Decisions made while the inspection service was unreachable were kept locally but never
  forwarded. They are now queued and sent when the service answers again.
- The inspection service refuses to listen on a network address without `SADIN_TOKEN`, and
  without a token it refuses requests that arrive under another host name (DNS rebinding).
- `eval/ocr-eval.js` had a path from the development machine in it. Added `package.json`,
  which lists the two test-only packages and gives `npm test`.
- Nine weaknesses that are not fixed are recorded as known gaps in `eval/robustness.js` and in
  EVALUATION.md, section 5f.

**Full re-run.** Every test in the repository was run again on 17 November 2026 on the merged
code. Text, Arabic, document, label and real-browser results are unchanged. The screenshot
benchmark gave 69 of 72 values masked (unchanged) and 7 of 8 classified memos blocked (8 of 8
in September): the benchmark depends on the browser and fonts that draw its images. See
EVALUATION.md, section 5e.

**Documentation**
- The extension is described as tested on Chrome. Edge is the same extension format but has
  not been tested, and the README no longer says otherwise.
- New `docs/TAMPER-RESISTANCE.md` and a report addendum,
  `docs/SADIN_Report_Addendum_v0.7.0.pdf`. The submitted report and poster are kept as they
  were.

## 0.6.0 (15 November 2026, after the SAIF submission)

Built on the published 0.4.0 code while the 0.5.0 tamper work was still unpublished.

**PDF and Word (.docx) inspection.** The detection engine is unchanged (v0.4.0).
- New `POST /inspect/file` on the inspection service (`server/files.js`, no npm dependencies;
  needs `poppler-utils` and `qpdf`). PDF: text layer, form fields, comments, link targets,
  properties, and OCR for scanned or picture-carrying pages. Word: body, tables, text boxes,
  headers, footers, notes, comments, tracked deletions, link targets, properties, chart labels,
  and OCR for embedded pictures.
- The extension sends PDF and Word files to the service instead of blocking them outright. A
  clean file passes; a file with protected content is held back whole, with the reason and the
  data classes in the notice. Documents are not redacted in place yet.
- Fail closed: encrypted, damaged or oversized documents, attachments, embedded objects, macros
  and unknown components are reported as uninspectable and follow `uninspectableFiles`; if the
  service is unreachable the file is blocked.
- Tests: 60 test documents (60 of 60 as expected), the 150 held-out items as documents (150 of
  150 in .docx; 149 and 148 of 150 in PDF on the first run), and a real-browser upload test (10
  of 10, plus 2 of 2 with the service stopped). See EVALUATION.md, section 5b.

**Sensitivity labels.**
- `server/labels.js` reads the label a document already carries: Microsoft Purview metadata
  (`MSIP_Label_<GUID>_...` properties in Word and PDF, the Word label list in
  `docMetadata/LabelInfo.xml`) and plain classification properties. Names and GUIDs map to the
  four NDMO levels through the `labels` section of `server/policy.json`.
- A labelled document is held back by its level even when its text has nothing the detectors
  recognise. Public passes; a label with no rule is held back. The notice names the label.
- Tests: 20 labelled documents with harmless text (20 of 20 as expected) and 4 real-browser
  cases. Two more files record a known gap: LibreOffice drops the label on PDF export and
  drops the Word label list on re-save. No file from a real Purview tenant has been tried.

**Fixes**
- The file input is emptied while files are being inspected, so the page cannot read the
  originals in the meantime.
- The notice now shows why a file was held back.

## 0.5.0 (11 November 2026, never published)

Tamper resistance and administrator alerts were first built and lab-tested on this date (18 of
19 checks; guest mode could not be exercised then). The package was not published to this
repository and was not kept. The feature was rebuilt to the same design in 0.7.0, and the
0.7.0 test results replace the 0.5.0 ones.

## 0.4.0 (24 to 26 September 2026)

**Arabic**
- Arabic-Indic and Eastern Arabic-Indic digits are normalised before scanning, one-to-one, so
  redaction still covers the original characters.
- New Arabic detectors for passwords, accounts, host names, port lists, the colloquial "بورت"
  and Arabic security-finding wording; keywords tolerate diacritics and a few words between the
  keyword and the value.
- Arabic held-out set: 50.0% of items caught on v0.3.1, 36 of 36 on v0.4.0, with 1 false
  positive in 40 clean prompts.

**Inspection service hardening**
- Browser requests are accepted only from the SADIN extension (optionally pinned with
  `SADIN_EXTENSION_IDS`); previously any web page could read the decision log and write events.
- Optional shared token (`SADIN_TOKEN`, header `X-SADIN-Token`), pushed to the extension as the
  managed `serverToken` setting.
- Control characters are stripped from logged fields and CEF values are escaped, closing a way
  to forge extra lines in the SIEM feed.
- CEF records carry the real engine version.

**Other**
- Real-browser test (`eval/e2e-browser.js`) with the extension loaded in Chromium.
- Screenshot regression run on the previous seed: 71 of 72 values masked, 8 of 8 classified
  memos blocked.

## 0.3.1

- Fixes for the misses found by the first English held-out run: SSH and WinRM ports, `mysql -p`
  passwords, "password was changed to …", basic-auth pairs, Arabic usernames and "مستند مصنف".
- Screenshot held-out run: 69 of 72 values masked, 8 of 8 classified memos blocked.

Bugs found by the test checks and fixed during the 0.3 series:
- Placeholder loop: the engine re-detected its own `[SECRET_1]` placeholders, so a redacted
  message could never be sent.
- Passwords inside URLs were mislabelled as email accounts.
- Boxed classification stamps were skipped by page segmentation; a coloured-ink OCR pass now
  reads them separately.

## 0.3.0 (22 September 2026)

- First English held-out run, frozen before the run and not tuned afterwards: 86.3% of
  sensitive items caught (44 of 51), 0 false positives on 50 clean prompts. This remains the
  headline figure.
