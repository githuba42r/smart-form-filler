// ai-field-detector.js — window.SFAIDetector: LLM-powered form field detection with caching.
// Classic global script (no import/export). Optionally loads after formdata.js.
;(function (root) {
  'use strict';

  var CACHE_KEY = 'fieldDetectionCache';
  var CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  // ---------------------------------------------------------------------------
  // Form signature — deterministic hash of sorted field names + types.
  // djb2-variant: fast, collision-free for typical form schemas.
  // ---------------------------------------------------------------------------
  function _hashFields(fields) {
    var sorted = fields.slice().sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });
    var str = sorted.map(function (f) { return (f.name || '') + '|' + (f.type || ''); }).join(',');
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = (((hash << 5) + hash) ^ str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  // ---------------------------------------------------------------------------
  // Heuristic fallback — regex on field names/labels/types.
  // ---------------------------------------------------------------------------
  function _heuristicDetect(fields) {
    return fields.map(function (f) {
      var name      = (f.name      || '').toLowerCase();
      var type      = (f.type      || '').toLowerCase();
      var label     = (f.label     || '').toLowerCase();
      var ariaLabel = (f.ariaLabel || '').toLowerCase();
      var combined  = name + ' ' + label + ' ' + ariaLabel;

      var detectedType = 'custom';
      var isSafe       = true;
      var confidence   = 0.5;
      var genType      = 'faker';

      if (type === 'email' || /email/.test(combined)) {
        detectedType = 'email'; confidence = 0.9;
      } else if (type === 'password' || /password/.test(combined)) {
        detectedType = 'password'; isSafe = false; confidence = 0.95;
      } else if (/card\s*number|credit.?card|cvv|cvc|ccv/.test(combined)) {
        detectedType = 'card'; isSafe = false; confidence = 0.9;
      } else if (/ssn|social.?security/.test(combined)) {
        detectedType = 'ssn'; isSafe = false; confidence = 0.9;
      } else if (type === 'tel' || /\bphone\b|mobile|cell/.test(combined)) {
        detectedType = 'phone'; confidence = 0.85;
      } else if (/zip|postcode|postal/.test(combined)) {
        detectedType = 'zip'; confidence = 0.85;
      } else if (/first.?name|fname|given.?name/.test(combined)) {
        detectedType = 'firstname'; confidence = 0.8;
      } else if (/last.?name|lname|surname|family.?name/.test(combined)) {
        detectedType = 'lastname'; confidence = 0.8;
      } else if (/\bfull.?name\b|\bname\b/.test(combined)) {
        detectedType = 'fullname'; confidence = 0.7;
      } else if (/address|street/.test(combined)) {
        detectedType = 'street1'; confidence = 0.8;
      } else if (/\bcity\b|suburb/.test(combined)) {
        detectedType = 'city'; confidence = 0.8;
      } else if (/\bstate\b|province|region/.test(combined)) {
        detectedType = 'state'; confidence = 0.75;
      } else if (/\bcountry\b/.test(combined)) {
        detectedType = 'country'; confidence = 0.8;
      } else if (type === 'date' || /\bdate\b|birthday|birth.?day|\bdob\b/.test(combined)) {
        detectedType = 'dob'; confidence = 0.75;
      } else if (/business|company|org(anisation|anization)?/.test(combined)) {
        detectedType = 'business'; confidence = 0.75;
      } else if (/\busername\b|user.?name/.test(combined)) {
        detectedType = 'username'; confidence = 0.8;
      } else {
        genType = 'random';
      }

      return {
        htmlName: f.name || '',
        htmlType: f.type || 'text',
        label: f.label || f.ariaLabel || '',
        ariaLabel: f.ariaLabel || '',
        detectedType: detectedType,
        isSafe: isSafe,
        confidence: confidence,
        suggestedGenerationType: genType
      };
    });
  }

  // ---------------------------------------------------------------------------
  // LLM prompt builder
  // ---------------------------------------------------------------------------
  function _buildDetectionPrompt(fields) {
    var fieldsJson = JSON.stringify(
      fields.map(function (f) {
        return { name: f.name, type: f.type, label: f.label, ariaLabel: f.ariaLabel, placeholder: f.placeholder };
      }),
      null, 2
    );

    return 'Analyze this form. For each field, determine:\n' +
      '1. What data type does it expect? (name, email, address, phone, date, custom, etc.)\n' +
      '2. Is it safe to auto-fill? (flag password, card, SSN as high-risk)\n' +
      '3. For custom fields, what kind of test value would fit?\n\n' +
      'Fields:\n' + fieldsJson + '\n\n' +
      'Return a JSON array where each element has:\n' +
      '{\n' +
      '  "htmlName": "<form field name>",\n' +
      '  "htmlType": "<input type>",\n' +
      '  "label": "<detected label>",\n' +
      '  "detectedType": "<canonical or custom>",\n' +
      '  "isSafe": <true|false>,\n' +
      '  "confidence": <0.0-1.0>,\n' +
      '  "suggestedGenerationType": "<faker|increment|random>"\n' +
      '}\n\n' +
      'Be conservative: if unsure, mark isSafe=false and confidence<0.8.';
  }

  // ---------------------------------------------------------------------------
  // LLM call via background service worker
  // ---------------------------------------------------------------------------
  function _callLLM(prompt) {
    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        resolve({ error: 'LLM timeout after 10000ms' });
      }, 10000);

      try {
        root.chrome.runtime.sendMessage(
          { action: 'callLLM', prompt: prompt, timeoutMs: 10000 },
          function (response) {
            clearTimeout(timeout);
            var lastErr = root.chrome && root.chrome.runtime && root.chrome.runtime.lastError;
            if (lastErr) {
              resolve({ error: (lastErr.message || 'chrome runtime error') });
            } else if (response && response.error) {
              resolve({ error: response.error });
            } else if (response && response.result) {
              resolve({ result: response.result });
            } else {
              resolve({ error: 'Empty LLM response' });
            }
          }
        );
      } catch (e) {
        clearTimeout(timeout);
        resolve({ error: (e && e.message) || 'Failed to send message to background' });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Parse LLM text → JSON array of field detections
  // ---------------------------------------------------------------------------
  function _parseLLMFields(text) {
    if (!text) return null;
    try {
      var content = String(text).trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      // Extract first JSON array
      var arrMatch = content.match(/\[[\s\S]*\]/);
      if (arrMatch) content = arrMatch[0];

      var parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      return null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // localStorage cache helpers
  // ---------------------------------------------------------------------------
  function _loadCache() {
    try {
      var raw = root.localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function _saveCache(cache) {
    try {
      root.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      // ignore storage errors (private browsing, quota, etc.)
    }
  }

  function _pruneExpired(cache) {
    var now = Date.now();
    var out = {};
    Object.keys(cache).forEach(function (url) {
      var entry = cache[url];
      if (entry && entry.cachedAt && (now - entry.cachedAt) < CACHE_EXPIRY_MS) {
        out[url] = entry;
      }
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * getFieldDetectionCache(url) → { signature, fields, cachedAt } | null
   *
   * Returns the cached detection entry for the given URL, or null if absent /
   * expired.
   */
  function getFieldDetectionCache(url) {
    var cache = _loadCache();
    var entry = cache[url];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt >= CACHE_EXPIRY_MS) return null;
    return entry;
  }

  /**
   * clearDetectionCache() → void
   *
   * Removes all cached field detections from localStorage.
   */
  function clearDetectionCache() {
    try {
      root.localStorage.removeItem(CACHE_KEY);
    } catch (e) {
      // ignore
    }
  }

  /**
   * detectFormFields(options) → Promise<{ fields, formSignature, error? }>
   *
   * options:
   *   fields  – Array of { name, type, label, ariaLabel, placeholder }
   *   url     – Page URL used as the cache key (defaults to location.href)
   *
   * Behaviour:
   *   1. Hash the field schema → formSignature.
   *   2. On cache hit (same URL + signature): return immediately, zero LLM cost.
   *   3. On cache miss: call LLM via background.js { action: 'callLLM', prompt }.
   *   4. On LLM success: cache + return { fields, formSignature }.
   *   5. On LLM failure: fall back to heuristics, return { fields, formSignature, error }.
   */
  function detectFormFields(options) {
    options = options || {};
    var fields    = options.fields || [];
    var url       = options.url || (root.location ? root.location.href : '');
    var signature = _hashFields(fields);

    // Cache hit?
    var cached = getFieldDetectionCache(url);
    if (cached && cached.signature === signature) {
      return Promise.resolve({ fields: cached.fields, formSignature: signature });
    }

    // Cache miss — call LLM
    var prompt = _buildDetectionPrompt(fields);

    return _callLLM(prompt).then(function (response) {
      if (response && response.result) {
        var parsed = _parseLLMFields(response.result);
        if (parsed) {
          // Cache and return LLM result
          var cache = _pruneExpired(_loadCache());
          cache[url] = { signature: signature, fields: parsed, cachedAt: Date.now() };
          _saveCache(cache);
          return { fields: parsed, formSignature: signature };
        }
        // LLM returned unparseable JSON — fall through to heuristics
      }

      // LLM error or parse failure → heuristics
      var errorMsg = (response && response.error) ? response.error : 'LLM returned invalid JSON';
      var heuristicFields = _heuristicDetect(fields);
      return {
        fields: heuristicFields,
        formSignature: signature,
        error: 'LLM unavailable; heuristics used (' + errorMsg + ')'
      };
    });
  }

  /**
   * generateCustomFieldValue(field) → Promise<string>
   *
   * field: { htmlName, detectedType, type, ... }
   *
   * Priority:
   *   1. window.SFFormData.CUSTOM_GENERATORS[detectedType] — formdata.js hook
   *   2. LLM prompt asking for a realistic test value
   *   3. Fallback: "text_<type>"
   */
  function generateCustomFieldValue(field) {
    field = field || {};
    var fieldName = field.htmlName || field.name || 'field';
    var fieldType = field.detectedType || field.type || 'text';

    // 1. formdata.js custom generator hook
    if (root.SFFormData && root.SFFormData.CUSTOM_GENERATORS) {
      var gen = root.SFFormData.CUSTOM_GENERATORS[fieldType];
      if (typeof gen === 'function') {
        try {
          var val = gen(field);
          if (val != null) return Promise.resolve(String(val));
        } catch (e) {
          // fall through
        }
      }
    }

    // 2. LLM
    var prompt = 'Generate a realistic test value for a ' + fieldType +
      ' field named "' + fieldName + '". Return only the value, no explanation.';

    return _callLLM(prompt).then(function (response) {
      if (response && response.result) {
        var trimmed = String(response.result).trim();
        if (trimmed.length > 0) return trimmed;
      }
      // 3. Fallback
      return 'text_' + fieldType;
    });
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  root.SFAIDetector = {
    detectFormFields: detectFormFields,
    getFieldDetectionCache: getFieldDetectionCache,
    clearDetectionCache: clearDetectionCache,
    generateCustomFieldValue: generateCustomFieldValue
  };

})(typeof window !== 'undefined' ? window : globalThis);
