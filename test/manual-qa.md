# Task 15: Manual Verification Checklist

## Test Environment
- Extension: SmartForm Filler v1.1.0
- Test Site: https://vinum-dev.pos.dev.z42z.com/
- Date Tested: [DATE]
- Tester: [YOUR NAME]

## Test Cases

### 1. Options Profile Manager
- [ ] Open Options → Test Profiles: 4 seeded profiles displayed (au-personal, au-business, us-test, minimal)
- [ ] Create new profile: works, generates unique ID
- [ ] Clone profile: creates copy with "(copy)" label
- [ ] Rename profile: updates label correctly
- [ ] Delete profile: removes profile from list, refuses to delete if it's the last one
- [ ] Country AU → US: address fields re-render (Suburb→City, State/Territory→State, Postcode→ZIP)

### 2. Create-Customer Modal Form Icon Menu
- [ ] Form icon appears at top-right of create-customer modal
- [ ] **Fill name** button: fills only name/contact, address empty
- [ ] **Fill address** button: fills address + country/state cascade resolves correctly
- [ ] **Fill all** button: fills all fields per profile policy
- [ ] **Fill all** twice: generates different names/addresses (randomization)
- [ ] Profile dropdown: shows all profiles, can select different ones
- [ ] **Clear fields** button: empties all filled fields

### 3. Pin & Exclude Testing
- [ ] Set profile `exclude:['email']` + `pins.emailDomain: 'example.test'`
- [ ] Fill with excluded email policy: email field stays empty
- [ ] Re-enable email: fill uses pinned domain (example.test)
- [ ] Verify other fields (name, address, phone) still fill normally

### 4. Popup Model Selection
- [ ] Popup shows profile dropdown
- [ ] Selecting different profiles works
- [ ] Quick Smart Fill uses selected profile
- [ ] Scope display shows correct field count

## Results Summary
- **Tests Passed**: [X/14]
- **Issues Found**: [DESCRIBE ANY]
- **Notes**: [ANY ADDITIONAL OBSERVATIONS]

## Sign-off
- Tester: ________________
- Date: ________________
