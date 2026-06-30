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
  function _slug(s) { return (s || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

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
    return applyPins(person, profile && profile.pins);
  }

  // Profile CRUD data-ops
  function _uniqueId(profiles, base) {
    base = base || 'profile'; let id = base, n = 1;
    const taken = {}; profiles.forEach(p => { taken[p.id] = true; });
    while (taken[id]) { id = `${base}-${n++}`; }
    return id;
  }
  function _blankPolicy() { return { groups: { name: true, contact: true, address: true, account: true, misc: true }, exclude: [] }; }
  function profilesCreate(profiles, label) {
    const next = profiles.slice(); const id = _uniqueId(next, _slug(label));
    next.push({ id, label: label || 'New Profile', country: 'AU', randomize: true, policy: _blankPolicy(), pins: {} });
    return { profiles: next, id };
  }
  function profilesClone(profiles, id) {
    const src = profiles.find(p => p.id === id); if (!src) return { profiles, id: null };
    const next = profiles.slice(); const newId = _uniqueId(next, _slug(src.label) + '-copy');
    next.push(Object.assign(JSON.parse(JSON.stringify(src)), { id: newId, label: src.label + ' (copy)' }));
    return { profiles: next, id: newId };
  }
  function profilesRename(profiles, id, label) { return profiles.map(p => p.id === id ? Object.assign({}, p, { label }) : p); }
  function profilesDelete(profiles, id) { return profiles.length <= 1 ? profiles : profiles.filter(p => p.id !== id); }
  function profilePatch(profiles, id, patch) { return profiles.map(p => p.id === id ? Object.assign({}, p, patch) : p); }

  root.SFFormData = { FIELD_GROUPS, CANONICAL_TO_ENGINE, ENGINE_TO_CANONICAL, groupForField, toEngineValues, LOCALES, generatePerson, applyPins, MENU_ONLY, shouldFill, applyPolicy, resolveValues, PROFILES_VERSION, DEFAULT_PROFILES, profilesCreate, profilesClone, profilesRename, profilesDelete, profilePatch };
})(typeof window !== 'undefined' ? window : globalThis);
