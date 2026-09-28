# Evaluation
**SAIF 2026 · Track 02, Cybersecurity and Defensive Technologies · engine v0.4.0 · 24 September 2026**

This annex documents how the SADIN prototype was tested and what it scored. Everything here can be reproduced from the source in this repository. The README summarises the same results.

---

## 1. What was built

| Component | State | Where |
|---|---|---|
| Browser extension (Chrome/Edge, Manifest V3) | Working | `extension/` |
| Detection and redaction engine (shared by extension, server and tests) | Working | `extension/src/engine.js` |
| On-premises inspection service (image OCR, policy, event log, CEF export) | Working | `server/server.js` |
| Local test page (simulated AI chat, offline demo) | Working | `demo/` |
| Real-browser test (extension loaded in Chromium) | Working | `eval/e2e-browser.js` |
| Evaluation harness and test sets | Working | `eval/` |
| Endpoint agent, ML classifier, enterprise tenant, gateway | Not built (design only) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

Channels the prototype intercepts today: pasted text, typed text at send time, dragged text, file uploads (text formats), drag-and-drop files, and pasted or uploaded images. Files it cannot parse yet (PDF, Office, archives) are blocked rather than allowed through, following the fail-closed rule in the design.

## 2. Method

Two kinds of test, both written before the runs they report.

**Text.** A development set (111 sensitive messages with 155 labelled items, and 100 clean business prompts) was used while building the detectors. A separate **held-out set** (30 sensitive messages with 51 items, 50 clean prompts, different phrasings and formats) was frozen and then run **once**, with no tuning afterwards. The held-out numbers are the ones quoted in the README, the poster, the submission form and the video.

**Screenshots.** Twenty images are generated from templates (SOC dashboard, router terminal, HR portal, and Arabic memos marked either with a classification stamp or with a written classification line such as "التصنيف: سري"), each seeded with known values. The exact on-screen position of every seeded value is taken from the DOM, so "was it masked" is measured against the true rectangle, not against what OCR happened to read. The masked image is then OCR'd a second time to check that nothing is still readable. The reported run uses a seed not used during development.

Metrics:
- **Item recall:** a sensitive value counts as caught only if a finding of the correct category covers it.
- **Residual leak:** the value still appears in the text (or is still readable in the image) after redaction.
- **False positive:** any finding at all on a clean prompt.
- **Re-scan:** the redacted text is scanned again; it must not trigger a second block (this caught a real bug, see §6).

## 3. Results: text (held-out set, first run, no tuning)

| Metric | Result |
|---|---|
| Sensitive items caught | **86.3%** (44 / 51) |
| Messages flagged | 93.3% (28 / 30) |
| Classified markings blocked | 5 / 6 |
| Values still present after redaction | 6 / 45 |
| False positives | **0 / 50 clean prompts** |
| Latency per message | 0.01 ms median, 0.06 ms p95 (quoted as under 0.1 ms) |
| Latency, 1 MB pasted file | ~0.2 s |

After those misses were fixed (v0.3.1), both the development set and the held-out set score 100% item recall with 0 false positives on 150 clean prompts, but the held-out set is no longer independent once it has been used for fixes, so **86.3% is the honest headline figure**.

## 4. Results: screenshots (seed not used in development, single run, v0.3.1)

| Metric | Result |
|---|---|
| Seeded values fully masked | **95.8%** (69 / 72) |
| Still readable after masking (re-OCR) | 1 / 72 |
| Classified Arabic memos blocked (4 with a stamp, 4 with a written classification line) | **8 / 8** |
| Non-classified images wrongly blocked | 0 / 12 |
| Latency, median per image | 1.7 s (max 3.6 s) |

Remaining misses: two short lowercase hostnames (`dc01`, `dc04`) and one internal IP that OCR read with a corrupted octet.

Regression check on engine v0.4.0 (24 September 2026): the same seed re-run after the Arabic changes masked 71 of 72 values (98.6%), blocked all 8 classified memos and left nothing readable. This seed had already been used, and the Arabic OCR model on the test machine may differ from the first run, so this is a check that nothing broke, not a new headline; **95.8% stays the reported figure**. Raw output: `eval/results-ocr-seed990011-RERUN-v0.4.0.json`.

## 5. Results: Arabic (added 24 September 2026, engine v0.4.0)

Employees in Saudi Arabia write to AI tools in Arabic, in English, or in both at once, so Arabic is tested on its own.

**Method.** Two new Arabic sets of workplace prompts in Saudi phrasing, formal and colloquial ("الباسوورد", "اليوزر", "بورت"), with Arabic-Indic and Western digits and mixed Arabic/English text:

- **Development set** (`eval/arabic-dev.js`): 34 sensitive messages with 47 items, 38 clean prompts. Used to find and fix the Arabic gaps.
- **Held-out set** (`eval/arabic-holdout.js`): 30 sensitive messages with 36 items, 40 clean prompts, different phrasings. Written and hashed (`eval/FROZEN-arabic.sha256`) before any engine change, not used for tuning, and run once after the fixes.

**Before the fixes (engine v0.3.1).** The previous engine caught only about half of the Arabic items:

| Set | Items caught | False positives |
|---|---|---|
| Arabic development | 48.9% (23 / 47) | 0 / 38 |
| Arabic held-out | 50.0% (18 / 36) | 1 / 40 |

