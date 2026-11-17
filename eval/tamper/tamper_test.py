#!/usr/bin/env python3
"""
SADIN tamper-resistance lab run.

Real Chrome, a real managed-policy file, a real signed CRX fetched from an update server and the
real SADIN inspection server. Every row in the output is something that was attempted and
observed in this run; nothing is assumed.

Needs: Linux, root (to write the browser's managed-policy folder), Chrome or Chrome for Testing
at /usr/bin/google-chrome (or CHROME=...), Node 18+, openssl, Python 3 with Playwright.
Ports 8787 (inspection server) and 8790 (update server) must be free. Takes about 10 minutes.

    sudo python3 eval/tamper/tamper_test.py

The policy file it writes (sadin-lab.json) is removed at the end.
"""
import asyncio, datetime, hashlib, json, os, secrets, shutil, subprocess, sys, tempfile, time, urllib.request

from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
LAB = os.environ.get("SADIN_LAB") or tempfile.mkdtemp(prefix="sadin-lab-")
POLICY_DIRS = ["/etc/opt/chrome_for_testing/policies/managed", "/etc/opt/chrome/policies/managed"]
POLICY_NAME = "sadin-lab.json"
GRACE = int(os.environ.get("GRACE", "75"))          # server-side heartbeat grace period, seconds
BEAT = 30                                           # extension heartbeat interval, seconds
SERVER = "http://127.0.0.1:8787"
UPDATE = "http://127.0.0.1:8790"
TOKEN = secrets.token_hex(16)
VERSION = json.load(open(f"{ROOT}/extension/manifest.json"))["version"]
rows, procs, notes = [], [], {}


def to_id(hex32):
    return "".join(chr(ord("a") + int(c, 16)) for c in hex32)


