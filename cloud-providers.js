/**
 * SmartForm Filler - cloud provider helpers (Anthropic + OpenAI) for the settings page.
 *
 * Classic script: exposes window.SFCloudProviders (and module.exports under Node
 * for tests). Lists the models currently available to an API key, live from each
 * provider's models API; nothing here is a hard-coded model list.
 */
(function (root) {
  'use strict';

  var ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
  var ANTHROPIC_VERSION = '2023-06-01';
  var OPENAI_API_BASE = 'https://api.openai.com/v1';
  // Preferred preselection when the fetched Anthropic list contains it.
  var PREFERRED_ANTHROPIC_MODEL = 'claude-haiku-5-5';
  var MAX_PAGES = 50; // safety stop for pagination

  var OPENAI_CHAT_PREFIXES = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'];
  var OPENAI_EXCLUDE = ['embedding', 'tts', 'whisper', 'dall-e', 'image', 'audio',
    'realtime', 'transcribe', 'moderation', 'search'];

  function getFetch(fetchImpl) {
    if (fetchImpl) return fetchImpl;
    if (typeof fetch === 'function') return function (u, o) { return fetch(u, o); };
    throw new Error('fetch is not available');
  }

  /** Error carrying the HTTP status: "<Provider> API error <status>: <message>". */
  async function httpError(providerName, response) {
    var detail = response.statusText || '';
    try {
      var text = await response.text();
      if (text) {
        detail = text;
        try {
          var body = JSON.parse(text);
          if (body && body.error && body.error.message) detail = body.error.message;
        } catch (_) { /* not JSON */ }
      }
    } catch (_) { /* unreadable body */ }
    var err = new Error((providerName + ' API error ' + response.status + ': ' + detail).trim());
    err.status = response.status;
    err.provider = providerName;
    return err;
  }

  function anthropicHeaders(apiKey) {
    return {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }

  /**
   * All Anthropic models for this key, following has_more / last_id pagination.
   * @returns {Promise<Array<{id:string,label:string,displayName:string}>>}
   */
  async function fetchAnthropicModels(apiKey, fetchImpl) {
    if (!apiKey) throw new Error('Enter an Anthropic API key first.');
    var doFetch = getFetch(fetchImpl);
    var models = [];
    var afterId = null;
    for (var page = 0; page < MAX_PAGES; page++) {
      var url = ANTHROPIC_API_BASE + '/models?limit=100' +
        (afterId ? '&after_id=' + encodeURIComponent(afterId) : '');
      var response = await doFetch(url, { method: 'GET', headers: anthropicHeaders(apiKey) });
      if (!response.ok) throw await httpError('Anthropic', response);
      var body = await response.json();
      (body.data || []).forEach(function (m) {
        if (!m || !m.id) return;
        var name = m.display_name || '';
        models.push({ id: m.id, displayName: name, label: name ? name + ' (' + m.id + ')' : m.id });
      });
      if (!body.has_more || !body.last_id) break;
      afterId = body.last_id;
    }
    return models;
  }

  /** Keep chat-capable text models only, newest first by `created`. */
  function filterOpenAIModels(data) {
    return (data || [])
      .filter(function (m) {
        if (!m || typeof m.id !== 'string') return false;
        var id = m.id.toLowerCase();
        var chat = OPENAI_CHAT_PREFIXES.some(function (p) { return id.indexOf(p) === 0; });
        if (!chat) return false;
        return !OPENAI_EXCLUDE.some(function (x) { return id.indexOf(x) !== -1; });
      })
      .sort(function (a, b) { return (b.created || 0) - (a.created || 0); })
      .map(function (m) { return { id: m.id, label: m.id, created: m.created || 0 }; });
  }

  /** @returns {Promise<Array<{id:string,label:string,created:number}>>} */
  async function fetchOpenAIModels(apiKey, fetchImpl) {
    if (!apiKey) throw new Error('Enter an OpenAI API key first.');
    var doFetch = getFetch(fetchImpl);
    var response = await doFetch(OPENAI_API_BASE + '/models', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });
    if (!response.ok) throw await httpError('OpenAI', response);
    var body = await response.json();
    return filterOpenAIModels(body.data);
  }

  function fetchModels(provider, apiKey, fetchImpl) {
    if (provider === 'anthropic') return fetchAnthropicModels(apiKey, fetchImpl);
    if (provider === 'openai') return fetchOpenAIModels(apiKey, fetchImpl);
    return Promise.reject(new Error('Unknown provider: ' + provider));
  }

  /**
   * Model to preselect. Saved model wins; Anthropic then prefers claude-haiku-5-5,
   * then the first model; OpenAI has no default (user must choose) -> ''.
   */
  function pickDefaultModel(provider, models, savedModel) {
    var ids = (models || []).map(function (m) { return m.id; });
    if (savedModel) return savedModel;
    if (provider === 'anthropic') {
      if (ids.indexOf(PREFERRED_ANTHROPIC_MODEL) !== -1) return PREFERRED_ANTHROPIC_MODEL;
      return ids[0] || '';
    }
    return '';
  }

  /** Masked key for display, e.g. "sk-…abcd". Never returns the full key. */
  function maskKey(key) {
    if (!key) return '';
    var k = String(key);
    if (k.length < 12) return '…' + k.slice(-2);
    return k.slice(0, 3) + '…' + k.slice(-4);
  }

  /** User-facing error text; 401 -> "Invalid API key". */
  function describeError(err) {
    if (err && err.status === 401) return 'Invalid API key';
    return (err && err.message) ? err.message : String(err);
  }

  var api = {
    PREFERRED_ANTHROPIC_MODEL: PREFERRED_ANTHROPIC_MODEL,
    fetchAnthropicModels: fetchAnthropicModels,
    fetchOpenAIModels: fetchOpenAIModels,
    filterOpenAIModels: filterOpenAIModels,
    fetchModels: fetchModels,
    pickDefaultModel: pickDefaultModel,
    maskKey: maskKey,
    describeError: describeError
  };

  root.SFCloudProviders = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
