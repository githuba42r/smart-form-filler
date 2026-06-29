# Configurable Test-Data Profiles (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four hardcoded fill profiles with storage-backed, country-aware *generator* profiles that produce randomized, country-coherent test data and let the user control which fields each fill completes (persistently per profile and transiently per fill).

**Architecture:** All pure logic lives in two new classic global-namespaced scripts so it is loadable in jsdom and shared by every consumer — `vendor/address-schemas.js` (`window.SFAddress`, a static port of the address-module's framework-free schema files) and `formdata.js` (`window.SFFormData`: field vocabulary, generator, pins, policy gate, value resolution, profile data-ops, seed). DOM helpers shared across surfaces live in `profile-ui.js` (`window.SFProfileUI`). `content.js`/`popup.js`/`options.js` are thin consumers of those globals; `background.js` seeds `chrome.storage.local`. No build step, no runtime dependency on the address-module.

**Tech Stack:** Vanilla ES (classic scripts, `window.*` globals — the existing `recommendations.js` pattern), Chrome MV3 (`chrome.storage.local`), jsdom + Node for tests.

## Global Constraints

- **No build step.** All shipped scripts are plain classic scripts assigning to a `window.*` namespace; no `import`/`export`/bundler. (Matches `recommendations.js`.)
- **No duplicated production logic.** Every pure function and DOM helper has exactly one definition, in a loadable module (`formdata.js`, `profile-ui.js`, or `vendor/address-schemas.js`). Tests load the real module — never a re-typed copy. (The sole sanctioned duplication is the seed array in Task 7, which a module worker cannot share; it is protected by a drift-guard test.)
- **No runtime dependency on `~/src/vue/address-module`.** Vendored files are a hand-refreshable static copy; record provenance in a header comment.
- **Do not alter** the existing detection / visibility / section-icon / combobox-vue-select / Google-Places / cascade-pass logic in `content.js`. Only the profile-source, value-resolution, and menu code change.
- **Canonical field vocabulary:** `firstname, lastname, fullname, username, email, phone, street1, street2, city, state, zip, country, business, password, dob, genericText`. Engine-category mapping is fixed (Task 3).
- **Field groups:** `name` (firstname, lastname, fullname, username), `contact` (email, phone), `address` (street1, street2, city, state, zip, country), `account` (password, dob), `misc` (business, genericText).
- **Profiles ship AU + US data pools.** Other countries get correct address *schema* (labels/required) + a generic data pool.
- **No AI** anywhere in this plan (deferred to spec #3).
- **Tests run with:** `node test/<file>.js` (exit 0 = pass). Never commit `node_modules/` or `package-lock.json` (already in `.gitignore`).
- **Commits** land on branch `feature/configurable-profiles`. Do not commit to `master`/`main`. No `Co-Authored-By` footer.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` (new) | Declares `jsdom` dev dependency + `test` script. |
| `test/harness.js` (new) | Loads classic scripts into a jsdom window; assert helpers. |
| `test/helpers/chrome-mock.js` (new) | Reusable fake `chrome.storage.local` for tests (test infra, not production logic). |
| `test/*.test.js` (new) | One test file per task; loads real modules. |
| `vendor/address-schemas.js` (new) | `window.SFAddress`: schemas + field-config + zip validation + flag emoji + country list. Static port. |
| `formdata.js` (new) | `window.SFFormData`: field groups, engine mapping, locale pools, `generatePerson`, pins, policy gate, `applyPolicy`/`resolveValues`, profile data-ops, seed/version. |
| `profile-ui.js` (new) | `window.SFProfileUI`: shared DOM builders (`buildMenu`, `populateProfileSelect`, `renderAddressFields`). |
| `content.js` (modify) | `fillWithProfile` rewired to storage + `SFFormData.resolveValues`; form-icon menu via `SFProfileUI.buildMenu`. |
| `popup.html`/`popup.js` (modify) | Profile dropdown via `SFProfileUI.populateProfileSelect`. |
| `options.html`/`options.js` (modify) | Profile-manager CRUD via `SFFormData` data-ops + dynamic address via `SFProfileUI.renderAddressFields`. |
| `background.js` (modify) | Seed/migrate `profiles` on install/upgrade. |
| `seed-data.node.js` (new) | CommonJS source of truth for seed logic, requireable by tests. |
| `manifest.json` (modify) | Register `vendor/address-schemas.js` + `formdata.js` + `profile-ui.js` content scripts before `content.js`; version bump. |

---

## Task 1: Test harness & dev tooling

**Files:**
- Create: `package.json`, `test/harness.js`, `test/harness.selftest.js`

**Interfaces:**
- Produces: `require('./harness')` → `{ loadGlobals(files, html?) → window, assert(cond,msg), ok(cond,msg), eq(actual,expected,msg), section(name), done(name) }`. `loadGlobals` reads each repo-relative file and evaluates it inside one jsdom window's VM context (so `window.Foo = …` assignments land on the returned `window`).

- [ ] **Step 1: Write the failing self-test** — create `test/harness.selftest.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals([], '<!DOCTYPE html><body><div id="x">hi</div></body>');
ok(win.document.getElementById('x').textContent === 'hi', 'jsdom document available');
eq(typeof win.Node, 'function', 'window has DOM globals');
done('harness.selftest');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/harness.selftest.js` → FAIL `Cannot find module './harness'`.

- [ ] **Step 3: Create `package.json`:**

```json
{
  "name": "smart-form-filler-extension",
  "version": "1.0.1",
  "private": true,
  "description": "Dev-only tooling/tests for the SmartForm Filler extension (not shipped).",
  "scripts": {
    "test": "for f in test/*.test.js test/harness.selftest.js; do echo \"== $f ==\"; node \"$f\" || exit 1; done"
  },
  "devDependencies": { "jsdom": "^24.0.0" }
}
```

- [ ] **Step 4: Create `test/harness.js`:**

```js
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
```

- [ ] **Step 5: Install jsdom and run** — `npm install >/dev/null 2>&1 && node test/harness.selftest.js` → `✓ harness.selftest: 2 passed, 0 failed`.

- [ ] **Step 6: Commit:**

```bash
git add package.json test/harness.js test/harness.selftest.js .gitignore
git commit -m "test: add jsdom test harness for extension globals"
```

---

## Task 2: Vendor the address schema → `window.SFAddress`

**Files:**
- Create: `vendor/address-schemas.js`, `test/address-schemas.test.js`

**Interfaces:**
- Produces `window.SFAddress`: `ADDRESS_SCHEMAS`, `DEFAULT_SCHEMA`, `getSchema(country)`, `getFieldConfig(country) → { order:string[], fields:{ street1,street2,city,state,zip: {show,required,label,…} } }`, `validateZip(zip,country) → {valid, example?}`, `getZipHint(country) → string|null`, `countryCodeToFlagEmoji(code) → string`, `listCountries() → Array<{code,name,flag,label}>` sorted by `name`, `label` = `"🇦🇺 Australia"`.

- [ ] **Step 1: Write the failing test** — create `test/address-schemas.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const A = loadGlobals(['vendor/address-schemas.js']).SFAddress;

const au = A.getFieldConfig('AU');
eq(au.fields.state.label, 'State/Territory', 'AU state label override');
eq(au.fields.city.label, 'Suburb', 'AU locality label');
eq(au.fields.zip.label, 'Postcode', 'AU zip label');
ok(au.fields.zip.required && au.fields.state.required, 'AU zip+state required');
eq(au.order, ['street', 'city', 'state', 'zip'], 'AU field order from fmt');

const us = A.getFieldConfig('US');
eq(us.fields.city.label, 'City', 'US locality label');
eq(us.fields.zip.label, 'ZIP Code', 'US zip label');

ok(A.validateZip('4000', 'AU').valid, 'AU 4000 valid');
ok(!A.validateZip('ABCD', 'AU').valid, 'AU ABCD invalid');
ok(A.validateZip('94114', 'US').valid, 'US 94114 valid');

eq(A.countryCodeToFlagEmoji('AU'), '\u{1F1E6}\u{1F1FA}', 'AU flag emoji');
const list = A.listCountries();
ok(list.length >= 30, 'at least 30 countries ported');
ok(list.some(c => c.code === 'AU' && c.label.indexOf('Australia') !== -1), 'AU in list with name');
ok(A.getFieldConfig('ZZ').fields.street1.show, 'unknown country still shows street');
done('address-schemas');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/address-schemas.test.js` → FAIL (`SFAddress` undefined).

- [ ] **Step 3: Create `vendor/address-schemas.js` (port).** Build one IIFE assigning `window.SFAddress`. **Port procedure:**
  1. Copy the **entire** `ADDRESS_SCHEMAS` and `DEFAULT_SCHEMA` object literals **verbatim** from `~/src/vue/address-module/src/utils/addressSchemas.js` (all 35 countries); change `export const` → `const`.
  2. Paste the provider logic from `addressSchemaProvider.js` **verbatim**, deleting its `import …` line and every `export` keyword.
  3. Paste `countryCodeToFlagEmoji` **verbatim** from `countryCodeFormatter.js` (omit the two phone helpers).
  4. Add the new `listCountries()` helper.
  5. Expose the public surface on `root.SFAddress`.

Skeleton (fill the marked regions with verbatim copies):

```js
// vendor/address-schemas.js
// Static port of ~/src/vue/address-module/src/utils/{addressSchemas,
// addressSchemaProvider,countryCodeFormatter}.js — framework-free.
// Provenance: chromium-i18n.appspot.com/ssl-address via address-module.
// Refresh by hand if the source schema set changes. DO NOT add a build dep.
;(function (root) {
  'use strict';

  // ----- verbatim from addressSchemas.js (drop `export`) -----
  const DEFAULT_SCHEMA = {
    name: 'Default', fmt: '%N%n%O%n%A%n%C', require: 'AC',
    state_name_type: 'province', locality_name_type: 'city', zip_name_type: 'postal'
  };
  const ADDRESS_SCHEMAS = {
    AU: { name: 'Australia', fmt: '%O%n%N%n%A%n%C %S %Z', require: 'ACSZ',
          zip: '\\d{4}', zip_ex: '4113', state_name_type: 'state',
          state_label: 'State/Territory', locality_name_type: 'suburb', zip_name_type: 'postcode' },
    US: { name: 'United States', fmt: '%N%n%O%n%A%n%C, %S %Z', require: 'ACSZ',
          zip: '\\d{5}([ \\-]\\d{4})?', zip_ex: '62704', state_name_type: 'state',
          locality_name_type: 'city', zip_name_type: 'zip' }
    // … paste the remaining 33 countries (CA, GB, NZ, JP, …) byte-for-byte …
  };

  // ----- verbatim from addressSchemaProvider.js (drop `import` + `export`) -----
  const STATE_LABELS = { state:'State', province:'Province', prefecture:'Prefecture', county:'County',
    region:'Region', do_si:'Do/Si', area:'Area', district:'District', department:'Department',
    emirate:'Emirate', island:'Island', oblast:'Oblast', parish:'Parish' };
  const LOCALITY_LABELS = { city:'City', suburb:'Suburb', post_town:'Town/City', district:'District' };
  const ZIP_LABELS = { zip:'ZIP Code', postal:'Postal Code', postcode:'Postcode', pin:'PIN Code', eircode:'Eircode' };
  function normaliseCountryCode(c){ return (c||'').toString().trim().toUpperCase(); }
  function getSchema(c){ return ADDRESS_SCHEMAS[normaliseCountryCode(c)] || DEFAULT_SCHEMA; }
  function hasSchema(c){ return Object.prototype.hasOwnProperty.call(ADDRESS_SCHEMAS, normaliseCountryCode(c)); }
  const FMT_TOKEN_TO_FIELD = { A:'street', C:'city', S:'state', Z:'zip' };
  function getFieldOrder(c){
    const schema = getSchema(c); const order = []; const fmt = schema.fmt || DEFAULT_SCHEMA.fmt;
    for (let i=0;i<fmt.length-1;i++){ if (fmt[i]!=='%') continue;
      const field = FMT_TOKEN_TO_FIELD[fmt[i+1]]; if (field && !order.includes(field)) order.push(field); }
    if (!order.includes('street')) order.unshift('street');
    return order;
  }
  function getFieldConfig(c){
    const schema = getSchema(c); const require = schema.require || ''; const fmt = schema.fmt || DEFAULT_SCHEMA.fmt;
    return { order: getFieldOrder(c), fields: {
      street1: { show:true, required: require.indexOf('A')!==-1, label:'Address' },
      street2: { show:true, required:false, label:'Apartment, suite, level etc (Optional)' },
      city: { show: fmt.indexOf('%C')!==-1, required: require.indexOf('C')!==-1,
              label: schema.locality_label || LOCALITY_LABELS[schema.locality_name_type] || LOCALITY_LABELS.city },
      state: { show: fmt.indexOf('%S')!==-1, required: require.indexOf('S')!==-1,
               label: schema.state_label || STATE_LABELS[schema.state_name_type] || STATE_LABELS.province },
      zip: { show: fmt.indexOf('%Z')!==-1, required: require.indexOf('Z')!==-1,
             label: schema.zip_label || ZIP_LABELS[schema.zip_name_type] || ZIP_LABELS.postal,
             format: schema.zip || null, example: schema.zip_ex || null }
    } };
  }
  function validateZip(zip, c){
    const value = (zip||'').toString().trim(); if (!value) return { valid:true };
    const schema = getSchema(c); if (!schema.zip) return { valid:true };
    return { valid: new RegExp('^(?:'+schema.zip+')$').test(value), example: schema.zip_ex || null };
  }
  function getZipHint(c){ const s = getSchema(c); return s.zip_ex ? `e.g. ${s.zip_ex}` : null; }

  // ----- verbatim from countryCodeFormatter.js -----
  function countryCodeToFlagEmoji(countryCode){
    if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) return '';
    return String.fromCodePoint(...countryCode.toUpperCase().split('').map(ch => 127397 + ch.charCodeAt()));
  }

  // ----- new helper for the options country picker -----
  function listCountries(){
    return Object.keys(ADDRESS_SCHEMAS).map(code => {
      const flag = countryCodeToFlagEmoji(code === 'UK' ? 'GB' : code);
      const name = ADDRESS_SCHEMAS[code].name || code;
      return { code, name, flag, label: flag ? `${flag} ${name}` : name };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  root.SFAddress = { ADDRESS_SCHEMAS, DEFAULT_SCHEMA, getSchema, hasSchema,
    getFieldOrder, getFieldConfig, validateZip, getZipHint, countryCodeToFlagEmoji, listCountries };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes** — `node --check vendor/address-schemas.js && node test/address-schemas.test.js` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add vendor/address-schemas.js test/address-schemas.test.js
git commit -m "feat: vendor address schema model as window.SFAddress"
```

---

## Task 3: `formdata.js` — field groups, vocabulary & engine mapping

**Files:** Create `formdata.js`, `test/formdata-groups.test.js`

**Interfaces:** Produces (initial slice of) `window.SFFormData`: `FIELD_GROUPS`, `CANONICAL_TO_ENGINE`, `ENGINE_TO_CANONICAL`, `groupForField(canonicalKey) → group|null`, `toEngineValues(canonicalMap) → engineMap`.

- [ ] **Step 1: Write the failing test** — create `test/formdata-groups.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;

eq(F.groupForField('email'), 'contact', 'email is contact');
eq(F.groupForField('street1'), 'address', 'street1 is address');
eq(F.groupForField('firstname'), 'name', 'firstname is name');
eq(F.groupForField('business'), 'misc', 'business is misc');
eq(F.groupForField('nope'), null, 'unknown -> null');
eq(F.CANONICAL_TO_ENGINE.street1, 'address1', 'street1 -> address1');
eq(F.CANONICAL_TO_ENGINE.zip, 'postcode', 'zip -> postcode');
eq(F.CANONICAL_TO_ENGINE.business, 'company', 'business -> company');
eq(F.ENGINE_TO_CANONICAL.postcode, 'zip', 'postcode -> zip (reverse)');
const eng = F.toEngineValues({ street1: '17 Main St', zip: '4000', email: 'a@b.co' });
eq(eng.address1, '17 Main St', 'maps street1');
eq(eng.postcode, '4000', 'maps zip');
eq(eng.email, 'a@b.co', 'passes email');
done('formdata-groups');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/formdata-groups.test.js` → FAIL (`SFFormData` undefined).

- [ ] **Step 3: Create `formdata.js` (this slice):**

```js
// formdata.js — window.SFFormData: profile generator, field groups, policy gate, data-ops.
// Classic global script (no import/export). Loads after vendor/address-schemas.js.
;(function (root) {
  'use strict';

  const FIELD_GROUPS = {
    name:    ['firstname', 'lastname', 'fullname', 'username'],
    contact: ['email', 'phone'],
    address: ['street1', 'street2', 'city', 'state', 'zip', 'country'],
    account: ['password', 'dob'],
    misc:    ['business', 'genericText']
  };
  const CANONICAL_TO_ENGINE = {
    firstname:'firstName', lastname:'lastName', fullname:'fullName', username:'username',
    email:'email', phone:'phone',
    street1:'address1', street2:'address2', city:'city', state:'state', zip:'postcode', country:'country',
    password:'password', dob:'dob', business:'company', genericText:'genericText'
  };
  const ENGINE_TO_CANONICAL = Object.keys(CANONICAL_TO_ENGINE)
    .reduce((acc, k) => { acc[CANONICAL_TO_ENGINE[k]] = k; return acc; }, {});
  const _GROUP_OF = (function () {
    const m = {}; Object.keys(FIELD_GROUPS).forEach(g => FIELD_GROUPS[g].forEach(k => { m[k] = g; })); return m;
  })();
  function groupForField(key) { return _GROUP_OF[key] || null; }
  function toEngineValues(map) {
    const out = {};
    Object.keys(map || {}).forEach(k => { const e = CANONICAL_TO_ENGINE[k]; if (e) out[e] = map[k]; });
    return out;
  }

  root.SFFormData = { FIELD_GROUPS, CANONICAL_TO_ENGINE, ENGINE_TO_CANONICAL, groupForField, toEngineValues };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes** — `node --check formdata.js && node test/formdata-groups.test.js` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add formdata.js test/formdata-groups.test.js
git commit -m "feat: formdata field groups + canonical/engine mapping"
```

---

## Task 4: `formdata.js` — locale pools + `generatePerson` (seedable)

**Files:** Modify `formdata.js`; create `test/formdata-generate.test.js`

**Interfaces:** Consumes `window.SFAddress.validateZip`. Adds to `window.SFFormData`: `LOCALES` (`{AU,US}`), `generatePerson(profile, opts?) → canonicalValueMap` with **every** canonical key set. `opts.seed` (int) → deterministic. Generated `zip` matches the country schema's `zip` regex; `state`/`city`/`zip` come from one coherent row; `email`/`username` derive from the name. Pins **not** applied here (Task 5).

- [ ] **Step 1: Write the failing test** — create `test/formdata-generate.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js']);
const F = win.SFFormData, A = win.SFAddress;

const a1 = F.generatePerson({ country: 'AU' }, { seed: 42 });
const a2 = F.generatePerson({ country: 'AU' }, { seed: 42 });
eq(a1, a2, 'same seed -> identical');
ok(F.generatePerson({ country: 'AU' }, { seed: 1 }).email !== a1.email, 'different seed -> different');
['firstname','lastname','username','email','phone','street1','city','state','zip','country','password','dob','business','genericText']
  .forEach(k => ok(a1[k] !== undefined && a1[k] !== '', `generated ${k} present`));
eq(a1.country, 'AU', 'country preserved');
ok(A.validateZip(a1.zip, 'AU').valid, 'AU zip matches schema regex');
ok(A.validateZip(F.generatePerson({ country: 'US' }, { seed: 7 }).zip, 'US').valid, 'US zip valid');
ok(a1.email.toLowerCase().indexOf(a1.lastname.toLowerCase()) !== -1, 'email derived from last name');
const zz = F.generatePerson({ country: 'ZZ' }, { seed: 3 });
ok(zz.firstname && zz.street1, 'generic fallback still produces a person');
done('formdata-generate');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/formdata-generate.test.js` → FAIL (`generatePerson is not a function`).

- [ ] **Step 3: Add pools + generator to `formdata.js`** (insert before the `root.SFFormData = …` line):

```js
  const LOCALES = {
    AU: {
      firstNames: ['Jordan','Taylor','Casey','Morgan','Riley','Alex','Sam','Jamie','Dana','Harper'],
      lastNames:  ['Ellis','Morgan','Rivera','Nguyen','Patel','Brooks','Walsh','Hayes','Foster','Reed'],
      streets:    ['Riverside Drive','Queen Street','Boundary Road','Hawthorne Road','Logan Road','Stanley Street'],
      addresses: [
        { state: 'QLD', city: 'Brisbane',  zips: ['4000','4101','4122'] },
        { state: 'VIC', city: 'Melbourne', zips: ['3000','3008','3121'] },
        { state: 'NSW', city: 'Sydney',    zips: ['2000','2010','2060'] },
        { state: 'WA',  city: 'Perth',     zips: ['6000','6008','6100'] }
      ],
      phoneTemplate: '04## ### ###', emailDomains: ['example.com.au','testmail.dev']
    },
    US: {
      firstNames: ['Casey','Jordan','Avery','Quinn','Skyler','Drew','Reese','Parker','Rowan','Emerson'],
      lastNames:  ['Rivera','Bennett','Carter','Diaz','Evans','Foster','Garcia','Hughes','Jensen','Knight'],
      streets:    ['Market Street','Oak Avenue','Maple Drive','Pine Street','Cedar Lane','Elm Street'],
      addresses: [
        { state: 'CA', city: 'San Francisco', zips: ['94114','94103','94110'] },
        { state: 'NY', city: 'New York',      zips: ['10001','10010','10027'] },
        { state: 'TX', city: 'Austin',        zips: ['73301','78701','78704'] },
        { state: 'IL', city: 'Chicago',       zips: ['60601','60614','60618'] }
      ],
      phoneTemplate: '(###) ###-####', emailDomains: ['example.com','testmail.dev']
    }
  };
  const GENERIC = {
    firstNames: ['Alex','Sam','Jamie','Chris','Robin','Lee'],
    lastNames:  ['Taylor','Smith','Jones','Brown','Wilson','Clark'],
    streets:    ['Main Street','High Street','Park Road','Church Lane'],
    addresses:  [{ state: '', city: 'Springfield', zips: ['10000'] }],
    phoneTemplate: '### ### ####', emailDomains: ['example.com']
  };

  // Deterministic PRNG (mulberry32) so tests can seed; unseeded picks vary.
  function _rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function _pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function _digits(rng, template) { return template.replace(/#/g, () => String(Math.floor(rng() * 10))); }
  function _slug(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  function generatePerson(profile, opts) {
    opts = opts || {};
    const seed = (opts.seed != null) ? opts.seed : Math.floor(Math.random() * 1e9);
    const rng = _rng(seed);
    const country = (profile && profile.country) || 'AU';
    const L = LOCALES[country] || GENERIC;
    const firstname = _pick(rng, L.firstNames);
    const lastname  = _pick(rng, L.lastNames);
    const row       = _pick(rng, L.addresses);
    const zip       = _pick(rng, row.zips);
    const streetNo  = 1 + Math.floor(rng() * 998);
    const domain    = _pick(rng, L.emailDomains);
    const tag       = Math.floor(rng() * 9000) + 1000;
    const person = {
      firstname, lastname, fullname: `${firstname} ${lastname}`,
      username: `${_slug(firstname)}_${_slug(lastname)}${tag}`,
      email: `${_slug(firstname)}.${_slug(lastname)}.${tag}@${domain}`,
      phone: _digits(rng, L.phoneTemplate),
      street1: `${streetNo} ${_pick(rng, L.streets)}`, street2: '',
      city: row.city, state: row.state, zip, country,
      password: `Dev${tag}!aZ`,
      dob: `19${70 + Math.floor(rng() * 30)}-0${1 + Math.floor(rng() * 9)}-1${Math.floor(rng() * 9)}`,
      business: `${lastname} ${_pick(rng, ['Holdings','Labs','Group','Trading'])} Pty Ltd`,
      genericText: 'Automated test input generated for development and QA validation.'
    };
    return person; // pins applied in Task 5
  }
```

Extend the export object: `…, toEngineValues, LOCALES, generatePerson };`

- [ ] **Step 4: Run test to verify it passes** — `node --check formdata.js && node test/formdata-generate.test.js` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add formdata.js test/formdata-generate.test.js
git commit -m "feat: country-coherent person generator (seedable) in formdata"
```

---

## Task 5: `formdata.js` — pins (incl. `emailDomain`)

**Files:** Modify `formdata.js`; create `test/formdata-pins.test.js`

**Interfaces:** Adds `applyPins(values, pins) → values'` (non-mutating). `pins.emailDomain` rewrites only the domain of `values.email`; any other key that is a canonical field replaces that value; unknown keys ignored. `generatePerson` now ends with `return applyPins(person, profile && profile.pins);`.

- [ ] **Step 1: Write the failing test** — create `test/formdata-pins.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;
const base = { email: 'jane.doe.1234@example.com.au', business: 'X Pty', zip: '4000', firstname: 'Jane' };
const pinned = F.applyPins(base, { emailDomain: 'mycorp.test', business: 'Aether Dynamics Pty Ltd', zip: '4122' });
eq(pinned.email, 'jane.doe.1234@mycorp.test', 'emailDomain rewrites domain only');
eq(pinned.business, 'Aether Dynamics Pty Ltd', 'business pin overrides');
eq(pinned.zip, '4122', 'zip pin overrides');
eq(base.email, 'jane.doe.1234@example.com.au', 'does not mutate input');
eq(F.applyPins(base, { bogus: 'x' }).firstname, 'Jane', 'unknown pin ignored');
ok(F.generatePerson({ country: 'AU', pins: { emailDomain: 'pinned.test' } }, { seed: 5 }).email.endsWith('@pinned.test'),
  'generatePerson applies emailDomain pin');
done('formdata-pins');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/formdata-pins.test.js` → FAIL (`applyPins is not a function`).

- [ ] **Step 3: Add `applyPins` (before `generatePerson`) and call it:**

```js
  function applyPins(values, pins) {
    const out = Object.assign({}, values);
    if (!pins) return out;
    Object.keys(pins).forEach(key => {
      const v = pins[key]; if (v == null || v === '') return;
      if (key === 'emailDomain') {
        if (out.email && out.email.indexOf('@') !== -1) out.email = out.email.replace(/@.*$/, '@' + v);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(CANONICAL_TO_ENGINE, key)) out[key] = v;
    });
    return out;
  }
```

Change `generatePerson`'s last line from `return person;` to `return applyPins(person, profile && profile.pins);`. Add `applyPins` to the export object.

- [ ] **Step 4: Run tests to verify they pass** — `node --check formdata.js && node test/formdata-pins.test.js && node test/formdata-generate.test.js` → both PASS.

- [ ] **Step 5: Commit:**

```bash
git add formdata.js test/formdata-pins.test.js
git commit -m "feat: profile pins (emailDomain + field overrides) in formdata"
```

---

## Task 6: `formdata.js` — policy gate, `applyPolicy`/`resolveValues`, seeds

**Files:** Modify `formdata.js`; create `test/formdata-policy.test.js`

**Interfaces:** Adds to `window.SFFormData`:
- `MENU_ONLY` → `{ name:['name','contact'], address:['address'], nameAddress:['name','contact','address'], all:null }`.
- `shouldFill(canonicalKey, policy, only) → boolean` (group enabled ∧ key not excluded ∧ (`only==null` ∨ group ∈ `only`)).
- `applyPolicy(engineValues, policy, only) → engineValues'` — keeps only engine categories whose canonical key passes `shouldFill`.
- `resolveValues(profile, only, opts?) → engineValues` — `applyPolicy(toEngineValues(generatePerson(profile, opts)), profile.policy, only)`. The single value-resolution entry point the fill engine calls.
- `PROFILES_VERSION` → `1`; `DEFAULT_PROFILES` → `Profile[]` (four seeds).

- [ ] **Step 1: Write the failing test** — create `test/formdata-policy.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;
const allOn = { groups:{ name:true, contact:true, address:true, account:true, misc:true }, exclude:[] };

const noAddr = { groups:{ name:true, contact:true, address:false, account:false, misc:false }, exclude:[] };
ok(F.shouldFill('firstname', noAddr, null), 'name on');
ok(!F.shouldFill('street1', noAddr, null), 'address off');
const exEmail = { groups: allOn.groups, exclude: ['email'] };
ok(!F.shouldFill('email', exEmail, null), 'email excluded');
ok(F.shouldFill('phone', exEmail, null), 'phone still on');
ok(F.shouldFill('firstname', allOn, F.MENU_ONLY.name), 'name-only fills name');
ok(!F.shouldFill('street1', allOn, F.MENU_ONLY.name), 'name-only skips address');
ok(F.shouldFill('street1', allOn, F.MENU_ONLY.address), 'address-only fills address');
ok(F.shouldFill('password', allOn, F.MENU_ONLY.all), 'all fills account');

// applyPolicy + resolveValues operate on engine-category maps
const eng = F.toEngineValues(F.generatePerson({ country:'AU' }, { seed: 2 }));
const all = F.applyPolicy(eng, allOn, null);
ok(all.firstName && all.address1 && all.email, 'applyPolicy all keeps categories');
const nameOnly = F.applyPolicy(eng, allOn, F.MENU_ONLY.name);
ok(nameOnly.firstName && !('address1' in nameOnly), 'applyPolicy name-only drops address');
const ex = F.applyPolicy(eng, { groups: allOn.groups, exclude:['email'] }, null);
ok(!('email' in ex) && ('phone' in ex), 'applyPolicy honours exclude');
const prof = { country:'AU', policy: allOn, pins:{} };
const resolved = F.resolveValues(prof, F.MENU_ONLY.address, { seed: 9 });
ok(resolved.address1 && !('firstName' in resolved), 'resolveValues address-only');

eq(F.PROFILES_VERSION, 1, 'version 1');
eq(F.DEFAULT_PROFILES.length, 4, 'four seeds');
ok(F.DEFAULT_PROFILES.find(p => p.id === 'au-business').pins.business, 'au-business pins business');
done('formdata-policy');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/formdata-policy.test.js` → FAIL (`shouldFill is not a function`).

- [ ] **Step 3: Add policy gate, value resolution, and seeds to `formdata.js`:**

```js
  const MENU_ONLY = { name:['name','contact'], address:['address'],
    nameAddress:['name','contact','address'], all:null };

  function shouldFill(key, policy, only) {
    const g = groupForField(key);
    if (!g) return false;
    if (!policy || !policy.groups || !policy.groups[g]) return false;
    if (policy.exclude && policy.exclude.indexOf(key) !== -1) return false;
    if (only && only.indexOf(g) === -1) return false;
    return true;
  }
  function applyPolicy(engineValues, policy, only) {
    const out = {};
    Object.keys(engineValues || {}).forEach(cat => {
      const canonical = ENGINE_TO_CANONICAL[cat];
      if (canonical && shouldFill(canonical, policy, only)) out[cat] = engineValues[cat];
    });
    return out;
  }
  function resolveValues(profile, only, opts) {
    return applyPolicy(toEngineValues(generatePerson(profile, opts)), profile && profile.policy, only || null);
  }

  const PROFILES_VERSION = 1;
  const _allGroups = { name:true, contact:true, address:true, account:true, misc:true };
  const DEFAULT_PROFILES = [
    { id:'au-personal', label:'AU Personal', country:'AU', randomize:true,
      policy:{ groups:Object.assign({}, _allGroups, { misc:false }), exclude:[] }, pins:{} },
    { id:'au-business', label:'AU Business / Company', country:'AU', randomize:true,
      policy:{ groups:Object.assign({}, _allGroups), exclude:[] }, pins:{ business:'Aether Dynamics Pty Ltd' } },
    { id:'us-test', label:'US Test User', country:'US', randomize:true,
      policy:{ groups:Object.assign({}, _allGroups, { misc:false }), exclude:[] }, pins:{} },
    { id:'minimal', label:'Minimal / Edge Case', country:'AU', randomize:true,
      policy:{ groups:{ name:true, contact:false, address:false, account:false, misc:false }, exclude:[] }, pins:{} }
  ];
```

Extend the export: `…, applyPins, MENU_ONLY, shouldFill, applyPolicy, resolveValues, PROFILES_VERSION, DEFAULT_PROFILES };`

- [ ] **Step 4: Run test to verify it passes** — `node --check formdata.js && node test/formdata-policy.test.js` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add formdata.js test/formdata-policy.test.js
git commit -m "feat: policy gate, value resolution, and profile seeds in formdata"
```

---

## Task 7: `background.js` — seed & migrate `profiles`

**Files:** Create `seed-data.node.js`, `test/background-seed.test.js`, `test/seed-drift.test.js`; modify `background.js`

**Interfaces:** `seedProfiles(store)` where `store = { get(keys)→Promise, set(obj)→Promise }`. Seeds `profiles` + `profilesVersion` when `profiles` absent **or** stored version < `PROFILES_VERSION`; never overwrites when present+current; sets `defaultProfile` to the first seed id only if unset. Defined once in `seed-data.node.js` (CommonJS, for tests) and mirrored inline in `background.js` (the service worker is an ES module and cannot load the classic `window.SFFormData` global). `test/seed-drift.test.js` fails the build if ids/version drift between `seed-data.node.js`, `background.js`, and `formdata.js`.

> **Why duplicated:** a module-worker can't share a classic `window.*` global. Accepted; the drift-guard test is the safety net. Do not attempt to collapse the three copies — there is no no-build way to do so across a module worker, a classic content script, and CommonJS tests.

- [ ] **Step 1: Write the failing test** — create `test/background-seed.test.js`:

```js
const path = require('path');
const { eq, ok, done } = require('./harness');
const { seedProfiles, DEFAULT_PROFILES, PROFILES_VERSION } = require(path.resolve(__dirname, '..', 'seed-data.node.js'));
function fakeStore(initial) {
  const data = Object.assign({}, initial);
  return { data,
    get(keys){ const o={}; (Array.isArray(keys)?keys:[keys]).forEach(k=>{ if(k in data) o[k]=data[k]; }); return Promise.resolve(o); },
    set(obj){ Object.assign(data, obj); return Promise.resolve(); } };
}
(async () => {
  const s1 = fakeStore({}); await seedProfiles(s1);
  eq(s1.data.profiles.length, 4, 'seeds when absent');
  eq(s1.data.profilesVersion, PROFILES_VERSION, 'sets version');
  eq(s1.data.defaultProfile, DEFAULT_PROFILES[0].id, 'sets default when unset');
  const s2 = fakeStore({ profiles:[{id:'mine'}], profilesVersion: PROFILES_VERSION, defaultProfile:'mine' });
  await seedProfiles(s2);
  eq(s2.data.profiles.length, 1, 'no clobber when current');
  eq(s2.data.defaultProfile, 'mine', 'keeps existing default');
  const s3 = fakeStore({ profiles:[{id:'old'}], profilesVersion: 0, defaultProfile:'old' });
  await seedProfiles(s3);
  eq(s3.data.profiles.length, 4, 'reseeds when older');
  done('background-seed');
})();
```

- [ ] **Step 2: Run it to verify it fails** — `node test/background-seed.test.js` → FAIL (`Cannot find module '…/seed-data.node.js'`).

- [ ] **Step 3: Create `seed-data.node.js`:**

```js
// seed-data.node.js — CommonJS source of truth for seed logic (requireable by tests).
// background.js mirrors this inline (module worker can't load the classic global).
const PROFILES_VERSION = 1;
const _all = { name:true, contact:true, address:true, account:true, misc:true };
const DEFAULT_PROFILES = [
  { id:'au-personal', label:'AU Personal', country:'AU', randomize:true,
    policy:{ groups:Object.assign({}, _all, { misc:false }), exclude:[] }, pins:{} },
  { id:'au-business', label:'AU Business / Company', country:'AU', randomize:true,
    policy:{ groups:Object.assign({}, _all), exclude:[] }, pins:{ business:'Aether Dynamics Pty Ltd' } },
  { id:'us-test', label:'US Test User', country:'US', randomize:true,
    policy:{ groups:Object.assign({}, _all, { misc:false }), exclude:[] }, pins:{} },
  { id:'minimal', label:'Minimal / Edge Case', country:'AU', randomize:true,
    policy:{ groups:{ name:true, contact:false, address:false, account:false, misc:false }, exclude:[] }, pins:{} }
];
async function seedProfiles(store) {
  const cur = await store.get(['profiles', 'profilesVersion', 'defaultProfile']);
  const needsSeed = !cur.profiles || (cur.profilesVersion || 0) < PROFILES_VERSION;
  const patch = {};
  if (needsSeed) { patch.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES)); patch.profilesVersion = PROFILES_VERSION; }
  if (!cur.defaultProfile) patch.defaultProfile = DEFAULT_PROFILES[0].id;
  if (Object.keys(patch).length) await store.set(patch);
}
module.exports = { PROFILES_VERSION, DEFAULT_PROFILES, seedProfiles };
```

- [ ] **Step 4: Mirror into `background.js`.** Inside the existing `chrome.runtime.onInstalled` listener (create one if absent), add the inline mirror + call:

```js
const PROFILES_VERSION = 1;
const _allGroups = { name:true, contact:true, address:true, account:true, misc:true };
const DEFAULT_PROFILES = [
  { id:'au-personal', label:'AU Personal', country:'AU', randomize:true,
    policy:{ groups:{ ..._allGroups, misc:false }, exclude:[] }, pins:{} },
  { id:'au-business', label:'AU Business / Company', country:'AU', randomize:true,
    policy:{ groups:{ ..._allGroups }, exclude:[] }, pins:{ business:'Aether Dynamics Pty Ltd' } },
  { id:'us-test', label:'US Test User', country:'US', randomize:true,
    policy:{ groups:{ ..._allGroups, misc:false }, exclude:[] }, pins:{} },
  { id:'minimal', label:'Minimal / Edge Case', country:'AU', randomize:true,
    policy:{ groups:{ name:true, contact:false, address:false, account:false, misc:false }, exclude:[] }, pins:{} }
];
async function seedProfiles(store) {
  const cur = await store.get(['profiles', 'profilesVersion', 'defaultProfile']);
  const needsSeed = !cur.profiles || (cur.profilesVersion || 0) < PROFILES_VERSION;
  const patch = {};
  if (needsSeed) { patch.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES)); patch.profilesVersion = PROFILES_VERSION; }
  if (!cur.defaultProfile) patch.defaultProfile = DEFAULT_PROFILES[0].id;
  if (Object.keys(patch).length) await store.set(patch);
}
chrome.runtime.onInstalled.addListener(() => {
  seedProfiles({ get: (k) => chrome.storage.local.get(k), set: (o) => chrome.storage.local.set(o) });
});
```

- [ ] **Step 5: Create `test/seed-drift.test.js`:**

```js
const path = require('path'), fs = require('fs');
const { ok, done } = require('./harness');
const { DEFAULT_PROFILES, PROFILES_VERSION } = require(path.resolve(__dirname, '..', 'seed-data.node.js'));
const root = path.resolve(__dirname, '..');
const has = (s, id) => s.indexOf(`id:'${id}'`) !== -1 || s.indexOf(`id: '${id}'`) !== -1;
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
ok(bg.indexOf('PROFILES_VERSION = ' + PROFILES_VERSION) !== -1, 'background version matches');
DEFAULT_PROFILES.forEach(p => ok(has(bg, p.id), `background seeds ${p.id}`));
const fd = fs.readFileSync(path.join(root, 'formdata.js'), 'utf8');
DEFAULT_PROFILES.forEach(p => ok(has(fd, p.id), `formdata seeds ${p.id}`));
done('seed-drift');
```

- [ ] **Step 6: Run tests to verify they pass** — `node --check background.js && node test/background-seed.test.js && node test/seed-drift.test.js` → all PASS.

- [ ] **Step 7: Commit:**

```bash
git add seed-data.node.js background.js test/background-seed.test.js test/seed-drift.test.js
git commit -m "feat: seed/migrate storage-backed profiles on install"
```

---

## Task 8: `formdata.js` — profile data-ops (CRUD)

**Files:** Modify `formdata.js`; create `test/formdata-crud.test.js`

**Interfaces:** Adds pure data-ops to `window.SFFormData` (no DOM):
- `profilesCreate(profiles, label) → { profiles, id }` (appends a blank: AU, all-groups-on, empty pins; id = unique slug of label).
- `profilesClone(profiles, id) → { profiles, id }` (deep copy, "… (copy)" label, fresh id).
- `profilesRename(profiles, id, label) → profiles`.
- `profilesDelete(profiles, id) → profiles` (refuses to delete the last remaining profile → returns unchanged).
- `profilePatch(profiles, id, patch) → profiles` (shallow-merge `country`/`policy`/`pins`/`label`).

- [ ] **Step 1: Write the failing test** — create `test/formdata-crud.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;
let profiles = JSON.parse(JSON.stringify(F.DEFAULT_PROFILES));

let r = F.profilesCreate(profiles, 'My Profile'); profiles = r.profiles;
eq(profiles.length, 5, 'create appends');
eq(profiles.find(p => p.id === r.id).country, 'AU', 'new profile AU default');
r = F.profilesClone(profiles, 'us-test'); profiles = r.profiles;
eq(profiles.length, 6, 'clone appends');
ok(profiles.find(p => p.id === r.id).label.indexOf('copy') !== -1, 'clone label tagged');
ok(profiles.find(p => p.id === r.id).country === 'US', 'clone copies country');
profiles = F.profilesRename(profiles, r.id, 'Renamed');
eq(profiles.find(p => p.id === r.id).label, 'Renamed', 'renamed');
profiles = F.profilePatch(profiles, 'au-personal', { country: 'US', pins: { emailDomain: 'x.test' } });
const ap = profiles.find(p => p.id === 'au-personal');
eq(ap.country, 'US', 'patched country'); eq(ap.pins.emailDomain, 'x.test', 'patched pins');
profiles = F.profilesDelete(profiles, r.id);
ok(!profiles.find(p => p.id === r.id), 'deleted');
eq(F.profilesDelete([profiles[0]], profiles[0].id).length, 1, 'refuses to delete last');
done('formdata-crud');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/formdata-crud.test.js` → FAIL (`profilesCreate is not a function`).

- [ ] **Step 3: Add the data-ops to `formdata.js`:**

```js
  function _slug(s){ return (s||'profile').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
  function _uniqueId(profiles, base){
    base = base || 'profile'; let id = base, n = 1;
    const taken = {}; profiles.forEach(p => { taken[p.id] = true; });
    while (taken[id]) { id = `${base}-${n++}`; }
    return id;
  }
  function _blankPolicy(){ return { groups:{ name:true, contact:true, address:true, account:true, misc:true }, exclude:[] }; }
  function profilesCreate(profiles, label){
    const next = profiles.slice(); const id = _uniqueId(next, _slug(label));
    next.push({ id, label: label || 'New Profile', country:'AU', randomize:true, policy:_blankPolicy(), pins:{} });
    return { profiles: next, id };
  }
  function profilesClone(profiles, id){
    const src = profiles.find(p => p.id === id); if (!src) return { profiles, id:null };
    const next = profiles.slice(); const newId = _uniqueId(next, _slug(src.label) + '-copy');
    next.push(Object.assign(JSON.parse(JSON.stringify(src)), { id:newId, label: src.label + ' (copy)' }));
    return { profiles: next, id: newId };
  }
  function profilesRename(profiles, id, label){ return profiles.map(p => p.id === id ? Object.assign({}, p, { label }) : p); }
  function profilesDelete(profiles, id){ return profiles.length <= 1 ? profiles : profiles.filter(p => p.id !== id); }
  function profilePatch(profiles, id, patch){ return profiles.map(p => p.id === id ? Object.assign({}, p, patch) : p); }
```

Extend the export: `…, DEFAULT_PROFILES, profilesCreate, profilesClone, profilesRename, profilesDelete, profilePatch };`

- [ ] **Step 4: Run test to verify it passes** — `node --check formdata.js && node test/formdata-crud.test.js` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add formdata.js test/formdata-crud.test.js
git commit -m "feat: profile CRUD data-ops in formdata"
```

---

## Task 9: `profile-ui.js` — shared DOM builders

**Files:** Create `profile-ui.js`, `test/profile-ui.test.js`

**Interfaces:** Consumes `window.SFAddress`. Produces `window.SFProfileUI`:
- `buildMenu(doc, profiles, defaultId) → HTMLElement` — a menu with four `[data-only]` action buttons (`name`, `address`, `nameAddress`, `all`) labelled "Fill name / Fill address / Fill name + address / Fill all", a profile `<select>` (preselect `defaultId`), and a `[data-action="clear"]` "Clear fields" button.
- `populateProfileSelect(doc, selectEl, profiles, defaultId) → selectEl` — replaces options from `profiles`, preselects `defaultId`.
- `renderAddressFields(doc, container, country) → void` — renders one labelled input (`[data-field]`) per shown address field in `SFAddress.getFieldConfig(country).order` order, with country label, `*` for required, and zip hint placeholder; replaces prior fields on re-invocation.

> All three take `doc` explicitly so they are pure of any ambient `document` and trivially testable.

- [ ] **Step 1: Write the failing test** — create `test/profile-ui.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'profile-ui.js'],
  '<!DOCTYPE html><body><select id="s"></select><div id="c"></div></body>');
const UI = win.SFProfileUI, doc = win.document;

// buildMenu
const menu = UI.buildMenu(doc, [{ id:'au-personal', label:'AU Personal' }, { id:'us-test', label:'US Test User' }], 'us-test');
['Fill name','Fill address','Fill name + address','Fill all','Clear'].forEach(t => ok(menu.textContent.indexOf(t) !== -1, `menu has "${t}"`));
const onlys = Array.from(menu.querySelectorAll('[data-only]')).map(b => b.getAttribute('data-only'));
['name','address','nameAddress','all'].forEach(k => ok(onlys.indexOf(k) !== -1, `action ${k} present`));
const msel = menu.querySelector('select');
eq(msel.options.length, 2, 'menu profile select has 2'); eq(msel.value, 'us-test', 'menu default preselected');

// populateProfileSelect
const sel = doc.getElementById('s');
UI.populateProfileSelect(doc, sel, [{ id:'au-personal', label:'AU Personal' }, { id:'us-test', label:'US Test User' }], 'us-test');
eq(sel.options.length, 2, 'select 2 options'); eq(sel.value, 'us-test', 'select default'); eq(sel.options[0].textContent, 'AU Personal', 'label rendered');

// renderAddressFields (AU then US re-render)
const c = doc.getElementById('c');
UI.renderAddressFields(doc, c, 'AU');
let labels = Array.from(c.querySelectorAll('label')).map(l => l.textContent);
ok(labels.some(t => t.indexOf('Suburb') !== -1), 'AU Suburb');
ok(labels.some(t => t.indexOf('State/Territory') !== -1), 'AU State/Territory');
ok(labels.some(t => t.indexOf('Postcode') !== -1), 'AU Postcode');
UI.renderAddressFields(doc, c, 'US');
labels = Array.from(c.querySelectorAll('label')).map(l => l.textContent);
ok(labels.some(t => t.indexOf('City') !== -1), 'US City after re-render');
ok(labels.some(t => t.indexOf('ZIP') !== -1), 'US ZIP');
ok(!labels.some(t => t.indexOf('Suburb') !== -1), 'AU fields cleared on re-render');
done('profile-ui');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/profile-ui.test.js` → FAIL (`SFProfileUI` undefined).

- [ ] **Step 3: Create `profile-ui.js`:**

```js
// profile-ui.js — window.SFProfileUI: shared DOM builders for menu + profile editor.
// Classic global script. Loads after vendor/address-schemas.js.
;(function (root) {
  'use strict';
  const MENU_ACTIONS = [
    ['name', 'Fill name'], ['address', 'Fill address'],
    ['nameAddress', 'Fill name + address'], ['all', 'Fill all']
  ];
  const ADDR_KEYS_BY_GROUP = { street: ['street1', 'street2'], city: ['city'], state: ['state'], zip: ['zip'] };

  function _option(doc, value, text, selected) {
    const o = doc.createElement('option'); o.value = value; o.textContent = text; if (selected) o.selected = true; return o;
  }
  function populateProfileSelect(doc, sel, profiles, defaultId) {
    sel.innerHTML = '';
    (profiles || []).forEach(p => sel.appendChild(_option(doc, p.id, p.label || p.id, p.id === defaultId)));
    return sel;
  }
  function buildMenu(doc, profiles, defaultId) {
    const wrap = doc.createElement('div');
    MENU_ACTIONS.forEach(([key, label]) => {
      const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('data-only', key); wrap.appendChild(b);
    });
    const sel = doc.createElement('select'); sel.setAttribute('data-role', 'profile');
    populateProfileSelect(doc, sel, profiles, defaultId); wrap.appendChild(sel);
    const clear = doc.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear fields'; clear.setAttribute('data-action', 'clear');
    wrap.appendChild(clear);
    return wrap;
  }
  function renderAddressFields(doc, container, country) {
    const A = root.SFAddress, cfg = A.getFieldConfig(country);
    container.innerHTML = '';
    cfg.order.forEach(group => (ADDR_KEYS_BY_GROUP[group] || []).forEach(key => {
      const f = cfg.fields[key]; if (!f || !f.show) return;
      const wrap = doc.createElement('div');
      const label = doc.createElement('label'); label.textContent = f.label + (f.required ? ' *' : '');
      const input = doc.createElement('input'); input.setAttribute('data-field', key);
      if (key === 'zip') { const h = A.getZipHint(country); if (h) input.setAttribute('placeholder', h); }
      wrap.appendChild(label); wrap.appendChild(input); container.appendChild(wrap);
    }));
  }
  root.SFProfileUI = { buildMenu, populateProfileSelect, renderAddressFields };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes** — `node --check profile-ui.js && node test/profile-ui.test.js` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add profile-ui.js test/profile-ui.test.js
git commit -m "feat: shared profile DOM builders (window.SFProfileUI)"
```

---

## Task 10: `content.js` — rewire `fillWithProfile` to storage + `resolveValues`

**Files:** Modify `content.js`; create `test/helpers/chrome-mock.js`, `test/content-loadprofile.test.js`

**Interfaces:** Consumes `window.SFFormData.resolveValues`, `chrome.storage.local`. Changes:
- New `async function loadProfile(profileKey)` — reads `{profiles, defaultProfile}` from storage; falls back to `SFFormData.DEFAULT_PROFILES` when storage empty; returns the profile whose `id === (profileKey || defaultProfile || profiles[0].id)`, else `profiles[0]`. Exposed as `window.__sfLoadProfile` for testing.
- `fillWithProfile(profileKey, opts)`: `profile = await loadProfile(profileKey)`; `values = SFFormData.resolveValues(profile, (opts && opts.only) || null)`; the fill loop writes `values[category]` and **skips any field whose `category` is absent from `values`**. Remove `BUILTIN_PROFILES` and `uniquifyProfile` from this path. `opts.only` is a group-name array (from `MENU_ONLY`) or null.
- The combobox/vue-select/Places/cascade branches are unchanged; they still receive `value` from `values[category]`.

> The DOM write loop itself is verified manually (Task 16); jsdom can't faithfully render the live modal. This task unit-tests `loadProfile` (the only new content-specific branching) with a mocked `chrome`.

- [ ] **Step 1: Create the chrome mock** — `test/helpers/chrome-mock.js`:

```js
// Reusable fake chrome.storage.local for tests. Test infra (no production logic).
function makeChrome(initial) {
  const data = Object.assign({}, initial);
  return {
    storage: { local: {
      get: (keys) => Promise.resolve(
        (Array.isArray(keys) ? keys : [keys]).reduce((o, k) => { if (k in data) o[k] = data[k]; return o; }, {})),
      set: (obj) => { Object.assign(data, obj); return Promise.resolve(); }
    } },
    runtime: { onMessage: { addListener() {} }, lastError: null }
  };
}
module.exports = { makeChrome };
```

- [ ] **Step 2: Write the failing test** — `test/content-loadprofile.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');

function bootstrap(initial) {
  const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js']);
  win.chrome = makeChrome(initial);
  win.__smartFormFillerLoaded = false;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8'),
    win.document.defaultView.eval ? win : win); // content.js IIFE assigns window.__sfLoadProfile
  return win;
}

(async () => {
  const win = bootstrap({
    profiles: [{ id:'au-personal', label:'AU' }, { id:'us-test', label:'US' }],
    defaultProfile: 'us-test'
  });
  ok(typeof win.__sfLoadProfile === 'function', '__sfLoadProfile exposed');
  eq((await win.__sfLoadProfile(null)).id, 'us-test', 'falls back to defaultProfile');
  eq((await win.__sfLoadProfile('au-personal')).id, 'au-personal', 'honours explicit key');
  eq((await win.__sfLoadProfile('missing')).id, 'au-personal', 'unknown id -> first profile');

  const empty = bootstrap({});
  ok((await empty.__sfLoadProfile(null)).id, 'empty storage -> built-in default profile');
  done('content-loadprofile');
})();
```

> If `content.js`'s top-of-IIFE guard (`if (window.__smartFormFillerLoaded) return;`) prevents re-eval, the test sets it false before eval. If loading the full `content.js` under jsdom throws on an unrelated browser API, wrap the missing API on `win` (e.g. `win.MutationObserver`, `win.getComputedStyle`) in the test bootstrap — jsdom provides most. Add only what the load actually requires; do not stub fill-path internals.

- [ ] **Step 3: Run it to verify it fails** — `node test/content-loadprofile.test.js` → FAIL (`__sfLoadProfile` undefined).

- [ ] **Step 4: Implement in `content.js`.** Near the existing helpers inside the IIFE add:

```js
  async function loadProfile(profileKey) {
    const F = window.SFFormData;
    let profiles = [], defaultProfile = null;
    try {
      const s = await chrome.storage.local.get(['profiles', 'defaultProfile']);
      profiles = s.profiles || []; defaultProfile = s.defaultProfile || null;
    } catch (e) { /* storage unavailable */ }
    if (!profiles.length) profiles = F.DEFAULT_PROFILES;
    const wantId = profileKey || defaultProfile || profiles[0].id;
    return profiles.find(p => p.id === wantId) || profiles[0];
  }
  window.__sfLoadProfile = loadProfile; // exported for tests
