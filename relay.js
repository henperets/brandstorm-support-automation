/**
 * relay.js - runs INSIDE an incognito window as an extension page.
 *
 * Because this script executes in the incognito extension context it has full
 * access to the incognito cookie store and the incognito chrome.storage.local.
 *
 * Steps:
 *  1. Close all other incognito windows (so only this one remains).
 *  2. Clear every nimbus.example cookie from the incognito store.
 *  3. If credentials were supplied (?d=), write them to incognito storage
 *     so autofill.js (incognito content script) can read them after navigation.
 *  4. Navigate this window to the target URL.
 *     autofill.js (declarative content script) reads incognito storage and
 *     delegates the MAIN-world fill to the incognito background.
 */

(async () => {
  const status    = document.getElementById("status");
  const params    = new URLSearchParams(window.location.search);
  const targetUrl = params.get("url");
  const d         = params.get("d"); // base64-encoded { em, pw } (optional)

  if (!targetUrl) {
    status.textContent = "Missing target URL.";
    return;
  }

  try {
    // ── Step 1: close all other incognito windows ──────────────────────────────
    const currentWindow = await chrome.windows.getCurrent();
    const allWindows    = await chrome.windows.getAll();
    const toClose = allWindows.filter(
      (w) => w.incognito && w.id !== currentWindow.id
    );
    await Promise.all(
      toClose.map((w) => chrome.windows.remove(w.id).catch(() => {}))
    );

    // ── Step 2: wipe all nimbus.example cookies from the incognito store ──────
    const cookies = await chrome.cookies.getAll({ domain: "nimbus.example" });
    await Promise.all(
      cookies.map((cookie) => {
        const protocol = cookie.secure ? "https://" : "http://";
        const host = cookie.domain.replace(/^\./, "");
        const url  = protocol + host + cookie.path;
        return chrome.cookies.remove({ url, name: cookie.name }).catch(() => {});
      })
    );

    status.textContent = `Cleared ${cookies.length} cookie${cookies.length !== 1 ? "s" : ""}. Opening…`;
  } catch (err) {
    console.warn("[Brandstorm relay] Setup failed:", err);
    status.textContent = "Opening…";
  }

  // ── Step 3: store credentials in incognito storage for autofill.js ──────────
  // relay.js runs in the incognito context, so chrome.storage.local here IS
  // the incognito storage - the same instance that the incognito content script
  // (autofill.js) will read from. This avoids the regular↔incognito storage
  // isolation that blocked earlier approaches.
  if (d) {
    try {
      const creds = JSON.parse(atob(d));
      if (creds.em && creds.pw) {
        await chrome.storage.local.set({
          _bs_autofill: {
            em:      creds.em,
            pw:      creds.pw,
            expires: Date.now() + 60_000,
          },
        });
      }
    } catch (err) {
      console.warn("[Brandstorm relay] Failed to store autofill credentials:", err);
    }
  }

  // ── Step 4: navigate to target URL ───────────────────────────────────────────
  setTimeout(() => {
    window.location.href = targetUrl;
  }, 250);
})();
