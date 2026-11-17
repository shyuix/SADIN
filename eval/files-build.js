/*
 * Builds the test documents for eval/files-eval.js. No npm dependencies.
 *
 *   node eval/files-build.js structural   -> eval/file-fixtures/ (committed) + manifest.json
 *   node eval/files-build.js bulk <dir>   -> one .docx and two PDFs per item of the frozen
 *                                            held-out sets (holdout.js, arabic-holdout.js)
 *
 * Needs: LibreOffice (soffice) for docx -> PDF, Google Chrome/Chromium for HTML -> PDF,
 * poppler-utils, qpdf and ImageMagick (convert) for the scanned and protected PDFs.
 * Every secret in these files is fabricated.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

/* ---------- zip writer ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const locals = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const comp = zlib.deflateRawSync(data), nm = Buffer.from(name, "utf8"), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, comp); central.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

/* ---------- docx writer ---------- */
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const isAr = t => /[؀-ۿ]/.test(t);
const run = (t, bold) => `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
// one paragraph per line; Arabic lines are right-to-left paragraphs unless ltr is forced
function para(text, o) {
  o = o || {};
  return String(text).split("\n").map(line => {
    const rtl = o.rtl !== undefined ? o.rtl : isAr(line);
    return `<w:p>${rtl ? "<w:pPr><w:bidi/></w:pPr>" : ""}${o.raw ? line : run(line)}</w:p>`;
  }).join("");
}
function picture(rid, n, wEmu, hEmu) {
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${wEmu}" cy="${hEmu}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
/*
 * spec: { body: xml, header, footer, footnote, comment (plain text each), link: url, title,
 *         images: [{ ext, data, w, h }], extra: { "path": content } }
 */
function docx(spec) {
  const rels = [], types = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  ];
  const files = {};
  const W = "application/vnd.openxmlformats-officedocument.wordprocessingml.";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  let body = spec.body || "", sect = "";
  if (spec.header) {
    files["word/header1.xml"] = `${HEAD}<w:hdr ${NS}>${para(spec.header)}</w:hdr>`;
    types.push(`<Override PartName="/word/header1.xml" ContentType="${W}header+xml"/>`);
    rels.push(`<Relationship Id="rIdH" Type="${R}header" Target="header1.xml"/>`); sect += '<w:headerReference w:type="default" r:id="rIdH"/>';
  }
  if (spec.footer) {
    files["word/footer1.xml"] = `${HEAD}<w:ftr ${NS}>${para(spec.footer)}</w:ftr>`;
    types.push(`<Override PartName="/word/footer1.xml" ContentType="${W}footer+xml"/>`);
    rels.push(`<Relationship Id="rIdF" Type="${R}footer" Target="footer1.xml"/>`); sect += '<w:footerReference w:type="default" r:id="rIdF"/>';
  }
  if (spec.footnote) {
    files["word/footnotes.xml"] = `${HEAD}<w:footnotes ${NS}><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${run(" " + spec.footnote)}</w:p></w:footnote></w:footnotes>`;
    types.push(`<Override PartName="/word/footnotes.xml" ContentType="${W}footnotes+xml"/>`);
    rels.push(`<Relationship Id="rIdN" Type="${R}footnotes" Target="footnotes.xml"/>`);
    body += `<w:p>${run("See the note")}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
  }
  if (spec.comment) {
    files["word/comments.xml"] = `${HEAD}<w:comments ${NS}><w:comment w:id="0" w:author="Reviewer" w:initials="R">${para(spec.comment)}</w:comment></w:comments>`;
    types.push(`<Override PartName="/word/comments.xml" ContentType="${W}comments+xml"/>`);
    rels.push(`<Relationship Id="rIdC" Type="${R}comments" Target="comments.xml"/>`);
    body += `<w:p><w:commentRangeStart w:id="0"/>${run("Please review this paragraph.")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`;
  }
  if (spec.link) {
    rels.push(`<Relationship Id="rIdL" Type="${R}hyperlink" Target="${esc(spec.link)}" TargetMode="External"/>`);
    body += `<w:p><w:hyperlink r:id="rIdL">${run("Open the dashboard")}</w:hyperlink></w:p>`;
  }
  (spec.images || []).forEach((im, i) => {
    const name = `image${i + 1}.${im.ext}`;
    files["word/media/" + name] = im.data;
    if (!types.some(t => t.includes(`Extension="${im.ext}"`))) types.push(`<Default Extension="${im.ext}" ContentType="image/${im.ext === "jpg" ? "jpeg" : im.ext === "emf" ? "x-emf" : im.ext}"/>`);
    rels.push(`<Relationship Id="rIdI${i + 1}" Type="${R}image" Target="media/${name}"/>`);
    body += picture(`rIdI${i + 1}`, i + 1, im.w || 4572000, im.h || 914400);
  });
  let rootRels = "";
  if (spec.custom) {
    files["docProps/custom.xml"] = `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${Object.entries(spec.custom).map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${esc(k)}"><vt:lpwstr>${esc(v)}</vt:lpwstr></property>`).join("")}</Properties>`;
    types.push('<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>');
    rootRels += `<Relationship Id="rId3" Type="${R}custom-properties" Target="docProps/custom.xml"/>`;
  }
  if (spec.labelInfo) {
    files["docMetadata/LabelInfo.xml"] = `${HEAD}<clbl:labelList xmlns:clbl="http://schemas.microsoft.com/office/2020/mipLabelMetadata">${spec.labelInfo}</clbl:labelList>`;
    types.push('<Override PartName="/docMetadata/LabelInfo.xml" ContentType="application/vnd.ms-office.classificationlabels+xml"/>');
    rootRels += '<Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2020/02/relationships/classificationlabels" Target="docMetadata/LabelInfo.xml"/>';
  }
  files["[Content_Types].xml"] = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.join("")}${spec.types || ""}</Types>`;
  files["_rels/.rels"] = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>${rootRels}</Relationships>`;
  files["docProps/core.xml"] = `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(spec.title || "Document")}</dc:title><dc:creator>SADIN test</dc:creator></cp:coreProperties>`;
  files["word/_rels/document.xml.rels"] = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;
  files["word/document.xml"] = `${HEAD}<w:document ${NS}><w:body>${body}<w:sectPr>${sect}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  Object.assign(files, spec.extra || {});
  return zip(files);
}

