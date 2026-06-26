/**
 * SmartForm Filler - Shared model recommendation metadata.
 *
 * Loaded as a classic script before both options.js and popup.js, so the
 * declarations below live in the shared global scope of each page. Keep this
 * the single source of truth for "which OpenRouter models we promote and why".
 *
 * The extension's job is generating small, consistent, minified JSON test data
 * for forms — so the promoted families are the cheap, fast, reliable
 * structured-JSON models, not expensive reasoning models.
 *
 * Each rule's `reasons` is an array of short phrases rendered as bullet points.
 */

// Default OpenRouter model: Qwen3 Coder 480B A35B — strong instruction model
// with a great free tier, well suited to generating structured-JSON form data.
const DEFAULT_OPENROUTER_MODEL = 'qwen/qwen3-coder';

const RECOMMENDED_RULES = [
  { tokens: ['gemini', 'flash'],   reasons: ['Fast & low cost', 'Excellent structured-JSON output'] },
  { tokens: ['gpt-4o-mini'],       reasons: ['Very low cost', 'Highly reliable JSON'] },
  { tokens: ['gpt-4.1-mini'],      reasons: ['Low cost', 'Strong instruction-following'] },
  { tokens: ['gpt-oss'],           reasons: ['Open OpenAI model', 'Great value'] },
  { tokens: ['claude', 'haiku'],   reasons: ['Fast & cheap', 'Excellent instruction-following'] },
  { tokens: ['llama-3.3'],         reasons: ['Strong open model', 'Very low cost'] },
  { tokens: ['llama-4'],           reasons: ['Open model', 'Long context'] },
  { tokens: ['deepseek', 'chat'],  reasons: ['Extremely low cost', 'Dependable JSON'] },
  { tokens: ['deepseek', 'v3'],    reasons: ['Top value', 'Strong reasoning & JSON'] },
  { tokens: ['mistral-small'],     reasons: ['Fast & cheap', 'Solid JSON'] },
  { tokens: ['ministral'],         reasons: ['Tiny & fast', 'Cheap for simple JSON'] },
  { tokens: ['qwen', 'coder'],     reasons: ['Strong instruction model', 'Great free tier'] },
  { tokens: ['gemma'],             reasons: ['Native structured output', 'Free tier'] }
];

// Returns an array of short reason phrases if the model is promoted, else null.
function getRecommendation(model) {
  const id = (model.id || '').toLowerCase();
  const rule = RECOMMENDED_RULES.find(r => r.tokens.every(t => id.includes(t)));
  return rule ? rule.reasons : null;
}

function isFreeModel(model) {
  const id = (model.id || '').toLowerCase();
  if (id.endsWith(':free')) return true;
  const p = model.pricing || {};
  return parseFloat(p.prompt || '0') === 0 && parseFloat(p.completion || '0') === 0;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
