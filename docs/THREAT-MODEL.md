# Threat model

## The asset and the threat

**Asset:** the organisation's secrets that an attacker could use against it: classified
documents, credentials and keys, internal network details, account identifiers and open
security findings.

**Threat:** an employee, usually with no bad intent, sends them to a generative AI tool while
asking for help. From there the data is out of the organisation's control, and an attacker can
reach it without ever touching the organisation's network.

```mermaid
flowchart LR
    EMP["Employee asks AI<br/>for help"] -->|"pastes config,<br/>screenshot, file"| VEN["AI vendor<br/>chat history"]
    VEN --> A1["Stolen account<br/>(infostealer logs)"]
    VEN --> A2["Chat shared by link,<br/>indexed by search"]
    VEN --> A3["Vendor retention<br/>or breach"]
    A1 & A2 & A3 --> ATT["Attacker holds keys,<br/>addresses, accounts"]
    classDef bad fill:#F6F2EA,stroke:#8A1C1C,color:#0B2134
    class ATT bad
    classDef node fill:#F6F2EA,stroke:#0B2134,color:#0B2134
    class EMP,VEN,A1,A2,A3 node
```

| Path | Evidence |
|---|---|
| Stolen AI accounts | Group-IB identified 101,134 infostealer-infected devices with saved ChatGPT credentials in logs traded between June 2022 and May 2023, and more than 225,000 logs containing ChatGPT credentials offered for sale between January and October 2023. |
| Shared chats indexed | In July 2025, Fast Company found nearly 4,500 shared ChatGPT conversations in Google results; OpenAI removed the discoverability option shortly afterwards. |
| Vendor retention | In March 2023, Samsung semiconductor engineers entered source code and meeting content into ChatGPT in three separate incidents within about 20 days; Samsung then banned generative AI tools on company devices from May 2023. |

## Channels and coverage

| Channel | Example | Covered by | State |
|---|---|---|---|
| Typed text | A password typed into the prompt | Extension, at send time | Built |
| Pasted text | A router configuration | Extension | Built |
| Dragged text | A selection dragged into the prompt | Extension | Built |
| Text-format file upload | `.env`, `.conf`, `.log`, source code | Extension, sanitised copy uploaded | Built |
| Images and screenshots | A SOC dashboard, a scanned memo | Extension + on-prem OCR | Built |
| PDF and Word (.docx) | A contract, a scanned memo | Extension + on-prem inspection: text, comments, link targets and pictures are read; a clean file passes, a file with protected content is held back whole | Built (v0.6.0); redaction inside the file in Phase 2 |
| A classified document with no recognisable pattern | A strategy paper labelled Restricted | Sensitivity label in the file's metadata (Purview labels, classification properties), mapped to NDMO levels | Built (v0.6.0) for Word and PDF; unlabelled documents and pasted text are not covered |
| Excel, PowerPoint, legacy Office, archives, protected or oversized documents | An Excel export, a password-protected PDF | Blocked whole (fail closed) | Partial |
| Desktop AI apps, IDE assistants | Copilot in an IDE | Endpoint agent | Phase 2 |
| Voice input | Dictated meeting notes | Local speech-to-text in the endpoint agent | Phase 2 |
| Personal AI account on a work device | Personal login on a public AI site | Identity layer, account checks | Phase 3 |
| Work data on a personal device | Home laptop | Conditional access keeps company data on managed devices; Gateway | Phase 3 and 4 |
| Phone camera, re-typing by hand | Photographing the screen | Not technically coverable | Policy and awareness |

**Assumptions.** The organisation manages its endpoints (domain-joined or MDM-enrolled), uses a
central identity provider, and has or will adopt a data classification scheme.

## Threats to SADIN itself

A security control has to survive the people and pages it sits between.

