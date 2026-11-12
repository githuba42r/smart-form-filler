// test/cloud-providers.test.js
// Anthropic + OpenAI providers: background callLLM dispatch, model listing helpers
// (cloud-providers.js), and the settings page markup + wiring.
const { ok, eq, section, done } = require('./harness');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- helpers -------------------------------------------------------------
function jsonResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text)
  };
}

// A fetch mock that records calls and answers from a list of responders.
function makeFetch(responder) {
  const calls = [];
  const fn = (url, opts = {}) => {
    calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : undefined });
    return Promise.resolve(responder(url, opts, calls.length - 1));
  };
  fn.calls = calls;
  return fn;
}

// Load background.js into a plain VM context with fake chrome + fetch.
function loadBackground(storage, fetchImpl) {
  const data = Object.assign({}, storage);
  const noopEvent = { addListener() {} };
  const ctx = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, AbortController,
    fetch: (...a) => fetchImpl(...a),
    chrome: {
      storage: { local: {
        get: keys => Promise.resolve((Array.isArray(keys) ? keys : [keys])
          .reduce((o, k) => { if (k in data) o[k] = data[k]; return o; }, {})),
        set: obj => { Object.assign(data, obj); return Promise.resolve(); }
      } },
      runtime: { onMessage: noopEvent, onInstalled: noopEvent, lastError: null },
      contextMenus: { onClicked: noopEvent, create() {}, removeAll(cb) { cb && cb(); } },
      tabs: { query() {}, sendMessage() {} }
    }
  });
  vm.runInContext(read('background.js'), ctx, { filename: 'background.js' });
  return ctx;
}

async function rejects(promise) {
  try { await promise; return null; } catch (e) { return e; }
}

const CP = require(path.join(ROOT, 'cloud-providers.js'));

