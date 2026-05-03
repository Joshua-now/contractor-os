// agent.js - AI agent loop with tool-calling and persistent memory
// Supports: memory writes, GHL actions, appointment booking, lead qualification
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('./db');
const { sendSMS } = require('./skills/speedToLead');
const {
    createGHLContact,
    updateGHLContactStage,
    addGHLNote,
    createGHLOpportunity,
} = require('./ghl');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

const TOOLS = [
  {
        name: 'save_memory',
        description: 'Save or update a fact about this lead or job to persistent memory. Call this whenever you learn something important (name, service needed, budget, urgency, address, preferred time, etc.).',
        input_schema: {
                type: 'object',
                properties: {
                          key: { type: 'string', description: 'Memory key, e.g. "lead_name", "service_type", "budget", "urgency", "address", "preferred_time"' },
                          value: { type: 'string', description: 'The value to store' },
                          category: { type: 'string', enum: ['lead', 'job', 'preference', 'general'], description: 'Category for this memory' },
                },
                required: ['key', 'value'],
        },
  },
  {
        name: 'qualify_lead',
        description: 'Mark a lead as qualified and record their service type, urgency, and budget. Call this once you have gathered enough info to qualify them.',
        input_schema: {
                type: 'object',
                properties: {
                          lead_name: { type: 'string' },
                          service_type: { type: 'string', description: 'e.g. "AC repair", "roof replacement", "HVAC install"' },
                          urgency: { type: 'string', enum: ['emergency', 'this_week', 'this_month', 'planning'], description: 'How urgent is this job?' },
                          budget_range: { type: 'string', description: 'e.g. "under $500", "$1000-$3000", "open"' },
                          notes: { type: 'string', description: 'Any other relevant details' },
                },
                required: ['service_type', 'urgency'],
        },
  },
  {
        name: 'book_appointment',
        description: 'Record a booked appointment for the lead. Call this when the lead confirms a date/time.',
        input_schema: {
                type: 'object',
                properties: {
                          lead_name: { type: 'string' },
                          address: { type: 'string', description: 'Job site address' },
                          preferred_date: { type: 'string', description: 'e.g. "Tuesday May 6" or "tomorrow afternoon"' },
                          preferred_time: { type: 'string', description: 'e.g. "10am", "afternoon"' },
                          service_type: { type: 'string' },
                          notes: { type: 'string' },
                },
                required: ['preferred_date', 'service_type'],
        },
  },
  {
        name: 'update_ghl_contact',
        description: 'Create or update a contact in GoHighLevel CRM with the lead\'s info. Call this after qualifying a lead or booking an appointment.',
        input_schema: {
                type: 'object',
                properties: {
                          name: { type: 'string' },
                          phone: { type: 'string' },
                          email: { type: 'string' },
                          job_type: { type: 'string' },
                          stage: { type: 'string', enum: ['new', 'qualified', 'appointment_set', 'estimate_sent', 'won', 'lost'] },
                          note: { type: 'string', description: 'Note to add to the contact record' },
                },
                required: ['phone'],
        },
  },
  {
        name: 'create_ghl_opportunity',
        description: 'Create a new opportunity/deal in GoHighLevel for this lead. Call this when a lead is qualified and ready to move through the pipeline.',
        input_schema: {
                type: 'object',
                properties: {
                          name: { type: 'string', description: 'Lead name or description' },
                          job_type: { type: 'string' },
                          budget_range: { type: 'string' },
                          ghl_contact_id: { type: 'string', description: 'GHL contact ID if already created' },
                },
                required: ['job_type'],
        },
  },
  {
        name: 'send_sms',
        description: 'Send an SMS message to the lead. This is your PRIMARY way to communicate. Always call this to send your reply.',
        input_schema: {
                type: 'object',
                properties: {
                          message: { type: 'string', description: 'The SMS message to send. Keep under 160 characters.' },
                },
                required: ['message'],
        },
  },
  ];

