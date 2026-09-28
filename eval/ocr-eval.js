/*
 * SADIN screenshot evaluation
 * Renders synthetic screenshots (admin consoles, terminals, Arabic memos with
 * classification stamps), runs them through the on-prem OCR pipeline, masks
 * the detected regions, then OCRs the masked image again to check that no
 * seeded value is still readable.
 *
 * Usage: TESSDATA_PREFIX=... node eval/ocr-eval.js [--keep]
 * Needs: playwright (Chromium), sharp, tesseract with ara+eng.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const NM = process.env.NODE_MODULES || "/home/claude/.npm-global/lib/node_modules";
const { chromium } = require(path.join(NM, "playwright"));
const sharp = require(path.join(NM, "sharp"));
const { ocr, inspectWords } = require("../server/server.js");

const OUT = path.join(__dirname, "ocr-images");
fs.mkdirSync(OUT, { recursive: true });

let seed = parseInt(process.env.SADIN_SEED || '7', 10); const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const ip = () => pick([`10.${int(1, 250)}.${int(1, 250)}.${int(2, 250)}`, `192.168.${int(1, 250)}.${int(2, 250)}`, `172.${int(16, 31)}.${int(1, 250)}.${int(2, 250)}`]);
const host = () => pick(["srv-db-0", "dc0", "fw-edge-0", "app-prod-0", "esxi-0"]) + int(1, 9) + (rnd() < 0.5 ? ".corp.example.sa" : "");
const user = () => pick(["m.alqahtani", "s.alotaibi", "n.alghamdi", "f.alharbi"]) + "@corp.example.sa";
const pw = () => pick(["Riyadh", "Falcon", "Najd"]) + int(10, 99) + pick(["!", "#", "@"]) + pick(["Qx", "Lm", "Zt"]) + int(1, 9);

const V = v => `<span class="v" data-v="${v}">${v}</span>`;
const CSS = `.v{background:transparent}
body{margin:0;font-family:"IBM Plex Sans Arabic","IBM Plex Sans",Arial,sans-serif;background:#fff;color:#1b1f23}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid #e5e7eb;padding:7px 10px;text-align:left}
th{background:#f3f4f6;font-weight:600}.term{background:#111;color:#e6e6e6;font:14px/1.5 "DejaVu Sans Mono",monospace;padding:16px;white-space:pre}
.bar{background:#1f2937;color:#fff;padding:10px 16px;font-weight:600}.memo{direction:rtl;padding:40px;font-size:17px;line-height:1.9;position:relative;width:720px}
.stamp{position:absolute;top:28px;left:40px;border:3px solid #b3261e;color:#b3261e;font-weight:700;font-size:26px;padding:4px 18px;border-radius:6px}`;

const templates = [
  function soc() {
    const rows = [[ip(), host(), user()], [ip(), host(), user()], [ip(), host(), user()]];
    const html = `<div class="bar">SOC Dashboard - Failed logons (last 1h)</div><div style="padding:12px"><table><tr><th>Source IP</th><th>Target host</th><th>Account</th><th>Count</th></tr>` +
      rows.map(r => `<tr><td>${V(r[0])}</td><td>${V(r[1])}</td><td>${V(r[2])}</td><td>${int(3, 60)}</td></tr>`).join("") + `</table></div>`;
    const expect = rows.flatMap(r => [r[0], r[1], r[2]]);
    return { kind: "soc-dashboard", html, width: 820, expect, classified: false };
  },
  function terminal() {
    const a = ip(), b = ip(), p = pw(), h = "RTR-BR-0" + int(1, 9);
    const html = `<div class="term">${V(h)}# show running-config | include key|address|hostname
hostname ${V(h)}
 ip address ${V(a)} 255.255.255.0
crypto isakmp key ${V(p)} address 203.0.113.${int(2, 250)}
ip route 0.0.0.0 0.0.0.0 ${V(b)}</div>`;
    return { kind: "router-terminal", html, width: 760, expect: [h, a, p, b], classified: false };
  },
  function erp() {
    const u1 = user(), u2 = user(), id1 = "EMP-" + int(100000, 999999), id2 = "EMP-" + int(100000, 999999);
    const html = `<div class="bar">HR Portal - Access requests</div><div style="padding:12px"><table><tr><th>Employee ID</th><th>Email</th><th>System</th><th>Status</th></tr>
<tr><td>${V(id1)}</td><td>${V(u1)}</td><td>ERP Finance</td><td>Pending</td></tr><tr><td>${V(id2)}</td><td>${V(u2)}</td><td>VPN</td><td>Approved</td></tr></table></div>`;
    return { kind: "hr-portal", html, width: 820, expect: [id1, u1, id2, u2], classified: false };
  },
  function memo() {
    const stamp = pick(["سري", "سري للغاية", "مقيد"]);
    const html = `<div class="memo"><div class="stamp">${stamp}</div><p style="margin-top:70px">سعادة مدير إدارة الأمن السيبراني</p><p>السلام عليكم ورحمة الله وبركاته، نرفق لكم تقرير تقييم المخاطر للربع الثالث مع خطة المعالجة المقترحة للأنظمة الحرجة.</p><p>مع خالص التحية</p></div>`;
    return { kind: "arabic-memo-stamp", html, width: 800, expect: [], classified: true, stamp };
  },
  function memoField() {
    const lvl = pick(["سري", "مقيد"]);
    const html = `<div class="memo"><p><b>التصنيف: ${lvl}</b></p><p>الموضوع: خطة استمرارية الأعمال لمركز البيانات الرئيسي</p><p>تم تحديث إجراءات التحويل إلى الموقع البديل وفق نتائج التمرين الأخير.</p></div>`;
    return { kind: "arabic-memo-field", html, width: 800, expect: [], classified: true, stamp: "التصنيف: " + lvl };
  }
];

function coverage(t, boxes) {
  // fraction of the value's rectangle covered by the union of mask boxes (grid sampling)
  const N = 24; let inside = 0, total = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = t.x + (i + 0.5) * t.w / N, y = t.y + (j + 0.5) * t.h / N;
    total++;
    if (boxes.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) inside++;
  }
  return total ? inside / total : 0;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const cases = [];
  for (let i = 0; i < 20; i++) cases.push(templates[i % templates.length]());
  const results = [];
  let items = 0, found = 0, residual = 0, clsTotal = 0, clsBlocked = 0, cleanWrong = 0;
  const times = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    await page.setViewportSize({ width: c.width, height: 200 });
    await page.setContent(`<style>${CSS}</style><div id="root" style="display:inline-block;width:${c.width}px">${c.html}</div>`);
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, `case${String(i + 1).padStart(2, "0")}-${c.kind}.png`);
    await (await page.$("#root")).screenshot({ path: file });
    const buf = fs.readFileSync(file);
    const t0 = Date.now();
    const { words } = await ocr(buf);
    const r = inspectWords(words);
    times.push(Date.now() - t0);
    const rec = { file: path.basename(file), kind: c.kind, action: r.action, boxes: r.boxes.length, missed: [], leakedAfterMask: [] };
    // ground-truth boxes straight from the DOM
    const truth = await page.evaluate(() => {
      const root = document.getElementById("root").getBoundingClientRect();
      return [...document.querySelectorAll(".v")].map(e => {
        const b = e.getBoundingClientRect();
        return { v: e.dataset.v, x: b.x - root.x, y: b.y - root.y, w: b.width, h: b.height };
      });
    });
    if (c.classified) {
      clsTotal++; if (r.action === "block") clsBlocked++; else rec.missed.push("stamp:" + c.stamp);
    } else {
      if (r.action === "block") cleanWrong++;
      const meta = await sharp(buf).metadata();
      const svg = `<svg width="${meta.width}" height="${meta.height}">${r.boxes.map(b => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#0E3F3C"/>`).join("")}</svg>`;
      const masked = await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
      fs.writeFileSync(file.replace(".png", "-masked.png"), masked);
      const again = await ocr(masked);
      const text2 = again.words.map(w => w.text).join(" ");
      for (const t of truth) {
        items++;
        // covered = at least 80% of the rendered value's area sits under mask boxes
        const cov = coverage(t, r.boxes);
        if (cov >= 0.8) found++; else rec.missed.push(t.v + " (covered " + Math.round(100 * cov) + "%)");
        if (text2.includes(t.v)) { residual++; rec.leakedAfterMask.push(t.v); }
      }
    }
    results.push(rec);
  }
  await browser.close();
  times.sort((a, b) => a - b);
  const summary = {
    images: cases.length,
    seededValues: items,
    valuesMasked: found,
    maskRecall: found / items,
    readableAfterMasking: residual,
    classifiedImages: clsTotal,
    classifiedBlocked: clsBlocked,
    nonClassifiedWronglyBlocked: cleanWrong,
    latencyMs: { median: times[Math.floor(times.length / 2)], max: times[times.length - 1] },
    results
  };
  fs.writeFileSync(path.join(__dirname, "results-ocr.json"), JSON.stringify(summary, null, 2));
  console.log(`Images: ${summary.images}  seeded values: ${items}`);
  console.log(`Values fully masked: ${found}/${items} = ${(100 * found / items).toFixed(1)}%`);
  console.log(`Readable after masking (re-OCR): ${residual}/${items}`);
  console.log(`Classified images blocked: ${clsBlocked}/${clsTotal}; non-classified wrongly blocked: ${cleanWrong}`);
  console.log(`Latency per image: median ${summary.latencyMs.median} ms, max ${summary.latencyMs.max} ms`);
  results.filter(r => r.missed.length || r.leakedAfterMask.length).forEach(r => console.log(" ", r.file, "missed:", r.missed.join(" | "), r.leakedAfterMask.length ? "LEAKED: " + r.leakedAfterMask.join(",") : ""));
})().catch(e => { console.error(e); process.exit(1); });
