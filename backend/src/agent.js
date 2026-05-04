// agent.js - AI agent loop: 3-layer memory, full office-from-truck tools
// Memory: contractor-level (global) + lead-level (per phone) + job-level (episodic)
// Tools: qualify, book, invoice, maintenance plan, thank you, GHL, SMS
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('./db');
const { sendSMS } = require('./skills/speedToLead');
const { createInvoice, markPaid, getOutstandingInvoices } = require('./skills/invoicer');
const { enrollMaintenancePlan } = require('./skills/maintenancePlan');
const { sendThankYou } = require('./skills/thankYou');
const { createGHLContact, updateGHLContactStage, addGHLNote, createGHLOpportunity } = require('./ghl');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────
const TOOLS = [
    {
            name: 'save_memory',
            description: 'Save a fact. Use lead_phone to scope it to this specific customer — their name, address, service, preferences. Omit lead_phone for contractor-wide facts. Call this constantly as you learn things.',
            input_schema: {
                      type: 'object',
                      properties: {
                                  key: { type: 'string', description: 'e.g. "lead_name", "service_type", "budget", "address", "preferred_time", "equipment_model"' },
                                  value: { type: 'string' },
                                  category: { type: 'string', enum: ['lead', 'job', 'preference', 'general'] },
                                  lead_phone: { type: 'string', description: 'Scope this memory to a specific lead. Use their phone number. Leave blank for contractor-wide memory.' },
                      },
                      required: ['key', 'value'],
            },
    },
    {
            name: 'qualify_lead',
            description: 'Mark a lead as qualified. Call once you know service type and urgency.',
            input_schema: {
                      type: 'object',
                      properties: {
                                  lead_name: { type: 'string' },
                                  service_type: { type: 'string', description: 'e.g. "AC repair", "compressor replacement", "roof inspection"' },
                                  urgency: { type: 'string', enum: ['emergency', 'this_week', 'this_month', 'planning'] },
                                  budget_range: { type: 'string' },
                                  notes: { type: 'string' },
                      },
                      required: ['service_type', 'urgency'],
            },
    },
    {
            name: 'book_appointment',
            description: 'Record a confirmed appointment.',
            input_schema: {
                      type: 'object',
                      properties: {
                                  lead_name: { type: 'string' },
                                  address: { type: 'string' },
                                  preferred_date: { type: 'string' },
                                  preferred_time: { type: 'string' },
                                  service_type: { type: 'string' },
                                  notes: { type: 'string' },
                      },
                      required: ['preferred_date', 'service_type'],
            },
    },
    {
            name: 'send_invoice',
            description: 'Create an invoice for a completed job and send the amount to the customer via SMS. Call this when Joshua says "invoice them" or "send them a bill".',
            input_schema: {
                      type: 'object',
                      properties: {
                                  customer_name: { type: 'string' },
                                  customer_phone: { type: 'string', description: 'Customer phone number to send invoice to' },
                                  service_type: { type: 'string', description: 'What was done, e.g. "Compressor replacement - Trane unit"' },
                                  amount: { type: 'number', description: 'Invoice amount in dollars' },
                                  job_description: { type: 'string' },
                                  payment_link: { type: 'string', description: 'Optional Stripe or payment URL' },
                      },
                      required: ['customer_phone', 'service_type', 'amount'],
            },
    },
    {
            name: 'enroll_maintenance_plan',
            description: 'Put a customer on a recurring maintenance plan. Call when Joshua says "put them on the maintenance plan".',
            input_schema: {
                      type: 'object',
                      properties: {
                                  customer_name: { type: 'string' },
                                  customer_phone: { type: 'string' },
                                  plan_type: { type: 'string', description: 'e.g. "Annual HVAC Maintenance Plan", "Bi-Annual Service Plan"' },
                                  price: { type: 'number', description: 'Annual plan price' },
                                  frequency: { type: 'string', enum: ['annual', 'bi-annual', 'monthly'], description: 'How often service occurs' },
                                  ghl_contact_id: { type: 'string' },
                      },
                      required: ['customer_phone'],
            },
    },
    {
            name: 'send_thank_you',
            description: 'Send a post-job thank you message and request a Google review. Call after a job is marked complete.',
            input_schema: {
                      type: 'object',
                      properties: {
                                  customer_name: { type: 'string' },
                                  customer_phone: { type: 'string' },
                                  service_type: { type: 'string' },
                                  request_review: { type: 'boolean', description: 'Whether to include a review request (default true)' },
                                  ghl_contact_id: { type: 'string' },
                      },
                      required: ['customer_phone'],
            },
    },
    {
            name: 'update_ghl_contact',
            description: 'Create or update a contact in GoHighLevel CRM.',
            input_schema: {
                      type: 'object',
                      properties: {
                                  name: { type: 'string' },
                                  phone: { type: 'string' },
                                  email: { type: 'string' },
                                  job_type: { type: 'string' },
                                  stage: { type: 'string', enum: ['new', 'qualified', 'appointment_set', 'estimate_sent', 'won', 'lost', 'maintenance_plan', 'job_complete'] },
                                  note: { type: 'string' },
                      },
                      required: ['phone'],
            },
    },
    {
            name: 'create_ghl_opportunity',
            description: 'Create a new deal/opportunity in GHL pipeline.',
            input_schema: {
                      type: 'object',
                      properties: {
                                  name: { type: 'string' },
                                  job_type: { type: 'string' },
                                  budget_range: { type: 'string' },
                                  ghl_contact_id: { type: 'string' },
                      },
                      required: ['job_type'],
            },
    },
    {
            name: 'get_job_history',
            description: 'Look up past jobs for a customer by phone number. Use this when a returning customer calls — pull their history before responding.',
            input_schema: {
                      type: 'object',
                      properties: {
                                  customer_phone: { type: 'string', description: 'Customer phone to look up' },
                                  limit: { type: 'number', description: 'How many past jobs to return (default 5)' },
                      },
                      required: ['customer_phone'],
            },
    },
    {
            name: 'send_sms',
            description: 'Send an SMS to the lead. This is your PRIMARY communication tool. ALWAYS call this to reply.',
            input_schema: {
                      type: 'object',
                      properties: {
                                  message: { type: 'string', description: 'SMS message — keep under 160 characters' },
                      },
                      required: ['message'],
            },
    },
    ];

