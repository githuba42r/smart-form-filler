// theme.js — light / dark / system colour theme for extension pages.
// Classic global script loaded in <head> so data-theme is set before first paint.
// Choice persists in localStorage ('sfTheme': 'system' | 'light' | 'dark'); default 'system'.
;(function (root) {
  'use strict';

  var KEY = 'sfTheme';
  var media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;

  function getChoice() {
    try {
      var v = root.localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function resolve(choice) {
    if (choice === 'light' || choice === 'dark') return choice;
    return media && media.matches ? 'dark' : 'light';
  }

  function syncButtons(choice) {
    var buttons = root.document.querySelectorAll('[data-theme-choice]');
    Array.prototype.forEach.call(buttons, function (b) {
      var on = b.getAttribute('data-theme-choice') === choice;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function apply(choice) {
    root.document.documentElement.setAttribute('data-theme', resolve(choice));
    syncButtons(choice);
  }

  function setChoice(choice) {
    try { root.localStorage.setItem(KEY, choice); } catch (e) { /* storage blocked: session-only */ }
    apply(choice);
  }

  apply(getChoice());

  // Follow OS changes while on 'system'.
  if (media) {
    var onChange = function () { if (getChoice() === 'system') apply('system'); };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  root.document.addEventListener('DOMContentLoaded', function () {
    syncButtons(getChoice());
    root.document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-theme-choice]');
      if (btn) setChoice(btn.getAttribute('data-theme-choice'));
    });
  });

  root.SFTheme = { getChoice: getChoice, setChoice: setChoice };
})(typeof window !== 'undefined' ? window : globalThis);
