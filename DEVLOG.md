# Brandstorm Development Log

> Chrome Extension for internal support tooling
> Built by **Hen Perets**

---

## Overview

Brandstorm is a Chrome extension that gives quick access to brand URLs, letting you copy a brand's URL, open it in a fresh incognito session, reset the user password, or do all of the above in one fully automated click.

---

## Phase 1: Core Brand Launcher

**What was built:**
- A popup listing all brands with their URLs
- Copy-to-clipboard button per brand
- "Open in Incognito" button that opens a clean incognito session (no leftover cookies)

**Key design decisions:**
- `manifest.json` uses `"incognito": "split"`, so the extension gets a completely separate instance inside incognito, including its own background service worker
- `relay.html` / `relay.js` were introduced as the incognito entry point: instead of navigating directly to the brand URL, the background (regular context) opens `relay.html` inside incognito. `relay.js` runs there, closes any existing incognito windows, wipes all `nimbus.example` cookies, then navigates to the brand URL, guaranteeing a clean session
- The regular background cannot touch incognito tabs in split mode; relay.js solves this by running *inside* the incognito context

---

## Phase 2: Super Extension Integration ("Reset User Pass")

**What was built:**
- A **"Reset User Pass"** button added to every brand row in the popup
- Clicking it finds or opens the admin tab (`admin.nimbus.example/#/brands`), searches for the brand by slug, triggers the two-step Vue password reset (brown button → confirm dialog), extracts the new password from the admin DOM, and copies it to the clipboard
- A shared modal overlay with 6 states: `loading → confirm → executing → done → server-error → error`
- The admin tab is kept in the background (`active: false`) so the popup stays open during the flow

**Technical challenges:**
- The admin site uses **Quasar + Vue 3**, so standard DOM clicks don't trigger Vue reactivity. Two-step click simulation was required: trigger a Vue synthetic click event, wait for the dialog to mount, click confirm
- Password extraction polls the DOM for Quasar positive-notification banners or dialog content text
- A `content/content-script.js` was added (mirror of the original Super extension) to handle `PING`, `SEARCH_BRAND`, and `TRIGGER_RESET` messages from the popup, with an origin guard for `admin.nimbus.example`
- `background.js` gained `FIND_OR_NAVIGATE_ADMIN_TAB` handler: finds an existing admin tab or creates one

---

## Phase 3: "Take Me There" Full Automation

**What was built:**
- A **"Take me there"** button per brand that runs the entire flow end-to-end, unattended:
  1. Reset the user password for the selected brand
  2. Auto-click "Proceed" on the confirm dialog
  3. Extract the new password from the admin DOM
  4. Copy the password to clipboard
  5. Open the brand login page in a fresh incognito window
  6. Autofill `user@nimbus.example` + the new password into the login form
  7. Auto-submit the login form

**Modal flow refinements:**
- Shared helpers `_searchAndNavigate`, `_clickResetSequence`, `_startResetFlow` used by both Reset Pass and Full Auto
- "Done" button: shows **"View Admin Page"** for Reset-only flow, **"Close"** for Full Auto (clipboard already has the password)

---

## Phase 4: Autofill in Incognito (Many Attempts)

This was the hardest part. Getting credentials into the incognito brand login page required solving several compounding browser constraints.

### Attempt 1: Regular storage → incognito content script
**Idea:** `popup.js` writes credentials to `chrome.storage.local`; `autofill.js` content script reads them in incognito.
**Why it failed:** In `incognito: "split"` mode, `chrome.storage.local` is **separate** per profile. The regular popup writes to regular storage; the incognito content script reads from incognito storage, a completely different object. The data was never there.

### Attempt 2: `chrome.tabs.onUpdated` + `executeScript` from relay.js
**Idea:** `relay.js` opens the brand URL in a new tab, listens for `tabs.onUpdated`, then injects the fill script when the tab finishes loading.
**Why it failed:** `chrome.tabs.create` from an incognito extension page tab doesn't reliably open a new tab in the same incognito window. The brand tab never appeared.

