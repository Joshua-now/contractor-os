// fieldOffice.js - The AI Field Office Orchestrator
// "Run your office from your truck."
// Talks like a real office manager, not a robot.
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const pool = require('./db');
const { createGHLContact, updateGHLContactStage, addGHLNote, createGHLOpportunity } = require('./ghl');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── GHL LOOKUP HELPERS ───────────────────────────────────────────────────────

function getGHLHeaders() {
    const token = process.env.GHL_PIT_TOKEN;
    return {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
    };
}

async function searchGHLContacts(name) {
    const locationId = process.env.GHL_LOCATION_ID;
    try {
          const resp = await axios.get('https://services.leadconnectorhq.com/contacts/search', {
                  headers: getGHLHeaders(),
                  params: { locationId, query: name, limit: 5 },
          });
          return resp.data?.contacts || [];
    } catch (err) {
          console.error('[GHL] searchGHLContacts error:', err.message);
          return [];
    }
}

async function getGHLContactNotes(ghlContactId) {
    try {
          const resp = await axios.get(
                  `https://services.leadconnectorhq.com/contacts/${ghlContactId}/notes`,
            { headers: getGHLHeaders() }
                );
          return resp.data?.notes || [];
    } catch (err) {
          console.error('[GHL] getGHLContactNotes error:', err.message);
          return [];
    }
}

async function getGHLOpportunities(ghlContactId) {
    const locationId = process.env.GHL_LOCATION_ID;
    try {
          const resp = await axios.get('https://services.leadconnectorhq.com/opportunities/search', {
                  headers: getGHLHeaders(),
                  params: { location_id: locationId, contact_id: ghlContactId, limit: 5 },
          });
          return resp.data?.opportunities || [];
    } catch (err) {
          console.error('[GHL] getGHLOpportunities error:', err.message);
          return [];
    }
}

// ─── FIELD OFFICE TOOLS ───────────────────────────────────────────────────────

const FIELD_OFFICE_TOOLS = [
  {
        name: 'look_up_contact',
        description: 'Look up a contact by name. Returns their pipeline stage, recent notes, open deals — everything we know about them. Use this any time the contractor asks about a customer, project, or account status.',
        input_schema: {
                type: 'object',
                properties: {
                          name: { type: 'string', description: 'Customer or company name to look up' },
                },
                required: ['name'],
        },
  },
  {
        name: 'check_appointments',
        description: 'Check upcoming appointments. Can filter by customer name or just return the next few on the schedule.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string', description: 'Filter by customer name (optional)' },
                },
        },
  },
  {
        name: 'log_job',
        description: 'Log a completed job — what was done, what was sold, any amount. Creates/updates contact in GHL and adds a note.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string' },
                          job_description: { type: 'string', description: 'What was done or sold' },
                          amount: { type: 'number', description: 'Dollar amount if applicable' },
                },
                required: ['customer_name', 'job_description'],
        },
  },
  {
        name: 'create_invoice',
        description: 'Create an invoice for a customer.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string' },
                          amount: { type: 'number' },
                          description: { type: 'string' },
                },
                required: ['customer_name', 'amount', 'description'],
        },
  },
  {
        name: 'send_thank_you',
        description: 'Queue a thank-you message to a customer after a job.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string' },
                          job_summary: { type: 'string' },
                },
                required: ['customer_name'],
        },
  },
  {
        name: 'add_to_maintenance_plan',
        description: 'Enroll a customer in the recurring maintenance plan.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string' },
                          plan_type: { type: 'string', description: 'e.g. quarterly, annual' },
                },
                required: ['customer_name'],
        },
  },
  {
        name: 'create_contact',
        description: 'Add a new contact to the CRM.',
        input_schema: {
                type: 'object',
                properties: {
                          name: { type: 'string' },
                          phone: { type: 'string' },
                          email: { type: 'string' },
                          address: { type: 'string' },
                },
                required: ['name'],
        },
  },
  {
        name: 'schedule_followup',
        description: 'Schedule a follow-up call or visit.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string' },
                          follow_up_date: { type: 'string' },
                          notes: { type: 'string' },
                },
                required: ['customer_name', 'follow_up_date'],
        },
  },
  ];

