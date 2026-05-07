// llm.js - Unified LLM router for Contractor-OS
// Supports: OpenRouter (default), Anthropic direct
// OpenRouter is OpenAI-compatible — no extra SDK needed, uses native fetch
// Switch providers by setting LLM_PROVIDER env var: 'openrouter' | 'anthropic'

const Anthropic = require('@anthropic-ai/sdk');

// ─── PROVIDER CONFIGS ────────────────────────────────────────────────────────

const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4-5-20250929',
    apiKeyEnv: 'OPENROUTER_API_KEY'
  },
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    apiKeyEnv: 'ANTHROPIC_API_KEY'
  }
};

// ─── SMART MODEL ROUTING ─────────────────────────────────────────────────────
// Tier 1 — Fast/cheap:  GPT-4o-mini  (simple questions, short inputs)
// Tier 2 — Standard:    Sonnet        (conversations, booking, most tasks)
// Tier 3 — Complex:     Opus          (strategy, multi-step reasoning)

const MODELS = {
  fast:    'openai/gpt-4o-mini',
  sonnet:  'anthropic/claude-sonnet-4-5-20250929',
  opus:    'anthropic/claude-opus-4-5-20251101'
};

const SIMPLE_KEYWORDS = [
  'hi', 'hello', 'hey', 'yes', 'no', 'ok', 'okay', 'thanks', 'thank you',
  'sure', 'got it', 'sounds good', 'perfect', 'great', 'when', 'where',
  'what time', 'how much', 'price', 'cost', 'hours', 'open', 'available'
];

const COMPLEX_KEYWORDS = [
  'strategy', 'analyze', 'analyse', 'architect', 'plan', 'recommend',
  'evaluate', 'compare', 'assess', 'diagnose', 'optimize', 'redesign',
  'build a system', 'how should i', 'what would you suggest', 'pros and cons',
  'tradeoffs', 'trade-offs', 'roadmap', 'long term', 'big picture'
];

/**
 * Select the optimal model based on task complexity.
 * Can be overridden by passing options.model explicitly.
 *
 * @param {string} userInput - The user's latest message
 * @param {object} context   - { type: 'sales'|'booking'|'support'|'internal', ... }
 * @returns {string} OpenRouter model string
 */
function selectOptimalModel(userInput = '', context = {}) {
  const input = userInput.toLowerCase().trim();
  const length = input.length;

  // Short & simple → fast/cheap model
  if (length < 150 && SIMPLE_KEYWORDS.some(kw => input.includes(kw))) {
    return MODELS.fast;
  }

  // Complex reasoning → Opus
  if (COMPLEX_KEYWORDS.some(kw => input.includes(kw))) {
    return MODELS.opus;
  }

  // Sales and voice conversations benefit from Sonnet's nuance
  if (context.type === 'sales' || context.type === 'booking' || context.type === 'voice') {
    return MODELS.sonnet;
  }

  // Default: Sonnet for everything else
  return MODELS.sonnet;
}

function getProvider() {
  return (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
}

function getModel() {
  const provider = getProvider();
  return process.env.OPENROUTER_MODEL || process.env.LLM_MODEL || PROVIDERS[provider]?.defaultModel || MODELS.sonnet;
}

// ─── OPENROUTER (OpenAI-compatible fetch) ─────────────────────────────────────

async function callOpenRouter(messages, systemPrompt, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const model = options.model || getModel();
  const maxTokens = options.maxTokens || 1024;

  const body = {
    model,
    max_tokens: maxTokens,
    messages: systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.tools && { tools: options.tools })
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'https://contractor-os.railway.app',
      'X-Title': 'Contractor-OS'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  if (!choice) throw new Error('OpenRouter returned no choices');

  return {
    content: choice.message?.content || '',
    role: 'assistant',
    model: data.model || model,
    provider: 'openrouter',
    usage: data.usage || {},
    stopReason: choice.finish_reason
  };
}

// ─── ANTHROPIC DIRECT ─────────────────────────────────────────────────────────

async function callAnthropic(messages, systemPrompt, options = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = options.model || process.env.LLM_MODEL || 'claude-sonnet-4-5';
  const maxTokens = options.maxTokens || 1024;

  const params = {
    model,
    max_tokens: maxTokens,
    messages,
    ...(systemPrompt && { system: systemPrompt }),
    ...(options.tools && { tools: options.tools })
  };

  const response = await client.messages.create(params);

  const textBlock = response.content.find(b => b.type === 'text');
  return {
    content: textBlock?.text || '',
    role: 'assistant',
    model: response.model,
    provider: 'anthropic',
    usage: { prompt_tokens: response.usage?.input_tokens, completion_tokens: response.usage?.output_tokens },
    stopReason: response.stop_reason
  };
}

// ─── UNIFIED INTERFACE ────────────────────────────────────────────────────────

/**
 * Send messages to the configured LLM provider.
 * Smart routing automatically picks the right model tier unless options.model is set.
 *
 * @param {Array}  messages    - Array of { role, content } objects
 * @param {string} systemPrompt - System prompt string
 * @param {object} options     - { model, maxTokens, temperature, tools, context }
 *   options.model    — override auto-routing (use a specific model string)
 *   options.context  — { type: 'sales'|'booking'|'voice'|'internal' } for routing hints
 * @returns {object} { content, role, model, provider, usage, stopReason }
 */
async function chat(messages, systemPrompt, options = {}) {
  const provider = getProvider();

  // Smart model selection — use explicit override or auto-route based on last user message
  if (!options.model) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userInput = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : lastUserMsg?.content?.[0]?.text || '';
    options.model = selectOptimalModel(userInput, options.context || {});
  }

  console.log(`[LLM] Provider: ${provider} | Model: ${options.model}`);

  try {
    if (provider === 'anthropic') {
      return await callAnthropic(messages, systemPrompt, options);
    }
    // Default: OpenRouter (supports all model tiers via unified API)
    return await callOpenRouter(messages, systemPrompt, options);
  } catch (err) {
    console.error(`[LLM] ${provider} failed: ${err.message}`);

    // Fallback: if OpenRouter fails and we have a direct Anthropic key, try it
    if (provider === 'openrouter' && process.env.ANTHROPIC_API_KEY) {
      console.log('[LLM] Falling back to Anthropic direct...');
      const fallbackOptions = { ...options, model: 'claude-sonnet-4-5-20250929' };
      return await callAnthropic(messages, systemPrompt, fallbackOptions);
    }

    throw err;
  }
}

module.exports = { chat, getProvider, getModel, selectOptimalModel, MODELS, PROVIDERS };
