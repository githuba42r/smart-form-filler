# SmartForm Filler - Dev AI Assistant

Intelligent Chrome / Brave / Edge browser extension that helps developers quickly fill test forms on development, staging, and localhost sites.

It intelligently scans form fields (labels, placeholders, names, types, autocomplete hints) and offers **heuristic-based** or **local AI-powered (Ollama)** pre-filling with realistic Australian-focused test data.

Perfect for:
- Address / checkout forms
- Create account / signup flows
- Admin dashboards
- Any repetitive test data entry during development

## Features

- **Smart field detection** — Finds labels even in complex layouts (aria-*, wrapping labels, previous siblings, placeholders, name/id)
- **Heuristic filler** — Fast, zero-config, maps fields to realistic data using keyword + type rules
- **Local AI filler (Ollama)** — Sends field structure + page context to your local LLM and asks for consistent, context-aware test values (name, email, address, phone etc all match one person)
- **Multiple built-in profiles** — AU Personal (Mansfield/Brisbane), AU Business, US Test, Minimal/Edge
- **One-click from popup** — Auto-scans on open, choose profile, fill
- **Privacy first** — When using Ollama everything stays on your machine
- **Framework friendly** — Dispatches proper `input` + `change` + `blur` events so React, Vue, Angular, etc. pick up the values
- **Keyboard friendly** — `/` focuses actions in popup

## Installation (Unpacked / Development)

1. Download or clone this folder.
2. Open Chrome/Brave/Edge → go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `smart-form-filler-extension` folder
6. Pin the extension to your toolbar for easy access

The extension icon will appear. Click it on any form page.

> **Note on icons**: Placeholder icons are referenced in manifest. The extension works without them (Chrome shows default puzzle icon). You can add 16/48/128 px PNGs later in an `icons/` folder if desired.

## Quick Start

1. Navigate to your dev site form (localhost, staging, etc.)
2. Click the **SmartForm Filler** extension icon
3. It auto-scans → shows field count + detected labels
4. Choose a profile (default is AU Personal)
5. Click **⚡ Quick Smart Fill (Heuristic)** for instant results
6. Or click **🧠 Fill with Local AI (Ollama)** for smarter, context-aware data

## Ollama Setup (Recommended for AI mode)

The AI mode is powered by **your local Ollama instance** — no API keys, no data leaves your computer.

### One-time setup

```bash
# 1. Make sure Ollama is installed and running
ollama --version

# 2. Pull a strong model (llama3.1 is excellent)
ollama pull llama3.1

# Alternative strong JSON models:
# ollama pull qwen2.5-coder
# ollama pull gemma2
# ollama pull phi4
```

### Allow Chrome extension to talk to Ollama

By default Ollama blocks browser extension origins for security. You must explicitly allow it:

```bash
# Run Ollama with the right env var (one time or in your service file)
OLLAMA_ORIGINS=chrome-extension://* ollama serve
```

If you run Ollama as a systemd service on Linux (common on Arch, Fedora, etc.):

```bash
sudo systemctl edit ollama.service
```

Add under `[Service]`:

```
Environment="OLLAMA_ORIGINS=chrome-extension://*"
```

Then `systemctl daemon-reload && systemctl restart ollama`

### Test in the extension

1. Open the extension popup on a form page
2. Click the **Settings & AI Config** link at the bottom
3. Click **Test Connection & Model**
4. You should see success + list of available models

If it fails:
- Is Ollama running?
- Did you set `OLLAMA_ORIGINS` correctly?
- Try `http://127.0.0.1:11434` instead of `localhost` in settings

## How the AI Mode Works

When you click "Fill with Local AI":

1. Content script extracts clean field list (label, name, type, placeholder) + page title / hostname as context
2. Background sends a carefully engineered prompt to Ollama asking for **consistent JSON** test data
3. Ollama returns `{ "0": "Jordan Ellis", "1": "jordan.ellis.dev@example.com.au", ... }`
4. Content script applies the values using the same robust element + event logic as heuristic mode

The prompt strongly instructs the model to:
- Keep one coherent person across the form
- Use Australian (QLD/Brisbane) data by default
- Output clean parseable JSON only

## Profiles

Built-in profiles are optimized for Australian developers:

| Profile          | Use Case                     | Notes                              |
|------------------|------------------------------|------------------------------------|
| AU Personal      | Most address / signup forms  | Mansfield/Brisbane focused         |
| AU Business      | Company / B2B forms          | Includes company name + landline   |
| US Test          | International forms          | US address + phone format          |
| Minimal          | Edge case / validation tests | Very short values, minimal data    |

You can change the default profile in **Settings**.

### Editing a profile

Every known field (name, contact, address, password, date of birth, gender, company, free text) has one row with three modes:

- **Random** — a new value on every fill
- **Fixed** — always the value you enter (typing a value switches the row to Fixed)
- **Skip** — leave the field alone

Mix them freely, e.g. a fixed address with random names and emails. Fixed first/last names carry into the generated full name, username and email.

**Custom fields** cover anything else a form asks for (delivery instructions, job title, promo code…). Each one is matched by phrases in the field's label or its name/id, and is Fixed, Random (the AI chooses a value guided by the custom field's name) or Skip. Custom fields are used by **Fill all**, not the group fills.

## Tips for Best Results

- Re-scan after the form dynamically adds fields (SPAs)
- Some heavily custom web components may not fill perfectly — the extension focuses on native `<input>`, `<select>`, `<textarea>`
- For very unusual forms the AI mode usually outperforms pure heuristics because it sees the full context
- Use the **Clear Fields** button before re-filling with a different profile
- Works great on multi-step wizards — fill one step, proceed, fill next

## Limitations (v1.0)

- Content script only runs in main frame (not iframes by default)
- Very dynamic forms (heavy DOM mutation after load) may need manual re-scan
- Password managers / browser autofill may conflict on some sites (you can disable them per-site for testing)
- No persistent per-domain custom data yet (future feature)

## Future Ideas (Contributions Welcome)

- Per-site / per-domain saved custom profiles
- CSV / JSON import of test datasets
- Floating action button mode (optional)
- Support for more input types (color, range, file with mock)
- Better React Hook Form / Formik detection
- Darker / more themeable popup

## Tech Stack

- Manifest V3
- Pure vanilla JS (no build step, no dependencies)
- Chrome storage for settings
- Ollama REST API (`/api/chat` with JSON mode)

## License

MIT — feel free to modify for your own dev workflow.

Created with ❤️ for developers who are tired of typing `test@example.com` for the 500th time.

---

**Phil's note**: Tailored for Brisbane/Mansfield dev life — EUC commute friendly, lots of localhost testing, and Australian address realism. Enjoy! 

If you improve it, send a PR or just tell me what broke on your weird internal forms.