def sh(*cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def api(path):
    req = urllib.request.Request(SERVER + path, headers={"X-SADIN-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req, timeout=5).read())


def alerts(kind=None, device=None, since=None):
    return [a for a in api("/alerts")
            if (not kind or a["type"] == kind) and (not device or a["device"] == device) and (not since or a["time"] >= since)]


def device(name):
    return next((d for d in api("/devices") if d["device"] == name), None)


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "000Z"


async def wait_for(fn, timeout, step=1.0):
    """Poll fn until it returns something truthy. Returns (value, seconds waited)."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v, round(time.time() - t0)
        await asyncio.sleep(step)
    return None, round(time.time() - t0)


def set_policy(obj):
    for d in POLICY_DIRS:
        os.makedirs(d, exist_ok=True)
        p = f"{d}/{POLICY_NAME}"
        if obj is None:
            if os.path.exists(p):
                os.remove(p)
        else:
            json.dump(obj, open(p, "w"), indent=1)


def policy(ext_id, dev, force=True, lock=True):
    p = {"3rdparty": {"extensions": {ext_id: {"serverUrl": SERVER, "serverToken": TOKEN, "deviceId": dev,
                                              "userEmail": "employee@corp.example.sa", "heartbeatSeconds": BEAT}}}}
    if lock:
        p.update({"IncognitoModeAvailability": 1, "BrowserGuestModeEnabled": False})
    if force:
        p["ExtensionInstallForcelist"] = [f"{ext_id};{UPDATE}/update.xml"]
    return p


def row(n, attempt, method, expected, observed, ok):
    result = "PASS" if ok is True else "FAIL" if ok is False else ok
    rows.append({"n": n, "attempt": attempt, "method": method, "expected": expected, "observed": observed, "result": result})
    print(f"[{result}] {n} {attempt} -> {observed}", flush=True)


async def launch(p, profile, extra_args=()):
    return await p.chromium.launch_persistent_context(
        f"{LAB}/{profile}", executable_path=CHROME, headless=False,
        args=["--headless=new", "--no-sandbox", *extra_args],
        ignore_default_args=["--disable-extensions", "--disable-component-extensions-with-background-pages",
                             "--disable-background-networking", "--disable-component-update"])


async def ext_info(pg, ext_id):
    await pg.goto("chrome://extensions")
    await pg.wait_for_timeout(1200)
    info = await pg.evaluate("new Promise(r=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},r))")
    return next((e for e in info if e["id"] == ext_id), None)

# calls chrome.management.<fn>(id, ...) from chrome://extensions, as the user's own browser UI would
MGMT = """([fn, id, arg]) => new Promise(r => {
  const done = () => r(chrome.runtime.lastError ? "refused: " + chrome.runtime.lastError.message : "accepted");
  try { arg === null ? chrome.management[fn](id, done) : chrome.management[fn](id, arg, done); }
  catch (e) { r("refused: " + e.message); }
  setTimeout(() => r("no answer"), 4000);
})"""
INCOGNITO = """() => new Promise(r => {
  try { chrome.windows.create({ incognito: true, url: "about:blank" }, w => r(chrome.runtime.lastError ? "refused: " + chrome.runtime.lastError.message
      : w && !w.incognito ? "opened a normal window instead"
      : "accepted" + (w ? "" : " (no window object returned, as Chrome does for an extension without Incognito access)"))); }
  catch (e) { r("refused: " + e.message); }
  setTimeout(() => r("no answer"), 4000);
})"""


async def incognito(ctx, ext_id):
    """Ask for an Incognito window from one of the extension's own pages, which has chrome.windows."""
    pg = await ctx.new_page()
    await pg.goto(f"chrome-extension://{ext_id}/popup/popup.html")
    await pg.wait_for_timeout(500)
    try:
        return await pg.evaluate(INCOGNITO)
    finally:
        await pg.close()


def ext_dir(profile, ext_id):
    base = f"{LAB}/{profile}/Default/Extensions/{ext_id}"
    if not os.path.isdir(base):
        return None
    v = sorted(os.listdir(base))
    return f"{base}/{v[-1]}" if v else None


def setup():
    """Pack the extension as a signed CRX, publish it on a local update server, start SADIN."""
    shutil.rmtree(f"{LAB}/ext", ignore_errors=True)
    os.makedirs(f"{LAB}/www", exist_ok=True)
    os.makedirs(f"{LAB}/data", exist_ok=True)
    shutil.copytree(f"{ROOT}/extension", f"{LAB}/ext")
    key = sh("openssl", "genrsa", "2048").stdout
    open(f"{LAB}/ext.pem", "wb").write(sh("openssl", "pkcs8", "-topk8", "-nocrypt", input=key).stdout)
    subprocess.run([CHROME, "--no-sandbox", "--headless=new", f"--pack-extension={LAB}/ext", f"--pack-extension-key={LAB}/ext.pem"],
                   capture_output=True, timeout=120)
    assert os.path.exists(f"{LAB}/ext.crx"), "packing the extension failed"
    der = sh("openssl", "rsa", "-in", f"{LAB}/ext.pem", "-pubout", "-outform", "DER").stdout
    ext_id = to_id(hashlib.sha256(der).hexdigest()[:32])
    # an unpacked extension gets its ID from its folder path (used for the "installed by hand" device)
    dev_id = to_id(hashlib.sha256(f"{LAB}/ext".encode()).hexdigest()[:32])
    shutil.copy(f"{LAB}/ext.crx", f"{LAB}/www/ext.crx")
    open(f"{LAB}/www/update.xml", "w").write(
        "<?xml version='1.0' encoding='UTF-8'?>\n<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n"
        f"  <app appid='{ext_id}'><updatecheck codebase='{UPDATE}/ext.crx' version='{VERSION}' /></app>\n</gupdate>\n")
    env = dict(os.environ, SADIN_TOKEN=TOKEN, SADIN_EXTENSION_IDS=f"{ext_id},{dev_id}", SADIN_HEARTBEAT_GRACE_S=str(GRACE),
               SADIN_DATA_DIR=f"{LAB}/data", SADIN_INTEGRITY_FILE=f"{LAB}/data/integrity.json")
    sh("node", f"{ROOT}/server/integrity.js", env=env)          # expected fingerprint of the released files
    procs.append(subprocess.Popen([sys.executable, "-m", "http.server", "8790", "--bind", "127.0.0.1"], cwd=f"{LAB}/www",
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    procs.append(subprocess.Popen(["node", f"{ROOT}/server/server.js"], env=env, stdout=open(f"{LAB}/server.log", "w"), stderr=subprocess.STDOUT))
    for _ in range(50):
        try:
            urllib.request.urlopen(SERVER + "/health", timeout=1); break
        except Exception:
            time.sleep(0.2)
    return ext_id, dev_id


async def main():
    ext_id, dev_id = setup()
    env = {"date": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "browser": subprocess.run([CHROME, "--version"], capture_output=True, text=True).stdout.strip(),
           "os": " ".join(os.uname()[i] for i in (0, 2)), "extensionVersion": VERSION, "extensionId": ext_id,
           "heartbeatSeconds": BEAT, "serverGraceSeconds": GRACE}
    print(json.dumps(env), flush=True)
    async with async_playwright() as p:
        # ---------- A. Managed device: the extension is force-installed and locked ----------
        D1 = "LAB-PC-01"
        set_policy(policy(ext_id, D1))
        ctx = await launch(p, "profile-a")
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        t0 = time.time()
        info = None
        while time.time() - t0 < 60 and not info:
            info = await ext_info(pg, ext_id)
        row("A1", "Extension arrives with no user action", "Policy ExtensionInstallForcelist, private update server",
            "Installed and enabled by policy", f"installed in {round(time.time() - t0)} s, state {info and info['state']}, location {info and info['location']}"
            if info else "not installed", bool(info and info["state"] == "ENABLED"))
        d, w = await wait_for(lambda: device(D1), 60)
        row("A2", "Device reports to the server", "First heartbeat", "Registered, installed by policy, files match the release",
            f"after {w} s: state {d['state']}, install type {d['installType']}, files {d['integrityStatus']}" if d else "no heartbeat",
            bool(d and d["state"] == "ok" and d["installType"] == "admin" and d["integrityStatus"] == "ok"))
        info = await ext_info(pg, ext_id)
        row("A3", "The extensions page offers no way to change it", "Read the controls the page is given for this extension",
            "User may not modify it", f"userMayModify={info['userMayModify']}, mustRemainInstalled={info.get('mustRemainInstalled')}",
            info["userMayModify"] is False)
        r = await pg.evaluate(MGMT, ["setEnabled", ext_id, False])
        info = await ext_info(pg, ext_id)
        row("A4", "Employee disables the extension", "chrome.management.setEnabled(false) from the extensions page", "Browser refuses",
            f"{r}; still {info['state']}", r.startswith("refused") and info["state"] == "ENABLED")
        r = await pg.evaluate(MGMT, ["uninstall", ext_id, None])
        info = await ext_info(pg, ext_id)
        row("A5", "Employee removes the extension", "chrome.management.uninstall from the extensions page", "Browser refuses",
            f"{r}; {'still installed' if info else 'REMOVED'}", r.startswith("refused") and bool(info))
        r = await incognito(ctx, ext_id)
        notes["incognito_locked"] = r
        row("A6", "Employee opens an Incognito window", "chrome.windows.create({incognito:true}) under IncognitoModeAvailability=1",
            "Browser refuses", r, r.startswith("refused"))

        # edit a file of the installed extension on disk
        xd = ext_dir("profile-a", ext_id)
        target = f"{xd}/src/content.js"
        original = open(target, "rb").read()
        mark = now()
        open(target, "ab").write(b"\n// edited by the employee\n")
        a, w = await wait_for(lambda: alerts("integrity-mismatch", D1, mark), BEAT + 25)
        info = await ext_info(pg, ext_id)
        row("A7", "Employee edits a script of the installed extension", "Append a line to src/content.js in the profile folder",
            "Administrator alerted (integrity-mismatch)",
            f"alert after {w} s; the browser itself still shows the extension as {info['state']}" if a else f"no alert within {w} s", bool(a))
        open(target, "wb").write(original)
        d, w = await wait_for(lambda: (device(D1) or {}).get("state") == "ok", BEAT + 25)
        row("A8", "Original file put back", "Restore src/content.js", "Device returns to ok", f"state ok after {w} s" if d else "still flagged", bool(d))
        target = f"{xd}/src/engine.js"
        original = open(target, "rb").read()
        mark = now()
        os.remove(target)
        a, w = await wait_for(lambda: alerts("integrity-mismatch", D1, mark), BEAT + 25)
        row("A9", "Employee deletes the detection engine file", "Delete src/engine.js in the profile folder",
            "Administrator alerted (integrity-mismatch)", f"alert after {w} s" if a else f"no alert within {w} s", bool(a))
        open(target, "wb").write(original)
        await wait_for(lambda: (device(D1) or {}).get("state") == "ok", BEAT + 25)

        # delete the whole extension folder while the browser is closed
        await ctx.close()
        mark = now()
        shutil.rmtree(f"{LAB}/profile-a/Default/Extensions/{ext_id}")
        ctx = await launch(p, "profile-a")
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await pg.wait_for_timeout(8000)
        restored = ext_dir("profile-a", ext_id) is not None
        a, w = await wait_for(lambda: alerts(None, D1, mark), GRACE + 45)
        kinds = sorted({x["type"] for x in (a or [])})
        row("A10", "Employee deletes the extension's folder", "Remove the folder from the profile with the browser closed, reopen",
            "Administrator alerted, or the browser repairs it",
            (f"browser {'restored' if restored else 'did not restore'} the folder; " +
             (f"alert {', '.join(kinds)} after {w} s" if a else f"no alert within {w} s; device state {(device(D1) or {}).get('state')}")),
            bool(a) or (restored and (device(D1) or {}).get("state") == "ok"))
        await ctx.close()

        # ---------- B. The policy itself is removed (needs administrator rights) ----------
        D2 = "LAB-PC-02"
        set_policy(policy(ext_id, D2))
        ctx = await launch(p, "profile-b")
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        ok, _ = await wait_for(lambda: (device(D2) or {}).get("state") == "ok", 90)
        assert ok, "profile B never reported"
        mark = now()
        set_policy(None)
        t0 = time.time()
        gone = False
        while time.time() - t0 < 60 and not gone:
            gone = (await ext_info(pg, ext_id)) is None
        removed_after = round(time.time() - t0)
        a, w = await wait_for(lambda: alerts(None, D2, mark), GRACE + 45)
        kinds = sorted({x["type"] for x in (a or [])})
        row("B1", "Someone with administrator rights deletes the policy file", "Remove the managed-policy file while the browser runs",
            "Prevention is lost; administrator alerted",
            f"extension {'removed by the browser after ' + str(removed_after) + ' s' if gone else 'still installed'}; " +
            (f"alert {', '.join(kinds)} after {w} s" if a else f"no alert within {w} s"), bool(a))
        uninstall_seen = bool(alerts("extension-uninstalled", D2, mark))
        mark = now()
        set_policy(policy(ext_id, D2))
        t0 = time.time()
        back = None
        while time.time() - t0 < 90 and not back:
            back = await ext_info(pg, ext_id)
        back_after = round(time.time() - t0)
        a, w = await wait_for(lambda: alerts("heartbeat-restored", D2, mark), BEAT + 60)
        row("B2", "Policy file restored", "Write the managed-policy file again while the browser runs",
            "Extension returns by itself; administrator told",
            (f"extension back after {back_after} s; " if back else "extension did not return; ") + (f"heartbeat-restored after {w} s" if a else "no heartbeat-restored alert"),
            bool(back and a))
        await ctx.close()

        # ---------- C. Unmanaged install: what the policy is for ----------
        D3 = "LAB-PC-03"
        set_policy(policy(dev_id, D3, force=False, lock=False))
        mark = now()
        ctx = await launch(p, "profile-c", [f"--load-extension={LAB}/ext", "--disable-features=DisableLoadExtensionCommandLineSwitch"])
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        a, w = await wait_for(lambda: alerts("not-force-installed", D3, mark), 60)
        d = device(D3)
        row("C1", "Extension installed by hand, not by policy", "Load the same extension without ExtensionInstallForcelist",
            "Administrator alerted (not-force-installed)",
            f"alert after {w} s; install type {d and d['installType']}" if a else f"no alert within {w} s", bool(a))
        # control for A6: the same call on a device without the lock-down policy
        notes["incognito_unlocked"] = await incognito(ctx, dev_id)
        info = await ext_info(pg, dev_id)
        r = await pg.evaluate(MGMT, ["setEnabled", dev_id, False])
        info2 = await ext_info(pg, dev_id)
        row("C2", "Employee disables it when no policy protects it", "chrome.management.setEnabled(false) from the extensions page",
            "Browser allows it (this is why force-install is required)",
            f"userMayModify={info and info['userMayModify']}; {r}; now {info2 and info2['state']}", bool(r == "accepted" and info2 and info2["state"] == "DISABLED"))
        row("C3", "Employee opens an Incognito window when no policy forbids it", "chrome.windows.create({incognito:true}), no IncognitoModeAvailability",
            "Browser allows it (control for A6)", notes["incognito_unlocked"], notes["incognito_unlocked"].startswith("accepted"))
        mark = now()
        a, w = await wait_for(lambda: alerts("heartbeat-lost", D3, mark), GRACE + 45)
        row("C4", "Disabled extension goes silent", "Wait for the server's grace period", "Administrator alerted (heartbeat-lost)",
            f"alert after {w} s" if a else f"no alert within {w} s", bool(a))
        await ctx.close()

        # ---------- G. Guest mode ----------
        D4 = "LAB-PC-04"

        async def guest(profile, lock):
            set_policy(policy(ext_id, D4, force=True, lock=lock))
            c = await launch(p, profile, ["--guest"])
            g = c.pages[0] if c.pages else await c.new_page()
            await g.wait_for_timeout(6000)
            present = bool(await ext_info(g, ext_id))
            await g.goto("chrome://version")
            await g.wait_for_timeout(800)
            path = await g.evaluate("(document.querySelector('#profile_path')||{}).textContent") or ""
            await c.close()
            return present, os.path.basename(path.strip())

        present, prof = await guest("profile-g1", True)
        row("G1", "Employee starts the browser in guest mode", "Start Chrome with --guest under BrowserGuestModeEnabled=false",
            "No guest session; SADIN is present", f"browser opened the '{prof}' profile; SADIN {'installed' if present else 'ABSENT'}",
            present and prof != "Guest Profile")
        present, prof = await guest("profile-g2", False)
        row("G2", "Same start without the guest-mode policy", "Start Chrome with --guest, policy without BrowserGuestModeEnabled",
            "Guest session without SADIN (the gap the policy closes)", f"browser opened the '{prof}' profile; SADIN {'installed' if present else 'absent'}",
            (not present) and prof == "Guest Profile")
        set_policy(None)

        # administrator page, as the administrator sees it after the run
        b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        ap = await b.new_page(viewport={"width": 1280, "height": 900})
        await ap.goto(SERVER + "/admin")
        await ap.fill("#tok", TOKEN)
        await ap.click("#go")
        await ap.wait_for_timeout(1500)
        shown = await ap.locator("#alerts tr").count()
        await ap.screenshot(path=f"{ROOT}/shots/09-admin-alerts.png", full_page=True)
        await b.close()
        total_alerts = len(alerts())
        row("D1", "Administrator opens the admin page", "GET /admin, enter the token", "Devices and alerts are listed",
            f"{len(api('/devices'))} devices and {shown} of {total_alerts} alerts shown", shown == total_alerts and shown > 0)

    counts = {k: sum(1 for x in rows if x["result"] == k) for k in ("PASS", "FAIL", "NOT EXERCISED")}
    out = {"environment": env, "counts": counts, "uninstallAddressFired": uninstall_seen, "notes": notes, "rows": rows,
           "alerts": [{k: a.get(k) for k in ("type", "device", "detail")} for a in reversed(api("/alerts"))]}
    json.dump(out, open(f"{ROOT}/eval/results-tamper-lab.json", "w"), indent=1)
    print(f"\n{counts['PASS']} of {len(rows)} passed, {counts['FAIL']} failed, {counts['NOT EXERCISED']} not exercised")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        set_policy(None)
        for pr in procs:
            pr.terminate()
        if not os.environ.get("SADIN_LAB"):
            shutil.rmtree(LAB, ignore_errors=True)
