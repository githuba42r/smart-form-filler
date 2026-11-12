// test/profile-editor.test.js — per-field Random/Fixed/Skip modes, gender, custom fields:
// data model, settings editor and fill behaviour
const { eq, ok, section, done, loadGlobals } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const run = (ctx, f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const tick = (ms) => new Promise(r => setTimeout(r, ms || 20));
const ALL = { name: true, contact: true, address: true, account: true, misc: true };

function fillPage(html, profile, llm) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://test.example.com/form' });
  const ctx = dom.getInternalVMContext();
  const win = dom.window;
  win.CSS = win.CSS || { escape: s => String(s).replace(/["\\]/g, '\\$&') };
  win.chrome = makeChrome({ profiles: [profile], defaultProfile: profile.id });
  win.__prompts = [];
  win.chrome.runtime.sendMessage = function (msg, cb) {
    if (msg.action !== 'callLLM') { cb && cb({ ok: true }); return; }
    win.__prompts.push(msg.prompt);
    if (!llm) { win.chrome.runtime.lastError = { message: 'down' }; cb(null); win.chrome.runtime.lastError = null; return; }
    cb({ result: llm(msg.prompt) });
  };
  ['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js', 'ai-field-detector.js', 'form-registry.js']
    .forEach(f => run(ctx, f));
  win.__smartFormFillerLoaded = false;
  run(ctx, 'content.js');
  return win;
}

(async () => {
  section('data model: field modes');
  {
    const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;
    const legacy = { policy: { groups: ALL, exclude: ['phone'] }, pins: { business: 'Acme' } };
    eq(F.fieldMode(legacy, 'phone'), 'skip', 'old exclude list reads as Skip');
    eq(F.fieldMode(legacy, 'business'), 'fixed', 'old pin reads as Fixed');
    eq(F.fieldMode(legacy, 'email'), 'random', 'anything else is Random');

    const patch = F.setFieldMode(legacy, 'business', 'random');
    const p2 = Object.assign({}, legacy, patch);
    eq(F.fieldMode(p2, 'business'), 'random', 'mode change stored');
    eq(p2.pins.business, 'Acme', 'stored value kept for when it is fixed again');
    eq(F.effectivePins(p2), {}, 'Random field ignores its stored value');
    const p3 = Object.assign({}, p2, F.setFieldMode(p2, 'email', 'skip'));
    ok(p3.policy.exclude.indexOf('email') !== -1, 'Skip adds to the exclude list');
    ok(!F.shouldFill('email', p3.policy, null), 'skipped field is not filled');
    const p4 = Object.assign({}, p3, F.setFieldMode(p3, 'phone', 'fixed'));
    ok(p4.policy.exclude.indexOf('phone') === -1, 'leaving Skip removes it from the exclude list');

    const fixedAddr = {
      country: 'AU', policy: { groups: ALL, exclude: [] },
      pins: { street1: '1 Fixed St', city: 'Brisbane', firstname: 'Ignored' },
      fieldModes: { firstname: 'random' }
    };
    const a = F.generatePerson(fixedAddr, { seed: 1 }), b = F.generatePerson(fixedAddr, { seed: 2 });
    eq([a.street1, b.street1], ['1 Fixed St', '1 Fixed St'], 'fixed address on every fill');
    ok(a.email !== b.email, 'random email differs between fills');
    ok(a.firstname !== 'Ignored', 'Random first name ignores a stored value');

    const named = F.generatePerson({ country: 'AU', pins: { firstname: 'Zara', lastname: 'Quill' } }, { seed: 3 });
    eq(named.fullname, 'Zara Quill', 'full name built from fixed first + last name');
    ok(/^zara\.quill\.\d+@/.test(named.email), 'email built from fixed names');
    ok(/^zara_quill\d+$/.test(named.username), 'username built from fixed names');
    ok(F.GENDERS.indexOf(named.gender) !== -1, 'gender generated');
    eq(F.groupForField('gender'), 'account', 'gender sits in the account & personal group');
    eq(F.resolveValues({ country: 'AU', policy: { groups: ALL, exclude: [] }, pins: { gender: 'Non-binary' } }).gender,
      'Non-binary', 'fixed gender resolves');
  }

  section('data model: custom field matching');
  {
    const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;
    const cf = { label: 'Delivery instructions', labelHint: 'delivery notes, special instructions', nameHint: 'deliveryNotes' };
    ok(F.customFieldMatches(cf, { label: 'Special Instructions (optional)', name: 'x' }), 'label phrase matches');
    ok(F.customFieldMatches(cf, { label: '', name: 'order[delivery_notes]' }), 'name hint matches across _ [ ] and camelCase');
    ok(!F.customFieldMatches(cf, { label: 'Instructions', name: 'notes' }), 'partial phrase does not match');
    ok(F.customFieldMatches({ label: 'Job title' }, { label: 'Your job title' }), 'no hints: its own label is the hint');
    ok(!F.customFieldMatches({ label: 'Age' }, { label: 'Page count' }), 'whole words only');
    const prof = { customFields: [F.newCustomField({}), { id: 'cf2', label: 'Job title' }] };
    eq(F.newCustomField(prof).id, 'cf3', 'new custom field gets a free id');
    eq(F.matchCustomField(prof, { label: 'Job title' }).id, 'cf2', 'matchCustomField finds the right entry');
  }

  section('settings editor');
  {
    const html = fs.readFileSync(path.join(ROOT, 'options.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com' });
    const win = dom.window, doc = win.document, ctx = dom.getInternalVMContext();
    const chrome = makeChrome({
      profiles: [{ id: 'p1', label: 'P1', country: 'AU', randomize: true,
        policy: { groups: Object.assign({}, ALL, { misc: false }), exclude: ['phone'] }, pins: { business: 'Acme' } }]
    });
    chrome.identity = { getRedirectURL: () => '' }; chrome.tabs = { create() {} };
    chrome.runtime.sendMessage = () => {};
    chrome.storage.onChanged = { addListener() {} };
    win.chrome = chrome;
    win.fetch = () => Promise.reject(new Error('offline'));
    Array.from(doc.querySelectorAll('script[src]')).forEach(s => run(ctx, s.getAttribute('src')));
    await tick(50);
    win.__sfOptions.renderEditor('p1');
    const stored = async () => (await chrome.storage.local.get(['profiles'])).profiles[0];
    const row = k => doc.querySelector(`.pe-row[data-field="${k}"]`);
    const modeBtn = (k, m) => row(k).querySelector(`[data-mode="${m}"]`);
    const active = k => row(k).querySelector('.seg .active').dataset.mode;

    ['firstname', 'email', 'emailDomain', 'phone', 'street1', 'dob', 'gender', 'business'].forEach(k =>
      ok(row(k) && row(k).querySelector('.seg') && row(k).querySelector('input[type="text"]'),
        `${k}: mode and value on one row`));
    eq(doc.querySelectorAll('.pe-row input[type="checkbox"]').length, 0, 'no separate exclude checkboxes');
    eq(active('phone'), 'skip', 'excluded field shows Skip');
    ok(row('phone').querySelector('input').disabled, 'Skip disables the value');
    eq(active('business'), 'fixed', 'pinned field shows Fixed');
    eq(row('business').querySelector('input').value, 'Acme', 'fixed value shown');
    eq(active('email'), 'random', 'other fields show Random');
    ok(/Random — e\.g\./.test(row('firstname').querySelector('input').placeholder), 'Random shows a sample value');
    eq(row('zip').querySelector('.pe-name').textContent, 'Postcode', 'address labels follow the country');
    ok(doc.querySelector('.pe-group[data-group="misc"]').classList.contains('off'), 'disabled group is shown as off');
    ok(row('emailDomain').querySelector('[data-mode="skip"]') === null, 'email domain has no Skip');

    // Type a fixed value; it becomes Fixed and is saved
    const fn = row('firstname').querySelector('input');
    fn.value = 'Zara';
    fn.dispatchEvent(new win.Event('input'));
    fn.dispatchEvent(new win.Event('change'));
    await tick();
    eq(active('firstname'), 'fixed', 'typing a value switches to Fixed');
    let p = await stored();
    eq([p.pins.firstname, p.fieldModes.firstname], ['Zara', 'fixed'], 'fixed value saved');

    modeBtn('firstname', 'random').click();
    await tick();
    p = await stored();
    eq(p.fieldModes.firstname, 'random', 'Random saved');
    eq(p.pins.firstname, 'Zara', 'stored value kept while Random');
    eq(row('firstname').querySelector('input').value, '', 'Random hides the stored value');
    modeBtn('firstname', 'fixed').click();
    await tick();
    eq(row('firstname').querySelector('input').value, 'Zara', 'back to Fixed restores the value');

    modeBtn('email', 'skip').click();
    await tick();
    p = await stored();
    ok(p.policy.exclude.indexOf('email') !== -1, 'Skip saved to the exclude list');
    modeBtn('phone', 'random').click();
    await tick();
    ok((await stored()).policy.exclude.indexOf('phone') === -1, 'leaving Skip saved');

    const dob = row('dob').querySelector('input');
    dob.value = '7 Mar 1985';
    dob.dispatchEvent(new win.Event('change'));
    await tick();
    eq((await stored()).pins.dob, '1985-03-07', 'fixed DOB normalised to ISO');

    doc.getElementById('group-misc').click();
    await tick();
    eq((await stored()).policy.groups.misc, true, 'group toggle saved');
    ok(!doc.querySelector('.pe-group[data-group="misc"]').classList.contains('off'), 'group shown as on');

    // Custom fields
    const chip = Array.from(doc.querySelectorAll('.pe-chip')).find(b => /Delivery instructions/.test(b.textContent));
    chip.click();
    await tick();
    p = await stored();
    eq(p.customFields.length, 1, 'preset custom field added');
    eq([p.customFields[0].label, p.customFields[0].mode], ['Delivery instructions', 'fixed'], 'preset values');
    doc.getElementById('peAddCustom').click();
    await tick();
    const blocks = doc.querySelectorAll('.pe-cf');
    eq(blocks.length, 2, 'blank custom field added');
    const [name, value] = blocks[1].querySelectorAll('.pe-row input[type="text"]');
    name.value = 'Loyalty number'; name.dispatchEvent(new win.Event('change'));
    await tick();
    blocks[1].querySelector('[data-mode="random"]').click();
    await tick();
    const hint = blocks[1].querySelector('.pe-hints input[id$="nameHint"]');
    hint.value = 'loyalty, member_no'; hint.dispatchEvent(new win.Event('change'));
    await tick();
    p = await stored();
    eq([p.customFields[1].label, p.customFields[1].mode, p.customFields[1].nameHint],
      ['Loyalty number', 'random', 'loyalty, member_no'], 'custom field edits saved');
    ok(value.disabled === false && /AI chooses/.test(value.placeholder), 'Random custom field: AI chooses');
    blocks[0].querySelector('.pe-del').click();
    await tick();
    p = await stored();
    eq(p.customFields.map(c => c.label), ['Loyalty number'], 'custom field removed');
  }

  section('fill: custom fields, gender, fixed and random values');
  {
    const profile = {
      id: 'p', label: 'P', country: 'AU', randomize: true,
      policy: { groups: ALL, exclude: [] },
      pins: { street1: '9 Fixed Road', firstname: 'Zara', gender: 'Female' },
      customFields: [
        { id: 'cf1', label: 'Delivery instructions', labelHint: 'delivery instructions', nameHint: '', mode: 'fixed', value: 'Ring the bell' },
        { id: 'cf2', label: 'Promo code', labelHint: 'promo', nameHint: 'coupon', mode: 'skip' },
        { id: 'cf3', label: 'Favourite grape variety', labelHint: '', nameHint: 'grape', mode: 'random' },
        { id: 'cf4', label: 'Date of birth', labelHint: 'date of birth', mode: 'fixed', value: '1990-12-25' }
      ]
    };
    const html = `<!DOCTYPE html><html><body><form>
      <label for="fn">First name</label><input id="fn" name="first_name" />
      <label for="em">Email</label><input id="em" name="email" type="email" />
      <label for="st">Street address</label><input id="st" name="street" />
      <label for="di">Delivery instructions</label><textarea id="di" name="notes"></textarea>
      <label for="pc">Promo</label><input id="pc" name="coupon_code" />
      <label for="gr">Grape</label><input id="gr" name="grape_pref" />
      <label for="db">Date of birth</label><input id="db" name="dob" placeholder="DD MMM YYYY" />
      <label for="sx">Gender</label><select id="sx" name="sex"><option value="">Select…</option><option value="M">Man</option><option value="F">Woman</option></select>
      <fieldset><legend>Title gender</legend>
        <label><input type="radio" name="g2" value="male"> Male</label>
        <label><input type="radio" name="g2" value="female"> Female</label>
      </fieldset>
    </form></body></html>`;

    for (const llmUp of [false, true]) {
      const win = fillPage(html, profile, llmUp
        ? (prompt) => /describes this field as "Favourite grape variety"/.test(prompt) ? 'Shiraz' : '[]'
        : null);
      const res = await win.__sfFillWithProfile('p');
      const v = n => win.document.querySelector(`[name="${n}"]`).value;
      const tag = llmUp ? '(AI up)' : '(AI down)';
      ok(res.success, `fill succeeded ${tag}`);
      eq(v('first_name'), 'Zara', `fixed first name ${tag}`);
      ok(/^zara\./.test(v('email')), `random email follows the fixed name ${tag}`);
      eq(v('street'), '9 Fixed Road', `fixed street ${tag}`);
      eq(v('notes'), 'Ring the bell', `fixed custom field ${tag}`);
      eq(v('coupon_code'), '', `skipped custom field left alone ${tag}`);
      eq(v('dob'), '25 Dec 1990', `custom DOB rendered in the field format ${tag}`);
      eq(v('sex'), 'F', `gender select matched "Woman" ${tag}`);
      ok(win.document.querySelector('[name="g2"][value="female"]').checked, `gender radio ticked ${tag}`);
      ok(!win.document.querySelector('[name="g2"][value="male"]').checked, `other radio left unticked ${tag}`);
      if (llmUp) eq(v('grape_pref'), 'Shiraz', 'random custom field chosen by the AI using its label');
    }

    // Group fills ("Fill name") leave custom fields alone
    const win = fillPage(html, profile, null);
    await win.__sfFillWithProfile('p', { only: ['name', 'contact'] });
    eq(win.document.querySelector('[name="notes"]').value, '', 'group fill skips custom fields');
    eq(win.document.querySelector('[name="first_name"]').value, 'Zara', 'group fill still fills names');
  }

  done('profile-editor');
})();
