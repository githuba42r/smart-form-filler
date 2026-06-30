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
