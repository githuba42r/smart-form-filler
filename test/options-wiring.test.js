const { ok, done } = require('./harness');
const fs = require('fs'), path = require('path');

// Test that options.html loads required scripts in correct order
const html = fs.readFileSync(path.resolve(__dirname, '..', 'options.html'), 'utf8');
['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js'].forEach(s =>
  ok(html.indexOf(s) !== -1, `options.html loads ${s}`));
ok(html.indexOf('profile-ui.js') < html.indexOf('options.js'), 'profile-ui.js before options.js');

// Test that options.html has required markup
ok(html.indexOf('profileList') !== -1, 'options.html has #profileList');
ok(html.indexOf('profileEditor') !== -1, 'options.html has #profileEditor');
ok(html.indexOf('newProfileBtn') !== -1, 'options.html has #newProfileBtn');

// Test that options.js uses required functions
const js = fs.readFileSync(path.resolve(__dirname, '..', 'options.js'), 'utf8');
['profilesCreate','profilesClone','profilesRename','profilesDelete','profilePatch'].forEach(fn =>
  ok(js.indexOf(fn) !== -1, `options.js uses ${fn}`));
ok(js.indexOf('renderAddressFields') !== -1, 'options.js uses SFProfileUI.renderAddressFields');
ok(js.indexOf('listCountries') !== -1, 'options.js builds country picker from listCountries');

done('options-wiring');
