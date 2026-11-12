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
  // Chord: press the leader combo, release, then one plain key picks the action.
  var CHORD_DEFAULTS = {
    enabled: false,
    leader: { ctrl: true, alt: false, shift: true, meta: false, code: 'KeyF' },
    keys: { fillForm: 'KeyF', fillField: 'KeyS' }
  };
  var CHORD_TIMEOUT_MS = 3000;
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

  // Second key of a chord: a letter, digit or function key with no modifiers.
  function isValidChordKey(code) {
    return /^(Key[A-Z]|Digit\d|F([1-9]|1[0-9]|2[0-4]))$/.test(code || '');
  }

  // Plain key press (Shift tolerated) matching a chord's second key.
  function matchesChordKey(e, code) {
    return !!code && !!e && e.code === code && !e.ctrlKey && !e.altKey && !e.metaKey;
  }

  function chordKeyLabel(code) { return code ? keyLabel(code) : '—'; }

  // Stored settings merged over defaults. A stored null means "disabled".
  function resolve(stored) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = stored && Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : DEFAULTS[k];
    });
    var c = (stored && stored.chord) || {};
    out.chord = {
      enabled: !!c.enabled,
      leader: Object.prototype.hasOwnProperty.call(c, 'leader') ? c.leader : CHORD_DEFAULTS.leader,
      keys: Object.assign({}, CHORD_DEFAULTS.keys, c.keys || {})
    };
    return out;
  }

  root.SFHotkeys = {
    STORAGE_KEY: STORAGE_KEY, ACTIONS: ACTIONS, DEFAULTS: DEFAULTS,
    CHORD_DEFAULTS: CHORD_DEFAULTS, CHORD_TIMEOUT_MS: CHORD_TIMEOUT_MS,
    fromEvent: fromEvent, isValid: isValid, same: same, matches: matches, label: label, resolve: resolve,
    isValidChordKey: isValidChordKey, matchesChordKey: matchesChordKey, chordKeyLabel: chordKeyLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