/* ---------- converters ---------- */
const sh = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ stdio: ["ignore", "pipe", "pipe"], timeout: 600000 }, opts || {}));
function sofficeToPdf(docxPaths, outDir) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-lo-"));
  for (let i = 0; i < docxPaths.length; i += 40) {
    sh("soffice", ["-env:UserInstallation=file://" + profile, "--headless", "--convert-to", "pdf", "--outdir", outDir, ...docxPaths.slice(i, i + 40)]);
  }
  fs.rmSync(profile, { recursive: true, force: true });
}
function htmlFor(text) {
  const lines = String(text).split("\n").map(l => `<p dir="${isAr(l) ? "rtl" : "ltr"}">${esc(l) || "&nbsp;"}</p>`).join("");
  return `<!doctype html><meta charset="utf-8"><style>body{font:13pt 'Noto Naskh Arabic','DejaVu Sans',sans-serif;margin:25mm}p{margin:0 0 6px;white-space:pre-wrap;overflow-wrap:anywhere}</style>${lines}`;
}
function chromeToPdf(htmlPath, pdfPath) {
  const bin = ["google-chrome", "chromium", "chromium-browser"].find(b => { try { sh("which", [b]); return true; } catch (e) { return false; } });
  if (!bin) throw new Error("Chrome/Chromium not found");
  sh(bin, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", "--print-to-pdf=" + pdfPath, "file://" + htmlPath]);
}
// first page of a PDF as a PNG (a "screenshot" or a "scan" with properly shaped Arabic)
function pdfToPng(pdfPath, pngBase, dpi, trim) {
  sh("pdftoppm", ["-r", String(dpi || 110), "-png", "-singlefile", "-f", "1", "-l", "1", pdfPath, pngBase]);
  if (trim) sh("convert", [pngBase + ".png", "-trim", "-bordercolor", "white", "-border", "24", "+repage", pngBase + ".png"]);
  return pngBase + ".png";
}
// hand-written PDF: page text plus optional annotation / form objects
function rawPdf(pageText, annots, catalogExtra, opts) {
  opts = opts || {};
  const objs = [null, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", null, null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const stream = `BT /F1 12 Tf 72 720 Td (${pageText}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  const refs = (annots || []).map((a, i) => { objs.push(a); return `${6 + i} 0 R`; });
  objs[2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${refs.length ? ` /Annots [${refs.join(" ")}]` : ""} >>`;
  let infoRef = "", metaRef = "";
  if (opts.info) { objs.push(`<< ${opts.info} >>`); infoRef = ` /Info ${objs.length} 0 R`; }
  if (opts.xmp) { objs.push(`<< /Type /Metadata /Subtype /XML /Length ${opts.xmp.length} >>\nstream\n${opts.xmp}\nendstream`); metaRef = `/Metadata ${objs.length} 0 R `; }
  objs[0] = `<< /Type /Catalog /Pages 2 0 R ${metaRef}${catalogExtra ? catalogExtra(refs) : ""}>>`;
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${infoRef} >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* ---------- structural set ---------- */
function structural(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-fx-"));
  const manifest = [];
  const add = (file, expect, where, note, more) => manifest.push(Object.assign({ file, expect, where, note: note || undefined }, more || {}));
  const W = (name, buf) => fs.writeFileSync(path.join(outDir, name), buf);

  const EN_SECRET = "Why does this keep failing? mysql -h 10.44.7.21 -u root -pWinter!Root2026 inventory";
  const AR_SECRET = "عنوان خادم قاعدة البيانات 10.61.4.18 والمنفذ 5432 وكلمة المرور Dammam#2026db";
  const EN_CLEAN = "Meeting notes\nWe agreed to move the workshop to Tuesday and to send the agenda by Sunday.\nAction: prepare three slides on the new onboarding flow.";
  const AR_CLEAN = "محضر الاجتماع\nتم الاتفاق على تأجيل الورشة إلى يوم الثلاثاء وإرسال جدول الأعمال يوم الأحد.\nالمطلوب: تجهيز ثلاث شرائح عن تجربة الموظف الجديد.";
  const filler = para("Quarterly operations summary") + para("The team closed 42 tickets this month and onboarding time went down.");

  // pictures: a "screenshot" with a secret, one with Arabic, and a harmless one
  const mk = (name, text) => { const d = path.join(tmp, name + ".docx"); fs.writeFileSync(d, docx({ body: para(text) })); return d; };
  const shots = { secret: mk("shot-secret", "ssh admin@10.88.3.12\npassword: Harbor!Pass7741"), clean: mk("shot-clean", "Sales by region 2026\nNorth 41%   South 33%   West 26%"), arsecret: mk("shot-ar", "كلمة المرور للخادم 10.52.9.14 هي Najd#Server55") };
  sofficeToPdf(Object.values(shots), tmp);
  const png = {};
  for (const k of Object.keys(shots)) png[k] = fs.readFileSync(pdfToPng(shots[k].replace(/\.docx$/, ".pdf"), path.join(tmp, "png-" + k), 110, true));
  const img = d => ({ ext: "png", data: d });

  // --- Word documents ---
  const D = {
    "d01-body-english.docx": [{ body: filler + para(EN_SECRET) }, "block", "body text"],
    "d02-body-arabic-rtl.docx": [{ body: para("ملخص العمليات الشهري") + para(AR_SECRET) }, "block", "body text, right-to-left paragraph"],
    "d03-body-arabic-ltr-paragraph.docx": [{ body: para("كلمة السر لحساب الخدمة: Tabuk!Svc9920", { rtl: false }) }, "block", "Arabic typed in a left-to-right paragraph"],
    "d04-table-cell.docx": [{ body: filler + `<w:tbl><w:tr><w:tc>${para("Host")}</w:tc><w:tc>${para("Password")}</w:tc></w:tr><w:tr><w:tc>${para("10.70.2.9")}</w:tc><w:tc>${para("password: Qassim!Db4410")}</w:tc></w:tr></w:tbl>` + para("End of table") }, "block", "table cell"],
    "d05-header.docx": [{ body: filler, header: "Internal build server 10.33.8.40 login root password: Hail!Root7733" }, "block", "page header"],
    "d06-footer.docx": [{ body: filler, footer: "VPN gateway 10.90.1.1 shared secret: Abha!Vpn2026x" }, "block", "page footer"],
    "d07-footnote.docx": [{ body: filler, footnote: "admin console at 10.12.6.77, password: Jazan!Adm5519" }, "block", "footnote"],
    "d08-comment.docx": [{ body: filler, comment: "use the old db password: Taif!Old8842 on 10.14.2.60" }, "block", "review comment"],
    "d09-hyperlink-target.docx": [{ body: filler, link: "http://10.77.8.9:8443/admin/login" }, "block", "hyperlink target (the visible text is harmless)"],
    "d10-tracked-deletion.docx": [{ body: filler + `<w:p>${run("The service account was rotated. ")}<w:del w:id="5" w:author="Editor" w:date="2026-11-01T10:00:00Z"><w:r><w:delText xml:space="preserve">Old password: Yanbu!Svc6610 on host 10.21.5.5</w:delText></w:r></w:del></w:p>` }, "block", "text deleted with Track Changes"],
    "d11-split-runs.docx": [{ body: filler + `<w:p>${run("db password: Kh")}${run("obar!Db", true)}${run("7719 for 10.4")}${run("1.9.30", true)}</w:p>` }, "block", "value split across formatting runs"],
    "d12-embedded-screenshot.docx": [{ body: filler + para("Terminal output attached:"), images: [img(png.secret)] }, "block", "picture inside the document (OCR)"],
    "d13-classified-stamp-arabic.docx": [{ body: para("التصنيف: سري للغاية") + para("خطة استمرارية الأعمال للعام القادم") }, "block", "classification marking"],
    "d14-document-title.docx": [{ body: filler, title: "root password: Arar!Root3381 for 10.19.3.3" }, "block", "document properties (title)"],
    "d15-clean-english.docx": [{ body: para(EN_CLEAN) }, "allow", "nothing sensitive"],
    "d16-clean-arabic.docx": [{ body: para(AR_CLEAN) }, "allow", "nothing sensitive"],
    "d17-clean-with-picture.docx": [{ body: para(EN_CLEAN), images: [img(png.clean)] }, "allow", "harmless picture (OCR)"],
    "d18-macros.docx": [{ body: filler, extra: { "word/vbaProject.bin": Buffer.from("not a real macro") } }, "uninspectable", "macro project"],
    "d19-embedded-object.docx": [{ body: filler, extra: { "word/embeddings/Microsoft_Excel_Sheet1.xlsx": Buffer.from("PK placeholder") } }, "uninspectable", "embedded spreadsheet"],
    "d20-emf-picture.docx": [{ body: filler, images: [{ ext: "emf", data: Buffer.from("fake emf") }] }, "uninspectable", "picture format OCR cannot read"],
    "d25-unknown-part.docx": [{ body: filler, extra: { "word/activeX/activeX1.bin": Buffer.from("opaque control data") } }, "uninspectable", "a component SADIN does not know how to read"],
    "d26-chart-title.docx": [{ body: filler, extra: { "word/charts/chart1.xml": '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Backup server 10.66.1.20 password: Najran!Bkp4471</a:t></a:r></a:p></c:rich></c:tx></c:title></c:chart></c:chartSpace>' } }, "block", "chart title"],
    "d27-text-box.docx": [{ body: filler + `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:300pt;height:40pt"><v:textbox><w:txbxContent>${para("router enable password: Baha!Rtr9034 at 10.8.8.1")}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>` }, "block", "text box"],
    "d21-too-many-pictures.docx": [{ body: filler, images: Array.from({ length: 9 }, () => img(png.clean)) }, "uninspectable", "9 pictures, over the limit of 8"]
  };
  for (const [name, [spec, expect, where]] of Object.entries(D)) { W(name, docx(spec)); add(name, expect, where); }
  const whole = docx({ body: para(EN_SECRET) });
  W("d22-truncated.docx", whole.subarray(0, Math.floor(whole.length / 2))); add("d22-truncated.docx", "uninspectable", "damaged file");
  W("d23-spreadsheet-renamed.docx", zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>", "xl/sharedStrings.xml": "<sst><si><t>password: Hidden!Xl2026</t></si></sst>" })); add("d23-spreadsheet-renamed.docx", "uninspectable", "an .xlsx renamed to .docx");
  W("d24-legacy-doc.docx", Buffer.concat([Buffer.from("D0CF11E0A1B11AE1", "hex"), Buffer.alloc(504)])); add("d24-legacy-doc.docx", "uninspectable", "legacy or password-protected Office container");

  // --- Word files re-saved by LibreOffice (a real producer's full set of parts) ---
  const rs = path.join(tmp, "resave"); fs.mkdirSync(rs);
  const resave = { "d02-body-arabic-rtl": ["d28-arabic-saved-by-libreoffice.docx", "block", "body text"], "d16-clean-arabic": ["d29-clean-arabic-saved-by-libreoffice.docx", "allow", "nothing sensitive"], "d15-clean-english": ["d30-clean-english-saved-by-libreoffice.docx", "allow", "nothing sensitive"] };
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-lo-"));
  sh("soffice", ["-env:UserInstallation=file://" + prof, "--headless", "--convert-to", "docx:MS Word 2007 XML", "--outdir", rs, ...Object.keys(resave).map(n => path.join(outDir, n + ".docx"))]);
  fs.rmSync(prof, { recursive: true, force: true });
  for (const [src, [name, expect, where]] of Object.entries(resave)) { fs.copyFileSync(path.join(rs, src + ".docx"), path.join(outDir, name)); add(name, expect, where, "re-saved as .docx by LibreOffice"); }

  // --- PDFs written by LibreOffice from the Word files above ---
  const viaLO = ["d01-body-english", "d02-body-arabic-rtl", "d03-body-arabic-ltr-paragraph", "d04-table-cell", "d05-header", "d06-footer", "d07-footnote", "d09-hyperlink-target", "d11-split-runs", "d12-embedded-screenshot", "d13-classified-stamp-arabic", "d15-clean-english", "d16-clean-arabic", "d17-clean-with-picture"];
  const stage = path.join(tmp, "lo"); fs.mkdirSync(stage);
  for (const n of viaLO) fs.copyFileSync(path.join(outDir, n + ".docx"), path.join(stage, n + ".docx"));
  sofficeToPdf(viaLO.map(n => path.join(stage, n + ".docx")), stage);
  viaLO.forEach((n, i) => {
    const name = "p" + String(i + 1).padStart(2, "0") + n.slice(3) + "-libreoffice.pdf";
    fs.copyFileSync(path.join(stage, n + ".pdf"), path.join(outDir, name));
    add(name, D[n + ".docx"][1], D[n + ".docx"][2], "LibreOffice export of " + n + ".docx");
  });

  // --- PDFs printed from Chrome ---
  const C = { "p20-english-chrome.pdf": [EN_SECRET, "block"], "p21-arabic-chrome.pdf": [AR_SECRET, "block"], "p22-clean-arabic-chrome.pdf": [AR_CLEAN, "allow"], "p23-clean-english-chrome.pdf": [EN_CLEAN, "allow"] };
  for (const [name, [text, expect]] of Object.entries(C)) {
    const h = path.join(tmp, name + ".html"); fs.writeFileSync(h, htmlFor(text));
    chromeToPdf(h, path.join(outDir, name)); add(name, expect, "body text", "printed to PDF from Chrome");
  }

  // --- scanned PDFs (pictures of pages, no text layer) ---
  const scan = (name, pngBuf, expect, where) => { const p = path.join(tmp, name + ".png"); fs.writeFileSync(p, pngBuf); sh("convert", [p, "-units", "PixelsPerInch", "-density", "110", path.join(outDir, name)]); add(name, expect, where, "image-only PDF, read with OCR"); };
  scan("p30-scanned-english.pdf", png.secret, "block", "scanned page");
  scan("p31-scanned-arabic.pdf", png.arsecret, "block", "scanned page, Arabic");
  scan("p32-scanned-clean.pdf", png.clean, "allow", "scanned page, nothing sensitive");

  // --- content outside the page text ---
  W("p40-sticky-note.pdf", rawPdf("Quarterly notes", ["<< /Type /Annot /Subtype /Text /Rect [72 600 92 620] /Contents (server 10.20.30.40 root password: Kh4lid!Root2026) >>"])); add("p40-sticky-note.pdf", "block", "sticky-note comment");
  W("p41-form-field.pdf", rawPdf("Access request form", ["<< /Type /Annot /Subtype /Widget /FT /Tx /T (pw) /V (db password: Tr1pleSec_4410) /Rect [72 650 400 670] /DA (/F1 12 Tf 0 g) >>"], refs => `/AcroForm << /Fields [${refs.join(" ")}] /DA (/F1 12 Tf 0 g) /DR << /Font << /F1 5 0 R >> >> >> `)); add("p41-form-field.pdf", "block", "form-field value");
  W("p42-link-target.pdf", rawPdf("Open the dashboard", ["<< /Type /Annot /Subtype /Link /Rect [72 715 200 735] /A << /S /URI /URI (http://10.77.8.9:8443/admin/login) >> >>"])); add("p42-link-target.pdf", "block", "link target (the visible text is harmless)");

  // --- files that must not be let through unread ---
  const base = path.join(outDir, "p01-body-english-libreoffice.pdf");
  sh("qpdf", ["--encrypt", "open-me", "owner-me", "256", "--", base, path.join(outDir, "p50-password-protected.pdf")]); add("p50-password-protected.pdf", "uninspectable", "password to open");
  sh("qpdf", ["--encrypt", "", "owner-me", "256", "--extract=n", "--", base, path.join(outDir, "p51-copy-restricted.pdf")]); add("p51-copy-restricted.pdf", "uninspectable", "encrypted, copying disabled");
  const cleanPdf = path.join(outDir, "p12-clean-english-libreoffice.pdf");
  sh("qpdf", ["--empty", "--pages", ...Array(61).fill(cleanPdf), "--", path.join(outDir, "p52-61-pages.pdf")]); add("p52-61-pages.pdf", "uninspectable", "61 pages, over the limit of 60");
  sh("qpdf", ["--empty", "--pages", ...Array(9).fill(path.join(outDir, "p32-scanned-clean.pdf")), "--", path.join(outDir, "p53-9-scanned-pages.pdf")]); add("p53-9-scanned-pages.pdf", "uninspectable", "9 scanned pages, over the limit of 8");
  const att = path.join(tmp, "notes.txt"); fs.writeFileSync(att, "password: Hidden!Att2026\n");
  sh("qpdf", ["--add-attachment", att, "--", cleanPdf, path.join(outDir, "p54-attachment.pdf")]); add("p54-attachment.pdf", "uninspectable", "file attached inside the PDF");
  W("p55-damaged.pdf", Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("garbage ".repeat(400))])); add("p55-damaged.pdf", "uninspectable", "damaged file");

  // --- sensitivity labels: every body below is harmless, only the label differs ---
  const G1 = "3f6a1c2e-7b4d-4e19-9a52-0c8d5e7f1b23";   // mapped to "secret" in policy-labels.json
  const G2 = "9d2b7e41-5c38-4f06-b1a7-6e4c0a9d8f35";   // not mapped anywhere
  const SITE = "5b1e9f70-2a64-4c83-8d17-f3a6b0c4e291";
  const msip = (g, name, enabled) => Object.assign({ [`MSIP_Label_${g}_Enabled`]: enabled === false ? "false" : "true", [`MSIP_Label_${g}_SetDate`]: "2026-11-01T08:00:00Z", [`MSIP_Label_${g}_Method`]: "Standard", [`MSIP_Label_${g}_SiteId`]: SITE, [`MSIP_Label_${g}_ContentBits`]: "0" }, name ? { [`MSIP_Label_${g}_Name`]: name } : {});
  const li = (g, removed) => `<clbl:label id="{${g}}" enabled="1" method="Standard" siteId="{${SITE}}" contentBits="0" removed="${removed ? 1 : 0}"/>`;
  const plain = para(EN_CLEAN), plainAr = para(AR_CLEAN);
  const LAB = {
    "d40-label-restricted.docx": [{ body: plain, custom: msip(G2, "Restricted") }, "block", "labelled", "Purview label named Restricted, harmless text"],
    "d41-label-arabic-top-secret.docx": [{ body: plainAr, custom: msip(G2, "سري للغاية") }, "block", "labelled", "Purview label with an Arabic name"],
    "d42-label-guid-mapped.docx": [{ body: plain, labelInfo: li(G1) }, "block", "labelled", "label list with a GUID the organisation mapped to Secret", true],
    "d43-label-guid-unmapped.docx": [{ body: plain, labelInfo: li(G2) }, "block", "unknown-label", "label list with a GUID nobody mapped"],
    "d44-label-removed.docx": [{ body: plain, labelInfo: li(G1, true) }, "allow", undefined, "label marked as removed", true],
    "d45-label-public.docx": [{ body: plain, custom: msip(G2, "Public") }, "allow", undefined, "Purview label named Public"],
    "d46-label-public-with-password.docx": [{ body: plain + para(EN_SECRET), custom: msip(G2, "Public") }, "block", "secret-in-file", "labelled Public but the text holds a password"],
    "d47-classification-property-arabic.docx": [{ body: plainAr, custom: { "التصنيف": "مقيّد" } }, "block", "labelled", "plain classification property in Arabic"],
    "d48-label-disabled.docx": [{ body: plain, custom: msip(G2, "Secret", false) }, "allow", undefined, "label switched off (Enabled=false)"],
    "d49-label-sublabel.docx": [{ body: plain, custom: msip(G2, "Confidential \\ Finance") }, "block", "labelled", "sub-label under Confidential"],
    "d50-label-organisation-name.docx": [{ body: plain, custom: msip(G2, "Internal Use Only") }, "block", "labelled", "the organisation's own label name, mapped in the policy", true],
    "d51-label-unknown-name.docx": [{ body: plain, custom: msip(G2, "Project Falcon") }, "block", "unknown-label", "label name with no rule"],
    "d52-no-label-custom-property.docx": [{ body: plain, custom: { "Department": "Finance", "Reviewed": "yes" } }, "allow", undefined, "custom properties that are not labels"]
  };
  for (const [name, [spec, expect, reason, where, pol]] of Object.entries(LAB)) { W(name, docx(spec)); add(name, expect, where, undefined, { reason, policy: pol ? "policy-labels.json" : undefined }); }
  const pinfo = (g, name) => `/Title (Meeting notes) /MSIP_Label_${g}_Enabled (true) /MSIP_Label_${g}_SiteId (${SITE})${name ? ` /MSIP_Label_${g}_Name (${name})` : ""}`;
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/"><pdfx:MSIP_Label_${G2}_Enabled>true</pdfx:MSIP_Label_${G2}_Enabled><pdfx:MSIP_Label_${G2}_Name>Restricted</pdfx:MSIP_Label_${G2}_Name></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const PL = {
    "p60-label-secret.pdf": [{ info: pinfo(G2, "Secret") }, "block", "labelled", "Purview label in the document properties"],
    "p61-label-xmp-restricted.pdf": [{ xmp }, "block", "labelled", "Purview label in the XMP metadata"],
    "p62-label-public.pdf": [{ info: pinfo(G2, "Public") }, "allow", undefined, "Purview label named Public"],
    "p63-label-guid-mapped.pdf": [{ info: pinfo(G1) }, "block", "labelled", "label GUID the organisation mapped to Secret, no name", true],
    "p64-label-guid-unmapped.pdf": [{ info: pinfo(G2) }, "block", "unknown-label", "label GUID nobody mapped, no name"],
    "p65-classification-property.pdf": [{ info: "/Title (Meeting notes) /Classification (Top Secret)" }, "block", "labelled", "plain classification property"]
  };
  for (const [name, [o, expect, reason, where, pol]] of Object.entries(PL)) { W(name, rawPdf("Meeting notes: the workshop moves to Tuesday.", [], null, o)); add(name, expect, where, undefined, { reason, policy: pol ? "policy-labels.json" : undefined }); }
  // what happens to a label when another tool rewrites the file (LibreOffice here)
  const lt = path.join(tmp, "labels-lo"); fs.mkdirSync(lt);
  const lprof = fs.mkdtempSync(path.join(os.tmpdir(), "sadin-lo-"));
  const lsrc = ["d40-label-restricted.docx", "d42-label-guid-mapped.docx"].map(n => path.join(outDir, n));
  sh("soffice", ["-env:UserInstallation=file://" + lprof, "--headless", "--convert-to", "docx:MS Word 2007 XML", "--outdir", lt, ...lsrc]);
  sh("soffice", ["-env:UserInstallation=file://" + lprof, "--headless", "--convert-to", "pdf", "--outdir", lt, lsrc[0]]);
  fs.rmSync(lprof, { recursive: true, force: true });
  fs.copyFileSync(path.join(lt, "d40-label-restricted.docx"), path.join(outDir, "d53-label-kept-after-libreoffice-save.docx")); add("d53-label-kept-after-libreoffice-save.docx", "block", "Purview label in custom properties, file re-saved by LibreOffice", undefined, { reason: "labelled" });
  fs.copyFileSync(path.join(lt, "d42-label-guid-mapped.docx"), path.join(outDir, "d54-label-list-lost-after-libreoffice-save.docx")); add("d54-label-list-lost-after-libreoffice-save.docx", "allow", "label list dropped by LibreOffice when it re-saved the file", "known gap: the label is no longer in the file", { policy: "policy-labels.json", gap: true });
  fs.copyFileSync(path.join(lt, "d40-label-restricted.pdf"), path.join(outDir, "p66-label-lost-in-libreoffice-pdf.pdf")); add("p66-label-lost-in-libreoffice-pdf.pdf", "allow", "labelled Word file exported to PDF by LibreOffice, which does not copy the label", "known gap: the label is no longer in the file", { gap: true });
  fs.writeFileSync(path.join(outDir, "policy-labels.json"), JSON.stringify({ labels: { ids: { [G1]: "secret" }, names: { "Internal Use Only": "restricted" } } }, null, 2) + "\n");

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`structural set: ${manifest.length} files in ${outDir}`);
}