```

In `fillWithProfile(profileKey, opts)` replace the `BUILTIN_PROFILES[...]` + `uniquifyProfile` block with:

```js
    const F = window.SFFormData;
    const profile = await loadProfile(profileKey);
    const values = F.resolveValues(profile, (opts && opts.only) || null);
```

In the fill loop, where it previously resolved a value via `valueForField(...)`, use:

```js
      if (!(category in values)) continue;   // gated out by policy/override
      const value = values[category];
```

Delete the now-unused `uniquifyProfile`; confirm via `grep -n "uniquifyProfile\|BUILTIN_PROFILES" content.js` that no live reference remains in the fill path (a still-referenced `BUILTIN_PROFILES` elsewhere — e.g. an unrelated default — may stay, but the fill path must not use it).

- [ ] **Step 5: Run tests to verify they pass** — `node --check content.js && node test/content-loadprofile.test.js` → PASS.

- [ ] **Step 6: Commit:**

```bash
git add content.js test/helpers/chrome-mock.js test/content-loadprofile.test.js
git commit -m "feat: fill from storage profiles via SFFormData.resolveValues"
```

---

## Task 11: `content.js` — rebuild the form-icon menu via `SFProfileUI`

**Files:** Modify `content.js` (`showFillMenu`/`runMenuAction`); create `test/content-menu-wiring.test.js`

**Interfaces:** Consumes `window.SFProfileUI.buildMenu`, `window.SFFormData.MENU_ONLY`, `chrome.storage.local`. `showFillMenu` loads `{profiles, defaultProfile}`, builds the menu via `SFProfileUI.buildMenu(document, profiles, defaultProfile)`, and wires events: clicking a `[data-only=key]` button → `runMenuAction(MENU_ONLY[key], profileSelect.value)`; the `[data-action=clear]` button → existing `clearDetected()`. `runMenuAction(only, profileId)` calls `fillWithProfile(profileId, { only })`. Icon placement / `formSections()` / `SF_UI_ATTR` unchanged.

> `buildMenu` itself is fully tested in Task 9. This task verifies the wiring contract: that the menu maps each action key to the right `MENU_ONLY` value. Expose `window.__sfMenuOnlyFor(key)` → `SFFormData.MENU_ONLY[key]` (a one-line accessor the click handler uses) so the mapping is unit-checkable without a live click.

- [ ] **Step 1: Write the failing test** — `test/content-menu-wiring.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js']);
win.chrome = makeChrome({ profiles: [{ id:'au-personal', label:'AU' }], defaultProfile: 'au-personal' });
win.__smartFormFillerLoaded = false;
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8'), win);
ok(typeof win.__sfMenuOnlyFor === 'function', '__sfMenuOnlyFor exposed');
eq(win.__sfMenuOnlyFor('name'), ['name','contact'], 'name -> name+contact');
eq(win.__sfMenuOnlyFor('address'), ['address'], 'address -> address');
eq(win.__sfMenuOnlyFor('nameAddress'), ['name','contact','address'], 'nameAddress -> all three');
eq(win.__sfMenuOnlyFor('all'), null, 'all -> null (use profile policy)');
done('content-menu-wiring');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/content-menu-wiring.test.js` → FAIL (`__sfMenuOnlyFor` undefined).

- [ ] **Step 3: Implement in `content.js`.** Replace the inline menu markup in `showFillMenu` with:

```js
    const { profiles = [], defaultProfile = null } =
      await chrome.storage.local.get(['profiles', 'defaultProfile']);
    const list = profiles.length ? profiles : window.SFFormData.DEFAULT_PROFILES;
    const menu = window.SFProfileUI.buildMenu(document, list, defaultProfile);
    const profileSel = menu.querySelector('select[data-role="profile"]');
    menu.querySelectorAll('[data-only]').forEach(btn => btn.addEventListener('click', () => {
      runMenuAction(__sfMenuOnlyFor(btn.getAttribute('data-only')), profileSel.value);
    }));
    menu.querySelector('[data-action="clear"]').addEventListener('click', () => clearDetected());
    // …append `menu` to the existing menu container / position as before…
