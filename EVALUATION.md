# Evaluation
**SAIF 2026 · Track 02, Cybersecurity and Defensive Technologies · engine v0.4.1 · first written 24 September 2026, last updated 17 November 2026 (release v0.7.0)**

This annex documents how the SADIN prototype was tested and what it scored. Everything here can be reproduced from the source in this repository. The README summarises the same results.

---

## 1. What was built

| Component | State | Where |
|---|---|---|
| Browser extension (Manifest V3) | Working; tested on Chrome and Chromium, Edge not tested | `extension/` |
| Detection and redaction engine (shared by extension, server and tests) | Working | `extension/src/engine.js` |
| On-premises inspection service (image OCR, policy, event log, CEF export) | Working | `server/server.js` |
| PDF and Word (.docx) inspection (added 15 November 2026, v0.6.0) | Working | `server/files.js` |
| Sensitivity labels in PDF and Word metadata (added 15 November 2026, v0.6.0) | Working on test files; no real tenant file tried | `server/labels.js` |
| Tamper resistance and administrator alerts (added 17 November 2026, v0.7.0) | Working on Chrome on Linux; Windows and Edge not tested | `extension/src/background.js`, `server/server.js`, `deploy/policies/` |
| Local test page (simulated AI chat, offline demo) | Working | `demo/` |
| Real-browser test (extension loaded in Chromium) | Working | `eval/e2e-browser.js` |
| Evaluation harness and test sets | Working | `eval/` |
| Endpoint agent, ML classifier, enterprise tenant, gateway | Not built (design only) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

Channels the prototype intercepts today: pasted text, typed text at send time, dragged text, file uploads (text formats), drag-and-drop files, pasted or uploaded images, and, since v0.6.0, PDF and Word (.docx) files (section 5b). Files it cannot read (password-protected or damaged documents, Excel, PowerPoint, legacy Office formats, archives) are blocked rather than allowed through, following the fail-closed rule in the design.

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

## 5b. Results: PDF and Word files (added 15 November 2026, v0.6.0, after the SAIF submission)

