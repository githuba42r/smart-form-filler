const { loadGlobals, eq, ok, done } = require('./harness');
const win = loadGlobals([], '<!DOCTYPE html><body><div id="x">hi</div></body>');
ok(win.document.getElementById('x').textContent === 'hi', 'jsdom document available');
eq(typeof win.Node, 'function', 'window has DOM globals');
done('harness.selftest');
