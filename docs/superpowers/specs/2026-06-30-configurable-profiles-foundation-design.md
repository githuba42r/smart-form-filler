# Configurable Test-Data Profiles — Foundation Design

**Date:** 2026-06-30
**Status:** Approved design, pre-implementation
**Scope:** Foundation only. The AI-assisted profile builder / custom field-type
semantics (product fields, invoice line items, search fields, custom fields)
is **deferred to a separate spec (#3)** and is explicitly out of scope here.

---

## 1. Problem & Motivation

Today the extension fills forms from four **hardcoded** profiles in
`content.js` (`BUILTIN_PROFILES`). Every fill uses the same fixed identity
(e.g. "Jordan Ellis"), made superficially unique by a counter suffix appended
to email / username / lastName (`uniquifyProfile`). Two limitations:

1. **No variety.** It is always Jordan Ellis from Mansfield; addresses,
   suburbs, and names never change. This is poor for exercising a form with a
   range of realistic inputs.
2. **No selectivity.** Every fill completes every matching field. There is no
   way to deliberately leave a field blank (e.g. email) to exercise a form's
   own validation rules, and no way to fill only part of a form (name only,
   address only).

This foundation makes profiles **storage-backed, country-aware generator
configurations** that produce randomized, country-coherent data on each fill,
and lets the user control **which** fields each fill completes — both
persistently (per profile) and transiently (per fill, from the form-icon
menu / popup).

## 2. Goals

- Replace hardcoded profiles with editable, storage-backed profiles.
- Generate **randomized, country-coherent** values on every fill.
- Make address fields, labels, order, and required-ness **dynamic per country**,
  reusing the model from the `address-module` (vendored, no live dependency).
- Let a profile persistently declare **which field groups/fields** it fills,
  including per-field exclusions for validation testing.
- Let a profile **pin** specific fields to fixed values, overriding the
  generator (e.g. a routable email domain, a known company).
- Update the form-icon menu and popup to offer transient field-set overrides
  (name only / address only / name + address / all) and a profile selector.
- Provide a basic profile-management UI in Options (CRUD, **no AI**).

## 3. Non-Goals (deferred to #3)

- AI-assisted matching of arbitrary form fields to profile field descriptions.
- Custom field-type semantics: product fields, invoice line items, search
  fields, custom form fields.
- Any LLM call in the profile authoring or fill-selection path.

## 4. Key Decisions (resolved during brainstorming)

| # | Decision |
|---|----------|
| Sequencing | Build foundation first; AI builder is a later, separate spec. |
| Fill-set model | **B** — profile carries a persistent fill-policy; menu actions are transient overrides. |
| Profile management | **A** — basic CRUD (values/country/policy/clone/rename/delete/create), no AI. |
| Policy granularity | **A** — group toggles + per-field exclusions. |
| Country semantics | **A** — country drives a coherent address + phone block; extensible. |
| Value variety | **B** — randomized from per-country pools on every fill. |
| Pins | **B** — optional per-field pins override the generator. |
| Address model | Vendor the `address-module`'s framework-free schema files as a **static copy**; **no dependency** on the live module. |
| Code organization | **1** — new shared `formdata.js` module + vendored address files, classic global-namespaced scripts (the `recommendations.js` pattern). |
| Uniquifier | **Retired** — randomness makes fills inherently unique; counter kept only as a fallback when pins collapse variety. |

## 5. Architecture Overview

```
vendor/address-schemas.js     (window.SFAddress: schemas + getFieldConfig + validateZip + flag emoji)
formdata.js                   (window.SFFormData: locale pools + generatePerson + profile defaults/seed)
        |                              |
        |  (classic scripts, loaded before content.js and in options.html)
        v                              v
content.js  -- fillWithProfile() loads profile from storage, calls generatePerson(),
               applies policy ∩ menu-override, applies pins, fills via existing engine.
options.js  -- profile manager: country picker (flag+name), dynamic address sub-form
               via getFieldConfig(), group toggles / per-field exclude / pin controls.
popup.js    -- profile dropdown sourced from storage; existing fill buttons.
background.js -- seeds `profiles` on install/upgrade; guards with profilesVersion.
```

New/changed files:

- **`vendor/address-schemas.js`** (new) — static port of the address-module's
  `addressSchemas.js` + `addressSchemaProvider.js` + `countryCodeFormatter.js`,
  rewrapped as a single classic script assigning `window.SFAddress`. No Vue, no
  ES-module syntax, no external deps. Header comment records provenance
  (chromium-i18n via address-module) and that it is a refreshable static
  snapshot.
- **`formdata.js`** (new) — `window.SFFormData`: per-country pools, the
  `generatePerson` generator, profile schema defaults, and the builtin→config
  seed set.
- **`content.js`** (changed) — `fillWithProfile` rewired to storage + generator
  + policy gate; `uniquifyProfile`/counter removed from the main path.
- **`options.html` / `options.js`** (changed) — profile-manager UI.
- **`popup.html` / `popup.js`** (changed) — profile dropdown from storage.
- **`background.js`** (changed) — seeding + migration.
- **`manifest.json`** (changed) — add `vendor/address-schemas.js` and
  `formdata.js` to `content_scripts.js` (before `content.js`).

## 6. Data Model

### 6.1 Storage

`chrome.storage.local`:

- `profiles`: `Profile[]` — the user's profiles (seeded from builtins on first
  install).
