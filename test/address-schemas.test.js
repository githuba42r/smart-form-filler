const { loadGlobals, eq, ok, done } = require('./harness');
const A = loadGlobals(['vendor/address-schemas.js']).SFAddress;

const au = A.getFieldConfig('AU');
eq(au.fields.state.label, 'State/Territory', 'AU state label override');
eq(au.fields.city.label, 'Suburb', 'AU locality label');
eq(au.fields.zip.label, 'Postcode', 'AU zip label');
ok(au.fields.zip.required && au.fields.state.required, 'AU zip+state required');
eq(au.order, ['street', 'city', 'state', 'zip'], 'AU field order from fmt');

const us = A.getFieldConfig('US');
eq(us.fields.city.label, 'City', 'US locality label');
eq(us.fields.zip.label, 'ZIP Code', 'US zip label');

ok(A.validateZip('4000', 'AU').valid, 'AU 4000 valid');
ok(!A.validateZip('ABCD', 'AU').valid, 'AU ABCD invalid');
ok(A.validateZip('94114', 'US').valid, 'US 94114 valid');

eq(A.countryCodeToFlagEmoji('AU'), '\u{1F1E6}\u{1F1FA}', 'AU flag emoji');
const list = A.listCountries();
ok(list.length >= 30, 'at least 30 countries ported');
ok(list.some(c => c.code === 'AU' && c.label.indexOf('Australia') !== -1), 'AU in list with name');
ok(A.getFieldConfig('ZZ').fields.street1.show, 'unknown country still shows street');
done('address-schemas');
