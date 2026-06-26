/**
 * SmartForm Filler - Popup Script
 * Controls the popup UI, communicates with content script and background worker.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBar = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');
  const statusDot = statusBar.querySelector('.dot');

  const initialSection = document.getElementById('initialSection');
  const scanSection = document.getElementById('scanSection');

  const fieldCountEl = document.getElementById('fieldCount');
  const formCountEl = document.getElementById('formCount');
  const pageInfoEl = document.getElementById('pageInfo');
  const profileSelect = document.getElementById('profileSelect');

  const btnInitialScan = document.getElementById('btnInitialScan');
  const btnHeuristic = document.getElementById('btnHeuristic');
  const btnAI = document.getElementById('btnAI');
  const btnRescan = document.getElementById('btnRescan');
  const btnClear = document.getElementById('btnClear');

  const resultBox = document.getElementById('resultBox');

  const openOptionsLink = document.getElementById('openOptions');

  // Active model display
  const modelInfo = document.getElementById('modelInfo');
  const modelInfoProvider = document.getElementById('modelInfoProvider');
  const modelInfoName = document.getElementById('modelInfoName');
  const modelInfoReasons = document.getElementById('modelInfoReasons');

  let currentTab = null;
  let lastScanResult = null;
  let aiConfig = {
    enabled: true,
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    model: 'llama3.1:latest',
    openrouterModel: ''
  };

  // Load saved settings + last used profile
  async function loadSettings() {
    const data = await chrome.storage.local.get([
      'defaultProfile', 'provider', 'ollamaUrl', 'ollamaModel', 'openrouterModel', 'aiEnabled'
    ]);
    if (data.defaultProfile) profileSelect.value = data.defaultProfile;
    if (data.provider) aiConfig.provider = data.provider;
    if (data.ollamaUrl) aiConfig.ollamaUrl = data.ollamaUrl;
    if (data.ollamaModel) aiConfig.model = data.ollamaModel;
    if (data.openrouterModel) aiConfig.openrouterModel = data.openrouterModel;
    if (typeof data.aiEnabled === 'boolean') aiConfig.enabled = data.aiEnabled;

    // Update AI button label
    if (!aiConfig.enabled) {
      btnAI.disabled = true;
      btnAI.title = 'AI features disabled in Settings';
    }

    renderModelInfo();
  }

  // Show the active provider/model and, for promoted OpenRouter models, a short
  // bullet-point rationale pulled from the shared recommendation rules.
  function renderModelInfo() {
    if (!modelInfo) return;

    const isOpenRouter = aiConfig.provider === 'openrouter';
    const modelId = isOpenRouter
      ? (aiConfig.openrouterModel || DEFAULT_OPENROUTER_MODEL)
      : aiConfig.model;

    if (modelInfoProvider) modelInfoProvider.textContent = isOpenRouter ? 'OpenRouter' : 'Ollama (local)';

    // Reflect the active provider on the AI fill button.
    const aiLabel = btnAI && btnAI.querySelector('span');
    if (aiLabel) {
      aiLabel.textContent = isOpenRouter ? '🧠 Fill with OpenRouter AI' : '🧠 Fill with Local AI (Ollama)';
    }

    // Recommendation bullets only apply to OpenRouter model ids.
    const reasons = (isOpenRouter && modelId) ? getRecommendation({ id: modelId }) : null;

    if (modelInfoName) {
      modelInfoName.textContent = modelId ? (reasons ? `★ ${modelId}` : modelId) : 'No model selected';
      modelInfoName.classList.toggle('recommended', !!reasons);
    }
    modelInfo.classList.toggle('recommended', !!reasons);

    if (modelInfoReasons) {
      modelInfoReasons.innerHTML = '';
      if (reasons && reasons.length) {
        reasons.forEach(r => {
          const li = document.createElement('li');
          li.textContent = r;
          modelInfoReasons.appendChild(li);
        });
        modelInfoReasons.style.display = 'block';
      } else {
        modelInfoReasons.style.display = 'none';
      }
    }

    modelInfo.style.display = 'block';
  }

  function setStatus(text, type = 'ok') {
    statusText.textContent = text;
    statusDot.className = 'dot';
    if (type === 'warning') statusDot.classList.add('warning');
    if (type === 'error') statusDot.classList.add('error');
  }

  function showResult(message, type = 'success') {
    resultBox.textContent = message;
    resultBox.className = `result ${type}`;
    resultBox.style.display = 'block';
    // Auto-hide non-error after 4s
    if (type !== 'error') {
      setTimeout(() => {
        if (resultBox.textContent === message) resultBox.style.display = 'none';
      }, 4200);
    }
  }

  function hideResult() {
    resultBox.style.display = 'none';
  }

  function showScanUI(result) {
    initialSection.style.display = 'none';
    scanSection.style.display = 'block';

    fieldCountEl.textContent = result.fieldCount || 0;
    if (result.scoped && result.scopeName) {
      formCountEl.textContent = `${result.fieldCount} fields in “${result.scopeName}”`;
    } else {
      formCountEl.textContent = result.formCount > 1
        ? `${result.formCount} forms • ${result.fieldCount} fields`
        : `${result.fieldCount} fields`;
    }

    const url = new URL(result.url || '');
    pageInfoEl.textContent = `${url.hostname}${url.pathname.length > 20 ? '...' : url.pathname}`;

    lastScanResult = result;
    setStatus(result.scoped ? `Scanned ${result.fieldCount} fields in modal` : `Scanned ${result.fieldCount} fields`, 'ok');
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    return tab;
  }

  function rawSendToContent(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(currentTab.id, { action, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // Programmatically inject the content script (for tabs that were already open
  // before the extension was loaded/reloaded — manifest scripts don't inject retroactively).
  async function injectContentScript(tabId) {
    if (!chrome.scripting || !chrome.scripting.executeScript) return false;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return true;
    } catch (e) {
      console.warn('[SmartForm] Content script injection failed:', e.message);
      return false;
    }
  }

  async function sendToContent(action, payload = {}) {
    if (!currentTab || !currentTab.id) {
      throw new Error('No active tab');
    }
    try {
      return await rawSendToContent(action, payload);
    } catch (err) {
      // No listener in the tab yet — inject the content script once and retry.
      if (/Receiving end does not exist|Could not establish connection/i.test(err.message)) {
        const injected = await injectContentScript(currentTab.id);
        if (injected) return await rawSendToContent(action, payload);
      }
      throw err;
    }
  }

  async function performScan(autoFillAfter = false) {
    hideResult();
    setStatus('Scanning page for forms...', 'ok');

    try {
      const tab = await getActiveTab();
      if (!tab) throw new Error('No active tab found');

      // Some pages (chrome://, extension pages) block content scripts
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        setStatus('Cannot scan browser internal pages', 'error');
        showResult('SmartForm cannot run on browser settings or chrome:// pages.', 'error');
        return;
      }

      const result = await sendToContent('scan');
      if (!result || !result.success) {
        throw new Error(result?.message || 'Scan failed');
      }

      showScanUI(result);

      if (result.fieldCount === 0) {
        showResult('No fillable form fields found on this page. Try a different site or re-scan after interacting with the form.', 'warning');
      } else if (autoFillAfter) {
        // Could auto-trigger fill here if wanted
      }
    } catch (err) {
      console.error(err);
      setStatus('Scan failed', 'error');
      showResult(`Scan error: ${err.message}. Make sure you are on a normal web page and the extension has permission.`, 'error');
    }
  }

  async function doHeuristicFill() {
    hideResult();
    const profileKey = profileSelect.value;
    setStatus(`Filling with ${profileKey} profile...`, 'ok');

    try {
      const result = await sendToContent('fillProfile', { profileKey });
      if (result?.success) {
        showResult(result.message || `Filled ${result.filledCount} fields.`, 'success');
        setStatus(`Filled ${result.filledCount} fields`, 'ok');
      } else {
        showResult(result?.message || 'Fill failed', 'error');
      }
    } catch (err) {
      showResult(`Fill error: ${err.message}`, 'error');
    }
  }

  async function doAIFill() {
    if (!aiConfig.enabled) {
      showResult('AI features are disabled in Settings.', 'error');
      return;
    }
    hideResult();
    setStatus('Preparing AI analysis...', 'ok');

    try {
      // 1. Make sure we have fresh scan data
      if (!lastScanResult || lastScanResult.fieldCount === 0) {
        await performScan();
        if (!lastScanResult || lastScanResult.fieldCount === 0) return;
      }

      setStatus('Asking local AI (Ollama) for smart suggestions...', 'ok');

      // 2. Ask background to call Ollama
      const aiResponse = await chrome.runtime.sendMessage({
        action: 'generateWithAI',
        fields: lastScanResult.fields,
        context: `${lastScanResult.pageTitle} on ${new URL(lastScanResult.url).hostname}`,
        ollamaUrl: aiConfig.ollamaUrl,
        model: aiConfig.model
      });

      if (!aiResponse?.success) {
        const hint = aiResponse?.suggestion || aiResponse?.error || 'Check Ollama is running and model is pulled.';
        showResult(`AI error: ${aiResponse?.error || 'Unknown'}. ${hint}`, 'error');
        setStatus('AI failed', 'error');
        return;
      }

      // 3. Send the value map back to content script to apply
      setStatus('Applying AI suggestions to form...', 'ok');
      const fillResult = await sendToContent('fillWithMap', { valueMap: aiResponse.data });

      if (fillResult?.success) {
        showResult(fillResult.message || 'AI-assisted fill completed!', 'success');
        setStatus(`AI filled ${fillResult.filledCount} fields`, 'ok');
      } else {
        showResult(fillResult?.message || 'Failed to apply AI values', 'error');
      }
    } catch (err) {
      console.error(err);
      showResult(`AI fill error: ${err.message}. Is Ollama running with the right OLLAMA_ORIGINS?`, 'error');
      setStatus('AI error', 'error');
    }
  }

  async function doClear() {
    hideResult();
    try {
      const result = await sendToContent('clearFields');
      showResult(result?.message || 'Fields cleared.', 'info');
    } catch (err) {
      showResult(`Clear error: ${err.message}`, 'error');
    }
  }

  // Event listeners
  btnInitialScan.addEventListener('click', () => performScan());
  btnHeuristic.addEventListener('click', doHeuristicFill);
  btnAI.addEventListener('click', doAIFill);
  btnRescan.addEventListener('click', () => performScan());
  btnClear.addEventListener('click', doClear);

  profileSelect.addEventListener('change', async () => {
    await chrome.storage.local.set({ defaultProfile: profileSelect.value });
  });

  openOptionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Keyboard support inside popup
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName === 'BODY') {
      e.preventDefault();
      if (scanSection.style.display === 'block') {
        doHeuristicFill();
      } else {
        performScan();
      }
    }
  });

  // Boot
  await loadSettings();

  // Auto-scan when popup opens (nice UX for repeated use)
  setTimeout(() => {
    performScan().catch(() => {
      // silent fail on auto-scan, user can click manually
      initialSection.style.display = 'block';
      scanSection.style.display = 'none';
      setStatus('Ready to scan', 'ok');
    });
  }, 120);
});