The main gaps were Arabic-Indic digits (١٠.١٥.٢.٢٠ and ٨٤٤٣ were not recognised at all), colloquial words for passwords and accounts, keywords separated from the value by a few words ("كلمة السر حقت الإيميل: …"), lists of ports ("المنافذ ٢١ و٢٢ و٣٣٨٩") and Arabic wording around CVEs ("لم تُرقّع").

**What changed in v0.4.0.** Digits are normalised before scanning (one-to-one, so redaction still covers the original characters); new Arabic detectors cover passwords, accounts, host names, port lists, the colloquial "بورت", and Arabic security-finding wording; Arabic keywords tolerate diacritics.

**After the fixes, held-out set, first run (engine v0.4.0):**

| Metric | Result |
|---|---|
| Sensitive items caught | **100% (36 / 36)** |
| Classified markings blocked | 4 / 4 |
| Values still present after redaction | 0 / 29 |
| False positives | **1 / 40 clean prompts** |
| Latency, median per message | 0.02 ms |

The set was run a second time on 26 September 2026, with the same engine (v0.4.0) and the same frozen test file, and gave identical results (`eval/results-arabic-holdout.json`). The first run is kept as `eval/results-arabic-holdout-FIRST-RUN-v0.4.0.json`.

The one false positive is a genuine question about the concept ("وش يعني مستوى التصنيف مقيد في سياسات البيانات؟"), which was blocked because it contains a classification phrase. It is reported as it happened and was not tuned away.

**Read this number with care.** 36 of 36 on a small set written by the same team that wrote the detectors is an optimistic figure. It shows the Arabic gaps found in development generalise to new phrasings; it does not show that SADIN catches every Arabic secret in real traffic. The English sets were re-run on v0.4.0 as a regression check: still 100% of items with no false positives, but those sets are no longer independent, so the English headline stays at 86.3% from the first run.

**Real-browser test.** `eval/e2e-browser.js` loads the actual extension into Chromium, types messages into the local test page and records what reaches the simulated AI vendor. Result on 24 September 2026:

- Arabic message with an Arabic-Indic IP address, port, username and password: all four replaced with placeholders; the question and the request to answer in Arabic reached the AI tool intact.
- Ordinary Arabic request (a leave email): passed through unchanged.
- English mysql command with an IP and password: both redacted.

Screenshot: `shots/06-arabic-redacted.png`.

## 6. Bugs the tests found

- **Placeholder loop.** The engine re-detected its own `[SECRET_1]` placeholders, so a redacted message could never be sent. Found by the re-scan check, fixed.
- **Passwords inside URLs** were swallowed by the account-email pattern and mislabelled.
- **Arabic port numbers** (`المنفذ 8443`) were never matched, because word boundaries do not work in Arabic script.
- **Boxed classification stamps** are skipped by ordinary page segmentation; a coloured-ink pass now crops each stamp and reads it with the Arabic model separately.
- **Inspection-server access control (fixed 26 September 2026).** A security review found that the server answered any web page (`Access-Control-Allow-Origin: *`, no authentication), so a site the employee visited could read the decision log or write fake events, and a line break in a logged field could forge an extra line in the CEF export. The server now accepts browser requests only from the SADIN extension, supports a shared token (`SADIN_TOKEN`) for deployment, and strips control characters from logged fields. The detection engine and all results above are unchanged.

## 7. Limitations: read this before quoting the numbers

1. The test sets are **synthetic and written by the team**. They are not a sample of real employee traffic, and they cannot prove how SADIN behaves on an organisation's real data. A pilot with real, consented traffic is the next step.
2. The same people wrote the detectors and the test sets. The held-out procedure reduces but does not remove that bias.
3. Arabic coverage was narrower than English until v0.4.0 (about 50% of Arabic items before, 36 of 36 on the Arabic held-out set after). The Arabic sets are small and written by the team, so real Arabic traffic in a pilot is the real test.
4. Image inspection needs the on-premises service running. If it is unreachable, images are blocked, which is safe but inconvenient.
5. PDF and Office files are not parsed yet, so a secret inside a .docx is blocked as a whole file rather than redacted.
6. Screenshot OCR at ~1.7 s per image is acceptable for a paste but not for bulk uploads.
7. Nothing stops a photograph of the screen taken with a personal phone. That is a policy and awareness matter; see [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## 8. Reproducing the results

```bash
# text benchmarks
node eval/run.js                      # English development set
node eval/run.js --holdout            # English held-out set
node eval/run.js --set=arabic-dev     # Arabic development set
node eval/run.js --set=arabic-holdout # Arabic held-out set
sha256sum -c eval/FROZEN-arabic.sha256

# real-browser test (needs: node demo/serve.js running, npm i -g playwright)
node eval/e2e-browser.js

# screenshot benchmark (needs tesseract with ara+eng, ImageMagick, playwright, sharp)
TESSDATA_PREFIX=/path/to/tessdata SADIN_SEED=990011 node eval/ocr-eval.js

# run the prototype
node server/server.js          # on-prem inspection service, port 8787
                               # deployment: SADIN_TOKEN=<secret> SADIN_EXTENSION_IDS=<extension id>
node demo/serve.js             # local test page, port 8788
# then load extension/ in Chrome: chrome://extensions > Developer mode > Load unpacked
```

Raw outputs: `eval/results-holdout-FIRST-RUN-v0.3.0.json`, `eval/results-arabic-holdout-BASELINE-v0.3.1.json`, `eval/results-arabic-holdout-FIRST-RUN-v0.4.0.json`, `eval/results-corpus.json`, `eval/results-ocr-HELDOUT-seed990011.json`.
