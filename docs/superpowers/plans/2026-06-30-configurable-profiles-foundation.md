# Configurable Test-Data Profiles (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four hardcoded fill profiles with storage-backed, country-aware *generator* profiles that produce randomized, country-coherent test data and let the user control which fields each fill completes (persistently per profile and transiently per fill).

**Architecture:** Two new classic global-namespaced scripts — `vendor/address-schemas.js` (`window.SFAddress`, a static port of the address-module's framework-free schema files) and `formdata.js` (`window.SFFormData`, locale pools + `generatePerson` generator + profile schema/seed + policy gate). `content.js`/`popup.js`/`options.js` consume those globals; `background.js` seeds `chrome.storage.local`. No build step, no runtime dependency on the address-module.

**Tech Stack:** Vanilla ES (classic scripts, `window.*` globals — the existing `recommendations.js` pattern), Chrome MV3 (`chrome.storage.local`), jsdom + Node for tests.

## Global Constraints

- **No build step.** All shipped scripts are plain classic scripts assigning to a `window.*` namespace; no `import`/`export`/bundler. (Matches `recommendations.js`.)
- **No runtime dependency on `~/src/vue/address-module`.** Vendored files are a hand-refreshable static copy; record provenance in a header comment.
- **Do not alter** the existing detection / visibility / section-icon / combobox-vue-select / Google-Places / cascade-pass logic in `content.js`. Only the profile-source, policy-gate, and menu code change.
- **Canonical field vocabulary:** `firstname, lastname, fullname, username, email, phone, street1, street2, city, state, zip, country, business, password, dob, genericText`. Engine-category mapping is fixed (see Task 3).
- **Field groups:** `name` (firstname, lastname, fullname, username), `contact` (email, phone), `address` (street1, street2, city, state, zip, country), `account` (password, dob), `misc` (business, genericText).
- **Profiles ship AU + US data pools.** Other countries get correct address *schema* (labels/required) + a generic data pool.
- **No AI** anywhere in this plan (deferred to spec #3).
- **Tests run with:** `node test/<file>.js` (exit 0 = pass). Never commit `node_modules/` or `package-lock.json` (already in `.gitignore`).
- **Commits** land on branch `feature/configurable-profiles`. Do not commit to `master`/`main`. No `Co-Authored-By` footer.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` (new) | Declares the `jsdom` dev dependency + `test` script. |
| `test/harness.js` (new) | Loads classic scripts into a jsdom window; tiny assert helpers. |
| `test/*.js` (new) | One test file per task (logic-level). |
| `vendor/address-schemas.js` (new) | `window.SFAddress`: schemas + field-config + zip validation + flag emoji + country list. Static port. |
| `formdata.js` (new) | `window.SFFormData`: field groups, engine mapping, locale pools, `generatePerson`, pins, policy gate, profile seed/defaults. |
| `content.js` (modify) | `fillWithProfile` rewired to storage+generator+policy gate; form-icon menu rebuilt. |
| `popup.html`/`popup.js` (modify) | Profile dropdown sourced from storage. |
| `options.html`/`options.js` (modify) | Profile-manager CRUD + dynamic per-country address sub-form. |
| `background.js` (modify) | Seed/migrate `profiles` on install/upgrade. |
| `manifest.json` (modify) | Register `vendor/address-schemas.js` + `formdata.js` content scripts; version bump. |

---

## Task 1: Test harness & dev tooling

**Files:**
- Create: `package.json`
- Create: `test/harness.js`
- Test: `test/harness.selftest.js`

**Interfaces:**
- Produces: `require('./harness')` → `{ loadGlobals(files, html?) → window, assert(cond,msg), eq(actual,expected,msg), ok(cond,msg), section(name), done(name) }`. `loadGlobals` reads each repo-relative file and evaluates it inside one jsdom window's VM context (so `window.Foo = …` assignments land on the returned `window`).

- [ ] **Step 1: Write the failing self-test**

Create `test/harness.selftest.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals([], '<!DOCTYPE html><body><div id="x">hi</div></body>');
ok(win.document.getElementById('x').textContent === 'hi', 'jsdom document available');
eq(typeof win.Node, 'function', 'window has DOM globals');
done('harness.selftest');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/harness.selftest.js`
Expected: FAIL — `Cannot find module './harness'`.

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "smart-form-filler-extension",
  "version": "1.0.1",
  "private": true,
  "description": "Dev-only tooling/tests for the SmartForm Filler extension (not shipped).",
  "scripts": {
    "test": "for f in test/*.js; do echo \"== $f ==\"; node \"$f\" || exit 1; done"
  },
  "devDependencies": {
    "jsdom": "^24.0.0"
  }
}
```

- [ ] **Step 4: Create `test/harness.js`**

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
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  return dom.window;
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ ' + msg); }
}
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

- [ ] **Step 5: Install jsdom and run the self-test**

Run: `npm install >/dev/null 2>&1 && node test/harness.selftest.js`
Expected: `✓ harness.selftest: 2 passed, 0 failed` (exit 0).

- [ ] **Step 6: Commit**

```bash
git add package.json test/harness.js test/harness.selftest.js .gitignore
git commit -m "test: add jsdom test harness for extension globals"
```

---

## Task 2: Vendor the address schema → `window.SFAddress`

**Files:**
- Create: `vendor/address-schemas.js`
- Test: `test/address-schemas.test.js`

**Interfaces:**
- Produces `window.SFAddress` with:
  - `ADDRESS_SCHEMAS` (object), `DEFAULT_SCHEMA` (object)
  - `getSchema(country) → schema`
  - `getFieldConfig(country) → { order:string[], fields:{ street1,street2,city,state,zip: {show,required,label, …} } }`
  - `validateZip(zip, country) → { valid:boolean, example?:string }`
  - `getZipHint(country) → string|null`
  - `countryCodeToFlagEmoji(code) → string`
  - `listCountries() → Array<{ code, name, flag, label }>` sorted by `name`, `label` = `"🇦🇺 Australia"`.

- [ ] **Step 1: Write the failing test**

Create `test/address-schemas.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js']);
const A = win.SFAddress;

// AU labels + required + order
const au = A.getFieldConfig('AU');
eq(au.fields.state.label, 'State/Territory', 'AU state label override');
eq(au.fields.city.label, 'Suburb', 'AU locality label');
eq(au.fields.zip.label, 'Postcode', 'AU zip label');
ok(au.fields.zip.required && au.fields.state.required, 'AU zip+state required');
eq(au.order, ['street', 'city', 'state', 'zip'], 'AU field order from fmt');

// US differs
const us = A.getFieldConfig('US');
eq(us.fields.city.label, 'City', 'US locality label');
eq(us.fields.zip.label, 'ZIP Code', 'US zip label');

// zip validation
ok(A.validateZip('4000', 'AU').valid, 'AU 4000 valid');
ok(!A.validateZip('ABCD', 'AU').valid, 'AU ABCD invalid');
ok(A.validateZip('94114', 'US').valid, 'US 94114 valid');

// flag + country list
eq(A.countryCodeToFlagEmoji('AU'), '\u{1F1E6}\u{1F1FA}', 'AU flag emoji');
const list = A.listCountries();
ok(list.length >= 30, 'at least 30 countries ported');
ok(list.some(c => c.code === 'AU' && c.label.indexOf('Australia') !== -1), 'AU in list with name');

// unknown country falls back to default schema (renders something)
ok(A.getFieldConfig('ZZ').fields.street1.show, 'unknown country still shows street');

done('address-schemas');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/address-schemas.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'getFieldConfig')` (no `SFAddress`).

- [ ] **Step 3: Create `vendor/address-schemas.js` (port)**

Build the file in this exact order inside one IIFE. **Port procedure:**

1. Copy the **entire** `ADDRESS_SCHEMAS` object literal and the `DEFAULT_SCHEMA` object literal **verbatim** from `~/src/vue/address-module/src/utils/addressSchemas.js` (all 35 countries). Remove the two `export const` keywords — declare them as plain `const`.
2. Paste the provider logic from `addressSchemaProvider.js` **verbatim**, but: delete its `import { ADDRESS_SCHEMAS, DEFAULT_SCHEMA } from './addressSchemas.js'` line (they're now local), and delete every `export` keyword (declare plain `function`).
3. Paste `countryCodeToFlagEmoji` **verbatim** from `countryCodeFormatter.js` (omit the two phone helpers — not needed).
4. Add the new `listCountries()` helper (below).
5. Expose the public surface on `root.SFAddress`.

The wrapper skeleton (fill the marked regions with the verbatim copies):

```js
// vendor/address-schemas.js
// Static port of ~/src/vue/address-module/src/utils/{addressSchemas,
// addressSchemaProvider,countryCodeFormatter}.js — framework-free.
// Provenance: chromium-i18n.appspot.com/ssl-address via address-module.
// Refresh by hand if the source schema set changes. DO NOT add a build dep.
;(function (root) {
  'use strict';

  // ----- BEGIN verbatim copy from addressSchemas.js (drop `export`) -----
  const DEFAULT_SCHEMA = {
    name: 'Default',
    fmt: '%N%n%O%n%A%n%C',
    require: 'AC',
    state_name_type: 'province',
    locality_name_type: 'city',
    zip_name_type: 'postal'
  };
  const ADDRESS_SCHEMAS = {
    AU: { name: 'Australia', fmt: '%O%n%N%n%A%n%C %S %Z', require: 'ACSZ',
          zip: '\\d{4}', zip_ex: '4113', state_name_type: 'state',
          state_label: 'State/Territory', locality_name_type: 'suburb',
          zip_name_type: 'postcode' },
    US: { name: 'United States', fmt: '%N%n%O%n%A%n%C, %S %Z', require: 'ACSZ',
          zip: '\\d{5}([ \\-]\\d{4})?', zip_ex: '62704', state_name_type: 'state',
          locality_name_type: 'city', zip_name_type: 'zip' },
    // … paste the remaining 33 countries (CA, GB, NZ, JP, …) verbatim …
  };
  // ----- END verbatim copy -----

  // ----- BEGIN verbatim copy from addressSchemaProvider.js -----
  // (drop the `import` line and every `export` keyword)
  const STATE_LABELS = { state:'State', province:'Province', prefecture:'Prefecture',
    county:'County', region:'Region', do_si:'Do/Si', area:'Area', district:'District',
    department:'Department', emirate:'Emirate', island:'Island', oblast:'Oblast', parish:'Parish' };
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
    const valid = new RegExp('^(?:'+schema.zip+')$').test(value);
    return { valid, example: schema.zip_ex || null };
  }
  function getZipHint(c){ const schema = getSchema(c); return schema.zip_ex ? `e.g. ${schema.zip_ex}` : null; }
  // ----- END verbatim copy -----

  // ----- verbatim from countryCodeFormatter.js -----
  function countryCodeToFlagEmoji(countryCode){
    if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) return '';
    const codePoints = countryCode.toUpperCase().split('').map(ch => 127397 + ch.charCodeAt());
    return String.fromCodePoint(...codePoints);
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

> When pasting the remaining 33 countries, keep them byte-for-byte from the source so the regexes stay valid.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check vendor/address-schemas.js && node test/address-schemas.test.js`
Expected: `node --check` silent (valid syntax); test prints `✓ address-schemas: … 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add vendor/address-schemas.js test/address-schemas.test.js
git commit -m "feat: vendor address schema model as window.SFAddress"
```

---

## Task 3: `formdata.js` — field groups, vocabulary & engine mapping

**Files:**
- Create: `formdata.js`
- Test: `test/formdata-groups.test.js`

**Interfaces:**
- Produces (initial slice of) `window.SFFormData`:
  - `FIELD_GROUPS` → `{ name:[…], contact:[…], address:[…], account:[…], misc:[…] }` (canonical keys).
  - `CANONICAL_TO_ENGINE` → map canonical→engine-category string.
  - `ENGINE_TO_CANONICAL` → reverse map.
  - `groupForField(canonicalKey) → 'name'|'contact'|'address'|'account'|'misc'|null`.
  - `toEngineValues(canonicalValueMap) → engineCategoryValueMap`.

- [ ] **Step 1: Write the failing test**

Create `test/formdata-groups.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js']);
const F = win.SFFormData;

eq(F.groupForField('email'), 'contact', 'email is contact');
eq(F.groupForField('street1'), 'address', 'street1 is address');
eq(F.groupForField('firstname'), 'name', 'firstname is name');
eq(F.groupForField('business'), 'misc', 'business is misc');
eq(F.groupForField('nope'), null, 'unknown key -> null');

eq(F.CANONICAL_TO_ENGINE.street1, 'address1', 'street1 -> address1');
eq(F.CANONICAL_TO_ENGINE.zip, 'postcode', 'zip -> postcode');
eq(F.CANONICAL_TO_ENGINE.business, 'company', 'business -> company');
eq(F.ENGINE_TO_CANONICAL.postcode, 'zip', 'postcode -> zip (reverse)');

const eng = F.toEngineValues({ street1: '17 Main St', zip: '4000', email: 'a@b.co' });
eq(eng.address1, '17 Main St', 'toEngineValues maps street1');
eq(eng.postcode, '4000', 'toEngineValues maps zip');
eq(eng.email, 'a@b.co', 'toEngineValues passes email');

done('formdata-groups');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/formdata-groups.test.js`
Expected: FAIL — `SFFormData` undefined.

- [ ] **Step 3: Create `formdata.js` (this slice)**

```js
// formdata.js — window.SFFormData: profile generator, field groups, policy gate.
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
    password:'password', dob:'dob',
    business:'company', genericText:'genericText'
  };
  const ENGINE_TO_CANONICAL = Object.keys(CANONICAL_TO_ENGINE)
    .reduce((acc, k) => { acc[CANONICAL_TO_ENGINE[k]] = k; return acc; }, {});

  const _GROUP_OF = (function () {
    const m = {};
    Object.keys(FIELD_GROUPS).forEach(g => FIELD_GROUPS[g].forEach(k => { m[k] = g; }));
    return m;
  })();
  function groupForField(key) { return _GROUP_OF[key] || null; }

  function toEngineValues(map) {
    const out = {};
    Object.keys(map || {}).forEach(k => {
      const e = CANONICAL_TO_ENGINE[k];
      if (e) out[e] = map[k];
    });
    return out;
  }

  root.SFFormData = {
    FIELD_GROUPS, CANONICAL_TO_ENGINE, ENGINE_TO_CANONICAL,
    groupForField, toEngineValues
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check formdata.js && node test/formdata-groups.test.js`
Expected: PASS — `✓ formdata-groups: … 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add formdata.js test/formdata-groups.test.js
git commit -m "feat: formdata field groups + canonical/engine mapping"
```

---

## Task 4: `formdata.js` — locale pools + `generatePerson` (seedable)

**Files:**
- Modify: `formdata.js`
- Test: `test/formdata-generate.test.js`

**Interfaces:**
- Consumes: `window.SFAddress.validateZip`, `getSchema`.
- Produces, added to `window.SFFormData`:
  - `LOCALES` → `{ AU:{…}, US:{…} }` (extensible).
  - `generatePerson(profile, opts?) → canonicalValueMap` with **every** canonical key set. `opts.seed` (integer) makes output deterministic. Generated `zip` matches the country schema's `zip` regex; `state`/`city`/`zip` come from one coherent row. `email`/`username` derive from the generated name. Pins are **not** applied here (Task 5).

- [ ] **Step 1: Write the failing test**

Create `test/formdata-generate.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js']);
const F = win.SFFormData, A = win.SFAddress;
const profAU = { country: 'AU' }, profUS = { country: 'US' };

// determinism
const a1 = F.generatePerson(profAU, { seed: 42 });
const a2 = F.generatePerson(profAU, { seed: 42 });
eq(a1, a2, 'same seed -> identical output');
ok(F.generatePerson(profAU, { seed: 1 }).email !== a1.email, 'different seed -> different output');

// completeness
['firstname','lastname','username','email','phone','street1','city','state','zip','country','password','dob','business','genericText']
  .forEach(k => ok(a1[k] !== undefined && a1[k] !== '', `generated ${k} present`));

// country coherence + zip validity
eq(a1.country, 'AU', 'country preserved');
ok(A.validateZip(a1.zip, 'AU').valid, 'AU zip matches schema regex');
const us = F.generatePerson(profUS, { seed: 7 });
ok(A.validateZip(us.zip, 'US').valid, 'US zip matches schema regex');

// email derived from name
ok(a1.email.toLowerCase().indexOf(a1.lastname.toLowerCase()) !== -1, 'email derived from last name');

// unknown country still generates (generic pool)
const zz = F.generatePerson({ country: 'ZZ' }, { seed: 3 });
ok(zz.firstname && zz.street1, 'generic fallback still produces a person');

done('formdata-generate');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/formdata-generate.test.js`
Expected: FAIL — `F.generatePerson is not a function`.

- [ ] **Step 3: Add pools + generator to `formdata.js`**

Insert before the `root.SFFormData = …` line. (Pools are intentionally small but real; extend later.)

```js
  // --- locale pools (AU + US shipped; others fall back to GENERIC) ---
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
      phoneTemplate: '04## ### ###',
      emailDomains: ['example.com.au','testmail.dev']
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
      phoneTemplate: '(###) ###-####',
      emailDomains: ['example.com','testmail.dev']
    }
  };
  const GENERIC = {
    firstNames: ['Alex','Sam','Jamie','Chris','Robin','Lee'],
    lastNames:  ['Taylor','Smith','Jones','Brown','Wilson','Clark'],
    streets:    ['Main Street','High Street','Park Road','Church Lane'],
    addresses:  [{ state: '', city: 'Springfield', zips: ['10000'] }],
    phoneTemplate: '### ### ####',
    emailDomains: ['example.com']
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
  function _digits(rng, template) {
    return template.replace(/#/g, () => String(Math.floor(rng() * 10)));
  }
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

    return {
      firstname,
      lastname,
      fullname: `${firstname} ${lastname}`,
      username: `${_slug(firstname)}_${_slug(lastname)}${tag}`,
      email: `${_slug(firstname)}.${_slug(lastname)}.${tag}@${domain}`,
      phone: _digits(rng, L.phoneTemplate),
      street1: `${streetNo} ${_pick(rng, L.streets)}`,
      street2: '',
      city: row.city,
      state: row.state,
      zip,
      country,
      password: `Dev${tag}!aZ`,
      dob: `19${70 + Math.floor(rng() * 30)}-0${1 + Math.floor(rng() * 9)}-1${Math.floor(rng() * 9)}`,
      business: `${lastname} ${_pick(rng, ['Holdings','Labs','Group','Trading'])} Pty Ltd`,
      genericText: 'Automated test input generated for development and QA validation.'
    };
  }
```

Then extend the export object:

```js
  root.SFFormData = {
    FIELD_GROUPS, CANONICAL_TO_ENGINE, ENGINE_TO_CANONICAL,
    groupForField, toEngineValues,
    LOCALES, generatePerson
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check formdata.js && node test/formdata-generate.test.js`
Expected: PASS — `✓ formdata-generate: … 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add formdata.js test/formdata-generate.test.js
git commit -m "feat: country-coherent person generator (seedable) in formdata"
```

---

## Task 5: `formdata.js` — pins (incl. `emailDomain`)

**Files:**
- Modify: `formdata.js`
- Test: `test/formdata-pins.test.js`

**Interfaces:**
- Produces, added to `window.SFFormData`:
  - `applyPins(values, pins) → values'` (non-mutating). `pins.emailDomain` rewrites only the domain of `values.email`; any other key in `pins` whose name is a canonical field replaces that value outright. Unknown pin keys are ignored.
  - `generatePerson` now calls `applyPins(person, profile.pins)` as its final step.

- [ ] **Step 1: Write the failing test**

Create `test/formdata-pins.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js']);
const F = win.SFFormData;

const base = { email: 'jane.doe.1234@example.com.au', business: 'X Pty', zip: '4000', firstname: 'Jane' };

const pinned = F.applyPins(base, { emailDomain: 'mycorp.test', business: 'Aether Dynamics Pty Ltd', zip: '4122' });
eq(pinned.email, 'jane.doe.1234@mycorp.test', 'emailDomain rewrites domain only');
eq(pinned.business, 'Aether Dynamics Pty Ltd', 'business pin overrides');
eq(pinned.zip, '4122', 'zip pin overrides');
eq(base.email, 'jane.doe.1234@example.com.au', 'applyPins does not mutate input');

// unknown pin ignored
eq(F.applyPins(base, { bogus: 'x' }).firstname, 'Jane', 'unknown pin ignored');

// generatePerson applies pins end-to-end
const p = F.generatePerson({ country: 'AU', pins: { emailDomain: 'pinned.test' } }, { seed: 5 });
ok(p.email.endsWith('@pinned.test'), 'generatePerson applies emailDomain pin');

done('formdata-pins');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/formdata-pins.test.js`
Expected: FAIL — `F.applyPins is not a function`.

- [ ] **Step 3: Add `applyPins` and call it from `generatePerson`**

Add this function (before `generatePerson`):

```js
  function applyPins(values, pins) {
    const out = Object.assign({}, values);
    if (!pins) return out;
    Object.keys(pins).forEach(key => {
      const v = pins[key];
      if (v == null || v === '') return;
      if (key === 'emailDomain') {
        if (out.email && out.email.indexOf('@') !== -1) {
          out.email = out.email.replace(/@.*$/, '@' + v);
        }
        return;
      }
      if (Object.prototype.hasOwnProperty.call(CANONICAL_TO_ENGINE, key)) {
        out[key] = v;
      }
    });
    return out;
  }
```

Change the end of `generatePerson` so its `return { … }` is captured and pinned:

```js
    const person = {
      firstname,
      // … all fields exactly as before …
      genericText: 'Automated test input generated for development and QA validation.'
    };
    return applyPins(person, profile && profile.pins);
  }
```

Add `applyPins` to the export object:

```js
    LOCALES, generatePerson, applyPins
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check formdata.js && node test/formdata-pins.test.js && node test/formdata-generate.test.js`
Expected: both PASS (generate test still green).

- [ ] **Step 5: Commit**

```bash
git add formdata.js test/formdata-pins.test.js
git commit -m "feat: profile pins (emailDomain + field overrides) in formdata"
```

---

## Task 6: `formdata.js` — policy gate + profile seed/defaults

**Files:**
- Modify: `formdata.js`
- Test: `test/formdata-policy.test.js`

**Interfaces:**
- Produces, added to `window.SFFormData`:
  - `PROFILES_VERSION` → `1` (integer).
  - `DEFAULT_PROFILES` → `Profile[]` (the four seeds as generator configs).
  - `shouldFill(canonicalKey, policy, only) → boolean`. `only` is `string[]` of group names or `null`. True iff the field's group is enabled in `policy.groups`, the key is not in `policy.exclude`, and (`only == null` or the field's group is in `only`).
  - `MENU_ONLY` → `{ name:['name','contact'], address:['address'], nameAddress:['name','contact','address'], all:null }` (group sets for the form-icon menu actions).

- [ ] **Step 1: Write the failing test**

Create `test/formdata-policy.test.js`:

```js
const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js']);
const F = win.SFFormData;

const policyAll = { groups: { name:true, contact:true, address:true, account:true, misc:true }, exclude: [] };

// group disabled
const noAddr = { groups: { name:true, contact:true, address:false, account:false, misc:false }, exclude: [] };
ok(F.shouldFill('firstname', noAddr, null), 'name filled when name group on');
ok(!F.shouldFill('street1', noAddr, null), 'street skipped when address group off');

// per-field exclude
const exclEmail = { groups: { name:true, contact:true, address:true, account:true, misc:true }, exclude: ['email'] };
ok(!F.shouldFill('email', exclEmail, null), 'email excluded by per-field exclude');
ok(F.shouldFill('phone', exclEmail, null), 'phone still filled');

// transient menu override (only)
ok(F.shouldFill('firstname', policyAll, F.MENU_ONLY.name), 'name-only fills name');
ok(!F.shouldFill('street1', policyAll, F.MENU_ONLY.name), 'name-only skips address');
ok(F.shouldFill('street1', policyAll, F.MENU_ONLY.address), 'address-only fills address');
ok(F.shouldFill('email', policyAll, F.MENU_ONLY.nameAddress), 'name+address fills contact');
ok(F.shouldFill('password', policyAll, F.MENU_ONLY.all), 'all fills account');

// seed set
eq(F.PROFILES_VERSION, 1, 'version is 1');
eq(F.DEFAULT_PROFILES.length, 4, 'four seeded profiles');
const ids = F.DEFAULT_PROFILES.map(p => p.id);
ok(ids.indexOf('au-personal') !== -1 && ids.indexOf('us-test') !== -1, 'expected ids seeded');
const biz = F.DEFAULT_PROFILES.find(p => p.id === 'au-business');
ok(biz.pins && biz.pins.business, 'au-business pins company/business');

done('formdata-policy');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/formdata-policy.test.js`
Expected: FAIL — `F.shouldFill is not a function`.

- [ ] **Step 3: Add policy gate + seed to `formdata.js`**

```js
  const MENU_ONLY = {
    name: ['name', 'contact'],
    address: ['address'],
    nameAddress: ['name', 'contact', 'address'],
    all: null
  };

  function shouldFill(key, policy, only) {
    const g = groupForField(key);
    if (!g) return false;
    if (!policy || !policy.groups || !policy.groups[g]) return false;
    if (policy.exclude && policy.exclude.indexOf(key) !== -1) return false;
    if (only && only.indexOf(g) === -1) return false;
    return true;
  }

  const PROFILES_VERSION = 1;
  const _allGroups = { name:true, contact:true, address:true, account:true, misc:true };
  const DEFAULT_PROFILES = [
    { id:'au-personal', label:'AU Personal', country:'AU', randomize:true,
      policy:{ groups:Object.assign({}, _allGroups, { misc:false }), exclude:[] }, pins:{} },
    { id:'au-business', label:'AU Business / Company', country:'AU', randomize:true,
      policy:{ groups:Object.assign({}, _allGroups), exclude:[] },
      pins:{ business:'Aether Dynamics Pty Ltd' } },
    { id:'us-test', label:'US Test User', country:'US', randomize:true,
      policy:{ groups:Object.assign({}, _allGroups, { misc:false }), exclude:[] }, pins:{} },
    { id:'minimal', label:'Minimal / Edge Case', country:'AU', randomize:true,
      policy:{ groups:{ name:true, contact:false, address:false, account:false, misc:false }, exclude:[] }, pins:{} }
  ];
```

Extend the export object:

```js
    LOCALES, generatePerson, applyPins,
    MENU_ONLY, shouldFill, PROFILES_VERSION, DEFAULT_PROFILES
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check formdata.js && node test/formdata-policy.test.js`
Expected: PASS — `✓ formdata-policy: … 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add formdata.js test/formdata-policy.test.js
git commit -m "feat: policy gate, menu-override sets, and profile seeds in formdata"
```

---

## Task 7: `background.js` — seed & migrate `profiles`

**Files:**
- Modify: `background.js`
- Test: `test/background-seed.test.js`

**Interfaces:**
- Consumes: `window.SFFormData.DEFAULT_PROFILES`, `PROFILES_VERSION`.
- Produces: `seedProfiles(store) → Promise<void>` where `store` is a `{ get(keys)→Promise, set(obj)→Promise }` shim over `chrome.storage.local`. Seeds `profiles` + `profilesVersion` when `profiles` is absent **or** stored `profilesVersion` < `PROFILES_VERSION`; never overwrites when present and current. Sets `defaultProfile` to the first seed id only if unset. Must be exported for tests (e.g. `globalThis.seedProfiles = seedProfiles` when not in a module context) **and** invoked from the existing `chrome.runtime.onInstalled` handler.

> **Why the seed data is duplicated:** the service worker is an ES module and cannot share `formdata.js`’s classic `window.*` global, so the seed array necessarily exists in three places: `formdata.js` (Task 6, for content/options), `background.js` (inline, for the install handler), and `seed-data.node.js` (CommonJS, so the Node tests can `require()` the *exact* seeding logic). This is accepted; **`test/seed-drift.test.js` (Step 4) fails the build if the ids or version drift** between the three copies. Do not try to collapse them into one file — there is no no-build way to do that across a module worker, a classic content script, and CommonJS tests.

- [ ] **Step 1: Write the failing test**

Create `test/background-seed.test.js`:

```js
const path = require('path');
const { ok, eq, done } = require('./harness');
const { seedProfiles, DEFAULT_PROFILES, PROFILES_VERSION } = require(path.resolve(__dirname, '..', 'seed-data.node.js'));

function fakeStore(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    get(keys) { const out = {}; (Array.isArray(keys)?keys:[keys]).forEach(k => { if (k in data) out[k] = data[k]; }); return Promise.resolve(out); },
    set(obj) { Object.assign(data, obj); return Promise.resolve(); }
  };
}

(async () => {
  // absent -> seeds
  const s1 = fakeStore({});
  await seedProfiles(s1);
  eq(s1.data.profiles.length, 4, 'seeds 4 profiles when absent');
  eq(s1.data.profilesVersion, PROFILES_VERSION, 'sets version');
  eq(s1.data.defaultProfile, DEFAULT_PROFILES[0].id, 'sets default when unset');

  // present + current -> untouched
  const s2 = fakeStore({ profiles: [{ id:'mine' }], profilesVersion: PROFILES_VERSION, defaultProfile: 'mine' });
  await seedProfiles(s2);
  eq(s2.data.profiles.length, 1, 'does not clobber current profiles');
  eq(s2.data.defaultProfile, 'mine', 'keeps existing default');

  // older version -> reseed
  const s3 = fakeStore({ profiles: [{ id:'old' }], profilesVersion: 0, defaultProfile: 'old' });
  await seedProfiles(s3);
  eq(s3.data.profiles.length, 4, 'reseeds when version older');

  done('background-seed');
})();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/background-seed.test.js`
Expected: FAIL — `Cannot find module '…/seed-data.node.js'`.

- [ ] **Step 3: Create the drift-free seed source and wire it in**

Create `seed-data.node.js` (CommonJS — the single source of truth for seed data + seeding logic, requireable by the test and by `background.js` via dynamic import is not needed; instead `background.js` will inline-import an ESM mirror generated below):

```js
// seed-data.node.js — single source of truth for profile seeds + seeding logic.
// CommonJS so tests can require() it. background.js mirrors the data via seed-data.js (ESM).
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
  if (needsSeed) {
    patch.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
    patch.profilesVersion = PROFILES_VERSION;
  }
  if (!cur.defaultProfile) patch.defaultProfile = DEFAULT_PROFILES[0].id;
  if (Object.keys(patch).length) await store.set(patch);
}

module.exports = { PROFILES_VERSION, DEFAULT_PROFILES, seedProfiles };
```

> **Drift control:** `formdata.js`’s `DEFAULT_PROFILES`/`PROFILES_VERSION` (Task 6) and this file are two copies. To keep them honest, add an assertion test (Step 4a) that compares them. They are small and stable; if you prefer a single copy, you may instead have `formdata.js` read from a global set by an inlined literal — but the two-copy + guard-test approach is the chosen, simplest no-build option.

Add a `chrome.storage.local` adapter and call it from `background.js`. In `background.js`, **inside the existing `chrome.runtime.onInstalled` listener** (and creating one if none exists), add:

```js
// Inline seed (service worker is an ES module; mirror of seed-data.node.js).
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
  if (needsSeed) {
    patch.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
    patch.profilesVersion = PROFILES_VERSION;
  }
  if (!cur.defaultProfile) patch.defaultProfile = DEFAULT_PROFILES[0].id;
  if (Object.keys(patch).length) await store.set(patch);
}
const _store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj)
};
chrome.runtime.onInstalled.addListener(() => { seedProfiles(_store); });
```

- [ ] **Step 4: Add the drift-guard test**

Append to `test/background-seed.test.js` is awkward (it `process.exit`s); instead create `test/seed-drift.test.js`:

```js
const path = require('path');
const fs = require('fs');
const { ok, eq, done } = require('./harness');
const { DEFAULT_PROFILES, PROFILES_VERSION } = require(path.resolve(__dirname, '..', 'seed-data.node.js'));

// background.js must embed the same version + ids, so the SW seed can't drift.
const bg = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'utf8');
ok(bg.indexOf('PROFILES_VERSION = ' + PROFILES_VERSION) !== -1, 'background PROFILES_VERSION matches');
DEFAULT_PROFILES.forEach(p => ok(bg.indexOf(`id:'${p.id}'`) !== -1 || bg.indexOf(`id: '${p.id}'`) !== -1,
  `background seeds ${p.id}`));

// formdata.js must embed the same ids too.
const fd = fs.readFileSync(path.resolve(__dirname, '..', 'formdata.js'), 'utf8');
DEFAULT_PROFILES.forEach(p => ok(fd.indexOf(`id:'${p.id}'`) !== -1 || fd.indexOf(`id: '${p.id}'`) !== -1,
  `formdata seeds ${p.id}`));

done('seed-drift');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --check background.js && node test/background-seed.test.js && node test/seed-drift.test.js`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add seed-data.node.js background.js test/background-seed.test.js test/seed-drift.test.js
git commit -m "feat: seed/migrate storage-backed profiles on install"
```

---

## Task 8: `content.js` — rewire `fillWithProfile` to storage + generator + policy gate

**Files:**
- Modify: `content.js` (`fillWithProfile`, and the message listener that calls it)
- Test: `test/content-fill.test.js`

**Interfaces:**
- Consumes: `window.SFFormData` (`generatePerson`, `toEngineValues`, `shouldFill`, `ENGINE_TO_CANONICAL`, `MENU_ONLY`), and `chrome.storage.local.get(['profiles','defaultProfile'])`.
- Changes `fillWithProfile(profileKey, opts)` so it: (1) loads the profile object from storage `profiles` by `id` (falling back to first profile, then to a built-in default config if storage empty); (2) calls `generatePerson(profile)` → `toEngineValues(...)`; (3) when assigning a detected field of engine-category `cat`, fills only if `shouldFill(ENGINE_TO_CANONICAL[cat], profile.policy, opts.only)` is true; (4) no longer calls `uniquifyProfile`. `opts.only` is a group-name array or null.
- Produces a small **testable pure helper** exported on `window` for the test: `window.__sfApplyPolicy(engineValues, policy, only) → engineValues'` (keeps only gated categories). The fill loop uses this helper.

- [ ] **Step 1: Write the failing test**

Create `test/content-fill.test.js` (tests the pure policy-application helper that the fill loop uses; full DOM fill is covered by the existing scratchpad scan/fill tests):

```js
const { loadGlobals, ok, eq, done } = require('./harness');
// Load globals the helper depends on, then a thin extract of the helper.
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js', 'test/fixtures/apply-policy.js']);
const apply = win.__sfApplyPolicy;
const F = win.SFFormData;

const values = F.toEngineValues(F.generatePerson({ country:'AU' }, { seed: 2 }));
const policyAll = { groups:{ name:true, contact:true, address:true, account:true, misc:true }, exclude:[] };

// all
const all = apply(values, policyAll, null);
ok(all.firstName && all.address1 && all.email, 'all categories kept');

// name-only override
const nameOnly = apply(values, policyAll, F.MENU_ONLY.name);
ok(nameOnly.firstName && !('address1' in nameOnly), 'name-only drops address');

// exclude email
const exEmail = apply(values, { groups: policyAll.groups, exclude: ['email'] }, null);
ok(!('email' in exEmail), 'excluded email dropped');
ok('phone' in exEmail, 'phone kept');

done('content-fill');
```

- [ ] **Step 2: Create the fixture mirroring the helper, run, verify it fails**

Create `test/fixtures/apply-policy.js` (this is the canonical helper body; Step 3 inlines the identical function into `content.js`):

```js
;(function (root) {
  function __sfApplyPolicy(engineValues, policy, only) {
    const F = root.SFFormData;
    const out = {};
    Object.keys(engineValues).forEach(cat => {
      const canonical = F.ENGINE_TO_CANONICAL[cat];
      if (canonical && F.shouldFill(canonical, policy, only)) out[cat] = engineValues[cat];
    });
    return out;
  }
  root.__sfApplyPolicy = __sfApplyPolicy;
})(typeof window !== 'undefined' ? window : globalThis);
```

Run: `node test/content-fill.test.js`
Expected: PASS only after the fixture exists; run once *before* creating the fixture to confirm the FAIL (`__sfApplyPolicy is not a function`), then create it and it should pass. (Document both runs.)

- [ ] **Step 3: Inline the helper and rewire `fillWithProfile` in `content.js`**

Near the top of the IIFE (after the existing helpers), add the identical helper:

```js
  function __sfApplyPolicy(engineValues, policy, only) {
    const F = window.SFFormData;
    const out = {};
    Object.keys(engineValues).forEach(cat => {
      const canonical = F.ENGINE_TO_CANONICAL[cat];
      if (canonical && F.shouldFill(canonical, policy, only)) out[cat] = engineValues[cat];
    });
    return out;
  }
  window.__sfApplyPolicy = __sfApplyPolicy; // exported for tests
```

Add a profile loader:

```js
  async function loadProfile(profileKey) {
    const F = window.SFFormData;
    let profiles = [], defaultProfile = null;
    try {
      const s = await chrome.storage.local.get(['profiles', 'defaultProfile']);
      profiles = s.profiles || [];
      defaultProfile = s.defaultProfile || null;
    } catch (e) { /* storage unavailable */ }
    if (!profiles.length) profiles = F.DEFAULT_PROFILES;
    const wantId = profileKey || defaultProfile || profiles[0].id;
    return profiles.find(p => p.id === wantId) || profiles[0];
  }
