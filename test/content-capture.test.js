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
  // --- Test 1: captures a form as a profile ---
  {
    const win = bootstrap({});

    const mockDetectedFields = {
      fields: [
        { htmlName: 'email', detectedType: 'email', isSafe: true },
        { htmlName: 'name', detectedType: 'firstName', isSafe: true }
      ],
      formSignature: 'sig-123'
    };

    const mockReadFormValues = {
      email: 'alice@test.com',
      name: 'Alice'
    };

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
    ok(result.formMetadata && result.formMetadata.urlPattern !== undefined, 'result.formMetadata.urlPattern is defined');
    eq(result.fields.length, 2, 'result has 2 fields');
    eq(result.fields[0].mode, 'pinned', 'email field is pinned (has a read value)');
    eq(result.fields[0].value, 'alice@test.com', 'email field value matches read value');
    eq(result.fields[1].mode, 'pinned', 'name field is pinned (has a read value)');
    eq(result.fields[1].value, 'Alice', 'name field value matches read value');
    eq(result.formMetadata.formSignature, 'sig-123', 'formSignature stored in metadata');
    ok(result.formMetadata.capturedAt, 'capturedAt is set');
  }

  // --- Test 2: excludes high-risk fields by default ---
  {
    const win = bootstrap({});

    const mockDetectedFields = {
      fields: [
        { htmlName: 'password', detectedType: 'password', isSafe: false },
        { htmlName: 'email', detectedType: 'email', isSafe: true }
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
    const passwordField = result.fields.find(f => f.htmlName === 'password');
    ok(passwordField !== undefined, 'password field present in result');
    eq(passwordField.mode, 'excluded', 'password field is excluded (isSafe: false)');

    const emailField = result.fields.find(f => f.htmlName === 'email');
    ok(emailField !== undefined, 'email field present in result');
    eq(emailField.mode, 'pinned', 'email field is pinned');
  }

  done('content-capture');
})();
