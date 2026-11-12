// test/hotkeys.test.js — configurable AI hotkeys: combo logic, settings recorder, in-page listener
const { eq, ok, section, done } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const run = (ctx, f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const tick = (ms) => new Promise(r => setTimeout(r, ms || 20));
const key = (win, target, init) => {
  const e = new win.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init));
  target.dispatchEvent(e);
  return e;
};

// chrome mock with storage.onChanged so live updates can be tested
function chromeWithEvents(initial) {
  const c = makeChrome(initial);
  const listeners = [];
  const set = c.storage.local.set;
  c.storage.onChanged = { addListener(fn) { listeners.push(fn); } };
  c.storage.local.set = (obj) => {
    const changes = {}; Object.keys(obj).forEach(k => { changes[k] = { newValue: obj[k] }; });
    return set(obj).then(() => listeners.forEach(fn => fn(changes, 'local')));
  };
  return c;
}

(async () => {
  section('combo logic');
  {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
    run(dom.getInternalVMContext(), 'hotkeys.js');
    const H = dom.window.SFHotkeys;
    const ev = (o) => new dom.window.KeyboardEvent('keydown', o);
    eq(H.fromEvent(ev({ code: 'ShiftLeft', shiftKey: true })), null, 'modifier-only press is not a combo');
    const c = H.fromEvent(ev({ code: 'KeyK', ctrlKey: true, shiftKey: true }));
    eq(c, { ctrl: true, alt: false, shift: true, meta: false, code: 'KeyK' }, 'combo from event uses code');
    ok(H.isValid(c), 'Ctrl+Shift+K valid');
    ok(!H.isValid({ shift: true, code: 'KeyK' }), 'Shift+K alone rejected (would hijack typing)');
    ok(H.isValid({ code: 'F8' }), 'bare function key allowed');
    ok(H.matches(ev({ code: 'KeyK', ctrlKey: true, shiftKey: true }), c), 'matches exact combo');
    ok(!H.matches(ev({ code: 'KeyK', ctrlKey: true }), c), 'extra/missing modifier does not match');
    ok(!H.matches(ev({ code: 'KeyF', altKey: true, shiftKey: true }), null), 'disabled (null) never matches');
    eq(H.label({ ctrl: true, shift: true, code: 'KeyK' }), 'Ctrl+Shift+K', 'label');
    eq(H.resolve({ fillField: null }).fillField, null, 'stored null = disabled');
    eq(H.resolve({}).fillForm.code, 'KeyF', 'missing → default');
  }

  section('settings recorder');
  {
    const html = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com' });
    const win = dom.window, ctx = dom.getInternalVMContext();
    const chrome = chromeWithEvents({});
    chrome.identity = { getRedirectURL: () => '' }; chrome.tabs = { create() {} };
    chrome.runtime.sendMessage = () => {};
    win.chrome = chrome;
    win.fetch = () => Promise.reject(new Error('offline'));
    const scripts = Array.from(win.document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
    ok(scripts.indexOf('hotkeys.js') !== -1 && scripts.indexOf('hotkeys.js') < scripts.indexOf('options.js'), 'options.html loads hotkeys.js before options.js');
    scripts.forEach(f => run(ctx, f));
    await tick(50);

    const btns = () => win.document.querySelectorAll('[data-hotkey]');
    eq(btns().length, 2, 'two shortcut rows rendered');
    eq(btns()[0].textContent, 'Alt+Shift+F', 'form shortcut shows default');
    eq(btns()[1].textContent, 'Alt+Shift+S', 'field shortcut shows default');

    btns()[1].click();
    eq(btns()[1].textContent, 'Press keys…', 'recording state');
    key(win, win.document.body, { code: 'KeyK', key: 'k', shiftKey: true });
    await tick();
    ok(/Include Ctrl, Alt/.test(win.document.getElementById('hotkeyStatus').textContent), 'Shift-only combo rejected with message');
    key(win, win.document.body, { code: 'KeyF', key: 'F', altKey: true, shiftKey: true });
    await tick();
    ok(/already used/.test(win.document.getElementById('hotkeyStatus').textContent), 'clash with the other shortcut rejected');
    key(win, win.document.body, { code: 'KeyK', key: 'K', ctrlKey: true, shiftKey: true });
    await tick();
    const saved = (await chrome.storage.local.get(['hotkeys'])).hotkeys;
    eq(saved.fillField, { ctrl: true, alt: false, shift: true, meta: false, code: 'KeyK' }, 'new combo saved');
    eq(btns()[1].textContent, 'Ctrl+Shift+K', 'button shows new combo');

    btns()[0].click();
    key(win, win.document.body, { code: 'Backspace', key: 'Backspace' });
    await tick();
    eq((await chrome.storage.local.get(['hotkeys'])).hotkeys.fillForm, null, 'Backspace turns shortcut off');
    eq(btns()[0].textContent, 'Off', 'button shows Off');

    win.document.getElementById('btnResetHotkeys').click();
    await tick();
    eq(btns()[0].textContent, 'Alt+Shift+F', 'reset restores defaults');
  }

  section('in-page listener');
  {
    const html = `<!DOCTYPE html><html><body><form>
      <label for="h">Favourite hobby</label><input id="h" name="hobby" type="text" />
      <label for="e">Email</label><input id="e" name="email" type="email" />
      <button id="b" type="button">Go</button></form></body></html>`;
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://test.example.com/' });
    const win = dom.window, ctx = dom.getInternalVMContext();
    const chrome = chromeWithEvents({ defaultProfile: 'au-personal' });
    const prompts = [];
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg.action !== 'callLLM') { cb && cb({}); return; }
      prompts.push(msg.prompt);
      cb(/Return ONLY a JSON array/.test(msg.prompt) ? { result: '[]' } : { result: 'Sailing' });
    };
    win.chrome = chrome;
    win.CSS = { escape: s => s };
    ['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js', 'ai-field-detector.js', 'form-registry.js', 'hotkeys.js']
      .forEach(f => run(ctx, f));
    win.__smartFormFillerLoaded = false;
    run(ctx, 'content.js');
    await tick();

    const hobby = win.document.getElementById('h');
    hobby.focus();
    const e1 = key(win, hobby, { code: 'KeyS', key: 'S', altKey: true, shiftKey: true });
    await tick(50);
    ok(e1.defaultPrevented, 'field hotkey consumed');
    eq(hobby.value, 'Sailing', 'field hotkey fills the focused input with the AI suggestion');

    win.document.getElementById('b').focus();
    const before = prompts.length;
    key(win, win.document.getElementById('b'), { code: 'KeyS', key: 'S', altKey: true, shiftKey: true });
    await tick(50);
    eq(prompts.length, before, 'field hotkey on a non-input does not call the AI');

    key(win, win.document.body, { code: 'KeyF', key: 'F', altKey: true, shiftKey: true });
    await tick(80);
    ok(/@/.test(win.document.getElementById('e').value), 'form hotkey runs fill-all (email filled)');

    await chrome.storage.local.set({ hotkeys: { fillForm: null, fillField: { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyJ' } } });
    hobby.value = ''; hobby.focus();
    key(win, hobby, { code: 'KeyS', key: 'S', altKey: true, shiftKey: true });
    await tick(30);
    eq(hobby.value, '', 'old combo stops working after settings change');
    key(win, hobby, { code: 'KeyJ', key: 'j', ctrlKey: true });
    await tick(50);
    eq(hobby.value, 'Sailing', 'new combo works without reloading the page');
    const plain = key(win, hobby, { code: 'KeyJ', key: 'j' });
    ok(!plain.defaultPrevented, 'ordinary typing is not intercepted');
  }

  done('hotkeys');
})();
