# AI-Assisted Field Detection & Form-Specific Profiles — Design

**Date:** 2026-06-30  
**Status:** Design approved, ready for implementation plan  
**Scope:** Build on foundation profiles to add AI-powered form field detection and form-specific profile capture for repeated testing workflows.

---

## 1. Problem & Motivation

The foundation delivers storage-backed, country-coherent profiles for quick form fills. Two gaps remain:

1. **Custom fields** — Many testing forms (VinCreative product pages, CRM forms, custom internal tools) have fields beyond the standard profile (name, email, address). Today, the extension can't intelligently fill these.

2. **Repeated testing on the same form** — Users who test a form repeatedly want fine-grained control: pin address to test shipping, generate name/email for uniqueness testing, skip password fields. The foundation's generic profiles are too coarse-grained for this use case.

This spec adds AI-powered field detection and form-specific profiles to solve both problems.

## 2. Goals

- Use the configured LLM (Ollama/OpenRouter) to analyze form structure (labels, ARIA, names, types) and detect field types, including custom fields.
- Capture form-specific profiles: user fills a form once with test values, clicks "Capture as profile," then refines it in Options (pin, generate, empty per field).
- Intelligently fill any form using the active profile's rules + AI generation for custom fields.
- Support two testing workflows:
  - **Quick pass-through** — Use a generic profile (au-personal, us-test) to speed through any form without manual configuration.
  - **Repeated testing** — Create form-specific profiles for repeated form testing with precise control over which fields are pinned, generated, or skipped.
- Respect safety constraints (never auto-fill password, payment fields without user confirmation).

## 3. Non-Goals

- Real-time learning from user corrections (future enhancement).
- Multi-step forms or dynamic field dependencies (defer to future spec).
- LLM fine-tuning for domain-specific field detection (use foundation model only).

## 4. Architecture Overview

```
ai-field-detector.js      (LLM integration, field detection, caching)
form-registry.js          (form-specific profile matching)
formdata.js (extended)    (AI generation for custom fields)
        |
        |  (new modules + extensions, loaded before content.js)
        v
content.js                (rewired fillWithProfile to support AI + form-specific profiles)
options.js (extended)     (profile capture + refined editor for form-specific profiles)
background.js             (seed form-specific profiles on install/upgrade)
manifest.json             (add new scripts)
```

New/changed files:
- **`ai-field-detector.js`** (new) — LLM integration, field detection, caching.
- **`form-registry.js`** (new) — Match form-specific profiles by URL/form signature.
- **`formdata.js`** (extended) — Add custom field generation logic.
- **`content.js`** (extended) — Add "Capture form as profile" button, rewire fill to support AI + form-specific profiles.
- **`options.html` / `options.js`** (extended) — Profile capture + refined editor.
- **`background.js`** (extended) — Seed form-specific profiles on install/upgrade (initially empty).
- **`manifest.json`** (updated) — Add new scripts.

## 5. Data Model

### 5.1 Profile Types

**Generic Profile** (from foundation, unchanged):
```js
{
  id: 'au-personal',
  label: 'AU Personal',
  country: 'AU',
  randomize: true,
  policy: {
    groups: { name: true, contact: true, address: true, account: true, misc: false },
    exclude: ['email']
  },
  pins: { emailDomain: 'example.com.au' }
}
```