```

Rewrite the value-resolution part of `fillWithProfile(profileKey, opts)`:
- Replace the `BUILTIN_PROFILES[...]` lookup and the `if (opts.unique) profile = uniquifyProfile(profile)` block with:

```js
    const F = window.SFFormData;
    const profile = await loadProfile(profileKey);
    const generated = F.generatePerson(profile);                 // canonical values
    const engineAll = F.toEngineValues(generated);               // engine-category values
    const values = __sfApplyPolicy(engineAll, profile.policy, (opts && opts.only) || null);
```

- In the fill loop, where it previously called `valueForField(field, category, profile, allow)`, instead read `values[category]` and **skip the field entirely when `category` is absent from `values`** (gated out):

```js
      if (!(category in values)) continue;        // policy/override excluded this field
      const value = values[category];
```

- Remove `uniquifyProfile` calls from this path. (Leave the `uniquifyProfile` function defined but unused, or delete it; deleting is cleaner — confirm no other caller via `grep -n uniquifyProfile content.js`.)
- Keep all combobox/vue-select/Places/cascade branches exactly as they are; they consume `value` unchanged.

Update the message listener: the `'fillProfile'` / menu handlers must pass `opts.only` (group array) rather than `opts.unique`. The `'fillWithMap'` path is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --check content.js && node test/content-fill.test.js`
Expected: PASS. Also run `grep -n "uniquifyProfile\|BUILTIN_PROFILES" content.js` and confirm no live references remain in the fill path (only a possibly-deleted definition).

