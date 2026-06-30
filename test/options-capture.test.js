/**
 * Task 5: Options page — form-specific profile editor
 * Tests: static wiring + DOM rendering of field mode controls
 */

const { ok, eq, section, done } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');

// ──────────────────────────────────────────────────────────
// Section 1: Static HTML assertions
// ──────────────────────────────────────────────────────────
section('HTML: form-specific profile section');
const html = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
ok(html.includes('formSpecificProfileSection'), 'options.html has #formSpecificProfileSection');
ok(html.includes('formProfileLabel'),           'options.html has #formProfileLabel');
ok(html.includes('formProfileUrl'),             'options.html has #formProfileUrl');
ok(html.includes('formProfileCapturedAt'),      'options.html has #formProfileCapturedAt');
ok(html.includes('formFieldsTable'),            'options.html has #formFieldsTable');
ok(html.includes('addFieldBtn'),                'options.html has #addFieldBtn');
ok(html.includes('deleteFormProfileBtn'),       'options.html has #deleteFormProfileBtn');
ok(html.includes('saveFormProfileBtn'),         'options.html has #saveFormProfileBtn');
ok(html.includes('addFieldToFormProfile'),      'options.html wires addFieldToFormProfile');
ok(html.includes('deleteFormProfile'),          'options.html wires deleteFormProfile');
ok(html.includes('saveFormProfile'),            'options.html wires saveFormProfile');

// ──────────────────────────────────────────────────────────
// Section 2: Static JS assertions
// ──────────────────────────────────────────────────────────
section('JS: required functions present');
const js = fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8');
ok(js.includes('renderFormSpecificProfileEditor'), 'options.js has renderFormSpecificProfileEditor');
ok(js.includes('updateFieldMode'),                 'options.js has updateFieldMode');
ok(js.includes('updateFieldValue'),                'options.js has updateFieldValue');
ok(js.includes('previewGeneratedValue'),           'options.js has previewGeneratedValue');
ok(js.includes('addFieldToFormProfile'),           'options.js has addFieldToFormProfile');
ok(js.includes('deleteFormProfile'),               'options.js has deleteFormProfile');
ok(js.includes('saveFormProfile'),                 'options.js has saveFormProfile');
ok(js.includes('formMetadata'),                    'options.js branches on formMetadata in renderEditor');
ok(js.includes('__sfOptions'),                     'options.js exposes __sfOptions test handle');

// ──────────────────────────────────────────────────────────
// Section 3: DOM rendering — field mode controls + mode update
// ──────────────────────────────────────────────────────────
section('DOM: field mode controls');

// A form-specific profile (the kind Task 4 / capture flow will produce)
const FORM_PROFILE = {
  id: 'captured-checkout',
  label: 'Checkout Form',
  formMetadata: {
    url: 'https://example.com/checkout',
    capturedAt: '2026-06-30T10:00:00Z'
  },
  fields: [
    { name: 'email',       htmlType: 'email',    mode: 'generated', value: '' },
    { name: 'firstName',   htmlType: 'text',     mode: 'pinned',    value: 'Alice' },
    { name: 'newsletter',  htmlType: 'checkbox', mode: 'excluded',  value: '' },
    { name: 'comments',    htmlType: 'textarea', mode: 'empty',     value: '' }
  ]
};

const GENERIC_PROFILE = {
  id: 'au-personal', label: 'AU Personal', country: 'AU', randomize: true,
  policy: { groups: { name:true, contact:true, address:true, account:true, misc:false }, exclude:[] },
  pins: {}
};