// ─── TOOL EXECUTOR ────────────────────────────────────────────────────────────

async function executeTool(toolName, toolInput, contractorId) {
    console.log(`[FieldOffice] Tool: ${toolName}`, toolInput);

  switch (toolName) {

    case 'look_up_contact': {
            const { name } = toolInput;

            // Search GHL first (most up-to-date source of truth)
            const ghlContacts = await searchGHLContacts(name);

            if (ghlContacts.length === 0) {
                      // Also check local DB
              const localResult = await pool.query(
                          `SELECT * FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 3`,
                          [contractorId, `%${name}%`]
                        );
                      if (localResult.rows.length === 0) {
                                  return { found: false, message: `No contact found for "${name}". Not in GHL or local DB.` };
                      }
                      return {
                                  found: true,
                                  source: 'local_db',
                                  contacts: localResult.rows.map(c => ({ name: c.name, phone: c.phone, email: c.email })),
                                  notes: 'No GHL data available — contact exists locally only.',
                      };
            }

            // Get full picture for the top match
            const contact = ghlContacts[0];
            const [notes, opportunities] = await Promise.all([
                      getGHLContactNotes(contact.id),
                      getGHLOpportunities(contact.id),
                    ]);

            const recentNotes = notes.slice(0, 3).map(n => ({
                      body: n.body,
                      date: n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : 'unknown',
            }));

            const openDeals = opportunities.filter(o => o.status !== 'lost' && o.status !== 'won').map(o => ({
                      name: o.name,
                      stage: o.pipelineStage?.name || o.status,
                      value: o.monetaryValue,
            }));

            return {
                      found: true,
                      contact_name: contact.name,
                      pipeline_stage: contact.opportunityStage || contact.tags?.join(', ') || 'not set',
                      phone: contact.phone,
                      email: contact.email,
                      recent_notes: recentNotes,
                      open_deals: openDeals,
                      last_activity: contact.lastActivity || contact.dateUpdated,
            };
    }

    case 'check_appointments': {
            const { customer_name } = toolInput;
            let query, params;
            if (customer_name) {
                      query = `SELECT a.scheduled_at, a.notes, c.name as customer_name
                                       FROM appointments a JOIN contacts c ON a.contact_id = c.id
                                                        WHERE a.contractor_id = $1 AND LOWER(c.name) LIKE LOWER($2)
                                                                         ORDER BY a.scheduled_at ASC LIMIT 5`;
                      params = [contractorId, `%${customer_name}%`];
            } else {
                      query = `SELECT a.scheduled_at, a.notes, c.name as customer_name
                                       FROM appointments a JOIN contacts c ON a.contact_id = c.id
                                                        WHERE a.contractor_id = $1 AND a.scheduled_at >= NOW()
                                                                         ORDER BY a.scheduled_at ASC LIMIT 5`;
                      params = [contractorId];
            }
            const result = await pool.query(query, params);
            if (result.rows.length === 0) {
                      return { found: false, message: customer_name ? `Nothing on the books for ${customer_name}.` : 'No upcoming appointments.' };
            }
            const appts = result.rows.map(r => {
                      const d = new Date(r.scheduled_at);
                      return `${r.customer_name} — ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${r.notes ? ` (${r.notes})` : ''}`;
            });
            return { found: true, appointments: appts };
    }

    case 'log_job': {
            const { customer_name, job_description, amount } = toolInput;
            const contacts = await pool.query(
                      `SELECT id, ghl_contact_id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
                      [contractorId, `%${customer_name}%`]
                    );
            let contactId = contacts.rows[0]?.id;
            let ghlContactId = contacts.rows[0]?.ghl_contact_id;
            if (!contactId) {
                      const ghlContact = await createGHLContact({ name: customer_name }, contractorId);
                      ghlContactId = ghlContact?.id;
                      if (ghlContactId) {
                                  const res = await pool.query(
                                                `INSERT INTO contacts (contractor_id, name, ghl_contact_id) VALUES ($1, $2, $3) RETURNING id`,
                                                [contractorId, customer_name, ghlContactId]
                                              );
                                  contactId = res.rows[0].id;
                      }
            }
            if (contactId) {
                      await addGHLNote(contactId, contractorId, `Job completed: ${job_description}${amount ? ` — $${amount}` : ''}`);
            }
            return { success: true, message: `Logged for ${customer_name}: ${job_description}${amount ? ` ($${amount})` : ''}` };
    }

    case 'create_invoice': {
            const { customer_name, amount, description } = toolInput;
            const contacts = await pool.query(
                      `SELECT id, ghl_contact_id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
                      [contractorId, `%${customer_name}%`]
                    );
            let contactId = contacts.rows[0]?.id;
            if (!contactId) {
                      const ghlContact = await createGHLContact({ name: customer_name }, contractorId);
                      if (ghlContact?.id) {
                                  const res = await pool.query(
                                                `INSERT INTO contacts (contractor_id, name, ghl_contact_id) VALUES ($1, $2, $3) RETURNING id`,
                                                [contractorId, customer_name, ghlContact.id]
                                              );
                                  contactId = res.rows[0].id;
                      }
            }
            if (contactId) {
                      await createGHLOpportunity(contactId, contractorId, `Invoice: ${description}`, amount);
                      await addGHLNote(contactId, contractorId, `Invoice created: ${description} — $${amount}`);
            }
            return { success: true, message: `Invoice queued for ${customer_name}: $${amount}` };
    }

    case 'send_thank_you': {
            const { customer_name, job_summary } = toolInput;
            const contacts = await pool.query(
                      `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
                      [contractorId, `%${customer_name}%`]
                    );
            const contactId = contacts.rows[0]?.id;
            if (contactId) {
                      await addGHLNote(contactId, contractorId, `Thank-you message queued${job_summary ? `: ${job_summary}` : ''}`);
            }
            return { success: true, message: `Thank-you queued for ${customer_name}` };
    }

    case 'add_to_maintenance_plan': {
            const { customer_name, plan_type } = toolInput;
            const contacts = await pool.query(
                      `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
                      [contractorId, `%${customer_name}%`]
                    );
            let contactId = contacts.rows[0]?.id;
            if (!contactId) {
                      const ghlContact = await createGHLContact({ name: customer_name }, contractorId);
                      if (ghlContact?.id) {
                                  const res = await pool.query(
                                                `INSERT INTO contacts (contractor_id, name, ghl_contact_id) VALUES ($1, $2, $3) RETURNING id`,
                                                [contractorId, customer_name, ghlContact.id]
                                              );
                                  contactId = res.rows[0].id;
                      }
            }
            if (contactId) {
                      await updateGHLContactStage(contactId, contractorId, 'maintenance_plan');
                      await addGHLNote(contactId, contractorId, `Added to maintenance plan${plan_type ? `: ${plan_type}` : ''}`);
            }
            return { success: true, message: `${customer_name} is on the maintenance plan` };
    }

    case 'create_contact': {
            const { name, phone, email, address } = toolInput;
            const ghlContact = await createGHLContact({ name, phone, email, address }, contractorId);
            if (ghlContact?.id) {
                      await pool.query(
                                  `INSERT INTO contacts (contractor_id, name, phone, email, ghl_contact_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
                                  [contractorId, name, phone || null, email || null, ghlContact.id]
                                );
            }
            return { success: true, message: `Added ${name} to the CRM` };
    }

    case 'schedule_followup': {
            const { customer_name, follow_up_date, notes } = toolInput;
            const contacts = await pool.query(
                      `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
                      [contractorId, `%${customer_name}%`]
                    );
            const contactId = contacts.rows[0]?.id;
            if (contactId) {
                      await addGHLNote(contactId, contractorId, `Follow-up scheduled: ${follow_up_date}${notes ? ` — ${notes}` : ''}`);
            }
            return { success: true, message: `Follow-up set for ${customer_name} on ${follow_up_date}` };
    }

    default:
            return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt(contractor, mode) {
    const companyName = contractor.company_name || 'Fluid Productions';
    const contractorName = contractor.name || 'Joshua';

  const persona = `You are the AI office manager for ${companyName}. Your name is not important — you're just "the office." ${contractorName} calls you from the field and you handle everything back here.

  You know this business inside and out. You're sharp, efficient, and talk like a real person — not a customer service bot. Short sentences. Real talk. You don't say "I'll look that up for you!" — you just look it up and tell them what you found.

  When ${contractorName} asks about a customer or project, use the look_up_contact tool to pull their GHL record — notes, pipeline stage, open deals — and give a real answer like "Instantly's still sitting in proposal stage, last note was from Tuesday, no response yet." Not "No data found."

  If something isn't in the system, say so straight: "I don't have anything on that one, you want me to add them?"

  You handle: looking up contacts and project status, logging jobs, creating invoices, queuing thank-yous, maintenance plan signups, checking the schedule, adding contacts, setting follow-ups.`;

  if (mode === 'conversation') {
        return `${persona}

        ON THE PHONE RIGHT NOW:
        - Keep it short. 1-3 sentences max per turn.
        - After you handle something, just say "anything else?" — don't over-explain.
        - Do the work silently, just report the result.
        - If ${contractorName} says he's done — "that's it", "all good", "bye", "nothing else" — give a quick sign-off and put [END_CALL] at the very end. No exceptions, [END_CALL] only goes on when he's wrapping up.`;
  }

  return `${persona}

  You're processing a voice memo. Handle every task mentioned, then give a clean summary of what got done.`;
}

// ─── SHARED LLM LOOP ──────────────────────────────────────────────────────────

async function runLLMLoop(contractorId, messages, systemPrompt, maxIterations = 10) {
    let iterations = 0;
    while (iterations < maxIterations) {
          iterations++;
          const response = await anthropic.messages.create({
                  model: 'claude-opus-4-5',
                  max_tokens: 1024,
                  system: systemPrompt,
                  tools: FIELD_OFFICE_TOOLS,
                  messages,
          });

      console.log(`[FieldOffice] stop_reason: ${response.stop_reason}`);
          messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
              const textBlock = response.content.find(b => b.type === 'text');
              return { finalText: textBlock?.text || '', messages };
      }

      if (response.stop_reason === 'tool_use') {
              const toolResults = [];
              for (const block of response.content) {
                        if (block.type === 'tool_use') {
                                    const result = await executeTool(block.name, block.input, contractorId);
                                    toolResults.push({
                                                  type: 'tool_result',
                                                  tool_use_id: block.id,
                                                  content: JSON.stringify(result),
                                    });
                        }
              }
              messages.push({ role: 'user', content: toolResults });
              continue;
      }
          break;
    }
    return { finalText: 'Something went wrong, try again.', messages };
}

// ─── BATCH MODE ───────────────────────────────────────────────────────────────

async function runFieldOffice(contractorId, transcript) {
    console.log(`[FieldOffice] Batch mode for contractor ${contractorId}`);
    const contractorResult = await pool.query('SELECT * FROM contractors WHERE id = $1', [contractorId]);
    const contractor = contractorResult.rows[0];
    if (!contractor) throw new Error(`Contractor ${contractorId} not found`);
    const systemPrompt = buildSystemPrompt(contractor, 'batch');
    const messages = [{ role: 'user', content: transcript }];
    const { finalText } = await runLLMLoop(contractorId, messages, systemPrompt);
    return finalText;
}

// ─── CONVERSATION MODE ────────────────────────────────────────────────────────

async function runConversation(contractorId, conversationHistory, userMessage) {
    console.log(`[FieldOffice] Conversation turn for ${contractorId}: "${userMessage}"`);
    const contractorResult = await pool.query('SELECT * FROM contractors WHERE id = $1', [contractorId]);
    const contractor = contractorResult.rows[0];
    if (!contractor) throw new Error(`Contractor ${contractorId} not found`);
    const systemPrompt = buildSystemPrompt(contractor, 'conversation');
    const messages = [...conversationHistory, { role: 'user', content: userMessage }];
    const { finalText, messages: updatedMessages } = await runLLMLoop(contractorId, messages, systemPrompt);
    const shouldHangUp = finalText.includes('[END_CALL]');
    const reply = finalText.replace('[END_CALL]', '').trim();
    return { reply, shouldHangUp, updatedHistory: updatedMessages };
}

module.exports = { runFieldOffice, runConversation };
