// test/options-capture.test.js
// Tests for options.html form-specific profile editor helpers.
//
// Strategy: load options.js into jsdom.  DOMContentLoaded fires during the JSDOM
// constructor (HTML is parsed synchronously), so the handler registered inside
// options.js never executes.  The standalone IIFE at the bottom of options.js
// DOES run immediately, setting window.renderFormSpecificProfileEditor and the
// pure-function variant of window.updateFieldMode — which is what these tests
// exercise.
const { ok, eq, done } = require('./harness');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function bootstrap() {
  // Use the real options.html so #formSpecificProfileSection and other expected
  // elements are present (needed for DOM-mode calls, not for mockRender tests).
  const html = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://example.com'
  });
  const ctx = dom.getInternalVMContext();
  const win = dom.window;

  // Minimal chrome stub — DOMContentLoaded handler in options.js won't fire,
  // but chrome must exist in case any top-level reference is evaluated.
  win.chrome = {
    storage: { local: {
      get: function () { return Promise.resolve({}); },
      set: function () { return Promise.resolve(); }
    } },
    runtime: { lastError: null, sendMessage: function () {} },
    identity: { getRedirectURL: function () { return ''; } },
    tabs:    { create: function () {} }
  };

  // Load scripts in the same order as options.html.
  var deps = [
    'vendor/address-schemas.js',
    'formdata.js',
    'profile-ui.js',
    'recommendations.js',
    'options.js'
  ];
  deps.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });

  return win;
}

(async function () {
  var win = bootstrap();

  // -- Test 1: renderFormSpecificProfileEditor returns HTML with field names + modes --

  var profile1 = {
    id: 'form-test-1',
    label: 'Checkout Form',
    formMetadata: {
      urlPattern: 'https://example.com/checkout',
      capturedAt: '2026-01-01T00:00:00.000Z'
    },
    fields: [
      { htmlName: 'email',       htmlType: 'email', mode: 'pinned',    value: 'test@test.com', detectedType: 'email' },
      { htmlName: 'product_sku', htmlType: 'text',  mode: 'generated',                         detectedType: 'sku'   }
    ]
  };

  ok(typeof win.renderFormSpecificProfileEditor === 'function',
    'renderFormSpecificProfileEditor is exposed on window');

  var html = win.renderFormSpecificProfileEditor(profile1, { mockRender: true });
  ok(typeof html === 'string',           'mockRender mode returns a string');
  ok(html.indexOf('email')       !== -1, 'html contains "email"');
  ok(html.indexOf('product_sku') !== -1, 'html contains "product_sku"');
  ok(html.indexOf('pinned')      !== -1, 'html contains "pinned"');
  ok(html.indexOf('generated')   !== -1, 'html contains "generated"');

  // -- Test 2: updateFieldMode -- pure mode (profile object passed) --

  var profile2 = {
    id: 'form-test-2',
    fields: [{ htmlName: 'email', mode: 'pinned', value: 'test@test.com' }]
  };

  ok(typeof win.updateFieldMode === 'function',
    'updateFieldMode is exposed on window');

  var updated = win.updateFieldMode(profile2, 'email', 'generated');
  eq(updated.fields[0].mode,  'generated',   'updateFieldMode changes mode to generated');
  ok(updated.fields[0].value === undefined,   'updateFieldMode clears value when mode is not pinned');
  // Verify non-mutating
  eq(profile2.fields[0].mode,  'pinned',          'original profile.mode is unchanged (non-mutating)');
  eq(profile2.fields[0].value, 'test@test.com',   'original profile.value is unchanged (non-mutating)');

  done('options-capture');
})();
