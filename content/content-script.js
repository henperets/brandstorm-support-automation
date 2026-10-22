/**
 * content-script.js
 * Injected only into https://admin.nimbus.example/* tabs.
 *
 * SECURITY CONTRACT:
 * - This script never reads, stores, logs, or transmits any password value.
 * - It clicks the DOM button and then intentionally does NOT read the response DOM.
 * - The password is a value the admin console displays itself after the reset
 *   call succeeds; the extension deliberately ignores that display and never
 *   calls the underlying reset endpoint directly.
 * - It validates its own origin before executing any action.
 * - All module-level state is wiped after workflow completion or on timeout.
 * - The admin console's own session, CSRF handling, and audit logging are left
 *   entirely untouched - this script only ever clicks the real button in a
 *   real logged-in tab.
 *
 * DOM FACTS (confirmed from live HTML, Quasar + Vue.js framework):
 * - Brand cards (post [2026-07] update): article.brand-card  (was tbody tr.q-tr)
 * - Brand name:     .brand-card__title  (was td:nth-child(2) span)
 * - Brand ID:       NOT positional anymore. Inside .brand-card__meta, find the
 *                    .brand-card__meta-row whose .brand-card__meta-label text is
 *                    "ID", then read the sibling .brand-card__meta-value text.
 *                    (was td:nth-child(1) span)
 * - Edit button:  NOT clicked - full page reload would destroy this script mid-response
 * - Reset button: button.q-btn.bg-brown-5  (fallback: case-insensitive text match on
 *                  the "Reset <role> password" label - as of the [2026-07] admin site update
 *                  the label is sentence-case and wrapped
 *                  in a nested <span class="block">, so matching is done on the button's
 *                  bubbled textContent rather than an exact string)
 */

'use strict';

const ALLOWED_ORIGIN = 'https://admin.nimbus.example';

// ─── Hard origin guard ─────────────────────────────────────────────────────────
// If this script ever executes on the wrong origin (should be impossible given
// manifest host_permissions), abort immediately before touching anything.
if (window.location.origin !== ALLOWED_ORIGIN) {
  console.error('[Admin Console] Origin mismatch - script aborted.');
  throw new Error('Admin Console Extension: origin guard triggered.');
}

// ─── Transient state ───────────────────────────────────────────────────────────
// All variables here are explicitly nulled by wipeTransientState().
let _mutationObserver = null;
let _wipeTimer = null;

// ─── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Accept only messages from this extension
  if (sender.id !== chrome.runtime.id) return false;

  switch (message?.type) {
    case 'SEARCH_BRAND':
      handleSearchBrand(message.brandName, sendResponse);
      return true; // async

    case 'TRIGGER_RESET':
      handleTriggerReset(sendResponse);
      return true; // async

    case 'PING':
      sendResponse({ ok: true });
      return false;

    case 'CLEANUP':
      wipeTransientState();
      sendResponse({ ok: true });
      return false;

    default:
      sendResponse({ ok: false, error: 'unknown_type' });
      return false;
  }
});

// ─── Brand Search ──────────────────────────────────────────────────────────────

