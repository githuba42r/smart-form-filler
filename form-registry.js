// form-registry.js — window.SFFormRegistry: match form-specific profiles by URL pattern and form signature.
// Classic global script (no import/export). Chrome Extensions MV3.
;(function (root) {
  'use strict';

  /**
   * Extract origin + pathname from a full URL, discarding query string and fragment.
   *
   * @param {string} url  Full URL, e.g. "https://example.com/checkout?ref=promo#step2"
   * @returns {string}    Origin + pathname, e.g. "https://example.com/checkout"
   */
  function computeURLPattern(url) {
    var parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  }

  /**
   * Find the first form-specific profile whose formMetadata matches both
   * urlPattern and formSignature.
   *
   * A form-specific profile is any profile that has a `formMetadata` property
   * with `urlPattern` and `formSignature` fields. Generic profiles (no formMetadata)
   * are skipped.
   *
   * @param {string} urlPattern      Origin + pathname (output of computeURLPattern)
   * @param {string} formSignature   Deterministic hash identifying the form's field set
   * @param {object} [options]
   * @param {Array}  [options.mockProfiles]  Skip storage; use this array instead (for tests)
   * @returns {Promise<object|null>}  Matching profile, or null if none found
   */
  function findFormSpecificProfile(urlPattern, formSignature, options) {
    var opts = options || {};

    function search(profiles) {
      if (!Array.isArray(profiles)) return null;
      for (var i = 0; i < profiles.length; i++) {
        var p = profiles[i];
        if (
          p.formMetadata &&
          p.formMetadata.urlPattern === urlPattern &&
          p.formMetadata.formSignature === formSignature
        ) {
          return p;
        }
      }
      return null;
    }

    if (opts.mockProfiles) {
      return Promise.resolve(search(opts.mockProfiles));
    }

    return root.chrome.storage.local.get('profiles').then(function (data) {
      return search(data.profiles);
    });
  }

  root.SFFormRegistry = {
    computeURLPattern: computeURLPattern,
    findFormSpecificProfile: findFormSpecificProfile
  };

}(this));
