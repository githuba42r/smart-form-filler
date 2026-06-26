/**
 * SmartForm Filler - Options Page (Enhanced with OpenRouter + OAuth2 PKCE support)
 *
 * Recommendation helpers (RECOMMENDED_RULES, getRecommendation, isFreeModel,
 * escapeHtml) are provided by recommendations.js, loaded before this script.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const providerRadios = document.querySelectorAll('input[name="provider"]');
  const ollamaSettings = document.getElementById('ollamaSettings');
  const openrouterSettings = document.getElementById('openrouterSettings');

  // Ollama elements
  const ollamaUrlInput = document.getElementById('ollamaUrl');
  const ollamaModelInput = document.getElementById('ollamaModel');
  const btnTestOllama = document.getElementById('btnTestOllama');
  const btnSaveOllama = document.getElementById('btnSaveOllama');
  const ollamaStatus = document.getElementById('ollamaStatus');

  // OpenRouter elements
  const openrouterStatus = document.getElementById('openrouterStatus');
  const btnConnectOpenRouter = document.getElementById('btnConnectOpenRouter');
  const btnBrowseModels = document.getElementById('btnBrowseModels');
  const openrouterApiKeyInput = document.getElementById('openrouterApiKey');
  const btnSaveOpenRouterKey = document.getElementById('btnSaveOpenRouterKey');
  const currentOpenRouterModel = document.getElementById('currentOpenRouterModel');
  const currentModelCard = document.getElementById('currentModelCard');

  // Behavior
  const defaultProfileSelect = document.getElementById('defaultProfile');
  const btnSaveBehavior = document.getElementById('btnSaveBehavior');

  // Modal
  const modelModal = document.getElementById('modelModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const modelsLoading = document.getElementById('modelsLoading');
  const modelsGrid = document.getElementById('modelsGrid');
  const modelsError = document.getElementById('modelsError');

  // Model filter toolbar
  const modelToolbar = document.getElementById('modelToolbar');
  const modelSearch = document.getElementById('modelSearch');
  const modelSuggestions = document.getElementById('modelSuggestions');
  const segCost = document.getElementById('segCost');
  const segQuality = document.getElementById('segQuality');
  const modelsCount = document.getElementById('modelsCount');
  const modelsEmpty = document.getElementById('modelsEmpty');

  let currentSettings = {};
  let allModels = [];
  let modelsCache = null; // raw OpenRouter model list, fetched once per session
  const modelFilter = { search: '', cost: 'all', quality: 'all' };

  // Fetch the public OpenRouter model list (no API key required), cached per session.
  async function fetchOpenRouterModels() {
    if (modelsCache) return modelsCache;
    const apiKey = (openrouterApiKeyInput && openrouterApiKeyInput.value.trim()) || currentSettings.openrouterApiKey;
    const headers = {
      'HTTP-Referer': 'https://smartform-filler.dev',
      'X-Title': 'SmartForm Filler Extension'
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch('https://openrouter.ai/api/v1/models', { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    modelsCache = data.data || [];
    return modelsCache;
  }

  // Build a model card DOM element (shared by the picker grid and the
  // "selected model" display). No click handler is attached here.
  function createModelCard(model, opts = {}) {
    const card = document.createElement('div');
    const isSelected = ('selected' in opts) ? opts.selected : (model.id === currentSettings.openrouterModel);
    card.className = 'model-card'
      + (model._reasons ? ' recommended' : '')
      + (isSelected ? ' selected' : '');
    card.dataset.modelId = model.id;

    const name = model.name || model.id;
    const desc = (model.description || 'No description available.').substring(0, 220);
    const context = model.context_length ? `${(model.context_length / 1000).toFixed(0)}K` : '—';
    const pricing = model.pricing || {};
    const inputP = pricing.prompt ? (parseFloat(pricing.prompt) * 1_000_000).toFixed(2) : '—';
    const outputP = pricing.completion ? (parseFloat(pricing.completion) * 1_000_000).toFixed(2) : '—';

    const badges = [];
    if (model._reasons) badges.push('<span class="badge star">★ Recommended</span>');
    if (model._free) badges.push('<span class="badge free">Free</span>');

    const reasonsList = model._reasons
      ? `<ul class="rec-reason">${model._reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
      : '';

    card.innerHTML = `
      <div class="model-card-top">
        <div class="model-name">${escapeHtml(name)}</div>
        ${badges.length ? `<div class="model-badges">${badges.join('')}</div>` : ''}
      </div>
      ${reasonsList}
      <div class="model-desc">${escapeHtml(desc)}</div>
      <div class="model-meta">
        <span class="context">Context: ${context}</span>
        <span class="pricing">$${inputP} / $${outputP} per 1M tokens</span>
      </div>
    `;
    return card;
  }

  // Load all settings from storage
  async function loadSettings() {
    currentSettings = await chrome.storage.local.get([
      'provider',
      'ollamaUrl', 'ollamaModel',
      'openrouterApiKey', 'openrouterModel',
      'defaultProfile'
    ]);

    // Set provider (default to ollama)
    const provider = currentSettings.provider || 'ollama';
    const radio = document.getElementById(`provider-${provider}`);
    if (radio) radio.checked = true;
    updateProviderUI(provider);

    // Ollama
    if (currentSettings.ollamaUrl) ollamaUrlInput.value = currentSettings.ollamaUrl;
    if (currentSettings.ollamaModel) ollamaModelInput.value = currentSettings.ollamaModel;

    // OpenRouter
    if (currentSettings.openrouterApiKey) {
      openrouterApiKeyInput.value = currentSettings.openrouterApiKey;
      updateOpenRouterStatus(true);
    } else {
      updateOpenRouterStatus(false);
    }

    // Default the OpenRouter model to Qwen3 Coder 480B if none is chosen yet,
    // and persist it so the background worker uses the same default. Guarded so
    // a load issue with recommendations.js can't abort the rest of loadSettings.
    const orDefault = (typeof DEFAULT_OPENROUTER_MODEL !== 'undefined') ? DEFAULT_OPENROUTER_MODEL : 'qwen/qwen3-coder';
    if (!currentSettings.openrouterModel) {
      currentSettings.openrouterModel = orDefault;
      await chrome.storage.local.set({ openrouterModel: orDefault });
    }
    showCurrentOpenRouterModel(currentSettings.openrouterModel);

    // Behavior
    if (currentSettings.defaultProfile) defaultProfileSelect.value = currentSettings.defaultProfile;
  }

  function updateProviderUI(provider) {
    // Highlight selected radio option
    document.querySelectorAll('.provider-option').forEach(el => {
      const input = el.querySelector('input');
      if (input) el.classList.toggle('selected', input.value === provider);
    });

    // Show/hide settings panels
    if (ollamaSettings) ollamaSettings.style.display = (provider === 'ollama') ? 'block' : 'none';
    if (openrouterSettings) openrouterSettings.style.display = (provider === 'openrouter') ? 'block' : 'none';
  }

  // Provider radio change
  providerRadios.forEach(radio => {
    radio.addEventListener('change', async () => {
      const provider = radio.value;
      await chrome.storage.local.set({ provider });
      updateProviderUI(provider);
    });
  });

  // Make the whole label clickable
  const ollamaLabel = document.getElementById('provider-ollama-label');
  const openrouterLabel = document.getElementById('provider-openrouter-label');
  if (ollamaLabel) ollamaLabel.addEventListener('click', () => {
    const r = document.getElementById('provider-ollama');
    if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
  });
  if (openrouterLabel) openrouterLabel.addEventListener('click', () => {
    const r = document.getElementById('provider-openrouter');
    if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
  });

  // ========== OLLAMA ==========
  if (btnTestOllama) btnTestOllama.addEventListener('click', async () => {
    const url = ollamaUrlInput.value.trim() || 'http://localhost:11434';
    const model = ollamaModelInput.value.trim() || 'llama3.1:latest';

    ollamaStatus.style.display = 'block';
    ollamaStatus.textContent = 'Testing connection...';
    ollamaStatus.className = 'status info';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testOllamaConnection',
        ollamaUrl: url,
        model: model
      });

      if (response.success && response.connected) {
        ollamaStatus.textContent = `✅ Connected! ${response.message || ''}`;
        ollamaStatus.className = 'status success';
      } else {
        ollamaStatus.textContent = `❌ ${response.message || response.error}`;
        ollamaStatus.className = 'status error';
      }
    } catch (err) {
      ollamaStatus.textContent = `❌ Test failed: ${err.message}`;
      ollamaStatus.className = 'status error';
    }
  });

  if (btnSaveOllama) btnSaveOllama.addEventListener('click', async () => {
    await chrome.storage.local.set({
      ollamaUrl: ollamaUrlInput.value.trim() || 'http://localhost:11434',
      ollamaModel: ollamaModelInput.value.trim() || 'llama3.1:latest'
    });
    ollamaStatus.style.display = 'block';
    ollamaStatus.textContent = '✅ Ollama settings saved.';
    ollamaStatus.className = 'status success';
    setTimeout(() => ollamaStatus.style.display = 'none', 2500);
  });

  // ========== OPENROUTER ==========
  function updateOpenRouterStatus(connected, message = '') {
    if (!openrouterStatus) return;
    if (connected) {
      openrouterStatus.textContent = `✅ Connected to OpenRouter ${message ? '• ' + message : ''}`;
      openrouterStatus.className = 'status success';
    } else {
      openrouterStatus.textContent = '⚠️ Not connected — please authenticate or paste an API key';
      openrouterStatus.className = 'status info';
    }
    openrouterStatus.style.display = 'block';
  }

  // Render the currently selected OpenRouter model, flagging recommended ones.
  // Annotate a raw model object with the _free / _reasons flags used by cards.
  function annotateModel(m) {
    let reasons = null;
    try { if (typeof getRecommendation === 'function') reasons = getRecommendation(m); } catch (_) {}
    let free = (m.id || '').toLowerCase().endsWith(':free');
    const p = m.pricing;
    // Only trust pricing when it actually carries values (empty {} means unknown).
    if (!free && p && (p.prompt !== undefined || p.completion !== undefined)) {
      try { if (typeof isFreeModel === 'function') free = isFreeModel(m); } catch (_) {}
    }
    return { ...m, _reasons: reasons, _free: free };
  }

  // Render the currently selected model as a full card under the Browse button.
  function showCurrentOpenRouterModel(modelId) {
    if (!currentOpenRouterModel || !currentModelCard) return;
    // Always show a model — fall back to the default. Guarded so a load issue
    // with recommendations.js can never blank out this display.
    const fallback = (typeof DEFAULT_OPENROUTER_MODEL !== 'undefined') ? DEFAULT_OPENROUTER_MODEL : 'qwen/qwen3-coder';
    const id = modelId || fallback;

    // Prefer full metadata if we already have it; otherwise synthesize from id.
    const known = allModels.find(m => m.id === id)
      || (modelsCache || []).map(annotateModel).find(m => m.id === id);
    const model = known || annotateModel({ id, name: id });

    renderSelectedCard(model);
    currentOpenRouterModel.style.display = 'block';

    // Best-effort: if we only had a synthesized card, fetch full details and re-render.
    if (!known) enrichSelectedModelCard(id);
  }

  function renderSelectedCard(model) {
    if (!currentModelCard) return;
    currentModelCard.innerHTML = '';
    const card = createModelCard(model, { selected: true });
    card.title = 'Click to change model';
    card.addEventListener('click', () => { if (btnBrowseModels) btnBrowseModels.click(); });
    currentModelCard.appendChild(card);
  }

  // Fetch full metadata for the selected model and re-render its card if found.
  async function enrichSelectedModelCard(id) {
    try {
      const models = await fetchOpenRouterModels();
      const full = models.find(m => m.id === id);
      // Only update if this is still the selected model.
      if (!full || currentSettings.openrouterModel !== id) return;
      renderSelectedCard(annotateModel(full));
    } catch (_) { /* offline / failed — keep the synthesized card */ }
  }

  // OAuth2 PKCE flow
  if (btnConnectOpenRouter) btnConnectOpenRouter.addEventListener('click', async () => {
    if (!openrouterStatus) return;
    openrouterStatus.style.display = 'block';
    openrouterStatus.textContent = 'Opening OpenRouter authentication...';
    openrouterStatus.className = 'status info';

    try {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      // OpenRouter redirects back here with ?code=... after the user authorizes.
      // chrome.identity.getRedirectURL() returns https://<ext-id>.chromiumapp.org/
      // which is https on port 443 — an allowed OpenRouter callback.
      const callbackUrl = chrome.identity.getRedirectURL();
      const authUrl = new URL('https://openrouter.ai/auth');
      authUrl.searchParams.set('callback_url', callbackUrl);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      const resultUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true
      });

      const code = new URL(resultUrl).searchParams.get('code');
      if (!code) {
        throw new Error('No authorization code returned from OpenRouter.');
      }

      // Exchange the authorization code for a user-controlled API key.
      openrouterStatus.textContent = 'Authorization received — exchanging for an API key...';
      openrouterStatus.className = 'status info';

      const exchangeResp = await fetch('https://openrouter.ai/api/v1/auth/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          code_challenge_method: 'S256'
        })
      });

      if (!exchangeResp.ok) {
        const errText = await exchangeResp.text();
        throw new Error(`Key exchange failed (HTTP ${exchangeResp.status}): ${errText}`);
      }

      const { key } = await exchangeResp.json();
      if (!key) throw new Error('OpenRouter did not return an API key.');

      await chrome.storage.local.set({ openrouterApiKey: key, provider: 'openrouter' });
      currentSettings.openrouterApiKey = key;
      openrouterApiKeyInput.value = key;
      updateOpenRouterStatus(true, 'Authenticated via OAuth');

      const r = document.getElementById('provider-openrouter');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
    } catch (err) {
      console.error(err);
      openrouterStatus.textContent = `OAuth flow failed: ${err.message}. You can paste an API key manually below.`;
      openrouterStatus.className = 'status error';
      chrome.tabs.create({ url: 'https://openrouter.ai/keys' });
    }
  });

  function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => ('0' + byte.toString(16)).slice(-2)).join('');
  }

  async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  if (btnSaveOpenRouterKey) btnSaveOpenRouterKey.addEventListener('click', async () => {
    const key = openrouterApiKeyInput.value.trim();
    if (!key) { alert('Please enter an API key'); return; }
    await chrome.storage.local.set({ openrouterApiKey: key, provider: 'openrouter' });
    updateOpenRouterStatus(true, 'Key saved');
    const r = document.getElementById('provider-openrouter');
    if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
  });

  if (btnBrowseModels) btnBrowseModels.addEventListener('click', async () => {
    // The models list endpoint is public — no API key required to browse it.
    if (!modelModal) return;

    modelModal.showModal();
    if (modelsLoading) modelsLoading.style.display = 'block';
    if (modelsGrid) modelsGrid.style.display = 'none';
    if (modelsError) modelsError.style.display = 'none';
    if (modelsGrid) modelsGrid.innerHTML = '';
    if (modelToolbar) modelToolbar.style.display = 'none';
    if (modelsCount) modelsCount.style.display = 'none';
    if (modelsEmpty) modelsEmpty.style.display = 'none';

    try {
      const models = await fetchOpenRouterModels();

      // Annotate with recommendation + free flags, then sort recommended-first.
      allModels = models.map(annotateModel);

      // Guarantee the currently selected model is always listed, even if the
      // API no longer returns it (renamed/removed), so it can be shown & pinned.
      const selId = currentSettings.openrouterModel;
      if (selId && !allModels.some(m => m.id === selId)) {
        allModels.push(annotateModel({
          id: selId,
          name: selId,
          description: 'Currently selected model.',
          pricing: {}
        }));
      }

      allModels.sort((a, b) => {
        // Currently selected model is pinned to the very top.
        const aSel = a.id === currentSettings.openrouterModel;
        const bSel = b.id === currentSettings.openrouterModel;
        if (aSel !== bSel) return aSel ? -1 : 1;
        // Then recommended models, then by context length.
        if (!!a._reasons !== !!b._reasons) return a._reasons ? -1 : 1;
        return (b.context_length || 0) - (a.context_length || 0);
      });

      // Populate autocomplete suggestions from model names.
      if (modelSuggestions) {
        modelSuggestions.innerHTML = '';
        allModels.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.name || m.id;
          modelSuggestions.appendChild(opt);
        });
      }

      // Reset filters for a predictable starting view.
      modelFilter.search = '';
      modelFilter.cost = 'all';
      modelFilter.quality = 'all';
      if (modelSearch) modelSearch.value = '';
      activateSeg(segCost, 'all');
      activateSeg(segQuality, 'all');

      if (modelsLoading) modelsLoading.style.display = 'none';
      if (modelToolbar) modelToolbar.style.display = 'flex';
      applyModelFilters();

      // Bring the currently selected model into view.
      const selectedCard = modelsGrid && modelsGrid.querySelector('.model-card.selected');
      if (selectedCard) selectedCard.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      if (modelsLoading) modelsLoading.style.display = 'none';
      if (modelsError) {
        modelsError.style.display = 'block';
        modelsError.textContent = `Failed to load models: ${err.message}`;
      }
    }
  });

  // Highlight which segmented button is active for a given filter value.
  function activateSeg(seg, value) {
    if (!seg) return;
    seg.querySelectorAll('button').forEach(b => {
      const v = b.dataset.cost || b.dataset.quality;
      b.classList.toggle('active', v === value);
    });
  }

  // Apply the active search + cost + quality filters and re-render.
  function applyModelFilters() {
    if (!modelsGrid) return;
    const { search, cost, quality } = modelFilter;

    const visible = allModels.filter(m => {
      if (cost === 'free' && !m._free) return false;
      if (cost === 'paid' && m._free) return false;
      if (quality === 'recommended' && !m._reasons) return false;
      if (search) {
        const hay = `${m.name || ''} ${m.id || ''} ${m.description || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    renderModelCards(visible);

    if (modelsCount) {
      modelsCount.style.display = 'block';
      modelsCount.textContent = `Showing ${visible.length} of ${allModels.length} models`;
    }
    if (modelsEmpty) modelsEmpty.style.display = visible.length ? 'none' : 'block';
    modelsGrid.style.display = visible.length ? 'grid' : 'none';
  }

  function renderModelCards(models) {
    if (!modelsGrid) return;
    modelsGrid.innerHTML = '';

    models.forEach(model => {
      const card = createModelCard(model);

      card.addEventListener('click', async () => {
        await chrome.storage.local.set({
          openrouterModel: model.id,
          provider: 'openrouter'
        });
        currentSettings.openrouterModel = model.id;
        showCurrentOpenRouterModel(model.id);

        document.querySelectorAll('#modelsGrid .model-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        setTimeout(() => {
          if (modelModal) modelModal.close();
        }, 300);
      });

      modelsGrid.appendChild(card);
    });
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', () => {
    if (modelModal) modelModal.close();
  });

  // Live text filter (autocomplete-backed)
  if (modelSearch) modelSearch.addEventListener('input', () => {
    modelFilter.search = modelSearch.value.trim().toLowerCase();
    applyModelFilters();
  });

  // Segmented "swoggle" toggles: cost (all/free/paid) and quality (all/recommended)
  function wireSeg(seg, key) {
    if (!seg) return;
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      modelFilter[key] = btn.dataset[key];
      activateSeg(seg, modelFilter[key]);
      applyModelFilters();
    });
  }
  wireSeg(segCost, 'cost');
  wireSeg(segQuality, 'quality');

  // ========== BEHAVIOR ==========
  if (btnSaveBehavior) btnSaveBehavior.addEventListener('click', async () => {
    await chrome.storage.local.set({ defaultProfile: defaultProfileSelect.value });
    const status = document.createElement('div');
    status.className = 'status success';
    status.textContent = '✅ Behavior settings saved.';
    btnSaveBehavior.parentNode.appendChild(status);
    setTimeout(() => status.remove(), 2200);
  });

  // Boot
  await loadSettings();
});