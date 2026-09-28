// Real-browser test: loads the extension in Chromium, types an Arabic and an English
// message into the local test page (node demo/serve.js must be running) and prints
// exactly what reaches the simulated AI vendor. Needs: npm i -g playwright
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const ext = path.resolve(require('path').resolve(__dirname, '../extension'));
  const ctx = await chromium.launchPersistentContext(require('os').tmpdir() + '/sadin-e2e-profile', {
    headless: true, channel: 'chromium', viewport: { width: 1414, height: 840 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (/sadin/i.test(m.text())) console.log('console:', m.text()); });
  await page.goto('http://localhost:8788');
  await page.waitForTimeout(800);
  const msgs = [
    'Why does this keep failing? mysql -h 10.9.3.3 -u root -pKh4lid!Root2026 inventory',
    'السلام عليكم، السيرفر ١٠.١٥.٢.٢٠ على المنفذ ٨٤٤٣ ما يرد، واسم المستخدم admin.ops وكلمة المرور Riyadh@2026. وش السبب؟ جاوبني بالعربي',
    'اكتب لي ايميل رسمي لمديري أطلب فيه إجازة يوم الأحد',
  ];
  for (const t of msgs) {
    await page.click('textarea');
    await page.keyboard.insertText(t);
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter').catch(()=>{});
    const btn = await page.$('button.send'); if (btn && (await page.inputValue('textarea')).length) await btn.click();
    await page.waitForTimeout(900);
  }
  const wire = await page.$eval('#wire', e => e.innerText);
  console.log('=== RECEIVED BY THE AI VENDOR ===\n' + wire);
  await page.screenshot({ path: require('path').join(__dirname, '../shots/06-arabic-redacted.png') });
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