- `profilesVersion`: number — seed/migration guard.
- `defaultProfile`: string — an `id` into `profiles` (existing key, semantics
  preserved).

### 6.2 Profile schema

```js
{
  id: 'au-personal',            // stable key; referenced by defaultProfile + menus
  label: 'AU Personal',
  country: 'AU',                // ISO 3166-1 alpha-2; drives address schema + pools
  randomize: true,              // foundation: always true (decision B)
  policy: {
    groups: {                   // group-level on/off
      name: true, contact: true, address: true, account: true, misc: false
    },
    exclude: ['email']          // per-field exclusions within enabled groups
  },
  pins: {                       // fixed overrides; unpinned fields randomize
    emailDomain: 'example.com.au',
    business: 'Aether Dynamics Pty Ltd'   // canonical key (engine category: company)
    // any canonical field key may be pinned, e.g. zip: '4000'
  }
}
```

Notes:

- **Field groups** map to a `FIELD_GROUPS` table extended to the full set:
  `name` (firstName, lastName, fullName, username), `contact` (email, phone),
  `address` (street1, street2, city, state, zip, country), `account`
  (password, dob), `misc` (company, genericText). The exact assignment lives in
  one table shared by the generator, the policy gate, and the CRUD UI.
- **`pins`** is a flat map keyed by canonical field key, plus the special
  `emailDomain` pin (applied to the generated local-part rather than replacing
  the whole email). A pinned key always wins over generated values.
- **`exclude`** lists canonical field keys to skip even when their group is on.

### 6.3 Canonical field vocabulary

From the vendored address schema (Google libaddressinput style):

`street1, street2, city, state, zip` plus
`firstname, lastname, business, phone, email, country`.

A thin adapter maps these to the fill engine's existing internal category names
so the working cascade/combobox/Places logic is untouched:

| Canonical (schema) | Engine category |
|--------------------|-----------------|
| street1            | address1        |
| street2            | address2        |
| city               | city            |
| state              | state           |
| zip                | postcode        |
| firstname          | firstName       |
| lastname           | lastName        |
| business           | company         |
| phone, email, country | phone, email, country |

## 7. Address Model (vendored, static)

Ported verbatim (data) from `~/src/vue/address-module`:

- **`addressSchemas.js`** — per-country objects: `fmt` (layout/order via
  `%A %C %S %Z %N %O %n`), `require` (mandatory subset of `ACSZ`), `zip` (regex),
  `zip_ex` (example), `*_name_type` (vocabulary: `state`/`province`/`emirate`…,
  `city`/`suburb`/`post_town`…, `zip`/`postcode`/`eircode`…), optional
  `*_label` overrides (e.g. AU `State/Territory`).
- **`addressSchemaProvider.js`** — `getSchema(country)`,
  `getFieldConfig(country)` → ordered field list with `{key, label, required,
  visible}`, `validateZip(zip, country)`, `getZipHint(country)`.
- **`countryCodeFormatter.js`** — `countryCodeToFlagEmoji(code)` (with the
  `UK→GB` special case from the source).

All three are rewrapped into one classic script (`window.SFAddress`). Behaviour
parity with the address-module's dynamic-field rendering is the acceptance bar.

## 8. Generator (`formdata.js`)

### 8.1 Locale pools

A registry keyed by country code; adding a country is one object:

```js
LOCALES = {
  AU: {
    firstNames: [...], lastNames: [...],
    // coherent rows: state/city/postcode mutually consistent and matching
    // the country's zip regex
    addresses: [ { state:'QLD', city:'Brisbane', postcodes:['4000','4101','4122'] },
                 { state:'VIC', city:'Melbourne', postcodes:['3000','3008'] }, ... ],
    streets: ['Riverside Drive','Queen Street', ...],
    phoneTemplate: '04## ### ###',
    emailDomains: ['example.com.au','testmail.dev']
  },
  US: { ...'(###) ###-####', states→cities→ZIPs, ... }
}
```

Foundation ships **AU + US**. Countries without a pool fall back to a generic
pool but still honour their address *schema* (labels/required) for the CRUD form.

### 8.2 `generatePerson(profile, opts)`

Pure function:

1. Pick a coherent address **row** for `profile.country`; choose a postcode from
   the row and assert it matches the schema's `zip` regex (guarantees the
   country→state cascade + validation succeed).
2. Pick first/last name; derive `email` (`first.last@<domain>`) and `username`.
3. Format `phone` from `phoneTemplate`.
4. Produce the **full** canonical value map (every field), regardless of policy.
5. Apply `pins` last: `emailDomain` rewrites the email domain; any other pinned
   key replaces its value outright.