| Threat | Mitigation | State |
|---|---|---|
| Employee removes or disables the extension | Force-installed by `ExtensionInstallForcelist`; the browser refuses both | Built and tested on Chrome (v0.7.0) |
| Employee uses an Incognito or guest window, where extensions are absent | `IncognitoModeAvailability=1` and `BrowserGuestModeEnabled=false` in the same policy | Built and tested on Chrome (v0.7.0) |
| Employee edits or deletes the extension's files on disk (the browser does not verify the files of an extension hosted outside the Web Store) | Each heartbeat carries a fingerprint of the manifest and the three scripts; the server raises `integrity-mismatch` | Built and tested (v0.7.0). The extension computes its own fingerprint, so a rewritten background script that reports the old value is not caught |
| Extension stops for any reason: folder deleted, policy removed by someone with administrator rights, extension loaded by hand and then disabled | Heartbeat watchdog raises `heartbeat-lost`; `not-force-installed` flags an install the user could switch off | Built and tested (v0.7.0). A silent device may simply be off; the alert asks for a check |
| Fake heartbeats or fake alerts | Heartbeats and alerts need the shared token, and requests from web pages are refused; logged fields are stripped of line breaks | Built and tested (v0.7.0). The token is shared, so a user who extracts it could send heartbeats from another program |
| A PDF or Office file renamed to a text extension, or a UTF-16 text file | The first bytes decide how a file is inspected, not its name; UTF-16 is decoded | Fixed in v0.7.0 (audit) |
| A hidden character or Arabic tatweel inside a keyword | Removed before matching (engine v0.4.1) | Fixed in v0.7.0 (audit) |
| A web page re-points its host name at 127.0.0.1 to read the local service (DNS rebinding) | With a token the request fails; without one the Host header is checked, and the service will not listen on a network address | Fixed in v0.7.0 (audit) |
| Employee uses another browser | Application control (AppLocker or WDAC) allows only managed browsers | Deployment guidance |
| A website reads the decision log or writes fake events to the local service | The service refuses browser requests from any origin other than the SADIN extension, and requires a shared token in deployment | Fixed in v0.4.0 |
| Forged lines in the SIEM feed through a crafted field | Control characters are stripped from every logged field and CEF values are escaped | Fixed in v0.4.0 |
| Something pretends to be the inspection service | `serverUrl` and `serverToken` come from managed policy, not from the page; use TLS on the network | Built; TLS is deployment guidance |
| Inspection service is down | Images, PDF and Word files and uninspectable files are blocked (fail closed) | Built |
| A secret hidden where a reader would not look: a comment, a deleted passage, a link target, a picture, a file attached inside a PDF | Those places are read; a document with a part that cannot be read (attachment, embedded object, macro, unknown component) is refused | Built (v0.6.0) |
| The AI site changes how it uploads | The extension hooks user actions (paste, drop, file input, send), not the site's code; network-level interception for policy-installed extensions is a planned backstop | Partial |
| Obfuscation: splitting a secret across messages, spelling it out, encoding it | High-entropy detection catches long encoded strings; deliberate evasion by a determined insider is out of scope for a tool aimed at accidental leakage | Accepted |
| The log itself becomes sensitive | Metadata only: no text, no image, no matched value | Built |

## Residual risk

- A photograph of the screen with a personal phone cannot be stopped by any technical control.
  The answers are policy, awareness, and giving fewer people access to classified data.
- OCR misses some values: short lowercase hostnames, low-resolution images, handwriting and
  stylised Arabic fonts. Three of 72 seeded values were missed in the held-out screenshot test.
- Until Phase 2, a secret inside a PDF or Word file holds back the whole file instead of being
  redacted, which is safe but gets in the way of legitimate work. Other Office formats are
  blocked without being read.
- A sensitivity label protects a document only while the label is still in the file. A tool that
  rewrites the file can drop it (LibreOffice did in testing, both on re-save and on PDF
  export), and an employee can copy the text out. A pattern-free document without a label is
  not caught at all; fingerprinting of registered documents is the planned answer.
- PDF text extraction can return Arabic letters in swapped order, so Arabic wording is matched
  less reliably in a PDF than in pasted text. Addresses, passwords and tokens are not affected.
- The live AI sites have not been tested, only eight sites are listed, and deliberately
  disguised values (spaced or bracketed addresses, look-alike letters) pass. The full list of
  known gaps is in EVALUATION.md, section 5f.
- Tamper resistance was tested on Chrome on Linux only. The Windows and Edge policy files are
  untested templates, and a silent device cannot be told apart from one that is switched off.
- SADIN processes employee activity. Collecting more than needed is itself a privacy risk, which
  is why the log is limited to metadata, kept on premises, restricted by role and disclosed to
  employees.
