/*
 * SADIN background service worker
 *  - merges policy: built-in defaults < policy server < Chrome managed storage (set by IT)
 *  - relays images, PDF and Word files to the on-prem inspection server
 *  - keeps a local decision log (metadata only, never content) and forwards it
 *  - sends a heartbeat so the administrator is told when protection stops on a device
 */
importScripts("engine.js");

const DEFAULT_SERVER = "http://127.0.0.1:8787";
let cache = { policy: null, at: 0 };

async function managed() {
  try { return await chrome.storage.managed.get(null); } catch (e) { return {}; }
}
async function serverUrl() {
  const m = await managed();
  return (m && m.serverUrl) || DEFAULT_SERVER;
}
// shared secret for the inspection server, pushed by IT as the managed "serverToken" setting
async function authHeaders(extra) {
  const m = await managed();
  return Object.assign({}, extra || {}, m && m.serverToken ? { "X-SADIN-Token": m.serverToken } : {});
}
async function getPolicy() {
  if (cache.policy && Date.now() - cache.at < 60000) return cache.policy;
  const m = await managed();
  let fromServer = {};
  try {
    const r = await fetch((m.serverUrl || DEFAULT_SERVER) + "/policy", { cache: "no-store", headers: await authHeaders() });
    if (r.ok) fromServer = await r.json();
  } catch (e) { /* server optional for text */ }
  const p = Object.assign({}, fromServer, m.policy || {});
  cache = { policy: p, at: Date.now() };
  return p;
}
async function user() {
  const m = await managed();
  if (m && m.userEmail) return m.userEmail;
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
    return info.email || "unknown";
  } catch (e) { return "unknown"; }
}

async function inspectImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch((await serverUrl()) + "/inspect/image", { method: "POST", body: blob, headers: await authHeaders({ "Content-Type": blob.type }), signal: ctl.signal });
    if (!r.ok) return { error: "status " + r.status };
    return await r.json();
  } catch (e) {
    return { error: String(e) };
  } finally { clearTimeout(t); }
}

// PDF and .docx: the service extracts the text (and reads embedded pictures with OCR) on-prem
async function inspectFile(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 90000);        // scanned pages take a few seconds each
  try {
    const r = await fetch((await serverUrl()) + "/inspect/file", { method: "POST", body: blob, headers: await authHeaders({ "Content-Type": "application/octet-stream" }), signal: ctl.signal });
    if (!r.ok) return { error: "status " + r.status };
    return await r.json();
  } catch (e) {
    return { error: String(e) };
  } finally { clearTimeout(t); }
}

async function log(ev) {
  ev.time = new Date().toISOString();
  ev.user = await user();
  const { events = [] } = await chrome.storage.local.get("events");
  events.unshift(ev);
  await chrome.storage.local.set({ events: events.slice(0, 500) });
  if (await postEvent(ev)) { flushPending(); return; }
  // the server did not take it: keep it and send it again later (see flushPending)
  const { pending = [] } = await chrome.storage.local.get("pending");
  pending.push(ev);
  await chrome.storage.local.set({ pending: pending.slice(-500) });
}
async function postEvent(ev) {
  try {
    const r = await fetch((await serverUrl()) + "/events", { method: "POST", headers: await authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(ev) });
    return r.ok;
  } catch (e) { return false; }
}
// decisions made while the server was unreachable are forwarded once it answers again
let flushing = false;
async function flushPending() {
  if (flushing) return;
  flushing = true;
  try {
    let { pending = [] } = await chrome.storage.local.get("pending");
    while (pending.length) {
      if (!(await postEvent(pending[0]))) break;
      pending = pending.slice(1);
      await chrome.storage.local.set({ pending });
    }
  } finally { flushing = false; }
}

/* ---------- Tamper resistance: heartbeat ----------
 * Force-installing by policy stops the user disabling or removing the extension. The heartbeat
 * covers what policy cannot: it tells the server how the extension was installed and sends a
 * fingerprint of its files. The browser does not verify the files of an extension hosted
 * outside the Web Store, so an edited or deleted script would otherwise go unnoticed while
 * heartbeats keep flowing. Keep this list the same as FILES in server/integrity.js.
 */
