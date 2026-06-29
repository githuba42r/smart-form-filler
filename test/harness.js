const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

function loadGlobals(files, html = '<!DOCTYPE html><body></body>') {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const ctx = dom.getInternalVMContext();
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return dom.window;
}

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ ' + msg); } }
const ok = assert;
function eq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function section(name) { console.log('  -- ' + name); }
function done(name) {
  console.log(`${failed === 0 ? '✓' : '✗'} ${name}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
module.exports = { loadGlobals, assert, ok, eq, section, done };
