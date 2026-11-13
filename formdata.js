// formdata.js — window.SFFormData: profile generator, field groups, policy gate, data-ops.
// Classic global script (no import/export). Loads after vendor/address-schemas.js.
;(function (root) {
  'use strict';

  const FIELD_GROUPS = {
    name:    ['firstname', 'lastname', 'fullname', 'username'],
    contact: ['email', 'phone'],
    address: ['street1', 'street2', 'city', 'state', 'zip', 'country'],
    account: ['password', 'dob', 'gender'],
    misc:    ['business', 'genericText']
  };
  const CANONICAL_TO_ENGINE = {
    firstname:'firstName', lastname:'lastName', fullname:'fullName', username:'username',
    email:'email', phone:'phone',
    street1:'address1', street2:'address2', city:'city', state:'state', zip:'postcode', country:'country',
    password:'password', dob:'dob', gender:'gender', business:'company', genericText:'genericText'
  };
  // Editor labels for the known fields (address labels come from the country's schema).
  const FIELD_LABELS = {
    firstname:'First name', lastname:'Last name', fullname:'Full name', username:'Username',
    email:'Email', emailDomain:'Email domain', phone:'Phone',
    street1:'Street address', street2:'Address line 2', city:'City', state:'State', zip:'Postcode', country:'Country',
    password:'Password', dob:'Date of birth', gender:'Gender / sex',
    business:'Company', genericText:'Free text (comments, notes)'
  };
  const GENDERS = ['Male', 'Female'];
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

  // Per-field mode: 'random' (generated each fill), 'fixed' (the pinned value) or 'skip'.
  // Profiles without fieldModes derive it from the older exclude list and pins.
  const FIELD_MODES = ['random', 'fixed', 'skip'];
  function fieldMode(profile, key) {
    const modes = (profile && profile.fieldModes) || {};
    if (FIELD_MODES.indexOf(modes[key]) !== -1) return modes[key];
    const exclude = (profile && profile.policy && profile.policy.exclude) || [];
    if (exclude.indexOf(key) !== -1) return 'skip';
    const pins = (profile && profile.pins) || {};
    return pins[key] != null && pins[key] !== '' ? 'fixed' : 'random';
  }
  // Pins that apply on this fill: fields set to 'random' ignore their stored value.
  function effectivePins(profile) {
    const pins = (profile && profile.pins) || {};
    const out = {};
    Object.keys(pins).forEach(k => { if (fieldMode(profile, k) === 'fixed') out[k] = pins[k]; });
    return out;
  }
  // Patch for a mode change; keeps policy.exclude in step so the fill gate sees 'skip'.
  function setFieldMode(profile, key, mode) {
    const policy = Object.assign({ groups: {}, exclude: [] }, profile.policy);
    const exclude = (policy.exclude || []).filter(k => k !== key);
    if (mode === 'skip') exclude.push(key);
    return {
      fieldModes: Object.assign({}, profile.fieldModes, { [key]: mode }),
      policy: Object.assign({}, policy, { exclude })
    };
  }

  // Custom fields: profile-specific fields matched by label / name hints, e.g.
  //   { id, label:'Delivery instructions', labelHint:'delivery, instructions', nameHint:'delivery_notes',
  //     mode:'fixed'|'random'|'skip', value:'Leave at the door' }
  // Hints are comma-separated phrases; any phrase found in the field's label (or name) is a match.
  // With no hints, the custom field's own label is the label hint.
  function _words(str) {
    return ' ' + String(str || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  }
  function _phrases(hint) {
    return String(hint || '').split(',').map(_words).filter(p => p.trim());
  }
  function customFieldMatches(cf, field) {
    if (!cf || !field) return false;
    let labelHints = _phrases(cf.labelHint);
    const nameHints = _phrases(cf.nameHint);
    if (!labelHints.length && !nameHints.length) labelHints = _phrases(cf.label);
    const labelText = _words([field.label, field.ariaLabel, field.placeholder].join(' '));
    const nameText = _words([field.name, field.htmlName, field.id].join(' '));
    return labelHints.some(p => labelText.indexOf(p) !== -1) ||
      nameHints.some(p => nameText.indexOf(p) !== -1);
  }
  function matchCustomField(profile, field) {
    const list = (profile && profile.customFields) || [];
    return list.find(cf => customFieldMatches(cf, field)) || null;
  }
  function newCustomField(profile, label) {
    const taken = {}; ((profile && profile.customFields) || []).forEach(c => { taken[c.id] = true; });
    let n = 1; while (taken['cf' + n]) n++;
    return { id: 'cf' + n, label: label || '', labelHint: '', nameHint: '', mode: 'fixed', value: '' };
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

  // Date helpers. Dates travel as ISO 'YYYY-MM-DD' strings; formatDate renders them for a field.
  const MONTH_NAMES = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  function _pad2(n) { return String(n).padStart(2, '0'); }
  function _daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function parseISODate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
  }
  // Valid birth date for an adult aged 18–79.
  function _dob(rng) {
    const year  = new Date().getFullYear() - 18 - Math.floor(rng() * 62);
    const month = 1 + Math.floor(rng() * 12);
    const day   = 1 + Math.floor(rng() * _daysInMonth(year, month));
    return `${year}-${_pad2(month)}-${_pad2(day)}`;
  }
  // Normalise an AI-written date to ISO: '1985-03-07', '7 Mar 1985', 'March 7, 1985'. Else null.
  function toISODate(str) {
    const v = String(str || '').trim();
    if (parseISODate(v)) return v;
    const months = MONTH_NAMES.map(m => m.slice(0, 3).toLowerCase());
    let m = /^(\d{1,2})[\s\-]+([a-z]{3,9})\.?[\s\-,]+(\d{4})$/i.exec(v);
    let day, mon, year;
    if (m) { day = +m[1]; mon = months.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; year = +m[3]; }
    else if ((m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(v))) {
      mon = months.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; day = +m[2]; year = +m[3];
    }
    if (!mon || !day || day > _daysInMonth(year, mon)) return null;
    return `${year}-${_pad2(mon)}-${_pad2(day)}`;
  }
  // Age in whole years on today's date for an ISO birth date (null if unparseable).
  function ageFromISO(iso) {
    const d = parseISODate(iso); if (!d) return null;
    const now = new Date();
    let age = now.getFullYear() - d.year;
    if (now.getMonth() + 1 < d.month || (now.getMonth() + 1 === d.month && now.getDate() < d.day)) age--;
    return age;
  }

  // formatDate('1985-03-07', 'DD/MM/YYYY') → '07/03/1985'. Tokens: YYYY YY MMMM MMM MM M DD D.
  function formatDate(iso, format) {
    const d = parseISODate(iso);
    if (!d) return iso;
    const tokens = {
      YYYY: String(d.year), YY: String(d.year).slice(2),
      MMMM: MONTH_NAMES[d.month - 1], MMM: MONTH_NAMES[d.month - 1].slice(0, 3),
      MM: _pad2(d.month), M: String(d.month), DD: _pad2(d.day), D: String(d.day)
    };
    return String(format || 'YYYY-MM-DD').replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D/g, t => tokens[t]);
  }

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
    const dob       = _dob(rng);
    const gender    = _pick(rng, GENDERS);
    // Fixed names feed the derived fields (full name, username, email) unless those are fixed too.
    const pins = effectivePins(profile);
    const first = pins.firstname || firstname, last = pins.lastname || lastname;
    const person = {
      firstname, lastname, fullname: `${first} ${last}`,
      username: `${_slug(first)}_${_slug(last)}${tag}`,
      email: `${_slug(first)}.${_slug(last)}.${tag}@${domain}`,
      phone: _digits(rng, L.phoneTemplate),
      street1: `${streetNo} ${_pick(rng, L.streets)}`, street2: '',
      city: row.city, state: row.state, zip, country,
      password: `Dev${tag}!aZ`,
      dob, gender,
      business: `${last} ${_pick(rng, ['Holdings','Labs','Group','Trading'])} Pty Ltd`,
      genericText: 'Automated test input generated for development and QA validation.'
    };
    return applyPins(person, pins);
  }

  // Custom field value generators for domain-specific / unknown field types.
  function _randDigits(n) {
    var s = ''; for (var i = 0; i < n; i++) s += String(Math.floor(Math.random() * 10)); return s;
  }
  function _randUpper(n) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', s = '';
    for (var i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s;
  }
  function _randAlphaNum(n) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = '';
    for (var i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s;
  }
  function _dateSuffix() {
    var d = new Date(); var y = String(d.getFullYear()); var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0'); return y + m + day;
  }
  function _shortDate() {
    var d = new Date(); var y = String(d.getFullYear()).slice(2);
    var m = String(d.getMonth() + 1).padStart(2, '0'); var day = String(d.getDate()).padStart(2, '0');
    return y + m + day;
  }

  var CUSTOM_GENERATORS = {
    sku:         function () { return _randUpper(3) + '-' + _randDigits(5); },
    customer_id: function () { return 'CUST-' + _randDigits(6); },
    invoice_id:  function () { return 'INV-' + _dateSuffix(); },
    product_id:  function () { return 'PROD-' + _randDigits(7); },
    order_id:    function () { return 'ORD-' + _dateSuffix(); },
    reference:   function () { return 'REF-' + _randAlphaNum(6); },
    code:        function () { return _randUpper(8); },
    serial:      function () { return 'SN-' + _shortDate() + '-' + _randDigits(5); }
  };

  // Returns '' for types without a generator — those values are chosen by the AI at fill time.
  function generateCustomFieldValue(detectedType) {
    if (detectedType in CUSTOM_GENERATORS) return CUSTOM_GENERATORS[detectedType]();
    return '';
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

  root.SFFormData = { FIELD_LABELS, GENDERS, FIELD_MODES, fieldMode, effectivePins, setFieldMode, customFieldMatches, matchCustomField, newCustomField, FIELD_GROUPS, CANONICAL_TO_ENGINE, ENGINE_TO_CANONICAL, groupForField, toEngineValues, LOCALES, generatePerson, applyPins, MENU_ONLY, shouldFill, applyPolicy, resolveValues, PROFILES_VERSION, DEFAULT_PROFILES, profilesCreate, profilesClone, profilesRename, profilesDelete, profilePatch, CUSTOM_GENERATORS, generateCustomFieldValue, MONTH_NAMES, parseISODate, formatDate, toISODate, ageFromISO };
})(typeof window !== 'undefined' ? window : globalThis);
