// test/ai-field-detector.test.js — TDD tests for window.SFAIDetector
const { ok, eq, done } = require('./harness');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

/**
 * Bootstrap a jsdom environment with a mocked chrome.runtime.sendMessage.
 *
 * @param {object} opts
 * @param {object|null} opts.sendMessageResponse  – response to return, e.g. { result: '...' }
 * @param {string|null}  opts.sendMessageError     – if set, simulate a runtime error
 */
function bootstrap({ sendMessageResponse, sendMessageError } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://example.com' // required for localStorage to work in jsdom
  });
  const ctx = dom.getInternalVMContext();
  const win = dom.window;

  // Track how many times sendMessage was invoked
  let sendMessageCallCount = 0;

  // Minimal chrome stub — sendMessage calls callback synchronously so Promises
  // resolve cleanly without dangling 10-second timers in the test runner.
  win.chrome = {
    runtime: {
      lastError: null,
      sendMessage(msg, callback) {
        sendMessageCallCount++;
        if (sendMessageError) {
          win.chrome.runtime.lastError = { message: sendMessageError };
          callback(null);
          win.chrome.runtime.lastError = null;
        } else {
          callback(sendMessageResponse !== undefined ? sendMessageResponse : { result: '[]' });
        }
      }
    },
    storage: {
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve()
      }
    }
  };

  // Expose call count inspector to Node.js caller
  win.__sendMessageCallCount = () => sendMessageCallCount;

  // Load vendor deps, formdata, and the module under test
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'vendor/address-schemas.js'), 'utf8'), ctx,
    { filename: 'vendor/address-schemas.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'formdata.js'), 'utf8'), ctx,
    { filename: 'formdata.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'ai-field-detector.js'), 'utf8'), ctx,
    { filename: 'ai-field-detector.js' }
  );

  return win;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_FIELDS = [
  { name: 'email',      type: 'email', label: 'Email Address', ariaLabel: '', placeholder: '' },
  { name: 'first_name', type: 'text',  label: 'First Name',    ariaLabel: '', placeholder: '' },
  { name: 'last_name',  type: 'text',  label: 'Last Name',     ariaLabel: '', placeholder: '' },
  { name: 'phone',      type: 'tel',   label: 'Phone',         ariaLabel: '', placeholder: '' }
];

const LLM_DETECTED_FIELDS = [
  { htmlName: 'email',      htmlType: 'email', label: 'Email Address', detectedType: 'email',     isSafe: true,  confidence: 0.95, suggestedGenerationType: 'faker' },
  { htmlName: 'first_name', htmlType: 'text',  label: 'First Name',    detectedType: 'firstname', isSafe: true,  confidence: 0.90, suggestedGenerationType: 'faker' },
  { htmlName: 'last_name',  htmlType: 'text',  label: 'Last Name',     detectedType: 'lastname',  isSafe: true,  confidence: 0.90, suggestedGenerationType: 'faker' },
  { htmlName: 'phone',      htmlType: 'tel',   label: 'Phone',         detectedType: 'phone',     isSafe: true,  confidence: 0.88, suggestedGenerationType: 'faker' }
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

(async () => {
  // -------------------------------------------------------------------------
  // Test 1: detectFormFields detects form fields via LLM
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageResponse: { result: JSON.stringify(LLM_DETECTED_FIELDS) } });
    const result = await win.SFAIDetector.detectFormFields({
      fields: SAMPLE_FIELDS,
      url: 'https://example.com/form1'
    });

    ok(Array.isArray(result.fields), 'LLM: result.fields is an array');
    eq(result.fields.length, 4, 'LLM: returns all 4 detected fields');
    eq(result.fields[0].detectedType, 'email', 'LLM: first field detected as email');
    eq(result.fields[1].detectedType, 'firstname', 'LLM: second field detected as firstname');
    ok(typeof result.formSignature === 'string' && result.formSignature.length > 0, 'LLM: formSignature is a non-empty string');
    ok(!result.error, 'LLM: no error on successful detection');
    eq(win.__sendMessageCallCount(), 1, 'LLM: sendMessage called exactly once');
  }

  // -------------------------------------------------------------------------
  // Test 2: detectFormFields caches detection results by URL + signature
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageResponse: { result: JSON.stringify(LLM_DETECTED_FIELDS) } });
    const url = 'https://example.com/form2';

    const r1 = await win.SFAIDetector.detectFormFields({ fields: SAMPLE_FIELDS, url });
    const r2 = await win.SFAIDetector.detectFormFields({ fields: SAMPLE_FIELDS, url });

    eq(win.__sendMessageCallCount(), 1, 'cache: LLM called only once for same URL + signature');
    eq(r1.fields.length, r2.fields.length, 'cache: same number of fields returned from cache');
    eq(r1.formSignature, r2.formSignature, 'cache: same formSignature on both calls');

    // Verify getFieldDetectionCache API
    const cached = win.SFAIDetector.getFieldDetectionCache(url);
    ok(cached !== null, 'cache: getFieldDetectionCache returns entry for known URL');
    eq(cached.signature, r1.formSignature, 'cache: cached signature matches returned signature');
    ok(Array.isArray(cached.fields), 'cache: cached entry contains fields array');
  }

  // -------------------------------------------------------------------------
  // Test 3: detectFormFields returns error gracefully if LLM fails
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageError: 'LLM service unavailable' });
    const result = await win.SFAIDetector.detectFormFields({
      fields: SAMPLE_FIELDS,
      url: 'https://example.com/form3'
    });

    ok(Array.isArray(result.fields), 'fallback: fields array returned even when LLM fails');
    ok(result.fields.length > 0, 'fallback: heuristic fields populated');
    ok(typeof result.error === 'string', 'fallback: error string present');
    ok(typeof result.formSignature === 'string', 'fallback: formSignature still returned');

    // Heuristic should detect the email field correctly
    const emailField = result.fields.find(f => f.htmlName === 'email');
    ok(emailField !== undefined, 'fallback: email field present in heuristic results');
    eq(emailField.detectedType, 'email', 'fallback: email field heuristically detected as email');

    // Heuristic should flag nothing as unsafe in this set
    ok(result.fields.every(f => typeof f.isSafe === 'boolean'), 'fallback: all fields have isSafe boolean');
  }

  // -------------------------------------------------------------------------
  // Test 4: generateCustomFieldValue generates a value for a custom field
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageResponse: { result: 'Acme Corporation' } });
    const field = { htmlName: 'company_name', detectedType: 'custom', type: 'text' };
    const value = await win.SFAIDetector.generateCustomFieldValue(field);

    ok(typeof value === 'string', 'customVal: returns a string');
    ok(value.length > 0, 'customVal: value is non-empty');
    eq(value, 'Acme Corporation', 'customVal: uses trimmed LLM response');
    eq(win.__sendMessageCallCount(), 1, 'customVal: LLM called once');
  }

  // -------------------------------------------------------------------------
  // Test 5: generateCustomFieldValue falls back gracefully if LLM fails
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageError: 'LLM unavailable' });
    const field = { htmlName: 'widget_code', detectedType: 'widget_code', type: 'text' };
    const value = await win.SFAIDetector.generateCustomFieldValue(field);

    ok(typeof value === 'string', 'customVal fallback: returns a string');
    ok(value.length > 0, 'customVal fallback: value is non-empty');
    ok(value.indexOf('widget_code') !== -1, 'customVal fallback: fallback string includes the type name');
  }

  // -------------------------------------------------------------------------
  // Test 6: clearDetectionCache wipes cached entries
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageResponse: { result: JSON.stringify(LLM_DETECTED_FIELDS) } });
    const url = 'https://example.com/form6';

    await win.SFAIDetector.detectFormFields({ fields: SAMPLE_FIELDS, url });
    ok(win.SFAIDetector.getFieldDetectionCache(url) !== null, 'clear: cache populated before clear');

    win.SFAIDetector.clearDetectionCache();
    eq(win.SFAIDetector.getFieldDetectionCache(url), null, 'clear: cache null after clearDetectionCache');
  }

  // -------------------------------------------------------------------------
  // Test 7: different field sets at same URL bust the cache
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageResponse: { result: JSON.stringify(LLM_DETECTED_FIELDS) } });
    const url = 'https://example.com/form7';

    await win.SFAIDetector.detectFormFields({ fields: SAMPLE_FIELDS, url });

    const differentFields = [
      { name: 'username', type: 'text', label: 'Username', ariaLabel: '', placeholder: '' }
    ];
    await win.SFAIDetector.detectFormFields({ fields: differentFields, url });

    eq(win.__sendMessageCallCount(), 2, 'signature: different field set causes new LLM call at same URL');
  }

  // -------------------------------------------------------------------------
  // Test 8: getFieldDetectionCache returns null for unknown URL
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({});
    const result = win.SFAIDetector.getFieldDetectionCache('https://never-visited.com/form');
    eq(result, null, 'getFieldDetectionCache: returns null for unknown URL');
  }

  done('ai-field-detector');
})();
