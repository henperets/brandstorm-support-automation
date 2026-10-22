(() => {
  const searchInput = document.getElementById("searchInput");
  const clearBtn = document.getElementById("clearBtn");
  const brandList = document.getElementById("brandList");
  const emptyState = document.getElementById("emptyState");
  const toast = document.getElementById("toast");
  const addBrandBtn = document.getElementById("addBrandBtn");
  const addBrandForm = document.getElementById("addBrandForm");
  const newBrandInput = document.getElementById("newBrandInput");
  const confirmAddBtn = document.getElementById("confirmAddBtn");
  const cancelAddBtn = document.getElementById("cancelAddBtn");
  const openTabBtn = document.getElementById("openTabBtn");

  // Tab-mode: when popup.html is opened as a full browser tab
  const isTabMode = new URLSearchParams(location.search).get("tab") === "1";
  if (isTabMode) {
    document.body.classList.add("tab-mode");
    openTabBtn.classList.add("hidden"); // already in a tab, no need for this button
  }

  openTabBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") + "?tab=1" });
  });

  let toastTimer = null;
  let customBrands = [];   // Brands added by the user
  let deletedIds = new Set(); // IDs of deleted built-in brands

  // ── Storage ──────────────────────────────────────────────────────────────────

  function loadStorage(callback) {
    chrome.storage.local.get(["customBrands", "deletedBrands"], (data) => {
      customBrands = data.customBrands || [];
      deletedIds = new Set(data.deletedBrands || []);
      callback();
    });
  }

  function saveCustomBrands() {
    chrome.storage.local.set({ customBrands });
  }

  function saveDeletedIds() {
    chrome.storage.local.set({ deletedBrands: [...deletedIds] });
  }

  // ── All brands (built-in minus deleted + custom) ──────────────────────────

  function getAllBrands() {
    const builtIn = BRANDS.filter((b) => !deletedIds.has(b.id));
    return [...builtIn, ...customBrands];
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function filterBrands(query) {
    const all = getAllBrands();
    if (!query.trim()) return all;
    const q = query.toLowerCase().trim();
    return all.filter((brand) => {
      const inName = brand.displayName.toLowerCase().includes(q);
      const inAliases = brand.aliases.some((a) => a.toLowerCase().includes(q));
      const inUrl = brand.url.toLowerCase().includes(q);
      return inName || inAliases || inUrl;
    });
  }

  function highlightMatch(text, query) {
    if (!query.trim()) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query.trim()).replace(
      /[-[\]{}()*+?.,\\^$|#\s]/g,
      "\\$&"
    );
    return escaped.replace(
      new RegExp(`(${escapedQuery})`, "gi"),
      "<mark>$1</mark>"
    );
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderBrands(query = "") {
    const filtered = filterBrands(query);
    brandList.innerHTML = "";

    if (filtered.length === 0) {
      brandList.classList.add("hidden");
      emptyState.classList.remove("hidden");
      return;
    }

    brandList.classList.remove("hidden");
    emptyState.classList.add("hidden");

    filtered.forEach((brand) => {
      const isCustom = !!brand.custom;
      const card = document.createElement("div");
      card.className = "brand-card";
      card.innerHTML = `
        <div class="brand-card-top">
          <div class="brand-info">
            <div class="brand-name">
              ${highlightMatch(brand.displayName, query)}
              ${isCustom ? '<span class="custom-badge">custom</span>' : ""}
            </div>
            <div class="brand-url" title="${escapeHtml(brand.url)}">${escapeHtml(brand.url)}</div>
          </div>
          <button class="btn-delete" data-id="${escapeHtml(brand.id)}" data-custom="${isCustom}" title="Delete brand">🗑</button>
        </div>
        <div class="brand-tags">
          ${brand.aliases.map((a) => `<span class="tag">${highlightMatch(a, query)}</span>`).join("")}
        </div>
        <div class="brand-actions">
          <button class="btn btn-copy" data-url="${escapeHtml(brand.url)}" title="Copy URL to clipboard">
            <span class="btn-icon">📋</span> Copy URL
          </button>
          <button class="btn btn-incognito" data-url="${escapeHtml(brand.url)}" title="Close all incognito windows and open this URL in a new incognito window">
            <span class="btn-icon">🕵️</span> Open Incognito
          </button>
          <button class="btn btn-reset" data-url="${escapeHtml(brand.url)}" data-name="${escapeHtml(brand.displayName)}" title="Reset user password on admin site">
            <span class="btn-icon">🔑</span> Reset Pass
          </button>
        </div>
        <div class="brand-actions-auto">
          <button class="btn btn-auto" data-url="${escapeHtml(brand.url)}" data-name="${escapeHtml(brand.displayName)}" title="Auto-reset password, copy it, and log in as user in incognito">
            <span class="btn-icon">🚀</span> Take me there
          </button>
          <button class="btn btn-logs" data-url="${escapeHtml(brand.url)}" data-name="${escapeHtml(brand.displayName)}" title="Open brand logs in Kibana">
            <span class="btn-icon">📊</span> Open Logs
          </button>
        </div>
        <div class="brand-actions-extra">
          <button class="btn btn-reset-for" data-url="${escapeHtml(brand.url)}" data-name="${escapeHtml(brand.displayName)}" title="Send a one-time password reset link to someone's email">
            <span class="btn-icon">✉️</span> Reset for…
          </button>
        </div>
      `;
      brandList.appendChild(card);
    });

    brandList.querySelectorAll(".btn-copy").forEach((btn) => {
      btn.addEventListener("click", () => handleCopy(btn.dataset.url));
    });

    brandList.querySelectorAll(".btn-incognito").forEach((btn) => {
      btn.addEventListener("click", () => handleOpenIncognito(btn.dataset.url));
    });

    brandList.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", () =>
        handleDelete(btn.dataset.id, btn.dataset.custom === "true")
      );
    });

    brandList.querySelectorAll(".btn-reset").forEach((btn) => {
      btn.addEventListener("click", () => handleResetBrand(btn.dataset.url, btn.dataset.name));
    });

    brandList.querySelectorAll(".btn-auto").forEach((btn) => {
      btn.addEventListener("click", () => handleFullAuto(btn.dataset.url, btn.dataset.name));
    });

    brandList.querySelectorAll(".btn-logs").forEach((btn) => {
      btn.addEventListener("click", () => handleViewLogs(btn.dataset.url, btn.dataset.name));
    });

    brandList.querySelectorAll(".btn-reset-for").forEach((btn) => {
      btn.addEventListener("click", () => handleResetFor(btn.dataset.url, btn.dataset.name));
    });
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function handleCopy(url) {
    navigator.clipboard
      .writeText(url)
      .then(() => showToast("✅ URL copied to clipboard!"))
      .catch(() => {
        const el = document.createElement("textarea");
        el.value = url;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        showToast("✅ URL copied to clipboard!");
      });
  }

  function handleOpenIncognito(url) {
    chrome.runtime.sendMessage({ action: "openIncognito", url }, (response) => {
      if (chrome.runtime.lastError) {
        showToast("❌ " + chrome.runtime.lastError.message, 6000);
        return;
      }
      if (response?.success) {
        showToast("🕵️ Opened in new incognito window");
      } else {
        showToast("❌ " + (response?.error || "Unknown error"), 6000);
      }
    });
  }

  function handleDelete(id, isCustom) {
    const password = prompt(`Enter password to delete "${id}":`);
    if (password === null) return; // cancelled
    if (password !== "1122") {
      showToast("❌ Wrong password", 3000);
      return;
    }
    if (isCustom) {
      customBrands = customBrands.filter((b) => b.id !== id);
      saveCustomBrands();
    } else {
      deletedIds.add(id);
      saveDeletedIds();
    }
    renderBrands(searchInput.value);
    showToast(`🗑 Deleted "${id}"`);
  }

  // ── Add Brand ────────────────────────────────────────────────────────────────

  addBrandBtn.addEventListener("click", () => {
    addBrandForm.classList.toggle("hidden");
    if (!addBrandForm.classList.contains("hidden")) {
      newBrandInput.focus();
    }
  });

  cancelAddBtn.addEventListener("click", () => {
    addBrandForm.classList.add("hidden");
    newBrandInput.value = "";
  });

  confirmAddBtn.addEventListener("click", () => addNewBrand());

  newBrandInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addNewBrand();
    if (e.key === "Escape") {
      addBrandForm.classList.add("hidden");
      newBrandInput.value = "";
    }
  });

  function addNewBrand() {
    const raw = newBrandInput.value.trim();
    if (!raw) return;

    const id = raw;
    const slug = id.toLowerCase().replace(/ /g, "-");
    const url = `https://${slug}.nimbus.example/login`;
    const displayName = id
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    // Check for duplicate
    const allIds = getAllBrands().map((b) => b.id.toLowerCase());
    if (allIds.includes(id.toLowerCase())) {
      showToast("⚠️ Brand already exists", 3000);
      return;
    }

    const newBrand = {
      id,
      displayName,
      url,
      aliases: [...new Set([id.toLowerCase(), slug])],
      custom: true,
    };

    customBrands.push(newBrand);
    saveCustomBrands();
    newBrandInput.value = "";
    addBrandForm.classList.add("hidden");
    renderBrands(searchInput.value);
    showToast(`✅ Added "${displayName}"`);
  }

  // ── Toast ────────────────────────────────────────────────────────────────────

  function showToast(message, duration = 2200) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    toast.offsetHeight;
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 200);
    }, duration);
  }

  // ── Search ───────────────────────────────────────────────────────────────────

  searchInput.addEventListener("input", () => {
    const q = searchInput.value;
    clearBtn.classList.toggle("hidden", q.length === 0);
    renderBrands(q);
  });

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.classList.add("hidden");
    renderBrands("");
    searchInput.focus();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && searchInput.value) {
      searchInput.value = "";
      clearBtn.classList.add("hidden");
      renderBrands("");
    }
  });

  // ── Reset workflow ────────────────────────────────────────────────────────────

  const BRAND_SLUG_RE = /^[\p{L}\p{N}\-_.]+$/u;
  const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let _resetTabId        = null;
  let _resetDisplayName  = null;
  let _resetBrandUrl     = null;   // full brand URL, needed for slug + incognito open
  let _confirmCallback   = null;   // set by handleResetBrand, handleFullAuto, or proceedResetForWithEmail
  let _resetRecipientEmail = null; // set by proceedResetForWithEmail, used by stepResetForExecute
  let _pendingResetForUrl  = null; // brand url captured by handleResetFor, before email is entered
  let _pendingResetForName = null; // brand display name captured by handleResetFor

  function sendToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForBrandsListLoad(tabId) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: () => window.location.hash,
        });
        if (res?.result === '#/brands') return;
      } catch { /* tab still loading */ }
      await delay(500);
    }
  }

  async function waitForBrandsData(tabId) {
    for (let i = 0; i < 30; i++) {
      await delay(i < 6 ? 300 : 500);
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: () => {
            const title = document.querySelector('article.brand-card .brand-card__title');
            return !!title && title.textContent.trim().length > 0;
          },
        });
        if (res?.result === true) return;
      } catch { /* tab still loading */ }
    }
  }

  async function navigateToBrand(tabId, brandId) {
    const expectedHash = `#/brands/${brandId}`;
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: (id) => {
          const rootEl = document.querySelector('[data-v-app]') || document.getElementById('app');
          const router = rootEl?.__vue_app__?.config?.globalProperties?.$router;
          if (router?.push) {
            router.push(`/brands/${id}`);
          } else {
            window.location.hash = `/brands/${id}`;
          }
        },
        args: [brandId],
      });
    } catch { return false; }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await delay(300);
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: () => window.location.hash,
        });
        if (res?.result === expectedHash) return true;
      } catch { /* mid-navigation */ }
    }
    return false;
  }

  function rmTransitionTo(stateId) {
    document.querySelectorAll('.rm-state').forEach(s => s.classList.add('hidden'));
    document.getElementById(stateId)?.classList.remove('hidden');
  }

  function setRmStatus(text) {
    const node = document.getElementById('rm-status-text');
    if (node) node.textContent = text;
  }

  function openResetModal() {
    document.getElementById('resetModal')?.classList.remove('hidden');
  }

  function closeResetModal() {
    document.getElementById('resetModal')?.classList.add('hidden');
    _resetTabId          = null;
    _resetDisplayName    = null;
    _resetBrandUrl       = null;
    _confirmCallback     = null;
    _resetRecipientEmail = null;
    _pendingResetForUrl  = null;
    _pendingResetForName = null;
  }

  const RESET_ERROR_MAP = {
    brand_not_found:        'Brand not found in the admin site. The slug may differ from the admin display name.',
    reset_button_not_found: 'Reset button not found on the brand page.',
    reset_button_disabled:  'Reset button is currently disabled.',
    navigation_failed:      'Could not navigate to the admin page.',
    not_on_brand_page:      'Could not reach the brand detail page.',
    reset_failed:           'Reset action failed unexpectedly.',
    session_expired:        'Session expired. Please try again.',
    password_not_captured:  'Password was reset but could not be read from the admin page. Open the admin tab to see the new password.',
    reset_for_button_not_found:      '"Reset password for…" button not found on the brand page.',
    email_field_not_found:           'Recipient email field did not appear on the admin page.',
    confirm_record_button_not_found: '"Reset & record" button not found in the dialog.',
  };

  function showRmError(code) {
    const msg = RESET_ERROR_MAP[code] ?? 'An unexpected error occurred. Please try again.';
    const el  = document.getElementById('rm-error-msg');
    if (el) el.textContent = msg;
    rmTransitionTo('rm-error');
  }

  // Shared helper: sets confirm-state text and opens modal in loading state.
  // Called by both handleResetBrand and handleFullAuto.
  function _startResetFlow(brandUrl, brandDisplayName, confirmTitle, confirmBody) {
    _resetBrandUrl    = brandUrl;
    _resetDisplayName = brandDisplayName;

    // Set confirm text dynamically
    const t = document.getElementById('rm-confirm-title');
    const b = document.getElementById('rm-confirm-body');
    if (t) t.textContent = confirmTitle;
    if (b) b.textContent = confirmBody;

    rmTransitionTo('rm-loading');
    openResetModal();
  }

  // Shared helper: validates slug and runs the search+navigate steps.
  // Calls showRmError and returns false if anything fails.
  async function _searchAndNavigate(brandUrl, slug) {
    setRmStatus('Connecting to admin tab...');
    const tabResult = await sendToBackground({ type: 'FIND_OR_NAVIGATE_ADMIN_TAB' });
    if (!tabResult?.ok) { showRmError(tabResult?.error ?? 'navigation_failed'); return false; }

    _resetTabId = tabResult.tabId;

    if (tabResult.needsNavigation) {
      setRmStatus('Waiting for admin page to load...');
      await waitForBrandsListLoad(_resetTabId);
    }

    setRmStatus('Waiting for brand list data...');
    await waitForBrandsData(_resetTabId);

    setRmStatus('Searching for brand...');
    const alreadyLive = await sendToTab(_resetTabId, { type: 'PING' })
      .then(r => r?.ok === true)
      .catch(() => false);

    if (!alreadyLive) {
      await chrome.scripting.executeScript({
        target: { tabId: _resetTabId },
        files: ['content/content-script.js'],
      }).catch(() => {});
      await delay(200);
    }

    const searchResult = await sendToTab(_resetTabId, { type: 'SEARCH_BRAND', brandName: slug });
    if (!searchResult?.ok) { showRmError(searchResult?.error ?? 'brand_not_found'); return false; }

    setRmStatus('Navigating to brand page...');
    const navOk = await navigateToBrand(_resetTabId, searchResult.brandId);
    if (!navOk) { showRmError('navigation_failed'); return false; }

    return true;
  }

  async function handleResetBrand(brandUrl, brandDisplayName) {
    let slug;
    try {
      slug = new URL(brandUrl).hostname.split('.')[0];
    } catch {
      showToast('❌ Invalid brand URL', 3000);
      return;
    }
    if (!slug || !BRAND_SLUG_RE.test(slug)) {
      showToast('❌ Could not extract brand slug', 3000);
      return;
    }

    _confirmCallback = stepResetExecute;
    _startResetFlow(brandUrl, brandDisplayName, 'Confirm Reset', 'Reset the user password for:');

    try {
      const ok = await _searchAndNavigate(brandUrl, slug);
      if (!ok) return;
      const nameEl = document.getElementById('rm-brand-name');
      if (nameEl) nameEl.textContent = brandDisplayName;
      _confirmCallback?.();
    } catch {
      showRmError('navigation_failed');
    }
  }

  async function handleFullAuto(brandUrl, brandDisplayName) {
    let slug;
    try {
      slug = new URL(brandUrl).hostname.split('.')[0];
    } catch {
      showToast('❌ Invalid brand URL', 3000);
      return;
    }
    if (!slug || !BRAND_SLUG_RE.test(slug)) {
      showToast('❌ Could not extract brand slug', 3000);
      return;
    }

    _confirmCallback = stepFullAutoExecute;
    _startResetFlow(
      brandUrl, brandDisplayName,
      'Full Auto-Login',
      'Auto-reset password and log in as user for:'
    );

    // Update the confirm note text for full-auto context
    const note = document.getElementById('rm-confirm-note');
    if (note) note.innerHTML = 'Password will be <strong>reset</strong>, copied to clipboard, and auto-filled in a new incognito window.';

    try {
      const ok = await _searchAndNavigate(brandUrl, slug);
      if (!ok) return;
      const nameEl = document.getElementById('rm-brand-name');
      if (nameEl) nameEl.textContent = brandDisplayName;
      _confirmCallback?.();
    } catch {
      showRmError('navigation_failed');
    }
  }

  // ── "Reset password for…" (send one-time link by email) ──────────────────────
  // Unlike handleResetBrand/handleFullAuto, this needs a recipient email BEFORE
  // touching the admin tab at all, so it opens the modal straight into a
  // dedicated "rm-email" state first. Only once a valid email is submitted does
  // it fall through to the same _searchAndNavigate + confirm flow as the others.

  async function handleResetFor(brandUrl, brandDisplayName) {
    let slug;
    try {
      slug = new URL(brandUrl).hostname.split('.')[0];
    } catch {
      showToast('❌ Invalid brand URL', 3000);
      return;
    }
    if (!slug || !BRAND_SLUG_RE.test(slug)) {
      showToast('❌ Could not extract brand slug', 3000);
      return;
    }

    _pendingResetForUrl  = brandUrl;
    _pendingResetForName = brandDisplayName;

    const nameEl = document.getElementById('rm-email-brand-name');
    if (nameEl) nameEl.textContent = brandDisplayName;
    const input = document.getElementById('rm-email-input');
    if (input) input.value = '';
    const err = document.getElementById('rm-email-error');
    if (err) err.textContent = '';

    rmTransitionTo('rm-email');
    openResetModal();
    input?.focus();
  }

  async function proceedResetForWithEmail() {
    const input = document.getElementById('rm-email-input');
    const email = input?.value.trim() ?? '';
    const err   = document.getElementById('rm-email-error');

    if (!EMAIL_RE.test(email)) {
      if (err) err.textContent = 'Enter a valid email address.';
      input?.focus();
      return;
    }
    if (err) err.textContent = '';

    const brandUrl         = _pendingResetForUrl;
    const brandDisplayName = _pendingResetForName;
    let slug;
    try {
      slug = new URL(brandUrl).hostname.split('.')[0];
    } catch {
      showRmError('navigation_failed');
      return;
    }

    _resetRecipientEmail = email;
    _confirmCallback = stepResetForExecute;
    _startResetFlow(
      brandUrl, brandDisplayName,
      'Confirm Reset',
      `Send a one-time password reset link to ${email} for:`
    );

    try {
      const ok = await _searchAndNavigate(brandUrl, slug);
      if (!ok) return;
      const nameEl = document.getElementById('rm-brand-name');
      if (nameEl) nameEl.textContent = brandDisplayName;
      _confirmCallback?.();
    } catch {
      showRmError('navigation_failed');
    }
  }
  function _setDoneContent(title, body, note, btnText) {
    const t = document.getElementById('rm-done-title');
    const b = document.getElementById('rm-done-body');
    const n = document.getElementById('rm-done-note');
    const btn = document.getElementById('rm-btn-done');
    if (t) t.textContent = title;
    if (b) b.textContent = body;
    if (n) n.textContent = note;
    if (btn) btn.textContent = btnText;
  }

  // Shared two-step click: opens brown-button modal → clicks confirm → returns { ok, error }.
  // Does NOT wait for API or check notifications - caller handles that.
  async function _clickResetSequence(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        return new Promise((resolve) => {
          function vueClick(el) {
            let c = el.__vueParentComponent;
            while (c) {
              const h = c.vnode?.props?.onClick ?? c.attrs?.onClick;
              if (typeof h === 'function') { h(); return; }
              c = c.parent;
            }
            el.click();
          }

          const btn =
            document.querySelector('button.q-btn.bg-brown-5') ||
            Array.from(document.querySelectorAll('button'))
              .find(b => !document.querySelector('.q-dialog')?.contains(b) &&
                         /reset +[^ ]+ +password/i.test(b.textContent.trim()));

          if (!btn) { resolve({ ok: false, error: 'reset_button_not_found' }); return; }
          if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
            resolve({ ok: false, error: 'reset_button_disabled' }); return;
          }

          vueClick(btn);

          let obs;
          const deadline = setTimeout(() => {
            obs?.disconnect();
            resolve({ ok: false, error: 'reset_button_not_found' });
          }, 8_000);

          // Finds the confirm action inside the reset dialog by its label text,
          // not the whole button's textContent. As of the [2026-07] admin site
          // update the dialog is .reset-pw-dialog (not styled as bg-primary
          // anymore - it's bg-negative now) and the button has a leading
          // material-icon whose ligature text ("lock_reset") would corrupt a
          // full-textContent match. The label itself is isolated in a nested
          // <span class="block">, so match on that instead.
          function findConfirmResetButton() {
            const scope = document.querySelector('.reset-pw-dialog') || document.querySelector('.q-dialog');
            if (!scope) return null;
            const buttons = scope.querySelectorAll('button');
            for (const b of buttons) {
              const labelEl = b.querySelector('.block');
              const text = (labelEl ? labelEl.textContent : b.textContent).trim().toLowerCase();
              if (text === 'reset password') return b;
            }
            return null;
          }

          obs = new MutationObserver(() => {
            const confirmBtn = findConfirmResetButton();
            if (!confirmBtn) return;
            clearTimeout(deadline);
            obs.disconnect();
            vueClick(confirmBtn);
            resolve({ ok: true });
          });

          obs.observe(document.body, { childList: true, subtree: true });
        });
      },
    });
    return results?.[0]?.result ?? { ok: false, error: 'reset_failed' };
  }

  async function stepResetExecute() {
    if (!_resetTabId) { showRmError('session_expired'); return; }

    document.getElementById('rm-exec-status').textContent = 'Executing reset...';
    rmTransitionTo('rm-executing');

    try {
      const clickResult = await _clickResetSequence(_resetTabId);
      if (!clickResult.ok) { showRmError(clickResult.error ?? 'reset_button_not_found'); return; }

      await delay(1500);

      const [errRes] = await chrome.scripting.executeScript({
        target: { tabId: _resetTabId }, world: 'MAIN',
        func: () => {
          const sel = '.q-notification--type-negative, .q-notification .bg-negative, .q-notification .text-negative';
          return !!document.querySelector(sel);
        },
      });

      sendToBackground({ type: 'RESET_TRIGGERED' }).catch(() => {});

      if (errRes?.result) {
        rmTransitionTo('rm-server-error');
      } else {
        _setDoneContent(
          'Reset Dispatched',
          'Password reset sent successfully.',
          'View the new password on the admin page.',
          'View Admin Page'
        );
        rmTransitionTo('rm-done');
      }
    } catch {
      showRmError('reset_failed');
    }
  }

  // Two-step click for the "Reset password for…" flow: clicks the standalone
  // .reset-pw-for-trigger button on the brand page (opens the "for someone"
  // dialog), waits for its recipient-email input to appear, fills it, then
  // clicks "Reset & record". Returns { ok, error }.
  async function _clickResetForSequence(tabId, email) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [email],
      func: (email) => {
        return new Promise((resolve) => {
          function vueClick(el) {
            let c = el.__vueParentComponent;
            while (c) {
              const h = c.vnode?.props?.onClick ?? c.attrs?.onClick;
              if (typeof h === 'function') { h(); return; }
              c = c.parent;
            }
            el.click();
          }

          // Matches a button by its inner .block label text (case-insensitive),
          // not the whole button's textContent - leading material-icons carry
          // ligature text (e.g. "forward_to_inbox") that would corrupt a full
          // textContent match.
          function findByLabel(scope, text) {
            const buttons = scope.querySelectorAll('button');
            for (const b of buttons) {
              const labelEl = b.querySelector('.block');
              const t = (labelEl ? labelEl.textContent : b.textContent).trim().toLowerCase();
              if (t === text) return b;
            }
            return null;
          }

          const triggerBtn =
            document.querySelector('button.reset-pw-for-trigger') ||
            findByLabel(document, 'reset password for…') ||
            findByLabel(document, 'reset password for...');

          if (!triggerBtn) { resolve({ ok: false, error: 'reset_for_button_not_found' }); return; }
          if (triggerBtn.disabled || triggerBtn.getAttribute('aria-disabled') === 'true') {
            resolve({ ok: false, error: 'reset_button_disabled' }); return;
          }

          vueClick(triggerBtn);

          let obs;
          const deadline = setTimeout(() => {
            obs?.disconnect();
            resolve({ ok: false, error: 'email_field_not_found' });
          }, 8_000);

          obs = new MutationObserver(() => {
            const input = document.querySelector('input[aria-label="Recipient email"]');
            if (!input) return;
            clearTimeout(deadline);
            obs.disconnect();

            // Fill via the native setter + dispatched 'input' event so Vue's
            // v-model actually picks up the change (plain .value= doesn't
            // trigger Vue's reactivity on framework-managed inputs).
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            if (nativeSetter) nativeSetter.call(input, email);
            else input.value = email;
            input.dispatchEvent(new Event('input', { bubbles: true }));

            // Give Vue a tick to validate the email and enable "Reset & record"
            // before we try to find and click it.
            setTimeout(() => {
              const scope = document.querySelector('.reset-pw-dialog') || document.querySelector('.q-dialog');
              const confirmBtn = scope
                ? findByLabel(scope, 'reset & record')
                : findByLabel(document, 'reset & record');

              if (!confirmBtn) { resolve({ ok: false, error: 'confirm_record_button_not_found' }); return; }
              if (confirmBtn.disabled || confirmBtn.getAttribute('aria-disabled') === 'true') {
                resolve({ ok: false, error: 'reset_button_disabled' }); return;
              }
              vueClick(confirmBtn);
              resolve({ ok: true });
            }, 400);
          });

          obs.observe(document.body, { childList: true, subtree: true });
        });
      },
    });
    return results?.[0]?.result ?? { ok: false, error: 'reset_failed' };
  }

  async function stepResetForExecute() {
    if (!_resetTabId) { showRmError('session_expired'); return; }
    if (!_resetRecipientEmail) { showRmError('reset_failed'); return; }

    document.getElementById('rm-exec-status').textContent = 'Sending reset link...';
    rmTransitionTo('rm-executing');

    try {
      const clickResult = await _clickResetForSequence(_resetTabId, _resetRecipientEmail);
      if (!clickResult.ok) { showRmError(clickResult.error ?? 'reset_for_button_not_found'); return; }

      await delay(1500);

      const [errRes] = await chrome.scripting.executeScript({
        target: { tabId: _resetTabId }, world: 'MAIN',
        func: () => {
          const sel = '.q-notification--type-negative, .q-notification .bg-negative, .q-notification .text-negative';
          return !!document.querySelector(sel);
        },
      });

      sendToBackground({ type: 'RESET_TRIGGERED' }).catch(() => {});

      if (errRes?.result) {
        rmTransitionTo('rm-server-error');
      } else {
        _setDoneContent(
          'Reset Link Sent',
          `A one-time password reset link was sent to ${_resetRecipientEmail}.`,
          'The link expires in 1 day or after 5 views. This action was recorded in the audit log.',
          'View Admin Page'
        );
        rmTransitionTo('rm-done');
      }
    } catch {
      showRmError('reset_failed');
    }
  }

  // ── Full Auto-Login ──────────────────────────────────────────────────────────

  async function extractPasswordFromAdminDom(tabId) {
    // Poll up to ~5 s for the password to appear in the DOM after reset.
    // The API returns text/plain; the app shows it in a notification or dialog.
    for (let i = 0; i < 20; i++) {
      await delay(i === 0 ? 400 : 250);
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: () => {
            // Strategy 1: positive Quasar notification message
            const notifs = [...document.querySelectorAll('.q-notification')];
            for (const n of notifs.reverse()) {
              if (!n.className.includes('negative')) {
                const msg = n.querySelector('.q-notification__message');
                if (msg && msg.textContent.trim().length >= 6) return msg.textContent.trim();
              }
            }
            // Strategy 2: any notification message (even if class not yet resolved)
            const anyMsg = document.querySelector('.q-notification__message');
            if (anyMsg && anyMsg.textContent.trim().length >= 6) return anyMsg.textContent.trim();

            // Strategy 3: dialog content changed after API returned - look for a
            // token (no spaces, 6-80 chars) that isn't a known button label
            const dialog = document.querySelector('.add-new-dialog-card, .q-dialog .q-card__section:not(.q-card__actions)');
            if (dialog) {
              const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
              let node;
              const skip = ['close', 'cancel', 'reset', 'are you sure', 'confirm', 'password'];
              while ((node = walker.nextNode())) {
                const t = node.textContent.trim();
                const isLabel = skip.some(s => t.toLowerCase().includes(s));
                if (!isLabel && t.length >= 6 && t.length <= 80 && !/\s/.test(t)) return t;
              }
            }
            return null;
          },
        });
        if (res?.result) return res.result;
      } catch { /* tab may be mid-render */ }
    }
    return null;
  }

  async function stepFullAutoExecute() {
    if (!_resetTabId) { showRmError('session_expired'); return; }

    const execStatus = document.getElementById('rm-exec-status');
    const setExec = t => { if (execStatus) execStatus.textContent = t; };

    setExec('Resetting password...');
    rmTransitionTo('rm-executing');

    try {
      // Step 1: Two-step reset click
      const clickResult = await _clickResetSequence(_resetTabId);
      if (!clickResult.ok) { showRmError(clickResult.error ?? 'reset_button_not_found'); return; }

      // Step 2: Wait for API response + check for server error
      await delay(1500);
      const [errRes] = await chrome.scripting.executeScript({
        target: { tabId: _resetTabId }, world: 'MAIN',
        func: () => {
          const sel = '.q-notification--type-negative, .q-notification .bg-negative, .q-notification .text-negative';
          return !!document.querySelector(sel);
        },
      });
      if (errRes?.result) { rmTransitionTo('rm-server-error'); return; }

      // Step 3: Extract new password from admin DOM
      setExec('Capturing new password...');
      const newPassword = await extractPasswordFromAdminDom(_resetTabId);
      if (!newPassword) { showRmError('password_not_captured'); return; }

      // Step 4: Copy password to clipboard
      try { await navigator.clipboard.writeText(newPassword); } catch { /* no clipboard permission */ }

      // Step 5: Open incognito with autofill credentials.
      // Credentials are encoded in the relay URL and stored in window.name by
      // relay.js before it navigates. window.name persists through same-tab
      // navigations across origins - no storage or message-passing needed.
      const email = 'user@nimbus.example';

      setExec('Opening incognito window...');
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action:   'openIncognito',
          url:      _resetBrandUrl,
          autofill: { email, password: newPassword },
        }, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response?.success) resolve();
          else reject(new Error(response?.error ?? 'incognito_failed'));
        });
      });

      sendToBackground({ type: 'RESET_TRIGGERED' }).catch(() => {});

      _setDoneContent(
        'Done!',
        'Incognito window is logging you in as user.',
        'Password also copied to clipboard.',
        'Close'
      );
      rmTransitionTo('rm-done');

    } catch {
      showRmError('reset_failed');
    }
  }

  // ── Brand Logs / Kibana ──────────────────────────────────────────────────────

  async function navigateToBrandLogs(tabId, brandId) {
    const expectedHash = `#/brands/${brandId}/logs`;
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: (id) => {
          const rootEl = document.querySelector('[data-v-app]') || document.getElementById('app');
          const router = rootEl?.__vue_app__?.config?.globalProperties?.$router;
          if (router?.push) {
            router.push(`/brands/${id}/logs`);
          } else {
            window.location.hash = `/brands/${id}/logs`;
          }
        },
        args: [brandId],
      });
    } catch { return false; }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await delay(300);
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: () => window.location.hash,
        });
        if (res?.result === expectedHash) return true;
      } catch { /* mid-navigation */ }
    }
    return false;
  }

  async function clickGoToKibana(tabId) {
    for (let i = 0; i < 15; i++) {
      await delay(i === 0 ? 600 : 400);
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: () => {
            const btn = Array.from(document.querySelectorAll('button'))
              .find(b => b.textContent.trim().toUpperCase() === 'GO TO KIBANA');
            if (!btn) return false;
            btn.click();
            return true;
          },
        });
        if (res?.result === true) return true;
      } catch { /* tab still loading */ }
    }
    return false;
  }

  async function handleViewLogs(brandUrl, brandDisplayName) {
    let slug;
    try {
      slug = new URL(brandUrl).hostname.split('.')[0];
    } catch {
      showToast('❌ Invalid brand URL', 3000);
      return;
    }
    if (!slug || !BRAND_SLUG_RE.test(slug)) {
      showToast('❌ Could not extract brand slug', 3000);
      return;
    }

    showToast('📊 Opening logs...', 10000);

    try {
      const tabResult = await sendToBackground({ type: 'FIND_OR_NAVIGATE_ADMIN_TAB' });
      if (!tabResult?.ok) { showToast('❌ Could not reach admin site', 4000); return; }

      const tabId = tabResult.tabId;

      if (tabResult.needsNavigation) {
        await waitForBrandsListLoad(tabId);
      }

      await waitForBrandsData(tabId);

      const alreadyLive = await sendToTab(tabId, { type: 'PING' })
        .then(r => r?.ok === true)
        .catch(() => false);

      if (!alreadyLive) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/content-script.js'],
        }).catch(() => {});
        await delay(200);
      }

      const searchResult = await sendToTab(tabId, { type: 'SEARCH_BRAND', brandName: slug });
      if (!searchResult?.ok) { showToast('❌ Brand not found in admin site', 4000); return; }

      const logsOk = await navigateToBrandLogs(tabId, searchResult.brandId);
      if (!logsOk) { showToast('❌ Could not navigate to logs page', 4000); return; }

      const kibanaOk = await clickGoToKibana(tabId);
      if (!kibanaOk) { showToast('❌ GO TO KIBANA button not found', 4000); return; }

      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      showToast('📊 Kibana logs opened!', 3000);
    } catch (err) {
      showToast('❌ Failed: ' + (err.message || 'Unknown error'), 4000);
    }
  }

  // ── Reset modal event listeners ───────────────────────────────────────────────
  document.getElementById('rm-btn-cancel')?.addEventListener('click', closeResetModal);
  document.getElementById('rm-btn-server-retry')?.addEventListener('click', closeResetModal);
  document.getElementById('rm-btn-retry')?.addEventListener('click', closeResetModal);
  document.getElementById('rm-btn-email-cancel')?.addEventListener('click', closeResetModal);
  document.getElementById('rm-btn-email-continue')?.addEventListener('click', proceedResetForWithEmail);
  document.getElementById('rm-email-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') proceedResetForWithEmail();
  });

  // Calls whichever step was registered by handleResetBrand or handleFullAuto
  document.getElementById('rm-btn-confirm')?.addEventListener('click', () => _confirmCallback?.());

  document.getElementById('rm-btn-done')?.addEventListener('click', () => {
    const tid     = _resetTabId;
    const btnText = document.getElementById('rm-btn-done')?.textContent ?? '';
    closeResetModal();
    // "View Admin Page" (Reset Pass flow) - switches to admin tab so the user
    // can see the new password. Tab switch closes the popup.
    // "Close" (Full Auto flow) - just closes the modal; incognito is already open.
    if (btnText === 'View Admin Page' && tid) {
      chrome.tabs.update(tid, { active: true }).catch(() => {});
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────────────
  loadStorage(() => {
    renderBrands();
    searchInput.focus();
  });
})();
