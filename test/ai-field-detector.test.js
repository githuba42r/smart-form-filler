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
    eq(value, '', 'customVal fallback: no appropriate value → empty (never text_<type>)');
  }

  // -------------------------------------------------------------------------
  // Test 5b: local fallback picks a value from the field's type and wording
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageError: 'LLM unavailable' });
    const G = win.SFAIDetector.generateCustomFieldValue;
    eq(await G({ htmlName: 'website', htmlType: 'url', detectedType: 'website' }), 'https://www.example.com', 'local: url field');
    eq(await G({ htmlName: 'qty', htmlType: 'number', min: '1', max: '5', detectedType: 'quantity' }), '3', 'local: number respects min/max');
    eq(await G({ htmlName: 'plan', htmlType: 'select-one', options: ['Basic', 'Pro'], detectedType: 'plan' }), 'Basic', 'local: select picks a real option');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(await G({ htmlName: 'start', htmlType: 'date', detectedType: 'date' })), 'local: date input → ISO date');
    const before = win.__sendMessageCallCount();
    eq(await G({ htmlName: 'abn', label: 'ABN', htmlType: 'text', detectedType: 'abn', llmUnavailable: true }), '51 824 753 556', 'local: ABN by label');
    eq(win.__sendMessageCallCount(), before, 'local: llmUnavailable skips the LLM call');
  }

  // -------------------------------------------------------------------------
  // Test 5c: suggestedValue from detection is used without another LLM call;
  //          junk / off-list LLM answers are rejected
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageResponse: { result: 'text_custom' } });
    const G = win.SFAIDetector.generateCustomFieldValue;
    eq(await G({ htmlName: 'job', label: 'Job title', detectedType: 'job_title', suggestedValue: 'Accountant' }), 'Accountant', 'suggested: used as-is');
    eq(win.__sendMessageCallCount(), 0, 'suggested: no LLM call');
    eq(await G({ htmlName: 'nickname', label: 'Nickname', htmlType: 'text', detectedType: 'nickname' }), '', 'junk: "text_custom" from LLM rejected');

    const win2 = bootstrap({ sendMessageResponse: { result: '"premium"\n' } });
    eq(await win2.SFAIDetector.generateCustomFieldValue({ htmlName: 'tier', options: ['Basic', 'Premium'], detectedType: 'tier' }),
      'Premium', 'options: LLM answer matched to option text, quotes stripped');
  }

  // -------------------------------------------------------------------------
  // Test 5d: prompt carries label/name/options; LLM types are normalised
  // -------------------------------------------------------------------------
  {
    let prompt = '';
    const win = bootstrap({ sendMessageResponse: { result: JSON.stringify([
      { htmlName: 'birth', detectedType: 'Date of Birth' },
      { htmlName: 'sname', detectedType: 'surname' },
      { htmlName: 'pc', detectedType: 'postcode' }
    ]) } });
    const send = win.chrome.runtime.sendMessage;
    win.chrome.runtime.sendMessage = function (msg, cb) { prompt = msg.prompt; return send(msg, cb); };
    const res = await win.SFAIDetector.detectFormFields({ url: 'https://example.com/norm', fields: [
      { name: 'birth', type: 'text', label: 'Birthday' },
      { name: 'sname', type: 'text', label: 'Surname' },
      { name: 'pc', type: 'select-one', label: 'Postcode', options: ['4000', '4101'] }
    ] });
    eq(res.fields.map(f => f.detectedType), ['dob', 'lastname', 'zip'], 'normalise: aliases → canonical types');
    ok(prompt.indexOf('"options"') !== -1 && prompt.indexOf('4101') !== -1, 'prompt: includes select options');
    ok(prompt.indexOf('suggestedValue') !== -1, 'prompt: asks for suggestedValue');
  }

  // -------------------------------------------------------------------------
  // Test 5f: fields the LLM omits fall back to heuristics
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageResponse: { result: JSON.stringify([{ htmlName: 'fav', detectedType: 'wine_varietal' }]) } });
    const res = await win.SFAIDetector.detectFormFields({ url: 'https://example.com/gaps', fields: [
      { name: 'fav', type: 'text', label: 'Favourite wine' },
      { name: 'email', type: 'email', label: 'Email' }
    ] });
    eq(res.fields.map(f => f.htmlName + ':' + f.detectedType), ['fav:wine_varietal', 'email:email'], 'omitted field classified by heuristics');
    const empty = bootstrap({ sendMessageResponse: { result: '[]' } });
    const r2 = await empty.SFAIDetector.detectFormFields({ url: 'https://example.com/empty', fields: [{ name: 'email', type: 'email' }] });
    eq(r2.fields.map(f => f.detectedType), ['email'], 'empty LLM answer → heuristics for every field');
  }

  // -------------------------------------------------------------------------
  // Test 5e: heuristics — split DOB parts are dob, other dates are not
  // -------------------------------------------------------------------------
  {
    const win = bootstrap({ sendMessageError: 'down' });
    const res = await win.SFAIDetector.detectFormFields({ url: 'https://example.com/dob', fields: [
      { name: 'dob_day', type: 'select-one', label: 'Day' },
      { name: 'birthMonth', type: 'select-one', label: 'Month' },
      { name: 'year', type: 'select-one', label: 'Year', context: 'Date of birth' },
      { name: 'start_date', type: 'date', label: 'Start date' }
    ] });
    eq(res.fields.map(f => f.detectedType), ['dob', 'dob', 'dob', 'date'], 'heuristic: DOB parts vs generic date');
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
