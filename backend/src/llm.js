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
    defaultModel: 'anthropic/claude-sonnet-4-5',
    apiKeyEnv: 'OPENROUTER_API_KEY'
  },
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-5',
    apiKeyEnv: 'ANTHROPIC_API_KEY'
  }
};

function getProvider() {
  return (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
}

function getModel() {
  const provider = getProvider();
  return process.env.OPENROUTER_MODEL || process.env.LLM_MODEL || PROVIDERS[provider]?.defaultModel || 'anthropic/claude-sonnet-4-5';
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
 * @param {Array} messages - Array of { role, content } objects
 * @param {string} systemPrompt - System prompt string
 * @param {object} options - { model, maxTokens, temperature, tools }
 * @returns {object} { content, role, model, provider, usage, stopReason }
 */
async function chat(messages, systemPrompt, options = {}) {
  const provider = getProvider();
  console.log(`[LLM] Provider: ${provider} | Model: ${options.model || getModel()}`);

  try {
    if (provider === 'anthropic') {
      return await callAnthropic(messages, systemPrompt, options);
    }
    // Default: OpenRouter
    return await callOpenRouter(messages, systemPrompt, options);
  } catch (err) {
    console.error(`[LLM] ${provider} failed: ${err.message}`);

    throw err;
    if (provider === 'openrouter' && process.env.ANTHROPIC_API_KEY) {
      console.log('[LLM] Falling back to Anthropic direct...');
      const fallbackOptions = { ...options, model: 'claude-sonnet-4-5' };
      return await callAnthropic(messages, systemPrompt, fallbackOptions);
    }

    throw err;
  }
}

module.exports = { chat, getProvider, getModel, PROVIDERS };
