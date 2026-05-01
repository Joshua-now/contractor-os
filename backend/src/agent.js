// agent.js - AI agent loop for Contractor-OS
// Uses llm.js router — works with OpenRouter OR Anthropic direct
const { chat, getProvider, getModel } = require('./llm');
const pool = require('./db');
const { sendSMS } = require('./skills/speedToLead');

/**
 * Build the system prompt for a contractor's AI assistant
 */
function buildSystemPrompt(contractor, memory) {
  const memoryText = memory.length
    ? memory.map(m => `- ${m.key}: ${m.value}`).join('\n')
    : 'No memory stored yet.';

  return `You are an AI assistant for ${contractor.company_name || contractor.name}, an HVAC and roofing contractor.

YOUR PERSONALITY:
- Professional, friendly, and concise
- You respond to leads and customers via SMS
- Keep all messages under 160 characters when possible
- You qualify leads, book appointments, and follow up on estimates

CONTRACTOR INFO:
- Company: ${contractor.company_name || contractor.name}
- Services: ${(contractor.services || ['HVAC', 'Roofing']).join(', ')}
- Service Area: ${contractor.service_area || 'Local area'}
- AI Persona: ${contractor.ai_persona || 'professional HVAC/roofing assistant'}

WHAT YOU KNOW (Memory):
${memoryText}

RULES:
1. Always be helpful and move leads toward booking
2. If someone asks for a price, give a range or offer a free estimate
3. If someone is ready to book, ask for their address and preferred time
4. Never make promises you can't keep
5. Keep SMS replies SHORT (under 160 chars)
6. If you don't know something, say you'll have the contractor follow up`;
}

/**
 * Get or create a conversation for a lead
 */
async function getOrCreateConversation(contractorId, leadPhone, provider) {
  let result = await pool.query(
    `SELECT * FROM conversations WHERE contractor_id = $1 AND lead_phone = $2 AND status = 'open' LIMIT 1`,
    [contractorId, leadPhone]
  );

  if (result.rows.length) return result.rows[0];

  result = await pool.query(
    `INSERT INTO conversations (contractor_id, lead_phone, channel, sms_provider, status, created_at, updated_at)
     VALUES ($1, $2, 'sms', $3, 'open', NOW(), NOW()) RETURNING *`,
    [contractorId, leadPhone, provider || 'twilio']
  );
  return result.rows[0];
}

/**
 * Load recent message history for a conversation
 */
async function loadHistory(conversationId, limit = 20) {
  const result = await pool.query(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows.reverse();
}

/**
 * Save a message to the conversation
 */
async function saveMessage(conversationId, role, content, provider) {
  await pool.query(
    `INSERT INTO messages (conversation_id, role, content, provider, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [conversationId, role, content, provider]
  );
}

/**
 * Load contractor memory
 */
async function loadMemory(contractorId) {
  const result = await pool.query(
    'SELECT key, value FROM memory WHERE contractor_id = $1 ORDER BY updated_at DESC LIMIT 50',
    [contractorId]
  );
  return result.rows;
}

/**
 * Main agent loop — called when a message arrives (SMS, web form, etc.)
 * @param {object} contractor - Contractor DB row
 * @param {string} leadPhone - Lead's phone number
 * @param {string} incomingMessage - The message text from the lead
 * @param {string} smsProvider - 'twilio' | 'telnyx'
 */
async function runAgentLoop(contractor, leadPhone, incomingMessage, smsProvider = 'twilio') {
  console.log(`[Agent] ${contractor.company_name} | Lead: ${leadPhone} | Provider: ${smsProvider}`);
  console.log(`[Agent] LLM: ${getProvider()} / ${getModel()}`);

  try {
    // 1. Get/create conversation
    const conversation = await getOrCreateConversation(contractor.id, leadPhone, smsProvider);

    // 2. Save incoming message
    await saveMessage(conversation.id, 'user', incomingMessage, smsProvider);

    // 3. Load history + memory
    const history = await loadHistory(conversation.id);
    const memory = await loadMemory(contractor.id);

    // 4. Build system prompt with contractor context
    const systemPrompt = buildSystemPrompt(contractor, memory);

    // 5. Call LLM via unified router (OpenRouter or Anthropic)
    const response = await chat(history, systemPrompt, {
      maxTokens: 512,
      temperature: 0.7
    });

    const replyText = response.content?.trim();
    if (!replyText) {
      console.warn('[Agent] Empty response from LLM');
      return;
    }

    console.log(`[Agent] Reply (${response.provider}/${response.model}): ${replyText.substring(0, 80)}...`);

    // 6. Save assistant reply
    await saveMessage(conversation.id, 'assistant', replyText, response.provider);

    // 7. Send SMS back to lead
        try { await sendSMS(contractor, leadPhone, replyText); } catch (smsErr) { console.error('[Agent] SMS send failed (non-fatal):', smsErr?.message || String(smsErr)); }

    // 8. Update conversation timestamp
    await pool.query(
      'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
      [conversation.id]
    );

    return { success: true, reply: replyText, provider: response.provider };
  } catch (err) {
    console.error('[Agent] Error in agent loop:', err.message);
    throw err;
  }
}

module.exports = { runAgentLoop, buildSystemPrompt };