```

Add the accessor + action runner:

```js
  function __sfMenuOnlyFor(key) { return window.SFFormData.MENU_ONLY[key]; }
  window.__sfMenuOnlyFor = __sfMenuOnlyFor;
  function runMenuAction(only, profileId) { return fillWithProfile(profileId, { only }); }
```

(Keep the existing menu container styling/teardown; only its contents + handlers change.)

- [ ] **Step 4: Run tests to verify they pass** — `node --check content.js && node test/content-menu-wiring.test.js && node test/content-loadprofile.test.js` → all PASS.

- [ ] **Step 5: Commit:**

```bash
git add content.js test/content-menu-wiring.test.js
git commit -m "feat: form-icon menu via SFProfileUI with field-set actions + profile picker"
```

---

## Task 12: `popup` — profile dropdown via `SFProfileUI`

**Files:** Modify `popup.html`, `popup.js`; create `test/popup-wiring.test.js`

**Interfaces:** Consumes `window.SFProfileUI.populateProfileSelect`, `chrome.storage.local`. On load, `popup.js` reads `{profiles, defaultProfile}` (falls back to `SFFormData.DEFAULT_PROFILES`) and calls `SFProfileUI.populateProfileSelect(document, profileSelect, profiles, defaultProfile)`. Fill buttons send `{ profileKey: profileSelect.value }` to the content script. `popup.html` loads `vendor/address-schemas.js`, `formdata.js`, `profile-ui.js` before `popup.js`.

- [ ] **Step 1: Write the failing test** — `test/popup-wiring.test.js`:

```js
const { loadGlobals, ok, done } = require('./harness');
const fs = require('fs'), path = require('path');
// popup.html must load the shared modules before popup.js
const html = fs.readFileSync(path.resolve(__dirname, '..', 'popup.html'), 'utf8');
['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js'].forEach(s =>
  ok(html.indexOf(s) !== -1, `popup.html loads ${s}`));
