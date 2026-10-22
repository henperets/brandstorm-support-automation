/**
 * Background service worker (split mode).
 *
 * In "incognito": "split" mode, this script runs in the REGULAR profile context.
 * It receives "openIncognito" messages from the popup and creates an incognito
 * window that loads relay.html - an extension page running inside the incognito
 * context, which can clear incognito cookies and close old incognito windows.
 *
 * Also handles admin-tab navigation for the user password reset feature.
 */

const ADMIN_ORIGIN = 'https://admin.nimbus.example';
const BRANDS_URL   = `${ADMIN_ORIGIN}/#/brands`;

function validateAdminUrl(url) {
  try { return new URL(url).origin === ADMIN_ORIGIN; } catch { return false; }
}

function extractHash(url) {
  try { return new URL(url).hash || ''; } catch { return ''; }
}

async function findAdminTab() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && validateAdminUrl(tab.url)) return tab.id;
  }
  return null;
}

async function handleFindOrNavigate(sendResponse) {
  try {
    const tabId = await findAdminTab();
    if (tabId !== null) {
      const tab  = await chrome.tabs.get(tabId);
      const hash = extractHash(tab.url ?? '');
      const onBrandsList = (hash === '#/brands');
      if (!onBrandsList) {
        await chrome.tabs.update(tabId, { url: BRANDS_URL });
      }
      sendResponse({ ok: true, tabId, needsNavigation: !onBrandsList });
    } else {
      // active: false keeps new tab in background so the popup stays open
      const newTab = await chrome.tabs.create({ url: BRANDS_URL, active: false });
      sendResponse({ ok: true, tabId: newTab.id, needsNavigation: true });
    }
  } catch {
    sendResponse({ ok: false, error: 'navigation_failed' });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "openIncognito") {
    let relayUrl =
      chrome.runtime.getURL("relay.html") +
      "?url=" +
      encodeURIComponent(message.url);

    // Encode autofill credentials into the relay URL so relay.js (running in
    // the incognito extension context) can write them to incognito storage
    // before navigating - where autofill.js (also incognito) can read them.
    if (message.autofill?.email && message.autofill?.password) {
      // encodeURIComponent is required: btoa output contains +/= which are
      // misinterpreted by URLSearchParams.get() without it.
      relayUrl +=
        "&d=" +
        encodeURIComponent(btoa(JSON.stringify({ em: message.autofill.email, pw: message.autofill.password })));
    }

    chrome.windows
      .create({ url: relayUrl, incognito: true, focused: true })
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("[Brandstorm] Failed to create incognito window:", err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // keep message channel open for async sendResponse
  }

  // Triggered by autofill.js (incognito content script) after it reads
  // credentials from incognito chrome.storage.local (written by relay.js).
  // executeScript with world:'MAIN' uses the page's own HTMLInputElement.prototype,
  // so Vue/React reactivity picks up the value correctly.
  if (message.type === '_BS_FILL') {
    const tabId = _sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false }); return false; }

    const { email, password } = message;

    chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      func: (em, pw) => {
        function fill(el, val) {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set;
          if (setter) setter.call(el, val); else el.value = val;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Only match inputs that are actually visible on screen.
        function firstVisible(sel) {
          return [...document.querySelectorAll(sel)]
            .find(el => el.offsetParent !== null);
        }

        function tryFill() {
          const emailEl =
            firstVisible('input[type="email"]')               ||
            firstVisible('input[name="email"]')               ||
            firstVisible('input[name="username"]')            ||
            firstVisible('input[autocomplete="email"]')       ||
            firstVisible('input[autocomplete="username"]')    ||
            firstVisible('input[placeholder*="mail" i]')      ||
            firstVisible('input[placeholder*="user" i]')      ||
            firstVisible('input:not([type="password"]):not([type="hidden"])');

          const passEl = firstVisible('input[type="password"]');
          if (!emailEl || !passEl) return false;

          fill(emailEl, em);
          fill(passEl,  pw);

          setTimeout(() => {
            const btn =
              firstVisible('button[type="submit"]')            ||
              firstVisible('input[type="submit"]')             ||
              firstVisible('button[class*="login" i]')         ||
              firstVisible('button[class*="submit" i]')        ||
              firstVisible('button[class*="connect" i]')       ||
              firstVisible('form button')                      ||
              firstVisible('button');
            if (btn) btn.click();
            else passEl.form?.submit();
          }, 600);

          return true;
        }

        if (tryFill()) return;

        // SPA: form may not be rendered yet - wait for it
        const obs = new MutationObserver(() => { if (tryFill()) obs.disconnect(); });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), 15_000);
      },
      args: [email, password],
    })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));

    return true; // async - keep channel open
  }

  if (message.type === 'FIND_OR_NAVIGATE_ADMIN_TAB') {
    handleFindOrNavigate(sendResponse);
    return true; // async
  }

  if (message.type === 'RESET_TRIGGERED') {
    sendResponse({ ok: true });
    return false;
  }
});