const INTEGRITY_FILES = ["manifest.json", "src/engine.js", "src/content.js", "src/background.js"];
const HEARTBEAT_ALARM = "sadin-heartbeat";
const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
// The browser adds "key" (and the store adds "update_url") to the installed manifest, so the
// manifest is compared by content, with those two fields left out and keys in a fixed order.
const canon = v => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
  : JSON.stringify(v);
async function integrity() {
  const parts = [];
  for (const f of INTEGRITY_FILES) {
    try {
      const r = await fetch(chrome.runtime.getURL(f), { cache: "no-store" });
      if (!r.ok) throw new Error("missing");
      let bytes = await r.arrayBuffer();
      if (f === "manifest.json") {
        const m = JSON.parse(new TextDecoder().decode(bytes));
        delete m.key; delete m.update_url;
        bytes = new TextEncoder().encode(canon(m));
      }
      parts.push(hex(await crypto.subtle.digest("SHA-256", bytes)));
    } catch (e) { parts.push("missing:" + f); }
  }
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n"))));
}
// the device name comes from IT (managed "deviceId"); without it a random one is kept locally
async function deviceId() {
  const m = await managed();
  if (m && m.deviceId) return String(m.deviceId);
  let { deviceId: id } = await chrome.storage.local.get("deviceId");
  if (!id) { id = "unmanaged-" + crypto.randomUUID().slice(0, 8); await chrome.storage.local.set({ deviceId: id }); }
  return id;
}
function browserName() {
  const ua = navigator.userAgent;
  const m = /Edg\/(\d+)/.exec(ua) || /Chrome\/(\d+)/.exec(ua);
  return m ? (/Edg\//.test(ua) ? "Edge " : "Chrome ") + m[1] : "unknown";
}
async function heartbeat() {
  const self = await chrome.management.getSelf();
  const body = {
    device: await deviceId(),
    user: await user(),
    version: chrome.runtime.getManifest().version,
    installType: self.installType,              // "admin" = force-installed by policy
    integrity: await integrity(),
    browser: browserName()
  };
  try {
    const r = await fetch((await serverUrl()) + "/heartbeat", { method: "POST", headers: await authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
    if (r.ok) flushPending();
    return r.ok;
  } catch (e) { return false; }                 // the server notices the silence
}
async function scheduleHeartbeat() {
  const m = await managed();
  const seconds = Math.max(30, Number(m && m.heartbeatSeconds) || 60);
  await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: seconds / 60 });
  // the browser opens this address if the extension is removed; the key stands in for the token header
  try {
    const device = await deviceId();
    const k = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(((m && m.serverToken) || "") + "|" + device))).slice(0, 16);
    await chrome.runtime.setUninstallURL((await serverUrl()) + "/uninstalled?device=" + encodeURIComponent(device) + "&k=" + k);
  } catch (e) { /* optional signal */ }
  return heartbeat();
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === HEARTBEAT_ALARM) heartbeat(); });
chrome.runtime.onInstalled.addListener(scheduleHeartbeat);
chrome.runtime.onStartup.addListener(scheduleHeartbeat);
// managed settings that arrive after start-up (policy refresh) are picked up immediately
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "managed") { cache = { policy: null, at: 0 }; scheduleHeartbeat(); }
});
scheduleHeartbeat();

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "getPolicy") { getPolicy().then(reply); return true; }
  if (msg.type === "inspectImage") { inspectImage(msg.dataUrl).then(reply); return true; }
  if (msg.type === "inspectFile") { inspectFile(msg.dataUrl).then(reply); return true; }
  if (msg.type === "log") { log(msg.event).then(() => reply({ ok: true })); return true; }
  if (msg.type === "status") {
    serverUrl().then(async (u) => {
      let ok = false;
      try { ok = (await fetch(u + "/health", { cache: "no-store" })).ok; } catch (e) {}
      reply({ server: u, ok, engine: SadinEngine.DEFAULT_POLICY.version });
    });
    return true;
  }
});