ok(html.indexOf('profile-ui.js') < html.indexOf('popup.js'), 'profile-ui.js before popup.js');
// the four hardcoded <option>s are gone (now injected)
ok(html.indexOf('au-personal') === -1 || html.indexOf('<option value="au-personal"') === -1,
  'no hardcoded profile options remain');
// popup.js calls the shared populator
const js = fs.readFileSync(path.resolve(__dirname, '..', 'popup.js'), 'utf8');
ok(js.indexOf('populateProfileSelect') !== -1, 'popup.js uses SFProfileUI.populateProfileSelect');
ok(js.indexOf('profileKey') !== -1, 'popup.js sends profileKey');
done('popup-wiring');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/popup-wiring.test.js` → FAIL (scripts not yet referenced).

- [ ] **Step 3: Wire `popup.html`/`popup.js`.**
  - In `popup.html`: remove the four hardcoded `<option>`s under `#profileSelect` (leave the empty `<select id="profileSelect">`). Before `<script src="recommendations.js">`/`<script src="popup.js">`, add `<script src="vendor/address-schemas.js"></script>`, `<script src="formdata.js"></script>`, `<script src="profile-ui.js"></script>`.
  - In `popup.js`: on DOM ready, `const { profiles, defaultProfile } = await chrome.storage.local.get(['profiles','defaultProfile']); const list = (profiles && profiles.length) ? profiles : window.SFFormData.DEFAULT_PROFILES; window.SFProfileUI.populateProfileSelect(document, document.getElementById('profileSelect'), list, defaultProfile);`. Update the fill button handlers to include `profileKey: document.getElementById('profileSelect').value` in the message payload sent to the content script.

