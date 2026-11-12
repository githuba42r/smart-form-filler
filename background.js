/**
 * SmartForm Filler - Background Service Worker (MV3)
 * Handles:
 *  - Ollama / local LLM calls for intelligent form analysis (privacy-friendly, no data leaves your machine unless you configure cloud)
 *  - Future: command shortcuts, centralized profile storage, etc.
 */

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.1:latest'; // Good balance; qwen2.5-coder, gemma2, phi4 also excellent for JSON

// In-memory cache of last AI suggestion (optional)
let lastAISuggestion = null;

/**
 * Call Ollama chat API and request structured JSON output.
 */
async function callOllamaForFormData(fields, context = '', options = {}) {
  const ollamaUrl = options.ollamaUrl || DEFAULT_OLLAMA_URL;
  const model = options.model || DEFAULT_OLLAMA_MODEL;

  // Build a strong prompt for reliable JSON
  const fieldDescriptions = fields.map((f, i) =>
    `${i}. Label: "${f.label}" | Name: "${f.name}" | Type: ${f.type} | Placeholder: "${f.placeholder}"`
  ).join('\n');

  const systemPrompt = `You are an expert Australian test data generator specialized in creating realistic, consistent, privacy-safe data for web form testing and development.

You will receive a list of form fields with their labels and attributes. Your job is to output ONLY valid JSON that maps each field index (as a string key) to an appropriate test value string.

Rules you MUST follow:
- Create ONE consistent fictional person / entity across the whole form (name, email, address, phone all match).
- Prefer Australian data (Brisbane / QLD / Mansfield area postcodes like 4122, 4000, 4065; Australian mobile format starting with 04).
- Use realistic but obviously fake values (never real people's data).
- Password fields should use strong but memorable test passwords like "DevTest2026!" or "SecurePass123!".
- For free-text / textarea fields give a short, relevant, professional-sounding test sentence.
- Dates must be in YYYY-MM-DD format.
- If a field looks like a state dropdown, use "QLD" or "NSW" etc.
- If you cannot determine a good value for a field, use a sensible placeholder based on the label.
- NEVER include markdown code fences, explanations, or any text outside the JSON object.
- The JSON must be minified and parseable by JSON.parse().`;

  const userPrompt = `Page / Form context: ${context || 'General web form on a development or staging site'}

Detected form fields:
${fieldDescriptions}

Generate the JSON now:`;

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        options: {
          temperature: 0.2,   // low temp for more deterministic/consistent output
          top_p: 0.9,
          num_predict: 800    // enough tokens for the JSON
        },
        format: 'json'        // Ollama's native JSON mode (great if model supports it)
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    let content = data.message?.content || data.response || '';

    // Clean common LLM artifacts
    content = content.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Try to extract the first {...} block if extra text sneaks in
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) content = jsonMatch[0];

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error('[SmartForm Background] Failed to parse Ollama JSON response:', content);
      throw new Error('Ollama returned invalid JSON. Try a different model or lower temperature.');
    }

    lastAISuggestion = parsed;
    return { success: true, data: parsed, modelUsed: model };
  } catch (err) {
    console.error('[SmartForm Background] Ollama call failed:', err);
    return {
      success: false,
      error: err.message || String(err),
      suggestion: 'Make sure Ollama is running and OLLAMA_ORIGINS includes chrome-extension://* . Try a smaller/faster model like phi3 or gemma2.'
    };
  }
}

/**
 * Call OpenRouter chat completions API.
 */
