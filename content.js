/**
 * SmartForm Filler - Content Script
 * Runs on every page. Handles form scanning, field classification, and filling.
 * Communicates with popup via chrome.runtime messaging.
 */

(() => {
  'use strict';

  // Guard against double-injection (manifest + popup's on-demand injectContentScript).
  if (window.__smartFormFillerLoaded) return;
  window.__smartFormFillerLoaded = true;

  // In-memory store for the current page's detected fields (live element references)
  let detectedFields = [];
  let lastScanTime = 0;
  // When the user clicks a per-form scan icon, that container becomes the scan target.
  let manualTarget = null;

  // Opt-in debug logging: run `localStorage.smartFormDebug = '1'` in the page console.
  function dbg(...args) {
    try { if (localStorage.getItem('smartFormDebug') === '1') console.log('[SmartForm]', ...args); } catch (_) {}
  }

  /**
   * Find the best human-readable label for a form control.
   */
  function getBestLabel(el) {
    if (!el) return 'Unnamed field';

    // 1. Explicit label[for]
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label && label.textContent.trim()) return label.textContent.trim();
    }

    // 2. aria-label (highest priority for accessibility)
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 3. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy.split(' ')[0]);
      if (labelEl && labelEl.textContent.trim()) return labelEl.textContent.trim();
    }

    // 4. Wrapping <label>
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      // Remove the input's own text/value if present
      const clone = wrappingLabel.cloneNode(true);
      const inputInClone = clone.querySelector('input,select,textarea');
      if (inputInClone) inputInClone.remove();
      const text = clone.textContent.trim();
      if (text) return text;
    }

    // 5. Nearby previous sibling that looks like a label
    let sibling = el.previousElementSibling;
    let attempts = 0;
    while (sibling && attempts < 4) {
      const txt = sibling.textContent.trim();
      if (txt.length > 2 && txt.length < 120 && !/^(input|select|button|textarea)$/i.test(sibling.tagName)) {
        // Heuristic: looks like a label if short and not another control
        if (/[a-zA-Z]/.test(txt) && !/^\d+$/.test(txt)) {
          return txt;
        }
      }
      sibling = sibling.previousElementSibling;
      attempts++;
    }

    // 6. Placeholder or name/id cleaned up
    if (el.placeholder && el.placeholder.trim().length > 2) {
      return el.placeholder.trim();
    }
    const attrName = el.name || el.id || '';
    if (attrName) {
      return attrName
        .replace(/[-_]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
    }

    return 'Field ' + (el.type || el.tagName).toLowerCase();
  }

  /**
   * Classify a field into a semantic category for heuristic matching.
   */
  function getFieldCategory(field) {
    const text = `${field.label} ${field.name} ${field.placeholder}`.toLowerCase();
    const type = (field.type || '').toLowerCase();

    // Strong signals first
    if (type === 'email' || /\bemail\b|\be-mail\b/.test(text)) return 'email';
    if (type === 'tel' || /\bphone\b|\bmobile\b|\btel\b|\bcontact.?number\b/.test(text)) return 'phone';
    if (/\bpassword\b|\bpwd\b|\bpass(word)?\b/.test(text)) return 'password';
    if (type === 'date' || /\bdob\b|\bdate.?of.?birth\b|\bbirthday\b/.test(text)) return 'dob';

    if (/\bfirst.?name\b|\bgiven.?name\b|\bfname\b/.test(text)) return 'firstName';
    if (/\blast.?name\b|\bsurname\b|\blname\b|\bfamily.?name\b/.test(text)) return 'lastName';
    if (/\bfull.?name\b|\byour.?name\b|\bname\b(?!.*(user|login|account|company))/.test(text)) return 'fullName';

    if (/\bcompany\b|\bbusiness\b|\borganisation\b|\borganization\b|\bemployer\b/.test(text)) return 'company';
    if (/\busername\b|\buser.?name\b|\blogin\b(?!.*password)/.test(text)) return 'username';

    if (/\baddress.?line.?1\b|\bstreet\b|\baddr(ess)?1?\b|\broad\b|\bline 1\b/.test(text)) return 'address1';
    if (/\baddress.?line.?2\b|\bapt\b|\bunit\b|\bsuite\b|\bline 2\b/.test(text)) return 'address2';
    if (/\bsuburb\b|\bcity\b|\btown\b/.test(text)) return 'city';
    if (/\bstate\b|\bprovince\b|\bterritory\b/.test(text)) return 'state';
    if (/\bpost.?code\b|\bzip\b|\bpostal.?code\b/.test(text)) return 'postcode';
    if (/\bcountry\b/.test(text)) return 'country';

    // Generic fallbacks
    if (type === 'textarea' || field.tagName === 'TEXTAREA') return 'genericText';
    if (type === 'number') return 'number';

    return null; // unknown -> will use fallback
  }

  /**
   * Apply a value to a form element and dispatch the right events (important for React/Vue/Angular).
   * opts.noBlur — skip the blur event (used for autocomplete inputs, where blur can
   * trigger a geocode that overwrites the manually-entered value).
   */
  function applyValueToElement(el, value, opts = {}) {
    if (!el || value === undefined || value === null) return false;

    const tag = el.tagName.toLowerCase();
    const inputType = (el.type || '').toLowerCase();

    try {
      if (tag === 'select') {
        const options = Array.from(el.options);
        // Try exact value match first
        let opt = options.find(o => o.value === value);
        if (!opt) {
          // Try text content match (case insensitive)
          opt = options.find(o => o.textContent.trim().toLowerCase() === value.toLowerCase());
        }
        if (!opt && options.length > 0) {
          // Fallback: pick first non-placeholder option
          opt = options.find(o => o.value && o.value !== '' && o.value !== '0') || options[options.length > 1 ? 1 : 0];
        }
        if (opt) {
          el.value = opt.value;
          el.selectedIndex = opt.index;
        }
      } else if (inputType === 'checkbox' || inputType === 'radio') {
        const shouldCheck = ['true', '1', 'yes', 'on', 'checked'].includes(String(value).toLowerCase());
        el.checked = shouldCheck;
      } else if (inputType === 'date' || inputType === 'datetime-local' || inputType === 'month') {
        // Assume value is already in correct format or try to normalize simple cases
        el.value = value;
      } else {
        el.value = value;
      }

      // Critical: dispatch events so frameworks pick up the change
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // Some libs also listen to blur or key events (skipped for autocomplete inputs).
      if (!opts.noBlur) el.dispatchEvent(new Event('blur', { bubbles: true }));

      return true;
    } catch (e) {
      console.warn('[SmartForm] Failed to apply value to element:', e);
      return false;
    }
  }

  /**
   * Generate a reasonable fallback value when no profile data matches the category.
   */
  function generateFallbackValue(field) {
    const cat = getFieldCategory(field);
    if (cat === 'genericText') {
      return 'Automated test entry - ' + new Date().toISOString().slice(0, 10);
    }
    if (cat === 'number') {
      return Math.floor(Math.random() * 100) + 1;
    }
    // Last resort: short label-based or placeholder
    const base = (field.label || field.placeholder || field.name || 'test').toLowerCase().replace(/\s+/g, '-');
    return base.length > 3 ? base.substring(0, 20) : 'test-value-' + Date.now().toString().slice(-4);
  }

  /**
   * Load a profile from storage, with fallback to built-in DEFAULT_PROFILES.
   * Returns the profile matching profileKey (or defaultProfile, or first profile).
   * Exposed as window.__sfLoadProfile for testing.
   */
  async function loadProfile(profileKey) {
    const F = window.SFFormData;
    let profiles = [], defaultProfile = null;
    try {
      const s = await chrome.storage.local.get(['profiles', 'defaultProfile']);
      profiles = s.profiles || []; defaultProfile = s.defaultProfile || null;
    } catch (e) { /* storage unavailable */ }
    if (!profiles.length) profiles = F.DEFAULT_PROFILES;
    const wantId = profileKey || defaultProfile || profiles[0].id;
    return profiles.find(p => p.id === wantId) || profiles[0];
  }
  window.__sfLoadProfile = loadProfile; // exported for tests

  // Fillable form controls (exclude non-data inputs).
  const FILLABLE_SELECTOR =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea';

  // Common modal / dialog / overlay containers across frameworks.
  const MODAL_SELECTOR = [
    'dialog[open]',
    '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
    '.modal.show', '.modal.in', '.modal.is-open', '.modal--open', '.modal.open',
    '.ReactModal__Content',
    '.MuiDialog-container', '.MuiModal-root',
    '.ant-modal', '.ant-modal-content',
    '.v-dialog--active',
    '.cdk-dialog-container',
    '.chakra-modal__content'
  ].join(',');

  // True visibility check — works for position:fixed modals (offsetParent is null for those).
  function isVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function isFillableControl(el) {
    return !!(el && el.matches && el.matches(FILLABLE_SELECTOR));
  }

  function hasVisibleControls(root) {
    const els = root.querySelectorAll(FILLABLE_SELECTOR);
    for (const el of els) {
      if (isVisible(el) && !el.disabled) return true;
    }
    return false;
  }

  // Don't fill site/product search boxes during page-wide scans.
  function isSearchField(el) {
    // ARIA comboboxes (vue-select, react-select, etc.) render their input as
    // type="search" but are option pickers — NOT free-text site search.
    if (el.getAttribute('aria-autocomplete') || el.getAttribute('aria-controls') ||
        el.getAttribute('role') === 'combobox' ||
        (el.className && typeof el.className === 'string' &&
         /\b(vs__search|select__input|select-search|multiselect)\b/.test(el.className))) {
      return false;
    }
    if ((el.type || '').toLowerCase() === 'search') return true;
    const hay = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    if (/\bsearch\b/.test(hay)) return true;
    return !!el.closest('[role="search"], form[role="search"], .search, .searchbar, .search-bar, .search-box');
  }

  // Nearest ancestor with an explicit z-index (used to pick the topmost modal).
  function effectiveZIndex(el) {
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      const v = parseInt(getComputedStyle(node).zIndex, 10);
      if (!isNaN(v)) return v;
      node = node.parentElement;
    }
    return 0;
  }

  // The modal/dialog the user is actually working in, if any.
  function findActiveModal() {
    // 1. A modal that contains the currently focused element wins.
    const active = document.activeElement;
    if (active && active !== document.body) {
      const owning = active.closest(MODAL_SELECTOR);
      if (owning && isVisible(owning) && hasVisibleControls(owning)) return owning;
    }
    // 2. Otherwise, the topmost visible modal that has fillable controls.
    const candidates = Array.from(document.querySelectorAll(MODAL_SELECTOR))
      .filter(m => isVisible(m) && hasVisibleControls(m));
    if (!candidates.length) return null;
    candidates.sort((a, b) => effectiveZIndex(a) - effectiveZIndex(b));
    return candidates[candidates.length - 1];
  }

  // Best-effort human name for a modal, for user feedback.
  function modalName(modal) {
    const byAria = modal.getAttribute('aria-label');
    if (byAria && byAria.trim()) return byAria.trim().slice(0, 60);
    const labelledById = modal.getAttribute('aria-labelledby');
    if (labelledById) {
      const lab = document.getElementById(labelledById.split(' ')[0]);
      if (lab && lab.textContent.trim()) return lab.textContent.trim().slice(0, 60);
    }
    const heading = modal.querySelector('h1, h2, h3, .modal-title, [class*="title" i], header');
    if (heading && heading.textContent.trim()) return heading.textContent.trim().slice(0, 60);
    return 'dialog';
  }

  // Decide what to scan: a user-picked form, a focused modal, the focused form, or the whole page.
  function findScanRoot() {
    // 1. A form/modal the user explicitly targeted via its scan icon.
    if (manualTarget && manualTarget.isConnected && isVisible(manualTarget) && hasVisibleControls(manualTarget)) {
      const name = manualTarget.matches('form') ? 'selected form' : modalName(manualTarget);
      return { root: manualTarget, scoped: true, name };
    }
    manualTarget = null; // stale (e.g. modal closed) — fall back to auto-detection

    const modal = findActiveModal();
    if (modal) return { root: modal, scoped: true, name: modalName(modal) };

    const active = document.activeElement;
    if (active && active !== document.body && isFillableControl(active)) {
      // Scope to the whole form section the focused field belongs to.
      const section = sectionForField(active);
      if (section && hasVisibleControls(section)) {
        const name = section.matches('form') ? 'selected form' : modalName(section);
        return { root: section, scoped: true, name };
      }
      const form = active.closest('form');
      if (form && hasVisibleControls(form)) return { root: form, scoped: true, name: 'focused form' };
    }
    return { root: document, scoped: false, name: 'page' };
  }

  /**
   * Main scan function. Populates detectedFields and returns a summary.
   * Prefers a focused modal/overlay form over the rest of the page.
   */
  function scanForms() {
    detectedFields = [];
    const { root, scoped, name } = findScanRoot();

    let controls;
    if (scoped) {
      // Modal or focused form — scan everything inside it (modals often lack <form>).
      controls = Array.from(root.querySelectorAll(FILLABLE_SELECTOR));
    } else {
      // Page-wide: scan every fillable control (incl. div-based forms not in a <form>).
      controls = Array.from(document.querySelectorAll(FILLABLE_SELECTOR));
    }

    controls.forEach((el, idx) => {
      if (!isVisible(el) || el.disabled || el.readOnly) return;
      if (isSearchField(el)) return; // never fill product/site search boxes
      const label = getBestLabel(el);
      detectedFields.push({
        element: el,
        label,
        name: el.name || el.id || '',
        type: el.type || el.tagName.toLowerCase(),
        placeholder: el.placeholder || '',
        formIndex: 0,
        fieldIndex: idx
      });
    });

    lastScanTime = Date.now();
    return {
      success: true,
      fieldCount: detectedFields.length,
      formCount: scoped ? 1 : (document.querySelectorAll('form').length || (detectedFields.length > 0 ? 1 : 0)),
      scoped,
      scopeName: name,
      fields: detectedFields.map((f, i) => ({
        index: i,
        label: f.label,
        name: f.name,
        type: f.type,
        placeholder: f.placeholder
      })),
      pageTitle: document.title,
      url: location.href
    };
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Is a control currently empty (and therefore needs filling)? A <select> whose
  // dependency reset its options reverts to an empty/placeholder value — that counts.
  function isEmptyValue(el) {
    if (el.tagName.toLowerCase() === 'select') {
      if (el.selectedIndex < 0) return true;
      const v = (el.value || '').trim();
      if (v === '') return true;
      const opt = el.options[el.selectedIndex];
      if (opt && /^(select|choose|please|--|none|—)\b/i.test(opt.textContent.trim())) return true;
      return false;
    }
    return (el.value || '').trim() === '';
  }

  // How to treat a checkbox. "Same as billing/shipping" toggles must be left alone so
  // we don't deselect them and expose an extra address section; consent boxes get checked;
  // everything else is left at its default rather than blindly unchecked.
  function checkboxPolicy(field) {
    const t = `${field.label} ${field.name} ${field.placeholder}`.toLowerCase();
    if (/same\s*as|copy\s*(from|to)?\s*(billing|shipping|postal|delivery)|(billing|shipping|delivery)\s*(address)?\s*same|use\s*(my\s*)?(billing|shipping)/.test(t)) {
      return 'leave';
    }
    if (/\bagree\b|\baccept\b|\bconsent\b|terms|privacy|conditions|\bt&?cs?\b|i confirm|acknowledge/.test(t)) {
      return 'check';
    }
    return 'leave';
  }

  function valueForField(field, category, profile, allow) {
    if (category && profile[category] !== undefined && profile[category] !== '') return profile[category];
    if (category === 'password') return profile.password || 'DevTest2026!';
    if (category === 'genericText') return profile.genericText || 'Test data for development form.';
    if (allow) return null; // group mode: don't invent fallback values
    return generateFallbackValue(field);
  }

  // Inputs bound to Google Places (or similar) autocomplete. Filling these pops a
  // prediction dropdown; we want the form's "manual entry" path instead.
  const AUTOCOMPLETE_INPUT_SELECTOR =
    '.pac-target-input, input[role="combobox"], input[aria-autocomplete="list"], input[aria-autocomplete="both"]';
  function isAutocompleteInput(el) {
    return !!(el && el.matches && el.matches(AUTOCOMPLETE_INPUT_SELECTOR));
  }

  // Force-hide Places prediction dropdowns (.pac-container) for the duration of a
  // fill, using inline !important so it beats the library's own inline display.
  // Returns a disposer.
  function suppressPlacesDropdown() {
    if (!document.querySelector('.pac-container, ' + AUTOCOMPLETE_INPUT_SELECTOR)) return null;
    const hide = () => document.querySelectorAll('.pac-container')
      .forEach(c => c.style.setProperty('display', 'none', 'important'));
    hide();
    let obs = null;
    try {
      obs = new MutationObserver(hide);
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    return () => {
      if (obs) obs.disconnect();
      // Hand control back to the library so real user typing still shows predictions.
      document.querySelectorAll('.pac-container').forEach(c => c.style.removeProperty('display'));
    };
  }

  // Find the next focusable control after `el` in document order.
  function nextFocusable(el) {
    const all = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]'))
      .filter(n => isVisible(n) && !n.disabled && n.tabIndex >= 0);
    const i = all.indexOf(el);
    return (i >= 0 && i + 1 < all.length) ? all[i + 1] : null;
  }

  // Close the autocomplete popup the way a user does: focus the field, then Tab to
  // the next field. Moving focus dismisses the dropdown without selecting a prediction.
  function dismissAutocomplete(el) {
    try {
      el.focus();
      const tab = { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true };
      el.dispatchEvent(new KeyboardEvent('keydown', tab));
      const next = nextFocusable(el);
      if (next) next.focus(); else el.blur();
      el.dispatchEvent(new KeyboardEvent('keyup', tab));
    } catch (_) {}
  }

  // Restore any text field a stray geocode may have overwritten back to our value.
  function reassertValues(intended) {
    intended.forEach((val, el) => {
      if (!el || !el.isConnected) return;
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      if (tag === 'select' || type === 'checkbox' || type === 'radio') return;
      if ((el.value || '') !== String(val)) {
        applyValueToElement(el, val, { noBlur: isAutocompleteInput(el) });
      }
    });
  }

  // --- ARIA option-list comboboxes (country/region, state/territory) ---
  // These are an <input aria-autocomplete="list" aria-controls="…"> backed by a
  // popup list of options. They can't be filled by setting .value — we must open
  // the list and click the matching option.

  // Abbreviation <-> full-name aliases so we match option text regardless of which
  // form the option list uses vs. what the profile stores.
  const VALUE_ALIASES = {
    qld: ['queensland'], nsw: ['new south wales'], vic: ['victoria'], sa: ['south australia'],
    wa: ['western australia'], tas: ['tasmania'], act: ['australian capital territory'], nt: ['northern territory'],
    ca: ['california'], ny: ['new york'], tx: ['texas'],
    australia: ['au', 'aus'], 'united states': ['us', 'usa', 'united states of america']
  };
  function valueCandidates(value) {
    const v = String(value);
    return [v, ...(VALUE_ALIASES[v.toLowerCase()] || [])];
  }

  // Set an input's value so a React/Vue value-tracker registers the change.
  function setInputValue(el, value) {
    try {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    } catch (_) { el.value = value; }
  }

  // An ARIA combobox backed by a discrete option list (not a free-text address line).
  function isOptionListCombobox(field, el) {
    const cat = getFieldCategory(field);
    if (cat === 'address1' || cat === 'address2') return false;
    if (cat === 'country' || cat === 'state') return true;
    return !!(el.getAttribute('aria-controls') || el.getAttribute('aria-owns'));
  }

  // Collect the visible option elements from the listbox an input controls.
  function comboboxOptions(input) {
    const id = (input.getAttribute('aria-controls') || input.getAttribute('aria-owns') || '').split(' ')[0];
    let box = id ? document.getElementById(id) : null;
    if (!box) box = Array.from(document.querySelectorAll('[role="listbox"]')).find(isVisible) || null;
    if (!box) { dbg('combobox: no listbox found (aria-controls=', id, ', visible [role=listbox] count=', document.querySelectorAll('[role="listbox"]').length, ')'); return []; }
    let opts = Array.from(box.querySelectorAll('[role="option"]'));
    if (!opts.length) opts = Array.from(box.querySelectorAll('li, [class*="option" i]'));
    const visible = opts.filter(isVisible);
    dbg('combobox: listbox', box.id || box.className, '| raw opts:', opts.length, '| visible opts:', visible.length,
        '| first:', opts[0] ? opts[0].textContent.trim().slice(0, 30) : '-');
    return visible;
  }

  function clickOption(opt) {
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => {
      try { opt.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    });
  }

  // Fill an option-list combobox: open it (focus shows the list), find the option
  // matching the value (abbreviation/full-name aware), and click it. Falls back to
  // typing each candidate to filter the list, then clicking.
  async function fillComboboxList(input, value) {
    const cands = valueCandidates(value).map(s => s.toLowerCase());

    // Open the popup: focus (many widgets open on focus), plus a full click sequence
    // (others open on click) and ArrowDown (keyboard-driven widgets).
    const openList = () => {
      try { input.focus(); } catch (_) {}
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(t => {
        try { input.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
      });
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
    };
    const tryPick = () => {
      const opts = comboboxOptions(input);
      if (!opts.length) return false;
      let match = null;
      for (const c of cands) { match = opts.find(o => o.textContent.trim().toLowerCase() === c); if (match) break; }
      if (!match) {
        for (const c of cands) {
          if (c.length < 2) continue;
          match = opts.find(o => o.textContent.trim().toLowerCase().includes(c));
          if (match) break;
        }
      }
      dbg('combobox', JSON.stringify(value), '→ options:', opts.length, '| match:', match ? match.textContent.trim() : 'NONE');
      if (!match) return false;
      clickOption(match);
      return true;
    };

    // Open and poll for options (they often render asynchronously).
    openList();
    for (let i = 0; i < 8; i++) { if (tryPick()) return true; await sleep(70); }

    // Type each candidate to filter the list, then poll again.
    for (const c of valueCandidates(value)) {
      setInputValue(input, c);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: c.slice(-1) || 'a', bubbles: true }));
      for (let i = 0; i < 6; i++) { if (tryPick()) return true; await sleep(70); }
    }
    dbg('combobox', JSON.stringify(value), '→ no option matched');
    return false;
  }

  /**
   * Fill using a named profile (heuristic matching).
   * opts.categories — only fill fields in these categories (subset fill).
   * opts.unique      — generate unique identity values for repeated testing.
   *
   * Iterative: after each pass the form may react (country→state options change, a
   * checkbox exposes a new address section). We re-scan and fill the newly exposed /
   * reset fields until the form stabilises.
   *
   * Address autocomplete: Places dropdowns are suppressed, the autocomplete-bound
   * line is filled LAST and immediately dismissed (Escape + blur), and values are
   * re-asserted afterwards — replicating the form's manual address-entry path.
   */
  async function fillWithProfile(profileKey, opts = {}) {
    const F = window.SFFormData;
    const profile = await loadProfile(profileKey);

    // AI-powered path: active when SFAIDetector + SFFormRegistry are both loaded
    if (window.SFAIDetector && window.SFFormRegistry) {
      try {
        return await _fillWithAI(profile, opts, F);
      } catch (e) {
        dbg('AI fill error, falling back to heuristics:', e);
        // Fall through to original heuristic path below
      }
    }

    // Original heuristic path (unchanged)
    scanForms();
    if (!detectedFields.length) {
      return { success: false, message: 'No fillable fields detected on page.' };
    }
    dbg('fill: detected fields →', detectedFields.map(f =>
      `${f.label || f.name || f.type}[${getFieldCategory(f) || '?'}${isAutocompleteInput(f.element) ? ',auto' : ''}]`).join('  '));

    const values = F.resolveValues(profile, (opts && opts.only) || null);

    const handled = new Set();
    const intended = new Map(); // el -> value we set (to restore after blur-geocode)
    let filledCount = 0;
    const MAX_PASSES = 5;
    const unsuppress = suppressPlacesDropdown();

    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        scanForms(); // pick up fields exposed/changed by the previous pass
        let changed = 0;

        // Fill autocomplete-bound inputs (address line) LAST so nothing it does can
        // clobber the other fields.
        const ordered = detectedFields.slice()
          .sort((a, b) => (isAutocompleteInput(a.element) ? 1 : 0) - (isAutocompleteInput(b.element) ? 1 : 0));

        for (const field of ordered) {
          const el = field.element;
          if (!el || !el.isConnected) continue;

          const type = (el.type || '').toLowerCase();
          const isSelect = el.tagName.toLowerCase() === 'select';
          const category = getFieldCategory(field);

          // Skip fields gated out by policy/override
          if (!(category in values)) continue;

          // Already done — only revisit a <select> a dependency reset to empty.
          if (handled.has(el) && !(isSelect && isEmptyValue(el))) continue;

          if (type === 'checkbox' || type === 'radio') {
            const policy = type === 'checkbox' ? checkboxPolicy(field) : 'leave';
            if (policy === 'check' && !el.checked && applyValueToElement(el, 'true')) {
              changed++; filledCount++;
            }
            handled.add(el); // leave "same as billing" and others untouched
            continue;
          }

          // Don't overwrite a field the user/form already populated (idempotent re-passes).
          if (handled.has(el) && !isEmptyValue(el)) { continue; }

          const value = values[category];
          if (value === null || value === undefined) continue;

          const isAuto = isAutocompleteInput(el);

          // ARIA option-list combobox (country/region, state/territory): open the
          // list and click the matching option — setting .value does nothing here.
          if (isAuto) {
            const optionCombo = isOptionListCombobox(field, el);
            dbg('field', JSON.stringify(field.label), '| category:', category, '| autocomplete: yes | optionList:', optionCombo, '| value:', JSON.stringify(value),
                '| aria-controls:', el.getAttribute('aria-controls'));
            if (optionCombo) {
              if (await fillComboboxList(el, value)) { changed++; filledCount++; }
              handled.add(el);
              continue;
            }
          }

          if (applyValueToElement(el, value, { noBlur: isAuto })) {
            changed++; filledCount++;
            intended.set(el, value);
            // Free-text autocomplete (address line): dismiss so no prediction is selected.
            if (isAuto) dismissAutocomplete(el);
          }
          handled.add(el);
        }

        if (changed === 0) break;     // form has stabilised
        await sleep(60);              // let frameworks (React/Vue) apply dependent changes
      }

      // Safety net: restore any field a blur-geocode may have overwritten.
      reassertValues(intended);
    } finally {
      if (unsuppress) { await sleep(150); unsuppress(); }
    }

    return {
      success: true,
      filledCount,
      profileUsed: profile.name || profileKey,
      message: `Filled ${filledCount} fields using ${profile.name || profileKey}`
    };
  }

  // Clear the currently detected fields; returns a summary.
  function clearDetected() {
    let n = 0;
    detectedFields.forEach(f => {
      if (!f.element) return;
      try {
        if (f.element.type === 'checkbox' || f.element.type === 'radio') f.element.checked = false;
        else f.element.value = '';
        f.element.dispatchEvent(new Event('input', { bubbles: true }));
        f.element.dispatchEvent(new Event('change', { bubbles: true }));
        n++;
      } catch (_) {}
    });
    return { success: true, filledCount: n, message: `Cleared ${n} fields` };
  }

  // Accessor for the MENU_ONLY mapping (exposes menu key -> field categories).
  function __sfMenuOnlyFor(key) { return window.SFFormData.MENU_ONLY[key]; }
  window.__sfMenuOnlyFor = __sfMenuOnlyFor;

  /**
   * Fill using an explicit map of {index: value} provided (usually from AI).
   */
  function fillWithValueMap(valueMap) {
    if (!detectedFields.length) {
      return { success: false, message: 'No fields in memory. Please scan first.' };
    }
    if (!valueMap || typeof valueMap !== 'object') {
      return { success: false, message: 'Invalid value map from AI.' };
    }

    let filledCount = 0;
    Object.keys(valueMap).forEach((key) => {
      const idx = parseInt(key, 10);
      if (isNaN(idx) || !detectedFields[idx]) return;
      const value = valueMap[key];
      if (applyValueToElement(detectedFields[idx].element, value)) {
        filledCount++;
      }
    });

    return {
      success: true,
      filledCount,
      message: `AI-assisted fill completed for ${filledCount} fields.`
    };
  }

  // ============================================================
  // AI-powered capture + fill (Task 4)
  // ============================================================

  /**
   * Read current form values from all named inputs on the page.
   * Returns a flat { name: value } map.
   */
  function readFormValuesFromPage() {
    const values = {};
    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      const key = el.name || el.id;
      if (!key) return;
      const t = (el.type || '').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image' || t === 'hidden') return;
      values[key] = (t === 'checkbox' || t === 'radio') ? el.checked : el.value;
    });
    return values;
  }

  /** Load the currently-active profile (defaultProfile or first). */
  function getActiveProfile() { return loadProfile(null); }

  /** Compute origin+pathname without requiring SFFormRegistry. */
  function _localURLPattern(url) {
    try { const p = new URL(url); return p.origin + p.pathname; } catch (_) { return url || ''; }
  }

  /**
   * Determine what value to fill for a single AI-detected field.
   *
   * Priority:
   *   1. Form-specific profile field config  (mode: pinned | generated | empty | excluded)
   *   2. Standard canonical field            → look up in pre-resolved standardValues
   *   3. Custom / unknown field              → call SFAIDetector.generateCustomFieldValue
   *
   * @param {object} field          AI-detected field { htmlName, detectedType, ... }
   * @param {object} profile        Active profile (generic or form-specific)
   * @param {object} opts           Fill options (opts.only for group filter)
   * @param {object} standardValues Pre-resolved values from F.resolveValues()
   * @returns {Promise<any>}        Value to fill, or undefined to skip the field
   */
  async function resolveFieldValue(field, profile, opts, standardValues) {
    const F          = window.SFFormData;
    const htmlName   = field.htmlName || field.name || '';
    const detectedType = (field.detectedType || '').toLowerCase();

    // ── Form-specific profile: per-field config (fields array) ──────────────
    if (profile && Array.isArray(profile.fields) && profile.fields.length) {
      const fieldConfig = profile.fields.find(function (f) { return f.htmlName === htmlName; });
      if (fieldConfig) {
        // Transient only-filter applies even to form-specific fields
        if (opts && opts.only && detectedType && detectedType !== 'custom') {
          const group = F.groupForField(detectedType);
          if (group && opts.only.indexOf(group) === -1) return undefined;
        }
        if (fieldConfig.mode === 'pinned')    return fieldConfig.value;
        if (fieldConfig.mode === 'generated') {
          return window.SFAIDetector
            ? await window.SFAIDetector.generateCustomFieldValue(field)
            : undefined;
        }
        return undefined; // empty | excluded | unknown mode → skip
      }
    }

    // ── Standard canonical field → standardValues (policy + only pre-applied) ─
    if (detectedType && detectedType !== 'custom') {
      const engineKey = F && F.CANONICAL_TO_ENGINE && F.CANONICAL_TO_ENGINE[detectedType];
      if (engineKey) {
        return (standardValues && standardValues[engineKey] !== undefined)
          ? standardValues[engineKey]
          : undefined;
      }
    }

    // ── Custom / unknown field → AI generation ──────────────────────────────
    if (window.SFAIDetector) {
      return await window.SFAIDetector.generateCustomFieldValue(field);
    }
    return undefined;
  }

  /**
   * Apply a { htmlName: value } map to DOM elements.
   * Used by the AI-powered fill path; simpler than the multi-pass heuristic fill.
   *
   * @param {object} valuesToFill
   * @returns {number} Number of fields successfully filled
   */
  async function fillFormWithValues(valuesToFill) {
    let filledCount = 0;
    const keys = Object.keys(valuesToFill || {});
    for (let i = 0; i < keys.length; i++) {
      const htmlName = keys[i];
      const value    = valuesToFill[htmlName];
      if (value === undefined || value === null) continue;
      let el = null;
      try {
        el = document.querySelector('[name="' + htmlName.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]')
          || document.getElementById(htmlName);
      } catch (_) {}
      if (!el) continue;
      if (applyValueToElement(el, value)) filledCount++;
    }
    return filledCount;
  }

  /**
   * AI-powered fill — resolves values for every AI-detected field and writes them to the DOM.
   * Called from fillWithProfile when SFAIDetector + SFFormRegistry are loaded.
   */
  async function _fillWithAI(loadedProfile, opts, F) {
    // Collect all fillable controls (no visibility check so JSDOM tests work too)
    const allControls = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
      ':not([type="reset"]):not([type="image"]), select, textarea'
    )).filter(function (el) { return !!(el.name || el.id); });

    if (!allControls.length) {
      return { success: false, message: 'No fillable fields detected on page.' };
    }

    const fieldsForAI = allControls.map(function (el) {
      return {
        name:        el.name || el.id || '',
        type:        el.type || el.tagName.toLowerCase(),
        label:       getBestLabel(el),
        ariaLabel:   (el.getAttribute && el.getAttribute('aria-label')) || '',
        placeholder: el.placeholder || ''
      };
    });

    // AI classification (may return a cached result)
    const aiResult = await window.SFAIDetector.detectFormFields({
      fields: fieldsForAI,
      url:    location.href
    });

    // Look for a previously-captured form-specific profile for this URL + form
    const urlPattern         = window.SFFormRegistry.computeURLPattern(location.href);
    const formSpecificProfile = await window.SFFormRegistry.findFormSpecificProfile(
      urlPattern, aiResult.formSignature
    );
    const activeProfile = formSpecificProfile || loadedProfile;

    // Pre-resolve standard values (policy + transient only-filter already applied)
    const standardValues = F.resolveValues(activeProfile, (opts && opts.only) || null);

    // Resolve value for each AI-detected field
    const valuesToFill = {};
    for (let i = 0; i < aiResult.fields.length; i++) {
      const aiField = aiResult.fields[i];
      const value   = await resolveFieldValue(aiField, activeProfile, opts, standardValues);
      const key     = aiField.htmlName || aiField.name || '';
      if (key && value !== undefined) valuesToFill[key] = value;
    }

    const filledCount = await fillFormWithValues(valuesToFill);
    return {
      success:     true,
      filledCount,
      profileUsed: activeProfile.label || activeProfile.id,
      message:     'Filled ' + filledCount + ' fields using ' + (activeProfile.label || activeProfile.id)
    };
  }

  /**
   * Capture the current form as a form-specific profile.
   *
   * Safe fields are pinned to their current DOM values.
   * High-risk fields (isSafe: false) are captured but marked 'excluded'.
   * The profile is upserted into chrome.storage.local.
   *
   * options (all bypass real I/O — used in tests):
   *   mockDetectedFields  — pre-built { fields, formSignature }
   *   mockReadFormValues  — pre-built { name: value } map
   *   mockActiveProfile   — profile to inherit country/policy/pins from
   *   pageTitle           — override document.title
   *
   * @returns {Promise<object>} The saved form-specific profile
   */
  async function sfCaptureFormAsProfile(options) {
    options = options || {};

    // 1. AI-detected fields
    let detectedResult;
    if (options.mockDetectedFields) {
      detectedResult = options.mockDetectedFields;
    } else if (window.SFAIDetector) {
      scanForms();
      const scannedForAI = detectedFields.map(function (f) {
        return {
          name:        f.name,
          type:        f.type,
          label:       f.label,
          ariaLabel:   (f.element && f.element.getAttribute) ? (f.element.getAttribute('aria-label') || '') : '',
          placeholder: f.placeholder || ''
        };
      });
      detectedResult = await window.SFAIDetector.detectFormFields({ fields: scannedForAI, url: location.href });
    } else {
      return null; // AI detector required for capture
    }

    const aiFields      = detectedResult.fields       || [];
    const formSignature = detectedResult.formSignature || 'unknown';

    // 2. Current form values (for pinning)
    const formValues = (options.mockReadFormValues !== undefined)
      ? options.mockReadFormValues
      : readFormValuesFromPage();

    // 3. Inherit country / policy / pins from active profile
    const activeProfile = (options.mockActiveProfile !== undefined)
      ? options.mockActiveProfile
      : await getActiveProfile();

    // 4. URL pattern
    const urlPattern = (window.SFFormRegistry && window.SFFormRegistry.computeURLPattern)
      ? window.SFFormRegistry.computeURLPattern(location.href)
      : _localURLPattern(location.href);

    // 5. Build the fields array
    const capturedFields = aiFields.map(function (f) {
      const key = f.htmlName || f.name || '';
      if (!f.isSafe) {
        return { htmlName: key, detectedType: f.detectedType || '', mode: 'excluded' };
      }
      const currentValue = (formValues && formValues[key] !== undefined) ? formValues[key] : '';
      return { htmlName: key, detectedType: f.detectedType || '', mode: 'pinned', value: currentValue };
    });

    // 6. Compose the form-specific profile
    const pageTitle   = options.pageTitle || (typeof document !== 'undefined' && document.title) || 'Form';
    const profileId   = 'form-' + formSignature;
    const formProfile = {
      id:    profileId,
      label: pageTitle + ' (captured)',
      country: (activeProfile && activeProfile.country) || 'AU',
      policy:  (activeProfile && activeProfile.policy)  || { groups: { name: true, contact: true, address: true, account: true, misc: true }, exclude: [] },
      pins:    (activeProfile && activeProfile.pins)    || {},
      fields:  capturedFields,
      formMetadata: {
        urlPattern:    urlPattern,
        formSignature: formSignature,
        capturedAt:    Date.now()
      }
    };

    // 7. Upsert into chrome.storage.local
    try {
      const stored   = await chrome.storage.local.get('profiles');
      const profiles = Array.isArray(stored.profiles) ? stored.profiles.slice() : [];
      const idx      = profiles.findIndex(function (p) { return p.id === profileId; });
      if (idx >= 0) profiles[idx] = formProfile; else profiles.push(formProfile);
      await chrome.storage.local.set({ profiles: profiles });
    } catch (_) { /* storage unavailable */ }

    // 8. User confirmation
    try { alert('Form captured: ' + formProfile.label); } catch (_) {}

    return formProfile;
  }

  window.__sfFillWithProfile      = fillWithProfile;        // exposed for tests
  window.__sfCaptureFormAsProfile = sfCaptureFormAsProfile; // exposed for tests + popup

  // ============================================================
  // Per-form scan icons — let the user target a specific form/modal
  // on pages with multiple forms.
  // ============================================================
  const SF_UI_ATTR = 'data-smartform-ui';
  let formButtons = [];          // { btn, target }
  let toastEl = null, toastTimer = null;
  let repositionScheduled = false;
  let buildScheduled = false;

  // All visible, fillable, non-search controls on the page.
  function liveControls() {
    return Array.from(document.querySelectorAll(FILLABLE_SELECTOR))
      .filter(el => isVisible(el) && !el.disabled && !el.readOnly && !isSearchField(el));
  }

  // Lowest common ancestor of a set of elements.
  function commonAncestor(els) {
    if (!els.length) return null;
    let anc = els[0];
    for (let i = 1; i < els.length && anc; i++) {
      while (anc && !anc.contains(els[i])) anc = anc.parentElement;
    }
    return anc;
  }

  // Tighten a section to the innermost single element that still contains ALL of
  // its fields — avoids placing the icon on an oversized wrapper, without splitting.
  function refineSection(el, fields) {
    const inEl = fields.filter(f => el.contains(f));
    let node = el;
    while (true) {
      const holder = Array.from(node.children)
        .find(c => c.nodeType === 1 && inEl.every(f => c.contains(f)));
      if (holder && holder !== node) node = holder; else break;
    }
    return node;
  }

  // Determine the main visible section(s) that contain forms — one per form region.
  // The whole form (across sub-divs and even multiple <form> tags) collapses to the
  // single common-ancestor container, so a form yields ONE icon. If fields live in
  // genuinely separate top-level areas, each area becomes its own section.
  function formSections() {
    const fields = liveControls(); // visible, fillable, non-search
    if (fields.length < 2) return [];

    const lca = commonAncestor(fields);
    if (!lca) return [];

    // All fields share one container → that's the main form section.
    if (lca !== document.body && lca !== document.documentElement) {
      return [refineSection(lca, fields)];
    }

    // Fields span multiple top-level branches → one section per branch that has fields.
    const sections = [];
    const seen = new Set();
    fields.forEach(f => {
      let node = f;
      while (node.parentElement &&
             node.parentElement !== document.body &&
             node.parentElement !== document.documentElement) {
        node = node.parentElement;
      }
      if (node && node.nodeType === 1 && isVisible(node) && !seen.has(node)) {
        seen.add(node);
        sections.push(refineSection(node, fields));
      }
    });
    return sections;
  }

  // The form section that contains a given field (for focused-field auto-scan).
  function sectionForField(el) {
    return formSections().find(s => s.contains(el)) || null;
  }

  function getIconTargets() {
    return formSections();
  }

  function createScanButton(target) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(SF_UI_ATTR, '');
    btn.title = 'Scan this form with SmartForm Filler';
    btn.textContent = '✨';
    Object.assign(btn.style, {
      position: 'fixed', zIndex: '2147483646', width: '28px', height: '28px',
      borderRadius: '50%', border: 'none', cursor: 'pointer', padding: '0',
      background: '#2563eb', color: '#fff', fontSize: '15px', lineHeight: '28px',
      textAlign: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', display: 'none'
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onScanIconClick(target, btn);
    });
    return btn;
  }

  let fillMenu = null;

  function onScanIconClick(target, btn) {
    manualTarget = target;
    const result = scanForms(); // scopes to manualTarget and stores live field refs
    flashButton(btn, result.fieldCount);
    if (!result.fieldCount) {
      showToast('No fillable fields found in this form');
      return;
    }
    showFillMenu(btn, result).catch(err => {
      console.warn('[SmartForm] Menu display error:', err);
      showToast('Error displaying menu');
    });
  }

  function closeFillMenu() {
    if (fillMenu) { fillMenu.remove(); fillMenu = null; }
    document.removeEventListener('click', onDocClickForMenu, true);
  }

  function onDocClickForMenu(e) {
    if (fillMenu && !fillMenu.contains(e.target) && !e.target.hasAttribute(SF_UI_ATTR)) closeFillMenu();
  }

  // Inline menu offering Name / Address / All / Clear, scoped to the clicked form.
  async function showFillMenu(anchorBtn, scanResult) {
    closeFillMenu();
    const { profiles = [], defaultProfile = null } =
      await chrome.storage.local.get(['profiles', 'defaultProfile']);
    const list = profiles.length ? profiles : window.SFFormData.DEFAULT_PROFILES;
    const menu = window.SFProfileUI.buildMenu(document, list, defaultProfile);
    const profileSel = menu.querySelector('select[data-role="profile"]');

    // Wrap the menu contents in a styled container
    fillMenu = document.createElement('div');
    fillMenu.setAttribute(SF_UI_ATTR, '');
    Object.assign(fillMenu.style, {
      position: 'fixed', zIndex: '2147483647', background: '#ffffff', color: '#0f172a',
      border: '1px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 10px 25px rgba(0,0,0,0.22)',
      padding: '6px', minWidth: '200px', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px'
    });

    const header = document.createElement('div');
    header.textContent = `${scanResult.fieldCount} field${scanResult.fieldCount === 1 ? '' : 's'} • ${scanResult.scopeName}`;
    Object.assign(header.style, { fontSize: '11px', color: '#64748b', padding: '4px 8px 6px', fontWeight: '600' });
    fillMenu.appendChild(header);

    // Style and wire menu elements from SFProfileUI.buildMenu
    Array.from(menu.children).forEach(el => {
      if (el.tagName === 'BUTTON') {
        el.setAttribute(SF_UI_ATTR, '');
        Object.assign(el.style, {
          display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
          padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: '#0f172a'
        });
        el.addEventListener('mouseenter', () => { el.style.background = '#f1f5f9'; });
        el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });

        if (el.hasAttribute('data-only')) {
          el.addEventListener('click', (e) => { e.stopPropagation(); runMenuAction(__sfMenuOnlyFor(el.getAttribute('data-only')), profileSel.value); });
        } else if (el.hasAttribute('data-action') && el.getAttribute('data-action') === 'clear') {
          el.addEventListener('click', (e) => { e.stopPropagation(); clearDetected(); closeFillMenu(); showToast('Cleared detected fields'); });
        }
      } else if (el.tagName === 'SELECT') {
        el.setAttribute(SF_UI_ATTR, '');
        Object.assign(el.style, {
          display: 'block', width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px',
          border: '1px solid #d1d5db', fontSize: '12px', cursor: 'pointer'
        });
      }
      fillMenu.appendChild(el);
    });

    document.body.appendChild(fillMenu);

    // Position under the icon, kept on-screen.
    const r = anchorBtn.getBoundingClientRect();
    const m = fillMenu.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.right - m.width;
    if (left < 4) left = 4;
    if (top + m.height > window.innerHeight - 4) top = Math.max(4, r.top - m.height - 6);
    fillMenu.style.top = top + 'px';
    fillMenu.style.left = left + 'px';

    setTimeout(() => document.addEventListener('click', onDocClickForMenu, true), 0);
  }

  function runMenuAction(only, profileId) {
    const res = fillWithProfile(profileId, { only, unique: true });
    if (res && res.then) {
      // fillWithProfile is async
      res.then(result => {
        showToast(result && result.filledCount
          ? `Filled ${result.filledCount} field${result.filledCount === 1 ? '' : 's'} with unique test data`
          : 'No matching fields in this form');
        closeFillMenu();
      }).catch(err => {
        showToast('Error filling fields: ' + (err && err.message || 'Unknown'));
        closeFillMenu();
      });
    } else {
      // Shouldn't reach here since fillWithProfile is async
      showToast(res && res.message ? res.message : 'Fields filled');
      closeFillMenu();
    }
  }

  function flashButton(btn, count) {
    const ok = count > 0;
    btn.textContent = ok ? '✓' : '∅';
    btn.style.background = ok ? '#16a34a' : '#dc2626';
    setTimeout(() => { btn.textContent = '✨'; btn.style.background = '#2563eb'; }, 1200);
  }

  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute(SF_UI_ATTR, '');
      Object.assign(toastEl.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
        background: '#0f172a', color: '#fff', padding: '10px 14px', borderRadius: '8px',
        fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)', maxWidth: '280px', transition: 'opacity .2s'
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 3200);
  }

  function repositionButtons() {
    formButtons.forEach(({ btn, target }) => {
      if (!target.isConnected || !isVisible(target)) { btn.style.display = 'none'; return; }
      const r = target.getBoundingClientRect();
      btn.style.display = 'block';
      btn.style.top = Math.max(4, r.top + 6) + 'px';
      btn.style.left = Math.max(4, r.right - 34) + 'px';
    });
  }

  function scheduleReposition() {
    if (repositionScheduled) return;
    repositionScheduled = true;
    requestAnimationFrame(() => { repositionScheduled = false; repositionButtons(); });
  }

  function ensureScanButtons() {
    const targets = getIconTargets();
    // Drop buttons whose target is gone.
    formButtons = formButtons.filter(({ btn, target }) => {
      if (!targets.includes(target) || !target.isConnected) { btn.remove(); return false; }
      return true;
    });
    // Add buttons for new targets.
    targets.forEach(target => {
      if (formButtons.some(fb => fb.target === target)) return;
      const btn = createScanButton(target);
      document.body.appendChild(btn);
      formButtons.push({ btn, target });
    });
    repositionButtons();
  }

  function scheduleBuild() {
    if (buildScheduled) return;
    buildScheduled = true;
    setTimeout(() => { buildScheduled = false; ensureScanButtons(); }, 300);
  }

  function initFormIcons() {
    try {
      const mo = new MutationObserver(scheduleBuild);
      mo.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('scroll', scheduleReposition, true); // capture = catch inner scroll
      window.addEventListener('resize', scheduleReposition);
      scheduleBuild();
    } catch (e) {
      console.warn('[SmartForm] Form icons init failed:', e);
    }
  }

  // Listen for messages from popup / background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scan') {
      const result = scanForms();
      sendResponse(result);
      return true; // async ok but we are sync
    }

    if (msg.action === 'fillProfile') {
      fillWithProfile(msg.profileKey || 'au-personal', msg.opts || {}).then(sendResponse);
      return true; // async response
    }

    if (msg.action === 'fillWithMap') {
      const result = fillWithValueMap(msg.valueMap);
      sendResponse(result);
      return true;
    }

    if (msg.action === 'getStatus') {
      sendResponse({
        hasFields: detectedFields.length > 0,
        fieldCount: detectedFields.length,
        lastScan: lastScanTime
      });
      return true;
    }

    if (msg.action === 'clearFields') {
      sendResponse(clearDetected());
      return true;
    }

    // Unknown action
    sendResponse({ success: false, message: 'Unknown action' });
    return false;
  });

  // Add the per-form scan icons once the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFormIcons, { once: true });
  } else {
    initFormIcons();
  }

  // ============================================================
  // Capture + AI-assisted fill helpers
  // ============================================================

  /**
   * Read the current values of all named/id'd form controls on the page.
   * Returns { fieldName: value } — undefined for unchecked checkboxes/radios.
   */
  function readFormValuesFromPage() {
    const values = {};
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.name || el.id) {
        const key = el.name || el.id;
        if (el.type === 'checkbox' || el.type === 'radio') {
          values[key] = el.checked ? el.value : undefined;
        } else {
          values[key] = el.value || undefined;
        }
      }
    });
    return values;
  }

  /**
   * Load the active (default) profile from storage, falling back to built-ins.
   */
  async function getActiveProfile() {
    const data = await chrome.storage.local.get(['defaultProfile', 'profiles']);
    const profileKey = data.defaultProfile || null;
    const profiles = (data.profiles && data.profiles.length) ? data.profiles : window.SFFormData.DEFAULT_PROFILES;
    if (profileKey) {
      const found = profiles.find(p => p.id === profileKey);
      if (found) return found;
    }
    return profiles[0];
  }

  /**
   * Capture the current form state as a form-specific profile object.
   * Accepts options for test mocking:
   *   options.mockDetectedFields  — bypass SFAIDetector.detectFormFields()
   *   options.mockReadFormValues  — bypass readFormValuesFromPage()
   *   options.mockActiveProfile   — bypass getActiveProfile()
   *   options.pageTitle           — override document.title
   *
   * In production, saves the new profile to chrome.storage.local and alerts the user.
   * In test mode (mockDetectedFields present), returns the profile object directly.
   */
  window.__sfCaptureFormAsProfile = async function(options = {}) {
    if (options.mockDetectedFields) {
      // Test / mock path
      const detectedFields = options.mockDetectedFields.fields;
      const readValues = options.mockReadFormValues || {};
      const activeProfile = options.mockActiveProfile || (await getActiveProfile());
      const formUrl = (typeof window.location !== 'undefined' && window.location.href) || 'http://localhost/';
      const formSignature = options.mockDetectedFields.formSignature;
      const pageTitle = options.pageTitle || (typeof document !== 'undefined' ? document.title : '');

      let origin, pathname;
      try { const u = new URL(formUrl); origin = u.origin; pathname = u.pathname; }
      catch (_) { origin = 'http://localhost'; pathname = '/'; }

      const newProfile = {
        id: 'form-' + Date.now(),
        label: pageTitle.substring(0, 20) + ' - ' + (origin.replace(/^https?:\/\//, '') || 'localhost'),
        country: activeProfile.country,
        randomize: true,
        policy: activeProfile.policy,
        pins: activeProfile.pins,
        formMetadata: {
          urlPattern: origin + pathname,
          formSignature: formSignature,
          capturedAt: new Date().toISOString()
        },
        fields: detectedFields.map(field => ({
          key: field.detectedType,
          htmlName: field.htmlName,
          htmlType: field.htmlType,
          label: field.label || '',
          detectedType: field.detectedType,
          mode: !field.isSafe ? 'excluded' : (readValues[field.htmlName] ? 'pinned' : 'generated'),
          value: readValues[field.htmlName] || undefined,
          safetyLevel: field.isSafe ? 'low' : 'high'
        }))
      };
      return newProfile;
    }

    // Production path
    const detected = await window.SFAIDetector.detectFormFields();
    if (detected.error || !detected.fields) {
      console.warn('[SmartForm] Field detection failed:', detected.error);
      return null;
    }

    const readValues = readFormValuesFromPage();
    const activeProfile = await getActiveProfile();

    const formUrl = window.location.href;
    let origin, pathname;
    try { const u = new URL(formUrl); origin = u.origin; pathname = u.pathname; }
    catch (_) { origin = 'http://localhost'; pathname = '/'; }

    const newProfile = {
      id: 'form-' + Date.now(),
      label: document.title.substring(0, 20) + ' - ' + origin.replace(/^https?:\/\//, ''),
      country: activeProfile.country,
      randomize: true,
      policy: activeProfile.policy,
      pins: activeProfile.pins,
      formMetadata: {
        urlPattern: origin + pathname,
        formSignature: detected.formSignature,
        capturedAt: new Date().toISOString()
      },
      fields: detected.fields.map(field => ({
        key: field.detectedType,
        htmlName: field.htmlName,
        htmlType: field.htmlType,
        label: field.label || '',
        detectedType: field.detectedType,
        mode: !field.isSafe ? 'excluded' : (readValues[field.htmlName] ? 'pinned' : 'generated'),
        value: readValues[field.htmlName] || undefined,
        safetyLevel: field.isSafe ? 'low' : 'high'
      }))
    };

    // Save to storage
    const storageData = await chrome.storage.local.get(['profiles']);
    const profiles = storageData.profiles || [];
    profiles.push(newProfile);
    await chrome.storage.local.set({ profiles });

    alert('Profile captured: ' + newProfile.label + '. Edit in Options to refine.');
    return newProfile;
  };

  window.__sfResolveFieldValue = resolveFieldValue;

  /**
   * Returns true if a detectedType string is one of the canonical field keys
   * supported by SFFormData.resolveValues.
   */
  function isStandardCanonicalField(type) {
    const standard = [
      'firstname', 'lastname', 'fullname', 'username', 'email', 'phone',
      'street1', 'street2', 'city', 'state', 'zip', 'country',
      'business', 'password', 'dob', 'generictext',
      // Plan camelCase variants (content may receive these from AI detector)
      'firstName', 'lastName', 'fullName', 'street1', 'street2',
      'genericText', 'company'
    ];
    return standard.includes(type);
  }

  /**
   * Returns true if the canonical field key should be filled given the profile
   * policy and any transient `only` (group-filter) override.
   */
  function shouldFillField(canonicalKey, policy, only) {
    if (!policy) return true;
    const group = window.SFFormData.groupForField ? window.SFFormData.groupForField(canonicalKey) : null;
    if (group && policy.groups && policy.groups[group] === false) return false;
    if (policy.exclude && policy.exclude.includes(canonicalKey)) return false;
    if (only && group && !only.includes(group)) return false;
    return true;
  }

})();