// ─── DB HELPERS ───────────────────────────────────────────────────────────────

async function getOrCreateConversation(contractorId, leadPhone, provider) {
    let result = await pool.query(
          `SELECT * FROM conversations WHERE contractor_id = $1 AND lead_phone = $2 AND status = 'open' LIMIT 1`,
          [contractorId, leadPhone]
        );
    if (result.rows.length) return result.rows[0];
    result = await pool.query(
          `INSERT INTO conversations (contractor_id, lead_phone, channel, sms_provider, status, created_at, updated_at)
               VALUES ($1, $2, 'sms', $3, 'open', NOW(), NOW()) RETURNING *`,
          [contractorId, leadPhone, provider || 'telnyx']
        );
    return result.rows[0];
}

async function loadHistory(conversationId, limit = 20) {
    const result = await pool.query(
          `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [conversationId, limit]
        );
    return result.rows.reverse();
}

async function saveMessage(conversationId, role, content, provider) {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    await pool.query(
          `INSERT INTO messages (conversation_id, role, content, provider, created_at) VALUES ($1, $2, $3, $4, NOW())`,
          [conversationId, role, text, provider]
        );
}

async function loadMemory(contractorId) {
    const result = await pool.query(
          'SELECT key, value, category FROM memory WHERE contractor_id = $1 ORDER BY updated_at DESC LIMIT 50',
          [contractorId]
        );
    return result.rows;
}

async function saveMemory(contractorId, key, value, category = 'general') {
    await pool.query(
          `INSERT INTO memory (contractor_id, key, value, category, created_at, updated_at)
               VALUES ($1, $2, $3, $4, NOW(), NOW())
                    ON CONFLICT (contractor_id, key) DO UPDATE SET value = $3, category = $4, updated_at = NOW()`,
          [contractorId, key, value, category]
        );
    console.log(`[Memory] Saved: ${key} = ${value}`);
}

async function upsertLead(contractorId, leadPhone, updates) {
    const existing = await pool.query(
          'SELECT id FROM leads WHERE contractor_id = $1 AND phone = $2 LIMIT 1',
          [contractorId, leadPhone]
        );
    if (existing.rows.length) {
          const fields = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
          await pool.query(
                  `UPDATE leads SET ${fields}, updated_at = NOW() WHERE contractor_id = $1 AND phone = $2`,
                  [contractorId, leadPhone, ...Object.values(updates)]
                );
    } else {
          const cols = ['contractor_id', 'phone', ...Object.keys(updates)];
          const vals = [contractorId, leadPhone, ...Object.values(updates)];
          const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
          await pool.query(
                  `INSERT INTO leads (${cols.join(', ')}, created_at, updated_at) VALUES (${placeholders}, NOW(), NOW())`,
                  vals
                );
    }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt(contractor, memory) {
    const memoryText = memory.length
      ? memory.map(m => `- [${m.category}] ${m.key}: ${m.value}`).join('\n')
          : 'No memory stored yet.';

  return `You are an AI employee for ${contractor.company_name || contractor.name}, an HVAC and roofing contractor.

  YOUR ROLE:
  You are a smart, efficient AI employee — not just a chatbot. You respond to inbound leads via SMS, qualify them, book appointments, and keep the CRM updated automatically. You have tools (hands) and memory to do your job.

  CONTRACTOR INFO:
  - Company: ${contractor.company_name || contractor.name}
  - Services: ${(contractor.services || ['HVAC', 'Roofing']).join(', ')}
  - Service Area: ${contractor.service_area || 'Local area'}
  - Persona: ${contractor.ai_persona || 'professional, friendly HVAC/roofing assistant'}

  WHAT YOU REMEMBER (Persistent Memory):
  ${memoryText}

  YOUR TOOLS:
  - save_memory: Save any important fact you learn (name, service, budget, urgency, address, time)
  - qualify_lead: Mark a lead as qualified with service type and urgency
  - book_appointment: Record a confirmed appointment
  - update_ghl_contact: Create/update the lead in GoHighLevel CRM
  - create_ghl_opportunity: Create a deal in the pipeline
  - send_sms: Send your SMS reply to the lead (ALWAYS use this to reply)

  HOW TO WORK:
  1. Read the incoming message
  2. Use save_memory for any new facts you learn
  3. Use qualify_lead when you have enough info
  4. Use book_appointment when they confirm a time
  5. Use update_ghl_contact to keep CRM current
  6. ALWAYS end with send_sms to reply to the lead

  SMS RULES:
  - Keep messages under 160 characters
  - Be friendly, professional, and concise
  - Move every conversation toward booking
  - If they ask price, offer a free estimate
  - If they want to book, ask for address + preferred time`;
}

// ─── TOOL EXECUTOR ────────────────────────────────────────────────────────────

async function executeTool(toolName, toolInput, context) {
    const { contractor, leadPhone, conversationId } = context;
    console.log(`[Tool] ${toolName}:`, JSON.stringify(toolInput).substring(0, 120));

  switch (toolName) {
    case 'save_memory': {
            await saveMemory(contractor.id, toolInput.key, toolInput.value, toolInput.category || 'general');
            return { success: true, saved: `${toolInput.key} = ${toolInput.value}` };
    }

    case 'qualify_lead': {
            await upsertLead(contractor.id, leadPhone, {
                      name: toolInput.lead_name || null,
                      service_type: toolInput.service_type,
                      status: 'qualified',
                      notes: [toolInput.urgency, toolInput.budget_range, toolInput.notes].filter(Boolean).join(' | '),
            });
            await saveMemory(contractor.id, 'lead_status', 'qualified', 'lead');
            await saveMemory(contractor.id, 'service_type', toolInput.service_type, 'job');
            if (toolInput.urgency) await saveMemory(contractor.id, 'urgency', toolInput.urgency, 'job');
            if (toolInput.budget_range) await saveMemory(contractor.id, 'budget_range', toolInput.budget_range, 'job');
            return { success: true, status: 'qualified', service_type: toolInput.service_type };
    }

    case 'book_appointment': {
            await upsertLead(contractor.id, leadPhone, {
                      name: toolInput.lead_name || null,
                      service_type: toolInput.service_type,
                      status: 'appointment_set',
                      notes: `Appt: ${toolInput.preferred_date} ${toolInput.preferred_time || ''} | ${toolInput.address || ''} | ${toolInput.notes || ''}`,
            });
            await saveMemory(contractor.id, 'lead_status', 'appointment_set', 'lead');
            await saveMemory(contractor.id, 'appointment_date', `${toolInput.preferred_date} ${toolInput.preferred_time || ''}`.trim(), 'job');
            if (toolInput.address) await saveMemory(contractor.id, 'address', toolInput.address, 'lead');
            await pool.query(
                      `INSERT INTO tasks (contractor_id, type, payload, status, run_at, created_at)
                               VALUES ($1, 'appointment_reminder', $2, 'pending', NOW() + INTERVAL '1 hour', NOW())`,
                      [contractor.id, JSON.stringify({ leadPhone, ...toolInput })]
                    );
            return { success: true, status: 'appointment_set', date: toolInput.preferred_date };
    }

    case 'update_ghl_contact': {
            const contactData = {
                      name: toolInput.name,
                      phone: toolInput.phone || leadPhone,
                      email: toolInput.email,
                      job_type: toolInput.job_type,
            };
            const contact = await createGHLContact(contactData);
            if (contact?.contact?.id) {
                      const ghlId = contact.contact.id;
                      if (toolInput.stage) await updateGHLContactStage(ghlId, toolInput.stage);
                      if (toolInput.note) await addGHLNote(ghlId, toolInput.note);
                      await upsertLead(contractor.id, leadPhone, { ghl_contact_id: ghlId });
                      await saveMemory(contractor.id, 'ghl_contact_id', ghlId, 'lead');
                      return { success: true, ghl_contact_id: ghlId };
            }
            return { success: false, reason: 'GHL contact creation failed or GHL not configured' };
    }

    case 'create_ghl_opportunity': {
            const opp = await createGHLOpportunity({
                      job_type: toolInput.job_type,
                      name: toolInput.name || leadPhone,
                      ghlContactId: toolInput.ghl_contact_id,
                      budget_range: toolInput.budget_range,
            });
            if (opp?.opportunity?.id) {
                      return { success: true, opportunity_id: opp.opportunity.id };
            }
            return { success: false, reason: 'GHL opportunity creation failed or GHL not configured' };
    }

    case 'send_sms': {
            await sendSMS(contractor, leadPhone, toolInput.message);
            await saveMessage(conversationId, 'assistant', toolInput.message, 'tool');
            return { success: true, sent: toolInput.message };
    }

    default:
            return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── MAIN AGENT LOOP ─────────────────────────────────────────────────────────

async function runAgentLoop(contractor, leadPhone, incomingMessage, smsProvider = 'telnyx') {
    console.log(`[Agent] ${contractor.company_name} | Lead: ${leadPhone}`);

  const conversation = await getOrCreateConversation(contractor.id, leadPhone, smsProvider);
    await saveMessage(conversation.id, 'user', incomingMessage, smsProvider);

  const history = await loadHistory(conversation.id);
    const memory = await loadMemory(contractor.id);
    const systemPrompt = buildSystemPrompt(contractor, memory);

  // Build messages array for Anthropic (filter out any non-string content from prior tool calls)
  const messages = history.map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
  }));

  const context = { contractor, leadPhone, conversationId: conversation.id };
    let smsSent = false;
    let finalReply = null;
    let iterations = 0;
    const MAX_ITERATIONS = 6;

  while (iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`[Agent] LLM call #${iterations}`);

      const response = await anthropic.messages.create({
              model: 'claude-sonnet-4-5',
              max_tokens: 1024,
              system: systemPrompt,
              tools: TOOLS,
              messages,
      });

      console.log(`[Agent] Stop reason: ${response.stop_reason}`);

      // Add assistant response to message history
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
              // Extract text content as final reply
          const textBlock = response.content.find(b => b.type === 'text');
              if (textBlock && !smsSent) {
                        finalReply = textBlock.text.trim();
                        // Fallback: if LLM returned text but didn't call send_sms, send it now
                await sendSMS(contractor, leadPhone, finalReply.substring(0, 160));
                        await saveMessage(conversation.id, 'assistant', finalReply, 'anthropic');
                        smsSent = true;
              }
              break;
      }

      if (response.stop_reason === 'tool_use') {
              const toolResults = [];

          for (const block of response.content) {
                    if (block.type !== 'tool_use') continue;

                const result = await executeTool(block.name, block.input, context);
                    if (block.name === 'send_sms' && result.success) smsSent = true;

                toolResults.push({
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: JSON.stringify(result),
                });
          }

          // Feed tool results back to LLM
          messages.push({ role: 'user', content: toolResults });
              continue;
      }

      // Unexpected stop reason
      console.warn(`[Agent] Unexpected stop_reason: ${response.stop_reason}`);
        break;
  }

  // Safety fallback: if nothing was sent after all iterations
  if (!smsSent) {
        const fallback = "Thanks for reaching out! We'll get back to you shortly.";
        await sendSMS(contractor, leadPhone, fallback);
        await saveMessage(conversation.id, 'assistant', fallback, 'fallback');
  }

  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversation.id]);
    return { success: true, smsSent, iterations };
}

function buildSystemPromptExport(contractor, memory) {
    return buildSystemPrompt(contractor, memory);
}

module.exports = { runAgentLoop, buildSystemPrompt: buildSystemPromptExport };
