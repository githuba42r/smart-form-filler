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

// CUSTOM_GENERATORS
ok(F.CUSTOM_GENERATORS && typeof F.CUSTOM_GENERATORS === 'object', 'CUSTOM_GENERATORS exists');
ok(/^[A-Z]{3}-\d{5}$/.test(F.CUSTOM_GENERATORS.sku()), 'sku matches pattern');
ok(/^CUST-\d{6}$/.test(F.CUSTOM_GENERATORS.customer_id()), 'customer_id matches pattern');
ok(/^INV-\d{8}$/.test(F.CUSTOM_GENERATORS.invoice_id()), 'invoice_id matches INV-YYYYMMDD pattern');
ok(/^PROD-\d{7}$/.test(F.CUSTOM_GENERATORS.product_id()), 'product_id matches pattern');
ok(/^ORD-\d{8}$/.test(F.CUSTOM_GENERATORS.order_id()), 'order_id matches ORD-YYYYMMDD pattern');
ok(/^REF-[A-Z0-9]{6}$/.test(F.CUSTOM_GENERATORS.reference()), 'reference matches pattern');
ok(/^[A-Z]{8}$/.test(F.CUSTOM_GENERATORS.code()), 'code matches 8 uppercase chars');
ok(/^SN-\d{6}-\d{5}$/.test(F.CUSTOM_GENERATORS.serial()), 'serial matches SN-YYMMDD-NNNNN pattern');

// generateCustomFieldValue
ok(typeof F.generateCustomFieldValue === 'function', 'generateCustomFieldValue exists');
ok(/^[A-Z]{3}-\d{5}$/.test(F.generateCustomFieldValue('sku')), 'generateCustomFieldValue sku uses generator');
eq(F.generateCustomFieldValue('unknown_field_type'), '', 'generateCustomFieldValue: unknown type → empty (AI chooses at fill time)');

// DOB: valid calendar date, adult age
for (let seed = 1; seed <= 200; seed++) {
  const dob = F.generatePerson({ country: 'AU' }, { seed }).dob;
  const d = F.parseISODate(dob);
  const valid = d && new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDate() === d.day;
  const age = new Date().getFullYear() - (d ? d.year : 0);
  if (!valid || age < 18 || age > 80) { ok(false, `dob seed ${seed} invalid: ${dob}`); break; }
  if (seed === 200) ok(true, 'dob: 200 seeds all valid adult dates');
}
// formatDate
eq(F.formatDate('1985-03-07', 'DD/MM/YYYY'), '07/03/1985', 'formatDate DD/MM/YYYY');
eq(F.formatDate('1985-03-07', 'MM/DD/YYYY'), '03/07/1985', 'formatDate MM/DD/YYYY');
eq(F.formatDate('1985-03-07', 'D MMM YYYY'), '7 Mar 1985', 'formatDate D MMM YYYY');
eq(F.formatDate('1985-03-07', 'DD.MM.YY'), '07.03.85', 'formatDate DD.MM.YY');
eq(F.formatDate('not-a-date', 'DD/MM/YYYY'), 'not-a-date', 'formatDate passes non-ISO through');
eq(F.toISODate('7 Mar 1985'), '1985-03-07', 'toISODate D MMM YYYY');
eq(F.toISODate('March 7, 1985'), '1985-03-07', 'toISODate MMMM D, YYYY');
eq(F.toISODate('1985-03-07'), '1985-03-07', 'toISODate ISO passthrough');
eq(F.toISODate('31 Feb 1985'), null, 'toISODate rejects impossible dates');
ok(F.ageFromISO('2000-01-01') >= 25, 'ageFromISO');

done('formdata-generate');