- [ ] **Step 4: Run tests to verify they pass** — `node --check popup.js && node test/popup-wiring.test.js` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add popup.html popup.js test/popup-wiring.test.js
git commit -m "feat: popup profile dropdown via SFProfileUI from storage"
```

---

## Task 13: `options` — profile manager CRUD + dynamic address sub-form

**Files:** Modify `options.html`, `options.js`; create `test/options-wiring.test.js`

**Interfaces:** Consumes `window.SFFormData` (`DEFAULT_PROFILES`, `profilesCreate/Clone/Rename/Delete/profilePatch`), `window.SFProfileUI.renderAddressFields`, `window.SFAddress.listCountries`, `chrome.storage.local`. Adds a "Test Profiles" card: a list (`#profileList`), a "+ New profile" button, and an editor (`#profileEditor`). All mutations go through the `SFFormData` data-ops and persist via `chrome.storage.local.set({ profiles })`. The editor shows: a country `<select>` built from `SFAddress.listCountries()` (option text = `label` "🇦🇺 Australia", value = `code`, preselect profile country); group-toggle checkboxes; and the dynamic address sub-form rendered by `SFProfileUI.renderAddressFields(document, container, country)`, re-rendered on country change (which also `profilePatch`es `country` and persists). Per-field exclude checkboxes and pin inputs update `policy.exclude`/`pins` via `profilePatch`. `options.html` loads `vendor/address-schemas.js`, `formdata.js`, `profile-ui.js` before `options.js`.

