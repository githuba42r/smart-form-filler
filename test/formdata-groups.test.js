const { loadGlobals, eq, ok, done } = require('./harness');
const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;

eq(F.groupForField('email'), 'contact', 'email is contact');
eq(F.groupForField('street1'), 'address', 'street1 is address');
eq(F.groupForField('firstname'), 'name', 'firstname is name');
eq(F.groupForField('business'), 'misc', 'business is misc');
eq(F.groupForField('nope'), null, 'unknown -> null');
eq(F.CANONICAL_TO_ENGINE.street1, 'address1', 'street1 -> address1');
eq(F.CANONICAL_TO_ENGINE.zip, 'postcode', 'zip -> postcode');
eq(F.CANONICAL_TO_ENGINE.business, 'company', 'business -> company');
eq(F.ENGINE_TO_CANONICAL.postcode, 'zip', 'postcode -> zip (reverse)');
const eng = F.toEngineValues({ street1: '17 Main St', zip: '4000', email: 'a@b.co' });
eq(eng.address1, '17 Main St', 'maps street1');
eq(eng.postcode, '4000', 'maps zip');
eq(eng.email, 'a@b.co', 'passes email');
done('formdata-groups');