**Form-Specific Profile** (new):
```js
{
  id: 'checkout-example-com-1719764400',
  label: 'Checkout - example.com',
  country: 'AU',                        // inherited from active profile at capture time
  randomize: true,
  policy: { groups: {...}, exclude: [...] },    // inherited from active profile
  pins: { emailDomain: '...' },         // inherited from active profile
  formMetadata: {
    urlPattern: 'https://example.com/checkout',
    formSignature: '<sha256 hash of field names + types>',
    capturedAt: '2026-06-30T12:00:00Z'
  },
  fields: [
    {
      key: 'firstName',
      htmlName: 'first_name',           // HTML form field name
      htmlType: 'text',                 // HTML input type
      label: 'First Name',              // Detected label from form
      detectedType: 'firstName',        // Canonical type (or custom)
      mode: 'pinned',                   // 'pinned' | 'generated' | 'empty' | 'excluded'
      value: 'Alice',                   // Used if mode='pinned'
      safetyLevel: 'low'                // 'low' | 'medium' | 'high'
    },
    {
      key: 'email',
      htmlName: 'email_address',
      htmlType: 'email',
      label: 'Email',
      detectedType: 'email',
      mode: 'pinned',
      value: 'alice@test.com',
      safetyLevel: 'low'
    },
    {
      key: 'address1',
      htmlName: 'street_address',
      htmlType: 'text',
      label: 'Street Address',
      detectedType: 'street1',
      mode: 'pinned',
      value: '123 Test St',
      safetyLevel: 'low'
    },
    {
      key: 'password',
      htmlName: 'password',
      htmlType: 'password',
      label: 'Password',
      detectedType: 'password',
      mode: 'excluded',
      safetyLevel: 'high'
    },
    {
      key: 'product_sku',
      htmlName: 'product_sku',
      htmlType: 'text',
      label: 'Product SKU',
      detectedType: 'sku',              // custom, AI-detected
      mode: 'generated',
      safetyLevel: 'low'
    }
  ]
}
```

Storage: both profile types live in the same `profiles` array in `chrome.storage.local`, distinguished by the presence of `formMetadata`.

### 5.2 Field Detection Cache

```js
// chrome.storage.local.fieldDetectionCache
{
  'https://example.com/checkout': {
    formSignature: '<hash>',
    fields: [
      {
        htmlName: 'first_name',
        htmlType: 'text',
        label: 'First Name',
        ariaLabel: 'Your first name',
        detectedType: 'firstName',
        isSafe: true,
        confidence: 0.95
      },
      // ...
    ],
    cachedAt: '2026-06-30T12:00:00Z'
  }
}
```

Cache entries are keyed by URL and include form signature (fingerprint of field names + types). Signature is used to detect form changes (if fields change, cache is invalidated).

## 6. LLM Integration & Field Detection

### 6.1 LLM Call

The extension calls the configured LLM (Ollama or OpenRouter) to analyze form structure:

```
Input:
- Form HTML (fieldset, inputs, labels, select, textarea)
- Field element attributes: name, id, type, placeholder, aria-label, aria-describedby, title, label text
- Page title, form name (if detectable)

Prompt (simplified):
"Analyze this HTML form. For each input/select/textarea field, determine:
1. What data type does this field expect? (name, email, address, phone, date, currency, etc.)
2. Is the field's purpose clear from its label and name?
3. Is it safe to auto-fill? (flag password, card number, SSN, OAuth token as high-risk)
4. If you can't recognize it, what kind of realistic test value would fit?

Return a JSON array where each element has:
{
  htmlName: '<form field name>',
  htmlType: '<input type>',
  label: '<detected label text>',
  ariaLabel: '<aria-label if present>',
  detectedType: '<canonical type or custom>',
  isSafe: <true|false>,
  confidence: <0.0-1.0>,
  suggestedGenerationType: '<how to generate test value if unknown: faker, increment, random, etc.>'
}

Be conservative: if you're unsure, mark isSafe=false."

Output: JSON array of detected fields (or error if LLM call fails)
```

### 6.2 Caching

- Cache field detection results per URL + form signature
- Signature = SHA256(sorted field names + types)
- On page load, compute signature; if it matches cache, reuse cache (no LLM call)
- If signature changes, invalidate cache and re-detect
- Cache expires after 30 days (staleness check) or on extension upgrade

### 6.3 Error Handling

If LLM call fails:
- Fall back to heuristics: regex on field names (email, password, zip, etc.), HTML input types (email, phone, date, etc.)
- Still fill the form, but with reduced confidence
- Log the error for debugging

