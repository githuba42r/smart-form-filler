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
