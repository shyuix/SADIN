/*
 * SADIN content script
 * Sits between the employee and the AI tool's page. Every paste, drop, file
 * upload and send passes through here before the page (and the vendor) sees it.
 */
(function () {
  "use strict";
  if (window.__sadinLoaded) return;
  window.__sadinLoaded = true;

  var E = globalThis.SadinEngine;
  var policy = null;          // merged policy from background (managed storage + server)
  var reentry = false;        // true while we re-dispatch a sanitised event
  var TEXT_EXT = /\.(txt|csv|tsv|json|ya?ml|env|conf|cfg|cnf|ini|log|xml|md|sh|bash|ps1|psm1|py|js|ts|java|cs|go|rb|php|sql|pem|key|crt|tf|tfvars|properties|toml|config|htaccess)$/i;
  var IMG_TYPE = /^image\/(png|jpe?g|webp|gif|bmp)$/i;

  chrome.runtime.sendMessage({ type: "getPolicy" }, function (p) { policy = p || null; });

  function tool() { return location.hostname; }
  function scan(text) { return E.scan(text, policy); }

  function log(channel, r, extra) {
    try {
      chrome.runtime.sendMessage({
        type: "log",
        event: Object.assign({ tool: tool(), channel: channel, action: r.action, categories: r.categories, placeholders: r.placeholders || 0 }, extra || {})
      });
    } catch (e) { /* extension reloaded */ }
  }

  // ---------------------------------------------------------------------------
  // Composer helpers (works for <textarea> and contenteditable editors)
  // ---------------------------------------------------------------------------
  function composerFrom(el) {
    if (!el || !el.closest) return null;
    return el.closest("textarea, [contenteditable='true'], [contenteditable=''], [role='textbox']");
  }
  function findComposer() {
    var a = composerFrom(document.activeElement);
    if (a) return a;
    return document.querySelector("#prompt-textarea, textarea, [contenteditable='true'][role='textbox'], div.ProseMirror[contenteditable='true'], rich-textarea [contenteditable='true']");
  }
  function composerText(c) {
    if (!c) return "";
    return c.tagName === "TEXTAREA" || c.tagName === "INPUT" ? c.value : (c.innerText || "");
  }
  function insertText(text) {
    // execCommand keeps the editor's own undo stack and change handlers in sync
    if (!document.execCommand("insertText", false, text)) {
      var c = findComposer();
      if (c && (c.tagName === "TEXTAREA" || c.tagName === "INPUT")) {
        var s = c.selectionStart, e = c.selectionEnd;
        setNativeValue(c, c.value.slice(0, s) + text + c.value.slice(e));
      }
    }
  }
  function setNativeValue(el, value) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function replaceComposer(c, text) {
    c.focus();
    if (c.tagName === "TEXTAREA" || c.tagName === "INPUT") { setNativeValue(c, text); return; }
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(c);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("insertText", false, text);
  }

  // ---------------------------------------------------------------------------
  // 1. Paste
  // ---------------------------------------------------------------------------
  window.addEventListener("paste", function (e) {
    if (reentry || !e.isTrusted) return;
    var dt = e.clipboardData;
    if (!dt) return;
    var files = Array.prototype.slice.call(dt.files || []);
    if (files.length) {
      stop(e);
      handleFiles(files, "paste", function (clean) { redispatchPaste(e.target, clean, dt.getData("text/plain")); });
      return;
    }
    var text = dt.getData("text/plain");
    if (!text) return;
    var r = scan(text);
    if (r.action === "allow") return;
    if (r.action === "warn") { notify(r, "paste"); log("paste", r); return; }
    stop(e);
    if (r.action === "block") { notify(r, "paste"); log("paste", r); return; }
    insertText(r.redactedText);
    notify(r, "paste");
    log("paste", r);
  }, true);

  // ---------------------------------------------------------------------------
  // 2. Drag and drop
  // ---------------------------------------------------------------------------
  window.addEventListener("drop", function (e) {
    if (reentry || !e.isTrusted || !e.dataTransfer) return;
    var files = Array.prototype.slice.call(e.dataTransfer.files || []);
    if (files.length) {
      stop(e);
      var target = e.target, x = e.clientX, y = e.clientY;
      handleFiles(files, "drop", function (clean) {
        var dt = new DataTransfer();
        clean.forEach(function (f) { dt.items.add(f); });
        reentry = true;
        try { target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y })); }
        finally { reentry = false; }
      });
      return;
    }
    var text = e.dataTransfer.getData("text/plain");
    if (!text) return;
    var r = scan(text);
    if (r.action === "allow") return;
    if (r.action === "warn") { notify(r, "drop"); log("drop", r); return; }
    stop(e);
    if (r.action !== "block") { var c = composerFrom(e.target) || findComposer(); if (c) { c.focus(); insertText(r.redactedText); } }
    notify(r, "drop");
    log("drop", r);
  }, true);

  // ---------------------------------------------------------------------------
  // 3. File picker uploads
  // ---------------------------------------------------------------------------
  document.addEventListener("change", function (e) {
    var input = e.target;
    if (reentry || !e.isTrusted || !input || input.tagName !== "INPUT" || input.type !== "file") return;
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    stop(e);
    handleFiles(files, "file", function (clean) {
      var dt = new DataTransfer();
      clean.forEach(function (f) { dt.items.add(f); });
      input.files = dt.files;
      if (!clean.length) { input.value = ""; return; }
      reentry = true;
      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } finally { reentry = false; }
    });
  }, true);

  // ---------------------------------------------------------------------------
  // 4. Typed text: check at send time (Enter or the send button)
  // ---------------------------------------------------------------------------
  function checkBeforeSend(e) {
    var c = findComposer();
    var text = composerText(c);
    if (!text || !text.trim()) return;
    var r = scan(text);
    if (r.action === "allow" || r.action === "warn") { if (r.action === "warn") log("type", r); return; }
    stop(e);
    if (r.action === "redact") replaceComposer(c, r.redactedText);
    notify(r, "type");
    log("type", r);
  }
  window.addEventListener("keydown", function (e) {
    if (!e.isTrusted || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    if (!composerFrom(e.target)) return;
    checkBeforeSend(e);
  }, true);
  window.addEventListener("click", function (e) {
    if (!e.isTrusted) return;
    var b = e.target && e.target.closest && e.target.closest("button, [role='button']");
    if (!b) return;
    var sig = [(b.getAttribute("aria-label") || ""), (b.getAttribute("data-testid") || ""), (b.title || "")].join(" ");
    if (!/send|submit|إرسال|ارسال/i.test(sig)) return;
    checkBeforeSend(e);
  }, true);

  function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  // ---------------------------------------------------------------------------
  // File handling: text files are scanned here; images go to the on-prem OCR
  // service; anything SADIN cannot inspect follows the fail-closed policy.
  // ---------------------------------------------------------------------------
  function handleFiles(files, channel, done) {
    var out = [], pending = files.length, summary = { action: "allow", categories: {}, placeholders: 0, files: [] };
    function merge(r, name) {
      var rank = { allow: 0, warn: 1, redact: 2, block: 3 };
      if (rank[r.action] > rank[summary.action]) summary.action = r.action;
      Object.keys(r.categories || {}).forEach(function (k) { summary.categories[k] = (summary.categories[k] || 0) + r.categories[k]; });
      summary.placeholders += r.placeholders || 0;
      summary.files.push({ name: name, action: r.action, reason: r.reason });
    }
    function finish() {
      if (--pending > 0) return;
      if (summary.action !== "allow") { notify(summary, channel); log(channel === "paste" ? "paste-file" : channel, summary, { files: summary.files.length }); }
      done(out);
    }
    files.forEach(function (f) {
      if (IMG_TYPE.test(f.type)) {
        inspectImage(f, function (r, masked) {
          merge(r, f.name);
          if (r.action !== "block") out.push(masked || f);
          finish();
        });
      } else if (f.type.indexOf("text/") === 0 || TEXT_EXT.test(f.name) || f.type === "application/json") {
        f.text().then(function (t) {
          var r = scan(t);
          merge(r, f.name);
          if (r.action === "block") return finish();
          out.push(r.action === "redact" ? new File([r.redactedText], f.name, { type: f.type || "text/plain", lastModified: Date.now() }) : f);
          finish();
        });
      } else {
        // PDF, Office, archives: not parsed in this MVP build
        var mode = (policy && policy.uninspectableFiles) || "block";
        var r = { action: mode === "allow" ? "allow" : mode, categories: {}, placeholders: 0, reason: "uninspectable" };
        merge(r, f.name);
        if (r.action !== "block") out.push(f);
        finish();
      }
    });
  }

  function inspectImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      chrome.runtime.sendMessage({ type: "inspectImage", dataUrl: reader.result }, function (res) {
        if (!res || res.error) {
          var fc = !policy || policy.failClosed !== false;
          return cb({ action: fc ? "block" : "warn", categories: {}, placeholders: 0, reason: "ocr-unreachable" });
        }
        if (res.action === "block" || !res.boxes || !res.boxes.length) return cb(res, null);
        maskImage(reader.result, res.boxes, file.name, function (masked) {
          res.placeholders = res.boxes.length;
          if (res.action === "allow") res.action = "redact";
          cb(res, masked);
        });
      });
    };
    reader.readAsDataURL(file);
  }

  function maskImage(dataUrl, boxes, name, cb) {
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      var ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "#0E3F3C";
      boxes.forEach(function (b) { ctx.fillRect(b.x, b.y, b.w, b.h); });
      cv.toBlob(function (blob) {
        cb(new File([blob], name.replace(/\.[^.]+$/, "") + "-sadin.png", { type: "image/png", lastModified: Date.now() }));
      }, "image/png");
    };
    img.src = dataUrl;
  }

  function redispatchPaste(target, files, text) {
    if (!files.length && !text) return;
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    if (text) {
      var r = scan(text);
      if (r.action !== "block") dt.setData("text/plain", r.action === "redact" ? r.redactedText : text);
    }
    reentry = true;
    try { (target || document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }
    finally { reentry = false; }
  }

  // ---------------------------------------------------------------------------
  // Notice (shadow DOM so the page's CSS cannot restyle or hide it)
  // ---------------------------------------------------------------------------
  var host, root, timer;
  var SHIELD = '<svg viewBox="43.5 38 73 103" width="19" height="26" role="img" aria-label="SADIN"><path d="M50.5 134V74.5a29.5 29.5 0 0 1 59 0V134" fill="none" stroke="#0B2134" stroke-width="14" stroke-linecap="round"/><circle cx="80" cy="112" r="10.5" fill="#0B2134"/></svg>';
  var STOP = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3z" fill="currentColor"/><path d="M9 9l6 6M15 9l-6 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';

  function notify(r, channel) {
    if (!host) {
      host = document.createElement("sadin-notice");
      host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;";
      root = host.attachShadow({ mode: "closed" });
      (document.body || document.documentElement).appendChild(host);
    }
    clearTimeout(timer);
    var L = E.CATEGORY_LABELS;
    var cats = Object.keys(r.categories || {}).map(function (k) {
      return '<li><span>' + (L[k] ? L[k].en : k) + '</span><span dir="rtl">' + (L[k] ? L[k].ar : "") + '</span><b>' + r.categories[k] + '</b></li>';
    }).join("");
    var blocked = r.action === "block";
    var reason = r.reason === "ocr-unreachable" ? "Image could not be inspected (inspection service unreachable). Not sent." :
                 r.reason === "uninspectable" ? "This file type is not inspected yet. Not sent, per policy." : "";
    var title = blocked ? "SADIN blocked this before sending" :
                r.action === "warn" ? "SADIN flagged this content" :
                "SADIN redacted " + (r.placeholders || 0) + " item" + ((r.placeholders || 0) === 1 ? "" : "s") + " before sending";
    var titleAr = blocked ? "أوقف سادن هذا المحتوى قبل الإرسال" :
                  r.action === "warn" ? "نبّه سادن إلى هذا المحتوى" :
                  "حجب سادن " + arItems(r.placeholders || 0) + " قبل الإرسال";
    var next = channel === "type" && !blocked ? "Review the message, then press send again." :
               blocked ? (Object.keys(r.categories || {}).indexOf("CLASSIFIED") >= 0 ? "Classified documents cannot be sent to external AI tools." : reason) :
               "The rest of your content was passed on unchanged.";
    root.innerHTML = '<style>' + CSS + '</style>' +
      '<div class="card ' + (blocked ? "block" : r.action) + '" role="alert">' +
      '<div class="head"><div class="ico">' + (blocked ? STOP : SHIELD) + '</div>' +
      '<div><div class="t">' + title + '</div><div class="ta" dir="rtl">' + titleAr + '</div></div>' +
      '<button class="x" aria-label="Close">&#x2715;</button></div>' +
      '<div class="msg">' + next + '</div>' +
      (cats ? '<ul class="cats">' + cats + '</ul>' : '') +
      '<div class="foot"><span>Policy: NCA ECC-2:2024 · NDMO</span><button class="ex">Request exception</button></div>' +
      '<div class="exbox" hidden><textarea placeholder="Business justification (logged for your security team)"></textarea><button class="sub">Submit</button></div>' +
      '</div>';
    root.querySelector(".x").onclick = hide;
    root.querySelector(".ex").onclick = function () { root.querySelector(".exbox").hidden = false; clearTimeout(timer); };
    root.querySelector(".sub").onclick = function () {
      var j = root.querySelector("textarea").value.trim();
      if (!j) return;
      log(channel, r, { action: "exception-request", justification: j });
      root.querySelector(".exbox").innerHTML = '<div class="ok">Request sent to your security team.</div>';
      timer = setTimeout(hide, 4000);
    };
    host.onmouseenter = function () { clearTimeout(timer); };
    host.onmouseleave = function () { timer = setTimeout(hide, 6000); };
    timer = setTimeout(hide, 14000);
  }
  function arItems(n) {
    if (n === 1) return "عنصرًا واحدًا";
    if (n === 2) return "عنصرين";
    if (n >= 3 && n <= 10) return n + " عناصر";
    return n + " عنصرًا";
  }
  function hide() { if (root) root.innerHTML = ""; }

  var CSS = [
    ":host{all:initial}",
    ".card{font:13px/1.45 'IBM Plex Sans Arabic','IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif;width:384px;background:#fff;color:#12302e;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.22);border:1px solid #d5e2df;overflow:hidden}",
    ".head{display:flex;gap:10px;align-items:flex-start;padding:12px 12px 6px}",
    ".ico{color:#0E3F3C;flex:none;margin-top:1px}.block .ico{color:#B3261E}.warn .ico{color:#B26A00}",
    ".t{font-weight:700;font-size:14px}.ta{font-size:13px;color:#3d5856;margin-top:1px}",
    ".x{margin-left:auto;border:0;background:none;color:#6b807e;cursor:pointer;font-size:14px}",
    ".msg{padding:0 14px 8px 44px;color:#3d5856}",
    ".cats{list-style:none;margin:0 12px 8px 44px;padding:0;border-top:1px solid #e6eeec}",
    ".cats li{display:grid;grid-template-columns:1fr auto 28px;gap:8px;padding:5px 0;border-bottom:1px solid #eef3f2}",
    ".cats li b{text-align:right}",
    ".foot{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f3f7f6;color:#6b807e;font-size:11px}",
    ".foot button,.sub{border:1px solid #0E3F3C;background:#fff;color:#0E3F3C;border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;cursor:pointer}",
    ".exbox{padding:8px 12px 12px;background:#f3f7f6;display:flex;gap:6px}.exbox[hidden]{display:none}",
    ".exbox textarea{flex:1;height:48px;border:1px solid #c9d8d5;border-radius:6px;font:inherit;padding:6px}",
    ".ok{color:#0E3F3C;font-weight:600}",
    ".block{border-color:#e9b8b4}.block .head{background:#fdf3f2}"
  ].join("");
})();
