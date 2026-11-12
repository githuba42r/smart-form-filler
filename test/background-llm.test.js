// test/background-llm.test.js — callLLM uses the configured model; updates keep user settings
const { eq, ok, done } = require('./harness');
const path = require('path'), fs = require('fs'), vm = require('vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'utf8');

function load(stored) {
  const data = Object.assign({}, stored);
  const listeners = { message: null, installed: [] };
  const fetchCalls = [];
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, AbortController, URL, TextEncoder,
    fetch: (url, init) => {
      fetchCalls.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ response: 'ollama-ok', choices: [{ message: { content: 'or-ok' } }] }) });
    },
    chrome: {
      storage: { local: {
        get: (keys) => Promise.resolve((Array.isArray(keys) ? keys : [keys])
          .reduce((o, k) => { if (k in data) o[k] = data[k]; return o; }, {})),
        set: (obj) => { Object.assign(data, obj); return Promise.resolve(); }
      } },
      runtime: {
        onMessage: { addListener(fn) { listeners.message = fn; } },
        onInstalled: { addListener(fn) { listeners.installed.push(fn); } }
      },
      tabs: { query() {}, sendMessage() {} }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'background.js' });
  const callLLM = (prompt) => new Promise(resolve =>
    listeners.message({ action: 'callLLM', prompt, timeoutMs: 1000 }, {}, resolve));
  return { data, fetchCalls, callLLM, listeners };
}

(async () => {
  {
    const bg = load({ provider: 'openrouter', openrouterApiKey: 'k', openrouterModel: 'anthropic/claude-haiku' });
    const res = await bg.callLLM('hi');
    eq(res.result, 'or-ok', 'openrouter: response text returned');
    eq(bg.fetchCalls[0].body.model, 'anthropic/claude-haiku', 'openrouter: uses the selected model');
  }
  {
    const bg = load({ provider: 'openrouter', openrouterApiKey: 'k' });
    await bg.callLLM('hi');
    eq(bg.fetchCalls[0].body.model, 'qwen/qwen3-coder', 'openrouter: default model when none selected');
  }
  {
    const bg = load({ provider: 'ollama', ollamaModel: 'qwen2.5-coder:7b' });
    const res = await bg.callLLM('hi');
    eq(res.result, 'ollama-ok', 'ollama: response text returned');
    eq(bg.fetchCalls[0].body.model, 'qwen2.5-coder:7b', 'ollama: uses the configured model');
  }
  {
    const bg = load({ openrouterModel: 'my/choice', profiles: [{ id: 'x' }], profilesVersion: 1, defaultProfile: 'x' });
    bg.listeners.installed.forEach(fn => fn({ reason: 'update' }));
    await new Promise(r => setTimeout(r, 10));
    eq(bg.data.openrouterModel, 'my/choice', 'update keeps the selected OpenRouter model');
    ok(bg.data.ollamaUrl, 'update fills in missing defaults');
  }
  done('background-llm');
})();
