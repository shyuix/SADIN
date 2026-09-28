# Changelog

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
