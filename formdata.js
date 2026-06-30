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

  root.SFFormData = { FIELD_GROUPS, CANONICAL_TO_ENGINE, ENGINE_TO_CANONICAL, groupForField, toEngineValues, LOCALES, generatePerson };
})(typeof window !== 'undefined' ? window : globalThis);