- [ ] **Step 5: Commit**

```bash
git add content.js test/content-fill.test.js test/fixtures/apply-policy.js
git commit -m "feat: fill from storage profiles via generator + policy gate"
```

---

## Task 9: `content.js` — rebuild the form-icon menu

**Files:**
- Modify: `content.js` (`showFillMenu` / `runMenuAction` and the menu markup)
- Test: `test/content-menu.test.js`

**Interfaces:**
- Consumes: `window.SFFormData.MENU_ONLY`, `chrome.storage.local.get(['profiles','defaultProfile'])`.
- The menu renders: **Fill name**, **Fill address**, **Fill name + address**, **Fill all**, a **profile `<select>`** (options from stored `profiles`, default = `defaultProfile`), and **Clear fields**. Each fill action calls `fillWithProfile(selectedProfileId, { only: MENU_ONLY[key] })`. Produces a pure builder `window.__sfBuildMenu(profiles, defaultId) → HTMLElement` so the test can assert structure without a live fill.

- [ ] **Step 1: Write the failing test**

Create `test/content-menu.test.js`:

```js
const { loadGlobals, ok, eq, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js', 'test/fixtures/build-menu.js']);
const el = win.__sfBuildMenu(
  [{ id:'au-personal', label:'AU Personal' }, { id:'us-test', label:'US Test User' }],
  'us-test'
);
const text = el.textContent;
['Fill name', 'Fill address', 'Fill name + address', 'Fill all', 'Clear'].forEach(t =>
  ok(text.indexOf(t) !== -1, `menu has "${t}"`));
const sel = el.querySelector('select');
ok(sel, 'menu has a profile select');
eq(sel.options.length, 2, 'two profiles listed');
eq(sel.value, 'us-test', 'default profile preselected');
// action buttons carry the right override key
const names = Array.from(el.querySelectorAll('[data-only]')).map(b => b.getAttribute('data-only'));
ok(names.indexOf('name') !== -1 && names.indexOf('address') !== -1 && names.indexOf('nameAddress') !== -1 && names.indexOf('all') !== -1,
  'action buttons map to MENU_ONLY keys');
done('content-menu');
```

