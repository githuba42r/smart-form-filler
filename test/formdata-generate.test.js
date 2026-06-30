const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals(['vendor/address-schemas.js', 'formdata.js']);
const F = win.SFFormData, A = win.SFAddress;

const a1 = F.generatePerson({ country: 'AU' }, { seed: 42 });
const a2 = F.generatePerson({ country: 'AU' }, { seed: 42 });
eq(a1, a2, 'same seed -> identical');
ok(F.generatePerson({ country: 'AU' }, { seed: 1 }).email !== a1.email, 'different seed -> different');
['firstname','lastname','username','email','phone','street1','city','state','zip','country','password','dob','business','genericText']
  .forEach(k => ok(a1[k] !== undefined && a1[k] !== '', `generated ${k} present`));
eq(a1.country, 'AU', 'country preserved');
ok(A.validateZip(a1.zip, 'AU').valid, 'AU zip matches schema regex');
ok(A.validateZip(F.generatePerson({ country: 'US' }, { seed: 7 }).zip, 'US').valid, 'US zip valid');
ok(a1.email.toLowerCase().indexOf(a1.lastname.toLowerCase()) !== -1, 'email derived from last name');
const zz = F.generatePerson({ country: 'ZZ' }, { seed: 3 });
ok(zz.firstname && zz.street1, 'generic fallback still produces a person');
done('formdata-generate');