// ─── MEMORY HELPERS (lead-scoped) ─────────────────────────────────────────────
async function loadMemory(contractorId, leadPhone = null) {
      // Load contractor-level memory (no lead_phone) + lead-specific memory
  const result = await pool.query(
          `SELECT key, value, category, lead_phone FROM memory
               WHERE contractor_id = $1
                      AND (lead_phone IS NULL OR lead_phone = $2)
                           ORDER BY updated_at DESC LIMIT 60`,
          [contractorId, leadPhone]
        );
      return result.rows;
}

async function saveMemory(contractorId, key, value, category = 'general', leadPhone = null) {
      await pool.query(
              `INSERT INTO memory (contractor_id, lead_phone, key, value, category, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                        ON CONFLICT (contractor_id, COALESCE(lead_phone, ''), key)
                             DO UPDATE SET value = $4, category = $5, updated_at = NOW()`,
              [contractorId, leadPhone || null, key, value, category]
            );
      console.log(`[Memory] ${leadPhone ? `Lead ${leadPhone}` : 'Contractor'}: ${key} = ${value}`);
}

// ─── CONVERSATION HELPERS ─────────────────────────────────────────────────────
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
function buildSystemPrompt(contractor, memory, leadPhone) {
      // Split memory: lead-specific vs contractor-wide
  const leadMemory = memory.filter(m => m.lead_phone === leadPhone);
      const contractorMemory = memory.filter(m => !m.lead_phone);

  const leadMemoryText = leadMemory.length
        ? leadMemory.map(m => `  - [${m.category}] ${m.key}: ${m.value}`).join('\n')
          : '  (no history with this customer yet)';

  const contractorMemoryText = contractorMemory.length
        ? contractorMemory.map(m => `  - [${m.category}] ${m.key}: ${m.value}`).join('\n')
          : '  (none)';

  return `You are an AI employee for ${contractor.company_name || contractor.name}, an HVAC and roofing contractor.

  YOUR ROLE: You are a smart field office assistant — not a chatbot. You respond to inbound leads via SMS, qualify them, book appointments, invoice completed jobs, enroll customers in maintenance plans, and keep the CRM updated. You run the office from the truck.

  CONTRACTOR:
  - Company: ${contractor.company_name || contractor.name}
  - Services: ${(contractor.services || ['HVAC', 'Roofing']).join(', ')}
  - Service Area: ${contractor.service_area || 'Local area'}
  - Persona: ${contractor.ai_persona || 'professional, friendly assistant'}
  ${contractor.review_link ? `- Google Review Link: ${contractor.review_link}` : ''}

  WHAT YOU KNOW ABOUT THIS CUSTOMER (lead-level memory):
  ${leadMemoryText}

  CONTRACTOR-WIDE MEMORY:
  ${contractorMemoryText}

  YOUR TOOLS — USE THEM AGGRESSIVELY:
  - save_memory: Save EVERYTHING you learn. Always scope to lead_phone for customer facts.
  - qualify_lead: Mark qualified once you have service + urgency
  - book_appointment: Record confirmed appointments
  - send_invoice: Create invoice + send payment SMS ("invoice them for $X")
  - enroll_maintenance_plan: Put customer on recurring plan ("put them on the maintenance plan")
  - send_thank_you: Post-job thank you + review request ("send them a thank you")
  - update_ghl_contact: Keep CRM updated after every milestone
  - get_job_history: Check returning customer's past jobs before responding
  - send_sms: ALWAYS use this to reply to the customer

  WORKFLOW — "RUN YOUR OFFICE FROM YOUR TRUCK":
  1. If returning customer → get_job_history first
  2. save_memory for every new fact (name, address, service, equipment, etc.)
  3. qualify_lead when you have enough info
  4. book_appointment when they confirm a time
  5. update_ghl_contact at every milestone
  6. send_invoice when told to bill them
  7. enroll_maintenance_plan when told to add them to the plan
  8. send_thank_you when job is done
  9. ALWAYS end by calling send_sms

  SMS RULES:
  - Under 160 characters
  - Friendly, professional, direct
  - Move every conversation toward booking
  - Free estimate offer when they ask price`;
}

