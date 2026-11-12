// ai-field-detector.js — window.SFAIDetector: LLM-powered form field detection with caching.
// Classic global script (no import/export). Optionally loads after formdata.js.
;(function (root) {
  'use strict';

  // Bump the version when detection output changes so stale cached classifications are dropped.
  var CACHE_KEY = 'fieldDetectionCache.v2';
  var CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  try { root.localStorage.removeItem('fieldDetectionCache'); } catch (e) { /* pre-v2 cache */ }

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
  // Canonical types + aliases the LLM tends to return instead.
  // ---------------------------------------------------------------------------
  var CANONICAL_TYPES = ['firstname', 'lastname', 'fullname', 'username', 'email', 'phone',
    'street1', 'street2', 'city', 'state', 'zip', 'country', 'password', 'dob', 'business',
    'genericText'];
  var TYPE_ALIASES = {
    first_name: 'firstname', given_name: 'firstname', fname: 'firstname',
    last_name: 'lastname', surname: 'lastname', family_name: 'lastname', lname: 'lastname',
    name: 'fullname', full_name: 'fullname', user_name: 'username', login: 'username',
    e_mail: 'email', email_address: 'email',
    mobile: 'phone', telephone: 'phone', tel: 'phone', phone_number: 'phone', mobile_number: 'phone',
    address: 'street1', street: 'street1', address1: 'street1', address_line_1: 'street1', street_address: 'street1',
    address2: 'street2', address_line_2: 'street2', apartment: 'street2', unit: 'street2',
    suburb: 'city', town: 'city', province: 'state', region: 'state', territory: 'state',
    postcode: 'zip', post_code: 'zip', postal_code: 'zip', zipcode: 'zip', zip_code: 'zip',
    birthday: 'dob', birthdate: 'dob', birth_date: 'dob', date_of_birth: 'dob',
    company: 'business', company_name: 'business', organisation: 'business', organization: 'business',
    generictext: 'genericText'
  };
  function _normalizeType(type) {
    var key = String(type || '').trim().toLowerCase().replace(/[\s\-]+/g, '_');
    if (!key) return 'custom';
    if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];
    var canonical = CANONICAL_TYPES.find(function (t) { return t.toLowerCase() === key; });
    return canonical || key;
  }
  function _normalizeDetections(fields) {
    return fields.map(function (f) {
      return Object.assign({}, f, { detectedType: _normalizeType(f && f.detectedType) });
    });
  }

  // Birth-date signals. Run on _spaced() text so "dob_day" and "birthMonth" match.
  var BIRTH_RE = /\bdob\b|\bbirth|\bbday\b|\bd\.o\.b\b/;
  function _spaced(str) {
    return String(str || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-\[\]]+/g, ' ').toLowerCase();
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
      var businessId   = /\b(abn|acn)\b/.exec(_spaced(f.name + ' ' + (f.label || '')));

      if (businessId) {
        detectedType = businessId[1]; confidence = 0.85;
      } else if (type === 'email' || /email/.test(combined)) {
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
      } else if (BIRTH_RE.test(_spaced(name + ' ' + label + ' ' + ariaLabel + ' ' + (f.context || '')))) {
        detectedType = 'dob'; confidence = 0.8;
      } else if (type === 'date' || /\bdate\b/.test(combined)) {
        detectedType = 'date'; confidence = 0.6;
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
  // Everything the page tells us about a field — the LLM picks values from this.
  function _describeField(f) {
    var out = { name: f.name || f.htmlName, type: f.type || f.htmlType, label: f.label };
    ['ariaLabel', 'placeholder', 'context', 'hint', 'options', 'maxLength', 'min', 'max', 'pattern', 'required']
      .forEach(function (k) {
        var v = f[k];
        if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v;
      });
    return out;
  }

  function _buildDetectionPrompt(fields) {
    var fieldsJson = JSON.stringify(fields.map(_describeField), null, 2);

    return 'You are filling a web form with realistic test data. For each field, read its label, ' +
      'name, placeholder, section (context), options and constraints, then decide:\n' +
      '1. detectedType — one of: ' + CANONICAL_TYPES.join(', ') + '. Use "dob" for any date-of-birth ' +
      'field, including separate day / month / year parts. If none fit, use a short snake_case ' +
      'description of what the field asks for (e.g. "job_title", "abn", "appointment_date").\n' +
      '2. isSafe — false for password, card, CVV, SSN / tax file number fields.\n' +
      '3. suggestedValue — only for fields whose detectedType is NOT in the list above: a realistic ' +
      'value that answers what the label and name ask for. If options are listed, return one of ' +
      'them exactly. Respect maxLength/min/max/pattern. Dates as YYYY-MM-DD. Never use placeholder ' +
      'text such as "test", "text_custom" or the field name.\n\n' +
      'Fields:\n' + fieldsJson + '\n\n' +
      'Return ONLY a JSON array, one element per field, in the same order:\n' +
      '{\n' +
      '  "htmlName": "<form field name>",\n' +
      '  "htmlType": "<input type>",\n' +
      '  "label": "<detected label>",\n' +
      '  "detectedType": "<canonical type or snake_case description>",\n' +
      '  "isSafe": <true|false>,\n' +
      '  "confidence": <0.0-1.0>,\n' +
      '  "suggestedGenerationType": "<faker|increment|random>",\n' +
      '  "suggestedValue": "<value, non-canonical fields only>"\n' +
      '}\n\n' +
      'Be conservative: if unsure, mark isSafe=false and confidence<0.8.';
  }

  // ---------------------------------------------------------------------------
  // LLM call via background service worker
  // ---------------------------------------------------------------------------
  // Whole-form detection is a big prompt; large cloud models need longer than a single value.
  var DETECT_TIMEOUT_MS = 30000;
  var VALUE_TIMEOUT_MS  = 15000;

  function _callLLM(prompt, timeoutMs) {
    timeoutMs = timeoutMs || VALUE_TIMEOUT_MS;
    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        resolve({ error: 'LLM timeout after ' + timeoutMs + 'ms' });
      }, timeoutMs);

      try {
        root.chrome.runtime.sendMessage(
          { action: 'callLLM', prompt: prompt, timeoutMs: timeoutMs },
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

    return _callLLM(prompt, DETECT_TIMEOUT_MS).then(function (response) {
      if (response && response.result) {
        var parsed = _parseLLMFields(response.result);
        if (parsed) {
          parsed = _normalizeDetections(parsed);
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

  // Values that mean "the generator gave up" — never write these into a form.
  function _isJunkValue(value, field) {
    var v = String(value == null ? '' : value).trim();
    if (!v) return true;
    if (/^text_/i.test(v) || /^(custom|test|n\/a|null|undefined|value)$/i.test(v)) return true;
    var name = field.htmlName || field.name;
    return !!name && v.toLowerCase() === String(name).toLowerCase();
  }

  // Clean a raw LLM answer and check it fits the field; returns '' if it doesn't.
  function _acceptValue(raw, field) {
    var v = String(raw == null ? '' : raw).trim().split(/\r?\n/)[0].trim()
      .replace(/^(value|answer)\s*:\s*/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
    if (_isJunkValue(v, field)) return '';
    var F = root.SFFormData;
    if (F && F.toISODate && _isBirthField(field)) {
      // Birth dates must be real dates for an adult; normalised to ISO for per-field formatting.
      var iso = F.toISODate(v), age = iso ? F.ageFromISO(iso) : null;
      return (age !== null && age >= 18 && age <= 100) ? iso : '';
    }
    if (Array.isArray(field.options) && field.options.length) {
      var match = field.options.find(function (o) { return String(o).toLowerCase() === v.toLowerCase(); });
      return match !== undefined ? String(match) : '';
    }
    var type = (field.htmlType || field.type || '').toLowerCase();
    if ((type === 'number' || type === 'range') && isNaN(Number(v))) return '';
    if (field.maxLength > 0 && v.length > field.maxLength) v = v.slice(0, field.maxLength);
    return v;
  }

  function _isBirthField(field) {
    return BIRTH_RE.test(_spaced([field.label, field.htmlName || field.name, field.placeholder,
      field.context, field.hint, field.detectedType].join(' ')));
  }

  function _buildValuePrompt(field) {
    var birth = _isBirthField(field)
      ? ' This is a DATE OF BIRTH: return a birth date for an adult aged between 21 and 75 ' +
        '(not a recent or future date), as YYYY-MM-DD.'
      : '';
    return 'You are filling a web form with realistic test data. Choose a value for this field ' +
      'based on what its label, name, placeholder and help text ask for:\n' +
      JSON.stringify(_describeField(field), null, 2) + '\n\n' +
      'Rules: return ONLY the value, with no quotes or explanation. If options are listed, return one ' +
      'of them exactly. Respect maxLength/min/max/pattern. Dates as YYYY-MM-DD. Never return ' +
      'placeholder text such as "test", "text_custom" or the field name.' + birth;
  }

  function _isoToday(offsetDays) {
    var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // Offline fallback: a sensible value from the field's type and wording, or '' to leave it blank.
  function _localValue(field) {
    var type = (field.htmlType || field.type || '').toLowerCase();
    var text = _spaced([field.label, field.htmlName || field.name, field.placeholder, field.detectedType].join(' '));
    var options = Array.isArray(field.options) ? field.options : [];
    if (options.length) return String(options[0]);

    var min = field.min !== undefined && field.min !== '' ? Number(field.min) : NaN;
    var max = field.max !== undefined && field.max !== '' ? Number(field.max) : NaN;
    if (type === 'number' || type === 'range' || /\b(age|qty|quantity|count|number of)\b/.test(text)) {
      var lo = isNaN(min) ? 1 : min, hi = isNaN(max) ? (/\bage\b/.test(text) ? 65 : 10) : max;
      if (/\bage\b/.test(text) && isNaN(min)) lo = 25;
      return String(Math.round(lo + (hi - lo) / 2));
    }
    if (type === 'date') return _isoToday(7);
    if (type === 'datetime-local') return _isoToday(7) + 'T09:30';
    if (type === 'month') return _isoToday(0).slice(0, 7);
    if (type === 'time') return '09:30';
    if (type === 'color') return '#3366cc';
    if (type === 'url' || /\b(website|url|homepage)\b/.test(text)) return 'https://www.example.com';
    if (/\bdate\b/.test(text)) return _isoToday(7);
    if (/\babn\b/.test(text)) return '51 824 753 556';
    if (/\bacn\b/.test(text)) return '004 085 616';
    if (/job title|\bposition\b|\boccupation\b|\brole\b/.test(text)) return 'Software Engineer';
    if (/\b(reference|ref)\b/.test(text) && root.SFFormData && root.SFFormData.CUSTOM_GENERATORS) {
      return root.SFFormData.CUSTOM_GENERATORS.reference();
    }
    if (type === 'textarea' || /\b(comment|comments|message|notes?|description|details|enquiry|inquiry)\b/.test(text)) {
      return 'Sample enquiry entered by SmartForm Filler for testing purposes.';
    }
    return '';
  }

  /**
   * generateCustomFieldValue(field) → Promise<string>
   *
   * field: { htmlName, htmlType, label, placeholder, context, options, detectedType,
   *          suggestedValue, llmUnavailable, ... }
   *
   * Priority:
   *   1. window.SFFormData.CUSTOM_GENERATORS[detectedType] — formdata.js hook
   *   2. suggestedValue the LLM chose during detection
   *   3. LLM prompt describing the field (skipped when field.llmUnavailable)
   *   4. Local heuristic from the field's type and wording
   *   5. '' — nothing appropriate; the caller leaves the field blank
   */
  function generateCustomFieldValue(field) {
    field = field || {};
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

    // 2. Value already chosen during detection
    var suggested = _acceptValue(field.suggestedValue, field);
    if (suggested) return Promise.resolve(suggested);

    if (field.llmUnavailable) return Promise.resolve(_localValue(field));

    // 3. LLM
    return _callLLM(_buildValuePrompt(field)).then(function (response) {
      var accepted = response && response.result ? _acceptValue(response.result, field) : '';
      // 4/5. Local heuristic, else ''
      return accepted || _localValue(field);
    });
  }

  /**
   * suggestFieldValue(field) → Promise<{ value } | { error }>
   *
   * AI-only suggestion for one field (right-click "Fill with AI suggestion"): the LLM
   * chooses from the field's label, name, placeholder, options and constraints. No profile
   * data, generators or local fallback. field.currentValue, when set, asks for a different value.
   */
  function suggestFieldValue(field) {
    field = field || {};
    var prompt = _buildValuePrompt(field);
    if (field.currentValue) {
      prompt += '\nThe field currently contains "' + String(field.currentValue).slice(0, 200) +
        '" — suggest a different value.';
    }
    return _callLLM(prompt).then(function (response) {
      if (!response || !response.result) return { error: (response && response.error) || 'No response from AI' };
      var value = _acceptValue(response.result, field);
      if (value) return { value: value };
      return { error: _isBirthField(field)
        ? 'AI suggested "' + String(response.result).trim().slice(0, 40) + '", which is not an adult birth date'
        : 'AI did not return a usable value' };
    });
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  root.SFAIDetector = {
    detectFormFields: detectFormFields,
    getFieldDetectionCache: getFieldDetectionCache,
    clearDetectionCache: clearDetectionCache,
    generateCustomFieldValue: generateCustomFieldValue,
    suggestFieldValue: suggestFieldValue
  };

})(typeof window !== 'undefined' ? window : globalThis);