- [ ] **Step 2: Create the fixture builder, confirm fail-then-pass**

Create `test/fixtures/build-menu.js` (canonical builder; Step 3 inlines the identical DOM-building logic into `content.js`’s menu code):

```js
;(function (root) {
  function __sfBuildMenu(profiles, defaultId) {
    const doc = root.document;
    const wrap = doc.createElement('div');
    const actions = [
      ['name', 'Fill name'],
      ['address', 'Fill address'],
      ['nameAddress', 'Fill name + address'],
      ['all', 'Fill all']
    ];
    actions.forEach(([key, label]) => {
      const b = doc.createElement('button');
      b.textContent = label;
      b.setAttribute('data-only', key);
      wrap.appendChild(b);
    });
    const sel = doc.createElement('select');
    (profiles || []).forEach(p => {
      const o = doc.createElement('option');
      o.value = p.id; o.textContent = p.label || p.id;
      if (p.id === defaultId) o.selected = true;
      sel.appendChild(o);
    });
    wrap.appendChild(sel);
    const clear = doc.createElement('button');
    clear.textContent = 'Clear fields'; clear.setAttribute('data-action', 'clear');
    wrap.appendChild(clear);
    return wrap;
  }
  root.__sfBuildMenu = __sfBuildMenu;
})(typeof window !== 'undefined' ? window : globalThis);
```

