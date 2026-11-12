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
    leader: null, // chosen by the user when the chord is first enabled
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

  // Chrome/Brave shortcuts (Windows/Linux spelling; on macOS Ctrl means ⌘). 'reserved' ones
  // never reach web pages at all; the rest would be hijacked, losing the browser feature.
  var BROWSER_SHORTCUTS = [
    ['Ctrl+N', 'New window', 1], ['Ctrl+Shift+N', 'New incognito/private window', 1],
    ['Ctrl+T', 'New tab', 1], ['Ctrl+Shift+T', 'Reopen closed tab', 1],
    ['Ctrl+W', 'Close tab', 1], ['Ctrl+Shift+W', 'Close window', 1], ['Ctrl+F4', 'Close tab', 1],
    ['Ctrl+Tab', 'Next tab', 1], ['Ctrl+Shift+Tab', 'Previous tab', 1], ['Ctrl+Shift+Q', 'Quit', 1],
    ['Alt+F4', 'Close window', 1],
    ['Ctrl+1', 'Go to tab 1'], ['Ctrl+2', 'Go to tab 2'], ['Ctrl+3', 'Go to tab 3'], ['Ctrl+4', 'Go to tab 4'],
    ['Ctrl+5', 'Go to tab 5'], ['Ctrl+6', 'Go to tab 6'], ['Ctrl+7', 'Go to tab 7'], ['Ctrl+8', 'Go to tab 8'],
    ['Ctrl+9', 'Go to last tab'], ['Ctrl+PageUp', 'Previous tab'], ['Ctrl+PageDown', 'Next tab'],
    ['Alt+ArrowLeft', 'Back'], ['Alt+ArrowRight', 'Forward'], ['Alt+Home', 'Home page'],
    ['Alt+F', 'Browser menu'], ['Alt+E', 'Browser menu'], ['F10', 'Browser menu'],
    ['Alt+D', 'Address bar'], ['Ctrl+L', 'Address bar'], ['F6', 'Address bar'],
    ['Ctrl+K', 'Search from address bar'], ['Ctrl+E', 'Search from address bar'],
    ['Ctrl+D', 'Bookmark page'], ['Ctrl+Shift+D', 'Bookmark all tabs'], ['Ctrl+Shift+B', 'Bookmarks bar'],
    ['Ctrl+Shift+O', 'Bookmark manager'], ['Ctrl+H', 'History'], ['Ctrl+J', 'Downloads'],
    ['Ctrl+Shift+Delete', 'Clear browsing data'], ['Ctrl+Shift+A', 'Search tabs'], ['Ctrl+Shift+M', 'Switch profile'],
    ['Shift+Escape', 'Task manager'], ['Alt+Shift+I', 'Send feedback'], ['Alt+Shift+T', 'Focus toolbar'],
    ['Ctrl+P', 'Print'], ['Ctrl+Shift+P', 'Print (system dialog)'], ['Ctrl+S', 'Save page'], ['Ctrl+O', 'Open file'],
    ['Ctrl+U', 'View source'], ['Ctrl+F', 'Find in page'], ['Ctrl+G', 'Find next'], ['Ctrl+Shift+G', 'Find previous'],
    ['F3', 'Find next'], ['Shift+F3', 'Find previous'],
    ['Ctrl+R', 'Reload'], ['Ctrl+Shift+R', 'Hard reload'], ['F5', 'Reload'], ['Shift+F5', 'Hard reload'],
    ['Ctrl+F5', 'Hard reload'], ['F11', 'Full screen'], ['F12', 'Developer tools'],
    ['Ctrl+Shift+I', 'Developer tools'], ['Ctrl+Shift+J', 'JavaScript console'], ['Ctrl+Shift+C', 'Inspect element'],
    ['Ctrl+Equal', 'Zoom in'], ['Ctrl+Shift+Equal', 'Zoom in'], ['Ctrl+Minus', 'Zoom out'], ['Ctrl+0', 'Reset zoom'],
    ['Ctrl+A', 'Select all'], ['Ctrl+C', 'Copy'], ['Ctrl+X', 'Cut'], ['Ctrl+V', 'Paste'],
    ['Ctrl+Shift+V', 'Paste as plain text'], ['Ctrl+Z', 'Undo'], ['Ctrl+Y', 'Redo'], ['Ctrl+Shift+Z', 'Redo'],
    ['Ctrl+B', 'Bold (rich text)'], ['Ctrl+I', 'Italic (rich text)'],
    ['Ctrl+ArrowLeft', 'Move by word'], ['Ctrl+ArrowRight', 'Move by word'],
    ['Ctrl+Backspace', 'Delete word'], ['Ctrl+Delete', 'Delete word'], ['Ctrl+Home', 'Go to top'], ['Ctrl+End', 'Go to bottom']
  ];

  var NAMED_CODES = { Tab: 'Tab', PageUp: 'PageUp', PageDown: 'PageDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    Home: 'Home', End: 'End', Delete: 'Delete', Backspace: 'Backspace', Escape: 'Escape', Equal: 'Equal', Minus: 'Minus' };
  function _parseShortcut(str) {
    var parts = str.split('+'), key = parts.pop(), combo = { ctrl: false, alt: false, shift: false, meta: false };
    parts.forEach(function (m) {
      if (m === 'Ctrl') combo[isMac ? 'meta' : 'ctrl'] = true;
      else combo[m.toLowerCase()] = true;
    });
    combo.code = NAMED_CODES[key] || (/^F\d+$/.test(key) ? key : /^\d$/.test(key) ? 'Digit' + key : 'Key' + key);
    return combo;
  }
  var _browserCombos = BROWSER_SHORTCUTS.map(function (b) {
    return { combo: _parseShortcut(b[0]), what: b[1], reserved: !!b[2] };
  });

  /**
   * Is this combo already a Chrome/Brave shortcut? → { what, reserved } or null.
   * reserved: the browser never passes it to pages, so it could never work.
   */
  function browserConflict(combo) {
    if (!combo) return null;
    var hit = _browserCombos.find(function (b) { return same(b.combo, combo); });
    return hit ? { what: hit.what, reserved: hit.reserved } : null;
  }

  // Ctrl+Alt is AltGr on Windows (typing characters) and a common desktop-shortcut prefix.
  function riskyCombo(combo) {
    return !!combo && !!combo.ctrl && !!combo.alt;
  }

  // Human message explaining why a combo can't be used, or '' if it's fine.
  function conflictMessage(combo) {
    var c = browserConflict(combo);
    if (!c) return '';
    return c.reserved
      ? label(combo) + ' is reserved by Chrome/Brave (' + c.what + ') — web pages never receive it'
      : label(combo) + ' is Chrome/Brave’s “' + c.what + '” — pick another so you don’t lose it';
  }

  // Second key of a chord: a letter, digit or function key with no modifiers.
  function isValidChordKey(code) {
    return /^(Key[A-Z]|Digit\d|F([1-9]|1[0-9]|2[0-4]))$/.test(code || '');
  }

  // Chord second key. Modifiers from the leader may still be held (Alt+Y then Alt+F is the
  // natural way to type an Alt+Y, F chord); any other modifier means a different shortcut.
  function matchesChordKey(e, code, leader) {
    if (!code || !e || e.code !== code) return false;
    var l = leader || {};
    return (!e.ctrlKey || !!l.ctrl) && (!e.altKey || !!l.alt) && (!e.metaKey || !!l.meta);
  }

  function chordKeyLabel(code) { return code ? keyLabel(code) : '—'; }

  // Stored settings merged over defaults. A stored null means "disabled".
  function resolve(stored) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = stored && Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : DEFAULTS[k];
    });
    var c = (stored && stored.chord) || {};
    var leader = Object.prototype.hasOwnProperty.call(c, 'leader') ? c.leader : CHORD_DEFAULTS.leader;
    out.chord = {
      enabled: !!c.enabled && isValid(leader), // a chord without a leader can't fire
      leader: leader,
      keys: Object.assign({}, CHORD_DEFAULTS.keys, c.keys || {})
    };
    return out;
  }

  root.SFHotkeys = {
    STORAGE_KEY: STORAGE_KEY, ACTIONS: ACTIONS, DEFAULTS: DEFAULTS,
    CHORD_DEFAULTS: CHORD_DEFAULTS, CHORD_TIMEOUT_MS: CHORD_TIMEOUT_MS,
    fromEvent: fromEvent, isValid: isValid, same: same, matches: matches, label: label, resolve: resolve,
    isValidChordKey: isValidChordKey, matchesChordKey: matchesChordKey, chordKeyLabel: chordKeyLabel,
    browserConflict: browserConflict, conflictMessage: conflictMessage, riskyCombo: riskyCombo
  };
})(typeof window !== 'undefined' ? window : globalThis);