6. **Seedable randomness:** `opts.seed`/index makes output deterministic for
   tests; absent a seed, fills are random.

The generator does **not** apply the policy — it returns everything; the fill
engine decides what to write. This lets one generated person be filled fully or
partially depending on the transient menu override.

## 9. Fill Engine Changes (`content.js`)

Detection, visibility, section/icon logic, combobox/vue-select fill, Places
suppression, and cascade passes are **unchanged**. Three insertions:

1. **Profile source swap.** `fillWithProfile(profileKey, opts)`:
   load profile config from `profiles` → `SFFormData.generatePerson(config)` →
   value map. Remove `BUILTIN_PROFILES` lookups and `uniquifyProfile`/counter
   from this path.
2. **Policy gate.** Effective policy = profile `policy` **∩** transient override
   `opts.only` (one of `['name']`, `['address']`, `['name','address']`, or
   `null` = all). A field is written only if: its group is enabled in
   `policy.groups`, **and** its key is not in `policy.exclude`, **and** (if
   `opts.only` is set) its group is in `opts.only`. Pins still provide the value
   for fields that pass the gate.
3. **Empty-on-purpose.** Gated-out fields are simply skipped (never
   filled-then-cleared), so a form's native empty/required state is preserved
   for validation testing.

## 10. UI Changes

### 10.1 Form-icon menu (`content.js`)

`Fill name` · `Fill address` · `Fill name + address` · `Fill all` · **profile
dropdown** (from `profiles`, default = `defaultProfile`) · `Clear`.
The four fill actions set `opts.only`; the dropdown sets which profile generates
the data.

### 10.2 Popup (`popup.html` / `popup.js`)

Replace the static profile `<select>` with one populated from `profiles`
(default selected). Existing Quick Smart Fill / AI / Re-scan / Clear retained.
Scope display unchanged.

### 10.3 Options profile manager (`options.html` / `options.js`)

- **List** of profiles with create-blank / clone / rename / delete.
- **Editor** per profile:
  - **Country picker** built from `SFAddress` schemas + `countryCodeToFlagEmoji`
    → "🇦🇺 Australia".
  - **Dynamic address sub-form**: on country change, re-render address fields
    from `getFieldConfig(country)` — correct field set, country-specific labels
    (Suburb / State-Territory / Postcode vs City / State / ZIP), order from
    `fmt`, required flags, zip hint from `getZipHint`.
  - **Group toggles** (name / contact / address / account / misc).
  - **Per-field exclude** checkboxes within enabled groups.
  - **Pin** control per field (pin to a typed fixed value; the `emailDomain`
    pin offered on the email field).
- No AI anywhere in this UI.

## 11. Seeding & Migration (`background.js`)

- On install/upgrade: if `profiles` is absent **or** `profilesVersion` is older
  than current, seed/migrate from the four builtins converted to generator
  configs:
  - `au-personal` → AU, all groups on, no pins.
  - `au-business` → AU, all groups on, `pins.business` set, `misc` on.
  - `us-test` → US, all groups on.
  - `minimal` → edge-case policy (sparse groups) for boundary testing.
- Set `profilesVersion` to current.
- `defaultProfile` preserved; if it points at a missing id, fall back to the
  first profile.

## 12. Manifest

Add to `content_scripts[0].js`, **before** `content.js`:
`vendor/address-schemas.js`, `formdata.js`. Add both (plus `recommendations.js`
where relevant) as `<script>` tags in `options.html`. No new permissions.

## 13. Testing (jsdom — established pattern)

Deterministic via `generatePerson(profile, {seed})`:

1. Generated `zip` matches the country's schema `zip` regex (AU + US).
2. Generated address row is internally coherent (state/city/postcode from the
   same row).
3. Policy ∩ override intersection fills exactly the expected field set
   (name-only, address-only, name+address, all, and an `exclude:['email']`
   case leaves email untouched).
4. Pins override generated values; `emailDomain` pin rewrites only the domain.
5. `getFieldConfig` yields the correct AU vs US field set + labels + required.
6. Existing vue-select country/state cascade test still passes when fed
   generated data.

## 14. Risks & Mitigations

- **Vendored data drift** vs the live address-module — accepted; static copy by
  decision, refreshable by hand, provenance noted in the file header.
- **Countries without a locale pool** — generic pool fallback; address *schema*
  still drives the CRUD labels so the form is correct even where pooled data is
  sparse.
- **Pins collapsing variety / collisions** — counter uniquifier retained only as
  a fallback applied when pinned identity fields would otherwise repeat.
- **Storage migration** — `profilesVersion` guard prevents clobbering
  user-edited profiles on upgrade.

## 15. Out of Scope / Next (Spec #3)

AI-assisted profile authoring and matching of arbitrary/custom form fields
(product, invoice line items, search, custom) to profile field descriptions —
its own spec → plan → implementation cycle, built on this foundation's
storage-backed profile model and CRUD UI.