## 7. Field Detection & Type Mapping

Detected field types fall into two categories:

**Standard fields** (map to foundation canonical fields):
- `firstName`, `lastName`, `fullName`, `email`, `phone`, `street1`, `street2`, `city`, `state`, `zip`, `country`, `company`, `dob`, `password`, `username`
- Mapping is 1:1 with the foundation's canonical vocabulary

**Custom fields** (user/domain-specific):
- Any field the LLM detects but can't map to standard → treated as custom
- Examples: `product_sku`, `invoice_id`, `customer_number`, `bio`, `company_size`, etc.
- For custom fields, the LLM's `suggestedGenerationType` guides how to generate values

## 8. Profile Capture Flow

### 8.1 User Interaction

1. User navigates to a form (e.g., checkout, signup, product creation)
2. User fills out the form with their desired test values (e.g., name "Alice", email "alice@test.com", address "123 Test St")
3. User clicks **"Capture form as profile"** button in the form-icon menu (new)
4. Extension displays a modal:
   - Shows detected fields (name, email, address, password, custom fields)
   - Lets user confirm/reject fields to capture
   - Suggests a profile name (inferred from page title or form name, editable)
5. User clicks "Save Profile"
6. Extension creates a form-specific profile with all fields set to `mode: 'pinned'` (the values the user entered)
7. Profile is saved to storage; modal shows "Profile saved! Go to Options to refine."

### 8.2 Profile Creation Logic

```js
async function captureFormAsProfile() {
  const detectedFields = await detectFormFields();  // Call LLM or use cache
  const filledValues = readFormValues();             // Get values user entered
  const activeProfile = getActiveProfile();
  
  const newProfile = {
    id: `form-${sanitizeUrl(window.location.href)}-${Date.now()}`,
    label: inferProfileLabel(),                     // "Checkout - example.com"
    country: activeProfile.country,                 // Inherit
    randomize: true,
    policy: activeProfile.policy,                   // Inherit
    pins: activeProfile.pins,                       // Inherit
    formMetadata: {
      urlPattern: window.location.origin + window.location.pathname,
      formSignature: computeFormSignature(detectedFields),
      capturedAt: new Date().toISOString()
    },
    fields: detectedFields.map(field => ({
      ...field,
      mode: filledValues[field.htmlName] ? 'pinned' : 'generated',
      value: filledValues[field.htmlName] || undefined
    }))
  };
  
  await saveProfile(newProfile);
}
```

## 9. Fill Flow

### 9.1 Form Detection & Profile Matching

When a form is detected on the page:

```js
async function onFormDetected() {
  // 1. Detect form fields (cache + LLM)
  const detectedFields = await detectFormFields();
  const formSignature = computeFormSignature(detectedFields);
  
  // 2. Check for form-specific profile
  const formSpecificProfile = findProfileByFormSignature(formSignature);
  
  // 3. Determine active profile
  const activeProfile = formSpecificProfile || getSelectedProfile();
  
  // 4. Prepare menu
  renderFillMenu(detectedFields, activeProfile);
}
```

### 9.2 Fill Action (e.g., "Fill all")

When user clicks a fill button:

```js
async function fillWithProfile(profileKey, opts) {
  // opts = { only: null|['name']|['address']|['name','address'], unique: true }
  
  const profile = getProfile(profileKey);
  const detectedFields = await detectFormFields();
  
  const valuesToFill = {};
  
  for (const field of detectedFields) {
    const value = await resolveFieldValue(field, profile, opts);
    if (value !== undefined) {
      valuesToFill[field.htmlName] = value;
    }
  }
  
  fillForm(valuesToFill);
}

async function resolveFieldValue(field, profile, opts) {
  // 1. Check if profile has field config (form-specific profile)
  if (profile.fields) {
    const fieldConfig = profile.fields.find(f => f.htmlName === field.htmlName);
    if (fieldConfig) {
      if (fieldConfig.mode === 'pinned') {
        return fieldConfig.value;
      } else if (fieldConfig.mode === 'generated') {
        return await generateCustomFieldValue(field);
      } else if (fieldConfig.mode === 'empty' || fieldConfig.mode === 'excluded') {
        return undefined;
      }
    }
  }
  
  // 2. For standard fields, use foundation profile rules
  if (isStandardField(field.detectedType)) {
    // Check profile policy: is group enabled? is field excluded?
    if (shouldFill(field.detectedType, profile.policy, opts.only)) {
      // Use foundation's resolveValues
      return await SFFormData.resolveValues(profile, opts.only);
    }
  }
  
  // 3. For custom fields, generate
  if (field.mode === 'generated' || !profile.fields) {
    return await generateCustomFieldValue(field);
  }
  
  return undefined;
}

async function generateCustomFieldValue(field) {
  // Use LLM or heuristics to generate realistic test value
  if (field.detectedType in CUSTOM_GENERATORS) {
    return CUSTOM_GENERATORS[field.detectedType]();
  }
  
  // Fall back to LLM
  return await callLLM(`Generate a test value for a ${field.htmlType} field named "${field.htmlName}". Keep it short and realistic.`);
}
```

### 9.3 Transient Menu Override & Policy Intersection

The fill buttons (Fill name, Fill address, Fill all) set `opts.only` (the transient override). The fill engine applies the intersection of the profile's policy and the menu override:

- **Fill name** → `opts.only = ['name']` → only fields in the name group are filled
- **Fill address** → `opts.only = ['address']` → only fields in the address group are filled
- **Fill all** → `opts.only = null` → all groups (subject to policy and form-specific profile)

For each field:
1. If form-specific profile exists, check field mode (pinned/generated/empty/excluded)
2. If standard field, check policy (group enabled? field excluded?)
3. If custom field, generate (unless form-specific profile says otherwise)
4. Respect `opts.only` intersection (if set)

## 10. UI Changes

### 10.1 Form-Icon Menu (content.js)

```
Form Icon Menu:
├─ Fill name
├─ Fill address
├─ Fill name + address
├─ Fill all
├─ ─────────────
├─ Profile: [dropdown v]
│  ├─ au-personal
│  ├─ au-business
│  ├─ us-test
│  ├─ checkout-example-com (form-specific)
│  └─ [other profiles...]
├─ [Capture form as profile] (new)
├─ ─────────────
└─ Clear
```

The profile dropdown and fill buttons remain largely unchanged from the foundation. The "Capture form as profile" button is new.

### 10.2 Profile Capture Modal (new)

When user clicks "Capture form as profile":

```
Modal: Capture Form as Profile
┌─────────────────────────────────┐
│ Detected Fields:                 │
├─────────────────────────────────┤
│ ☑ First Name (text)             │
│ ☑ Email (email)                 │
│ ☑ Address (text)                │
│ ☐ Password (password) [high-risk]│
│ ☑ Product SKU (text)            │
├─────────────────────────────────┤
│ Profile Name: [Checkout -...]   │
├─────────────────────────────────┤
│ [Cancel] [Save Profile]         │
└─────────────────────────────────┘
```

High-risk fields (password, payment) are unchecked by default; user can override.

### 10.3 Options Page — Profile Editor (extended)

**Generic profile editor** — unchanged from foundation.

**Form-specific profile editor** — new tab/section:

```
Profile: Checkout - example.com
────────────────────────────────────────────────
Form URL: https://example.com/checkout
Captured: 2026-06-30 12:00:00
────────────────────────────────────────────────
Fields:
┌────────────────────────────────────────────────┐
│ Field         Type    Mode        Value/Action │
├────────────────────────────────────────────────┤
│ First Name    text    [pinned ▼]  [Alice    ] │
│ Email         email   [pinned ▼]  [a@test.com] │
│ Address       text    [pinned ▼]  [123 Test ] │
│ Password      pass    [excluded▼] [—————————] │
│ Product SKU   text    [generated▼][Preview]   │
├────────────────────────────────────────────────┤
│ [Add Field]  [Save]  [Delete Profile]        │
└────────────────────────────────────────────────┘

Mode dropdown: pinned | generated | empty | excluded
- If pinned: input field shows/edits the pinned value
- If generated: button to preview generated value
- If empty/excluded: no input needed
```

