/**
 * autofill.js - declarative content script (isolated world).
 * Injected by Chrome into every *://*.nimbus.example/login* page (including incognito).
 *
 * Reads credentials from incognito chrome.storage.local (written by relay.js
 * which also runs in the incognito context - so both sides share the same
 * storage instance). Then asks the incognito background to inject the fill
 * script in MAIN world, bypassing the isolated-world prototype mismatch.
 */

(async () => {
  try {
    const data = await chrome.storage.local.get('_bs_autofill');
    const af   = data._bs_autofill;
    if (!af || Date.now() > af.expires) {
      if (af) await chrome.storage.local.remove('_bs_autofill');
      return;
    }

    // Clear immediately - one-time use
    await chrome.storage.local.remove('_bs_autofill');

    // Delegate fill to the background so it can run in MAIN world.
    // Content scripts share the page's origin but not the page's JS prototype
    // chain - only executeScript({ world:'MAIN' }) from the background can
    // set input values in a way Vue/React reactivity recognises.
    chrome.runtime.sendMessage({
      type:     '_BS_FILL',
      email:    af.em,
      password: af.pw,
    });

  } catch { /* never break the host page */ }
})();
