const LBL = { CLASSIFIED: "Classified", CREDENTIAL: "Credential", NETWORK: "Network", ACCOUNT: "Account", SECURITY_FINDING: "Finding" };
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

chrome.runtime.sendMessage({ type: "status" }, s => {
  document.getElementById("dot").className = "dot " + (s && s.ok ? "ok" : "bad");
  document.getElementById("srv").textContent = s && s.ok ? "Inspection server connected" : "Inspection server unreachable: images are blocked (fail-closed)";
  document.getElementById("ver").textContent = "Engine " + (s ? s.engine : "?") + "  |  " + (s ? s.server : "");
});

chrome.storage.local.get("events", ({ events = [] }) => {
  const count = a => events.filter(e => e.action === a).length;
  document.getElementById("nRedact").textContent = count("redact");
  document.getElementById("nBlock").textContent = count("block");
  document.getElementById("nWarn").textContent = count("warn");
  document.getElementById("log").innerHTML = events.slice(0, 15).map(e => `
    <li><div class="row"><span class="tag ${esc(e.action)}">${esc(e.action)}</span><span class="muted">${esc(new Date(e.time).toLocaleTimeString())}</span></div>
    <div>${esc(e.tool)} &middot; ${esc(e.channel)}</div>
    <div class="muted">${Object.entries(e.categories || {}).map(([k, v]) => esc(LBL[k] || k) + " " + v).join(", ") || "&nbsp;"}</div></li>`).join("") || '<li class="muted">No decisions yet.</li>';
});

document.getElementById("cef").onclick = () => chrome.storage.local.get("events", ({ events = [] }) => {
  const sev = { block: 8, redact: 5, warn: 3 };
  const q = s => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\r?\n|\r/g, "\\n").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
  const h = s => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const ver = chrome.runtime.getManifest().version;
  const lines = events.map(e => `CEF:0|SADIN|SADIN Middleware|${h(ver)}|AI-${h(e.action)}|AI request ${h(e.action)}|${sev[e.action] || 1}|rt=${Date.parse(e.time)} suser=${q(e.user)} dhost=${q(e.tool)} act=${q(e.action)} cs1Label=categories cs1=${q(Object.keys(e.categories || {}).join(","))} cs2Label=channel cs2=${q(e.channel)} cn1Label=redactions cn1=${e.placeholders || 0}`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
  a.download = "sadin-events.cef";
  a.click();
});
document.getElementById("clear").onclick = () => chrome.storage.local.set({ events: [] }, () => location.reload());