> The CRUD logic and address rendering are fully unit-tested in Tasks 8 and 9. This task wires them into the options page; the test verifies the wiring contract (scripts loaded in order, the page calls the shared ops), and Task 16 verifies the live UX.

- [ ] **Step 1: Write the failing test** — `test/options-wiring.test.js`:

```js
const { ok, done } = require('./harness');
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'options.html'), 'utf8');
['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js'].forEach(s =>
  ok(html.indexOf(s) !== -1, `options.html loads ${s}`));
ok(html.indexOf('profile-ui.js') < html.indexOf('options.js'), 'profile-ui.js before options.js');
ok(html.indexOf('profileList') !== -1, 'options.html has #profileList');
ok(html.indexOf('profileEditor') !== -1, 'options.html has #profileEditor');
const js = fs.readFileSync(path.resolve(__dirname, '..', 'options.js'), 'utf8');
['profilesCreate','profilesClone','profilesRename','profilesDelete','profilePatch'].forEach(fn =>
  ok(js.indexOf(fn) !== -1, `options.js uses ${fn}`));
ok(js.indexOf('renderAddressFields') !== -1, 'options.js uses SFProfileUI.renderAddressFields');
ok(js.indexOf('listCountries') !== -1, 'options.js builds country picker from listCountries');
done('options-wiring');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/options-wiring.test.js` → FAIL (scripts/markup absent).

