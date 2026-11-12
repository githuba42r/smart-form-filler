// hotkeys.js — window.SFHotkeys: user-configurable keyboard shortcuts for AI fill.
// Classic global script, shared by the options page (recorder) and content.js (listener).
// Chrome can't rebind chrome.commands from an extension page, so these are matched in-page.
// A combo is { ctrl, alt, shift, meta, code } where code is KeyboardEvent.code (layout-independent).
;(function (root) {
  'use strict';

  var STORAGE_KEY = 'hotkeys';
  var ACTIONS = {
    fillForm:  { label: 'AI fill form',             help: 'Fill all fields with your default profile; the AI chooses values for non-standard fields.' },
    fillField: { label: 'AI suggest focused field', help: 'Ask the AI for a value for the input that currently has focus.' }
  };
  var DEFAULTS = {
    fillForm:  { ctrl: false, alt: true, shift: true, meta: false, code: 'KeyF' },
    fillField: { ctrl: false, alt: true, shift: true, meta: false, code: 'KeyS' }
  };
  var MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

  var isMac = /Mac|iPhone|iPad/.test((root.navigator && (root.navigator.platform || root.navigator.userAgent)) || '');

  // Combo from a keydown event, or null while only modifiers are held.
  function fromEvent(e) {
    if (!e || !e.code || MODIFIER_CODES.test(e.code)) return null;
    return { ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, meta: !!e.metaKey, code: e.code };
  }

  // Needs Ctrl, Alt or Meta (Shift alone would hijack typing) — except function keys.
  function isValid(combo) {
    if (!combo || !combo.code) return false;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(combo.code)) return true;
    return !!(combo.ctrl || combo.alt || combo.meta);
  }

  function same(a, b) {
    return !!a && !!b && a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt &&
      !!a.shift === !!b.shift && !!a.meta === !!b.meta;
  }

  function matches(e, combo) { return isValid(combo) && same(fromEvent(e), combo); }

  function keyLabel(code) {
    var m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(.+)$/.exec(code))) return 'Num ' + m[1];
    var named = { Space: 'Space', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[',
      BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
    return named[code] || code;
  }

  function label(combo) {
    if (!combo || !combo.code) return 'Not set';
    var parts = [];
    if (combo.ctrl)  parts.push(isMac ? '⌃' : 'Ctrl');
    if (combo.alt)   parts.push(isMac ? '⌥' : 'Alt');
    if (combo.shift) parts.push(isMac ? '⇧' : 'Shift');
    if (combo.meta)  parts.push(isMac ? '⌘' : 'Meta');
    parts.push(keyLabel(combo.code));
    return parts.join(isMac ? '' : '+');
  }

  // Stored settings merged over defaults. A stored null means "disabled".
  function resolve(stored) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = stored && Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : DEFAULTS[k];
    });
    return out;
  }

  root.SFHotkeys = {
    STORAGE_KEY: STORAGE_KEY, ACTIONS: ACTIONS, DEFAULTS: DEFAULTS,
    fromEvent: fromEvent, isValid: isValid, same: same, matches: matches, label: label, resolve: resolve
  };
})(typeof window !== 'undefined' ? window : globalThis);