/* ---------- bulk set from the frozen held-out corpora ---------- */
function bulk(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const sets = [require("./holdout.js"), require("./arabic-holdout.js")];
  const items = [];
  for (const s of sets) { for (const it of s.SENSITIVE) items.push(Object.assign({ sensitive: true }, it)); for (const it of s.CLEAN) items.push(Object.assign({ sensitive: false }, it)); }
  const docs = [];
  for (const it of items) {
    const d = path.join(outDir, it.id + ".docx"); fs.writeFileSync(d, docx({ body: para(it.text) })); docs.push(d);
    fs.writeFileSync(path.join(outDir, it.id + ".html"), htmlFor(it.text));
  }
  const lo = path.join(outDir, "lo"); fs.mkdirSync(lo, { recursive: true });
  sofficeToPdf(docs, lo);
  for (const it of items) {
    fs.renameSync(path.join(lo, it.id + ".pdf"), path.join(outDir, it.id + ".libreoffice.pdf"));
    chromeToPdf(path.join(outDir, it.id + ".html"), path.join(outDir, it.id + ".chrome.pdf"));
  }
  fs.rmSync(lo, { recursive: true, force: true });
  fs.writeFileSync(path.join(outDir, "items.json"), JSON.stringify(items.map(i => ({ id: i.id, lang: i.lang, sensitive: i.sensitive, text: i.text })), null, 1));
  console.log(`bulk set: ${items.length} items x 3 formats in ${outDir}`);
}

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === "structural") structural(path.join(__dirname, "file-fixtures"));
  else if (mode === "bulk" && process.argv[3]) bulk(path.resolve(process.argv[3]));
  else { console.error("usage: node eval/files-build.js structural | bulk <dir>"); process.exit(1); }
}
module.exports = { docx, zip, para };
