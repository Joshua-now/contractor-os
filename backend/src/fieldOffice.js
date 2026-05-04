// fieldOffice.js - The AI Field Office Orchestrator
// "Run your office from your truck."
// Supports both batch mode (single-shot voice memo) and conversation mode (interactive back-and-forth)
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('./db');
const { createGHLContact, updateGHLContactStage, addGHLNote, createGHLOpportunity } = require('./ghl');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── FIELD OFFICE TOOLS ───────────────────────────────────────────────────────
// These are the "office actions" the AI can take on behalf of the contractor

const FIELD_OFFICE_TOOLS = [
  {
        name: 'complete_job',
        description: 'Mark a job as completed and log what was sold/done.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string', description: 'Customer full name' },
                          job_description: { type: 'string', description: 'What was done or sold' },
                          amount: { type: 'number', description: 'Dollar amount if applicable' },
                },
                required: ['customer_name', 'job_description'],
        },
  },
  {
        name: 'create_invoice',
        description: 'Create an invoice for a customer in GHL.',
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
        description: 'Send a thank-you message to a customer after a job.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string' },
                          job_summary: { type: 'string', description: 'Brief summary of what was done' },
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
        name: 'check_appointment',
        description: 'Look up appointment details for a customer or date.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string', description: 'Customer name to look up' },
                          date: { type: 'string', description: 'Date to check, e.g. today, tomorrow, May 5' },
                },
        },
  },
  {
        name: 'create_contact',
        description: 'Create a new contact in GHL CRM.',
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
        name: 'get_job_status',
        description: 'Get the current status of a job or project for a customer.',
        input_schema: {
                type: 'object',
                properties: {
                          customer_name: { type: 'string' },
                },
                required: ['customer_name'],
        },
  },
  {
        name: 'schedule_followup',
        description: 'Schedule a follow-up call or visit for a customer.',
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
    console.log(`[FieldOffice] Executing tool: ${toolName}`, toolInput);

  switch (toolName) {
    case 'complete_job': {
            const { customer_name, job_description, amount } = toolInput;
            // Find or create contact in GHL, then add note
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
                      await addGHLNote(contactId, contractorId, `Job completed: ${job_description}${amount ? ` — $${amount}` : ''}`);
            }
            return { success: true, message: `Job logged for ${customer_name}: ${job_description}` };
    }

    case 'create_invoice': {
            const { customer_name, amount, description } = toolInput;
            // Log invoice as a note + opportunity in GHL
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
                      await createGHLOpportunity(contactId, contractorId, `Invoice: ${description}`, amount);
                      await addGHLNote(contactId, contractorId, `Invoice created: ${description} — $${amount}`);
            }
            return { success: true, message: `Invoice queued for ${customer_name}: $${amount} — ${description}` };
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
            return { success: true, message: `${customer_name} added to maintenance plan` };
    }

    case 'check_appointment': {
            const { customer_name, date } = toolInput;
            // Query DB for upcoming appointments
            let query, params;
            if (customer_name) {
                      query = `SELECT a.scheduled_at, a.notes, c.name as customer_name 
                                       FROM appointments a 
                                                        JOIN contacts c ON a.contact_id = c.id 
                                                                         WHERE a.contractor_id = $1 AND LOWER(c.name) LIKE LOWER($2)
                                                                                          ORDER BY a.scheduled_at ASC LIMIT 3`;
                      params = [contractorId, `%${customer_name}%`];
            } else {
                      query = `SELECT a.scheduled_at, a.notes, c.name as customer_name 
                                       FROM appointments a 
                                                        JOIN contacts c ON a.contact_id = c.id 
                                                                         WHERE a.contractor_id = $1 AND a.scheduled_at >= NOW()
                                                                                          ORDER BY a.scheduled_at ASC LIMIT 5`;
                      params = [contractorId];
            }
            const result = await pool.query(query, params);
            if (result.rows.length === 0) {
                      return { found: false, message: `No appointments found${customer_name ? ` for ${customer_name}` : ''}` };
            }
            const appts = result.rows.map(r => {
                      const d = new Date(r.scheduled_at);
                      return `${r.customer_name} on ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}${r.notes ? ` — ${r.notes}` : ''}`;
            });
            return { found: true, appointments: appts };
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
            return { success: true, message: `Contact created: ${name}` };
    }

    case 'get_job_status': {
            const { customer_name } = toolInput;
            const result = await pool.query(
                      `SELECT j.status, j.description, j.updated_at, c.name
                               FROM jobs j JOIN contacts c ON j.contact_id = c.id
                                        WHERE j.contractor_id = $1 AND LOWER(c.name) LIKE LOWER($2)
                                                 ORDER BY j.updated_at DESC LIMIT 3`,
                      [contractorId, `%${customer_name}%`]
                    );
            if (result.rows.length === 0) {
                      return { found: false, message: `No jobs found for ${customer_name}` };
            }
            const jobs = result.rows.map(r => `${r.name}: ${r.status} — ${r.description}`);
            return { found: true, jobs };
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
            return { success: true, message: `Follow-up scheduled for ${customer_name} on ${follow_up_date}` };
    }

    default:
            return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── SYSTEM PROMPT BUILDER ────────────────────────────────────────────────────

