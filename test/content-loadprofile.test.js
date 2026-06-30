const { eq, ok, done } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

function bootstrap(initial) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const ctx = dom.getInternalVMContext();
  const ROOT = path.resolve(__dirname, '..');

  // Load dependencies
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/address-schemas.js'), 'utf8'), ctx, { filename: 'vendor/address-schemas.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'formdata.js'), 'utf8'), ctx, { filename: 'formdata.js' });

  // Set up chrome mock
  const win = dom.window;
  win.chrome = makeChrome(initial);
  win.__smartFormFillerLoaded = false;

  // Load content.js
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'), ctx, { filename: 'content.js' });

  return win;
}

(async () => {
  const win = bootstrap({
    profiles: [{ id:'au-personal', label:'AU' }, { id:'us-test', label:'US' }],
    defaultProfile: 'us-test'
  });
  ok(typeof win.__sfLoadProfile === 'function', '__sfLoadProfile exposed');
  eq((await win.__sfLoadProfile(null)).id, 'us-test', 'falls back to defaultProfile');
  eq((await win.__sfLoadProfile('au-personal')).id, 'au-personal', 'honours explicit key');
  eq((await win.__sfLoadProfile('missing')).id, 'au-personal', 'unknown id -> first profile');

  const empty = bootstrap({});
  ok((await empty.__sfLoadProfile(null)).id, 'empty storage -> built-in default profile');
  done('content-loadprofile');
})();
