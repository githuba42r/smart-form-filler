const { loadGlobals, eq, ok, done } = require('./harness');
const F = loadGlobals(['vendor/address-schemas.js', 'formdata.js']).SFFormData;
const allOn = { groups:{ name:true, contact:true, address:true, account:true, misc:true }, exclude:[] };

const noAddr = { groups:{ name:true, contact:true, address:false, account:false, misc:false }, exclude:[] };
ok(F.shouldFill('firstname', noAddr, null), 'name on');
ok(!F.shouldFill('street1', noAddr, null), 'address off');
const exEmail = { groups: allOn.groups, exclude: ['email'] };
ok(!F.shouldFill('email', exEmail, null), 'email excluded');
ok(F.shouldFill('phone', exEmail, null), 'phone still on');
ok(F.shouldFill('firstname', allOn, F.MENU_ONLY.name), 'name-only fills name');
ok(!F.shouldFill('street1', allOn, F.MENU_ONLY.name), 'name-only skips address');
ok(F.shouldFill('street1', allOn, F.MENU_ONLY.address), 'address-only fills address');
ok(F.shouldFill('password', allOn, F.MENU_ONLY.all), 'all fills account');

// applyPolicy + resolveValues operate on engine-category maps
const eng = F.toEngineValues(F.generatePerson({ country:'AU' }, { seed: 2 }));
const all = F.applyPolicy(eng, allOn, null);
ok(all.firstName && all.address1 && all.email, 'applyPolicy all keeps categories');
const nameOnly = F.applyPolicy(eng, allOn, F.MENU_ONLY.name);
ok(nameOnly.firstName && !('address1' in nameOnly), 'applyPolicy name-only drops address');
const ex = F.applyPolicy(eng, { groups: allOn.groups, exclude:['email'] }, null);
ok(!('email' in ex) && ('phone' in ex), 'applyPolicy honours exclude');
const prof = { country:'AU', policy: allOn, pins:{} };
const resolved = F.resolveValues(prof, F.MENU_ONLY.address, { seed: 9 });
ok(resolved.address1 && !('firstName' in resolved), 'resolveValues address-only');

eq(F.PROFILES_VERSION, 1, 'version 1');
eq(F.DEFAULT_PROFILES.length, 4, 'four seeds');
ok(F.DEFAULT_PROFILES.find(p => p.id === 'au-business').pins.business, 'au-business pins business');
done('formdata-policy');
