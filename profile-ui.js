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
