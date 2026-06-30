# Manual Verification Checklist — Spec #3 (AI Field Detection)

**Date**: 2026-06-30  
**Scope**: End-to-end manual testing of AI-assisted field detection + form-specific profiles

---

## Pre-Flight Checklist

- [ ] Extension is loaded in Chrome dev mode (manifest version 1.1.0)
- [ ] All 6 content scripts registered in manifest.json
- [ ] No TypeErrors in background.js console (LLM proxy handler)
- [ ] Extension popup opens with profile dropdown visible

---

## Test 1: Form Icon Menu & Profile Selection

**Steps:**
1. Navigate to any form (e.g., https://example.com/signup)
2. Icon should appear in top-right corner
3. Click icon → form-icon menu should appear
4. Verify menu contains:
   - [ ] "Fill name" button
   - [ ] "Fill address" button
   - [ ] "Fill name + address" button
   - [ ] "Fill all" button
   - [ ] Profile dropdown (showing au-personal, au-business, us-test, minimal)
   - [ ] "Capture form as profile" button
   - [ ] "Clear" button

**Expected outcome**: All buttons present, dropdown selectable

---

## Test 2: Form Capture

**Steps:**
1. Fill out a test form manually:
   - Email: `alice@test.com`
   - Name: `Alice Smith`
   - Address: `123 Main St`
   - Product SKU: `TEST-001` (if present)
2. Click "Capture form as profile" button
3. Modal should appear listing detected fields
4. Verify high-risk fields (password, card) are unchecked by default
5. Confirm capture
6. Alert should show: "Profile captured! Edit in Options to refine."

**Expected outcome**: Profile created and saved to chrome.storage.local

---

## Test 3: Profile Manager (Options)

**Steps:**
1. Go to Options → "Test Profiles" tab
2. Verify newly captured profile appears in list
3. Click the profile to open editor
4. Verify form-specific profile section shows:
   - [ ] Form URL
   - [ ] Captured timestamp
   - [ ] Fields table with columns: Field Name, HTML Type, Mode, Value/Action
5. For each field, verify dropdown options: pinned, generated, empty, excluded

**Expected outcome**: Profile editor loads, field controls visible and functional

---

## Test 4: Profile Editing (Mode Changes)

**Steps:**
1. In profile editor, select an email field
2. Change mode from "pinned" to "generated"
3. Click "Preview" button
4. Verify generated value is shown (e.g., a fake email)
5. Change another field's mode to "empty"
6. Click "Save Profile"
7. Verify: `chrome.storage.local` contains updated profile

**Expected outcome**: Modes change in-memory, values persist to storage

---

## Test 5: Form Re-Visit (Auto-Apply)

**Steps:**
1. Navigate back to the form used in Test 2
2. Open form-icon menu
3. Profile dropdown should auto-select the form-specific profile
4. (Or user can manually select it)

**Expected outcome**: Form-specific profile matches and is available for filling

---

## Test 6: Fill Actions with Policy Gate

**Steps:**
1. Ensure profile has policy: `groups: { name: true, contact: true, address: false }`
2. Click "Fill address" button
3. Verify: only address fields are filled (e.g., street, city, zip)
4. Verify: email and phone are NOT filled (contact group disabled)
5. Click "Clear"
6. Click "Fill name" button
7. Verify: only name fields are filled (first name, last name)
8. Verify: address and email are NOT filled

**Expected outcome**: Transient override (Fill name/address/all) respects policy groups

---

## Test 7: Custom Field Generation

**Steps:**
1. Navigate to a form with non-standard fields:
   - `product_sku` → should generate SKU-##### pattern
   - `customer_id` → should generate CUST-###### pattern
   - Custom field → should generate text_<type>_#### pattern
2. Use a form-specific profile with mode='generated' for custom fields
3. Click "Fill all"
4. Verify custom fields are filled with generated values

**Expected outcome**: Custom fields are intelligently generated, not left blank

---

## Test 8: LLM Proxy Integration

**Prerequisites**: Ollama or OpenRouter configured in extension settings

**Steps:**
1. Open extension options → Settings (if available) or check chrome.storage.sync
2. Verify LLM provider is set (ollama or openrouter)
3. Trigger form field detection (navigate to a form, check background.js console)
4. Verify: `callLLM` message handler receives the detection request
5. Verify: LLM response is parsed and field types are detected

**Expected outcome**: No errors in console, field detection completes within 10 seconds

---

## Test 9: Selective Fill (Transient Override)

**Steps:**
1. Use a generic profile (e.g., au-personal)
2. Navigate to a multi-section form (name, email, address, phone, account)
3. Click "Fill name" → only name fields filled
4. Click "Clear"
5. Click "Fill address" → only address fields filled
6. Click "Clear"
7. Click "Fill name + address" → both name and address filled
8. Click "Clear"
9. Click "Fill all" → entire form filled

**Expected outcome**: Each transient action fills only the specified group

---

## Test 10: High-Risk Field Safety

**Steps:**
1. Create a profile with a password field
2. Verify password field is marked mode='excluded' or mode='empty'
3. Click "Fill all"
4. Verify password field remains empty (not filled)
5. Edit profile to set password to pinned
6. Try to save → should warn or allow with confirmation

**Expected outcome**: Password fields never auto-filled without explicit user action

---

## Test 11: Form-Specific vs Generic Profile Precedence

**Steps:**
1. Have two profiles:
   - Generic: au-personal
   - Form-specific: checkout-example.com
2. Navigate to https://example.com/checkout
3. Dropdown should auto-select form-specific profile (if URL + signature match)
4. Change selection to au-personal
5. Click "Fill all" → uses au-personal data
6. Reselect form-specific profile
7. Click "Fill all" → uses form-specific data (different values)

**Expected outcome**: Form-specific profiles take precedence when URL + signature match; user can override

---

## Test 12: Edge Cases

**Steps:**
1. **Empty profile**: Create a profile with all fields set to mode='empty', click Fill → nothing should be filled
2. **Mixed modes**: Create profile with name=pinned, email=generated, address=excluded
   - Fill → name uses pinned value, email uses generated, address skipped
3. **No form-specific match**: Visit unknown form → dropdown shows only generic profiles
4. **Network timeout**: If LLM configured, simulate timeout
   - Should gracefully fall back to heuristics or show warning

**Expected outcome**: All edge cases handled without crashes

---

## Final Sign-Off

- [ ] All tests passed
- [ ] No TypeErrors or unhandled exceptions
- [ ] Form filling works as expected
- [ ] Profile capture and editing work
- [ ] AI detection (LLM or heuristics) works
- [ ] Policy gates and transient overrides work

**Tester**: _______________  
**Date**: _______________  
**Notes**: _______________