function buildSystemPrompt(contractor, mode) {
    const base = `You are the AI field office assistant for ${contractor.company_name || contractor.name}, a contractor business.
    Your job is to help the contractor manage their business hands-free while they're on the road.

    You have access to tools to: log completed jobs, create invoices, send thank-you messages, add customers to maintenance plans, check appointments, create contacts, get job status, and schedule follow-ups.

    When the contractor gives you tasks, execute them using the available tools. After executing tools, report back concisely what was done.`;

  if (mode === 'conversation') {
        return `${base}

        CONVERSATION MODE RULES:
        - You are in a live phone call. Keep responses SHORT — 1 to 3 sentences max per turn.
        - After completing a task or answering a question, always end with "Anything else?" to keep the conversation open.
        - Execute tools silently — just report the result, don't narrate what you're doing.
        - If the contractor says anything like "that's it", "all done", "nothing else", "bye", "goodbye", "that's all" — say a brief goodbye and append [END_CALL] at the very end of your response.
        - Never add [END_CALL] unless the contractor explicitly signals they are done.
        - Be friendly and efficient. You're like a trusted office teammate, not a robot.`;
  }

  // batch mode
  return `${base}

  BATCH MODE RULES:
  - Process all tasks from the transcript in one pass.
  - Execute every relevant tool you can identify.
  - After all tools are done, give a brief summary of everything that was completed.
  - Be comprehensive — don't miss any tasks mentioned.`;
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

      console.log(`[FieldOffice] LLM response stop_reason: ${response.stop_reason}`);

      // Add assistant response to message history
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
              // Extract final text
          const textBlock = response.content.find(b => b.type === 'text');
              return { finalText: textBlock?.text || '', messages };
      }

      if (response.stop_reason === 'tool_use') {
              // Execute all tool calls
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

      // Unexpected stop reason
      break;
  }

  return { finalText: 'I ran into an issue processing that. Please try again.', messages };
}

// ─── BATCH MODE (original single-shot) ───────────────────────────────────────

async function runFieldOffice(contractorId, transcript) {
    console.log(`[FieldOffice] Running batch mode for contractor ${contractorId}`);

  const contractorResult = await pool.query(
        'SELECT * FROM contractors WHERE id = $1',
        [contractorId]
      );
    const contractor = contractorResult.rows[0];
    if (!contractor) throw new Error(`Contractor ${contractorId} not found`);

  const systemPrompt = buildSystemPrompt(contractor, 'batch');
    const messages = [{ role: 'user', content: transcript }];

  const { finalText } = await runLLMLoop(contractorId, messages, systemPrompt);
    return finalText;
}

// ─── CONVERSATION MODE (interactive back-and-forth) ───────────────────────────

async function runConversation(contractorId, conversationHistory, userMessage) {
    console.log(`[FieldOffice] Conversation turn for contractor ${contractorId}: "${userMessage}"`);

  const contractorResult = await pool.query(
        'SELECT * FROM contractors WHERE id = $1',
        [contractorId]
      );
    const contractor = contractorResult.rows[0];
    if (!contractor) throw new Error(`Contractor ${contractorId} not found`);

  const systemPrompt = buildSystemPrompt(contractor, 'conversation');

  // Build messages: history + new user message
  const messages = [...conversationHistory, { role: 'user', content: userMessage }];

  const { finalText, messages: updatedMessages } = await runLLMLoop(contractorId, messages, systemPrompt);

  // Check if AI wants to end the call
  const shouldHangUp = finalText.includes('[END_CALL]');
    // Clean the token from spoken text
  const reply = finalText.replace('[END_CALL]', '').trim();

  return {
        reply,
        shouldHangUp,
        updatedHistory: updatedMessages,
  };
}

module.exports = { runFieldOffice, runConversation };