(async () => {
  // ── Bootstrap ──────────────────────────────────────────
  // Load the actual options.html so all DOM ids exist
  const optHtml = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
  const dom = new JSDOM(optHtml, { runScripts: 'outside-only', pretendToBeVisual: true });
  const ctx = dom.getInternalVMContext();
  const win = dom.window;

  // Load deps (same order as options.html <script> tags)
  for (const f of ['recommendations.js', 'vendor/address-schemas.js', 'formdata.js', 'profile-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }

  // Chrome mock — storage pre-seeded with both profiles
  win.chrome = makeChrome({
    profiles: [GENERIC_PROFILE, FORM_PROFILE]
  });

  // Intercept document.addEventListener to capture the DOMContentLoaded callback
  // (JSDOM has already fired DOMContentLoaded internally; we replay it manually)
  let capturedDCL = null;
  const origAdd = win.document.addEventListener.bind(win.document);
  win.document.addEventListener = function (type, cb, ...rest) {
    if (type === 'DOMContentLoaded' && !capturedDCL) capturedDCL = cb;
    return origAdd(type, cb, ...rest);
  };

  // Load options.js — registers the DOMContentLoaded handler
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'options.js'), 'utf8'), ctx, { filename: 'options.js' });

  // Manually invoke the captured handler (replaces the missed browser event)
  ok(typeof capturedDCL === 'function', 'DOMContentLoaded handler was registered');
  if (capturedDCL) await capturedDCL();

  // ── Verify test handle ──────────────────────────────────
  ok(win.__sfOptions && typeof win.__sfOptions.getProfiles === 'function', '__sfOptions.getProfiles exposed');
  ok(win.__sfOptions && typeof win.__sfOptions.renderEditor === 'function',  '__sfOptions.renderEditor exposed');

  // ── Click the form profile in the list → triggers renderEditor ───────────
  const profileList = win.document.getElementById('profileList');
  ok(profileList, '#profileList exists after init');

  // Find the button whose text matches the form profile label
  const listBtns = profileList ? Array.from(profileList.querySelectorAll('button')) : [];
  const captureBtn = listBtns.find(b => b.textContent.trim() === FORM_PROFILE.label);
  ok(captureBtn, `Profile list contains "${FORM_PROFILE.label}" button`);
  if (captureBtn) captureBtn.click();

  // ── formSpecificProfileSection should now be visible ────────────────────
  const section_el = win.document.getElementById('formSpecificProfileSection');
  ok(section_el && section_el.style.display !== 'none', 'formSpecificProfileSection shown after clicking form profile');

  // ── Header info populated ───────────────────────────────────────────────
  const labelEl   = win.document.getElementById('formProfileLabel');
  const urlEl     = win.document.getElementById('formProfileUrl');
  const captAt    = win.document.getElementById('formProfileCapturedAt');
  ok(labelEl && labelEl.textContent === FORM_PROFILE.label,                     'formProfileLabel shows profile label');
  ok(urlEl   && urlEl.textContent   === FORM_PROFILE.formMetadata.url,          'formProfileUrl shows URL');
  ok(captAt  && captAt.textContent  === FORM_PROFILE.formMetadata.capturedAt,   'formProfileCapturedAt shows timestamp');

  // ── Table rows: one per field ────────────────────────────────────────────
  const tbody = win.document.querySelector('#formFieldsTable tbody');
  ok(tbody, '#formFieldsTable tbody exists');
  const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];
  eq(rows.length, FORM_PROFILE.fields.length, `table has ${FORM_PROFILE.fields.length} rows`);

  // ── Each row has a mode select with all 4 modes ─────────────────────────
  const MODES = ['generated', 'pinned', 'empty', 'excluded'];
  rows.forEach((row, i) => {
    const field = FORM_PROFILE.fields[i];
    const sel = row.querySelector('select');
    ok(sel, `row ${i} (${field.name}) has a mode <select>`);
    if (!sel) return;

    const optValues = Array.from(sel.options).map(o => o.value);
    MODES.forEach(m => ok(optValues.includes(m), `row ${i} mode select has option "${m}"`));
    eq(sel.value, field.mode, `row ${i} select pre-set to "${field.mode}"`);
  });

  // ── Pinned field has a text input for value ──────────────────────────────
  const pinnedRow = rows.find((_, i) => FORM_PROFILE.fields[i].mode === 'pinned');
  ok(pinnedRow, 'a pinned row exists');
  if (pinnedRow) {
    const valueInput = pinnedRow.querySelector('input[type="text"]');
    ok(valueInput, 'pinned row has a text input for value');
    eq(valueInput && valueInput.value, 'Alice', 'pinned row input pre-filled with pinned value');
  }

  // ── Generated field has a Preview button ────────────────────────────────
  const generatedRow = rows.find((_, i) => FORM_PROFILE.fields[i].mode === 'generated');
  if (generatedRow) {
    const previewBtn = generatedRow.querySelector('button');
    ok(previewBtn, 'generated row has a Preview button');
  }

  // ──────────────────────────────────────────────────────────
  // Section 4: Mode dropdown change updates the profile in memory
  // ──────────────────────────────────────────────────────────
  section('DOM: updating field mode via dropdown');

  // Change the 'email' field (index 0) from 'generated' to 'pinned'
  const emailRow = rows[0];
  const emailSel = emailRow ? emailRow.querySelector('select') : null;
  ok(emailSel, 'email row has a mode select');

  if (emailSel) {
    emailSel.value = 'pinned';
    emailSel.dispatchEvent(new win.Event('change'));

    // updateFieldMode should have patched profiles in memory
    const updatedProfiles = win.__sfOptions.getProfiles();
    const updatedForm = updatedProfiles.find(p => p.id === FORM_PROFILE.id);
    ok(updatedForm, 'updated profile still exists');
    ok(updatedForm && updatedForm.fields[0].mode === 'pinned',
      'field[0].mode updated to "pinned" in profiles');
  }

  // ──────────────────────────────────────────────────────────
  // Section 5: Generic profile still shows generic editor
  // ──────────────────────────────────────────────────────────
  section('DOM: generic profile shows generic editor, not form section');

  win.__sfOptions.renderEditor(GENERIC_PROFILE.id);

  const formSectionAfter = win.document.getElementById('formSpecificProfileSection');
  ok(!formSectionAfter || formSectionAfter.style.display === 'none',
    'formSpecificProfileSection hidden when editing generic profile');
  const genericEditor = win.document.getElementById('profileEditor');
  ok(genericEditor && genericEditor.style.display !== 'none',
    '#profileEditor visible for generic profile');

  done('options-capture');
})();
