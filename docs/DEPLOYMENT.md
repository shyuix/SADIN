# Deployment

This is how the prototype would go into an organisation's managed fleet. It assumes Chrome or
Edge managed by Group Policy, Intune, Jamf or Google Admin.

## 1. Run the inspection service

On an internal VM with Node.js 18+, Tesseract 5 (`ara` and `eng` data) and optionally
ImageMagick:

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
| `SADIN_TOKEN` | Shared secret required in the `X-SADIN-Token` header on every endpoint except `/health` | not required |
| `SADIN_EXTENSION_IDS` | Extension IDs allowed to call the service from a browser | any extension origin |
| `SADIN_ALLOWED_ORIGINS` | Extra web origins to allow (normally none) | none |
| `SADIN_OCR_LANGS` | Tesseract languages | `ara+eng` |

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
ID you pin in `SADIN_EXTENSION_IDS`.

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
record the work identity in the log.

## 4. Close the side doors

- Allow only managed browsers with application control (AppLocker or WDAC on Windows).
- Keep company email, files and systems reachable only from compliant devices (conditional
  access), so a personal device has nothing to paste.
- Offer employees an enterprise AI tenant through their work account, so there is no reason to
  use a personal one.

## 5. Roll out in stages

| Stage | Setting | What happens |
|---|---|---|
| Observe (2 to 4 weeks) | every class set to `warn` | Nothing is changed; findings are flagged to the employee and logged. Tune domains, ranges and ID patterns against real false positives. |
| Protect | credentials, network and accounts to `redact` | Secrets are replaced; work continues. |
| Enforce | `CLASSIFIED` to `block` | Classified content is stopped. |

Feed `/events.cef` into the SIEM from the first day so the security team sees which data
classes leak most and from which teams.
