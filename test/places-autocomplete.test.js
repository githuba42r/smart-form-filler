// test/places-autocomplete.test.js — Google Places address type-ahead: type the full address,
// pick a suggestion, let the site fill its address lines; fall back to lines when no suggestions.
const { eq, ok, section, done } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const ALL = { name: true, contact: true, address: true, account: true, misc: true };
const PROFILE = { id: 'au', label: 'AU', country: 'AU', randomize: true, policy: { groups: ALL, exclude: [] },
  pins: { street1: '12 Queen Street', city: 'Brisbane', state: 'QLD', zip: '4000' } };

function bootstrap(html, pageScript) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://shop.example.com/checkout' });
  const ctx = dom.getInternalVMContext();
  const win = dom.window;
  win.CSS = win.CSS || { escape: s => String(s).replace(/["\\]/g, '\\$&') };
  // jsdom has no layout: give displayed elements a size so visibility checks pass.
  win.Element.prototype.getBoundingClientRect = function () {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode && n.parentNode.host ? n.parentNode.host : n.parentNode) {
      if (win.getComputedStyle(n).display === 'none') return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    }
    return { width: 200, height: 24, top: 0, left: 0, right: 200, bottom: 24 };
  };
  win.chrome = makeChrome({ profiles: [PROFILE], defaultProfile: 'au' });
  win.__typed = [];
  win.chrome.runtime.sendMessage = function (msg, cb) {
    if (msg.action !== 'callLLM') { cb && cb({ ok: true }); return; }
    win.chrome.runtime.lastError = { message: 'down' }; cb(null); win.chrome.runtime.lastError = null;
  };
  if (pageScript) vm.runInContext(pageScript, ctx);
  for (const f of ['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js', 'ai-field-detector.js', 'form-registry.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  win.__smartFormFillerLoaded = false;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'), ctx, { filename: 'content.js' });
  return win;
}

const LINES = `
  <label for="a2">Apartment, unit, suite</label><input id="a2" name="address2">
  <label for="city">Suburb</label><input id="city" name="locality">
  <label for="st">State</label><input id="st" name="state">
  <label for="pc">Postcode</label><input id="pc" name="postcode">
  <label for="fn">First name</label><input id="fn" name="first_name">`;

// Mimics the classic widget: suggestions in a body-level .pac-container; mousedown on an
// item selects it and the site's place_changed handler fills the address lines.
const LEGACY_SCRIPT = `(function () {
  var input = document.getElementById('addr');
  var box = document.createElement('div'); box.className = 'pac-container'; box.style.display = 'none';
  document.body.appendChild(box);
  input.addEventListener('input', function () {
    window.__typed.push(input.value);
    setTimeout(function () {
      box.innerHTML = '';
      if (window.__noResults || !/Queen/.test(input.value)) { box.style.display = 'none'; return; }
      ['12 Queen Street, Brisbane City QLD, Australia', '12 Queen Street, Melbourne VIC, Australia'].forEach(function (t) {
        var item = document.createElement('div'); item.className = 'pac-item'; item.textContent = t;
        item.addEventListener('mousedown', function () {
          box.style.display = 'none';
          input.value = '12 Queen St';
          setTimeout(function () {
            document.getElementById('city').value = 'Brisbane City';
            document.getElementById('st').value = 'QLD';
            document.getElementById('pc').value = '4000';
          }, 200);
        });
        box.appendChild(item);
      });
      box.style.display = 'block';
    }, 50);
  });
})();`;

(async () => {
  section('classic widget: full address typed, suggestion picked, site fills the lines');
  {
    const win = bootstrap(`<!DOCTYPE html><body><form>
      <label for="addr">Address</label><input id="addr" name="ship-address" class="pac-target-input" autocomplete="off">${LINES}
    </form></body>`, LEGACY_SCRIPT);
    const res = await win.__sfFillWithProfile('au');
    const v = id => win.document.getElementById(id).value;
    ok(res.success, 'fill succeeded');
    eq(win.__typed[0], '12 Queen Street, Brisbane QLD 4000, Australia', 'typed the full address');
    eq(v('addr'), '12 Queen St', 'site set the address box from the chosen place');
    eq([v('city'), v('st'), v('pc')], ['Brisbane City', 'QLD', '4000'], 'site-filled lines kept');
    eq(v('a2'), '', 'apartment line left empty');
    ok(v('fn') !== '', 'other fields still filled');
  }

  section('classic widget: no suggestions → address lines filled as before');
  {
    const win = bootstrap(`<!DOCTYPE html><body><form>
      <label for="addr">Address</label><input id="addr" name="ship-address" class="pac-target-input" autocomplete="off">${LINES}
    </form></body>`, 'window.__noResults = true;' + LEGACY_SCRIPT);
    await win.__sfFillWithProfile('au');
    const v = id => win.document.getElementById(id).value;
    ok(win.__typed.length >= 2, 'tried shorter queries too');
    eq(v('addr'), '12 Queen Street', 'street line typed into the box');
    eq([v('city'), v('st'), v('pc')], ['Brisbane', 'QLD', '4000'], 'profile address lines filled');
  }

  section('heuristic fill path (AI detector unavailable) uses the type-ahead too');
  {
    const win = bootstrap(`<!DOCTYPE html><body><form>
      <label for="addr">Address</label><input id="addr" name="ship-address" class="pac-target-input" autocomplete="off">${LINES}
    </form></body>`, LEGACY_SCRIPT);
    win.SFAIDetector.detectFormFields = () => Promise.reject(new Error('boom'));
    await win.__sfFillWithProfile('au');
    const v = id => win.document.getElementById(id).value;
    eq(win.__typed[0], '12 Queen Street, Brisbane QLD 4000, Australia', 'typed the full address');
    eq([v('addr'), v('city'), v('pc')], ['12 Queen St', 'Brisbane City', '4000'], 'site-filled lines kept');
  }

  section('address group off → the type-ahead box is left alone');
  {
    const win = bootstrap(`<!DOCTYPE html><body><form>
      <label for="addr">Address</label><input id="addr" name="ship-address" class="pac-target-input" autocomplete="off">${LINES}
    </form></body>`, LEGACY_SCRIPT);
    await win.__sfFillWithProfile('au', { only: ['name'] });
    eq(win.__typed.length, 0, 'nothing typed');
    eq(win.document.getElementById('addr').value, '', 'box empty');
  }

  section('<gmp-place-autocomplete> element (input and suggestions in its shadow root)');
  {
    const script = `(function () {
      var host = document.querySelector('gmp-place-autocomplete');
      var sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<input role="combobox" aria-label="Search for a place"><ul role="listbox"></ul>';
      var input = sr.querySelector('input'), list = sr.querySelector('ul');
      input.addEventListener('input', function () {
        window.__typed.push(input.value);
        setTimeout(function () {
          list.innerHTML = '<li role="option">12 Queen Street, Brisbane City QLD, Australia</li>';
          list.firstChild.addEventListener('click', function () {
            list.innerHTML = '';
            input.value = '12 Queen Street, Brisbane City QLD, Australia';
            setTimeout(function () {
              document.getElementById('street').value = '12 Queen St';
              document.getElementById('city').value = 'Brisbane City';
              document.getElementById('st').value = 'QLD';
              document.getElementById('pc').value = '4000';
            }, 100);
          });
        }, 50);
      });
    })();`;
    const win = bootstrap(`<!DOCTYPE html><body><form>
      <label>Deliver to <gmp-place-autocomplete></gmp-place-autocomplete></label>
      <label for="street">Street address</label><input id="street" name="address1">${LINES}
    </form></body>`, script);
    await win.__sfFillWithProfile('au');
    const v = id => win.document.getElementById(id).value;
    eq(win.__typed[0], '12 Queen Street, Brisbane QLD 4000, Australia', 'typed the full address into the shadow input');
    eq([v('street'), v('city'), v('pc')], ['12 Queen St', 'Brisbane City', '4000'], 'site-filled lines kept');
    eq(v('a2'), '', 'apartment line left empty');
  }

  done('places-autocomplete');
})();
