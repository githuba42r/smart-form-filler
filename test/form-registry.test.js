// test/form-registry.test.js — TDD tests for window.SFFormRegistry
const { ok, eq, done } = require('./harness');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function bootstrap() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://example.com'
  });
  const ctx = dom.getInternalVMContext();
  const win = dom.window;

  // Minimal chrome stub
  win.chrome = {
    storage: {
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve()
      }
    }
  };

  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'form-registry.js'), 'utf8'), ctx,
    { filename: 'form-registry.js' }
  );

  return win;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GENERIC_PROFILE = { id: 'au-personal', label: 'AU Personal', country: 'AU' };

const FORM_PROFILE_CHECKOUT = {
  id: 'form-checkout',
  label: 'Checkout Form',
  country: 'AU',
  formMetadata: {
    urlPattern: 'https://shop.example.com/checkout',
    formSignature: 'abc123'
  }
};

const FORM_PROFILE_LOGIN = {
  id: 'form-login',
  label: 'Login Form',
  country: 'AU',
  formMetadata: {
    urlPattern: 'https://shop.example.com/login',
    formSignature: 'def456'
  }
};

const ALL_PROFILES = [GENERIC_PROFILE, FORM_PROFILE_CHECKOUT, FORM_PROFILE_LOGIN];

(async () => {
  const win = bootstrap();
  const R = win.SFFormRegistry;

  // ---------------------------------------------------------------------------
  // Test 1: computeURLPattern strips query string and fragment
  // ---------------------------------------------------------------------------
  {
    const result = R.computeURLPattern('https://example.com/checkout?ref=promo#step2');
    eq(result, 'https://example.com/checkout', 'computeURLPattern: strips query + fragment');
  }

  // ---------------------------------------------------------------------------
  // Test 2: computeURLPattern preserves origin + pathname
  // ---------------------------------------------------------------------------
  {
    const result = R.computeURLPattern('https://shop.example.com/checkout');
    eq(result, 'https://shop.example.com/checkout', 'computeURLPattern: preserves origin + pathname as-is');
  }

  // ---------------------------------------------------------------------------
  // Test 3: computeURLPattern handles URLs with no query or fragment
  // ---------------------------------------------------------------------------
  {
    const result = R.computeURLPattern('https://example.com/path/to/page');
    eq(result, 'https://example.com/path/to/page', 'computeURLPattern: plain URL unchanged');
  }

  // ---------------------------------------------------------------------------
  // Test 4: findFormSpecificProfile matches by urlPattern + formSignature
  // ---------------------------------------------------------------------------
  {
    const profile = await R.findFormSpecificProfile(
      'https://shop.example.com/checkout',
      'abc123',
      { mockProfiles: ALL_PROFILES }
    );
    ok(profile !== null, 'findFormSpecificProfile: returns a profile when matched');
    eq(profile.id, 'form-checkout', 'findFormSpecificProfile: returns the correct profile');
  }

  // ---------------------------------------------------------------------------
  // Test 5: findFormSpecificProfile returns null if no match
  // ---------------------------------------------------------------------------
  {
    const profile = await R.findFormSpecificProfile(
      'https://shop.example.com/checkout',
      'nomatch999',
      { mockProfiles: ALL_PROFILES }
    );
    eq(profile, null, 'findFormSpecificProfile: returns null when signature does not match');
  }

  // ---------------------------------------------------------------------------
  // Test 6: findFormSpecificProfile does not match generic profiles
  // ---------------------------------------------------------------------------
  {
    const profile = await R.findFormSpecificProfile(
      'https://anything.com/path',
      'whatever',
      { mockProfiles: [GENERIC_PROFILE] }
    );
    eq(profile, null, 'findFormSpecificProfile: ignores profiles without formMetadata');
  }

  // ---------------------------------------------------------------------------
  // Test 7: findFormSpecificProfile matches by URL pattern (origin + pathname, ignoring query)
  // ---------------------------------------------------------------------------
  {
    // The caller is expected to pass a computed URL pattern (no query/fragment).
    // This test verifies that using computeURLPattern output as input works end-to-end.
    const urlPattern = R.computeURLPattern('https://shop.example.com/login?session=xyz#anchor');
    const profile = await R.findFormSpecificProfile(
      urlPattern,
      'def456',
      { mockProfiles: ALL_PROFILES }
    );
    ok(profile !== null, 'findFormSpecificProfile: end-to-end match via computeURLPattern output');
    eq(profile.id, 'form-login', 'findFormSpecificProfile: end-to-end returns correct profile');
  }

  done('form-registry');
})();