Run (before creating fixture): `node test/content-menu.test.js` → FAIL (`__sfBuildMenu is not a function`). Create fixture, rerun → PASS.

- [ ] **Step 3: Replace the menu in `content.js`**

- Replace the inline menu markup in `showFillMenu` with the `__sfBuildMenu(profiles, defaultId)` builder (inline the identical function into `content.js` and export `window.__sfBuildMenu = __sfBuildMenu`). Load `profiles`/`defaultProfile` from storage before building.
- Wire events: clicking a `[data-only]` button → `runMenuAction(MENU_ONLY[key], select.value)`; the clear button → existing `clearDetected()` path.
- `runMenuAction(only, profileId)` calls `fillWithProfile(profileId, { only })`.
- Keep the icon placement / `formSections()` / `SF_UI_ATTR` logic unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --check content.js && node test/content-menu.test.js && node test/content-fill.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add content.js test/content-menu.test.js test/fixtures/build-menu.js
git commit -m "feat: form-icon menu with field-set actions + profile picker"
```

---

## Task 10: `popup.js`/`popup.html` — profile dropdown from storage

**Files:**
- Modify: `popup.html` (the `#profileSelect` element stays; options now dynamic)
- Modify: `popup.js` (populate `#profileSelect` from storage; pass selected id on fill)
- Test: `test/popup-profiles.test.js`

