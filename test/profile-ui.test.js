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
