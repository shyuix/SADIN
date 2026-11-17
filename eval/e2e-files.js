// Real-browser test for PDF and Word uploads: loads the extension in Chromium, picks files
// from eval/file-fixtures/ on the local test page and reports which ones reached the page.
// Needs: npm i -g playwright; node demo/serve.js running; the inspection server running
// (node server/server.js), or stopped on purpose with --server-down to test fail closed.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const DOWN = process.argv.includes('--server-down');
const FX = path.join(__dirname, 'file-fixtures');
const CASES = DOWN ? [
  ['p12-clean-english-libreoffice.pdf', false, 'clean PDF, inspection server stopped'],
  ['d15-clean-english.docx', false, 'clean Word file, inspection server stopped'],
] : [
  ['p12-clean-english-libreoffice.pdf', true, 'clean PDF'],
  ['p13-clean-arabic-libreoffice.pdf', true, 'clean Arabic PDF'],
  ['d16-clean-arabic.docx', true, 'clean Arabic Word file'],
  ['p32-scanned-clean.pdf', true, 'clean scanned PDF'],
  ['p01-body-english-libreoffice.pdf', false, 'PDF with a database password'],
  ['p02-body-arabic-rtl-libreoffice.pdf', false, 'Arabic PDF with a server address and password'],
  ['d08-comment.docx', false, 'Word file with a password in a review comment'],
  ['p30-scanned-english.pdf', false, 'scanned PDF with a password'],
  ['p50-password-protected.pdf', false, 'password-protected PDF'],
  ['d19-embedded-object.docx', false, 'Word file with an embedded spreadsheet'],
  ['d40-label-restricted.docx', false, 'harmless Word file labelled Restricted'],
  ['d41-label-arabic-top-secret.docx', false, 'harmless Word file with an Arabic Top Secret label'],
  ['p60-label-secret.pdf', false, 'harmless PDF labelled Secret'],
  ['d45-label-public.docx', true, 'harmless Word file labelled Public'],
];
(async () => {
  const ext = path.resolve(__dirname, '../extension');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(require('os').tmpdir() + '/sadin-e2e-files-'), {
    headless: true, channel: 'chromium', viewport: { width: 1414, height: 840 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8788');
  await page.waitForTimeout(1200);
  let ok = 0; const rows = [];
  for (const [file, shouldPass, what] of CASES) {
    await page.evaluate(() => { document.getElementById('chips').innerHTML = ''; });
    const t0 = Date.now();
    await page.setInputFiles('#file', path.join(FX, file));
    // wait until the file shows up on the page, or long enough to be sure it was held back
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) { await page.waitForTimeout(250); reached = (await page.$$eval('#chips .chip', c => c.length)) > 0; }
    const pass = reached === shouldPass; if (pass) ok++;
    rows.push({ file, what, expected: shouldPass ? 'reaches the page' : 'held back', got: reached ? 'reaches the page' : 'held back', ok: pass, ms: reached ? Date.now() - t0 : null });
    if (file.startsWith('p02-')) await page.screenshot({ path: path.join(__dirname, '../shots/07-pdf-held-back.png') }).catch(() => {});
    if (file.startsWith('d41-')) await page.screenshot({ path: path.join(__dirname, '../shots/08-labelled-held-back.png') }).catch(() => {});
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what.padEnd(48)} expected: ${shouldPass ? 'reaches the page' : 'held back'}; got: ${reached ? 'reaches the page' : 'held back'}`);
  }
  console.log(`\n${ok} of ${CASES.length} as expected${DOWN ? ' (inspection server stopped)' : ''}`);
  fs.writeFileSync(path.join(__dirname, DOWN ? 'results-e2e-files-server-down.json' : 'results-e2e-files.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), serverDown: DOWN, cases: rows.length, ok, rows }, null, 1) + '\n');
  await ctx.close();
  process.exit(ok === CASES.length ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