(async () => {
  // ---- background: Anthropic dispatch ------------------------------------
  section('callLLM -> anthropic');
  {
    const f = makeFetch(() => jsonResponse(200, {
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
      stop_reason: 'end_turn'
    }));
    const bg = loadBackground({ provider: 'anthropic', anthropicApiKey: 'sk-ant-test', anthropicModel: 'claude-haiku-5-5' }, f);
    const out = await bg.callLLM('Say hi', 5000);
    eq(out, 'Hello world', 'concatenates text blocks only');
    eq(f.calls.length, 1, 'one request');
    const c = f.calls[0];
    eq(c.url, 'https://api.anthropic.com/v1/messages', 'messages URL');
    eq(c.opts.method, 'POST', 'POST');
    eq(c.opts.headers['x-api-key'], 'sk-ant-test', 'x-api-key header');
    eq(c.opts.headers['anthropic-version'], '2023-06-01', 'anthropic-version header');
    eq(c.opts.headers['content-type'], 'application/json', 'content-type header');
    eq(c.opts.headers['anthropic-dangerous-direct-browser-access'], 'true', 'direct browser access header');
    eq(c.body.model, 'claude-haiku-5-5', 'body.model from storage');
    ok(typeof c.body.max_tokens === 'number' && c.body.max_tokens > 0, 'body.max_tokens set');
    eq(c.body.messages, [{ role: 'user', content: 'Say hi' }], 'body.messages shape');
    ok(c.opts.signal && typeof c.opts.signal.aborted === 'boolean', 'AbortController signal passed');
  }
  {
    const f = makeFetch(() => jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    const bg = loadBackground({ provider: 'anthropic', anthropicApiKey: 'bad', anthropicModel: 'm' }, f);
    const err = await rejects(bg.callLLM('x', 5000));
    ok(err && /Anthropic/.test(err.message) && /401/.test(err.message) && /invalid x-api-key/.test(err.message),
      `anthropic error includes provider, status and API message (got ${err && err.message})`);
  }
  {
    const f = makeFetch(() => jsonResponse(200, { content: [] }));
    const bg = loadBackground({ provider: 'anthropic' }, f);
    const err = await rejects(bg.callLLM('x', 5000));
    ok(err && /Anthropic API key/.test(err.message), 'missing anthropic key -> clear error');
    eq(f.calls.length, 0, 'no request without a key');
  }

  // ---- background: OpenAI dispatch ---------------------------------------
  section('callLLM -> openai');
  {
    const f = makeFetch(() => jsonResponse(200, { choices: [{ message: { role: 'assistant', content: 'Hi from GPT' } }] }));
    const bg = loadBackground({ provider: 'openai', openaiApiKey: 'sk-openai-test', openaiModel: 'gpt-test-1' }, f);
    const out = await bg.callLLM('Say hi', 5000);
    eq(out, 'Hi from GPT', 'returns choices[0].message.content');
    const c = f.calls[0];
    eq(c.url, 'https://api.openai.com/v1/chat/completions', 'chat completions URL');
    eq(c.opts.method, 'POST', 'POST');
    eq(c.opts.headers['Authorization'], 'Bearer sk-openai-test', 'Bearer auth header');
    eq(c.body, { model: 'gpt-test-1', messages: [{ role: 'user', content: 'Say hi' }] }, 'body shape');
  }
  section('openai missing model');
  {
    const f = makeFetch(() => jsonResponse(200, {}));
    const bg = loadBackground({ provider: 'openai', openaiApiKey: 'sk-openai-test' }, f);
    const err = await rejects(bg.callLLM('x', 5000));
    eq(err && err.message, 'Select an OpenAI model in SmartForm settings', 'missing model error');
    eq(f.calls.length, 0, 'no request without a model');
  }
  {
    const f = makeFetch(() => jsonResponse(429, { error: { message: 'Rate limit reached', type: 'requests' } }));
    const bg = loadBackground({ provider: 'openai', openaiApiKey: 'k', openaiModel: 'gpt-x' }, f);
    const err = await rejects(bg.callLLM('x', 5000));
    ok(err && /OpenAI/.test(err.message) && /429/.test(err.message) && /Rate limit reached/.test(err.message),
      `openai error includes provider, status and API message (got ${err && err.message})`);
  }
  {
    const f = makeFetch(() => jsonResponse(200, {}));
    const bg = loadBackground({ provider: 'ollama-nope' }, f);
    const err = await rejects(bg.callLLM('x', 5000));
    ok(err && /Unknown LLM provider/.test(err.message), 'unknown provider still errors');
  }

  section('popup generateWithAI via cloud providers');
  {
    const f = makeFetch(() => jsonResponse(200, { choices: [{ message: { content: '```json\n{"0":"Jane"}\n```' } }] }));
    const bg = loadBackground({}, f);
    const r = await bg.callCloudForFormData('openai', [{ label: 'Name', name: 'n', type: 'text', placeholder: '' }], 'ctx',
      { openaiApiKey: 'k', openaiModel: 'gpt-x' });
    eq(r.success, true, 'openai form fill succeeds');
    eq(r.data, { '0': 'Jane' }, 'parses fenced JSON');
    const r2 = await bg.callCloudForFormData('openai', [], '', { openaiApiKey: 'k' });
    eq(r2, { success: false, error: 'Select an OpenAI model in SmartForm settings' }, 'missing model surfaces as error result');
  }

  // ---- cloud-providers.js: Anthropic pagination --------------------------
  section('anthropic models pagination');
  {
    const pages = [
      { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }], has_more: true, first_id: 'claude-opus-5-5', last_id: 'claude-sonnet-5-5' },
      { data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }], has_more: true, last_id: 'claude-haiku-5-5' },
      { data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }], has_more: false, last_id: 'claude-haiku-4-5' }
    ];
    const f = makeFetch((url, opts, i) => jsonResponse(200, pages[i]));
    const models = await CP.fetchAnthropicModels('sk-ant-x', f);
    eq(f.calls.length, 3, 'fetches every page');
    ok(f.calls[0].url.indexOf('https://api.anthropic.com/v1/models') === 0, 'models URL');
    ok(f.calls[0].url.indexOf('after_id') === -1, 'first page has no after_id');
    ok(f.calls[1].url.indexOf('after_id=claude-sonnet-5-5') !== -1, 'second page uses last_id as after_id');
    ok(f.calls[2].url.indexOf('after_id=claude-haiku-5-5') !== -1, 'third page uses next last_id');
    ok(/limit=\d+/.test(f.calls[0].url), 'passes limit');
    eq(f.calls[0].opts.headers['x-api-key'], 'sk-ant-x', 'models x-api-key header');
    eq(f.calls[0].opts.headers['anthropic-version'], '2023-06-01', 'models anthropic-version header');
    eq(f.calls[0].opts.headers['anthropic-dangerous-direct-browser-access'], 'true', 'models direct browser header');
    eq(models.map(m => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-haiku-4-5'], 'all ids in order');
    eq(models[0].label, 'Claude Opus 5.5 (claude-opus-5-5)', 'label is display_name (id)');
    eq(CP.pickDefaultModel('anthropic', models, ''), 'claude-haiku-5-5', 'prefers claude-haiku-5-5');
    eq(CP.pickDefaultModel('anthropic', models.filter(m => m.id !== 'claude-haiku-5-5'), ''), 'claude-opus-5-5', 'falls back to first model');
    eq(CP.pickDefaultModel('anthropic', models, 'claude-sonnet-5-5'), 'claude-sonnet-5-5', 'saved model wins');
  }
  {
    const f = makeFetch(() => jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    const err = await rejects(CP.fetchAnthropicModels('bad', f));
    eq(err && err.status, 401, 'models error carries status');
    eq(CP.describeError(err), 'Invalid API key', '401 -> "Invalid API key"');
  }

  // ---- cloud-providers.js: OpenAI filter ---------------------------------
  section('openai model filter');
  {
    const raw = [
      { id: 'gpt-4o', created: 300 },
      { id: 'gpt-5-mini', created: 900 },
      { id: 'o3-mini', created: 500 },
      { id: 'o1', created: 100 },
      { id: 'o4-mini', created: 700 },
      { id: 'chatgpt-4o-latest', created: 400 },
      { id: 'text-embedding-3-large', created: 950 },
      { id: 'tts-1', created: 960 },
      { id: 'whisper-1', created: 970 },
      { id: 'dall-e-3', created: 980 },
      { id: 'gpt-image-1', created: 990 },
      { id: 'gpt-4o-audio-preview', created: 991 },
      { id: 'gpt-4o-realtime-preview', created: 992 },
      { id: 'gpt-4o-transcribe', created: 993 },
      { id: 'omni-moderation-latest', created: 994 },
      { id: 'gpt-4o-search-preview', created: 995 },
      { id: 'babbage-002', created: 996 },
      { id: 'davinci-002', created: 997 }
    ];
    const kept = CP.filterOpenAIModels(raw).map(m => m.id);
    eq(kept, ['gpt-5-mini', 'o4-mini', 'o3-mini', 'chatgpt-4o-latest', 'gpt-4o', 'o1'], 'keeps chat models, newest first');

    const f = makeFetch(() => jsonResponse(200, { object: 'list', data: raw }));
    const models = await CP.fetchOpenAIModels('sk-oa', f);
    eq(f.calls[0].url, 'https://api.openai.com/v1/models', 'openai models URL');
    eq(f.calls[0].opts.headers['Authorization'], 'Bearer sk-oa', 'openai models Bearer header');
    eq(models.length, 6, 'fetchOpenAIModels applies the filter');
    eq(CP.pickDefaultModel('openai', models, ''), '', 'no default OpenAI model');
  }
  eq(CP.maskKey('sk-proj-1234567890abcd'), 'sk-…abcd', 'maskKey shows prefix + last 4');
  ok(CP.maskKey('sk-proj-1234567890abcd').indexOf('1234567890') === -1, 'maskKey never echoes the key body');

  // ---- options.html markup -----------------------------------------------
  section('options.html');
  const html = read('options.html');
  ['anthropic', 'openai'].forEach(p => {
    ok(html.indexOf(`id="provider-${p}"`) !== -1 && html.indexOf(`value="${p}"`) !== -1, `${p} radio option`);
    ok(html.indexOf(`id="provider-${p}-label"`) !== -1, `${p} .provider-option label`);
    ok(html.indexOf(`id="${p}Settings"`) !== -1, `#${p}Settings card`);
    ok(new RegExp(`<input type="password" id="${p}ApiKey"`).test(html), `${p} password key input`);
    ok(new RegExp(`<select id="${p}Model" class="select-full"`).test(html), `${p} model select.select-full`);
  });
  ok(html.indexOf('Anthropic (Cloud)') !== -1 && html.indexOf('OpenAI (Cloud)') !== -1, 'provider labels');
  ok(html.indexOf('https://console.anthropic.com/settings/keys') !== -1, 'anthropic key link');
  ok(html.indexOf('https://platform.openai.com/api-keys') !== -1, 'openai key link');
  ok(html.indexOf('cloud-providers.js') !== -1 && html.indexOf('cloud-providers.js') < html.indexOf('options.js'),
    'cloud-providers.js loads before options.js');
  {
    // New card markup uses theme tokens only (no literal colours).
    const start = html.indexOf('<!-- Anthropic Settings -->');
    const end = html.indexOf('<!-- Behavior -->');
    const cards = html.slice(start, end);
    ok(start !== -1 && !/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(cards), 'new cards contain no hard-coded colours');
  }

  // ---- options.js behaviour in jsdom -------------------------------------
  section('options page wiring');
  {
    const store = { provider: 'ollama' };
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com' });
    const win = dom.window;
    win.chrome = {
      storage: { local: {
        get: keys => Promise.resolve((Array.isArray(keys) ? keys : [keys])
          .reduce((o, k) => { if (k in store) o[k] = store[k]; return o; }, {})),
        set: obj => { Object.assign(store, obj); return Promise.resolve(); }
      } },
      runtime: { lastError: null, sendMessage: () => Promise.resolve({}) },
      identity: { getRedirectURL: () => '' },
      tabs: { create() {} }
    };
    let keyIsValid = false;
    win.fetch = (url, opts) => {
      if (url.indexOf('openrouter.ai') !== -1) return Promise.resolve(jsonResponse(200, { data: [] }));
      if (url.indexOf('api.anthropic.com/v1/models') !== -1) {
        return Promise.resolve(keyIsValid
          ? jsonResponse(200, { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }], has_more: false, last_id: 'claude-haiku-5-5' })
          : jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      }
      return Promise.resolve(jsonResponse(404, { error: { message: 'not found' } }));
    };
    const ctx = dom.getInternalVMContext();
    ['theme.js', 'recommendations.js', 'vendor/address-schemas.js', 'formdata.js', 'ai-field-detector.js',
      'form-registry.js', 'profile-ui.js', 'cloud-providers.js', 'options.js']
      .filter(f => fs.existsSync(path.join(ROOT, f)))
      .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
    // jsdom fires DOMContentLoaded asynchronously after construction, so the
    // options.js handler registered above runs on its own: just wait for boot.
    const tick = () => new Promise(r => setTimeout(r, 20));
    for (let i = 0; i < 10 && !win.__sfOptions; i++) await tick();
    ok(!!win.__sfOptions, 'options page booted');

    const $ = id => win.document.getElementById(id);
    // Selecting the provider shows its card.
    $('provider-anthropic').checked = true;
    $('provider-anthropic').dispatchEvent(new win.Event('change'));
    await tick();
    eq($('anthropicSettings').style.display, 'block', 'anthropic card shown when selected');
    eq($('openaiSettings').style.display, 'none', 'openai card hidden');

    // Show / hide toggle.
    $('btnToggleAnthropicKey').click();
    eq($('anthropicApiKey').type, 'text', 'show toggles to text');
    $('btnToggleAnthropicKey').click();
    eq($('anthropicApiKey').type, 'password', 'hide toggles back to password');

    // Save with a bad key -> stored, provider set, 401 -> Invalid API key.
    $('anthropicApiKey').value = 'sk-ant-badkey-000000wxyz';
    $('btnSaveAnthropicKey').click();
    for (let i = 0; i < 10; i++) await tick();
    eq(store.anthropicApiKey, 'sk-ant-badkey-000000wxyz', 'Save Key stores the key');
    eq(store.provider, 'anthropic', 'Save Key sets provider');
    ok($('anthropicModelStatus').className.indexOf('error') !== -1 &&
      $('anthropicModelStatus').textContent.indexOf('Invalid API key') !== -1, '401 shows "Invalid API key" in .status.error');
    ok($('anthropicKeyState').textContent.indexOf('sk-…wxyz') !== -1, 'masked key shown');
    ok(win.document.body.textContent.indexOf('sk-ant-badkey-000000wxyz') === -1, 'full key never echoed');

    // Fix the key and reload models -> list populated, default preselected and saved.
    keyIsValid = true;
    $('btnLoadAnthropicModels').click();
    for (let i = 0; i < 10; i++) await tick();
    const opts = Array.from($('anthropicModel').options).map(o => o.textContent);
    eq(opts, ['Claude Opus 5.5 (claude-opus-5-5)', 'Claude Haiku 5.5 (claude-haiku-5-5)'], 'select lists fetched models');
    eq($('anthropicModel').value, 'claude-haiku-5-5', 'claude-haiku-5-5 preselected');
    eq(store.anthropicModel, 'claude-haiku-5-5', 'preselection persisted');

    // Changing the select saves immediately.
    $('anthropicModel').value = 'claude-opus-5-5';
    $('anthropicModel').dispatchEvent(new win.Event('change'));
    await tick();
    eq(store.anthropicModel, 'claude-opus-5-5', 'select change saves anthropicModel');
    ok($('anthropicModelStatus').className.indexOf('success') !== -1, 'select change shows success status');
  }

  done('cloud-providers');
})().catch(e => { console.error(e); process.exit(1); });