The submitted report and poster describe document parsing as Phase 2. This section covers what was added afterwards. The detection engine did not change (still v0.4.0); the new code only gets the text out of a document and hands it to the same engine. A document cannot be redacted in place yet, so the outcome for a file is one of three: let through, held back whole, or refused as uninspectable (the organisation's `uninspectableFiles` policy then applies, block by default).

**What is read.** PDF: the text layer, form-field values, comments and sticky notes, link targets and document properties; pages that carry pictures, and PDFs with no text layer, are rendered and read with the existing OCR. Word: body, tables, text boxes, headers, footers, footnotes, endnotes, comments, text deleted with Track Changes, hyperlink targets, document properties, chart labels and embedded pictures (OCR).

**Test 1: where a secret can hide (development set, 60 documents).** `eval/file-fixtures/`, each with one expected outcome in `manifest.json`. Built by `eval/files-build.js`: Word files written directly, PDFs exported by LibreOffice, printed from Chrome, assembled from page images (scans) or written by hand (annotations, form fields). This set was used while writing the code, so it is a regression test, not an independent measurement.

| Expected outcome | Result |
|---|---|
| Held back: secret in body text (English, Arabic right-to-left, Arabic in a left-to-right paragraph), table, header, footer, footnote, comment, hyperlink target, tracked deletion, value split across formatting runs, embedded screenshot, chart title, text box, document title, classification marking, scanned page, sticky note, form field | 35 of 35 |
| Let through: clean English and Arabic documents, with and without a harmless picture, clean scan | 11 of 11 |
| Refused as uninspectable: password to open, copy-restricted, 61 pages, 9 scanned pages, attachment inside the PDF, damaged, macros, embedded spreadsheet, unreadable picture format, too many pictures, unknown component, a spreadsheet renamed to .docx, legacy Office container | 14 of 14 |

Time per document on the test machine: 1 to 3 ms for a .docx, about 40 ms for a text PDF, 0.3 to 2 s when a page or picture goes through OCR.

**Test 2: does a document give the same decision as the same text pasted? (held-out items, 150 documents per format).** Every item of the two frozen held-out sets (`holdout.js`, `arabic-holdout.js`: 60 sensitive, 90 clean) was written into a .docx, a LibreOffice PDF and a Chrome PDF. The engine flags 61 of the 150 as pasted text (the 60 sensitive items and the one known Arabic false positive). The held-out files themselves were not changed.

| Format | Same decision as pasted text, first run | After the fixes below |
|---|---|---|
| Word (.docx) | 150 of 150 | 150 of 150 |
| PDF exported by LibreOffice | 149 of 150 | 149 of 150 |
| PDF printed from Chrome | 148 of 150 | 150 of 150 |

No clean item was held back in any format. The first run lost two Arabic items, and both were examined:

- **AH10** (lost in both PDF kinds). The PDF text extractor returns the two letters of the Arabic lam-alef ligature in swapped order, so "الاختراق" arrives as "االختراق" and the Arabic security-finding wording no longer matches. The extractor now also reads the text with that swap undone after the definite article, which recovers the Chrome PDF. The LibreOffice PDF has a second swapped pair inside the same word ("الخرتاق") that depends on the font, and is still missed.
- **AH16** (lost in the Chrome PDF). A fault in the test page, not in SADIN: the long token ran off the edge of the printed page, so most of it was not in the PDF at all. The test page now wraps long words and the item is caught.

Because these fixes were made after seeing held-out items, the first-run column is the one to quote. Raw outputs: `eval/results-files.json`, `eval/results-files-bulk-FIRST-RUN.json`, `eval/results-files-bulk.json`.

**Test 3: real browser.** `eval/e2e-files.js` loads the extension in Chromium and picks fourteen of the test documents on the local test page: the ten described here and four labelled ones (section 5c), 14 of 14 as expected. Of these ten: The four clean ones (English PDF, Arabic PDF, Arabic Word file, clean scan) reached the page; the six others (passwords in a PDF, an Arabic PDF, a Word comment and a scan; a password-protected PDF; a Word file with an embedded spreadsheet) did not. With the inspection service stopped, a clean PDF and a clean Word file were both held back: 2 of 2 (fail closed). Screenshot: `shots/07-pdf-held-back.png`.

**What this does not show.** No PDF written by Microsoft Word, Acrobat or a phone scanner app was tested, and no document from a real organisation. Arabic keyword matching in PDFs remains weaker than in pasted text or Word files because of the letter-order problem above; values such as addresses, passwords and tokens are not affected by it.

## 5c. Results: sensitivity labels (added 15 November 2026, v0.6.0, after the SAIF submission)

The detectors above need something recognisable in the text. A document with no pattern in it (a strategy paper, minutes of a board meeting) gives them nothing. Where the organisation has already classified the document, the classification is written in the file itself, and SADIN now reads it: Microsoft Purview Information Protection metadata (`MSIP_Label_<GUID>_...` custom properties and the `docMetadata/LabelInfo.xml` label list in Word files; the same properties in a PDF's document information and XMP metadata) and plain classification properties (`Classification`, `Sensitivity`, `التصنيف`). Label names and GUIDs are mapped to the four NDMO levels; by default Top Secret, Secret and Restricted are held back, Public passes, and a label with no rule is held back. The content is still scanned, so a file labelled Public with a password in it is held back as before.

**Test (development set, 22 documents, all with harmless text).** In `eval/file-fixtures/`, names starting `d40` to `d54` and `p60` to `p66`; the expected outcome and the expected reason are both checked.

| Case | Result |
|---|---|
| Held back because of the label: named Restricted; Arabic name "سري للغاية"; sub-label "Confidential \ Finance"; the organisation's own label name mapped in the policy; label GUID mapped in the policy (Word label list, PDF properties); plain classification property (Arabic in Word, English in PDF); label in PDF properties and in PDF XMP; label kept after the file was re-saved by LibreOffice | 11 of 11 |
| Held back because the label has no rule: unmapped GUID (Word, PDF), unknown label name | 3 of 3 |
| Held back because of the content, although labelled Public | 1 of 1 |
| Let through: labelled Public (Word, PDF), label marked as removed, label switched off, custom properties that are not labels | 5 of 5 |

For the eleven files held back by their label, the engine's own decision on the text was "allow" in every case: the label alone decided.

**Known gap, recorded as two more test files.** A label only helps while it is still in the file. LibreOffice dropped the Word label list when it re-saved a labelled file, and did not copy the label when it exported a labelled Word file to PDF; both results went through, because nothing in them said Restricted any more. Whether a label survives depends on the tool that writes the copy.

**Real browser.** Four of the fourteen cases in `eval/e2e-files.js`: harmless Word files labelled Restricted and "سري للغاية" and a harmless PDF labelled Secret were held back; a harmless Word file labelled Public reached the page. Screenshot: `shots/08-labelled-held-back.png`.

**What this does not show.** The labelled files were written by the test builder from Microsoft's published format ([MS-OFFCRYPTO], sensitivity label metadata). No file labelled by a real Microsoft Purview tenant was available, and that is the first thing to check in a pilot. Labels do nothing for pasted text, for documents nobody labelled, or for a label protected by encryption (such a file cannot be opened at all and is refused as uninspectable). Unlabelled, pattern-free documents remain unsolved; fingerprinting of registered documents and a local classifier are the planned next steps.

## 5d. Results: tamper resistance and administrator alerts (added 17 November 2026, v0.7.0, after the SAIF submission)

Requirement: the employee cannot switch SADIN off, and the administrator is told when protection stops on a device. Prevention is done by browser policy (force-install, no Incognito, no guest mode); detection by a heartbeat that carries the install type and a fingerprint of the extension's files. Full description, tables and limits: [docs/TAMPER-RESISTANCE.md](docs/TAMPER-RESISTANCE.md). This feature was first built on 11 November as 0.5.0 and scored 18 of 19 then; that package was never published and was not kept, so it was rebuilt, and the numbers here are from the rebuilt code only.

**Lab run (`eval/tamper/tamper_test.py`).** Chrome for Testing 153 on Linux, the extension packed as a signed CRX and force-installed from a local update server by a real managed-policy file, heartbeat every 30 s, server grace period 75 s. Run twice on 17 November 2026; every check had the same outcome in both runs.

| Group | Checks | Result |
|---|---|---|
| Policy in place: installed with no user action, reports as installed by policy with matching files, extensions page offers no control, disable refused, remove refused, Incognito refused | 6 | 6 of 6 |
| Files on disk: script edited (alert in 25 s), original restored (back to ok), engine file deleted (alert in 30 s), whole folder deleted (browser did not repair it; `heartbeat-lost` after 68 s) | 4 | 4 of 4 |
| Guest mode: refused with the policy; a guest session without SADIN opens when the policy is missing (control) | 2 | 2 of 2 |
| Policy file deleted by someone with administrator rights (extension removed in 5 s, `heartbeat-lost` after 71 s); policy restored (extension back in 5 s, `heartbeat-restored`) | 2 | 2 of 2 |
| No policy: `not-force-installed` raised in 4 s; the user can disable the extension (control); Incognito opens (control); `heartbeat-lost` after 76 s | 4 | 4 of 4 |
| Administrator page lists the devices and all alerts | 1 | 1 of 1 |
| **Total** | **19** | **19 of 19** |

Four of the 19 are controls: they confirm that the same actions succeed when the policy is absent, so the refusals come from the policy and not from the way the test asks.

**Server test (`eval/tamper/server-test.js`).** The server alone, with plain HTTP calls in place of the extension: 19 of 19. It checks the token and origin rules on the new endpoints, that a condition is alerted once and not on every heartbeat, that a version with no recorded fingerprint is marked unchecked, that the uninstall address needs its key, that line breaks cannot forge an alert line, the CEF export, and that every alert (10 of 10) reached a local webhook receiver.

**What this does not show.** Nothing was run on Windows or on Edge; the policy files for both are templates. Developer tools and new browser profiles are switched off in the templates but were not part of the run. The fingerprint is computed by the extension, so a rewritten background script that keeps reporting the old value is not caught. A silent device cannot be told apart from one that is switched off. The uninstall address did not fire when the browser removed the extension. The webhook was tested against a local receiver, not a real mail relay or Teams. Raw outputs: `eval/results-tamper-lab.json`, `eval/results-tamper-lab-RUN1.json`, `eval/results-tamper-server.json`.

## 5e. Full re-run on 17 November 2026 (release v0.7.0)

After the three post-submission additions were merged and the audit fixes of section 5f were made, every test in the repository was run again on one machine: Chrome for Testing 153 and Playwright's Chromium, Node 22, Tesseract 5.3.4 with the `tessdata_fast` Arabic and English models, ImageMagick 6.9, LibreOffice. This is a different machine from the September runs. The detection engine is v0.4.1 (v0.4.0 plus the invisible-character fix of section 5f).

| Test | Earlier result | 17 November 2026 |
|---|---|---|
| English development set | 155 of 155 items, 0 of 100 false positives | Same |
| English held-out set, first run on v0.3.0 (the headline) | 44 of 51 items (86.3%), 0 of 50 false positives | Not repeatable by design: a first run happens once |
| English held-out set on the current engine (regression check, not independent) | 51 of 51, 0 of 50 | Same |
| Arabic development set | 47 of 47 items, 0 of 38 false positives | Same |
| Arabic held-out set | 36 of 36 items, 1 false positive in 40 | Same |
| Frozen Arabic set checksum | Matches | Matches |
| Screenshots, held-out seed: values masked | 69 of 72 (95.8%) | 69 of 72 |
| Screenshots: values still readable after masking | 1 of 72 (first run), 0 (v0.4.0 re-run) | 0 of 72 |
| Screenshots: classified memos blocked | 8 of 8 | **7 of 8** (one boxed stamp "سري" was not read) |
| Document test set (60 structural + 20 labelled + 2 known gaps) | 82 of 82 as expected | Same |
| Held-out items as documents | 150 of 150 (.docx), 149 (LibreOffice PDF), 150 (Chrome PDF) after fixes | Same |
| Real browser, text (3 scenarios) | 3 of 3 | Same |
| Real browser, uploads | 14 of 14, and 2 of 2 with the service stopped | Same |
| Tamper lab | not in the repository before | 19 of 19, twice |
| Tamper server test | not in the repository before | 19 of 19 |

**The screenshot difference.** The benchmark does not use stored pictures. It draws its twenty screenshots with the local browser and the fonts installed on the machine, then reads them with the local OCR models. This machine has a newer browser build than the September one and may have different fonts, and one of the four boxed stamps was missed, so that memo was let through as an image. The eight-of-eight figure is therefore true of the September environment and is not guaranteed elsewhere. Stamp reading on short boxed Arabic words is the least robust part of the image pipeline.

A second observation from the same re-run: with the IBM Plex Sans Arabic font installed, as the test page's stylesheet asks for, only 46 of 72 values meet the "at least 80% of the rectangle covered" rule, most of the others at 79%, while 0 of 72 are readable after masking. The likely reason is that the rectangle taken from the page includes the empty space above and below the letters, which is taller in that font, while the mask covers the ink; this was not investigated further. Either way the coverage rule is sensitive to the font, and the "readable after masking" count is the more stable of the two measures. The rule has not been changed after the fact. Raw outputs: `eval/results-ocr-seed990011-RERUN-2026-11-17.json` (default fonts) and `eval/results-ocr-seed990011-RERUN-2026-11-17-plex-fonts.json`.

The September first-run figures remain the ones to quote, with this caveat attached.

## 5f. Code audit of 17 November 2026: what was found, what was fixed, what was not

Before publishing v0.7.0 the merged code was read for ways around it and for faults, and each suspicion was tried against the real engine or the real extension. This is not a penetration test by an outside party; it was done by the same team with AI assistance.

**Found and fixed.** Each has a test that fails on the old code.

| # | Fault | Why it mattered | Fix |
|---|---|---|---|
| 1 | A PDF or Word file renamed to `.txt`, `.log` or `.md` was read as text. The compressed content is unreadable that way, so the scan found nothing and the file passed, password, label and all | A wrong extension is all it took, by accident or on purpose | The first bytes of a file decide: PDF and Office containers go to the inspection service whatever they are called, and other binary data named as text is refused |
| 2 | UTF-16 text files were read as UTF-8 and passed unread | Windows Notepad ("Unicode") and PowerShell redirection write UTF-16, so `ipconfig > out.txt` produced a file SADIN could not read | Files with a UTF-16 byte-order mark are decoded before scanning |
| 3 | An invisible character or an Arabic tatweel inside a keyword or value hid it: "ســري للغاية", `pass`+zero-width space+`word`, a right-to-left mark after "كلمة المرور:" | Arabic text copied from Word, web pages and chat apps carries direction marks and stretched letters routinely | Engine v0.4.1 removes these characters before matching and maps the findings back onto the original text |
| 4 | Typed text was checked on Enter, or on a click on a button whose label contained "send", "submit" or "إرسال". A send button with no label (an icon) skipped the check | Paste and upload were not affected, but a typed password could leave | Every button click and form submission is checked against the composer |
| 5 | The upload listener was registered on `document`; a page listener on `window` runs earlier and could read the original files before inspection | Depends on how the AI site is written | The listener is registered on `window` at document start, before any page script |
| 6 | Decisions logged while the inspection service was unreachable were stored locally and never sent | Gaps in the SIEM record exactly when something was wrong | Unsent events are queued (up to 500) and forwarded when the service answers |
| 7 | With no token set, the service answered any request that reached it, including on a network address, and including a web page that re-pointed its own host name at 127.0.0.1 | Demo mode only, but the device registry and decision log could be read | The service will not start on a network address without `SADIN_TOKEN`, and without a token it checks the Host header |

Tests: `eval/e2e-audit.js` in a real browser, 16 of 16 (faults 1, 2, 3, 4, 5 and 6, with clean files and an ordinary Arabic request as controls); `eval/robustness.js` on the engine, 14 of 14 required cases; `eval/server-hardening-test.js`, 3 of 3. The four text sets, the document sets and the other browser tests were re-run after the fixes with unchanged results (section 5e).

**Found and not fixed (known gaps).** The first nine are recorded in `eval/robustness.js`, which prints what the engine does with each today.

| Gap | What happens | Why it is left |
|---|---|---|
| An address written with spaces, as `10[.]20[.]30[.]40`, or in full-width digits; a look-alike letter in a keyword | Passes | Deliberate disguise. SADIN is aimed at accidental leaks; a determined insider is out of scope |
| A password with no keyword near it (`admin / Riyadh77!Qx3`) | Passes | Nothing marks it as a secret, and it is not random enough for the entropy check |
| The single word "سري" as a heading ("محضر اجتماع - سري") | Passes | The word is too common in everyday Arabic. "التصنيف: سري" and "سري للغاية" are caught, and a labelled file is caught by its label |
| "top secret" in lower case inside a sentence | Passes | English markings are matched in capitals or as a labelled line |
| A version number such as 10.2.30.4 | Redacted as an internal address (false positive) | The message still goes |
| Everyday Arabic "سري جداً" | Blocked as a classification level (false positive) | The phrase is also a real marking |
| Text files in a legacy Arabic code page (Windows-1256) | Arabic keywords in them are not recognised; addresses, tokens and Latin-script keywords still are | Not built |
| AI sites not in the manifest | Not covered at all | The list is eight sites; adding one is a one-line change that then needs testing on that site |
| The live AI sites | Untested. Every browser test used the local test page | Needs accounts and a test plan per site; first task of a pilot |
| A site that sends text as it is typed (drafts, suggestions) | Typed text is checked at send time, so earlier requests would carry it | Paste, drop and upload are checked immediately; network-level interception is the planned backstop |
| Formatted clipboard content | Only the plain-text form of a paste is scanned | A page normally takes the plain text; not verified on the live sites |
| "Request exception" | Logs the justification for the security team; there is no approval workflow | Console work, Phase 2 |
| Transport | The service speaks plain HTTP; TLS needs a reverse proxy in front | Deployment guidance |

## 6. Bugs the tests found

- **Placeholder loop.** The engine re-detected its own `[SECRET_1]` placeholders, so a redacted message could never be sent. Found by the re-scan check, fixed.
- **Passwords inside URLs** were swallowed by the account-email pattern and mislabelled.
- **Arabic port numbers** (`المنفذ 8443`) were never matched, because word boundaries do not work in Arabic script.
- **Boxed classification stamps** are skipped by ordinary page segmentation; a coloured-ink pass now crops each stamp and reads it with the Arabic model separately.
- **File-picker window (fixed in v0.6.0).** While an uploaded image was being inspected, the original stayed in the page's file input, where the page could have read it. The input is now emptied before inspection starts and refilled only with what passed.
- **Missing reason in the notice (fixed in v0.6.0).** When a file was held back, the notice did not say why; the reason was dropped when several files were summarised.
- **Extension files are not protected by the browser (found 11 November 2026, covered in v0.7.0).** With the extension hosted outside the Chrome Web Store, an edited script and a deleted engine file went unnoticed by the browser while heartbeats kept arriving. The heartbeat now carries a fingerprint of the files.
- **Installed manifest differs from the released one (found 17 November 2026).** The browser adds a `key` field to `manifest.json` when it installs a packed extension, so a byte-for-byte fingerprint reported every healthy device as modified. The manifest is now compared by content with that field left out.
- **Inspection-server access control (fixed 26 September 2026).** A security review found that the server answered any web page (`Access-Control-Allow-Origin: *`, no authentication), so a site the employee visited could read the decision log or write fake events, and a line break in a logged field could forge an extra line in the CEF export. The server now accepts browser requests only from the SADIN extension, supports a shared token (`SADIN_TOKEN`) for deployment, and strips control characters from logged fields. The detection engine and all results above are unchanged.

## 7. Limitations: read this before quoting the numbers

1. The test sets are **synthetic and written by the team**. They are not a sample of real employee traffic, and they cannot prove how SADIN behaves on an organisation's real data. A pilot with real, consented traffic is the next step.
2. The same people wrote the detectors and the test sets. The held-out procedure reduces but does not remove that bias.
3. Arabic coverage was narrower than English until v0.4.0 (about 50% of Arabic items before, 36 of 36 on the Arabic held-out set after). The Arabic sets are small and written by the team, so real Arabic traffic in a pilot is the real test.
4. Image inspection needs the on-premises service running. If it is unreachable, images are blocked, which is safe but inconvenient.
5. PDF and Word files are inspected but not redacted: a document with one secret in it is held back whole. Excel, PowerPoint, legacy .doc and archives are still not read and are blocked. Documents over 60 pages, or with more than 8 scanned pages or pictures, are also blocked. In PDFs, text drawn as shapes on a page that also has a normal text layer is not read, and Arabic wording can come out with letters swapped (section 5b).
6. A document with no recognisable pattern is caught only if it carries a sensitivity label (section 5c). An unlabelled one, or the same text pasted, is not caught.
7. Screenshot OCR at ~1.7 s per image is acceptable for a paste but not for bulk uploads.
8. The screenshot results depend on the browser and fonts that draw the test images and on the OCR models installed. A re-run on another machine blocked 7 of 8 classified memos instead of 8 (section 5e).
9. Tamper resistance was tested on Chrome on Linux only (section 5d). Edge has not been tested for any part of SADIN.
10. No test has been run against a live AI site. All browser tests use the local test page, and only the eight sites in the manifest are covered at all (section 5f).
11. The known gaps in section 5f: disguised values, passwords with no keyword, the bare word "سري", legacy Arabic text encodings.
12. Nothing stops a photograph of the screen taken with a personal phone. That is a policy and awareness matter; see [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## 8. Reproducing the results

```bash
# text benchmarks
node eval/run.js                      # English development set
node eval/run.js --holdout            # English held-out set
node eval/run.js --set=arabic-dev     # Arabic development set
node eval/run.js --set=arabic-holdout # Arabic held-out set
sha256sum -c eval/FROZEN-arabic.sha256 eval/FROZEN-english.sha256
node eval/check-results.js           # exit 1 if any of the four sets is below the published numbers
node eval/docs-check.js              # exit 1 if a figure quoted in README.md or here differs from the result files

# real-browser test (needs: node demo/serve.js running, and "npm install" for playwright)
node eval/e2e-browser.js

# PDF and Word files (needs tesseract with ara+eng, poppler-utils, qpdf)
TESSDATA_PREFIX=/path/to/tessdata node eval/files-eval.js
# rebuild the test documents (also needs LibreOffice, Chrome, ImageMagick)
node eval/files-build.js structural
node eval/files-build.js bulk /tmp/sadin-bulk && node eval/files-eval.js --bulk /tmp/sadin-bulk
# real-browser upload test (needs demo/serve.js and server/server.js running)
node eval/e2e-files.js
node eval/e2e-files.js --server-down   # with server/server.js stopped

# audit regression tests (section 5f)
node eval/robustness.js                    # engine cases and recorded known gaps
node eval/e2e-audit.js                     # real browser; starts the test page and the service itself
node eval/server-hardening-test.js         # service start-up and Host rules

# everything that needs only Node, in one command
npm install && npm test

# tamper resistance
node eval/tamper/server-test.js            # server only, about a minute
sudo python3 eval/tamper/tamper_test.py    # real Chrome under managed policy; Linux, root, ports 8787 and 8790 free, about 10 minutes
node server/integrity.js --check           # the recorded fingerprint matches extension/

# screenshot benchmark (needs tesseract with ara+eng, ImageMagick, and "npm install" for playwright and sharp)
TESSDATA_PREFIX=/path/to/tessdata SADIN_SEED=990011 node eval/ocr-eval.js

# run the prototype
node server/server.js          # on-prem inspection service, port 8787
                               # deployment: SADIN_TOKEN=<secret> SADIN_EXTENSION_IDS=<extension id>
node demo/serve.js             # local test page, port 8788
# then load extension/ in Chrome: chrome://extensions > Developer mode > Load unpacked
```

The screenshot benchmark (`eval/ocr-eval.js`) needs Node.js 20.9 or later, because the `sharp` package it uses (0.35.5 in `package-lock.json`) declares that as its minimum. Everything else in the repository, including the extension, the inspection service and `npm test`, runs on Node.js 18.

The screenshot benchmark and the document builder draw their inputs with the local browser, fonts and LibreOffice, so their results can differ between machines (section 5e).

Raw outputs: `eval/results-holdout-FIRST-RUN-v0.3.0.json`, `eval/results-arabic-holdout-BASELINE-v0.3.1.json`, `eval/results-arabic-holdout-FIRST-RUN-v0.4.0.json`, `eval/results-corpus.json`, `eval/results-ocr-HELDOUT-seed990011.json`.
