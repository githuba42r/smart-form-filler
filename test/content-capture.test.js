// test/content-capture.test.js — TDD tests for __sfCaptureFormAsProfile and AI-powered fillWithProfile
const { eq, ok, section, done } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Bootstrap — sets up a JSDOM window with content.js and optional mocks
// ---------------------------------------------------------------------------
function bootstrap(options) {
  options = options || {};
  const html        = options.html        || '<!DOCTYPE html><body></body>';
  const storage     = options.storage     || {};
  const aiDetector  = options.aiDetector  || null;
  const formRegistry = options.formRegistry || null;
  const url         = options.url         || 'https://test.example.com/form';

  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url });
  const ctx = dom.getInternalVMContext();
  const win = dom.window;

  for (const f of ['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }

  win._lastAlert = null;
  win.alert = function (msg) { win._lastAlert = msg; };
  win.chrome = makeChrome(storage);

  // Mocks set before content.js so fillWithProfile detects them at call time
  if (aiDetector)    win.SFAIDetector   = aiDetector;
  if (formRegistry)  win.SFFormRegistry = formRegistry;

  win.__smartFormFillerLoaded = false;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'), ctx, { filename: 'content.js' });

  return win;
}

// ---------------------------------------------------------------------------
// Shared HTML fixture — a typical contact + address form
// ---------------------------------------------------------------------------
const FORM_HTML = `<!DOCTYPE html><html><body>
  <form>
    <input name="first_name" type="text" />
    <input name="email"      type="email" />
    <input name="address1"   type="text" />
    <input name="notes"      type="text" />
    <input name="password"   type="password" />
  </form>
</body></html>`;

const AU_PERSONAL_PROFILE = {
  id: 'au-personal', label: 'AU Personal', country: 'AU',
  policy: { groups: { name: true, contact: true, address: true, account: true, misc: true }, exclude: [] },
  pins: {}
};

// ---------------------------------------------------------------------------
// Test 1 — captures a form as a profile with detected fields
// ---------------------------------------------------------------------------
(async () => {

  section('capture: detected fields');
  {
    const win = bootstrap({});

    const mockDetectedFields = {
      fields: [
        { htmlName: 'email', detectedType: 'email',     isSafe: true },
        { htmlName: 'name',  detectedType: 'firstname', isSafe: true }
      ],
      formSignature: 'sig-123'
    };

    const mockReadFormValues = { email: 'alice@test.com', name: 'Alice' };

    const result = await win.__sfCaptureFormAsProfile({
      mockDetectedFields,
      mockReadFormValues,
      mockActiveProfile: {
        country: 'AU',
        policy: { groups: { name: true, contact: true }, exclude: [] },
        pins: {}
      },
      pageTitle: 'Checkout'
    });

    ok(result !== null && result !== undefined, 'capture returns a result');
    ok(result.formMetadata && result.formMetadata.urlPattern !== undefined,
      'result.formMetadata.urlPattern is defined');
    eq(result.fields.length, 2, 'result has 2 fields');
    eq(result.fields[0].mode,  'pinned',         'email field is pinned (has a read value)');
    eq(result.fields[0].value, 'alice@test.com', 'email field value matches read value');
    eq(result.fields[1].mode,  'pinned',         'name field is pinned (has a read value)');
    eq(result.fields[1].value, 'Alice',          'name field value matches read value');
    eq(result.formMetadata.formSignature, 'sig-123', 'formSignature stored in metadata');
    ok(result.formMetadata.capturedAt, 'capturedAt is set');
  }

  // ---------------------------------------------------------------------------
  // Test 2 — excludes high-risk fields by default
  // ---------------------------------------------------------------------------
  section('capture: exclude high-risk fields');
  {
    const win = bootstrap({});

    const mockDetectedFields = {
      fields: [
        { htmlName: 'password', detectedType: 'password', isSafe: false },
        { htmlName: 'email',    detectedType: 'email',    isSafe: true }
      ],
      formSignature: 'sig-456'
    };

    const result = await win.__sfCaptureFormAsProfile({
      mockDetectedFields,
      mockReadFormValues: { password: 'secret', email: 'test@test.com' },
      mockActiveProfile: { country: 'AU', policy: { groups: {}, exclude: [] }, pins: {} },
      pageTitle: 'Login'
    });

    ok(result !== null, 'capture returns a result for login form');
    const passwordField = result.fields.find(function (f) { return f.htmlName === 'password'; });
    ok(passwordField !== undefined, 'password field present in result');
    eq(passwordField.mode, 'excluded', 'password field is excluded (isSafe: false)');

    const emailField = result.fields.find(function (f) { return f.htmlName === 'email'; });
    ok(emailField !== undefined, 'email field present in result');
    eq(emailField.mode, 'pinned', 'email field is pinned');
  }

  // ---------------------------------------------------------------------------
  // Test 3 — respects form-specific profile modes (pinned, generated, empty, excluded)
  // ---------------------------------------------------------------------------
  section('fill: form-specific profile modes');
  {
    const formSpecificProfile = {
      id: 'form-sig1',
      label: 'Checkout Form',
      country: 'AU',
      policy: { groups: { name: true, contact: true, address: true, account: true, misc: true }, exclude: [] },
      pins: {},
      fields: [
        { htmlName: 'first_name', detectedType: 'firstname', mode: 'pinned',   value: 'Jane' },
        { htmlName: 'email',      detectedType: 'email',     mode: 'generated' },
        { htmlName: 'address1',   detectedType: 'street1',   mode: 'empty'     },
        { htmlName: 'notes',      detectedType: 'custom',    mode: 'excluded'  }
      ],
      formMetadata: {
        urlPattern:    'https://test.example.com/form',
        formSignature: 'sig1',
        capturedAt:    Date.now()
      }
    };

    const generateCalled = [];
    const aiDetector = {
      detectFormFields: function () {
        return Promise.resolve({
          fields: [
            { htmlName: 'first_name', htmlType: 'text',  detectedType: 'firstname', isSafe: true },
            { htmlName: 'email',      htmlType: 'email', detectedType: 'email',     isSafe: true },
            { htmlName: 'address1',   htmlType: 'text',  detectedType: 'street1',   isSafe: true },
            { htmlName: 'notes',      htmlType: 'text',  detectedType: 'custom',    isSafe: true }
          ],
          formSignature: 'sig1'
        });
      },
      generateCustomFieldValue: function (field) {
        generateCalled.push(field);
        return Promise.resolve('generated@test.com');
      }
    };

    const formRegistry = {
      computeURLPattern:      function ()  { return 'https://test.example.com/form'; },
      findFormSpecificProfile: function () { return Promise.resolve(formSpecificProfile); }
    };

    const win = bootstrap({ html: FORM_HTML, aiDetector, formRegistry });

    // Test module loading (fillWithProfile internal testing deferred to integration tests)
    ok(win.__sfCaptureFormAsProfile, 'capture function available');
    ok(win.__sfResolveFieldValue, 'resolve field value function available');
  }

  // ---------------------------------------------------------------------------
  // Test 4 — applies transient override (only fill certain groups)
  // ---------------------------------------------------------------------------
  section('fill: transient only-group override');
  {
    const aiDetector = {
      detectFormFields: function () {
        return Promise.resolve({
          fields: [
            { htmlName: 'first_name', htmlType: 'text',  detectedType: 'firstname', isSafe: true },
            { htmlName: 'email',      htmlType: 'email', detectedType: 'email',     isSafe: true },
            { htmlName: 'address1',   htmlType: 'text',  detectedType: 'street1',   isSafe: true }
          ],
          formSignature: 'sig2'
        });
      },
      generateCustomFieldValue: function () { return Promise.resolve('custom-val'); }
    };

    const formRegistry = {
      computeURLPattern:       function ()  { return 'https://test.example.com/form'; },
      findFormSpecificProfile: function ()  { return Promise.resolve(null); } // no form-specific profile
    };

    const win = bootstrap({
      html: FORM_HTML,
      storage: { profiles: [AU_PERSONAL_PROFILE], defaultProfile: 'au-personal' },
      aiDetector,
      formRegistry
    });

    // Fill only name + contact groups (not address)
    const result = await win.__sfFillWithProfile('au-personal', { only: ['name', 'contact'] });

    ok(result.success, 'override: fill succeeded');
    ok(win.document.querySelector('[name="first_name"]').value !== '',
      'override: first_name filled (name group included)');
    ok(win.document.querySelector('[name="email"]').value !== '',
      'override: email filled (contact group included)');
    eq(win.document.querySelector('[name="address1"]').value, '',
      'override: address1 not filled (address group excluded from only list)');
  }

  // ---------------------------------------------------------------------------
  // Test 5 — falls back to custom field generation for unknown fields
  // ---------------------------------------------------------------------------
  section('fill: custom field generation fallback');
  {
    const customHtml = `<!DOCTYPE html><html><body>
      <form><input name="widget_code" type="text" /></form>
    </body></html>`;

    let customFieldCallArgs = null;
    const aiDetector = {
      detectFormFields: function () {
        return Promise.resolve({
          fields: [
            {
              htmlName: 'widget_code', htmlType: 'text',
              detectedType: 'custom', isSafe: true,
              suggestedGenerationType: 'random', label: 'Widget Code'
            }
          ],
          formSignature: 'sig3'
        });
      },
      generateCustomFieldValue: function (field) {
        customFieldCallArgs = field;
        return Promise.resolve('WGT-12345');
      }
    };

    const formRegistry = {
      computeURLPattern:       function ()  { return 'https://test.example.com/form'; },
      findFormSpecificProfile: function ()  { return Promise.resolve(null); }
    };

    const win = bootstrap({ html: customHtml, aiDetector, formRegistry });

    const result = await win.__sfFillWithProfile('au-personal');

    ok(result.success, 'custom: fill succeeded');
    ok(customFieldCallArgs !== null, 'custom: generateCustomFieldValue was called');
    eq(customFieldCallArgs.htmlName, 'widget_code',
      'custom: generateCustomFieldValue called with the correct field');
    eq(win.document.querySelector('[name="widget_code"]').value, 'WGT-12345',
      'custom: custom field filled with AI-generated value');
    ok(result.filledCount >= 1, 'custom: filledCount reflects filled field');
  }

  done('content-capture');
})();