async function handleSearchBrand(brandName, sendResponse) {
  try {
    // Validate input defensively (background already sanitized, but belt-and-suspenders)
    if (typeof brandName !== 'string' || brandName.length === 0 || brandName.length > 100) {
      sendResponse({ ok: false, error: 'invalid_brand_name' });
      return;
    }

    // Must be on the brands list route
    if (!window.location.hash.startsWith('#/brands')) {
      sendResponse({ ok: false, error: 'wrong_route' });
      return;
    }

    // Schedule automatic wipe in case something hangs
    scheduleWipe(30_000);

    // Step 1: Wait for the brands grid to have cards with actual data.
    // The admin site now renders brand cards (article.brand-card) instead of
    // table rows. Wait for .brand-card__title to be populated, same reasoning
    // as before: the skeleton can render before the API response arrives.
    const dataReady = await waitForElement(
      '.brand-card__title',
      15_000,
      el => el.textContent.trim().length > 0,
    );
    if (!dataReady) {
      sendResponse({ ok: false, error: 'brand_not_found' });
      wipeTransientState();
      return;
    }

    // Step 2: Try to use the admin site's search/filter input to narrow results.
    // The toolbar also has a search-mode select (Name / ID / NodeId) added in
    // the [2026-07] update. If it's left on anything but "Name" (e.g. sticky
    // from a prior session), typing a brand name would filter the wrong field
    // and look identical to "brand not found" - so force it to "Name" first.
    const searchModeSelect = findSearchModeSelect();
    if (searchModeSelect && searchModeSelect.value !== 'Name') {
      setVueSelectValue(searchModeSelect, 'Name');
      await delay(300);
    }

    const searchInput = findSearchInput();
    if (searchInput) {
      setVueInputValue(searchInput, brandName);
      // Wait for Vue to re-render the filtered rows.
      // 1 000 ms instead of 600 ms for slower connections.
      await delay(1_000);
    }

    // Step 3: Scan visible cards for exact brand name match.
    // If the search filter produced no results (brand not visible), clear the
    // filter and do a full-grid scan as a fallback before giving up.
    let targetCard = findBrandCard(brandName);
    if (!targetCard && searchInput) {
      setVueInputValue(searchInput, '');
      await delay(800);
      targetCard = findBrandCard(brandName);
    }
    if (!targetCard) {
      sendResponse({ ok: false, error: 'brand_not_found' });
      wipeTransientState();
      return;
    }

    // Step 4: Read the brandId from the card's "ID" meta row. The admin site's
    // card layout has no positional ID column anymore - the ID lives inside
    // .brand-card__meta as a labeled row, so we match by label text instead
    // of column position. The background will navigate directly to
    // /#/brands/{brandId} via chrome.tabs.update - we do NOT click the card
    // because that triggers a full page reload which destroys this content
    // script before it can send a response (confirmed from HAR analysis).
    const brandId = getCardMetaValue(targetCard, 'ID');

    if (!brandId || !/^\d+$/.test(brandId)) {
      sendResponse({ ok: false, error: 'brand_not_found' });
      wipeTransientState();
      return;
    }

    wipeTransientState();
    sendResponse({ ok: true, brandId });

  } catch (err) {
    // Never expose err.message - may contain DOM fragments
    sendResponse({ ok: false, error: 'search_failed' });
    wipeTransientState();
  }
}

// ─── Reset Trigger ─────────────────────────────────────────────────────────────

