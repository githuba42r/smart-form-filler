// vendor/address-schemas.js
// Static port of ~/src/vue/address-module/src/utils/{addressSchemas,
// addressSchemaProvider,countryCodeFormatter}.js — framework-free.
// Provenance: chromium-i18n.appspot.com/ssl-address via address-module.
// Refresh by hand if the source schema set changes. DO NOT add a build dep.
;(function (root) {
  'use strict';

  // ----- verbatim from addressSchemas.js (drop `export`) -----
  const DEFAULT_SCHEMA = {
    name: 'Default',
    fmt: '%N%n%O%n%A%n%C',
    require: 'AC',
    state_name_type: 'province',
    locality_name_type: 'city',
    zip_name_type: 'postal'
  };

  const ADDRESS_SCHEMAS = {
    AU: {
      name: 'Australia',
      fmt: '%O%n%N%n%A%n%C %S %Z',
      require: 'ACSZ',
      zip: '\\d{4}',
      zip_ex: '4113',
      state_name_type: 'state',
      state_label: 'State/Territory',
      locality_name_type: 'suburb',
      zip_name_type: 'postcode'
    },
    US: {
      name: 'United States',
      fmt: '%N%n%O%n%A%n%C, %S %Z',
      require: 'ACSZ',
      zip: '\\d{5}([ \\-]\\d{4})?',
      zip_ex: '62704',
      state_name_type: 'state',
      locality_name_type: 'city',
      zip_name_type: 'zip'
    },
    CA: {
      name: 'Canada',
      fmt: '%N%n%O%n%A%n%C %S %Z',
      require: 'ACSZ',
      zip: '[ABCEGHJKLMNPRSTVXY]\\d[ABCEGHJ-NPRSTV-Z] ?\\d[ABCEGHJ-NPRSTV-Z]\\d',
      zip_ex: 'A1A 1A1',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    GB: {
      name: 'United Kingdom',
      fmt: '%N%n%O%n%A%n%C%n%S%n%Z',
      require: 'ACZ',
      zip: '[A-Za-z]{1,2}\\d[A-Za-z\\d]? ?\\d[A-Za-z]{2}',
      zip_ex: 'SW1A 1AA',
      state_name_type: 'county',
      locality_name_type: 'post_town',
      zip_name_type: 'postcode'
    },
    NZ: {
      name: 'New Zealand',
      fmt: '%N%n%O%n%A%n%D%n%C %Z',
      require: 'ACZ',
      zip: '\\d{4}',
      zip_ex: '6011',
      state_name_type: 'region',
      locality_name_type: 'city',
      zip_name_type: 'postcode'
    },
    JP: {
      name: 'Japan',
      fmt: '%Z%n%S%n%C%n%A%n%O%n%N',
      require: 'ACSZ',
      zip: '\\d{3}-?\\d{4}',
      zip_ex: '100-0001',
      state_name_type: 'prefecture',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    BE: {
      name: 'Belgium',
      fmt: '%O%n%N%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{4}',
      zip_ex: '1000',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    DE: {
      name: 'Germany',
      fmt: '%N%n%O%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{5}',
      zip_ex: '10115',
      state_name_type: 'state',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    FR: {
      name: 'France',
      fmt: '%O%n%N%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{2} ?\\d{3}',
      zip_ex: '75001',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    IT: {
      name: 'Italy',
      fmt: '%N%n%O%n%A%n%Z %C %S',
      require: 'ACSZ',
      zip: '\\d{5}',
      zip_ex: '00187',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    ES: {
      name: 'Spain',
      fmt: '%N%n%O%n%A%n%Z %C %S',
      require: 'ACSZ',
      zip: '\\d{5}',
      zip_ex: '28013',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    NL: {
      name: 'Netherlands',
      fmt: '%O%n%N%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{4} ?[A-Za-z]{2}',
      zip_ex: '1012 AB',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    IE: {
      name: 'Ireland',
      fmt: '%N%n%O%n%A%n%D%n%C%n%S%n%Z',
      require: 'AC',
      zip: '[A-Za-z]\\d[\\dWw] ?[\\dA-Za-z]{4}',
      zip_ex: 'D02 X285',
      state_name_type: 'county',
      locality_name_type: 'city',
      zip_name_type: 'eircode'
    },
    SG: {
      name: 'Singapore',
      fmt: '%N%n%O%n%A%nSINGAPORE %Z',
      require: 'AZ',
      zip: '\\d{6}',
      zip_ex: '048624',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    HK: {
      name: 'Hong Kong',
      fmt: '%S%n%C%n%A%n%O%n%N',
      require: 'AS',
      state_name_type: 'area',
      locality_name_type: 'district',
      zip_name_type: 'postal'
    },
    CN: {
      name: 'China',
      fmt: '%Z%n%S%C%D%n%A%n%O%n%N',
      require: 'ACSZ',
      zip: '\\d{6}',
      zip_ex: '100006',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    IN: {
      name: 'India',
      fmt: '%N%n%O%n%A%n%C %Z%n%S',
      require: 'ACSZ',
      zip: '\\d{6}',
      zip_ex: '110001',
      state_name_type: 'state',
      locality_name_type: 'city',
      zip_name_type: 'pin'
    },
    ZA: {
      name: 'South Africa',
      fmt: '%N%n%O%n%A%n%D%n%C%n%Z',
      require: 'ACZ',
      zip: '\\d{4}',
      zip_ex: '8001',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    BR: {
      name: 'Brazil',
      fmt: '%O%n%N%n%A%n%D%n%C-%S%n%Z',
      require: 'ACSZ',
      zip: '\\d{5}-?\\d{3}',
      zip_ex: '01310-100',
      state_name_type: 'state',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    MX: {
      name: 'Mexico',
      fmt: '%N%n%O%n%A%n%D%n%Z %C, %S',
      require: 'ACSZ',
      zip: '\\d{5}',
      zip_ex: '06000',
      state_name_type: 'state',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    CH: {
      name: 'Switzerland',
      fmt: '%O%n%N%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{4}',
      zip_ex: '8001',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    AT: {
      name: 'Austria',
      fmt: '%O%n%N%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{4}',
      zip_ex: '1010',
      state_name_type: 'state',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    SE: {
      name: 'Sweden',
      fmt: '%O%n%N%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{3} ?\\d{2}',
      zip_ex: '111 36',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    NO: {
      name: 'Norway',
      fmt: '%N%n%O%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{4}',
      zip_ex: '0150',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    DK: {
      name: 'Denmark',
      fmt: '%N%n%O%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{4}',
      zip_ex: '1550',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    FI: {
      name: 'Finland',
      fmt: '%O%n%N%n%A%n%Z %C',
      require: 'ACZ',
      zip: '\\d{5}',
      zip_ex: '00100',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    KR: {
      name: 'South Korea',
      fmt: '%S %C%D%n%A%n%O%n%N%n%Z',
      require: 'ACSZ',
      zip: '\\d{5}',
      zip_ex: '03045',
      state_name_type: 'do_si',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    TW: {
      name: 'Taiwan',
      fmt: '%Z%n%S%C%n%A%n%O%n%N',
      require: 'ACSZ',
      zip: '\\d{3}(\\d{2,3})?',
      zip_ex: '110',
      state_name_type: 'county',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    TH: {
      name: 'Thailand',
      fmt: '%N%n%O%n%A%n%D %C%n%S %Z',
      require: 'ACZ',
      zip: '\\d{5}',
      zip_ex: '10330',
      state_name_type: 'province',
      locality_name_type: 'district',
      zip_name_type: 'postal'
    },
    MY: {
      name: 'Malaysia',
      fmt: '%N%n%O%n%A%n%D%n%Z %C%n%S',
      require: 'ACZ',
      zip: '\\d{5}',
      zip_ex: '50088',
      state_name_type: 'state',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    ID: {
      name: 'Indonesia',
      fmt: '%N%n%O%n%A%n%C%n%S %Z',
      require: 'ACZ',
      zip: '\\d{5}',
      zip_ex: '10310',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    PH: {
      name: 'Philippines',
      fmt: '%N%n%O%n%A%n%D, %C%n%Z %S',
      require: 'ACZ',
      zip: '\\d{4}',
      zip_ex: '1226',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    VN: {
      name: 'Vietnam',
      fmt: '%N%n%O%n%A%n%C%n%S %Z',
      require: 'AC',
      zip: '\\d{5}\\d?',
      zip_ex: '100000',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    AE: {
      name: 'United Arab Emirates',
      fmt: '%N%n%O%n%A%n%S',
      require: 'AS',
      state_name_type: 'emirate',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    },
    SA: {
      name: 'Saudi Arabia',
      fmt: '%N%n%O%n%A%n%D%n%C %Z',
      require: 'ACZ',
      zip: '\\d{5}',
      zip_ex: '12214',
      state_name_type: 'province',
      locality_name_type: 'city',
      zip_name_type: 'postal'
    }
  };

  // The platform's country lists use 'UK' for the United Kingdom rather
  // than the ISO 3166-1 'GB' the schema dataset is keyed by.
  ADDRESS_SCHEMAS.UK = ADDRESS_SCHEMAS.GB;

  // ----- verbatim from addressSchemaProvider.js (drop `import` + `export`) -----
  const STATE_LABELS = {
    state: 'State',
    province: 'Province',
    prefecture: 'Prefecture',
    county: 'County',
    region: 'Region',
    do_si: 'Do/Si',
    area: 'Area',
    district: 'District',
    department: 'Department',
    emirate: 'Emirate',
    island: 'Island',
    oblast: 'Oblast',
    parish: 'Parish'
  };

  const LOCALITY_LABELS = {
    city: 'City',
    suburb: 'Suburb',
    post_town: 'Town/City',
    district: 'District'
  };

  const ZIP_LABELS = {
    zip: 'ZIP Code',
    postal: 'Postal Code',
    postcode: 'Postcode',
    pin: 'PIN Code',
    eircode: 'Eircode'
  };

  function normaliseCountryCode(countryCode) {
    return (countryCode || '').toString().trim().toUpperCase();
  }

  function getSchema(countryCode) {
    return ADDRESS_SCHEMAS[normaliseCountryCode(countryCode)] || DEFAULT_SCHEMA;
  }

  function hasSchema(countryCode) {
    return Object.prototype.hasOwnProperty.call(ADDRESS_SCHEMAS, normaliseCountryCode(countryCode));
  }

  const FMT_TOKEN_TO_FIELD = { A: 'street', C: 'city', S: 'state', Z: 'zip' };

  function getFieldOrder(countryCode) {
    const schema = getSchema(countryCode);
    const order = [];
    const fmt = schema.fmt || DEFAULT_SCHEMA.fmt;
    for (let i = 0; i < fmt.length - 1; i++) {
      if (fmt[i] !== '%') { continue; }
      const field = FMT_TOKEN_TO_FIELD[fmt[i + 1]];
      if (field && !order.includes(field)) {
        order.push(field);
      }
    }
    if (!order.includes('street')) {
      order.unshift('street');
    }
    return order;
  }

  function getFieldConfig(countryCode) {
    const schema = getSchema(countryCode);
    const require = schema.require || '';
    const fmt = schema.fmt || DEFAULT_SCHEMA.fmt;

    return {
      order: getFieldOrder(countryCode),
      fields: {
        street1: {
          show: true,
          required: require.indexOf('A') !== -1,
          label: 'Address'
        },
        street2: {
          show: true,
          required: false,
          label: 'Apartment, suite, level etc (Optional)'
        },
        city: {
          show: fmt.indexOf('%C') !== -1,
          required: require.indexOf('C') !== -1,
          label: schema.locality_label || LOCALITY_LABELS[schema.locality_name_type] || LOCALITY_LABELS.city
        },
        state: {
          show: fmt.indexOf('%S') !== -1,
          required: require.indexOf('S') !== -1,
          label: schema.state_label || STATE_LABELS[schema.state_name_type] || STATE_LABELS.province
        },
        zip: {
          show: fmt.indexOf('%Z') !== -1,
          required: require.indexOf('Z') !== -1,
          label: schema.zip_label || ZIP_LABELS[schema.zip_name_type] || ZIP_LABELS.postal,
          format: schema.zip || null,
          example: schema.zip_ex || null
        }
      }
    };
  }

  function validateZip(zip, countryCode) {
    const value = (zip || '').toString().trim();
    if (!value) {
      return { valid: true };
    }
    const schema = getSchema(countryCode);
    if (!schema.zip) {
      return { valid: true };
    }
    const valid = new RegExp('^(?:' + schema.zip + ')$').test(value);
    return {
      valid,
      example: schema.zip_ex || null
    };
  }

  function getZipHint(countryCode) {
    const schema = getSchema(countryCode);
    return schema.zip_ex ? `e.g. ${schema.zip_ex}` : null;
  }

  // ----- verbatim from countryCodeFormatter.js -----
  function countryCodeToFlagEmoji(countryCode) {
    if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) {
      return '';
    }
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
  }

  // ----- new helper for the options country picker -----
  function listCountries() {
    const seen = new Set();
    return Object.keys(ADDRESS_SCHEMAS).filter(code => {
      const s = ADDRESS_SCHEMAS[code];
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    }).map(code => {
      const flag = countryCodeToFlagEmoji(code === 'UK' ? 'GB' : code);
      const name = ADDRESS_SCHEMAS[code].name || code;
      return { code, name, flag, label: flag ? `${flag} ${name}` : name };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  root.SFAddress = {
    ADDRESS_SCHEMAS,
    DEFAULT_SCHEMA,
    getSchema,
    hasSchema,
    getFieldOrder,
    getFieldConfig,
    validateZip,
    getZipHint,
    countryCodeToFlagEmoji,
    listCountries
  };
})(typeof window !== 'undefined' ? window : globalThis);