- [ ] **Step 3: Wire `options.html`/`options.js`.**
  - In `options.html`: add a "Test Profiles" card containing `<ul id="profileList"></ul>`, a `<button id="newProfileBtn">+ New profile</button>`, and `<div id="profileEditor"></div>`. Add `<script src="vendor/address-schemas.js"></script>`, `<script src="formdata.js"></script>`, `<script src="profile-ui.js"></script>` before `<script src="options.js">` (after `recommendations.js`).
  - In `options.js`: maintain `let profiles` loaded from storage (fallback `SFFormData.DEFAULT_PROFILES`). `renderList()` paints `#profileList` (each row: select-to-edit, plus clone/rename/delete buttons calling the matching `SFFormData.profiles*` op then `persist()`). `newProfileBtn` → `SFFormData.profilesCreate(profiles, 'New Profile')`. `renderEditor(id)` paints `#profileEditor`: a country `<select>` from `SFAddress.listCountries()`; group-toggle checkboxes bound to `profilePatch(profiles, id, { policy })`; then `SFProfileUI.renderAddressFields(document, addrContainer, profile.country)`. On country change → `profiles = SFFormData.profilePatch(profiles, id, { country }); persist(); SFProfileUI.renderAddressFields(document, addrContainer, country);`. Per-field exclude checkbox / pin input handlers update `policy.exclude` / `pins` via `profilePatch` + `persist()`. `persist()` = `chrome.storage.local.set({ profiles })`.

