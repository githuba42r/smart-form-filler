// test/content-dob-fill.test.js — DOB rendering per control + AI-chosen values for non-standard fields
const { eq, ok, section, done } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

const PROFILE = {
  id: 'au-personal', label: 'AU Personal', country: 'AU', randomize: true,
  policy: { groups: { name: true, contact: true, address: true, account: true, misc: true }, exclude: [] },
  pins: { dob: '1984-02-09' }
};

// llm: null → LLM unavailable; otherwise fn(prompt) → result string
function bootstrap(html, llm) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://test.example.com/form' });
  const ctx = dom.getInternalVMContext();
  const win = dom.window;
  win.CSS = win.CSS || { escape: s => String(s).replace(/["\\]/g, '\\$&') }; // jsdom lacks CSS.escape
  win.chrome = makeChrome({ profiles: [PROFILE], defaultProfile: 'au-personal' });
  win.__prompts = [];
  win.__busy = [];
  win.chrome.runtime.sendMessage = function (msg, cb) {
    if (msg.action === 'aiBusy') { win.__busy.push(msg.busy); cb && cb({ ok: true }); return; }
    win.__prompts.push(msg.prompt);
    if (!llm) { win.chrome.runtime.lastError = { message: 'down' }; cb(null); win.chrome.runtime.lastError = null; return; }
    cb({ result: llm(msg.prompt) });
  };
  for (const f of ['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js', 'ai-field-detector.js', 'form-registry.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  win.__smartFormFillerLoaded = false;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'), ctx, { filename: 'content.js' });
  return win;
}

const DOB_HTML = `<!DOCTYPE html><html><body><form>
  <input name="dob_text" type="text" placeholder="DD/MM/YYYY" />
  <input name="birthdate" type="date" />
  <input name="birthday_us" type="text" placeholder="mm-dd-yyyy" />
  <fieldset><legend>Date of birth</legend>
    <select name="d"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join('')}</select>
    <select name="m"><option value="">Month</option>${['January','February','March','April','May','June','July','August','September','October','November','December'].map((n, i) => `<option value="${String(i + 1).padStart(2, '0')}">${n}</option>`).join('')}</select>
    <select name="y"><option value="">Year</option>${Array.from({ length: 80 }, (_, i) => `<option>${2010 - i}</option>`).join('')}</select>
  </fieldset>
  <input name="start_date" type="date" />
  <input name="company_abn" type="text" />
  <label for="t">Job title</label><input id="t" name="role_txt" type="text" />
  <input name="mystery" type="text" />
</form></body></html>`;

(async () => {
  section('DOB with LLM unavailable (heuristic detection)');
  {
    const win = bootstrap(DOB_HTML, null);
    const res = await win.__sfFillWithProfile('au-personal');
    ok(res.success, 'fill succeeded');
    const v = n => win.document.querySelector(`[name="${n}"]`).value;
    eq(v('dob_text'), '09/02/1984', 'text DOB uses placeholder format');
    eq(v('birthdate'), '1984-02-09', 'date input DOB is ISO');
    eq(v('birthday_us'), '02-09-1984', 'text DOB honours mm-dd-yyyy placeholder');
    eq(v('d'), '9', 'Day select');
    eq(v('m'), '02', 'Month select matched by number');
    eq(v('y'), '1984', 'Year select');
    ok(v('start_date') !== '1984-02-09' && /^\d{4}-\d{2}-\d{2}$/.test(v('start_date')), 'generic date is not given the DOB');
    eq(v('company_abn'), '51 824 753 556', 'ABN chosen from field name');
    eq(v('role_txt'), 'Software Engineer', 'job title chosen from label');
    eq(v('mystery'), '', 'unrecognisable field left blank (no text_custom)');
    eq(win.__prompts.length, 1, 'only the detection call is attempted when the LLM is down');
    const all = Array.from(win.document.querySelectorAll('input')).map(e => e.value).join(' ');
    ok(!/text_/.test(all), 'no text_ placeholder values anywhere');
  }

  section('AI chooses values for non-standard fields');
  {
    const html = `<!DOCTYPE html><html><body><form>
      <label for="a">Favourite wine varietal</label><input id="a" name="fav" type="text" />
      <label for="b">Membership tier</label><select id="b" name="tier"><option value="">Select…</option><option value="b">Bronze</option><option value="g">Gold</option></select>
      <label for="c">Date of birth</label><input id="c" name="dob" type="text" />
    </form></body></html>`;
    const win = bootstrap(html, prompt => {
      if (/Return ONLY a JSON array/.test(prompt)) {
        return JSON.stringify([
          { htmlName: 'fav', detectedType: 'wine_varietal', isSafe: true },
          { htmlName: 'tier', detectedType: 'membership_tier', isSafe: true, suggestedValue: 'Gold' },
          { htmlName: 'dob', detectedType: 'date_of_birth', isSafe: true }
        ]);
      }
      return 'Shiraz'; // per-field value prompt
    });
    await win.__sfFillWithProfile('au-personal');
    const v = n => win.document.querySelector(`[name="${n}"]`).value;
    eq(v('fav'), 'Shiraz', 'free-text field gets the AI-chosen value');
    eq(v('tier'), 'g', 'select gets the AI-suggested option');
    eq(v('dob'), '09/02/1984', 'LLM alias "date_of_birth" → profile DOB, AU format');
    const valuePrompt = win.__prompts.find(p => /Choose a value for this field/.test(p)) || '';
    ok(/Favourite wine varietal/.test(valuePrompt) && /"fav"/.test(valuePrompt), 'value prompt carries label and name');
  }

  section('DOB survives LLM name mismatch, unnamed controls and stale cache');
  {
    const html = `<!DOCTYPE html><html><body><form>
      <label for="e">Email</label><input id="e" name="email" type="email" />
      <label>Date of birth <input type="text" placeholder="DD/MM/YYYY" /></label>
      <label for="b">Birthday</label><input id="b" name="user[birthday]" type="date" />
    </form></body></html>`;
    const win = bootstrap(html, () => JSON.stringify([
      { htmlName: 'email', detectedType: 'email', isSafe: true },
      { htmlName: 'Date of birth', detectedType: 'date', isSafe: true },   // mangled name, wrong type
      { htmlName: 'birthday', detectedType: 'custom', isSafe: true }      // mangled name
    ]));
    win.localStorage.setItem('fieldDetectionCache', '{"stale":true}');
    await win.__sfFillWithProfile('au-personal');
    const inputs = win.document.querySelectorAll('input');
    eq(inputs[1].value, '09/02/1984', 'unnamed DOB text input filled via positional match');
    eq(inputs[2].value, '1984-02-09', 'DOB date input filled despite mangled name + custom type');
  }

  section('React-style value tracker sees the change');
  {
    const win = bootstrap(`<!DOCTYPE html><html><body><form>
      <label for="d">Date of birth</label><input id="d" name="dob" type="date" /></form></body></html>`, null);
    const el = win.document.querySelector('input');
    // Emulate React: an own-property value setter that swallows direct assignment.
    let tracked = '';
    Object.defineProperty(el, 'value', { configurable: true,
      get() { return tracked; }, set(_) { /* React tracker ignores direct sets */ } });
    const proto = Object.getPrototypeOf(el);
    const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value').set;
    Object.defineProperty(proto, 'value', { configurable: true,
      get: Object.getOwnPropertyDescriptor(proto, 'value').get,
      set(v) { tracked = v; nativeSet.call(this, v); } });
    await win.__sfFillWithProfile('au-personal');
    eq(tracked, '1984-02-09', 'value written through the prototype (native) setter');
  }

  section('Vue date-picker: broken label[for], DD MMM YYYY placeholder');
  {
    // Mirrors the vincreative signup DOB markup.
    const html = `<!DOCTYPE html><html><body><form><section class="vc-form-group">
      <label for="vc-signup-form__select--dob" class="vc-form__label">Date of birth</label>
      <div class="dp-container"><div class="dp-content"><div class="input-text">
        <input type="text" name="db-input" id="db-input" placeholder="DD MMM YYYY" autocomplete="off" class="dp-input">
      </div></div></div></section>
      <section><label for="em">Email</label><input id="em" name="email" type="email" /></section>
    </form></body></html>`;
    const win = bootstrap(html, null);
    await win.__sfFillWithProfile('au-personal');
    eq(win.document.querySelector('#db-input').value, '09 Feb 1984', 'DOB found via group label, rendered as DD MMM YYYY');
    eq(win.__busy, [true, false], 'busy signal sent at start and cleared at end of fill');
    eq(win.document.querySelectorAll('.sf-throbber').length, 0, 'no throbbers left behind');
  }

  section('Right-click on the vincreative DOB picker (reported bug: 2023-12-25 left as ISO)');
  {
    const html = `<!DOCTYPE html><html><body><form><section class="vc-form-group">
      <label for="vc-signup-form__select--dob" class="vc-form__label">Date of birth</label>
      <div class="dp-container"><div class="dp-content"><div class="input-text">
        <input type="text" name="db-input" id="db-input" placeholder="DD MMM YYYY" autocomplete="off" class="dp-input">
      </div></div></div>
      <div class="form-text">Click on the Calendar to choose your day, month and year to confirm you are over 18.</div>
    </section></form></body></html>`;
    let answer = '2023-12-25';
    const win = bootstrap(html, () => answer);
    const dob = win.document.querySelector('#db-input');
    dob.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));

    let res = await win.__sfAISuggestField(null);
    ok(!res.success && /not an adult birth date/.test(res.message), 'recent date from AI rejected with a clear message');
    eq(dob.value, '', 'rejected date not written');
    const p = win.__prompts[win.__prompts.length - 1];
    ok(/DATE OF BIRTH/.test(p) && /over 18/.test(p) && /DD MMM YYYY/.test(p), 'prompt flags DOB, carries help text and placeholder');

    answer = '1988-06-14';
    res = await win.__sfAISuggestField(null);
    eq(dob.value, '14 Jun 1988', 'ISO answer rendered in the DD MMM YYYY placeholder format');

    answer = 'June 3, 1979';
    await win.__sfAISuggestField(null);
    eq(dob.value, '03 Jun 1979', 'month-name answer normalised then formatted');
  }

  section('Field descriptions reach the model on fill-all too');
  {
    const html = `<!DOCTYPE html><html><body><form>
      <section><label for="d">Date of birth</label><input id="d" name="dob" type="text" aria-describedby="dh" />
        <small id="dh">You must be over 18</small></section>
      <section><label for="c">Promo code</label><input id="c" name="promo" type="text" title="Six characters" />
        <div class="vc-form__hint">Codes start with WINE</div><div class="vc-form__error">Required</div></section>
    </form></body></html>`;
    const win = bootstrap(html, null);
    await win.__sfFillWithProfile('au-personal');
    const detect = win.__prompts[0] || '';
    ok(/You must be over 18/.test(detect), 'aria-describedby description in detection prompt');
    ok(/Codes start with WINE/.test(detect) && /Six characters/.test(detect), 'group hint + title in detection prompt');
    ok(!/Required/.test(detect), 'validation error text not treated as a description');
  }

  section('Checkboxes: contact toggles untouched, consent ticked');
  {
    const html = `<!DOCTYPE html><html><body><form>
      <label for="em">Email</label><input id="em" name="email" type="email" />
      <section><label>Allow us to contact you via email</label><input type="checkbox" class="switch-input" checked /></section>
      <section><label>Allow us to contact you via phone</label><input type="checkbox" class="switch-input" /></section>
      <label><input type="checkbox" name="terms" /> I agree to the Terms and Conditions</label>
    </form></body></html>`;
    const win = bootstrap(html, null);
    await win.__sfFillWithProfile('au-personal');
    const boxes = win.document.querySelectorAll('input[type=checkbox]');
    eq(boxes[0].checked, true, 'contact-via-email toggle left ON (not treated as an email field)');
    eq(boxes[1].checked, false, 'contact-via-phone toggle left OFF');
    eq(boxes[2].checked, true, 'terms consent box ticked');
  }

  section('Right-click: fill one field with an AI suggestion');
  {
    const html = `<!DOCTYPE html><html><body><form>
      <label for="h">Favourite hobby</label><input id="h" name="hobby" type="text" placeholder="e.g. hiking" />
      <label for="d">Date of birth</label><input id="d" name="birth" type="text" placeholder="DD/MM/YYYY" />
      <label for="o">Other</label><input id="o" name="other" type="text" />
    </form></body></html>`;
    let throbberDuringCall = 0;
    const win = bootstrap(html, prompt => {
      throbberDuringCall = win.document.querySelectorAll('.sf-throbber').length;
      return /Date of birth/.test(prompt) ? '1990-12-25' : 'Rock climbing';
    });
    const [hobby, birth, other] = win.document.querySelectorAll('input');
    hobby.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
    let res = await win.__sfAISuggestField(null);
    ok(res.success, 'suggest: succeeded for right-clicked field');
    eq(hobby.value, 'Rock climbing', 'suggest: AI value written');
    eq(other.value, '', 'suggest: other fields untouched');
    eq(throbberDuringCall, 1, 'suggest: throbber shown beside the field while the AI works');
    eq(win.document.querySelectorAll('.sf-throbber').length, 0, 'suggest: throbber removed afterwards');
    const p = win.__prompts[win.__prompts.length - 1];
    ok(/Favourite hobby/.test(p) && /"hobby"/.test(p) && /e\.g\. hiking/.test(p), 'suggest: prompt has label, name and placeholder');

    res = await win.__sfAISuggestField(null);
    ok(/currently contains "Rock climbing"/.test(win.__prompts[win.__prompts.length - 1]), 'suggest: repeat asks for a different value');

    birth.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
    await win.__sfAISuggestField(null);
    eq(birth.value, '25/12/1990', 'suggest: ISO date from AI rendered in field format');

    const down = bootstrap(html, null);
    down.document.querySelector('input').dispatchEvent(new down.MouseEvent('contextmenu', { bubbles: true }));
    res = await down.__sfAISuggestField(null);
    ok(!res.success && down.document.querySelector('input').value === '', 'suggest: AI down → no fallback value written');
  }

  done('content-dob-fill');
})();
