# Deployment

This is how the prototype would go into an organisation's managed fleet. It assumes Chrome or
Edge managed by Group Policy, Intune, Jamf or Google Admin. The prototype has been tested on
Chrome only; Edge uses the same extension format and policy names (except where noted) but has
not been run.

## 1. Run the inspection service

On an internal VM with Node.js 18+, Tesseract 5 (`ara` and `eng` data), `poppler-utils` and
`qpdf` (for PDF and Word inspection) and ImageMagick (for images: without it classification stamps in screenshots are not read, and the service prints a warning at start):

```bash
SADIN_HOST=0.0.0.0 \
SADIN_PORT=8787 \
SADIN_TOKEN="$(openssl rand -hex 32)" \
SADIN_EXTENSION_IDS=<extension id> \
TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata \
node server/server.js
```

| Variable | Purpose | Default |
|---|---|---|
| `SADIN_HOST`, `SADIN_PORT` | Where the service listens | `127.0.0.1`, `8787` |
| `SADIN_TOKEN` | Shared secret required in the `X-SADIN-Token` header on every endpoint except `/health`. The service refuses to start on a network address without it | not required on 127.0.0.1 |
| `SADIN_EXTENSION_IDS` | Extension IDs allowed to call the service from a browser | any extension origin |
| `SADIN_ALLOWED_ORIGINS` | Extra web origins to allow (normally none) | none |
| `SADIN_OCR_LANGS` | Tesseract languages | `ara+eng` |
| `SADIN_MAX_PDF_PAGES` | PDFs with more pages are reported as uninspectable | `60` |
| `SADIN_MAX_OCR_PAGES` | Scanned or picture-carrying PDF pages read with OCR per file | `8` |
| `SADIN_MAX_DOCX_IMAGES` | Pictures read with OCR per Word file | `8` |
| `SADIN_HEARTBEAT_GRACE_S` | A device that has not reported for this many seconds raises `heartbeat-lost` (minimum 20) | `180` |
| `SADIN_ALERT_WEBHOOK` | Every tamper alert is also posted here as JSON (mail relay, Teams, SOAR) | none |
| `SADIN_DATA_DIR` | Where `devices.json` and `alerts.jsonl` are kept | `server/` |

Sensitivity labels are configured in `server/policy.json` under `labels`:

```json
"labels": {
  "ids":   { "<label GUID from Microsoft Purview>": "restricted" },
  "names": { "Internal Use Only": "restricted" },
  "properties": ["Classification", "Sensitivity", "التصنيف"],
  "actions": { "top-secret": "block", "secret": "block", "restricted": "block", "public": "allow" },
  "unknown": "block"
}
```

Levels are `top-secret`, `secret`, `restricted` and `public` (NDMO Data Classification Policy).
The Arabic and English names of those four levels, and "Confidential", are recognised without
configuration. Add the organisation's own label names under `names`, and the label GUIDs under
`ids`: newer Office versions store only the GUID in the file, so without this map such a label
counts as unknown. `unknown` decides what happens to a label that has no rule.

Put the service behind TLS (a reverse proxy on the same VM) whenever it is reached over the
network, and restrict who can read `server/events.jsonl` and `/events.cef`. Edit
`server/policy.json` to set the organisation's domains, public ranges, employee ID format and
actions; managed settings pushed to the browsers override it.

## 2. Package and force-install the extension

Pack `extension/` as a CRX and host it with an update manifest, or publish it privately to the
Chrome Web Store for your organisation. Then force-install it:

| Browser | Policy | Value |
|---|---|---|
| Chrome | `ExtensionInstallForcelist` | `<extension id>;<update URL>` |
| Edge | `ExtensionInstallForcelist` | `<extension id>;<update URL>` |

A force-installed extension cannot be removed or disabled by the user, and it is the extension
ID you pin in `SADIN_EXTENSION_IDS`. Ready-made policy files, including the Incognito, guest
mode, new-profile and developer-tools settings, are in
[`deploy/policies/`](../deploy/policies/). The Linux settings were run in the lab; the Windows
and Edge files are templates that have not been run.

Before packing, add the inspection service's address to `host_permissions` in
`extension/manifest.json` (the prototype allows `127.0.0.1:8787` and `localhost:8787` only).
After packing each release run `node server/integrity.js` on the service, so it knows the
fingerprint of the released files. If the files are changed in any way before packing
(including line endings on a Windows checkout), run it again.

## 3. Push the managed settings

The settings are defined in [`extension/managed_schema.json`](../extension/managed_schema.json)
and delivered through the browser's third-party extension policy. Example value:

```json
{
  "serverUrl": "https://sadin.corp.example.sa",
  "serverToken": "<same value as SADIN_TOKEN>",
  "policy": {
    "orgDomains": ["corp.example.sa", "example.sa"],
    "orgPublicCidrs": ["203.0.113.0/24"],
    "employeeIdPattern": "\\bEMP-?\\d{5,6}\\b",
    "failClosed": true,
    "uninspectableFiles": "block",
    "actions": {
      "CLASSIFIED": "block",
      "CREDENTIAL": "redact",
      "NETWORK": "redact",
      "ACCOUNT": "redact",
      "SECURITY_FINDING": "warn"
    }
  }
}
```

On Linux this goes under `3rdparty.extensions.<extension id>` in a JSON file in
`/etc/opt/chrome/policies/managed/`; on Windows under
`HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\<extension id>\policy` (Chrome) or
`HKLM\Software\Policies\Microsoft\Edge\3rdparty\extensions\<extension id>\policy` (Edge); Intune
and Google Admin expose the same settings in their consoles. `userEmail` can also be pushed to
record the work identity in the log. Push `deviceId` (the device name the administrator will
see) and, if wanted, `heartbeatSeconds` (default 60, minimum 30) for the tamper alerts.

## 4. Close the side doors

- Allow only managed browsers with application control (AppLocker or WDAC on Windows).
- Keep company email, files and systems reachable only from compliant devices (conditional
  access), so a personal device has nothing to paste.
- Offer employees an enterprise AI tenant through their work account, so there is no reason to
  use a personal one.

## 5. Watch for tampering

Open `https://<service>/admin`, enter the token, and the page lists every device that has
reported and every alert. The same alerts are at `/alerts` (JSON) and `/alerts.cef` (for the
SIEM), and are posted to `SADIN_ALERT_WEBHOOK` when it is set.

| Alert | Raised when | What to do |
|---|---|---|
| `heartbeat-lost` | A registered device has not reported within the grace period | Check the device. It may only be switched off |
| `heartbeat-restored` | A silent device reports again | Nothing |
| `not-force-installed` | The extension reports that it was not installed by policy | Fix the policy on that device; the user can switch the extension off |
| `integrity-mismatch` | The fingerprint of the extension's files differs from the released one | Treat as tampering, or run `node server/integrity.js` if a new release was just published |
| `extension-uninstalled` | The browser opened the uninstall address | Check the device. This signal did not fire in the lab; do not rely on it |

What was tested and what was not: [`TAMPER-RESISTANCE.md`](TAMPER-RESISTANCE.md).

## 6. Roll out in stages

| Stage | Setting | What happens |
|---|---|---|
| Observe (2 to 4 weeks) | every class set to `warn` | Nothing is changed; findings are flagged to the employee and logged. Tune domains, ranges and ID patterns against real false positives. |
| Protect | credentials, network and accounts to `redact` | Secrets are replaced; work continues. |
| Enforce | `CLASSIFIED` to `block` | Classified content is stopped. |

Feed `/events.cef` and `/alerts.cef` into the SIEM from the first day so the security team sees which data
classes leak most and from which teams.