### Attempt 3: Direct DOM fill from content script (isolated world)
**Idea:** `autofill.js` sets `input.value` directly and dispatches events.
**Why it failed:** Content scripts run in an **isolated JavaScript world**. Their `HTMLInputElement.prototype` is separate from the page's. When Vue reads `event.target.value` in response to the dispatched `input` event, it reads from the page's prototype, not the isolated world's setter, so the value appears empty. The email field turned red (Vue validation fired) but the value was blank.

### Attempt 4: Isolated world → background → MAIN world `executeScript`
**Idea:** `autofill.js` sends a `_BS_FILL` message to the background with email/password; background runs `executeScript({ world: 'MAIN' })` on the sender tab.
**Why it failed (silently):** A typo: the message listener parameter was named `_sender` but the handler referenced `sender` (undefined). `tabId` was always `undefined`, the early-return fired, and nothing happened.

### Attempt 5: `window.name` relay
**Idea:** Set `window.name` in `relay.js` before navigating; read it from MAIN world on the brand page.
**Why it failed:** Chrome **clears `window.name`** when navigating from a `chrome-extension://` page to an `https://` page. This is a privacy feature introduced in Chrome 86+. The credentials silently vanished every time.

### Attempt 6: `relay.js` writes to incognito storage ✅
**The fix that worked:**
Since `relay.js` runs *inside* the incognito extension context, its `chrome.storage.local` **is** the incognito storage, the exact same instance that `autofill.js` (an incognito content script) reads from. The flow:

1. `background.js` encodes credentials as `?d=base64(JSON)` in the relay URL (with `encodeURIComponent` to safely handle `+`/`/` in base64 output)
2. `relay.js` decodes them, writes `{ em, pw, expires }` to incognito `chrome.storage.local`, then navigates to the brand URL
3. `autofill.js` runs at `document_idle` on the brand login page, reads incognito storage, sends `_BS_FILL` to the incognito background
4. The incognito background runs `executeScript({ world: 'MAIN' })` on the sender tab, using the page's own `HTMLInputElement.prototype` setter so Vue reactivity picks up the value correctly
5. A `MutationObserver` fallback waits up to 15 seconds if the SPA hasn't rendered the form yet

**Final bug found via console logging:**
The brand login page contained hidden decoy inputs (`id="hiddenEmail"`, `id="hiddenPassword"`) that our selectors matched first. The fix was wrapping every input selector in a `firstVisible()` helper (`el.offsetParent !== null`) to skip hidden elements and always target the real visible form fields.

---

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest: permissions, content scripts, split incognito |
| `popup.html` | Extension popup UI: brand list, search, modal overlay |
| `popup.css` | Dark-theme styles for popup and modal |
| `popup.js` | All popup logic: brand rendering, reset flow, full-auto flow |
| `background.js` | Regular-context service worker: opens incognito window, handles fill inject, admin tab navigation |
| `relay.html` | Minimal HTML page loaded inside incognito as entry point |
| `relay.js` | Incognito entry: closes old windows, clears cookies, stores autofill credentials, navigates to brand |
| `autofill.js` | Declarative content script: reads incognito storage, signals background to fill form |
| `brands.js` | Static list of brand URLs |
| `content/content-script.js` | Injected into admin site: handles SEARCH_BRAND and TRIGGER_RESET messages |

---

## Permissions Used

| Permission | Why |
|---|---|
| `tabs` | Find/create/update the admin tab |
| `windows` | Create incognito window; close old incognito windows |
| `scripting` | `executeScript` in MAIN world for Vue-compatible form fill |
| `storage` | Relay autofill credentials through incognito storage |
| `cookies` | Clear nimbus.example cookies before opening brand session |
| `clipboardWrite` | Copy new password to clipboard |
| `host_permissions: *://*.nimbus.example/*` | Access admin site DOM and inject content scripts on brand login pages |

---

*Made by Hen Perets*
