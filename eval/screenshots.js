// Captures the prototype screenshots from the real extension on the local test page.
// Needs: node demo/serve.js and node server/server.js (OCR) running; npm i -g playwright.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const EXT = path.resolve(__dirname, '../extension');
const OUT = path.resolve(__dirname, '../shots');
const CONFIG = [
  'Why does this VPN tunnel keep dropping?',
  'crypto isakmp key Vpn$Share2026 address 203.0.113.44',
  'interface GigabitEthernet0/1',
  ' ip address 10.20.30.1 255.255.255.0',
  'access-list 110 permit tcp any host 10.20.30.15 eq 3389',
  'hostname fw-core-01',
  'username netadmin secret 5 N3tAdm!n#2026',
].join('\n');
const ARABIC = 'السلام عليكم، السيرفر ١٠.١٥.٢.٢٠ على المنفذ ٨٤٤٣ ما يرد، واسم المستخدم admin.ops وكلمة المرور Riyadh@2026. وش السبب؟ جاوبني بالعربي';
async function paste(page, { text, file }) {
  // real clipboard + Ctrl+V, so the browser delivers a trusted paste event
  await page.click('textarea');
  await page.evaluate(async ({ text, file }) => {
    if (file) {
      const b = await (await fetch('data:image/png;base64,' + file)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
  }, { text, file });
  await page.keyboard.press('Control+V');
}
async function send(page) {
  await page.click('textarea'); await page.keyboard.press('Enter');
  const btn = await page.$('button.send'); if (btn) await btn.click().catch(() => {});
}
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'sadin-shots-')), {
    headless: true, channel: 'chromium', viewport: { width: 1414, height: 840 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8788' });
  const page = await ctx.newPage();
  const result = {};
  // 1. firewall config: redaction notice on paste, then what the vendor receives
  await page.goto('http://localhost:8788'); await page.waitForTimeout(600);
  await paste(page, { text: CONFIG }); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '01-redact-notice.png') });
  await send(page); await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '02-sent-redacted.png') });
  result.config = await page.$eval('#wire', e => e.innerText);
  // 2. screenshot through on-prem OCR
  await page.goto('http://localhost:8788'); await page.waitForTimeout(600);
  const img = fs.readFileSync(path.resolve(__dirname, 'ocr-images/case01-soc-dashboard.png')).toString('base64');
  await paste(page, { file: img }); await page.waitForTimeout(6000);
  await page.fill('textarea', 'Who are these failed logons from?').catch(() => {});
  await send(page); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '03-image-masked.png') });
  // 3. Arabic question
  await page.goto('http://localhost:8788'); await page.waitForTimeout(600);
  await page.click('textarea'); await page.keyboard.insertText(ARABIC); await send(page); await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '06-arabic-redacted.png') });
  result.arabic = await page.$eval('#wire', e => e.innerText);
  // 4. popup with the decision log
  const pop = await ctx.newPage(); await pop.setViewportSize({ width: 380, height: 560 });
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`); await pop.waitForTimeout(800);
  await pop.screenshot({ path: path.join(OUT, '05-popup-log.png') });
  console.log(JSON.stringify(result, null, 1));
  await ctx.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