**Interfaces:**
- Consumes: `chrome.storage.local.get(['profiles','defaultProfile'])`.
- Produces a pure helper `window.__sfPopulateProfileSelect(selectEl, profiles, defaultId)` that fills a `<select>` and preselects the default. `popup.js` calls it on load; the fill buttons send `{ profileKey: select.value }` to the content script.

- [ ] **Step 1: Write the failing test**

Create `test/popup-profiles.test.js`:

```js
const { loadGlobals, ok, eq, done } = require('./harness');
const win = loadGlobals(['test/fixtures/populate-select.js'],
  '<!DOCTYPE html><body><select id="p"></select></body>');
const sel = win.document.getElementById('p');
win.__sfPopulateProfileSelect(sel,
  [{ id:'au-personal', label:'AU Personal' }, { id:'us-test', label:'US Test User' }], 'us-test');
eq(sel.options.length, 2, 'two options');
eq(sel.value, 'us-test', 'default preselected');
eq(sel.options[0].textContent, 'AU Personal', 'label rendered');
done('popup-profiles');
```

- [ ] **Step 2: Create the fixture, confirm fail-then-pass**

Create `test/fixtures/populate-select.js`:

```js
;(function (root) {
  function __sfPopulateProfileSelect(sel, profiles, defaultId) {
    sel.innerHTML = '';
    (profiles || []).forEach(p => {
      const o = root.document.createElement('option');
      o.value = p.id; o.textContent = p.label || p.id;
      if (p.id === defaultId) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }
  root.__sfPopulateProfileSelect = __sfPopulateProfileSelect;
})(typeof window !== 'undefined' ? window : globalThis);
```

Run before creating: `node test/popup-profiles.test.js` → FAIL. Create fixture → PASS.

- [ ] **Step 3: Wire `popup.js`/`popup.html`**

