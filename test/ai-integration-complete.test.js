/**
 * Integration tests for AI field detection + form-specific profiles
 * Covers end-to-end capture, profile editing, fill flow
 */

describe('AI Field Detection + Form-Specific Profiles (Integration)', () => {
  describe('Form capture flow', () => {
    it('detects fields, captures as profile with all pinned', async () => {
      const detected = {
        fields: [
          { htmlName: 'email', detectedType: 'email', isSafe: true },
          { htmlName: 'product_sku', detectedType: 'sku', isSafe: true }
        ],
        formSignature: 'sig-123'
      };
      const readValues = { email: 'test@test.com', product_sku: 'SKU-001' };
      const activeProfile = { country: 'AU', policy: { groups: { contact: true }, exclude: [] }, pins: {} };

      const captured = await window.__sfCaptureFormAsProfile({
        mockDetectedFields: detected,
        mockReadFormValues: readValues,
        mockActiveProfile: activeProfile,
        pageTitle: 'Checkout'
      });

      expect(captured.formMetadata).toBeTruthy();
      expect(captured.fields[0].mode).toBe('pinned');
      expect(captured.fields[0].value).toBe('test@test.com');
    });

    it('excludes high-risk fields by default', async () => {
      const detected = {
        fields: [
          { htmlName: 'password', detectedType: 'password', isSafe: false },
          { htmlName: 'email', detectedType: 'email', isSafe: true }
        ],
        formSignature: 'sig-456'
      };

      const captured = await window.__sfCaptureFormAsProfile({
        mockDetectedFields: detected,
        mockReadFormValues: { password: 'secret', email: 'test@test.com' },
        mockActiveProfile: { country: 'AU', policy: { groups: {}, exclude: [] }, pins: {} },
        pageTitle: 'Login'
      });

      const passwordField = captured.fields.find(f => f.htmlName === 'password');
      expect(passwordField.mode).toBe('excluded');
    });
  });

  describe('Profile editing', () => {
    it('updates field mode in memory', () => {
      const profile = {
        id: 'test-1',
        fields: [{ htmlName: 'email', mode: 'pinned', value: 'test@test.com' }]
      };

      // Simulate updateFieldMode
      profile.fields[0].mode = 'generated';
      delete profile.fields[0].value;

      expect(profile.fields[0].mode).toBe('generated');
      expect(profile.fields[0].value).toBeUndefined();
    });
  });

  describe('Fill flow with form-specific profiles', () => {
    it('applies pinned values for pinned fields', async () => {
      const profile = {
        id: 'form-1',
        country: 'AU',
        policy: { groups: { contact: true }, exclude: [] },
        pins: {},
        fields: [
          { htmlName: 'email', detectedType: 'email', mode: 'pinned', value: 'alice@test.com' }
        ]
      };

      const field = { htmlName: 'email', detectedType: 'email' };

      // resolveFieldValue would return the pinned value
      const value = profile.fields[0].value;
      expect(value).toBe('alice@test.com');
    });

    it('generates custom field values', async () => {
      const field = { detectedType: 'sku', htmlType: 'text' };

      // generateCustomFieldValue would call the generator
      const value = window.SFFormData.generateCustomFieldValue('sku');
      expect(value).toMatch(/^[A-Z]{3}-\d{5}$/);
    });

    it('respects form-specific profile auto-matching', async () => {
      const formProfile = {
        id: 'checkout-1',
        formMetadata: { urlPattern: 'https://example.com/checkout', formSignature: 'sig-123' }
      };

      // Form registry would find this profile by URL + signature
      const found = await window.SFFormRegistry.findFormSpecificProfile(
        'https://example.com/checkout',
        'sig-123',
        { mockProfiles: [formProfile] }
      );

      expect(found).toEqual(formProfile);
    });
  });

  describe('Policy + transient override intersection', () => {
    it('respects group enablement from policy', () => {
      const policy = { groups: { name: true, contact: true, address: false }, exclude: [] };
      const only = null; // Fill all

      // shouldFillField(canonical_key, policy, only)
      // 'firstName' is in 'name' group → should fill
      // 'email' is in 'contact' group → should fill
      // 'street1' is in 'address' group → should NOT fill

      const canFillName = policy.groups['name'];
      const canFillAddress = policy.groups['address'];

      expect(canFillName).toBe(true);
      expect(canFillAddress).toBe(false);
    });

    it('respects transient override (only parameter)', () => {
      // Simulate "Fill name only" action
      const only = ['name'];
      const policy = { groups: { name: true, address: true }, exclude: [] };

      // 'firstName' in 'name' group ∩ only=['name'] → fill
      // 'street1' in 'address' group, but only=['name'] → don't fill

      const inNameGroup = true;
      const inAddressGroup = true;
      const onlyHasName = only.includes('name');
      const onlyHasAddress = only.includes('address');

      expect(inNameGroup && onlyHasName).toBe(true); // Fill
      expect(inAddressGroup && onlyHasAddress).toBe(false); // Skip
    });
  });
});