async function callOpenRouterForFormData(fields, context = '', options = {}) {
  const apiKey = options.apiKey;
  // Default: Qwen3 Coder 480B (mirrors DEFAULT_OPENROUTER_MODEL in recommendations.js)
  const model = options.model || 'qwen/qwen3-coder';

  if (!apiKey) {
    return { success: false, error: 'No OpenRouter API key configured.' };
  }

  const fieldDescriptions = fields.map((f, i) =>
    `${i}. Label: "${f.label}" | Name: "${f.name}" | Type: ${f.type} | Placeholder: "${f.placeholder}"`
  ).join('\n');

  const systemPrompt = `You are an expert Australian test data generator specialized in creating realistic, consistent, privacy-safe data for web form testing and development.

You will receive a list of form fields. Output ONLY valid minified JSON mapping each field index (string key) to a test value string.

Rules:
- ONE consistent fictional person across the form.
- Prefer Australian (Brisbane/QLD) data.
- Use obviously fake values.
- Passwords like "DevTest2026!".
- Short professional test sentences for textareas.
- Dates in YYYY-MM-DD.
- Respond with clean JSON only.`;

  const userPrompt = `Context: ${context || 'Development form'}

Fields:
${fieldDescriptions}

Return the JSON now:`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://smartform-filler.dev',
        'X-Title': 'SmartForm Filler'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errText}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';

    content = content.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) content = jsonMatch[0];

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error('OpenRouter returned invalid JSON.');
    }

    lastAISuggestion = parsed;
    return { success: true, data: parsed, modelUsed: model };
  } catch (err) {
    console.error('[SmartForm Background] OpenRouter call failed:', err);
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

// ---------------------------------------------------------------------------
// Generic LLM proxy — used by content scripts for AI field detection
// ---------------------------------------------------------------------------

/**
 * Dispatch a plain-text prompt to the configured LLM provider.
 * Reads provider settings from chrome.storage.sync.
 * @returns {Promise<string>} The model's text response.
 */
async function callLLM(prompt, timeoutMs = 10000) {
  const settings = await chrome.storage.local.get(['provider', 'ollamaUrl', 'openrouterApiKey']);
  const provider = settings.provider || 'ollama';

  if (provider === 'ollama') {
    return await callOllama(prompt, settings.ollamaUrl || DEFAULT_OLLAMA_URL, timeoutMs);
  } else if (provider === 'openrouter') {
    return await callOpenRouter(prompt, settings.openrouterApiKey, timeoutMs);
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * Call Ollama /api/generate with a plain-text prompt.
 * @returns {Promise<string>}
 */
async function callOllama(prompt, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral:latest',
        prompt,
        stream: false,
        temperature: 0.3
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

    const data = await response.json();
    return data.response;
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Ollama call failed: ${err.message}`);
  }
}

/**
 * Call OpenRouter chat completions API with a plain-text prompt.
 * @returns {Promise<string>}
 */
async function callOpenRouter(prompt, apiKey, timeoutMs) {
  if (!apiKey) throw new Error('No OpenRouter API key configured.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://smartform-filler.dev',
        'X-Title': 'SmartForm Filler'
      },
      body: JSON.stringify({
        model: 'mistral-7b-instruct',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`OpenRouter call failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------

/**
 * Message listener from popup or content scripts.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'generateWithAI') {
    // Route based on provider saved in storage
    chrome.storage.local.get(['provider', 'ollamaUrl', 'ollamaModel', 'openrouterApiKey', 'openrouterModel']).then(settings => {
      const provider = settings.provider || 'ollama';

      if (provider === 'openrouter') {
        callOpenRouterForFormData(msg.fields || [], msg.context || '', {
          apiKey: settings.openrouterApiKey,
          model: settings.openrouterModel || msg.model
        }).then(result => sendResponse(result));
      } else {
        callOllamaForFormData(msg.fields || [], msg.context || '', {
          ollamaUrl: settings.ollamaUrl,
          model: settings.ollamaModel || msg.model
        }).then(result => sendResponse(result));
      }
    });
    return true;
  }

  if (msg.action === 'getLastAISuggestion') {
    sendResponse({ success: true, data: lastAISuggestion });
    return true;
  }

  if (msg.action === 'testOllamaConnection') {
    const url = msg.ollamaUrl || DEFAULT_OLLAMA_URL;
    const model = msg.model || DEFAULT_OLLAMA_MODEL;

    fetch(`${url}/api/tags`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        const models = (data.models || []).map(m => m.name);
        const hasModel = models.includes(model) || models.some(m => m.startsWith(model.split(':')[0]));
        sendResponse({
          success: true,
          connected: true,
          availableModels: models,
          modelAvailable: hasModel,
          message: hasModel ? `Connected. Model "${model}" found.` : `Connected, but "${model}" not pulled yet.`
        });
      })
      .catch(err => {
        sendResponse({
          success: false,
          connected: false,
          error: err.message,
          message: 'Cannot reach Ollama. Is it running? Did you set OLLAMA_ORIGINS=chrome-extension://* ?'
        });
      });
    return true;
  }

  // Generic LLM proxy for content scripts (AI field detection)
  if (msg.action === 'callLLM') {
    callLLM(msg.prompt, msg.timeoutMs)
      .then(result => sendResponse({ result }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep channel open for async response
  }

  // Command from keyboard shortcut
  if (msg.action === 'command-smart-fill') {
    // Could forward to active tab's content script, but for now just acknowledge
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'fillProfile', profileKey: 'au-personal' });
      }
    });
    sendResponse({ success: true });
    return true;
  }

  return false;
});

// Seed & migrate storage-backed profiles on install
const PROFILES_VERSION = 1;
const _allGroups = { name:true, contact:true, address:true, account:true, misc:true };
const DEFAULT_PROFILES = [
  { id:'au-personal', label:'AU Personal', country:'AU', randomize:true,
    policy:{ groups:{ ..._allGroups, misc:false }, exclude:[] }, pins:{} },
  { id:'au-business', label:'AU Business / Company', country:'AU', randomize:true,
    policy:{ groups:{ ..._allGroups }, exclude:[] }, pins:{ business:'Aether Dynamics Pty Ltd' } },
  { id:'us-test', label:'US Test User', country:'US', randomize:true,
    policy:{ groups:{ ..._allGroups, misc:false }, exclude:[] }, pins:{} },
  { id:'minimal', label:'Minimal / Edge Case', country:'AU', randomize:true,
    policy:{ groups:{ name:true, contact:false, address:false, account:false, misc:false }, exclude:[] }, pins:{} }
];
async function seedProfiles(store) {
  const cur = await store.get(['profiles', 'profilesVersion', 'defaultProfile']);
  const needsSeed = !cur.profiles || (cur.profilesVersion || 0) < PROFILES_VERSION;
  const patch = {};
  if (needsSeed) { patch.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES)); patch.profilesVersion = PROFILES_VERSION; }
  if (!cur.defaultProfile) patch.defaultProfile = DEFAULT_PROFILES[0].id;
  if (Object.keys(patch).length) await store.set(patch);
}

// Optional: on install, set some defaults
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    seedProfiles({ get: (k) => chrome.storage.local.get(k), set: (o) => chrome.storage.local.set(o) });
    chrome.storage.local.set({
      ollamaUrl: DEFAULT_OLLAMA_URL,
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      openrouterModel: 'qwen/qwen3-coder', // Qwen3 Coder 480B default
      aiEnabled: true
    });
    console.log('[SmartForm] Extension installed. Default Ollama config set.');
  }
});

// Right-click on a form field → "Fill with AI suggestion" (handled by content.js).
const AI_FIELD_MENU_ID = 'sf-ai-suggest-field';
if (chrome.contextMenus) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: AI_FIELD_MENU_ID,
        title: 'SmartForm: Fill this field with AI suggestion',
        contexts: ['editable']
      });
    });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== AI_FIELD_MENU_ID || !tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { action: 'aiSuggestField' }, { frameId: info.frameId || 0 }, () => {
      void chrome.runtime.lastError; // no content script in that frame — nothing to do
    });
  });
}

console.log('[SmartForm Filler] Background service worker ready.');