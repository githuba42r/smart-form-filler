const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals([
  'vendor/address-schemas.js',
  'formdata.js',
  'ai-field-detector.js',
  'form-registry.js'
]);

const D = win.SFAIDetector, R = win.SFFormRegistry, F = win.SFFormData;

// Verify all modules loaded
ok(typeof D === 'object', 'SFAIDetector exists');
ok(typeof D.detectFormFields === 'function', 'detectFormFields exists');
ok(typeof D.generateCustomFieldValue === 'function', 'generateCustomFieldValue exists');

ok(typeof R === 'object', 'SFFormRegistry exists');
ok(typeof R.findFormSpecificProfile === 'function', 'findFormSpecificProfile exists');
ok(typeof R.computeURLPattern === 'function', 'computeURLPattern exists');

ok(typeof F === 'object', 'SFFormData exists');
ok(typeof F.CUSTOM_GENERATORS === 'object', 'CUSTOM_GENERATORS exists');
ok(typeof F.generateCustomFieldValue === 'function', 'generateCustomFieldValue exists');

// Test URL pattern extraction
const url1 = R.computeURLPattern('https://example.com/checkout?ref=promo#step2');
eq(url1, 'https://example.com/checkout', 'URL pattern strips query and fragment');

// Test custom generators still work
const sku = F.generateCustomFieldValue('sku');
ok(/^[A-Z]{3}-\d{5}$/.test(sku), `Custom SKU generator works: ${sku}`);

const fallback = F.generateCustomFieldValue('unknown_custom_type');
ok(fallback.startsWith('text_'), `Fallback generator works: ${fallback}`);

done('ai-integration-complete');
