/**
 * SmartForm Filler - Content Script
 * Runs on every page. Handles form scanning, field classification, and filling.
 * Communicates with popup via chrome.runtime messaging.
 */

(() => {
  'use strict';

  // An extension reload/update orphans running copies of this script (chrome.runtime.id
  // disappears); background.js then injects a fresh copy into open tabs.
  // Check the runtime this copy started with — a later copy may share this window.
  const ownRuntime = (typeof chrome !== 'undefined' && chrome.runtime) || null;
  function extensionAlive() {
    try { return !!(ownRuntime && ownRuntime.id); } catch (_) { return false; }
  }

  // Guard against double-injection (manifest + popup's on-demand injectContentScript),
  // but take over from a copy whose extension context is gone.
  if (window.__smartFormFillerLoaded && (!window.__sfIsAlive || window.__sfIsAlive())) return;
  window.__smartFormFillerLoaded = true;
  window.__sfIsAlive = extensionAlive;

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

    // 5. A <label> in the control's own group whose `for` is broken or missing —
    //    e.g. <label for="x--dob"> beside a date-picker input with id="db-input".
    let group = el.parentElement;
    for (let depth = 0; group && depth < 5 && group !== document.body; depth++, group = group.parentElement) {
      if (group.querySelectorAll(FILLABLE_SELECTOR).length > 1) break; // reached a container of several fields
      const label = Array.from(group.querySelectorAll('label')).find(l =>
        !l.contains(el) && !(l.htmlFor && document.getElementById(l.htmlFor)) && l.textContent.trim());
      if (label) return label.textContent.trim();
    }

    // 5b. A heading or caption just before the control's own wrapper, e.g.
    //     <h4>Date of Birth</h4><div class="datepicker"><input …></div>
    group = el.parentElement;
    for (let depth = 0; group && depth < 5 && group !== document.body; depth++, group = group.parentElement) {
      if (group.querySelectorAll(FILLABLE_SELECTOR).length > 1) break;
      const prev = group.previousElementSibling;
      if (!prev || prev.querySelector(FILLABLE_SELECTOR) || /^(input|select|textarea|button|script|style)$/i.test(prev.tagName)) continue;
      if (prev.tagName === 'LABEL' && prev.htmlFor && document.getElementById(prev.htmlFor)) continue;
      const txt = prev.textContent.replace(/\s+/g, ' ').trim();
      if (txt.length > 1 && txt.length < 60 && /[a-zA-Z]/.test(txt)) return txt;
    }

    // 6. Nearby previous sibling that looks like a label
    let sibling = el.previousElementSibling;
    let attempts = 0;
    while (sibling && attempts < 4) {
      // A label that precedes another control (or is bound to one) belongs to that control.
      if (/^(input|select|textarea)$/i.test(sibling.tagName)) break;
      if (sibling.tagName === 'LABEL' && sibling.htmlFor && sibling.htmlFor !== el.id) break;
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

    // 7. Placeholder or name/id cleaned up
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
   * Label of the group a control sits in (<fieldset> legend or role="group" label) —
   * the only context split controls such as Day / Month / Year selects carry.
   */
  function getGroupLabel(el) {
    const fieldset = el.closest && el.closest('fieldset');
    const legend = fieldset && fieldset.querySelector('legend');
    if (legend && legend.textContent.trim()) return legend.textContent.trim();
    const group = el.closest && el.closest('[role="group"], [role="radiogroup"]');
    if (group) {
      const aria = group.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const by = group.getAttribute('aria-labelledby');
      const byEl = by && document.getElementById(by.split(' ')[0]);
      if (byEl && byEl.textContent.trim()) return byEl.textContent.trim();
    }
    return '';
  }

  // Visible, selectable option texts of a <select> (placeholders like "Select…" dropped).
  function selectOptionTexts(el) {
    if (!el || el.tagName.toLowerCase() !== 'select') return [];
    return Array.from(el.options)
      .filter(o => !o.disabled && o.value !== '' && !/^(select|choose|please|--|none|—)\b/i.test(o.textContent.trim()))
      .map(o => o.textContent.trim());
  }

  // Elements that carry a field's description / help text (not validation errors).
  const HELP_SELECTOR = '.form-text, .help-block, .help-text, .hint, .description, .field-description, ' +
    '[class*="__hint"], [class*="__help"], [class*="-help"], [class*="helper"], [class*="description"], small';

  /**
   * All descriptive text attached to a control: aria-describedby targets, its title, and
   * help/hint/description elements in its own group (e.g. "…to confirm you are over 18"
   * under a DOB picker). Passed to the AI so values honour the stated requirements.
   */
  function getHelpText(el) {
    const parts = [];
    const add = t => { t = (t || '').replace(/\s+/g, ' ').trim(); if (t && parts.indexOf(t) === -1) parts.push(t); };
    ((el.getAttribute && el.getAttribute('aria-describedby')) || '').split(/\s+/).filter(Boolean)
      .forEach(id => { const n = document.getElementById(id); if (n) add(n.textContent); });
    if (el.title) add(el.title);
    let group = el.parentElement;
    for (let depth = 0; group && depth < 5 && group !== document.body; depth++, group = group.parentElement) {
      if (group.querySelectorAll(FILLABLE_SELECTOR).length > 1) break;
      group.querySelectorAll(HELP_SELECTOR).forEach(n => {
        if (!n.contains(el) && !/error|invalid/i.test(n.className || '')) add(n.textContent);
      });
    }
    return parts.join(' ').slice(0, 300);
  }

  /**
   * Everything the page says about a control: label, name, placeholder, group context,
   * options and constraints. Feeds both the heuristics and the AI value choice.
   */
  function describeControl(el) {
    const d = {
      name: el.name || el.id || '',
      type: el.type || el.tagName.toLowerCase(),
      label: getBestLabel(el),
      ariaLabel: (el.getAttribute && el.getAttribute('aria-label')) || '',
      placeholder: el.placeholder || '',
      context: getGroupLabel(el)
    };
    const hint = getHelpText(el);
    if (hint) d.hint = hint;
    const options = selectOptionTexts(el);
    if (options.length) d.options = options.slice(0, 40);
    if (el.maxLength > 0) d.maxLength = el.maxLength;
    ['min', 'max', 'pattern'].forEach(a => { const v = el.getAttribute && el.getAttribute(a); if (v) d[a] = v; });
    if (el.required) d.required = true;
    return d;
  }

  // Birth-date signals; run on spacedText() so "dob_day" / "birthMonth" match too.
  const BIRTH_RE = /\bdob\b|\bbirth|\bbday\b|\bd\.o\.b\b/;
  function spacedText(str) {
    return String(str || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-\[\]]+/g, ' ').toLowerCase();
  }
  // Help text such as "…to confirm you are over 18" marks a date field as a birth date.
  const ADULT_RE = /\b(over|at least|older than|aged?)\s*(the age of\s*)?1[6-9]\b/;
  function isBirthField(field) {
    const text = spacedText(`${field.label} ${field.name} ${field.placeholder} ${field.context || ''} ${field.hint || ''}`);
    return BIRTH_RE.test(text) || (ADULT_RE.test(text) && isDateLike(field));
  }

  // Wording or a placeholder format that says the control holds a date.
  const DATE_FORMAT_RE = /\b(d{1,2}|m{1,4}|y{2}(?:y{2})?)([\/\-. ])(d{1,2}|m{1,4})\2(y{2}(?:y{2})?|d{1,2})\b/i;
  function isDateLike(field, el) {
    if (/^(date|datetime-local|month)$/.test(String(field.type || '').toLowerCase())) return true;
    const text = `${field.label} ${field.placeholder} ${field.hint || ''}`;
    if (DATE_FORMAT_RE.test(text) || /\bdate\b|calendar/i.test(text)) return true;
    return !!(el && el.closest && el.closest('[class*="datepicker" i], [class*="date-picker" i], .dp-container'));
  }

  const GENDER_RE = /\bgender\b|\bsex\b/;
  function isGenderField(field) {
    return GENDER_RE.test(spacedText(`${field.label} ${field.name} ${field.placeholder} ${field.context || ''}`));
  }
  // Does an option's text/value stand for the wanted gender? 'Male' matches "M", "Man", "male";
  // other values ("Non-binary", "Prefer not to say") match by text.
  function genderOptionMatches(text, wanted) {
    const t = String(text || '').trim().toLowerCase(), w = String(wanted || '').trim().toLowerCase();
    if (!t || !w) return false;
    const kind = s => /^(m|male|man|boy|mr)$/.test(s) ? 'male' : /^(f|female|woman|girl|mrs|ms|miss)$/.test(s) ? 'female' : null;
    if (kind(t) && kind(t) === kind(w)) return true;
    return t === w || (w.length > 2 && t.indexOf(w) !== -1);
  }
  // Text a choice control stands for: its value plus its own label.
  function choiceText(el) {
    const own = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const label = own || el.closest('label');
    return [el.value, label ? label.textContent : ''];
  }
  // A gender <select> gets the option matching the profile's value (text or code).
  function genderSelectValue(el, wanted) {
    const opt = Array.from(el.options || []).find(o =>
      genderOptionMatches(o.textContent, wanted) || genderOptionMatches(o.value, wanted));
    return opt ? opt.value : null;
  }
  // Gender radio groups: tick the radio matching the profile's value. Returns the number ticked.
  function fillGenderRadios(controls, wanted) {
    if (!wanted) return 0;
    const groups = new Map();
    controls.forEach(el => {
      if ((el.type || '').toLowerCase() !== 'radio' || !el.name) return;
      if (!groups.has(el.name)) groups.set(el.name, []);
      groups.get(el.name).push(el);
    });
    let n = 0;
    groups.forEach(radios => {
      if (!radios.some(r => isGenderField(describeControl(r)))) return;
      const hit = radios.find(r => choiceText(r).some(t => genderOptionMatches(t, wanted)));
      if (hit && !hit.checked && applyValueToElement(hit, 'true')) n++;
    });
    return n;
  }

  /**
   * Which part of a date a control holds: 'day' | 'month' | 'year' | 'full'.
   * Selects are judged by their options; text inputs by their wording.
   */
  function datePartFor(el, field) {
    const type = (el.type || '').toLowerCase();
    if (type === 'date' || type === 'datetime-local' || type === 'month') return 'full';
    if (el.tagName.toLowerCase() === 'select') {
      const opts = selectOptionTexts(el);
      const months = window.SFFormData.MONTH_NAMES.map(m => m.slice(0, 3).toLowerCase());
      if (opts.some(t => months.indexOf(t.slice(0, 3).toLowerCase()) !== -1)) return 'month';
      const nums = opts.map(t => parseInt(t, 10)).filter(n => !isNaN(n));
      if (nums.length && nums.every(n => n >= 1000)) return 'year';
      if (nums.length >= 28 && Math.max(...nums) <= 31) return 'day';
      if (nums.length === 12 && Math.max(...nums) === 12) return 'month';
    }
    const text = spacedText(`${field.label} ${field.name} ${field.placeholder}`)
      .replace(/date of birth|birth ?(day|date)/g, ' ');
    const parts = [];
    if (/\b(day|dd)\b/.test(text)) parts.push('day');
    if (/\b(month|mm)\b/.test(text)) parts.push('month');
    if (/\b(year|yyyy|yy)\b/.test(text)) parts.push('year');
    return parts.length === 1 ? parts[0] : 'full';
  }

  /**
   * Format token for a full-date text input, e.g. 'DD/MM/YYYY', from its placeholder,
   * label or pattern; otherwise the profile country's convention.
   */
  function dateFormatFor(el, field, country) {
    const type = (el.type || '').toLowerCase();
    if (type === 'date') return 'YYYY-MM-DD';
    if (type === 'datetime-local') return 'YYYY-MM-DDT09:00';
    if (type === 'month') return 'YYYY-MM';
    // Date-picker wrappers often carry the format too (<div class="dp-container" placeholder="DD MMM YYYY">).
    const wrap = el.parentElement && el.parentElement.closest('[data-format], [placeholder]');
    const hint = `${field.placeholder} ${field.label} ${el.getAttribute('data-format') || ''} ` +
      (wrap ? `${wrap.getAttribute('data-format') || ''} ${wrap.getAttribute('placeholder') || ''}` : '');
    const m = DATE_FORMAT_RE.exec(hint);
    if (m) return m[0].toUpperCase();
    return country === 'US' ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
  }

  /**
   * Render an ISO date for a specific control: the right part (day / month / year) and
   * format, or for a <select> the value of the matching option. Non-ISO values pass through.
   */
  function adaptDateValue(el, field, value, country) {
    const F = window.SFFormData;
    const d = F.parseISODate(value);
    if (!d) return value;
    const part = datePartFor(el, field);
    if (el.tagName.toLowerCase() === 'select') {
      const num = part === 'day' ? d.day : part === 'month' ? d.month : d.year;
      const name = part === 'month' ? F.MONTH_NAMES[d.month - 1].toLowerCase() : '';
      const real = Array.from(el.options).filter(o => o.value !== '' && !o.disabled);
      const hit = real.find(o => {
        const t = o.textContent.trim().toLowerCase(), v = String(o.value).toLowerCase();
        if (parseInt(v, 10) === num || parseInt(t, 10) === num) return true;
        return !!name && (t === name || t === name.slice(0, 3) || v === name || v === name.slice(0, 3));
      });
      if (hit) return hit.value;
      // Year list that doesn't reach the generated year: take the closest one.
      const numeric = real.filter(o => !isNaN(parseInt(o.textContent, 10)));
      if (!numeric.length) return value;
      return numeric.reduce((best, o) =>
        Math.abs(parseInt(o.textContent, 10) - num) < Math.abs(parseInt(best.textContent, 10) - num) ? o : best
      ).value;
    }
    if (part === 'day') return F.formatDate(value, 'DD');
    if (part === 'month') return F.formatDate(value, 'MM');
    if (part === 'year') return F.formatDate(value, el.maxLength === 2 ? 'YY' : 'YYYY');
    return F.formatDate(value, dateFormatFor(el, field, country));
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
    if (isBirthField(field)) return 'dob';
    if (type === 'date') return 'date'; // a date, but not a birth date — don't fill it with a DOB
    if (isGenderField(field)) return 'gender';

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
      } else {
        // Native setter, so React/Vue value-trackers register the change.
        setInputValue(el, value);
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
        context: getGroupLabel(el),
        hint: getHelpText(el),
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

  // --- Address type-ahead (Google Places) ---
  // A Places-bound address box is filled the way a person uses it: type the profile's whole
  // address, pick the first suggestion, and let the site fill its own address lines from
  // the chosen place. Covers the classic widget (input.pac-target-input + .pac-container)
  // and the newer <gmp-place-autocomplete> element (closed shadow root).
  const PLACES_ELEMENT_SELECTOR = 'gmp-place-autocomplete, gmp-basic-place-autocomplete';

  function shadowRootOf(host) {
    if (host.shadowRoot) return host.shadowRoot;
    try {
      const dom = typeof chrome !== 'undefined' && chrome.dom;
      return dom && dom.openOrClosedShadowRoot ? dom.openOrClosedShadowRoot(host) : null;
    } catch (_) { return null; }
  }

  // Visible Places widgets in scope: { input, host, options() → visible suggestion elements }.
  function findPlacesWidgets(root) {
    const scope = root || document;
    const out = [];
    scope.querySelectorAll('input.pac-target-input').forEach(input => {
      if (!isVisible(input) || input.disabled || input.readOnly) return;
      out.push({ input, host: input, options: () =>
        Array.from(document.querySelectorAll('.pac-container .pac-item')).filter(isVisible) });
    });
    scope.querySelectorAll(PLACES_ELEMENT_SELECTOR).forEach(host => {
      const sr = shadowRootOf(host);
      const input = sr && sr.querySelector('input');
      if (!input || !isVisible(host)) return;
      out.push({ input, host, options: () =>
        Array.from(sr.querySelectorAll('[role="option"]')).filter(isVisible) });
    });
    return out;
  }

  function countryName(code) {
    const A = window.SFAddress;
    const c = A && A.listCountries && A.listCountries().find(x => x.code === code);
    return c ? c.label.replace(/^[^A-Za-z]+/, '').trim() : (code || '');
  }

  // What to type, best first: the full address, then shorter forms in case the full
  // (generated) address has no exact match.
  function placesQueries(values, country) {
    const street = values.address1 || '';
    const locality = [values.city, values.state, values.postcode].filter(Boolean).join(' ');
    const name = countryName(values.country || country);
    const noNumber = street.replace(/^\s*[\d\-\/]+[a-z]?\s+/i, '');
    const qs = [
      [street, locality, name].filter(Boolean).join(', '),
      [street, values.city].filter(Boolean).join(', '),
      [noNumber, locality].filter(Boolean).join(', ')
    ];
    return qs.filter((q, i) => q && qs.indexOf(q) === i);
  }

  // Type into the box the way the widget expects: focus, value, input + key events.
  function typeAhead(input, text) {
    try { input.focus(); } catch (_) {}
    setInputValue(input, text);
    const last = text.slice(-1) || ' ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: last, bubbles: true, composed: true }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: last }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: last, bubbles: true, composed: true }));
  }

  async function waitFor(fn, ms, step) {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v || Date.now() >= end) return v;
      await sleep(step || 100);
    }
  }

  // Pick a suggestion: click it, and if the list stays open, use the keyboard (↓, Enter).
  async function pickSuggestion(widget, option) {
    clickOption(option);
    await sleep(150);
    if (widget.options().length) {
      const k = (key, keyCode) => widget.input.dispatchEvent(new KeyboardEvent('keydown',
        { key, code: key, keyCode, which: keyCode, bubbles: true, composed: true, cancelable: true }));
      k('ArrowDown', 40);
      k('Enter', 13);
    }
  }

  /**
   * Fill a Places address box with the profile's full address and pick a suggestion.
   * values: engine values (address1, city, state, postcode, country).
   * Returns { input, picked: true, suggestion } once a suggestion is chosen, or null
   * (no widget, no address to use, or no suggestions — the caller fills address lines).
   */
  async function fillPlacesAutocomplete(values, country, root) {
    if (!values || !values.address1) return null;
    const widget = findPlacesWidgets(root)[0];
    if (!widget) return null;
    const lines = addressLineControls(root, widget.input);
    const queries = placesQueries(values, country);
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      typeAhead(widget.input, q);
      const options = await waitFor(() => { const o = widget.options(); return o.length ? o : null; }, i ? 1800 : 3000);
      dbg('places: typed', JSON.stringify(q), '→', options ? options.length + ' suggestions' : 'none');
      if (!options) continue;
      const suggestion = options[0].textContent.trim().replace(/\s+/g, ' ');
      const before = lines.map(el => el.value);
      await pickSuggestion(widget, options[0]);
      // The site fills its address lines from the place details (an async lookup).
      await waitFor(() => lines.some((el, i) => el.value !== before[i]), 3000, 150);
      return { input: widget.input, picked: true, suggestion };
    }
    setInputValue(widget.input, '');
    widget.input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return null;
  }

  const ADDRESS_CATEGORIES = ['address1', 'address2', 'city', 'state', 'postcode', 'country'];
  // The page's own address-line controls (not the type-ahead box itself).
  function addressLineControls(root, except) {
    return Array.from((root || document).querySelectorAll('input:not([type="hidden"]), select'))
      .filter(el => el !== except && ADDRESS_CATEGORIES.indexOf(getFieldCategory(describeControl(el))) !== -1);
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
    setBusy(true);
    try {
      return await fillWithProfileNow(profileKey, opts);
    } finally {
      setBusy(false);
    }
  }

  async function fillWithProfileNow(profileKey, opts = {}) {
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

    // Address type-ahead first: the chosen place fills the site's own address lines.
    const scanRoot = findScanRoot().root;
    const placed = await fillPlacesAutocomplete(values, profile.country, scanRoot === document ? null : scanRoot);
    if (placed) {
      filledCount++;
      handled.add(placed.input);
      detectedFields.forEach(f => {
        if (ADDRESS_CATEGORIES.indexOf(getFieldCategory(f)) !== -1 && !isEmptyValue(f.element)) handled.add(f.element);
      });
    }
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

          // Already done — only revisit a <select> a dependency reset to empty.
          if (handled.has(el) && !(isSelect && isEmptyValue(el))) continue;

          // The profile's own custom fields win over the built-in categories.
          if (type !== 'radio' && !handled.has(el)) {
            const custom = await customFieldValue(profile, Object.assign(describeControl(el), field), el, opts);
            if (custom) {
              handled.add(el);
              if (!custom.skip && applyValueToElement(el, adaptCustomValue(el, field, category, custom.value, profile.country))) {
                changed++; filledCount++;
              }
              continue;
            }
          }

          // Skip fields gated out by policy/override
          if (!(category in values)) continue;

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

          let value = values[category];
          if (value === null || value === undefined) continue;
          if (category === 'dob') value = adaptDateValue(el, field, value, profile.country);
          if (category === 'gender' && isSelect) value = genderSelectValue(el, value) || value;

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

      // Gender radio groups are skipped above (radios are left alone); tick the matching one.
      if ('gender' in values) filledCount += fillGenderRadios(detectedFields.map(f => f.element), values.gender);

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

  /**
   * The profile's custom field matching this control, as { value } to fill, { skip: true } to
   * leave it alone, or null when no custom field matches. Group fills ("Fill name") ignore
   * custom fields. Random custom fields are chosen by the AI, guided by the custom field's label.
   */
  async function customFieldValue(profile, desc, el, opts) {
    const F = window.SFFormData;
    if ((opts && opts.only) || !F || !F.matchCustomField) return null;
    const cf = F.matchCustomField(profile, desc);
    if (!cf) return null;
    if (cf.mode === 'skip') return { skip: true };
    if (cf.mode === 'random') {
      if (!window.SFAIDetector || /^(checkbox|radio)$/i.test(desc.type || '')) return { skip: true };
      const stop = el ? showFieldThrobber(el) : null;
      try {
        const value = await window.SFAIDetector.generateCustomFieldValue(Object.assign({}, desc, {
          htmlName: desc.htmlName || desc.name, htmlType: desc.htmlType || desc.type,
          detectedType: 'custom', suggestedValue: undefined, profileHint: cf.label || cf.labelHint
        }));
        return value ? { value } : { skip: true };
      } finally {
        if (stop) stop();
      }
    }
    return cf.value !== undefined && cf.value !== '' ? { value: cf.value } : { skip: true };
  }
  // Fit a custom field's value to its control: dates are rendered in the field's format,
  // gender selects get their matching option.
  function adaptCustomValue(el, field, category, value, country) {
    const iso = window.SFFormData.toISODate(value);
    if (iso && (category === 'dob' || category === 'date' || isBirthField(field))) {
      return adaptDateValue(el, field, iso, country);
    }
    if (category === 'gender' && el.tagName.toLowerCase() === 'select') return genderSelectValue(el, value) || value;
    return value;
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
          const generated = window.SFAIDetector
            ? await window.SFAIDetector.generateCustomFieldValue(field)
            : undefined;
          return generated === '' ? undefined : generated;
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

    // ── Custom / unknown field → AI picks a value from label, name, options… ─
    // Group fills ("Fill name", "Fill address") only touch their groups' fields.
    if (opts && opts.only) return undefined;
    // Checkboxes/radios are left alone: there is no meaningful "value" to invent.
    const htmlType = (field.htmlType || field.type || '').toLowerCase();
    if (htmlType === 'checkbox' || htmlType === 'radio') return undefined;
    if (window.SFAIDetector) {
      const generated = await window.SFAIDetector.generateCustomFieldValue(field);
      return generated === '' ? undefined : generated; // nothing appropriate → leave blank
    }
    return undefined;
  }

  /**
   * Write resolved values to their controls. Used by the AI-powered fill path.
   * Date types (dob / date) are rendered per control: part, format or matching option.
   *
   * @param {Array<{el, value, detectedType}>} entries
   * @param {string} [country] Profile country (default date order for text inputs)
   * @returns {number} Number of fields successfully filled
   */
  function fillFormWithValues(entries, country) {
    let filledCount = 0;
    entries.forEach(function (entry) {
      const el = entry.el;
      if (!el || !el.isConnected || entry.value === undefined || entry.value === null) return;
      const isDate = entry.detectedType === 'dob' || entry.detectedType === 'date';
      const iso = isDate ? window.SFFormData.toISODate(entry.value) : null;
      let finalValue = iso ? adaptDateValue(el, describeControl(el), iso, country) : entry.value;
      if (entry.detectedType === 'gender' && el.tagName.toLowerCase() === 'select') {
        finalValue = genderSelectValue(el, finalValue) || finalValue;
      }
      if (applyValueToElement(el, finalValue)) filledCount++;
    });
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
    ));

    if (!allControls.length) {
      return { success: false, message: 'No fillable fields detected on page.' };
    }

    // Controls without name/id get a positional name so the LLM can still refer to them.
    const fieldsForAI = allControls.map(function (el, i) {
      const d = describeControl(el);
      if (!d.name) d.name = 'field_' + i;
      return d;
    });
    const indexByName = {};
    fieldsForAI.forEach(function (d, i) { if (!(d.name in indexByName)) indexByName[d.name] = i; });

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

    // Resolve value for each AI-detected field. The page's own description (options,
    // constraints, group context) is merged in so value generation can use it.
    const entries = [];
    const seen    = new Set();
    for (let i = 0; i < aiResult.fields.length; i++) {
      const detected = aiResult.fields[i];
      const key      = detected.htmlName || detected.name || '';
      // Match by name; if the LLM mangled it, fall back to position (the prompt asks for same order).
      const idx = (key in indexByName) ? indexByName[key] : (i < allControls.length ? i : -1);
      if (idx === -1 || seen.has(idx)) continue;
      seen.add(idx);
      const dom      = fieldsForAI[idx];
      const aiField  = Object.assign({}, dom, detected, {
        htmlType: detected.htmlType || dom.type,
        label:    detected.label || dom.label,
        llmUnavailable: !!aiResult.error
      });
      // The LLM sometimes misses split DOB parts (Day / Month / Year); the page's wording wins.
      if (aiField.detectedType !== 'dob' && isBirthField(dom)) aiField.detectedType = 'dob';
      aiField.htmlName = dom.name;
      const ctl = allControls[idx];
      if ((ctl.type || '').toLowerCase() !== 'radio') {
        const custom = await customFieldValue(activeProfile,
          Object.assign({}, dom, { llmUnavailable: !!aiResult.error }), ctl, opts);
        if (custom) {
          if (!custom.skip) entries.push({ el: ctl, value: custom.value, detectedType: aiField.detectedType });
          continue;
        }
      }
      // Checkboxes/radios follow the same rule as the heuristic path: tick consent boxes,
      // leave everything else (contact-preference toggles, "same as billing") untouched.
      const ctlType = (allControls[idx].type || '').toLowerCase();
      if (ctlType === 'checkbox' || ctlType === 'radio') {
        if (ctlType === 'checkbox' && !allControls[idx].checked && checkboxPolicy(dom) === 'check') {
          entries.push({ el: allControls[idx], value: 'true', detectedType: 'consent' });
        }
        continue;
      }
      const aiChooses = !(F.CANONICAL_TO_ENGINE && F.CANONICAL_TO_ENGINE[aiField.detectedType]);
      const stopThrobber = aiChooses ? showFieldThrobber(allControls[idx]) : null;
      let value;
      try {
        value = await resolveFieldValue(aiField, activeProfile, opts, standardValues);
      } finally {
        if (stopThrobber) stopThrobber();
      }
      dbg('ai field', dom.name, JSON.stringify(dom.label), '→', aiField.detectedType, '=', JSON.stringify(value));
      if (value !== undefined) entries.push({ el: allControls[idx], value: value, detectedType: aiField.detectedType });
    }

    // Address type-ahead: type the full address and pick a suggestion; address lines the
    // site filled from the chosen place are left as the site set them.
    const placed = await fillPlacesAutocomplete(standardValues, activeProfile.country, null);
    const ADDRESS_TYPES = ['street1', 'street2', 'city', 'state', 'zip', 'country'];
    const toFill = placed ? entries.filter(e => e.el !== placed.input &&
      !(ADDRESS_TYPES.indexOf(e.detectedType) !== -1 && !isEmptyValue(e.el))) : entries;
    let filledCount = fillFormWithValues(toFill, activeProfile.country) + (placed ? 1 : 0);
    if ('gender' in standardValues) filledCount += fillGenderRadios(allControls, standardValues.gender);
    return {
      success:     true,
      filledCount,
      profileUsed: activeProfile.label || activeProfile.id,
      message:     'Filled ' + filledCount + ' fields using ' + (activeProfile.label || activeProfile.id)
    };
  }


  // ============================================================
  // Busy indicators while the AI considers field values: spinning ring on the
  // ✨ form icons, a badge spinner on the toolbar icon (background.js) and a
  // small throbber beside each field being populated.
  // ============================================================
  const BUSY_ATTR = 'data-sf-busy';
  let busyCount = 0;

  function ensureBusyStyles() {
    if (document.getElementById('sf-busy-styles')) return;
    const style = document.createElement('style');
    style.id = 'sf-busy-styles';
    style.setAttribute(SF_UI_ATTR, '');
    style.textContent = `
      @keyframes sf-spin { to { transform: rotate(360deg); } }
      button[${SF_UI_ATTR}][${BUSY_ATTR}] { cursor: progress !important; }
      button[${SF_UI_ATTR}][${BUSY_ATTR}]::after {
        content: ""; position: absolute; inset: -4px; border-radius: 50%; pointer-events: none;
        border: 3px solid rgba(37, 99, 235, 0.25); border-top-color: #2563eb; border-right-color: #60a5fa;
        animation: sf-spin 0.8s linear infinite; box-sizing: border-box;
      }
      .sf-throbber {
        position: fixed; z-index: 2147483646; width: 16px; height: 16px; margin: 0; padding: 0;
        border-radius: 50%; border: 2px solid rgba(37, 99, 235, 0.25); border-top-color: #2563eb;
        box-sizing: border-box; pointer-events: none; animation: sf-spin 0.7s linear infinite;
      }
      .sf-mini-spin {
        display: inline-block; width: 12px; height: 12px; margin-right: 8px; vertical-align: -2px;
        border-radius: 50%; border: 2px solid rgba(37, 99, 235, 0.25); border-top-color: #2563eb;
        box-sizing: border-box; animation: sf-spin 0.7s linear infinite;
      }
      @keyframes sf-chord-pulse { 50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.25); } }
      button[${SF_UI_ATTR}][${CHORD_ATTR}] {
        background: #f59e0b !important; color: #111827 !important;
        animation: sf-chord-pulse 1s ease-in-out infinite;
      }
      .sf-chord-hint {
        position: fixed; z-index: 2147483647; background: #0f172a; color: #f1f5f9;
        border: 1px solid #f59e0b; border-radius: 10px; padding: 8px 12px;
        font: 13px/1.7 system-ui, -apple-system, sans-serif; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
      }
      .sf-chord-hint .sf-chord-title { font-size: 11px; font-weight: 700; color: #fcd34d; letter-spacing: 0.3px; }
      .sf-chord-hint kbd {
        display: inline-block; min-width: 18px; text-align: center; margin-right: 6px;
        font: 600 11px ui-monospace, monospace; color: #0f172a; background: #f1f5f9;
        border-radius: 4px; padding: 0 5px; border-bottom: 2px solid #94a3b8;
      }
      @media (prefers-reduced-motion: reduce) {
        button[${SF_UI_ATTR}][${CHORD_ATTR}] { animation: none; }
        button[${SF_UI_ATTR}][${BUSY_ATTR}]::after, .sf-throbber, .sf-mini-spin { animation-duration: 2.4s; }
      }`;
    (document.head || document.documentElement).appendChild(style);
  }

  // Reference-counted: nested fills (e.g. right-click during fill-all) stay busy until all finish.
  function setBusy(on) {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    const busy = busyCount > 0;
    if (busy) ensureBusyStyles();
    formButtons.forEach(({ btn }) => {
      if (busy) {
        btn.setAttribute(BUSY_ATTR, '');
        btn.title = 'SmartForm is asking the AI for field values…';
      } else {
        btn.removeAttribute(BUSY_ATTR);
        btn.title = 'Scan this form with SmartForm Filler';
      }
    });
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'aiBusy', busy }, () => { void chrome.runtime.lastError; });
      }
    } catch (_) { /* extension context gone (reloaded) — on-page indicators still work */ }
  }

  // Small spinner just inside the right edge of a field. Returns a stop() function.
  function showFieldThrobber(el) {
    if (!el || !el.getBoundingClientRect) return function () {};
    ensureBusyStyles();
    const t = document.createElement('div');
    t.className = 'sf-throbber';
    t.setAttribute(SF_UI_ATTR, '');
    t.setAttribute('role', 'status');
    t.setAttribute('aria-label', 'SmartForm is choosing a value');
    const place = () => {
      const r = el.getBoundingClientRect();
      t.style.left = Math.max(0, r.right - 24) + 'px';
      t.style.top = (r.top + Math.max(0, (r.height - 16) / 2)) + 'px';
    };
    place();
    document.body.appendChild(t);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return function stop() {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      t.remove();
    };
  }

  // ============================================================
  // Right-click → "Fill this field with AI suggestion"
  // ============================================================
  let lastContextTarget = null;
  document.addEventListener('contextmenu', function (e) {
    const t = e.target;
    lastContextTarget = (t && t.matches && t.matches(FILLABLE_SELECTOR)) ? t
      : (t && t.closest ? t.closest(FILLABLE_SELECTOR) : null);
  }, true);

  /**
   * Ask the AI for a value for one control, chosen from its label, name, placeholder,
   * group context and options, and write it. Profile data is not used.
   */
  async function aiSuggestField(el) {
    el = el || lastContextTarget || (document.activeElement && document.activeElement.matches &&
      document.activeElement.matches(FILLABLE_SELECTOR) ? document.activeElement : null);
    if (!el || !el.isConnected) return { success: false, message: 'No form field selected.' };
    if (!window.SFAIDetector || !window.SFAIDetector.suggestFieldValue) {
      return { success: false, message: 'AI detector not loaded.' };
    }
    const d = describeControl(el);
    showToast('Asking AI for “' + d.label + '”…');
    const stopThrobber = showFieldThrobber(el);
    setBusy(true);
    let res;
    try {
      res = await window.SFAIDetector.suggestFieldValue(Object.assign({}, d, {
        htmlName: d.name, htmlType: d.type, currentValue: el.value || ''
      }));
    } finally {
      stopThrobber();
      setBusy(false);
    }
    if (res.error) {
      showToast('AI suggestion failed: ' + res.error);
      return { success: false, message: res.error };
    }
    const isDate = isBirthField(d) || isDateLike(d, el);
    const iso = isDate ? window.SFFormData.toISODate(res.value) : null;
    const value = iso ? adaptDateValue(el, d, iso, (await loadProfile(null)).country) : res.value;
    const ok = applyValueToElement(el, value);
    showToast(ok ? 'AI filled “' + d.label + '”' : 'Could not fill “' + d.label + '”');
    return { success: ok, value: value };
  }
  window.__sfAISuggestField = aiSuggestField;

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
    header.setAttribute('data-role', 'header');
    header.textContent = `${scanResult.fieldCount} field${scanResult.fieldCount === 1 ? '' : 's'} • ${scanResult.scopeName}`;
    Object.assign(header.style, { fontSize: '11px', color: '#64748b', padding: '4px 8px 6px', fontWeight: '600', flex: '1' });
    const cog = document.createElement('button');
    cog.type = 'button';
    cog.setAttribute(SF_UI_ATTR, '');
    cog.setAttribute('data-role', 'settings');
    cog.title = 'SmartForm settings';
    cog.setAttribute('aria-label', 'Open SmartForm settings');
    cog.textContent = '⚙';
    Object.assign(cog.style, {
      border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '15px', lineHeight: '1',
      color: '#64748b', padding: '4px 6px', borderRadius: '6px'
    });
    cog.addEventListener('mouseenter', () => { cog.style.background = '#f1f5f9'; cog.style.color = '#0f172a'; });
    cog.addEventListener('mouseleave', () => { cog.style.background = 'transparent'; cog.style.color = '#64748b'; });
    cog.addEventListener('click', (e) => {
      e.stopPropagation();
      closeFillMenu();
      try { chrome.runtime.sendMessage({ action: 'openOptions' }, () => { void chrome.runtime.lastError; }); }
      catch (_) { showToast('Reload the page to use SmartForm settings'); }
    });
    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, { display: 'flex', alignItems: 'center', gap: '4px' });
    headerRow.appendChild(header);
    headerRow.appendChild(cog);
    fillMenu.appendChild(headerRow);

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
          el.addEventListener('click', (e) => { e.stopPropagation(); runMenuAction(__sfMenuOnlyFor(el.getAttribute('data-only')), profileSel.value, el); });
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

  // Lock the menu while the AI works: spinner on the chosen action, everything else disabled.
  function setMenuBusy(actionBtn) {
    if (!fillMenu) return;
    ensureBusyStyles();
    fillMenu.style.cursor = 'progress';
    fillMenu.querySelectorAll('button, select').forEach(c => { c.disabled = true; c.style.opacity = c === actionBtn ? '1' : '0.45'; });
    const header = fillMenu.querySelector('[data-role="header"]');
    if (header) header.textContent = 'AI is considering field values…';
    if (actionBtn) {
      const label = actionBtn.textContent;
      actionBtn.textContent = '';
      const spin = document.createElement('span');
      spin.className = 'sf-mini-spin';
      actionBtn.appendChild(spin);
      actionBtn.appendChild(document.createTextNode(label + ' — asking AI…'));
      actionBtn.style.background = '#eff6ff';
    }
  }

  function runMenuAction(only, profileId, actionBtn) {
    setMenuBusy(actionBtn);
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
    reportFormStatus();
  }

  // Tell the background how many fillable fields this page has, so the toolbar icon
  // can switch between its grey (nothing to fill) and full-colour (fields found) versions.
  let lastReportedCount = -1;
  function reportFormStatus() {
    const count = liveControls().length;
    if (count === lastReportedCount) return;
    lastReportedCount = count;
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'formStatus', count }, () => { void chrome.runtime.lastError; });
      }
    } catch (_) { /* extension reloaded — page keeps working */ }
  }

  function scheduleBuild() {
    if (buildScheduled) return;
    buildScheduled = true;
    setTimeout(() => { buildScheduled = false; ensureScanButtons(); }, 300);
  }

  let formObserver = null;
  function initFormIcons() {
    try {
      // Icons left behind by an orphaned copy of this script (pre-update) belong to nobody now.
      document.querySelectorAll('button[' + SF_UI_ATTR + ']').forEach(b => b.remove());
      formObserver = new MutationObserver(() => { if (!teardownIfOrphaned()) scheduleBuild(); });
      formObserver.observe(document.documentElement, { childList: true, subtree: true });
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

    if (msg.action === 'aiSuggestField') {
      aiSuggestField().then(sendResponse);
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
  // ============================================================
  // Keyboard shortcuts (configured in settings; see hotkeys.js)
  // ============================================================
  let hotkeys = window.SFHotkeys ? window.SFHotkeys.resolve(null) : {};

  function loadHotkeys() {
    if (!window.SFHotkeys) return;
    const key = window.SFHotkeys.STORAGE_KEY;
    try {
      chrome.storage.local.get([key]).then(s => { hotkeys = window.SFHotkeys.resolve(s && s[key]); }).catch(() => {});
      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes[key]) hotkeys = window.SFHotkeys.resolve(changes[key].newValue);
        });
      }
    } catch (_) { /* extension context invalidated — keep defaults */ }
  }

  // A focused control the AI can fill on its own (not buttons, checkboxes or radios).
  function focusedFillable() {
    const el = document.activeElement;
    if (!el || !el.matches || !el.matches(FILLABLE_SELECTOR)) return null;
    const t = (el.type || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio' || el.disabled || el.readOnly) return null;
    return el;
  }

  async function runFillFormHotkey() {
    const { defaultProfile = null } = await chrome.storage.local.get(['defaultProfile']);
    showToast('SmartForm: AI is filling the form…');
    const res = await fillWithProfile(defaultProfile, { only: null, unique: true });
    showToast(res && res.filledCount
      ? `Filled ${res.filledCount} field${res.filledCount === 1 ? '' : 's'}`
      : (res && res.message) || 'No matching fields on this page');
  }

  function runHotkeyAction(action) {
    if (action === 'fillField') {
      const el = focusedFillable();
      if (!el) { showToast('SmartForm: focus an input field first'); return; }
      aiSuggestField(el);
    } else if (action === 'fillForm') {
      runFillFormHotkey().catch(err => showToast('Error filling fields: ' + (err && err.message || 'Unknown')));
    }
  }

  // ── Chord: leader pressed → icons switch to "waiting for key" until the next key ──
  const CHORD_ATTR = 'data-sf-chord';
  let chordTimer = null;
  let chordHint = null;

  function chordActive() { return chordTimer !== null; }

  // The ✨ icon nearest the focused field (or the first visible one) anchors the key hint.
  function chordAnchorButton() {
    const visible = formButtons.filter(({ btn }) => btn.style.display !== 'none');
    if (!visible.length) return null;
    const focus = document.activeElement;
    const owner = focus && visible.find(({ target }) => target.contains && target.contains(focus));
    return (owner || visible[0]).btn;
  }

  function startChord() {
    const H = window.SFHotkeys;
    cancelChord();
    ensureBusyStyles();
    formButtons.forEach(({ btn }) => {
      btn.setAttribute(CHORD_ATTR, '');
      btn.textContent = '⌨';
      btn.title = 'SmartForm: waiting for the next key…';
    });
    chordHint = document.createElement('div');
    chordHint.className = 'sf-chord-hint';
    chordHint.setAttribute(SF_UI_ATTR, '');
    chordHint.setAttribute('role', 'status');
    const title = document.createElement('div');
    title.className = 'sf-chord-title';
    title.textContent = 'SmartForm — press a key';
    chordHint.appendChild(title);
    Object.keys(H.ACTIONS).forEach(action => {
      const code = hotkeys.chord.keys[action];
      if (!code) return;
      const row = document.createElement('div');
      const k = document.createElement('kbd'); k.textContent = H.chordKeyLabel(code);
      row.appendChild(k); row.appendChild(document.createTextNode(' ' + H.ACTIONS[action].label));
      chordHint.appendChild(row);
    });
    const esc = document.createElement('div');
    const k = document.createElement('kbd'); k.textContent = 'Esc';
    esc.appendChild(k); esc.appendChild(document.createTextNode(' Cancel'));
    chordHint.appendChild(esc);
    document.body.appendChild(chordHint);
    const anchor = chordAnchorButton();
    if (anchor) {
      const r = anchor.getBoundingClientRect(), m = chordHint.getBoundingClientRect();
      chordHint.style.top = Math.min(window.innerHeight - m.height - 8, r.bottom + 8) + 'px';
      chordHint.style.left = Math.max(8, r.right - m.width) + 'px';
    } else {
      chordHint.style.bottom = '20px';
      chordHint.style.right = '20px';
    }
    chordTimer = setTimeout(cancelChord, H.CHORD_TIMEOUT_MS);
  }

  function cancelChord() {
    clearTimeout(chordTimer);
    chordTimer = null;
    if (chordHint) { chordHint.remove(); chordHint = null; }
    formButtons.forEach(({ btn }) => {
      if (!btn.hasAttribute(CHORD_ATTR)) return;
      btn.removeAttribute(CHORD_ATTR);
      btn.textContent = '✨';
      btn.title = 'Scan this form with SmartForm Filler';
    });
  }

  function onHotkey(e) {
    if (!window.SFHotkeys) return;
    const H = window.SFHotkeys;
    const chord = hotkeys.chord || {};

    if (chordActive()) {
      if (/^(Control|Alt|Shift|Meta|OS)/.test(e.code)) return; // still releasing the leader
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      const action = Object.keys(H.ACTIONS).find(a => H.matchesChordKey(e, chord.keys[a], chord.leader));
      cancelChord();
      if (action) runHotkeyAction(action);
      else if (e.key !== 'Escape') showToast('SmartForm: no action on ' + (e.key || e.code));
      return;
    }
    if (e.repeat) return;

    if (chord.enabled && H.matches(e, chord.leader)) {
      e.preventDefault(); e.stopPropagation();
      startChord();
    } else if (H.matches(e, hotkeys.fillField)) {
      e.preventDefault(); e.stopPropagation();
      runHotkeyAction('fillField');
    } else if (H.matches(e, hotkeys.fillForm)) {
      e.preventDefault(); e.stopPropagation();
      runHotkeyAction('fillForm');
    }
  }

  // Orphaned copy: stop reacting and remove our on-page UI so the fresh copy owns the page.
  let tornDown = false;
  function teardownIfOrphaned() {
    if (tornDown || extensionAlive()) return false;
    tornDown = true;
    if (window.__sfIsAlive === extensionAlive) window.__smartFormFillerLoaded = false; // let a fresh copy in
    window.removeEventListener('keydown', onHotkeyGuarded, true);
    if (formObserver) formObserver.disconnect();
    cancelChord();
    formButtons.forEach(({ btn }) => btn.remove());
    formButtons = [];
    closeFillMenu();
    return true;
  }

  function onHotkeyGuarded(e) {
    if (teardownIfOrphaned()) return;
    onHotkey(e);
  }

  loadHotkeys();
  window.addEventListener('keydown', onHotkeyGuarded, true);

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

  // Exports for tests
  window.__sfFillWithProfile = fillWithProfile;
  window.__sfResolveFieldValue = resolveFieldValue;

})();