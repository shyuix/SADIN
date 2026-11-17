# Security policy

SADIN is a security control, so problems in it matter. If you find one, please report it
privately rather than opening a public issue.

## Reporting a vulnerability

Use **Security > Report a vulnerability** on this repository (GitHub private vulnerability
reporting). Include what you found, how to reproduce it, and what an attacker could do with it.
Expect an acknowledgement within a few days.

Useful reports include: a way for content to reach an AI tool without passing through the
engine, a way for a web page to reach the inspection service, a way to make the decision log
record content or forge entries, a way to stop the extension without an alert reaching the
administrator, and detection bypasses on realistic workplace text.

## Supported versions

| Version | Supported |
|---|---|
| 0.7.x | Yes |
| earlier | No |

## Security properties of the prototype

- **No content leaves the organisation.** Inspection runs in the browser or on the
  organisation's own inspection service. There is no SADIN cloud.
- **The log holds metadata only.** User, tool, channel, action, data classes and counts. Never
  the text, the image or the matched values.
- **The inspection service answers only the extension.** Browser requests from any other origin
  are refused, and a shared token (`SADIN_TOKEN`) is required in deployment: the service will
  not listen on a network address without one. Logged fields are
  stripped of control characters and CEF values are escaped, so entries cannot be forged.
- **Fail closed.** Images, PDF and Word files are blocked when the service is unreachable, and
  files that cannot be parsed are blocked by default.
- **The employee cannot switch it off, and the administrator is told.** Installed by browser
  policy, the extension cannot be disabled or removed by the user. A heartbeat with a
  fingerprint of the extension's files raises an alert when a device goes silent, when files
  were changed, or when the extension was not installed by policy. Alerts carry no content.
  Tested on Chrome on Linux; see [docs/TAMPER-RESISTANCE.md](docs/TAMPER-RESISTANCE.md) for
  the limits, including that the fingerprint is computed by the extension itself.
- **No third-party dependencies at runtime.** The extension and the service use only the
  browser, Node.js and Tesseract.

Known limitations are listed in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) and
[EVALUATION.md](EVALUATION.md).

## Test data

Every credential in `eval/` is fabricated. The API keys and tokens use real provider formats on
purpose so the detectors can be tested against them; none of them is live.