// ─── TOOL EXECUTOR ────────────────────────────────────────────────────────────
async function executeTool(toolName, toolInput, context) {
      const { contractor, leadPhone, conversationId } = context;
      console.log(`[Tool] ${toolName}:`, JSON.stringify(toolInput).substring(0, 120));

  switch (toolName) {
      case 'save_memory': {
                const scopedPhone = toolInput.lead_phone || leadPhone;
                await saveMemory(contractor.id, toolInput.key, toolInput.value, toolInput.category || 'general', scopedPhone);
                return { success: true, saved: `${toolInput.key} = ${toolInput.value}`, scope: scopedPhone || 'contractor-wide' };
      }

      case 'qualify_lead': {
                await upsertLead(contractor.id, leadPhone, {
                            name: toolInput.lead_name || null,
                            service_type: toolInput.service_type,
                            status: 'qualified',
                            notes: [toolInput.urgency, toolInput.budget_range, toolInput.notes].filter(Boolean).join(' | '),
                });
                await saveMemory(contractor.id, 'lead_status', 'qualified', 'lead', leadPhone);
                await saveMemory(contractor.id, 'service_type', toolInput.service_type, 'job', leadPhone);
                if (toolInput.urgency) await saveMemory(contractor.id, 'urgency', toolInput.urgency, 'job', leadPhone);
                if (toolInput.budget_range) await saveMemory(contractor.id, 'budget_range', toolInput.budget_range, 'job', leadPhone);
                if (toolInput.lead_name) await saveMemory(contractor.id, 'lead_name', toolInput.lead_name, 'lead', leadPhone);
                return { success: true, status: 'qualified', service_type: toolInput.service_type };
      }

      case 'book_appointment': {
                await upsertLead(contractor.id, leadPhone, {
                            name: toolInput.lead_name || null,
                            service_type: toolInput.service_type,
                            status: 'appointment_set',
                            notes: `Appt: ${toolInput.preferred_date} ${toolInput.preferred_time || ''} | ${toolInput.address || ''} | ${toolInput.notes || ''}`,
                });
                await saveMemory(contractor.id, 'lead_status', 'appointment_set', 'lead', leadPhone);
                await saveMemory(contractor.id, 'appointment_date', `${toolInput.preferred_date} ${toolInput.preferred_time || ''}`.trim(), 'job', leadPhone);
                if (toolInput.address) await saveMemory(contractor.id, 'address', toolInput.address, 'lead', leadPhone);
                await pool.query(
                            `INSERT INTO tasks (contractor_id, type, payload, status, run_at, created_at)
                                     VALUES ($1, 'appointment_reminder', $2, 'pending', NOW() + INTERVAL '1 hour', NOW())`,
                            [contractor.id, JSON.stringify({ leadPhone, ...toolInput })]
                          );
                return { success: true, status: 'appointment_set', date: toolInput.preferred_date };
      }

      case 'send_invoice': {
                const result = await createInvoice(contractor, toolInput.customer_phone || leadPhone, {
                            customerName: toolInput.customer_name,
                            serviceType: toolInput.service_type,
                            amount: toolInput.amount,
                            jobDescription: toolInput.job_description,
                            paymentLink: toolInput.payment_link,
                });
                await saveMemory(contractor.id, 'last_invoice', `${toolInput.service_type} $${toolInput.amount}`, 'job', toolInput.customer_phone || leadPhone);
                await saveMessage(conversationId, 'assistant', result.smsSent, 'tool');
                return result;
      }

      case 'enroll_maintenance_plan': {
                const result = await enrollMaintenancePlan(contractor, toolInput.customer_phone || leadPhone, {
                            customerName: toolInput.customer_name,
                            planType: toolInput.plan_type,
                            price: toolInput.price,
                            frequency: toolInput.frequency,
                            ghlContactId: toolInput.ghl_contact_id,
                });
                await saveMessage(conversationId, 'assistant', result.smsSent, 'tool');
                return result;
      }

      case 'send_thank_you': {
                const result = await sendThankYou(contractor, toolInput.customer_phone || leadPhone, {
                            customerName: toolInput.customer_name,
                            serviceType: toolInput.service_type,
                            requestReview: toolInput.request_review !== false,
                            reviewLink: contractor.review_link || null,
                            ghlContactId: toolInput.ghl_contact_id,
                });
                await saveMessage(conversationId, 'assistant', result.smsSent, 'tool');
                return result;
      }

      case 'update_ghl_contact': {
                const contact = await createGHLContact({
                            name: toolInput.name,
                            phone: toolInput.phone || leadPhone,
                            email: toolInput.email,
                            job_type: toolInput.job_type,
                });
                if (contact?.contact?.id) {
                            const ghlId = contact.contact.id;
                            if (toolInput.stage) await updateGHLContactStage(ghlId, toolInput.stage);
                            if (toolInput.note) await addGHLNote(ghlId, toolInput.note);
                            await upsertLead(contractor.id, leadPhone, { ghl_contact_id: ghlId });
                            await saveMemory(contractor.id, 'ghl_contact_id', ghlId, 'lead', leadPhone);
                            return { success: true, ghl_contact_id: ghlId };
                }
                return { success: false, reason: 'GHL not configured or contact creation failed' };
      }

      case 'create_ghl_opportunity': {
                const opp = await createGHLOpportunity({
                            job_type: toolInput.job_type,
                            name: toolInput.name || leadPhone,
                            ghlContactId: toolInput.ghl_contact_id,
                            budget_range: toolInput.budget_range,
                });
                if (opp?.opportunity?.id) return { success: true, opportunity_id: opp.opportunity.id };
                return { success: false, reason: 'GHL opportunity creation failed' };
      }

      case 'get_job_history': {
                const phone = toolInput.customer_phone || leadPhone;
                const jobs = await pool.query(
                            `SELECT service_type, description, amount, status, created_at, completed_at
                                     FROM jobs WHERE contractor_id = $1 AND customer_phone = $2
                                              ORDER BY created_at DESC LIMIT $3`,
                            [contractor.id, phone, toolInput.limit || 5]
                          );
                const leadMem = await loadMemory(contractor.id, phone);
                return {
                            customer_phone: phone,
                            job_count: jobs.rows.length,
                            jobs: jobs.rows.map(j => ({
                                          service: j.service_type,
                                          amount: j.amount,
                                          status: j.status,
                                          date: j.created_at ? new Date(j.created_at).toLocaleDateString() : 'unknown',
                            })),
                            known_facts: leadMem.filter(m => m.lead_phone === phone).map(m => `${m.key}: ${m.value}`),
                };
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

// ─── MAIN AGENT LOOP ──────────────────────────────────────────────────────────
async function runAgentLoop(contractor, leadPhone, incomingMessage, smsProvider = 'telnyx') {
      console.log(`[Agent] ${contractor.company_name} | Lead: ${leadPhone}`);

  const conversation = await getOrCreateConversation(contractor.id, leadPhone, smsProvider);
      await saveMessage(conversation.id, 'user', incomingMessage, smsProvider);

  const history = await loadHistory(conversation.id);
      // Load BOTH contractor-wide and lead-specific memory
  const memory = await loadMemory(contractor.id, leadPhone);
      const systemPrompt = buildSystemPrompt(contractor, memory, leadPhone);

  const messages = history.map(h => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content,
  }));

  const context = { contractor, leadPhone, conversationId: conversation.id };
      let smsSent = false;
      let iterations = 0;
      const MAX_ITERATIONS = 8;

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
          messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'end_turn') {
                  const textBlock = response.content.find(b => b.type === 'text');
                  if (textBlock && !smsSent) {
                              const fallbackReply = textBlock.text.trim().substring(0, 160);
                              await sendSMS(contractor, leadPhone, fallbackReply);
                              await saveMessage(conversation.id, 'assistant', fallbackReply, 'anthropic');
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
                              if (['send_invoice', 'enroll_maintenance_plan', 'send_thank_you'].includes(block.name) && result.success) smsSent = true;
                              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
                  }
                  messages.push({ role: 'user', content: toolResults });
                  continue;
        }

        console.warn(`[Agent] Unexpected stop_reason: ${response.stop_reason}`);
          break;
  }

  if (!smsSent) {
          const fallback = "Thanks for reaching out! We'll get back to you shortly.";
          await sendSMS(contractor, leadPhone, fallback);
          await saveMessage(conversation.id, 'assistant', fallback, 'fallback');
  }

  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversation.id]);
      return { success: true, smsSent, iterations };
}

function buildSystemPromptExport(contractor, memory, leadPhone) {
      return buildSystemPrompt(contractor, memory, leadPhone);
}

module.exports = { runAgentLoop, buildSystemPrompt: buildSystemPromptExport };