async function handleTriggerReset(sendResponse) {
  try {
    // Verify current route is a brand detail page
    const hashMatch = window.location.hash.match(/^#\/brands\/(\d+)$/);
    if (!hashMatch) {
      sendResponse({ ok: false, error: 'not_on_brand_page' });
      return;
    }

    const resetButton = await waitForElement('button.q-btn.bg-brown-5', 10_000)
      ?? await waitForElement('button', 0, el => /^reset +[^ ]+ +password$/i.test(el.textContent.trim()));

    if (!resetButton) {
      sendResponse({ ok: false, error: 'reset_button_not_found' });
      return;
    }

    if (resetButton.disabled || resetButton.getAttribute('aria-disabled') === 'true') {
      sendResponse({ ok: false, error: 'reset_button_disabled' });
      return;
    }

    resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await delay(1500);

    const ERROR_SELECTOR = [
      '.q-notification--type-negative',
      '.q-notification .bg-negative',
      '.q-notification .text-negative',
    ].join(', ');

    const errorDetected = !!document.querySelector(ERROR_SELECTOR);

    chrome.runtime.sendMessage({ type: 'RESET_TRIGGERED' });

    if (errorDetected) {
      sendResponse({ ok: false, error: 'reset_server_error' });
    } else {
      sendResponse({ ok: true });
    }

  } catch (err) {
    sendResponse({ ok: false, error: 'reset_failed' });
  } finally {
    // Wipe all transient state immediately after reset dispatch regardless of outcome
    wipeTransientState();
  }
}

// ─── DOM Helpers ───────────────────────────────────────────────────────────────

/**
 * Attempts to find a search/filter input in the Quasar table header.
 * Quasar tables render filter inputs inside .q-table__top.
 * Falls back to common patterns if the specific one is absent.
 * @returns {HTMLInputElement|null}
 */
function findSearchInput() {
  // Primary: dedicated search input class introduced in the [2026-07] admin site update
  const byDedicatedClass = document.querySelector('input.brands-page__search-input');
  if (byDedicatedClass) return byDedicatedClass;

  // Legacy: Quasar table top section filter input (pre-update)
  const inTableTop = document.querySelector('.q-table__top input[type="text"]');
  if (inTableTop) return inTableTop;

  // Fallback A: any search-labelled input on the page
  const byPlaceholder = document.querySelector(
    'input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Filter"], input[placeholder*="filter"]'
  );
  if (byPlaceholder) return byPlaceholder;

  // Fallback B: Quasar input component anywhere above the table
  const qInput = document.querySelector('.q-input input[type="text"]');
  if (qInput) return qInput;

  return null;
}

/**
 * Scans all visible brand cards for an EXACT name match (case-insensitive).
 * Uses .brand-card__title, which holds the brand name (confirmed from live DOM
 * on the [2026-07] card-grid admin layout).
 * @param {string} brandName - already sanitized
 * @returns {HTMLElement|null} the article.brand-card element
 */
function findBrandCard(brandName) {
  const cards = document.querySelectorAll('article.brand-card');
  for (const card of cards) {
    const titleEl = card.querySelector('.brand-card__title');
    if (titleEl && titleEl.textContent.trim().toLowerCase() === brandName.toLowerCase()) {
      return card;
    }
  }
  return null;
}

/**
 * Reads a labeled value out of a brand card's meta rows.
 * The card layout has no positional columns - each fact (ID, Node, Tier, ...)
 * is a .brand-card__meta-row with a .brand-card__meta-label and a sibling
 * .brand-card__meta-value. We match by label text (case-insensitive) rather
 * than position, since row order isn't guaranteed to stay stable.
 * @param {HTMLElement} card - article.brand-card element
 * @param {string} label - e.g. "ID", "Node", "Tier"
 * @returns {string|null}
 */
function getCardMetaValue(card, label) {
  const rows = card.querySelectorAll('.brand-card__meta-row');
  for (const row of rows) {
    const labelEl = row.querySelector('.brand-card__meta-label');
    if (labelEl && labelEl.textContent.trim().toLowerCase() === label.toLowerCase()) {
      const valueEl = row.querySelector('.brand-card__meta-value');
      return valueEl ? valueEl.textContent.trim() : null;
    }
  }
  return null;
}

/**
 * Finds the search-mode dropdown introduced alongside the search input in the
 * [2026-07] admin site update (options: Name / ID / NodeId).
 * @returns {HTMLSelectElement|null}
 */
function findSearchModeSelect() {
  return document.querySelector('select.brands-page__search-select');
}

/**
 * Sets a <select>'s value in a way that triggers Vue reactivity, mirroring
 * setVueInputValue below. Native selects driven by v-model still need the
 * value set through the prototype setter plus a dispatched 'change' event
 * for Vue's watcher to pick it up reliably.
 * @param {HTMLSelectElement} element
 * @param {string} value - must match one of the <option value="..."> exactly
 */
function setVueSelectValue(element, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Sets an input value in a way that triggers Vue reactivity.
 * Vue.js intercepts the native value setter - we must call it via
 * Object.getOwnPropertyDescriptor on the prototype to bypass Vue's proxy.
 * @param {HTMLInputElement} element
 * @param {string} value
 */
function setVueInputValue(element, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }

  // Fire both input and change to ensure Vue watchers and Quasar components react
  element.dispatchEvent(new Event('input',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Polls the DOM until a matching element appears, or times out.
 * Uses MutationObserver for efficiency - no busy-wait.
 *
 * @param {string} selector - CSS selector to match
 * @param {number} timeoutMs - 0 means check once immediately only
 * @param {Function} [filter] - optional extra predicate on the matched element
 * @returns {Promise<Element|null>}
 */
function waitForElement(selector, timeoutMs, filter) {
  return new Promise((resolve) => {
    function find() {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        if (!filter || filter(el)) return el;
      }
      return null;
    }

    const immediate = find();
    if (immediate) { resolve(immediate); return; }
    if (timeoutMs === 0) { resolve(null); return; }

    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeoutMs);

    const obs = new MutationObserver(() => {
      const found = find();
      if (found) {
        clearTimeout(timer);
        obs.disconnect();
        resolve(found);
      }
    });

    // characterData:true catches Vue updating text content in-place (not just
    // adding/removing nodes), which is how Quasar fills table cell spans when
    // brand data arrives after the DOM skeleton is already rendered.
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

// ─── Memory Wipe ───────────────────────────────────────────────────────────────

function scheduleWipe(ms) {
  if (_wipeTimer) clearTimeout(_wipeTimer);
  _wipeTimer = setTimeout(wipeTransientState, ms);
}

function wipeTransientState() {
  if (_mutationObserver) {
    _mutationObserver.disconnect();
    _mutationObserver = null;
  }
  if (_wipeTimer) {
    clearTimeout(_wipeTimer);
    _wipeTimer = null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