- In `popup.html`, keep `<select id="profileSelect">` but remove the four hardcoded `<option>`s (they’ll be injected).
- In `popup.js`, inline the identical `__sfPopulateProfileSelect`, and on load do `chrome.storage.local.get(['profiles','defaultProfile'])` then call it. If `profiles` empty, fall back to `SFFormData.DEFAULT_PROFILES` (load `recommendations.js`-style: add `formdata.js`+`vendor/address-schemas.js` `<script>` tags to `popup.html` before `popup.js`).
- The fill buttons already send a message to the content script; change the payload to include `profileKey: document.getElementById('profileSelect').value`.

- [ ] **Step 4: Run test + syntax check**

Run: `node --check popup.js && node test/popup-profiles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.js test/popup-profiles.test.js test/fixtures/populate-select.js
git commit -m "feat: popup profile dropdown sourced from storage"
```

---

## Task 11: `options.js`/`options.html` — profile manager CRUD (list + persistence)

**Files:**
- Modify: `options.html` (add a "Test Profiles" section: list + editor container)
- Modify: `options.js` (CRUD over `chrome.storage.local.profiles`)
- Test: `test/options-crud.test.js`

**Interfaces:**
- Consumes: `chrome.storage.local` (`profiles`, `defaultProfile`), `window.SFFormData.DEFAULT_PROFILES`.
- Produces pure helpers on `window`:
  - `__sfProfilesCreate(profiles, label) → { profiles, id }` (appends a blank profile: AU country, all-groups-on policy, empty pins; id is a slug of label + numeric suffix ensuring uniqueness).
  - `__sfProfilesClone(profiles, id) → { profiles, id }` (deep-copies, "… (copy)" label, fresh unique id).
  - `__sfProfilesRename(profiles, id, label) → profiles`.
  - `__sfProfilesDelete(profiles, id) → profiles` (refuses to delete the last remaining profile — returns unchanged).
  - `__sfProfilePatch(profiles, id, patch) → profiles` (shallow-merges `country`/`policy`/`pins`).

- [ ] **Step 1: Write the failing test**

Create `test/options-crud.test.js`:

```js
const { loadGlobals, ok, eq, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js', 'test/fixtures/profiles-crud.js']);
const C = win;
let profiles = JSON.parse(JSON.stringify(win.SFFormData.DEFAULT_PROFILES));

// create
let r = C.__sfProfilesCreate(profiles, 'My Profile');
profiles = r.profiles;
eq(profiles.length, 5, 'create appends');
ok(profiles.find(p => p.id === r.id), 'new id present');
eq(profiles.find(p => p.id === r.id).country, 'AU', 'new profile defaults AU');

// clone
r = C.__sfProfilesClone(profiles, 'us-test');
profiles = r.profiles;
eq(profiles.length, 6, 'clone appends');
ok(profiles.find(p => p.id === r.id).label.indexOf('copy') !== -1, 'clone label tagged');

// rename
profiles = C.__sfProfilesRename(profiles, r.id, 'Renamed');
eq(profiles.find(p => p.id === r.id).label, 'Renamed', 'renamed');

// patch
profiles = C.__sfProfilePatch(profiles, 'au-personal', { country: 'US', pins: { emailDomain: 'x.test' } });
const ap = profiles.find(p => p.id === 'au-personal');
eq(ap.country, 'US', 'patched country');
eq(ap.pins.emailDomain, 'x.test', 'patched pins');

// delete (and last-one guard)
profiles = C.__sfProfilesDelete(profiles, r.id);
ok(!profiles.find(p => p.id === r.id), 'deleted');
let one = [profiles[0]];
eq(C.__sfProfilesDelete(one, one[0].id).length, 1, 'refuses to delete last profile');

done('options-crud');
```

- [ ] **Step 2: Create the CRUD helper fixture; confirm fail-then-pass**

Create `test/fixtures/profiles-crud.js` (canonical; Step 3 inlines the identical functions into `options.js`):

```js
;(function (root) {
  function _slug(s){ return (s||'profile').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
  function _uniqueId(profiles, base){
    let id = base || 'profile', n = 1;
    const taken = new Set(profiles.map(p => p.id));
    while (taken.has(id)) { id = `${base}-${n++}`; }
    return id;
  }
  function __sfProfilesCreate(profiles, label){
    const next = profiles.slice();
    const id = _uniqueId(next, _slug(label));
    next.push({ id, label: label || 'New Profile', country: 'AU', randomize: true,
      policy: { groups: { name:true, contact:true, address:true, account:true, misc:true }, exclude: [] }, pins: {} });
    return { profiles: next, id };
  }
  function __sfProfilesClone(profiles, id){
    const src = profiles.find(p => p.id === id); if (!src) return { profiles, id: null };
    const next = profiles.slice();
    const newId = _uniqueId(next, _slug(src.label) + '-copy');
    next.push(Object.assign(JSON.parse(JSON.stringify(src)), { id: newId, label: src.label + ' (copy)' }));
    return { profiles: next, id: newId };
  }
  function __sfProfilesRename(profiles, id, label){
    return profiles.map(p => p.id === id ? Object.assign({}, p, { label }) : p);
  }
  function __sfProfilesDelete(profiles, id){
    if (profiles.length <= 1) return profiles;
    return profiles.filter(p => p.id !== id);
  }
  function __sfProfilePatch(profiles, id, patch){
    return profiles.map(p => p.id === id ? Object.assign({}, p, patch) : p);
  }
  Object.assign(root, { __sfProfilesCreate, __sfProfilesClone, __sfProfilesRename, __sfProfilesDelete, __sfProfilePatch });
})(typeof window !== 'undefined' ? window : globalThis);
```

Run before creating: `node test/options-crud.test.js` → FAIL. Create fixture → PASS.

- [ ] **Step 3: Wire `options.html`/`options.js`**

- In `options.html`, add a "Test Profiles" card: a `<ul id="profileList">`, a "+ New profile" button, and a `<div id="profileEditor">` placeholder. Add `<script src="vendor/address-schemas.js">` and `<script src="formdata.js">` before `options.js`.
- In `options.js`, inline the five CRUD helpers (identical to the fixture), load `profiles` from storage (fall back to `SFFormData.DEFAULT_PROFILES`), render the list, and persist (`chrome.storage.local.set({ profiles })`) after every mutation. Wire New/Clone/Rename/Delete buttons. Selecting a list item renders the editor (Task 12 adds the dynamic address fields; for this task the editor can show label + country `<select>` + group-toggle checkboxes bound through `__sfProfilePatch`).

- [ ] **Step 4: Run tests + syntax check**

Run: `node --check options.js && node test/options-crud.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add options.html options.js test/options-crud.test.js test/fixtures/profiles-crud.js
git commit -m "feat: options profile manager CRUD over storage"
```

---

## Task 12: `options.js` — dynamic per-country address sub-form

**Files:**
- Modify: `options.js` (profile editor: render address fields from the schema)
- Test: `test/options-address-form.test.js`

**Interfaces:**
- Consumes: `window.SFAddress.getFieldConfig`, `getZipHint`, `listCountries`, `countryCodeToFlagEmoji`.
- Produces `window.__sfRenderAddressFields(container, country) → void` that, given a DOM container and a country code, renders one labelled input per **shown** address field (`street1, street2, city, state, zip`) in `getFieldConfig(country).order` order, using the country-specific `label`, a `required` marker, and the zip hint. Re-invoking with a new country replaces the fields.

- [ ] **Step 1: Write the failing test**

Create `test/options-address-form.test.js`:

```js
const { loadGlobals, ok, eq, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'test/fixtures/render-address.js'],
  '<!DOCTYPE html><body><div id="c"></div></body>');
const c = win.document.getElementById('c');

win.__sfRenderAddressFields(c, 'AU');
let labels = Array.from(c.querySelectorAll('label')).map(l => l.textContent);
ok(labels.some(t => t.indexOf('Suburb') !== -1), 'AU shows Suburb');
ok(labels.some(t => t.indexOf('State/Territory') !== -1), 'AU shows State/Territory');
ok(labels.some(t => t.indexOf('Postcode') !== -1), 'AU shows Postcode');

win.__sfRenderAddressFields(c, 'US');
labels = Array.from(c.querySelectorAll('label')).map(l => l.textContent);
ok(labels.some(t => t.indexOf('City') !== -1), 'US shows City after re-render');
ok(labels.some(t => t.indexOf('ZIP') !== -1), 'US shows ZIP');
ok(!labels.some(t => t.indexOf('Suburb') !== -1), 'AU fields cleared on re-render');

done('options-address-form');
```

- [ ] **Step 2: Create the render fixture; confirm fail-then-pass**

Create `test/fixtures/render-address.js` (canonical; Step 3 inlines the identical function into `options.js`):

```js
;(function (root) {
  const ADDR_KEYS_BY_GROUP = { street: ['street1', 'street2'], city: ['city'], state: ['state'], zip: ['zip'] };
  function __sfRenderAddressFields(container, country) {
    const A = root.SFAddress;
    const cfg = A.getFieldConfig(country);
    container.innerHTML = '';
    cfg.order.forEach(group => {
      (ADDR_KEYS_BY_GROUP[group] || []).forEach(key => {
        const f = cfg.fields[key];
        if (!f || !f.show) return;
        const wrap = root.document.createElement('div');
        const label = root.document.createElement('label');
        label.textContent = f.label + (f.required ? ' *' : '');
        const input = root.document.createElement('input');
        input.setAttribute('data-field', key);
        if (key === 'zip') { const h = A.getZipHint(country); if (h) input.setAttribute('placeholder', h); }
        wrap.appendChild(label); wrap.appendChild(input); container.appendChild(wrap);
      });
    });
  }
  root.__sfRenderAddressFields = __sfRenderAddressFields;
})(typeof window !== 'undefined' ? window : globalThis);
```

Run before creating: `node test/options-address-form.test.js` → FAIL. Create fixture → PASS.

- [ ] **Step 3: Wire into the `options.js` editor**

- Inline the identical `__sfRenderAddressFields` into `options.js`.
- Build the country `<select>` from `SFAddress.listCountries()` (each option text = `label`, i.e. "🇦🇺 Australia"; value = `code`); preselect the profile’s `country`.
- On country `change`: call `__sfProfilePatch(profiles, id, { country })`, persist, and re-render the address sub-form. (The state value still flows into the fill engine’s combobox/vue-select path unchanged.)
- Per-field **exclude** checkboxes and **pin** inputs sit beside each rendered field; their changes call `__sfProfilePatch` to update `policy.exclude` / `pins` and persist. (Reuse the gating vocabulary; `street1↔address` etc. via `SFFormData.groupForField`.)

- [ ] **Step 4: Run tests + syntax check**

Run: `node --check options.js && node test/options-address-form.test.js && node test/options-crud.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add options.html options.js test/options-address-form.test.js test/fixtures/render-address.js
git commit -m "feat: dynamic per-country address fields in profile editor"
```

---

## Task 13: `manifest.json` + integration wiring & full check

**Files:**
- Modify: `manifest.json` (content-script load order, version bump)
- Modify: `popup.html`, `options.html` (confirm script tags from Tasks 10–12)
- Test: `test/manifest-integration.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `manifest.json` `content_scripts[0].js` = `["vendor/address-schemas.js", "formdata.js", "content.js"]` (in that order); `version` bumped to `1.1.0`. `popup.html`/`options.html` include `vendor/address-schemas.js` + `formdata.js` before their own scripts.

- [ ] **Step 1: Write the failing test**

Create `test/manifest-integration.test.js`:

```js
const fs = require('fs'); const path = require('path');
const { ok, eq, done } = require('./harness');
const root = path.resolve(__dirname, '..');
const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

eq(m.content_scripts[0].js, ['vendor/address-schemas.js', 'formdata.js', 'content.js'], 'content script load order');
eq(m.version, '1.1.0', 'version bumped');

const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
ok(popup.indexOf('vendor/address-schemas.js') !== -1 && popup.indexOf('formdata.js') !== -1, 'popup loads new scripts');
const options = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
ok(options.indexOf('vendor/address-schemas.js') !== -1 && options.indexOf('formdata.js') !== -1, 'options loads new scripts');

done('manifest-integration');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/manifest-integration.test.js`
Expected: FAIL on the `content_scripts` ordering assertion (still `["content.js"]`).

- [ ] **Step 3: Update `manifest.json`**

Set:

```json
  "version": "1.1.0",
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["vendor/address-schemas.js", "formdata.js", "content.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
```

Also bump the `popup.html` version badge text to `v1.1.0`. Confirm the `<script>` tags added in Tasks 10–12 are present in `popup.html` and `options.html` (add if missing).

- [ ] **Step 4: Run the whole suite + syntax checks**

Run:

```bash
for f in vendor/address-schemas.js formdata.js content.js background.js popup.js options.js seed-data.node.js; do node --check "$f" || exit 1; done
for f in test/*.test.js test/harness.selftest.js; do node "$f" || exit 1; done
node test/manifest-integration.test.js
```

Expected: every `node --check` silent; every test prints `✓ … 0 failed`; final exit 0.

- [ ] **Step 5: Commit**

```bash
git add manifest.json popup.html options.html test/manifest-integration.test.js
git commit -m "feat: register formdata/address content scripts; bump to v1.1.0"
```

---

## Task 14: Manual verification on the live form

**Files:** none (manual QA + notes)

- [ ] **Step 1:** Load the unpacked extension (reload at `chrome://extensions`) and open `https://vinum-dev.pos.dev.z42z.com/`.
- [ ] **Step 2:** Open Options → Test Profiles. Confirm the four seeded profiles list; create/clone/rename/delete works and persists across a reload. Switch a profile’s country AU↔US and confirm the address fields + labels (Suburb/State-Territory/Postcode vs City/State/ZIP) re-render.
- [ ] **Step 3:** On the create-customer modal, click the form-icon → **Fill name**: only name/contact fill, address stays empty. Click **Fill address**: address (incl. country/state vue-select) fills coherently. **Fill all**: everything per the profile policy. Verify two consecutive **Fill all** runs produce *different* names/addresses (randomization) and that the country→state cascade still resolves.
- [ ] **Step 4:** Set a profile `exclude: ['email']` and a `pins.emailDomain`; confirm a fill leaves email blank when excluded, and (with email enabled) uses the pinned domain.
- [ ] **Step 5:** If a state/region option text doesn’t match generated data for some country, note it for a `VALUE_ALIASES`/pool follow-up (do not expand scope here). Record results in the PR/commit notes.

---

## Self-Review Notes (author)

- **Spec coverage:** Data model → Tasks 3,6,11. Vendored address model → Task 2. Generator + pools → Tasks 4,5. Policy gate + selective fill → Tasks 6,8. Form-icon menu → Task 9. Popup dropdown → Task 10. Options CRUD → Task 11. Dynamic per-country address fields → Task 12. Seeding/migration → Task 7. Manifest/load-order → Task 13. Testing → every task + Task 14 manual. Uniquifier retirement → Task 8.
- **Drift risk:** seed data exists in `formdata.js`, `seed-data.node.js`, and inline in `background.js` (service-worker module can’t share a classic global). Task 7’s `seed-drift.test.js` guards id/version parity across all three.
- **Naming consistency:** `shouldFill`, `generatePerson`, `applyPins`, `toEngineValues`, `MENU_ONLY`, `__sfApplyPolicy`, `__sfBuildMenu`, `__sfRenderAddressFields`, `__sfProfiles*` are used identically across the tasks that define and consume them.