- [ ] **Step 4: Run tests to verify they pass** — `node --check options.js && node test/options-wiring.test.js` → PASS.

- [ ] **Step 5: Commit:**

```bash
git add options.html options.js test/options-wiring.test.js
git commit -m "feat: options profile manager CRUD + dynamic per-country address fields"
```

---

## Task 14: `manifest.json` + integration wiring & full check

**Files:** Modify `manifest.json`, `popup.html`, `popup.js` version badge; create `test/manifest-integration.test.js`

**Interfaces:** `manifest.json` `content_scripts[0].js` = `["vendor/address-schemas.js", "formdata.js", "profile-ui.js", "content.js"]` (in that order); `version` = `1.1.0`.

- [ ] **Step 1: Write the failing test** — `test/manifest-integration.test.js`:

```js
const fs = require('fs'), path = require('path');
const { ok, eq, done } = require('./harness');
const root = path.resolve(__dirname, '..');
const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
eq(m.content_scripts[0].js,
  ['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js', 'content.js'], 'content script load order');
eq(m.version, '1.1.0', 'version bumped');
const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
ok(popup.indexOf('v1.1.0') !== -1, 'popup version badge bumped');
done('manifest-integration');
```

- [ ] **Step 2: Run it to verify it fails** — `node test/manifest-integration.test.js` → FAIL on the load-order assertion.

- [ ] **Step 3: Update `manifest.json`:**

```json
  "version": "1.1.0",
  "content_scripts": [
    { "matches": ["<all_urls>"],
      "js": ["vendor/address-schemas.js", "formdata.js", "profile-ui.js", "content.js"],
      "run_at": "document_idle", "all_frames": false }
  ],
```

Bump the `popup.html` version badge text to `v1.1.0`.

- [ ] **Step 4: Run the whole suite + syntax checks:**

```bash
for f in vendor/address-schemas.js formdata.js profile-ui.js content.js background.js popup.js options.js seed-data.node.js; do node --check "$f" || exit 1; done
for f in test/*.test.js test/harness.selftest.js; do node "$f" || exit 1; done
```

Expected: every `node --check` silent; every test prints `✓ … 0 failed`; final exit 0.

- [ ] **Step 5: Commit:**

```bash
git add manifest.json popup.html test/manifest-integration.test.js
git commit -m "feat: register address/formdata/profile-ui content scripts; bump to v1.1.0"
```

---

## Task 15: Manual verification on the live form

**Files:** none (manual QA + notes)

- [ ] **Step 1:** Reload the unpacked extension (`chrome://extensions`) and open `https://vinum-dev.pos.dev.z42z.com/`.
- [ ] **Step 2:** Options → Test Profiles: confirm the four seeded profiles list; create/clone/rename/delete persists across reload. Switch a profile's country AU↔US and confirm the address fields + labels (Suburb/State-Territory/Postcode vs City/State/ZIP) re-render.
- [ ] **Step 3:** On the create-customer modal, click the form-icon → **Fill name** (only name/contact fill, address empty); **Fill address** (address + country/state vue-select fill coherently); **Fill all** (everything per policy). Run **Fill all** twice — names/addresses differ (randomization) and the country→state cascade still resolves.
- [ ] **Step 4:** Set a profile `exclude: ['email']` + `pins.emailDomain`; confirm a fill leaves email blank when excluded, and (email enabled) uses the pinned domain.
- [ ] **Step 5:** If a state/region option text doesn't match generated data for some country, note it for a `VALUE_ALIASES`/pool follow-up (do not expand scope here). Record results in the commit/PR notes.

---

## Self-Review Notes (author)

- **Spec coverage:** data model → Tasks 3,6,8; vendored address model → Task 2; generator + pools → Tasks 4,5; policy gate + selective fill → Tasks 6,10; form-icon menu → Tasks 9,11; popup dropdown → Tasks 9,12; options CRUD + dynamic address → Tasks 8,9,13; seeding/migration → Task 7; manifest/load-order → Task 14; testing → every task + Task 15 manual; uniquifier retirement → Task 10.
- **No duplicated production logic:** every pure/DOM helper has one home (`formdata.js` or `profile-ui.js` or `vendor/`); consumers call it; tests load the real module. Sole exception: the seed array (Task 7), guarded by `seed-drift.test.js`.
- **Naming consistency:** `shouldFill`, `applyPolicy`, `resolveValues`, `generatePerson`, `applyPins`, `toEngineValues`, `MENU_ONLY`, `profilesCreate/Clone/Rename/Delete`, `profilePatch`, `SFProfileUI.buildMenu/populateProfileSelect/renderAddressFields`, `loadProfile`/`__sfLoadProfile`, `__sfMenuOnlyFor` are defined once and referenced identically by their consumers.
