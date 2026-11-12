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
  const anthropicSettings = document.getElementById('anthropicSettings');
  const openaiSettings = document.getElementById('openaiSettings');

  // Ollama elements
  const ollamaUrlInput = document.getElementById('ollamaUrl');
  const ollamaModelInput = document.getElementById('ollamaModel');
  const btnTestOllama = document.getElementById('btnTestOllama');
  const btnSaveOllama = document.getElementById('btnSaveOllama');
  const ollamaStatus = document.getElementById('ollamaStatus');

  // OpenRouter elements
  const openrouterStatus = document.getElementById('openrouterStatus');
  const btnConnectOpenRouter = document.getElementById('btnConnectOpenRouter');
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
    const apiKey = currentSettings.openrouterApiKey;
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
      'anthropicApiKey', 'anthropicModel',
      'openaiApiKey', 'openaiModel',
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

    // Anthropic / OpenAI: show the masked saved key and load the live model list.
    CLOUD_PROVIDERS.forEach(cfg => initCloudProvider(cfg));

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
    if (anthropicSettings) anthropicSettings.style.display = (provider === 'anthropic') ? 'block' : 'none';
    if (openaiSettings) openaiSettings.style.display = (provider === 'openai') ? 'block' : 'none';
  }

  // Check a provider radio and show its card (used after saving a key).
  async function selectProvider(provider) {
    const r = document.getElementById(`provider-${provider}`);
    if (r) r.checked = true;
    currentSettings.provider = provider;
    await chrome.storage.local.set({ provider });
    updateProviderUI(provider);
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
  ['ollama', 'openrouter', 'anthropic', 'openai'].forEach(p => {
    const label = document.getElementById(`provider-${p}-label`);
    if (label) label.addEventListener('click', () => {
      const r = document.getElementById(`provider-${p}`);
      if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
    });
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
      openrouterStatus.textContent = '⚠️ Not connected — authenticate with OpenRouter to continue';
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

  // Render the currently selected model as a full card; clicking it opens the picker.
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
    card.title = 'Click to choose a different model';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-describedby', 'currentModelHelp');
    card.addEventListener('click', openModelPicker);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModelPicker(); }
    });
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
      updateOpenRouterStatus(true, 'Authenticated via OAuth');

      const r = document.getElementById('provider-openrouter');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
    } catch (err) {
      console.error(err);
      openrouterStatus.textContent = `OAuth flow failed: ${err.message}. Please try authenticating again.`;
      openrouterStatus.className = 'status error';
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

  // Open the model picker (triggered by clicking the selected-model card).
  async function openModelPicker() {
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
  }

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

  // ========== ANTHROPIC + OPENAI (API key) ==========
  // Both cards share one wiring: key input + show/hide + Save Key, and a model
  // <select> filled live from the provider's models API (SFCloudProviders).
  const CLOUD_PROVIDERS = [
    { id: 'anthropic', name: 'Anthropic', keyField: 'anthropicApiKey', modelField: 'anthropicModel' },
    { id: 'openai', name: 'OpenAI', keyField: 'openaiApiKey', modelField: 'openaiModel' }
  ];

  function showCloudStatus(el, text, kind, hideAfterMs) {
    if (!el) return;
    clearTimeout(el._hideTimer);
    el.textContent = text;
    el.className = `status cloud-status ${kind}`;
    el.style.display = 'block';
    if (hideAfterMs) el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, hideAfterMs);
  }

  function cloudEls(cfg) {
    const N = cfg.name;
    return {
      keyInput: document.getElementById(`${cfg.id}ApiKey`),
      keyState: document.getElementById(`${cfg.id}KeyState`),
      keyStatus: document.getElementById(`${cfg.id}KeyStatus`),
      btnToggle: document.getElementById(`btnToggle${N}Key`),
      btnSave: document.getElementById(`btnSave${N}Key`),
      select: document.getElementById(`${cfg.id}Model`),
      btnLoad: document.getElementById(`btnLoad${N}Models`),
      modelStatus: document.getElementById(`${cfg.id}ModelStatus`)
    };
  }

  function renderKeyState(cfg, els) {
    if (!els.keyState) return;
    const key = currentSettings[cfg.keyField];
    els.keyState.textContent = key
      ? `✅ Key saved (${SFCloudProviders.maskKey(key)})`
      : 'No key saved.';
    if (els.keyInput) {
      els.keyInput.placeholder = key ? `${SFCloudProviders.maskKey(key)} — paste a new key to replace` : (cfg.id === 'anthropic' ? 'sk-ant-…' : 'sk-…');
    }
  }

  function setSelectPlaceholder(select, text) {
    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = text;
    select.appendChild(opt);
  }

  async function loadCloudModels(cfg, els) {
    if (!els.select) return;
    const key = (els.keyInput && els.keyInput.value.trim()) || currentSettings[cfg.keyField];
    if (!key) {
      setSelectPlaceholder(els.select, 'Save an API key to load models');
      els.select.disabled = true;
      showCloudStatus(els.modelStatus, `Enter and save your ${cfg.name} API key first.`, 'info');
      return;
    }

    els.select.disabled = true;
    if (els.btnLoad) els.btnLoad.disabled = true;
    setSelectPlaceholder(els.select, 'Loading models…');
    showCloudStatus(els.modelStatus, `Loading models from ${cfg.name}…`, 'info');

    try {
      const models = await SFCloudProviders.fetchModels(cfg.id, key);
      const saved = currentSettings[cfg.modelField] || '';
      const selected = SFCloudProviders.pickDefaultModel(cfg.id, models, saved);

      els.select.innerHTML = '';
      if (!selected) {
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '— Select a model —';
        els.select.appendChild(ph);
      }
      if (saved && !models.some(m => m.id === saved)) {
        const missing = document.createElement('option');
        missing.value = saved;
        missing.textContent = `${saved} (saved; not in the current list)`;
        els.select.appendChild(missing);
      }
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        els.select.appendChild(opt);
      });
      els.select.value = selected;
      els.select.disabled = false;

      // Persist an automatic preselection (Anthropic only) so the background
      // worker uses what the page shows.
      if (selected && selected !== saved) {
        currentSettings[cfg.modelField] = selected;
        await chrome.storage.local.set({ [cfg.modelField]: selected });
      }

      if (!models.length) {
        showCloudStatus(els.modelStatus, `No usable models returned by ${cfg.name} for this key.`, 'error');
      } else {
        showCloudStatus(els.modelStatus,
          `✅ Loaded ${models.length} model${models.length === 1 ? '' : 's'}${selected ? '' : ' — pick one to use'}.`,
          'success', selected ? 2500 : 0);
      }
    } catch (err) {
      setSelectPlaceholder(els.select, 'Models unavailable');
      els.select.disabled = true;
      showCloudStatus(els.modelStatus, `❌ ${SFCloudProviders.describeError(err)}`, 'error');
    } finally {
      if (els.btnLoad) els.btnLoad.disabled = false;
    }
  }

  function wireCloudProvider(cfg) {
    const els = cloudEls(cfg);
    cfg.els = els;

    if (els.btnToggle && els.keyInput) els.btnToggle.addEventListener('click', () => {
      const show = els.keyInput.type === 'password';
      els.keyInput.type = show ? 'text' : 'password';
      els.btnToggle.textContent = show ? 'Hide' : 'Show';
      els.btnToggle.setAttribute('aria-pressed', String(show));
    });

    if (els.btnSave) els.btnSave.addEventListener('click', async () => {
      const key = els.keyInput ? els.keyInput.value.trim() : '';
      if (!key) {
        showCloudStatus(els.keyStatus, `Paste your ${cfg.name} API key first.`, 'error');
        return;
      }
      currentSettings[cfg.keyField] = key;
      await chrome.storage.local.set({ [cfg.keyField]: key });
      await selectProvider(cfg.id);
      els.keyInput.value = '';
      els.keyInput.type = 'password';
      if (els.btnToggle) { els.btnToggle.textContent = 'Show'; els.btnToggle.setAttribute('aria-pressed', 'false'); }
      renderKeyState(cfg, els);
      showCloudStatus(els.keyStatus, `✅ ${cfg.name} key saved. ${cfg.name} is now the active provider.`, 'success', 3000);
      await loadCloudModels(cfg, els);
    });

    if (els.btnLoad) els.btnLoad.addEventListener('click', () => loadCloudModels(cfg, els));

    if (els.select) els.select.addEventListener('change', async () => {
      const model = els.select.value;
      if (!model) return;
      currentSettings[cfg.modelField] = model;
      await chrome.storage.local.set({ [cfg.modelField]: model });
      showCloudStatus(els.modelStatus, `✅ Model saved: ${model}`, 'success', 2000);
    });
  }

  function initCloudProvider(cfg) {
    const els = cfg.els || cloudEls(cfg);
    renderKeyState(cfg, els);
    // Don't block the rest of page boot on a network call.
    if (currentSettings[cfg.keyField]) loadCloudModels(cfg, els);
  }

  if (typeof SFCloudProviders !== 'undefined') {
    CLOUD_PROVIDERS.forEach(wireCloudProvider);
  } else {
    CLOUD_PROVIDERS.length = 0; // helper script missing: leave the cards inert
  }

  // ========== BEHAVIOR ==========
  // ========== KEYBOARD SHORTCUTS ==========
  // Recorders for SFHotkeys combos (direct + chord); content.js picks changes up via storage.onChanged.
  const hotkeyList = document.getElementById('hotkeyList');
  const chordList = document.getElementById('chordList');
  const chordEnabled = document.getElementById('chordEnabled');
  const hotkeyStatus = document.getElementById('hotkeyStatus');
  const btnResetHotkeys = document.getElementById('btnResetHotkeys');
  let hotkeySettings = null;
  let stopRecording = null;

  function showHotkeyStatus(text, kind) {
    if (!hotkeyStatus) return;
    hotkeyStatus.textContent = text;
    hotkeyStatus.className = 'status ' + kind;
    hotkeyStatus.style.display = 'inline-block';
    clearTimeout(showHotkeyStatus._t);
    showHotkeyStatus._t = setTimeout(() => { hotkeyStatus.style.display = 'none'; }, 3500);
  }

  async function saveHotkeys(next) {
    hotkeySettings = next;
    await chrome.storage.local.set({ [SFHotkeys.STORAGE_KEY]: next });
    renderHotkeys();
  }

  function withChord(patch) {
    return Object.assign({}, hotkeySettings, { chord: Object.assign({}, hotkeySettings.chord, patch) });
  }

  // Which setting already uses this combo (direct shortcuts + chord leader), excluding `self`.
  function comboClash(combo, self) {
    const H = SFHotkeys;
    const owners = Object.keys(H.ACTIONS).map(a => ({ id: a, combo: hotkeySettings[a], name: H.ACTIONS[a].label }));
    if (hotkeySettings.chord.enabled) owners.push({ id: 'leader', combo: hotkeySettings.chord.leader, name: 'Chord leader' });
    const hit = owners.find(o => o.id !== self && H.same(o.combo, combo));
    return hit ? hit.name : null;
  }

  function hotkeyRow(container, opts) {
    const row = document.createElement('div');
    row.className = 'hotkey-row';
    const text = document.createElement('div');
    const name = document.createElement('div'); name.className = 'hk-name'; name.textContent = opts.name;
    const help = document.createElement('div'); help.className = 'hk-help'; help.textContent = opts.help;
    text.appendChild(name); text.appendChild(help);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary hotkey-btn' + (opts.value ? '' : ' off');
    btn.setAttribute('data-hotkey', opts.id);
    btn.textContent = opts.value || opts.emptyText || 'Off';
    btn.title = opts.single ? 'Click, then press a single key' : 'Click, then press a new shortcut';
    btn.disabled = !!opts.disabled;
    btn.addEventListener('click', () => startRecording(btn, opts));
    if (opts.autoRecord) setTimeout(() => { btn.focus(); startRecording(btn, opts); }, 0);
    row.appendChild(text); row.appendChild(btn);
    container.appendChild(row);
  }

  function renderHotkeys() {
    if (!hotkeyList || typeof SFHotkeys === 'undefined') return;
    const H = SFHotkeys, chord = hotkeySettings.chord;
    hotkeyList.innerHTML = '';
    Object.keys(H.ACTIONS).forEach(action => {
      const combo = hotkeySettings[action];
      hotkeyRow(hotkeyList, {
        id: action, name: H.ACTIONS[action].label, help: H.ACTIONS[action].help,
        value: combo ? H.label(combo) : '',
        onCombo: (c) => {
          const clash = comboClash(c, action);
          if (clash) return H.label(c) + ' is already used for “' + clash + '”';
          return saveHotkeys(Object.assign({}, hotkeySettings, { [action]: c }));
        },
        onClear: () => saveHotkeys(Object.assign({}, hotkeySettings, { [action]: null }))
      });
    });

    if (!chordList) return;
    const pending = renderHotkeys.pendingLeader;
    renderHotkeys.pendingLeader = false;
    const active = chord.enabled || pending;
    if (chordEnabled) chordEnabled.checked = active;
    chordList.innerHTML = '';
    chordList.classList.toggle('disabled', !active);
    hotkeyRow(chordList, {
      id: 'leader', name: 'Chord leader', disabled: !active, autoRecord: pending,
      help: 'Press this first — the ✨ form icon turns amber and waits for the next key.',
      value: chord.leader ? H.label(chord.leader) : '',
      emptyText: 'Not set',
      onCombo: (c) => {
        const clash = comboClash(c, 'leader');
        if (clash) return H.label(c) + ' is already used for “' + clash + '”';
        return saveHotkeys(withChord({ leader: c, enabled: true }));
      },
      // No leader → no chord.
      onClear: () => saveHotkeys(withChord({ leader: null, enabled: false }))
    });
    Object.keys(H.ACTIONS).forEach(action => {
      const code = chord.keys[action];
      hotkeyRow(chordList, {
        id: 'chord-' + action, single: true, disabled: !chord.enabled,
        name: 'then ' + H.ACTIONS[action].label,
        help: chord.leader ? 'Key pressed after ' + H.label(chord.leader) + '.' : 'Key pressed after the leader.',
        value: code ? H.chordKeyLabel(code) : '',
        onKey: (k) => {
          const other = Object.keys(chord.keys).find(a => a !== action && chord.keys[a] === k);
          if (other) return H.chordKeyLabel(k) + ' is already used for “' + H.ACTIONS[other].label + '”';
          return saveHotkeys(withChord({ keys: Object.assign({}, chord.keys, { [action]: k }) }));
        },
        onClear: () => saveHotkeys(withChord({ keys: Object.assign({}, chord.keys, { [action]: null }) }))
      });
    });
  }

  // opts.single → record one plain key (chord step); otherwise a modifier combo.
  // onCombo/onKey return an error string to reject, or a promise once saved.
  function startRecording(btn, opts) {
    if (stopRecording) stopRecording();
    btn.classList.add('recording');
    btn.textContent = opts.single ? 'Press a key…' : 'Press keys…';
    const onKey = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { stop(); renderHotkeys(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        stop();
        await opts.onClear();
        showHotkeyStatus(opts.name + ' turned off', 'info');
        return;
      }
      let result, shown;
      if (opts.single) {
        if (/^(Control|Alt|Shift|Meta|OS)/.test(e.code)) return;
        if (e.ctrlKey || e.altKey || e.metaKey || !SFHotkeys.isValidChordKey(e.code)) {
          showHotkeyStatus('Use a single letter, digit or F-key with no modifiers', 'error');
          return;
        }
        shown = SFHotkeys.chordKeyLabel(e.code);
        result = opts.onKey(e.code);
      } else {
        const combo = SFHotkeys.fromEvent(e);
        if (!combo) { btn.textContent = SFHotkeys.label({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: '…' }); return; }
        if (!SFHotkeys.isValid(combo)) {
          showHotkeyStatus('Include Ctrl, Alt or ⌘ (or use F1–F24) so typing isn’t hijacked', 'error');
          return;
        }
        shown = SFHotkeys.label(combo);
        result = opts.onCombo(combo);
      }
      if (typeof result === 'string') { showHotkeyStatus(result, 'error'); return; }
      stop();
      await result;
      showHotkeyStatus(opts.name + ': ' + shown, 'success');
    };
    const onBlur = () => { stop(); renderHotkeys(); };
    function stop() {
      window.removeEventListener('keydown', onKey, true);
      btn.removeEventListener('blur', onBlur);
      btn.classList.remove('recording');
      stopRecording = null;
    }
    window.addEventListener('keydown', onKey, true);
    btn.addEventListener('blur', onBlur);
    stopRecording = stop;
  }

  if (chordEnabled) chordEnabled.addEventListener('change', async () => {
    const enabled = chordEnabled.checked;
    if (enabled && !hotkeySettings.chord.leader) {
      // Choose the leader first; the chord is saved as enabled once it's recorded.
      renderChordPendingLeader();
      showHotkeyStatus('Press the chord keys, e.g. Ctrl+Shift+F', 'info');
      return;
    }
    if (enabled && hotkeySettings.chord.leader) {
      const clash = Object.keys(SFHotkeys.ACTIONS).find(a => SFHotkeys.same(hotkeySettings[a], hotkeySettings.chord.leader));
      if (clash) {
        chordEnabled.checked = false;
        showHotkeyStatus('Chord leader ' + SFHotkeys.label(hotkeySettings.chord.leader) + ' clashes with “' +
          SFHotkeys.ACTIONS[clash].label + '” — change one first', 'error');
        return;
      }
    }
    await saveHotkeys(withChord({ enabled }));
    showHotkeyStatus(enabled ? 'Chord shortcut enabled' : 'Chord shortcut disabled', 'info');
  });

  function renderChordPendingLeader() {
    renderHotkeys.pendingLeader = true;
    renderHotkeys();
  }

  if (btnResetHotkeys) btnResetHotkeys.addEventListener('click', async () => {
    if (stopRecording) stopRecording();
    await saveHotkeys(SFHotkeys.resolve(null));
    showHotkeyStatus('Shortcuts reset to defaults', 'success');
  });

  (async function initHotkeys() {
    if (typeof SFHotkeys === 'undefined') return;
    const stored = await chrome.storage.local.get([SFHotkeys.STORAGE_KEY]);
    hotkeySettings = SFHotkeys.resolve(stored[SFHotkeys.STORAGE_KEY]);
    renderHotkeys();
  })();

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

  // ========== PROFILE MANAGER ==========
  let profiles = [];
  let currentEditId = null;

  // Load profiles from storage, fallback to defaults
  async function loadProfiles() {
    const stored = await chrome.storage.local.get(['profiles']);
    profiles = stored.profiles || (typeof SFFormData !== 'undefined' ? SFFormData.DEFAULT_PROFILES : []);
  }

  // Persist profiles to chrome.storage.local
  async function persistProfiles() {
    await chrome.storage.local.set({ profiles });
  }

  // Render the profile list
  function renderList() {
    const profileList = document.getElementById('profileList');
    if (!profileList) return;
    profileList.innerHTML = '';

    profiles.forEach(profile => {
      const li = document.createElement('li');
      li.className = 'profile-row';

      const nameBtn = document.createElement('button');
      nameBtn.textContent = profile.label || profile.id;
      nameBtn.className = 'btn btn-secondary';
      nameBtn.style.flex = '1';
      nameBtn.addEventListener('click', () => renderEditor(profile.id));

      const cloneBtn = document.createElement('button');
      cloneBtn.textContent = 'Clone';
      cloneBtn.className = 'btn btn-secondary';
      cloneBtn.style.fontSize = '12px';
      cloneBtn.addEventListener('click', async () => {
        const r = SFFormData.profilesClone(profiles, profile.id);
        profiles = r.profiles;
        await persistProfiles();
        renderList();
        renderEditor(r.id);
      });

      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Rename';
      renameBtn.className = 'btn btn-secondary';
      renameBtn.style.fontSize = '12px';
      renameBtn.addEventListener('click', async () => {
        const newLabel = prompt('New profile name:', profile.label || profile.id);
        if (newLabel) {
          profiles = SFFormData.profilesRename(profiles, profile.id, newLabel);
          await persistProfiles();
          renderList();
          renderEditor(profile.id);
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'btn btn-secondary';
      deleteBtn.style.fontSize = '12px';
      deleteBtn.style.color = 'var(--danger)';
      deleteBtn.addEventListener('click', async () => {
        if (confirm(`Delete "${profile.label || profile.id}"?`)) {
          profiles = SFFormData.profilesDelete(profiles, profile.id);
          await persistProfiles();
          if (currentEditId === profile.id) {
            currentEditId = null;
            hideEditor();
          }
          renderList();
        }
      });

      li.appendChild(nameBtn);
      li.appendChild(cloneBtn);
      li.appendChild(renameBtn);
      li.appendChild(deleteBtn);
      profileList.appendChild(li);
    });
  }

  // Hide the editor and show "no profile selected" message
  function hideEditor() {
    const editor = document.getElementById('profileEditor');
    const noSelected = document.getElementById('noProfileSelected');
    if (editor) editor.style.display = 'none';
    if (noSelected) noSelected.style.display = 'block';
    currentEditId = null;
  }

  // ── Form-specific profile editor ─────────────────────────────────────────

  // Render the value/action cell for a field row.
  function _renderValueCell(td, profile, idx, field) {
    td.innerHTML = '';
    if (!field) return;
    if (field.mode === 'pinned') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = field.value || '';
      input.style.cssText = 'padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 4px; width: 150px;';
      input.addEventListener('change', function () {
        window.updateFieldValue(profile.id, idx, input.value);
      });
      td.appendChild(input);
    } else if (field.mode === 'generated') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.fontSize = '12px';
      btn.textContent = 'Preview';
      btn.addEventListener('click', function () {
        const preview = window.previewGeneratedValue(field.detectedType || field.name);
        btn.textContent = 'Preview: ' + preview;
      });
      td.appendChild(btn);
    } else {
      td.textContent = '—';
    }
  }

  // Render the form-specific profile editor section.
  function renderFormSpecificProfileEditor(profile) {
    const formSection = document.getElementById('formSpecificProfileSection');
    const editor = document.getElementById('profileEditor');
    const noSelected = document.getElementById('noProfileSelected');

    if (editor) { editor.innerHTML = ''; editor.style.display = 'none'; }
    if (noSelected) noSelected.style.display = 'none';
    if (!formSection) return;

    formSection.style.display = 'block';

    // Populate header metadata
    const labelEl = document.getElementById('formProfileLabel');
    const urlEl = document.getElementById('formProfileUrl');
    const capturedAtEl = document.getElementById('formProfileCapturedAt');
    if (labelEl) labelEl.textContent = profile.label || profile.id;
    if (urlEl) urlEl.textContent = (profile.formMetadata && profile.formMetadata.urlPattern) || '';
    if (capturedAtEl) capturedAtEl.textContent = (profile.formMetadata && profile.formMetadata.capturedAt) || '';

    // Render fields table
    const tbody = formSection.querySelector('#formFieldsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const fields = profile.fields || [];
    fields.forEach(function (field, idx) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border)';

      // Field Name
      const tdName = document.createElement('td');
      tdName.style.padding = '8px';
      tdName.textContent = field.name;

      // HTML Type
      const tdType = document.createElement('td');
      tdType.style.padding = '8px';
      tdType.textContent = field.htmlType || '';

      // Mode dropdown
      const tdMode = document.createElement('td');
      tdMode.style.padding = '8px';
      const modeSelect = document.createElement('select');
      modeSelect.dataset.fieldIndex = String(idx);
      ['generated', 'pinned', 'empty', 'excluded'].forEach(function (mode) {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = mode;
        if (field.mode === mode) opt.selected = true;
        modeSelect.appendChild(opt);
      });
      modeSelect.addEventListener('change', function () {
        window.updateFieldMode(profile.id, idx, modeSelect.value);
      });
      tdMode.appendChild(modeSelect);

      // Value / Action cell
      const tdValue = document.createElement('td');
      tdValue.style.padding = '8px';
      tdValue.setAttribute('data-value-cell', String(idx));
      _renderValueCell(tdValue, profile, idx, field);

      tr.appendChild(tdName);
      tr.appendChild(tdType);
      tr.appendChild(tdMode);
      tr.appendChild(tdValue);
      tbody.appendChild(tr);
    });
  }

  // Update a field's mode, patch the in-memory profiles, and refresh the value cell.
  window.updateFieldMode = function (profileId, fieldIndex, newMode) {
    const idx = Number(fieldIndex);
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    const fields = (profile.fields || []).slice();
    if (!fields[idx]) return;
    fields[idx] = Object.assign({}, fields[idx], { mode: newMode });
    profiles = SFFormData.profilePatch(profiles, profileId, { fields: fields });
    // Refresh the value cell in the DOM
    const tdValue = document.querySelector('[data-value-cell="' + idx + '"]');
    const updated = profiles.find(p => p.id === profileId);
    if (tdValue && updated) _renderValueCell(tdValue, updated, idx, fields[idx]);
  };

  // Update a pinned field's value in the in-memory profiles.
  window.updateFieldValue = function (profileId, fieldIndex, newValue) {
    const idx = Number(fieldIndex);
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    const fields = (profile.fields || []).slice();
    if (!fields[idx]) return;
    fields[idx] = Object.assign({}, fields[idx], { value: newValue });
    profiles = SFFormData.profilePatch(profiles, profileId, { fields: fields });
  };

  // Return a preview sample for a detected field type using SFFormData.
  window.previewGeneratedValue = function (detectedType) {
    if (typeof SFFormData !== 'undefined' && SFFormData.generateCustomFieldValue) {
      return SFFormData.generateCustomFieldValue(detectedType) || '(chosen by AI at fill time)';
    }
    return '';
  };

  // Stub: adding fields to a captured form profile is not yet implemented (Task 6+).
  window.addFieldToFormProfile = function () {
    alert('Not yet implemented');
  };

  // Delete the currently open form-specific profile and return to the list.
  window.deleteFormProfile = function () {
    if (!currentEditId) return;
    if (!confirm('Delete this form profile?')) return;
    profiles = SFFormData.profilesDelete(profiles, currentEditId);
    currentEditId = null;
    persistProfiles().then(function () {
      const formSection = document.getElementById('formSpecificProfileSection');
      if (formSection) formSection.style.display = 'none';
      const noSelected = document.getElementById('noProfileSelected');
      if (noSelected) noSelected.style.display = 'block';
      renderList();
    });
  };

  // Persist any in-memory edits to chrome storage.
  window.saveFormProfile = function () {
    persistProfiles().then(function () {
      const status = document.createElement('div');
      status.className = 'status success';
      status.textContent = 'Form profile saved.';
      const formSection = document.getElementById('formSpecificProfileSection');
      if (formSection) {
        formSection.appendChild(status);
        setTimeout(function () { status.remove(); }, 2000);
      }
    });
  };

  // ── End form-specific editor ──────────────────────────────────────────────

  // Render the profile editor
  function renderEditor(id) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    currentEditId = id;

    // Always hide the form-specific section before deciding which editor to show
    const formSection = document.getElementById('formSpecificProfileSection');
    if (formSection) formSection.style.display = 'none';

    // Form-specific profiles have a dedicated editor
    if (profile.formMetadata) {
      renderFormSpecificProfileEditor(profile);
      return;
    }

    const editor = document.getElementById('profileEditor');
    const noSelected = document.getElementById('noProfileSelected');
    if (!editor) return;

    editor.innerHTML = '';
    editor.style.display = 'block';
    if (noSelected) noSelected.style.display = 'none';

    // Country selector
    const countryWrap = document.createElement('div');
    countryWrap.style.cssText = 'margin-bottom: 20px;';
    const countryLabel = document.createElement('label');
    countryLabel.textContent = 'Country';
    countryLabel.style.display = 'block';
    const countrySelect = document.createElement('select');
    countrySelect.style.cssText = 'width: 100%; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 8px; margin-bottom: 0;';

    if (typeof SFAddress !== 'undefined') {
      const countries = SFAddress.listCountries();
      countries.forEach(country => {
        const opt = document.createElement('option');
        opt.value = country.code;
        opt.textContent = country.label;
        if (profile.country === country.code) opt.selected = true;
        countrySelect.appendChild(opt);
      });
    }

    countrySelect.addEventListener('change', async () => {
      profiles = SFFormData.profilePatch(profiles, id, { country: countrySelect.value });
      await persistProfiles();
      // Re-render address fields
      renderAddressFieldsInEditor();
    });

    countryWrap.appendChild(countryLabel);
    countryWrap.appendChild(countrySelect);
    editor.appendChild(countryWrap);

    // Group toggles (name, contact, address, account, misc)
    if (typeof SFFormData !== 'undefined') {
      const groupsWrap = document.createElement('div');
      groupsWrap.style.cssText = 'margin-bottom: 20px;';
      const groupsLabel = document.createElement('label');
      groupsLabel.textContent = 'Field Groups';
      groupsLabel.style.display = 'block';
      groupsLabel.style.marginBottom = '12px';
      groupsWrap.appendChild(groupsLabel);

      const policy = profile.policy || {};
      const groups = policy.groups || {};
      Object.keys(SFFormData.FIELD_GROUPS).forEach(groupKey => {
        const toggle = document.createElement('div');
        toggle.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `group-${groupKey}`;
        checkbox.checked = groups[groupKey] !== false;
        checkbox.addEventListener('change', async () => {
          const newPolicy = {
            ...policy,
            groups: { ...groups, [groupKey]: checkbox.checked }
          };
          profiles = SFFormData.profilePatch(profiles, id, { policy: newPolicy });
          await persistProfiles();
        });
        const label = document.createElement('label');
        label.htmlFor = `group-${groupKey}`;
        label.textContent = groupKey;
        label.style.marginBottom = '0';
        toggle.appendChild(checkbox);
        toggle.appendChild(label);
        groupsWrap.appendChild(toggle);
      });
      editor.appendChild(groupsWrap);
    }

    // Address fields container
    const addrWrap = document.createElement('div');
    addrWrap.style.cssText = 'margin-bottom: 20px;';
    const addrLabel = document.createElement('label');
    addrLabel.textContent = 'Address Fields';
    addrLabel.style.display = 'block';
    addrLabel.style.marginBottom = '12px';
    addrWrap.appendChild(addrLabel);
    const addrContainer = document.createElement('div');
    addrContainer.id = 'addrFieldsContainer';
    addrWrap.appendChild(addrContainer);
    editor.appendChild(addrWrap);

    // Function to render address fields with exclude/pin controls
    function renderAddressFieldsInEditor() {
      const addrContainer = document.getElementById('addrFieldsContainer');
      if (!addrContainer || typeof SFProfileUI === 'undefined') return;
      const country = countrySelect.value || profile.country || 'AU';

      // Clear and render base address fields
      SFProfileUI.renderAddressFields(document, addrContainer, country);

      // Wrap each field with exclude checkbox and pin input
      const policy = profile.policy || {};
      const exclude = policy.exclude || [];
      const pins = profile.pins || {};

      Array.from(addrContainer.querySelectorAll('[data-field]')).forEach(input => {
        const fieldKey = input.getAttribute('data-field');
        const wrap = input.parentElement;
        wrap.style.cssText = 'margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border);';

        // Exclude checkbox
        const excludeWrap = document.createElement('div');
        excludeWrap.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 13px;';
        const excludeCheckbox = document.createElement('input');
        excludeCheckbox.type = 'checkbox';
        excludeCheckbox.id = `exclude-${fieldKey}`;
        excludeCheckbox.checked = exclude.indexOf(fieldKey) !== -1;
        excludeCheckbox.addEventListener('change', async () => {
          const newExclude = excludeCheckbox.checked
            ? (exclude.indexOf(fieldKey) === -1 ? [...exclude, fieldKey] : exclude)
            : exclude.filter(k => k !== fieldKey);
          const newPolicy = { ...policy, exclude: newExclude };
          profiles = SFFormData.profilePatch(profiles, id, { policy: newPolicy });
          await persistProfiles();
        });
        const excludeLabel = document.createElement('label');
        excludeLabel.htmlFor = `exclude-${fieldKey}`;
        excludeLabel.textContent = 'Exclude from fill';
        excludeLabel.style.marginBottom = '0';
        excludeWrap.appendChild(excludeCheckbox);
        excludeWrap.appendChild(excludeLabel);
        wrap.appendChild(excludeWrap);

        // Pin input
        const pinWrap = document.createElement('div');
        pinWrap.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 6px;';
        const pinLabel = document.createElement('label');
        pinLabel.htmlFor = `pin-${fieldKey}`;
        pinLabel.textContent = 'Pin value:';
        pinLabel.style.cssText = 'font-size: 13px; margin-bottom: 0; min-width: 80px;';
        const pinInput = document.createElement('input');
        pinInput.type = 'text';
        pinInput.id = `pin-${fieldKey}`;
        pinInput.value = pins[fieldKey] || '';
        pinInput.style.cssText = 'flex: 1; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 13px; margin-bottom: 0;';
        pinInput.addEventListener('change', async () => {
          const newPins = { ...pins, [fieldKey]: pinInput.value };
          profiles = SFFormData.profilePatch(profiles, id, { pins: newPins });
          await persistProfiles();
        });
        pinWrap.appendChild(pinLabel);
        pinWrap.appendChild(pinInput);
        wrap.appendChild(pinWrap);
      });
    }

    // Initial render of address fields
    renderAddressFieldsInEditor();
  }

  // Wire up new profile button
  const newProfileBtn = document.getElementById('newProfileBtn');
  if (newProfileBtn) {
    newProfileBtn.addEventListener('click', async () => {
      const r = SFFormData.profilesCreate(profiles, 'New Profile');
      profiles = r.profiles;
      await persistProfiles();
      renderList();
      renderEditor(r.id);
    });
  }

  // Initial load and render
  await loadProfiles();
  renderList();
  hideEditor();

  // Expose a minimal test handle so unit tests can introspect internal state.
  window.__sfOptions = {
    getProfiles: function () { return profiles; },
    renderEditor: renderEditor
  };
});

