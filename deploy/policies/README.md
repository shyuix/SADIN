# Lock-down policy templates

These files force-install SADIN and close the ways around it in the managed browser. Replace
the placeholders before use.

| File | Browser | Status |
|---|---|---|
| `chrome-linux.json` | Chrome on Linux (`/etc/opt/chrome/policies/managed/`) | The same settings, except `DeveloperToolsAvailability` and `BrowserAddPersonEnabled`, were run in the lab |
| `chrome-windows.reg` | Chrome on Windows | Template, not run |
| `edge-windows.reg` | Edge on Windows | Template, not run |

| Setting | Effect |
|---|---|
| `ExtensionInstallForcelist` | Installs the extension without the user; the user cannot disable or remove it |
| `IncognitoModeAvailability = 1` (Edge: `InPrivateModeAvailability = 1`) | No private windows, where extensions are off by default |
| `BrowserGuestModeEnabled = false` | No guest session, which has no extensions |
| `BrowserAddPersonEnabled = false` (Edge: `BrowserAddProfileEnabled`) | No new browser profile |
| `DeveloperToolsAvailability = 2` | No developer tools |
| `3rdparty.extensions.<id>` | SADIN's own managed settings: server, token, device name, heartbeat interval |

`manifest.json` allows the extension to reach the inspection service on `127.0.0.1:8787` and
`localhost:8787` only. For a central service, add its address to `host_permissions` before
packing the extension.

What was tested and what was not: [`docs/TAMPER-RESISTANCE.md`](../../docs/TAMPER-RESISTANCE.md).
