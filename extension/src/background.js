/*
 * SADIN background service worker
 *  - merges policy: built-in defaults < policy server < Chrome managed storage (set by IT)
 *  - relays images to the on-prem inspection server
 *  - keeps a local decision log (metadata only, never content) and forwards it
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

async function log(ev) {
  ev.time = new Date().toISOString();
  ev.user = await user();
  const { events = [] } = await chrome.storage.local.get("events");
  events.unshift(ev);
  await chrome.storage.local.set({ events: events.slice(0, 500) });
  try {
    await fetch((await serverUrl()) + "/events", { method: "POST", headers: await authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(ev) });
  } catch (e) { /* kept locally; forwarded when the server is reachable */ }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "getPolicy") { getPolicy().then(reply); return true; }
  if (msg.type === "inspectImage") { inspectImage(msg.dataUrl).then(reply); return true; }
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
