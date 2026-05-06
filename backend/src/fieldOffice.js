// fieldOffice.js - The AI Field Office Orchestrator
// "Run your office from your truck."
// Joshua's personal office manager — knows Fluid Productions inside and out.
'use strict';

const axios = require('axios');
const pool = require('./db');
const { createGHLContact, updateGHLContactStage, addGHLNote, createGHLOpportunity } = require('./ghl');
const { makeCall, sendSMS } = require('./telnyx');
const outboundQueue = require('./outboundQueue');
const { createInvoice } = require('./skills/invoicer');

// Raw OpenRouter fetch — bypasses Anthropic SDK response mangling
// Includes 30s timeout + one retry on 429/5xx
async function openRouterMessages(params, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://fluid-os.aiteammate.io',
        'X-Title': 'Fluid Productions Bob',
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      // Retry once on rate-limit or server error
      if (attempt === 1 && (res.status === 429 || res.status >= 500)) {
        await new Promise(r => setTimeout(r, 2000));
        return openRouterMessages(params, 2);
      }
      throw new Error(`OpenRouter error ${res.status}: ${err}`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('OpenRouter request timed out after 30s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
    const resp = await axios.get('https://api.instantly.ai/api/v2/campaigns', {
      headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}` },
      params: { limit: 20, skip: 0 },
      timeout: 8000,
    });
    const raw = resp.data;
    const list = Array.isArray(raw) ? raw : (raw?.items || raw?.campaigns || raw?.data || []);
    return { ok: true, campaigns: list };
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

// ─── NEW: INFRASTRUCTURE HELPERS ──────────────────────────────────────────────

// Known Railway service URLs — override via env vars
const RAILWAY_SERVICES = [
  { name: 'n8n',           url: () => `${process.env.N8N_BASE_URL || 'https://n8n-production-5955.up.railway.app'}/healthz` },
  { name: 'Switchboard',   url: () => `${process.env.SWITCHBOARD_URL}/health` },
  { name: 'Contractor OS', url: () => `${process.env.SELF_URL || 'https://backend-production-b9fc.up.railway.app'}/health` },
  { name: 'Fluid OS',      url: () => process.env.FLUID_OS_URL ? `${process.env.FLUID_OS_URL}/api/health` : null },
];

async function checkRailwayServices() {
  const checks = RAILWAY_SERVICES
    .map(s => ({ name: s.name, url: s.url() }))
    .filter(s => s.url);

  const results = await Promise.all(checks.map(async ({ name, url }) => {
    const start = Date.now();
    try {
      const resp = await axios.get(url, { timeout: 7000 });
      return { name, status: 'online', latencyMs: Date.now() - start, httpStatus: resp.status };
    } catch (err) {
      const latency = Date.now() - start;
      if (err.response) {
        // Got a response but non-2xx — still "up" if it's 401/403 (auth wall)
        const reachable = [401, 403, 404].includes(err.response.status);
        return { name, status: reachable ? 'online' : 'degraded', latencyMs: latency, httpStatus: err.response.status };
      }
      return { name, status: 'offline', latencyMs: latency, error: err.message };
    }
  }));
  return results;
}

async function triggerN8nWorkflow(workflowName, action = 'restart') {
  const headers = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
  const base = process.env.N8N_BASE_URL;

  // Find the workflow by name
  const listResp = await axios.get(`${base}/api/v1/workflows`, {
    headers,
    params: { limit: 50 },
    timeout: 8000,
  });
  const workflows = listResp.data?.data || [];
  const match = workflows.find(w =>
    w.name.toLowerCase().includes(workflowName.toLowerCase())
  );
  if (!match) {
    return {
      ok: false,
      error: `No workflow found matching "${workflowName}"`,
      available: workflows.map(w => w.name),
    };
  }

  if (action === 'activate') {
    await axios.patch(`${base}/api/v1/workflows/${match.id}`, { active: true }, { headers, timeout: 8000 });
    return { ok: true, message: `✅ "${match.name}" activated`, workflowId: match.id };
  }

  if (action === 'deactivate') {
    await axios.patch(`${base}/api/v1/workflows/${match.id}`, { active: false }, { headers, timeout: 8000 });
    return { ok: true, message: `⏸ "${match.name}" deactivated`, workflowId: match.id };
  }

  // Default: restart = deactivate → wait → activate
  await axios.patch(`${base}/api/v1/workflows/${match.id}`, { active: false }, { headers, timeout: 8000 });
  await new Promise(r => setTimeout(r, 600));
  await axios.patch(`${base}/api/v1/workflows/${match.id}`, { active: true }, { headers, timeout: 8000 });
  return { ok: true, message: `🔄 "${match.name}" restarted (off → on)`, workflowId: match.id };
}

async function checkGuardianSentinel() {
  try {
    const resp = await axios.get(`${process.env.N8N_BASE_URL}/api/v1/executions`, {
      headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY },
      params: { limit: 50 },
      timeout: 10000,
    });
    const all = resp.data?.data || [];
    const agentRuns = all.filter(e => {
      const name = (e.workflowData?.name || '').toLowerCase();
      return name.includes('guardian') || name.includes('sentinel');
    });

    if (agentRuns.length === 0) {
      // Also try searching workflows for Guardian/Sentinel to confirm they exist
      const wfResp = await axios.get(`${process.env.N8N_BASE_URL}/api/v1/workflows`, {
        headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY },
        params: { limit: 50 },
        timeout: 8000,
      }).catch(() => ({ data: { data: [] } }));
      const agents = (wfResp.data?.data || []).filter(w => {
        const n = w.name.toLowerCase();
        return n.includes('guardian') || n.includes('sentinel');
      });
      return {
        found: false,
        agentWorkflows: agents.map(w => ({ name: w.name, active: w.active, id: w.id })),
        message: agents.length
          ? `Guardian/Sentinel workflows exist but haven't run recently: ${agents.map(a => a.name).join(', ')}`
          : 'No Guardian or Sentinel workflows found in n8n',
      };
    }

    return {
      found: true,
      totalRuns: agentRuns.length,
      runs: agentRuns.slice(0, 6).map(e => ({
        agent: e.workflowData?.name || 'Unknown',
        status: e.status,
        startedAt: e.startedAt ? new Date(e.startedAt).toLocaleString() : 'N/A',
        duration: (e.stoppedAt && e.startedAt)
          ? `${((new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000).toFixed(1)}s`
          : 'N/A',
        error: e.status === 'error' ? e.data?.resultData?.error?.message : null,
      })),
      lastSuccess: agentRuns.find(e => e.status === 'success')?.startedAt
        ? new Date(agentRuns.find(e => e.status === 'success').startedAt).toLocaleString()
        : 'None found',
    };
  } catch (err) {
    return { ok: false, error: `Guardian/Sentinel check failed: ${err.message}` };
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
    description: 'Get a full health check of all systems at once — Switchboard, n8n, Instantly, Slack, Railway services. Use when Joshua asks "how is everything running" or "give me a status check".',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  // ── NEW TOOLS ──────────────────────────────────────────────────────────────
  {
    name: 'check_railway',
    description: 'Ping every Railway service and report health — n8n, Switchboard, Contractor OS backend, Fluid OS dashboard. Shows which are online, offline, or slow. Use when Joshua asks about infrastructure or server health.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'trigger_n8n_workflow',
    description: 'Restart, activate, or deactivate a specific n8n workflow by name. Use to fix a stuck automation, restart a failing pipeline like Campaign Launcher or After Hours, or toggle workflows on/off. Always check_n8n first to confirm the workflow name.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_name: {
          type: 'string',
          description: 'Name or partial name of the workflow — e.g. "Campaign Launcher", "After Hours", "Speed to Lead"',
        },
        action: {
          type: 'string',
          enum: ['restart', 'activate', 'deactivate'],
          description: 'restart = toggle off then on (default). activate = turn on. deactivate = turn off.',
        },
      },
      required: ['workflow_name'],
    },
  },
  {
    name: 'check_guardian_sentinel',
    description: 'Check the last runs of Guardian and Sentinel — the self-healing AI agents that monitor and fix the automation stack. Shows whether they ran, what status they finished with, and any errors they hit.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'send_invoice',
    description: 'Send an invoice via SMS to a customer. Looks up their phone from GHL, creates an invoice record, and texts them the amount with an optional payment link. Use when Joshua says "send Mike an invoice for $X", "invoice the Johnson job", or "bill them for the repair".',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string', description: 'Customer name to look up in GHL' },
        service_type: { type: 'string', description: 'What the job was — AC repair, roof replacement, tune-up, etc.' },
        amount: { type: 'number', description: 'Dollar amount for the invoice' },
        job_description: { type: 'string', description: 'Brief description of work done (optional)' },
        payment_link: { type: 'string', description: 'Stripe or other payment link URL (optional)' },
      },
      required: ['contact_name', 'amount'],
    },
  },
  {
    name: 'send_text',
    description: 'Send an actual SMS text message to a customer. Looks up their number from GHL by name. Use when Joshua says "text Mike and tell him...", "shoot the Johnson job a message", or "let them know...".',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string', description: 'Customer name to look up for their phone number' },
        message: { type: 'string', description: 'The text message to send. Keep under 160 characters, natural tone.' },
        phone_number: { type: 'string', description: 'Direct phone in E.164 format — use instead of contact_name if you already have it' },
      },
      required: ['message'],
    },
  },
  {
    name: 'request_review',
    description: 'Send a Google review request via SMS to a customer after a completed job. Use when Joshua says "ask Mike for a review", "send a review request", or "get a Google review from the Johnson job".',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string', description: 'Customer name to send the review request to' },
        job_type: { type: 'string', description: 'Type of job completed — used to personalize the message (e.g. roof replacement, AC tune-up)' },
      },
      required: ['contact_name'],
    },
  },
  {
    name: 'make_outbound_call',
    description: 'Place an outbound phone call to a contact. Bob will speak the message when they answer, then hang up. Use for customer follow-ups, invoice ready notifications, appointment reminders, or check-ins. Bob\'s number is (321) 465-7132.',
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Phone number to call in E.164 format — e.g. +14075551234',
        },
        contact_name: {
          type: 'string',
          description: 'Name of the person being called (used in the message)',
        },
        message: {
          type: 'string',
          description: 'Exactly what Bob should say when the call is answered. Keep it under 60 words — natural, friendly, no robocall feel.',
        },
      },
      required: ['phone_number', 'message'],
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
      // Look up phone from GHL so we can actually send the message
      const ghlContacts = await searchGHLContacts(contact_name);
      const contact = ghlContacts[0];
      if (contact?.phone && message_type !== 'email') {
        const msg = context
          ? `Hi ${contact.name?.split(' ')[0] || 'there'}, just following up — ${context}`
          : `Hi ${contact.name?.split(' ')[0] || 'there'}, just checking in. Let us know if you have any questions!`;
        await sendSMS(contact.phone, msg.substring(0, 160));
        // Also log the note in GHL
        const localContact = await pool.query(
          `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
          [contractorId, `%${contact_name}%`]
        );
        if (localContact.rows[0]?.id) {
          await addGHLNote(localContact.rows[0].id, contractorId, `Follow-up text sent: ${msg}`);
        }
        return { success: true, message: `Follow-up text sent to ${contact.name} at ${contact.phone}` };
      }
      // Fallback: log the note if no phone found
      const localContact = await pool.query(
        `SELECT id FROM contacts WHERE contractor_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1`,
        [contractorId, `%${contact_name}%`]
      );
      if (localContact.rows[0]?.id) {
        await addGHLNote(localContact.rows[0].id, contractorId, `Follow-up ${message_type || 'message'} needed${context ? `: ${context}` : ''}`);
      }
      return { success: false, message: `No phone found for ${contact_name} — logged a note in GHL instead` };
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
      const [sbResult, n8nResult, instantlyResult, slackResult, railwayResult] = await Promise.all([
        getSwitchboardStatus(),
        getN8nWorkflows(),
        getInstantlyCampaigns(),
        getSlackMessages(process.env.SLACK_HAND_RAISES_CHANNEL || 'hand-raises'),
        checkRailwayServices(),
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
        railway: railwayResult.map(s => `${s.name}: ${s.status}${s.latencyMs ? ` (${s.latencyMs}ms)` : ''}`),
        backend: 'online',
        n8n_failures: failures,
        recent_hand_raises: slackResult.messages ? slackResult.messages.slice(0, 3) : [],
      };
    }

    // ── NEW TOOL CASES ─────────────────────────────────────────────────────────

    case 'check_railway': {
      const results = await checkRailwayServices();
      const online = results.filter(s => s.status === 'online');
      const offline = results.filter(s => s.status === 'offline');
      const degraded = results.filter(s => s.status === 'degraded');
      return {
        summary: offline.length === 0 && degraded.length === 0
          ? `All ${results.length} services online`
          : `${online.length} online, ${degraded.length} degraded, ${offline.length} offline`,
        services: results,
        alerts: [
          ...offline.map(s => `🔴 ${s.name} is OFFLINE — ${s.error || 'no response'}`),
          ...degraded.map(s => `🟡 ${s.name} returned HTTP ${s.httpStatus}`),
        ],
      };
    }

    case 'trigger_n8n_workflow': {
      const { workflow_name, action = 'restart' } = toolInput;
      try {
        const result = await triggerN8nWorkflow(workflow_name, action);
        return result;
      } catch (err) {
        return { ok: false, error: `Failed to ${action} workflow: ${err.message}` };
      }
    }

    case 'check_guardian_sentinel': {
      return await checkGuardianSentinel();
    }

    case 'make_outbound_call': {
      const { phone_number, contact_name, message } = toolInput;
      const selfUrl = process.env.SELF_URL || 'https://frontend-production-33e9.up.railway.app';
      const webhookUrl = `${selfUrl}/api/voice/webhook`;

      try {
        const callResult = await makeCall(phone_number, webhookUrl);
        // Store the message so voice.js webhook can retrieve it when the call is answered
        outboundQueue.set(callResult.callControlId, {
          message,
          contactName: contact_name || phone_number,
          initiatedAt: new Date().toISOString(),
        });
        return {
          success: true,
          message: `📞 Calling ${contact_name || phone_number} now. Bob will say: "${message}"`,
          callControlId: callResult.callControlId,
        };
      } catch (err) {
        return { success: false, error: `Call failed: ${err.message}` };
      }
    }

    case 'send_invoice': {
      const { contact_name, service_type, amount, job_description, payment_link } = toolInput;
      const ghlContacts = await searchGHLContacts(contact_name);
      const contact = ghlContacts[0];
      if (!contact || !contact.phone) {
        return { success: false, error: `No phone number found for ${contact_name} in GHL. Make sure they're in the system.` };
      }
      const contractorRow = await pool.query('SELECT * FROM contractors WHERE id = $1', [contractorId]);
      const contractor = contractorRow.rows[0];
      const result = await createInvoice(contractor, contact.phone, {
        customerName: contact.name,
        serviceType: service_type || 'Service',
        amount,
        jobDescription: job_description,
        paymentLink: payment_link,
      });
      return {
        success: result.success,
        message: `Invoice sent to ${contact.name} at ${contact.phone} for $${amount}${service_type ? ` (${service_type})` : ''}`,
        smsSent: result.smsSent,
      };
    }

    case 'send_text': {
      const { contact_name, message, phone_number } = toolInput;
      let toPhone = phone_number;
      let toName = contact_name;
      if (!toPhone && contact_name) {
        const ghlContacts = await searchGHLContacts(contact_name);
        const contact = ghlContacts[0];
        if (!contact || !contact.phone) {
          return { success: false, error: `No phone number found for ${contact_name} in GHL.` };
        }
        toPhone = contact.phone;
        toName = contact.name;
      }
      if (!toPhone) {
        return { success: false, error: 'Need a contact name or phone number to send a text.' };
      }
      await sendSMS(toPhone, message);
      return { success: true, message: `Text sent to ${toName || toPhone}: "${message}"` };
    }

    case 'request_review': {
      const { contact_name, job_type } = toolInput;
      const ghlContacts = await searchGHLContacts(contact_name);
      const contact = ghlContacts[0];
      if (!contact || !contact.phone) {
        return { success: false, error: `No phone number found for ${contact_name} in GHL.` };
      }
      const contractorRow = await pool.query('SELECT * FROM contractors WHERE id = $1', [contractorId]);
      const contractor = contractorRow.rows[0];
      const memResult = await pool.query(
        "SELECT value FROM memory WHERE contractor_id = $1 AND key = 'google_review_link'",
        [contractorId]
      ).catch(() => ({ rows: [] }));
      const reviewLink = memResult.rows[0]?.value || 'https://g.page/r/review';
      const companyName = contractor.company_name || contractor.name;
      const firstName = contact.name?.split(' ')[0] || 'there';
      const jobText = job_type || 'recent project';
      const smsBody = `Hi ${firstName}! Hope your ${jobText} is going great. We'd love a quick review: ${reviewLink} — ${companyName}`;
      await sendSMS(contact.phone, smsBody);
      return { success: true, message: `Review request sent to ${contact.name} at ${contact.phone}` };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
function buildSystemPrompt(contractor, mode) {
  const persona = `Your name is Bob. You are Joshua Brown's personal AI office manager at Fluid Productions LLC. Your phone number is (321) 465-7132. Joshua calls you from the field and you run everything back at the office.

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

YOUR SYSTEMS (you can monitor AND control all of these):
- Switchboard: AI call platform (Anna = Speed to Lead bot, Maya = After Hours bot)
- n8n: Automation workflows — you can restart any of them if they break
- Instantly: Cold email outreach campaigns
- Slack: #hand-raises channel for hot leads, #alerts for system issues
- GHL (GoHighLevel): CRM and pipeline
- Railway: Infrastructure hosting — you can ping each service to check health
- Guardian & Sentinel: Self-healing AI agents that monitor and auto-fix the automation stack

YOUR CAPABILITIES:
- Look up any contact or prospect in GHL
- Log calls, meetings, and activities
- Move deals through the pipeline
- Schedule follow-ups
- Check all system health (Railway, n8n, Switchboard, Instantly, Slack)
- Restart broken n8n workflows
- Check whether Guardian/Sentinel ran and what they fixed
- Make outbound calls to customers (Bob's number: (321) 465-7132)

YOUR JOB:
You know every prospect, every deal, every follow-up. When Joshua asks about someone, pull their record and give him a real answer — what stage they're in, what the last note says, which tier they're interested in, whether they've gone cold. When he tells you something happened, log it. When he needs something done, do it. When he asks about system status, CHECK the actual systems — don't guess or say "I don't have that data." If a workflow is broken, restart it. If Guardian/Sentinel missed something, handle it yourself.

Talk like a real person. Short. Direct. No corporate speak. You've worked for Joshua for years and know how he operates.`;

  if (mode === 'briefing') {
    return `${persona}

YOU'RE CALLING JOSHUA FOR HIS SCHEDULED BRIEFING:
- You initiated this call. Start by running the relevant status check tools immediately.
- Give a tight verbal summary — what's green, what's red, any action needed.
- Keep it under 90 seconds of spoken content. Think news anchor, not essay.
- After your report say "Anything you want me to dig into?" and wait.
- If Joshua says he's done — "that's it", "good", "bye", "thanks Bob" — wrap up and add [END_CALL].`;
  }

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
    const response = await openRouterMessages({
      model: 'anthropic/claude-3-5-sonnet-20241022',
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

module.exports = { runFieldOffice, runConversation, buildSystemPrompt };
