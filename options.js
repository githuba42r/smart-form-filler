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
      li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: #f1f5f9; border-radius: 8px; gap: 8px;';

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
      deleteBtn.style.color = '#991b1b';
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
      input.style.cssText = 'padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 4px; width: 150px;';
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
    if (urlEl) urlEl.textContent = (profile.formMetadata && profile.formMetadata.url) || '';
    if (capturedAtEl) capturedAtEl.textContent = (profile.formMetadata && profile.formMetadata.capturedAt) || '';

    // Render fields table
    const tbody = formSection.querySelector('#formFieldsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const fields = profile.fields || [];
    fields.forEach(function (field, idx) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #eee';

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
      return SFFormData.generateCustomFieldValue(detectedType);
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
    countrySelect.style.cssText = 'width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 0;';

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
        wrap.style.cssText = 'margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;';

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
        pinInput.style.cssText = 'flex: 1; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; margin-bottom: 0;';
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
          'style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:4px;width:150px;" />';
      } else if (field.mode === 'generated') {
        var dt = (field.detectedType || field.htmlName || '').replace(/'/g, "\\'");
        actionHtml = '<button onclick="window.previewGeneratedValue(\'' + dt + '\')">Preview</button>';
      } else {
        actionHtml = '—';
      }

      return '<tr style="border-bottom:1px solid #eee;">' +
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
      var urlPat = profile.formMetadata.urlPattern || profile.formMetadata.url || '';
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
        '<thead><tr style="border-bottom:1px solid #ccc;">' +
          '<th style="padding:8px;text-align:left;">Field Name</th>' +
          '<th style="padding:8px;text-align:left;">HTML Type</th>' +
          '<th style="padding:8px;text-align:left;">Mode</th>' +
          '<th style="padding:8px;text-align:left;">Value / Action</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
      '<div style="margin-top:15px;">' +
        '<button onclick="window.deleteFormProfile()" ' +
          'style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;padding:6px 12px;border-radius:6px;cursor:pointer;margin-right:8px;">' +
          'Delete Profile</button>' +
        '<button onclick="window.saveFormProfile()" ' +
          'style="background:#2563eb;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">' +
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