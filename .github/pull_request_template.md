## What changed


## Checks

- [ ] `npm test` passes
- [ ] `npm run test:files` passes (if `server/files.js`, `server/labels.js` or the engine changed)
- [ ] `npm run test:browser` passes (if `extension/` changed)
- [ ] `node server/integrity.js` was run (if `extension/` changed)
- [ ] CHANGELOG.md has an entry

## Bypass review (for changes to the extension, the engine or the server)

- [ ] Every input path (typing, paste, drop, upload) still passes through the engine
- [ ] SADIN's listeners still run before the page's own listeners
- [ ] New file types and encodings are decoded before scanning, and decided by content, not by file name
- [ ] The frozen held-out sets were not used to tune a detector
- [ ] Behaviour with the inspection service stopped was considered
