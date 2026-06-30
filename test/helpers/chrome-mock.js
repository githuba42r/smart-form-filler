// Reusable fake chrome.storage.local for tests. Test infra (no production logic).
function makeChrome(initial) {
  const data = Object.assign({}, initial);
  return {
    storage: { local: {
      get: (keys) => Promise.resolve(
        (Array.isArray(keys) ? keys : [keys]).reduce((o, k) => { if (k in data) o[k] = data[k]; return o; }, {})),
      set: (obj) => { Object.assign(data, obj); return Promise.resolve(); }
    } },
    runtime: { onMessage: { addListener() {} }, lastError: null }
  };
}
module.exports = { makeChrome };