// ──────────────────────────────────────────────────────────────────────────────
// Form-specific profile editor — window.* exports (test-friendly)
//
// This IIFE runs at script-evaluation time (outside DOMContentLoaded) so
// unit tests running under jsdom can call these functions without the DOM
// lifecycle ever firing.  In production:
//   • window.renderFormSpecificProfileEditor stays as defined here (the DOM
//     handler calls the local renderFormSpecificProfileEditor instead).
//   • window.updateFieldMode is overridden by the DOMContentLoaded handler
//     with a version that closes over the live `profiles` array.
// ──────────────────────────────────────────────────────────────────────────────
;(function () {
  'use strict';

  /**
   * renderFormSpecificProfileEditor(profile, opts)
   *
   * opts.mockRender = true  → return an HTML string (for unit tests, no DOM access)
   * otherwise               → inject into #formSpecificProfileSection
   *
   * Exposed as window.renderFormSpecificProfileEditor so tests can reach it
   * without waiting for DOMContentLoaded.
   */
  window.renderFormSpecificProfileEditor = function (profile, opts) {
    opts = opts || {};
    if (!profile) return opts.mockRender ? '' : null;

    var fields = profile.fields || [];

    var rowsHtml = fields.map(function (field) {
      var modes = ['pinned', 'generated', 'empty', 'excluded'];
      var modeOptions = modes.map(function (m) {
        return '<option value="' + m + '"' + (field.mode === m ? ' selected' : '') + '>' + m + '</option>';
      }).join('');

      var actionHtml;
      var fId   = (profile.id      || '').replace(/'/g, "\\'");
      var fName = (field.htmlName  || '').replace(/'/g, "\\'");
      if (field.mode === 'pinned') {
        var safeVal = (field.value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        actionHtml = '<input type="text" value="' + safeVal + '" ' +
          'onchange="window.updateFieldValue(\'' + fId + '\',\'' + fName + '\',this.value)" ' +
          'style="padding:4px 8px;border:1px solid var(--border-strong);border-radius:4px;width:150px;" />';
      } else if (field.mode === 'generated') {
        var dt = (field.detectedType || field.htmlName || '').replace(/'/g, "\\'");
        actionHtml = '<button onclick="window.previewGeneratedValue(\'' + dt + '\')">Preview</button>';
      } else {
        actionHtml = '—';
      }

      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:8px;">' + (field.htmlName || '') + '</td>' +
        '<td style="padding:8px;">' + (field.htmlType  || '') + '</td>' +
        '<td style="padding:8px;">' +
          '<select onchange="window.updateFieldMode(\'' + fId + '\',\'' + fName + '\',this.value)" style="padding:4px;">' +
            modeOptions +
          '</select>' +
        '</td>' +
        '<td style="padding:8px;">' + actionHtml + '</td>' +
        '</tr>';
    }).join('');

    var metaHtml = '';
    if (profile.formMetadata) {
      var urlPat = profile.formMetadata.urlPattern || '';
      var cap    = profile.formMetadata.capturedAt;
      metaHtml =
        '<p style="font-size:13px;margin:0 0 12px;">' +
          '<strong>Form URL:</strong> <code>' + urlPat + '</code>' +
          (cap ? '<br/><strong>Captured:</strong> ' + new Date(cap).toLocaleString() : '') +
        '</p>';
    }

    var html =
      '<h3 style="font-size:15px;font-weight:600;margin:0 0 12px;">Form-Specific Profile: ' +
        (profile.label || '') + '</h3>' +
      metaHtml +
      '<h4 style="font-size:13px;font-weight:600;margin:0 0 8px;">Fields</h4>' +
      '<table id="formFieldsTable" style="width:100%;border-collapse:collapse;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);">' +
          '<th style="padding:8px;text-align:left;">Field Name</th>' +
          '<th style="padding:8px;text-align:left;">HTML Type</th>' +
          '<th style="padding:8px;text-align:left;">Mode</th>' +
          '<th style="padding:8px;text-align:left;">Value / Action</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
      '<div style="margin-top:15px;">' +
        '<button onclick="window.deleteFormProfile()" ' +
          'style="background:var(--error-bg);color:var(--error-fg);border:1px solid var(--error-border);padding:6px 12px;border-radius:6px;cursor:pointer;margin-right:8px;">' +
          'Delete Profile</button>' +
        '<button onclick="window.saveFormProfile()" ' +
          'style="background:var(--primary);color:var(--on-primary);border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">' +
          'Save</button>' +
      '</div>';

    if (opts.mockRender) return html;

    // DOM mode — inject into the placeholder div
    var sec = (typeof document !== 'undefined') && document.getElementById('formSpecificProfileSection');
    if (sec) {
      sec.innerHTML = html;
      sec.style.display = 'block';
    }
    return null;
  };

  /**
   * updateFieldMode(profileOrId, htmlNameOrIndex, newMode)
   *
   * Pure form (used by unit tests):
   *   profileOrId      = profile object
   *   htmlNameOrIndex  = htmlName string
   *   → returns a new profile with the named field's mode updated (non-mutating);
   *     clears `value` when newMode !== 'pinned'.
   *
   * DOM form (set by the DOMContentLoaded handler in production):
   *   profileOrId      = profileId string
   *   htmlNameOrIndex  = field index number
   *   → updates in-memory `profiles` and refreshes the value cell in the table.
   *
   * The DOMContentLoaded handler overwrites this assignment in production.  The
   * version below is the fallback used in tests (where DOMContentLoaded never fires).
   */
  window.updateFieldMode = function (profileOrId, htmlNameOrIndex, newMode) {
    // Pure mode: first argument is a profile object
    if (typeof profileOrId === 'object' && profileOrId !== null) {
      var profile  = profileOrId;
      var htmlName = htmlNameOrIndex;
      return Object.assign({}, profile, {
        fields: (profile.fields || []).map(function (f) {
          if (f.htmlName !== htmlName) return f;
          var updated = Object.assign({}, f, { mode: newMode });
          if (newMode !== 'pinned') delete updated.value;
          return updated;
        })
      });
    }
    // DOM stub — overridden in production by DOMContentLoaded handler
    return null;
  };

})();