Future enhancement: Allow user to manually add fields not auto-detected (useful for dynamic forms).

## 11. Error Handling & Safety

### 11.1 LLM Failures

- **Timeout** (>10 seconds) — Fall back to heuristics, show warning in menu
- **Invalid response** (malformed JSON) — Discard, use heuristics
- **Rate limit** — Queue and retry with exponential backoff

### 11.2 High-Risk Fields

Fields marked `isSafe: false` by the LLM:
- Password fields → excluded by default in capture modal
- Payment/card fields → excluded by default
- Sensitive PII (SSN, passport) → excluded by default

User can override in capture modal, but gets a warning.

### 11.3 Form Changes

If form structure changes (new fields, removed fields), the form signature changes, cache is invalidated, and LLM re-detects.

## 12. Testing (jsdom — established pattern)

1. **LLM integration:**
   - Mock LLM responses for field detection
   - Test caching (same form signature → cache hit)
   - Test cache invalidation (form signature changed)
   - Test error handling (LLM fails → heuristics)

2. **Field detection:**
   - Test detection accuracy (mock LLM returns correct types)
   - Test type mapping (detected type → canonical or custom)
   - Test confidence scores

3. **Profile capture:**
   - Fill form, click "Capture," verify profile created with correct fields/modes
   - Test that pinned values match filled values
   - Test inherited policy/country from active profile

4. **Profile editor:**
   - Load form-specific profile in editor
   - Change field modes (pinned → generated → empty)
   - Save and reload, verify changes persisted

5. **Fill flow:**
   - Generic profile + AI fill (standard fields from profile, custom from LLM)
   - Form-specific profile + fill (pinned fields use pins, generated use LLM, excluded skip)
   - Transient override ∩ policy (Fill name respects both)
   - Safety constraints (high-risk fields skip)

6. **Integration:**
   - Form appears → form-specific profile auto-matches (if URL/signature match)
   - User can manually select profile from dropdown
   - Full fill flow end-to-end

7. **Determinism:**
   - Mock LLM to return consistent field detections
   - Mock LLM generation to return deterministic values (for test repeatability)

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **LLM accuracy** — Field detection may misidentify custom fields | Test with real forms, use high confidence threshold (>0.8) for auto-fill, log low-confidence detections |
| **Cache staleness** — Form fields change but cache not invalidated | Use form signature (hash of field names/types) to detect changes; expire cache after 30 days |
| **Data leakage** — Sensitive form data (password, payment) auto-filled | Flag high-risk fields in LLM response, exclude by default in capture, require user confirmation |
| **LLM latency** — Field detection adds delay on first page load | Cache aggressively, fall back to heuristics on timeout, show "Analyzing form..." indicator |
| **Custom field generation quality** — Generated values don't fit field constraints | Use LLM to generate domain-specific values (SKU, customer ID), provide preview before fill, let user override |

## 14. Out of Scope / Next

- Real-time learning from user corrections (future spec)
- Multi-step forms with dynamic field dependencies (future spec)
- Per-form custom validation rules (future spec)
- LLM fine-tuning for VinCreative-specific field detection (future optimization)

## 15. Success Criteria

- User can quickly fill any form (standard or custom) using an active profile + AI detection
- User can capture and refine form-specific profiles for repeated testing
- Fill respects profile policy (country, groups, exclusions, pins) + form-specific overrides
- High-risk fields (password, payment) are safe-by-default
- LLM failures gracefully fall back to heuristics
- Field detection caching prevents repeated LLM calls on the same form
