// fieldOffice.js - The AI Field Office Orchestrator
// "Run your office from your truck."
// Joshua's personal office manager — knows Fluid Productions inside and out.
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

// ─── EXTERNAL API HELPERS ─────────────────────────────────────────────────────
async function getInstantlyCampaigns() {
  try {
    const resp = await axios.get('https://api.instantly.ai/api/v1/campaign/list', {
      headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}` },
      params: { limit: 20, skip: 0 },
      timeout: 8000,
    });
    return { ok: true, campaigns: resp.data || [] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getSwitchboardStatus() {
  const base = process.env.SWITCHBOARD_URL;
  const headers = { Authorization: `Bearer ${process.env.SWITCHBOARD_API_KEY}` };
  try {
    const resp = await axios.get(`${base}/api/status`, { headers, timeout: 8000 });
    return { ok: true, data: resp.data };
  } catch {
    try {
      const r2 = await axios.get(`${base}/health`, { timeout: 5000 });
      return { ok: true, data: r2.data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

async function getN8nWorkflows() {
  try {
    const [wfResp, exResp] = await Promise.all([
      axios.get(`${process.env.N8N_BASE_URL}/api/v1/workflows`, {
        headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY },
        params: { limit: 20 },
        timeout: 8000,
      }),
      axios.get(`${process.env.N8N_BASE_URL}/api/v1/executions`, {
        headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY },
        params: { limit: 10 },
        timeout: 8000,
      }).catch(() => ({ data: { data: [] } })),
    ]);
    const workflows = wfResp.data?.data || [];
    const executions = exResp.data?.data || [];
    return {
      ok: true,
      workflows: workflows.map(w => ({
        name: w.name,
        active: w.active,
        id: w.id,
      })),
      recentExecutions: executions.slice(0, 5).map(e => ({
        workflow: e.workflowData?.name || e.workflowId,
        status: e.status,
        startedAt: e.startedAt,
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getSlackMessages(channel) {
  try {
    const resp = await axios.get('https://slack.com/api/conversations.history', {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      params: { channel: channel || process.env.SLACK_HAND_RAISES_CHANNEL || 'hand-raises', limit: 10 },
      timeout: 8000,
    });
    if (!resp.data?.ok) return { ok: false, error: resp.data?.error || 'Slack API error' };
    return {
      ok: true,
      messages: (resp.data.messages || []).map(m => ({
        text: m.text,
        ts: new Date(parseFloat(m.ts) * 1000).toLocaleString(),
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── FIELD OFFICE TOOLS ───────────────────────────────────────────────────────
const FIELD_OFFICE_TOOLS = [
  {
    name: 'look_up_contact',
    description: 'Look up a contact or prospect by name. Returns pipeline stage, recent notes, open deals. Use this whenever Joshua asks about any person, company, or project status.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person or company name to look up' },
      },
      required: ['name'],
    },
  },
  {
    name: 'check_appointments',
    description: 'Check upcoming appointments or scheduled calls. Can filter by name or return the full upcoming schedule.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Filter by name (optional)' },
      },
    },
  },
  {
    name: 'log_activity',
    description: 'Log any activity — a call, a demo, a meeting, a sale, a follow-up that happened. Adds a note to their GHL record.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        activity: { type: 'string', description: 'What happened' },
        outcome: { type: 'string', description: 'Result — interested, sold, no answer, follow up needed, etc.' },
        amount: { type: 'number', description: 'Dollar amount if a sale occurred' },
      },
      required: ['contact_name', 'activity'],
    },
  },
  {
    name: 'create_opportunity',
    description: 'Create a new sales opportunity or deal in the pipeline for a prospect.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        deal_name: { type: 'string' },
        value: { type: 'number' },
        stage: { type: 'string', description: 'Pipeline stage — New Lead, Demo Scheduled, Proposal Sent, Trial Started, Closed Won, Closed Lost' },
      },
      required: ['contact_name', 'deal_name'],
    },
  },
  {
    name: 'update_pipeline_stage',
    description: 'Move a contact to a different stage in the pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        stage: { type: 'string', description: 'New stage name' },
      },
      required: ['contact_name', 'stage'],
    },
  },
  {
    name: 'create_contact',
    description: 'Add a new prospect or contact to the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        business_type: { type: 'string', description: 'Type of contractor — HVAC, plumbing, roofing, etc.' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'schedule_followup',
    description: 'Schedule a follow-up call or task for a prospect.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        follow_up_date: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['contact_name', 'follow_up_date'],
    },
  },
  {
    name: 'send_follow_up_message',
    description: 'Queue a follow-up text or email to a prospect.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        message_type: { type: 'string', description: 'text or email' },
        context: { type: 'string', description: 'What the follow-up is about' },
      },
      required: ['contact_name'],
    },
  },
  {
    name: 'check_instantly',
    description: 'Check Instantly email campaign performance — active campaigns, sent counts, open rates, reply rates. Use when Joshua asks about email campaigns or outreach.',
    input_schema: {
      type: 'object',
      properties: {
        campaign_name: { type: 'string', description: 'Filter to a specific campaign name (optional)' },
      },
    },
  },
  {
    name: 'check_switchboard',
    description: 'Check Switchboard AI call system status — Anna (Speed to Lead) and Maya (After Hours) bot status, recent call activity, system health.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'check_n8n',
    description: 'Check n8n automation workflow status — which workflows are active, recent execution history, any failures. Use when Joshua asks about automations or workflows.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'check_slack',
    description: 'Check recent Slack messages in hand-raises or alerts channel. Shows recent leads that raised their hand or any system alerts.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel to check — hand-raises or alerts (default: hand-raises)' },
      },
    },
  },
  {
    name: 'get_system_status',
    description: 'Get a full health check of all systems at once — Switchboard, n8n, Instantly, Slack. Use when Joshua asks "how is everything running" or "give me a status check".',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── TOOL EXECUTOR ────────────────────────────────────────────────────────────
async function executeTool(toolName, toolInput, contractorId) {
  console.log(`[FieldOffice] Tool: ${toolName}`, toolInput);

  switch (toolName) {
    case 'look_up_contact': {
      const { name } = toolInput;
      const ghlContacts = await searchGHLContacts(name);
      if (ghlContacts.length === 0) {
        const localResult = await pool.query(
          `SELECT * FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 3`,
          [contractorId, `%${name}%`]
        );
        if (localResult.rows.length === 0) {
          return { found: false, message: `Nothing on "${name}" — not in GHL or local DB. Want me to add them?` };
        }
        return {
          found: true,
          source: 'local_db',
          contacts: localResult.rows.map(c => ({ name: c.name, phone: c.phone, email: c.email })),
        };
      }
      const contact = ghlContacts[0];
      const [notes, opportunities] = await Promise.all([
        getGHLContactNotes(contact.id),
        getGHLOpportunities(contact.id),
      ]);
      const recentNotes = notes.slice(0, 3).map(n => ({
        body: n.body,
        date: n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : 'unknown',
      }));
      const openDeals = opportunities.map(o => ({
        name: o.name,
        stage: o.pipelineStage?.name || o.status,
        value: o.monetaryValue,
        status: o.status,
      }));
      return {
        found: true,
        contact_name: contact.name,
        phone: contact.phone,
        email: contact.email,
        tags: contact.tags,
        pipeline_stage: openDeals[0]?.stage || contact.opportunityStage || 'no active deal',
        open_deals: openDeals,
        recent_notes: recentNotes,
        last_activity: contact.dateUpdated,
      };
    }

    case 'check_appointments': {
      const { customer_name } = toolInput;
      let query, params;
      if (customer_name) {
        query = `SELECT a.scheduled_at, a.notes, c.name as customer_name FROM appointments a JOIN contacts c ON a.contact_id = c.id WHERE a.contractor_id = $1 AND LOWER(c.name) LIKE LOWER($2) ORDER BY a.scheduled_at ASC LIMIT 5`;
        params = [contractorId, `%${customer_name}%`];
      } else {
        query = `SELECT a.scheduled_at, a.notes, c.name as customer_name FROM appointments a JOIN contacts c ON a.contact_id = c.id WHERE a.contractor_id = $1 AND a.scheduled_at >= NOW() ORDER BY a.scheduled_at ASC LIMIT 5`;
        params = [contractorId];
      }
      const result = await pool.query(query, params);
      if (result.rows.length === 0) {
        return { found: false, message: customer_name ? `Nothing scheduled for ${customer_name}.` : 'Schedule is clear.' };
      }
      const appts = result.rows.map(r => {
        const d = new Date(r.scheduled_at);
        return `${r.customer_name} — ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${r.notes ? ` (${r.notes})` : ''}`;
      });
      return { found: true, appointments: appts };
    }

    case 'log_activity': {
      const { contact_name, activity, outcome, amount } = toolInput;
      const contacts = await pool.query(
        `SELECT id, ghl_contact_id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
        [contractorId, `%${contact_name}%`]
      );
      let contactId = contacts.rows[0]?.id;
      if (!contactId) {
        const ghlContact = await createGHLContact({ name: contact_name }, contractorId);
        if (ghlContact?.id) {
          const res = await pool.query(
            `INSERT INTO contacts (contractor_id, name, ghl_contact_id) VALUES ($1, $2, $3) RETURNING id`,
            [contractorId, contact_name, ghlContact.id]
          );
          contactId = res.rows[0].id;
        }
      }
      if (contactId) {
        const noteText = `${activity}${outcome ? ` — ${outcome}` : ''}${amount ? ` — $${amount}` : ''}`;
        await addGHLNote(contactId, contractorId, noteText);
      }
      return { success: true, message: `Logged for ${contact_name}: ${activity}${outcome ? ` (${outcome})` : ''}` };
    }

    case 'create_opportunity': {
      const { contact_name, deal_name, value, stage } = toolInput;
      const contacts = await pool.query(
        `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
        [contractorId, `%${contact_name}%`]
      );
      let contactId = contacts.rows[0]?.id;
      if (!contactId) {
        const ghlContact = await createGHLContact({ name: contact_name }, contractorId);
        if (ghlContact?.id) {
          const res = await pool.query(
            `INSERT INTO contacts (contractor_id, name, ghl_contact_id) VALUES ($1, $2, $3) RETURNING id`,
            [contractorId, contact_name, ghlContact.id]
          );
          contactId = res.rows[0].id;
        }
      }
      if (contactId) {
        await createGHLOpportunity(contactId, contractorId, deal_name, value || 0);
        if (stage) await updateGHLContactStage(contactId, contractorId, stage);
      }
      return { success: true, message: `Opportunity created for ${contact_name}: ${deal_name}${value ? ` ($${value})` : ''}` };
    }

    case 'update_pipeline_stage': {
      const { contact_name, stage } = toolInput;
      const contacts = await pool.query(
        `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
        [contractorId, `%${contact_name}%`]
      );
      const contactId = contacts.rows[0]?.id;
      if (contactId) {
        await updateGHLContactStage(contactId, contractorId, stage);
        await addGHLNote(contactId, contractorId, `Stage updated to: ${stage}`);
      }
      return { success: true, message: `${contact_name} moved to ${stage}` };
    }

    case 'create_contact': {
      const { name, phone, email, business_type, notes } = toolInput;
      const ghlContact = await createGHLContact({ name, phone, email }, contractorId);
      if (ghlContact?.id) {
        await pool.query(
          `INSERT INTO contacts (contractor_id, name, phone, email, ghl_contact_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [contractorId, name, phone || null, email || null, ghlContact.id]
        );
        if (notes || business_type) {
          const noteText = [business_type ? `Contractor type: ${business_type}` : '', notes || ''].filter(Boolean).join(' — ');
          await addGHLNote(ghlContact.id, contractorId, noteText);
        }
      }
      return { success: true, message: `${name} added to CRM${business_type ? ` (${business_type})` : ''}` };
    }

    case 'schedule_followup': {
      const { contact_name, follow_up_date, notes } = toolInput;
      const contacts = await pool.query(
        `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
        [contractorId, `%${contact_name}%`]
      );
      const contactId = contacts.rows[0]?.id;
      if (contactId) {
        await addGHLNote(contactId, contractorId, `Follow-up scheduled: ${follow_up_date}${notes ? ` — ${notes}` : ''}`);
      }
      return { success: true, message: `Follow-up set for ${contact_name} on ${follow_up_date}` };
    }

    case 'send_follow_up_message': {
      const { contact_name, message_type, context } = toolInput;
      const contacts = await pool.query(
        `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
        [contractorId, `%${contact_name}%`]
      );
      const contactId = contacts.rows[0]?.id;
      if (contactId) {
        await addGHLNote(contactId, contractorId, `Follow-up ${message_type || 'message'} queued${context ? `: ${context}` : ''}`);
      }
      return { success: true, message: `Follow-up ${message_type || 'message'} queued for ${contact_name}` };
    }

    case 'check_instantly': {
      const { campaign_name } = toolInput;
      const result = await getInstantlyCampaigns();
      if (!result.ok) return { error: `Instantly unreachable: ${result.error}` };
      let campaigns = result.campaigns;
      if (campaign_name) {
        campaigns = campaigns.filter(c => c.name?.toLowerCase().includes(campaign_name.toLowerCase()));
      }
      if (campaigns.length === 0) return { found: false, message: 'No campaigns found' };
      return {
        total: campaigns.length,
        active: campaigns.filter(c => c.status === 1).length,
        paused: campaigns.filter(c => c.status !== 1).length,
        campaigns: campaigns.map(c => ({
          name: c.name,
          status: c.status === 1 ? 'active' : 'paused',
          sent: c.total_sent || 0,
          opens: c.total_opened || 0,
          replies: c.total_replied || 0,
          open_rate: c.total_sent ? ((c.total_opened / c.total_sent) * 100).toFixed(1) + '%' : 'N/A',
        })),
      };
    }

    case 'check_switchboard': {
      const result = await getSwitchboardStatus();
      if (!result.ok) return { error: `Switchboard unreachable: ${result.error}` };
      return { status: 'online', data: result.data };
    }

    case 'check_n8n': {
      const result = await getN8nWorkflows();
      if (!result.ok) return { error: `n8n unreachable: ${result.error}` };
      const active = result.workflows.filter(w => w.active);
      const inactive = result.workflows.filter(w => !w.active);
      const failures = result.recentExecutions.filter(e => e.status === 'error');
      return {
        total_workflows: result.workflows.length,
        active_count: active.length,
        inactive_count: inactive.length,
        active_workflows: active.map(w => w.name),
        inactive_workflows: inactive.map(w => w.name),
        recent_executions: result.recentExecutions,
        failures: failures.length > 0 ? failures : 'None — all good',
      };
    }

    case 'check_slack': {
      const { channel } = toolInput;
      const result = await getSlackMessages(channel);
      if (!result.ok) return { error: `Slack unreachable: ${result.error}` };
      return {
        channel: channel || 'hand-raises',
        message_count: result.messages.length,
        messages: result.messages,
      };
    }

    case 'get_system_status': {
      const [sbResult, n8nResult, instantlyResult, slackResult] = await Promise.all([
        getSwitchboardStatus(),
        getN8nWorkflows(),
        getInstantlyCampaigns(),
        getSlackMessages(process.env.SLACK_HAND_RAISES_CHANNEL || 'hand-raises'),
      ]);

      const campaigns = instantlyResult.campaigns || [];
      const activeCampaigns = campaigns.filter(c => c.status === 1).length;
      const n8nActive = n8nResult.workflows ? n8nResult.workflows.filter(w => w.active).length : 0;
      const n8nTotal = n8nResult.workflows ? n8nResult.workflows.length : 0;
      const failures = n8nResult.recentExecutions ? n8nResult.recentExecutions.filter(e => e.status === 'error') : [];

      return {
        switchboard: sbResult.ok ? 'online' : `DOWN: ${sbResult.error}`,
        n8n: n8nResult.ok ? `${n8nActive}/${n8nTotal} workflows active${failures.length ? `, ${failures.length} failures` : ''}` : `DOWN: ${n8nResult.error}`,
        instantly: instantlyResult.ok ? `${activeCampaigns} active campaigns of ${campaigns.length} total` : `DOWN: ${instantlyResult.error}`,
        slack: slackResult.ok ? `Connected, ${slackResult.messages.length} recent hand-raises` : `DOWN: ${slackResult.error}`,
        backend: 'online',
        n8n_failures: failures,
        recent_hand_raises: slackResult.messages ? slackResult.messages.slice(0, 3) : [],
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
function buildSystemPrompt(contractor, mode) {
  const persona = `You are Joshua Brown's personal office manager at Fluid Productions LLC. Joshua calls you from the field and you run everything back at the office.

ABOUT THE BUSINESS:
Fluid Productions sells AI-powered systems to contractors. We have three products:

TIER 1 — AFTER HOURS RECEPTIONIST
The AI answers calls after hours so contractors never miss a lead.
- $397/month | 14-day free trial | $297 one-time setup
- Includes 300 minutes/month | $0.40/min overage

TIER 2 — SPEED TO LEAD
Contractor runs ads, prospect fills out a form, our Switchboard AI calls them back within 60 seconds. Contractors paying for ads are burning money on leads that never get called back — this fixes that.
- $997/month | 14-day free trial | $697 one-time setup
- Includes 1,200 minutes/month | $0.40/min overage

TIER 3 — COMPLETE PACKAGE (THE AI EMPLOYEE)
Everything in Tiers 1 and 2 plus the full AI employee — handles the office, manages the pipeline, logs jobs, follows up, runs the whole back office. This is the top tier.
- $1,497/month | 14-day free trial | $997 one-time setup
- Includes 2,000 minutes/month | $0.40/min overage

WHO BUYS THIS:
Contractors — HVAC, plumbing, roofing, electrical, pest control. Best prospects are running paid ads because they're already paying for leads and losing them after hours or being too slow to call back.

PIPELINE STAGES (in order):
New Lead → Demo Scheduled → Proposal Sent → Trial Started → Closed Won → Closed Lost

YOUR SYSTEMS:
- Switchboard: AI call platform (Anna = Speed to Lead bot, Maya = After Hours bot)
- n8n: Automation workflows (Reply Handler, Pipeline Watchdog, Campaign Launcher, Lead Machine)
- Instantly: Cold email outreach campaigns
- Slack: #hand-raises channel for hot leads, #alerts for system issues
- GHL (GoHighLevel): CRM and pipeline

YOUR JOB:
You know every prospect, every deal, every follow-up. When Joshua asks about someone, pull their record and give him a real answer — what stage they're in, what the last note says, which tier they're interested in, whether they've gone cold. When he tells you something happened, log it. When he needs something done, do it. When he asks about system status, CHECK the actual systems — don't guess or say "I don't have that data."

Talk like a real person. Short. Direct. No corporate speak. You've worked for Joshua for years and know how he operates.`;

  if (mode === 'conversation') {
    return `${persona}

ON THE PHONE RIGHT NOW:
- 1 to 3 sentences max. Don't ramble.
- Do the work, report the result. Don't narrate what you're doing.
- End every response with "anything else?" unless the conversation is clearly wrapping up.
- If Joshua says he's done — "that's it", "all good", "bye", "nothing else", "I'm good" — give him a quick sign-off and add [END_CALL] at the very end. Only add [END_CALL] when he's wrapping up, never before.`;
  }

  return `${persona}

You're processing a voice memo. Handle every task mentioned, execute the tools, then give Joshua a clean bullet summary of everything that got done.`;
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
