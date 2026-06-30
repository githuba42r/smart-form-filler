const { JSDOM } = require('jsdom');
const { makeChrome } = require('./helpers/chrome-mock');
const path = require('path'), fs = require('fs'), vm = require('vm');

const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window;
const ctx = dom.getInternalVMContext();

// Load dependencies
['vendor/address-schemas.js', 'formdata.js', 'profile-ui.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'), ctx, { filename: f });
});

// Set up chrome mock
vm.runInContext('this.chrome = null;', ctx);
Object.defineProperty(win, 'chrome', {
  value: makeChrome({ profiles: [{ id:'au-personal', label:'AU' }], defaultProfile: 'au-personal' }),
  writable: true
});

// Load content.js
win.__smartFormFillerLoaded = false;
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8'), ctx, { filename: 'content.js' });

// Now run test assertions via eval in context so they see the loaded globals
const { eq, ok, done } = require('./harness');
const result = vm.runInContext(`
typeof __sfMenuOnlyFor === 'function' && {
  sfMenuOnlyForExists: true,
  name: __sfMenuOnlyFor('name'),
  address: __sfMenuOnlyFor('address'),
  nameAddress: __sfMenuOnlyFor('nameAddress'),
  all: __sfMenuOnlyFor('all')
}
`, ctx);

ok(result && result.sfMenuOnlyForExists, '__sfMenuOnlyFor exposed');
eq(result.name, ['name','contact'], 'name -> name+contact');
eq(result.address, ['address'], 'address -> address');
eq(result.nameAddress, ['name','contact','address'], 'nameAddress -> all three');
eq(result.all, null, 'all -> null (use profile policy)');

done('content-menu-wiring');
