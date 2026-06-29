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
