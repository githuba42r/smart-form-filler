const { loadGlobals, eq, ok, done } = require('./harness');
const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;
const base = { email: 'jane.doe.1234@example.com.au', business: 'X Pty', zip: '4000', firstname: 'Jane' };
const pinned = F.applyPins(base, { emailDomain: 'mycorp.test', business: 'Aether Dynamics Pty Ltd', zip: '4122' });
eq(pinned.email, 'jane.doe.1234@mycorp.test', 'emailDomain rewrites domain only');
eq(pinned.business, 'Aether Dynamics Pty Ltd', 'business pin overrides');
eq(pinned.zip, '4122', 'zip pin overrides');
eq(base.email, 'jane.doe.1234@example.com.au', 'does not mutate input');
eq(F.applyPins(base, { bogus: 'x' }).firstname, 'Jane', 'unknown pin ignored');
ok(F.generatePerson({ country: 'AU', pins: { emailDomain: 'pinned.test' } }, { seed: 5 }).email.endsWith('@pinned.test'),
  'generatePerson applies emailDomain pin');
done('formdata-pins');
