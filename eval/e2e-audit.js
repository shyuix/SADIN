// Real-browser regression test for the bypasses found in the 17 November 2026 audit.
// Starts the test page and the inspection service itself (ports 8788 and 8787 must be free),
// loads the extension in Chromium and tries each bypass. Needs: playwright (npm install).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'file-fixtures');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
const check = (n, what, ok, observed) => { rows.push({ n, check: what, result: ok ? 'PASS' : 'FAIL', observed }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n} ${what} -> ${observed}`); };
const start = file => spawn(process.execPath, [path.join(ROOT, file)], { stdio: 'ignore' });
const up = async () => { for (let i = 0; i < 50; i++) { try { if ((await fetch('http://127.0.0.1:8787/health')).ok) return true; } catch (e) {} await sleep(100); } return false; };
const cefLines = async () => (await (await fetch('http://127.0.0.1:8787/events.cef')).text()).trim().split('\n').filter(Boolean).length;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sadin-audit-'));
  const copy = (src, name) => { const d = path.join(tmp, name); fs.copyFileSync(path.join(FX, src), d); return d; };
  const write = (name, data) => { const d = path.join(tmp, name); fs.writeFileSync(d, data); return d; };
  const demo = start('demo/serve.js');
  let srv = null;
  const ext = path.join(ROOT, 'extension');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'sadin-audit-profile-')), {
    headless: true, channel: 'chromium', viewport: { width: 1414, height: 840 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    await sleep(600);
    const page = await ctx.newPage();
    await page.goto('http://localhost:8788');
    await page.waitForTimeout(1200);
    const wire = () => page.$eval('#wire', e => e.innerText);
    const clear = () => page.evaluate(() => { document.getElementById('wire').innerHTML = ''; document.getElementById('chips').innerHTML = ''; document.getElementById('prompt').value = ''; });
    const type = async t => { await page.click('#prompt'); await page.keyboard.insertText(t); await page.waitForTimeout(150); };
    const upload = async file => {
      await page.evaluate(() => { document.getElementById('chips').innerHTML = ''; });
      await page.setInputFiles('#file', file);
      let reached = false;
      for (let i = 0; i < 32 && !reached; i++) { await page.waitForTimeout(250); reached = (await page.$$eval('#chips .chip', c => c.length)) > 0; }
      return reached;
    };

    // --- decisions made while the service is down are forwarded later (service still stopped here)
    // counted from the service's own log file, because the queued event may arrive the moment it starts
    const EVENTS = path.join(ROOT, 'server/events.jsonl');
    const before = fs.existsSync(EVENTS) ? fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean).length : 0;
    await clear();
    await type('the db password is Riyadh77!Qx3 please fix');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const redactedOffline = /\[SECRET_1\]/.test(await page.inputValue('#prompt'));
    srv = start('server/server.js');
    await up();
    await clear();
    await type('second one: api password is Najd55#Lm2 thanks');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const after = await cefLines();
    check('E1', 'a decision logged while the service was down reaches it once it is back', redactedOffline && after - before >= 2, `text was still redacted offline: ${redactedOffline}; events on the service ${before} -> ${after}`);

    // --- files disguised as text
    check('F1', 'PDF holding a password, renamed to .txt, is held back', !(await upload(copy('p01-body-english-libreoffice.pdf', 'notes.txt'))), 'held back');
    check('F2', 'Word file with a password in a comment, renamed to .log, is held back', !(await upload(copy('d08-comment.docx', 'server.log'))), 'held back');
    check('F3', 'harmless Word file labelled Restricted, renamed to .md, is held back', !(await upload(copy('d40-label-restricted.docx', 'readme.md'))), 'held back');
    check('F4', 'binary data named .txt is held back', !(await upload(write('data.txt', Buffer.concat([Buffer.from('header'), Buffer.alloc(64), Buffer.from('password: Riyadh77!Qx3')])))), 'held back');
    check('F5', 'clean PDF renamed to .txt still passes (inspected as a PDF)', await upload(copy('p12-clean-english-libreoffice.pdf', 'clean.txt')), 'reaches the page');
    check('F6', 'ordinary clean text file passes', await upload(write('todo.txt', 'buy coffee\nbook the meeting room\n')), 'reaches the page');
    check('F7', 'Arabic UTF-8 text file passes', await upload(write('ar.txt', 'مرحبا، هذا ملف نصي عادي\n')), 'reaches the page');
    // what the page actually receives after SADIN (the re-dispatched, cleaned files)
    await page.evaluate(() => { document.addEventListener('change', e => { if (e.target && e.target.files) Promise.all([...e.target.files].map(f => f.text())).then(t => { window.__got = t; }); }, true); });
    for (const [n, enc, bom] of [['F8', 'utf16le', [0xFF, 0xFE]], ['F9', 'utf16be', [0xFE, 0xFF]]]) {
      await page.evaluate(() => { window.__got = null; });
      let body = Buffer.from('ipconfig output\r\npassword: Riyadh77!Qx3\r\n', 'utf16le');
      if (enc === 'utf16be') body.swap16();
      const reached = await upload(write(enc + '.txt', Buffer.concat([Buffer.from(bom), body])));
      const got = (await page.evaluate(() => window.__got)) || [];
      const txt = got.join(' ');
      check(n, `UTF-16 text file (${enc === 'utf16le' ? 'little' : 'big'}-endian, as Windows tools write) with a password is read and redacted`, reached && !/Riyadh77/.test(txt.replace(/\0/g, '')) && /\[SECRET_1\]/.test(txt), reached ? 'page received: ' + txt.replace(/\s+/g, ' ').slice(0, 60) : 'held back');
    }

    // --- the page cannot see the original files
    await page.evaluate(() => { window.__seen = 0; window.addEventListener('change', e => { if (e.target && e.target.files) window.__seen += e.target.files.length; }, true); });
    await upload(copy('p01-body-english-libreoffice.pdf', 'secret.pdf'));
    const seen = await page.evaluate(() => window.__seen);
    check('P1', "a listener the page puts on window never receives a held-back file", seen === 0, `files seen by the page: ${seen}`);

    // --- a send button with no label
    await clear();
    await page.evaluate(() => { const b = document.getElementById('send'); b.removeAttribute('aria-label'); b.removeAttribute('data-testid'); b.removeAttribute('title'); b.textContent = '>'; });
    await type('router admin password is Falcon42@Zt7 why is it rejected');
    await page.click('#send');
    await page.waitForTimeout(400);
    const firstWire = await wire();
    await page.click('#send');
    await page.waitForTimeout(600);
    const w = await wire();
    check('S1', 'typed password is redacted when the send button has no label', !/Falcon42/.test(firstWire) && !/Falcon42/.test(w) && /\[SECRET_1\]/.test(w), /\[SECRET_1\]/.test(w) ? 'vendor received [SECRET_1]' : 'vendor received: ' + w.slice(0, 80));

    // --- invisible characters and tatweel
    await clear();
    await type('pass​word: Riyadh77!Qx3 and server 10.20​.30.40');
    await page.keyboard.press('Enter'); await page.waitForTimeout(400); await page.click('#send'); await page.waitForTimeout(600);
    let got = await wire();
    check('T1', 'zero-width characters inside a keyword and an address do not hide them', !/Riyadh77|30\.40/.test(got) && /\[SECRET_1\]/.test(got) && /\[INTERNAL_IP_1\]/.test(got), got.replace(/\n/g, ' ').slice(0, 90));
    await clear();
    await type('محضر الاجتماع ســري للغاية لخصه لي');
    await page.keyboard.press('Enter'); await page.waitForTimeout(400); await page.click('#send'); await page.waitForTimeout(600);
    got = await wire();
    check('T2', 'a classification marking written with tatweel is blocked', got.trim() === '', got.trim() === '' ? 'nothing reached the vendor' : got.slice(0, 80));
    await clear();
    await type('كلمة المرور:‏ Riyadh77!Qx3 ما تشتغل');
    await page.keyboard.press('Enter'); await page.waitForTimeout(400); await page.click('#send'); await page.waitForTimeout(600);
    got = await wire();
    check('T3', 'a direction mark after an Arabic keyword does not hide the password', !/Riyadh77/.test(got) && /\[SECRET_1\]/.test(got), got.replace(/\n/g, ' ').slice(0, 90));
    await clear();
    await type('اكتب لي ايميل رسمي لمديري أطلب فيه إجازة يوم الأحد');
    await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    got = await wire();
    check('C1', 'an ordinary Arabic request still goes through unchanged', /إجازة يوم الأحد/.test(got), got.replace(/\n/g, ' ').slice(0, 70));
  } finally {
    await ctx.close(); demo.kill(); if (srv) srv.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  }
  const real = rows;
  const pass = real.filter(r => r.result === 'PASS').length;
  fs.writeFileSync(path.join(__dirname, 'results-e2e-audit.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), passed: pass, total: real.length, rows: real }, null, 1) + '\n');
  console.log(`\n${pass} of ${real.length} checks passed`);
  process.exit(pass === real.length ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
