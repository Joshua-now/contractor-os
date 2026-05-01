const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('./db');
const { qualifyLead } = require('./skills/leadQualifier');
const { speedToLead } = require('./skills/speedToLead');
const { bookAppointment } = require('./skills/appointmentBooker');
const { followUpEstimate } = require('./skills/estimateFollowUp');
const { requestReview } = require('./skills/reviewRequestor');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getContractorContext(contractorId) {
  const { rows: memoryRows } = await pool.query(
    'SELECT key, value, category FROM memory WHERE contractor_id = $1 ORDER BY category',
    [contractorId]
  );
  const { rows: recentConvos } = await pool.query(
    'SELECT channel, direction, from_number, message, ai_response, created_at FROM conversations WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 20',
    [contractorId]
  );
  const { rows: [contractor] } = await pool.query(
    'SELECT * FROM contractors WHERE id = $1',
    [contractorId]
  );
  return { contractor, memory: memoryRows, recentConversations: recentConvos };
}

async function buildSystemPrompt(contractorId) {
  const { contractor, memory, recentConversations } = await getContractorContext(contractorId);
  
  const memoryStr = memory.map(m => `[${m.category}] ${m.key}: ${m.value}`).join('
');
  const convoStr = recentConversations.slice(0, 10).map(c =>
    `[${c.direction}] ${c.message || ''} -> ${c.ai_response || ''}`
  ).join('
');

  return `You are an AI assistant for ${contractor.business_name}, a ${contractor.trade_type} contractor.

BUSINESS INFO:
- Trade: ${contractor.trade_type}
- Service Areas (ZIP codes): ${(contractor.service_zips || []).join(', ')}
- Working Hours: ${contractor.working_hours?.start} - ${contractor.working_hours?.end}

WHAT YOU KNOW ABOUT THIS BUSINESS:
${memoryStr || 'No memory stored yet.'}

RECENT CONVERSATIONS:
${convoStr || 'No recent conversations.'}

YOUR JOB:
1. Answer inbound calls and texts professionally
2. Qualify leads by asking about: job type, address, urgency, and budget
3. Book appointments when the customer is ready
4. Follow up on unsold estimates
5. Send review requests after completed jobs
6. Alert the contractor about important leads

TONE: Professional, friendly, concise. You are representing ${contractor.business_name}.
Always respond in plain text (no markdown). Keep responses under 160 characters for SMS.
If you cannot help, offer to have the contractor call them back.`;
}

async function runAgent({ contractorId, message, channel = 'sms', fromNumber }) {
  const systemPrompt = await buildSystemPrompt(contractorId);

  // Determine which skill to activate based on message content
  const lowerMsg = message.toLowerCase();
  
  // Call Claude for the response
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }]
  });

  const aiResponse = response.content[0].text;

  // Save conversation to DB
  await pool.query(
    `INSERT INTO conversations (contractor_id, channel, direction, from_number, message, ai_response)
     VALUES ($1, $2, 'inbound', $3, $4, $5)`,
    [contractorId, channel, fromNumber, message, aiResponse]
  );

  // Check if we should create a lead
  if (lowerMsg.includes('quote') || lowerMsg.includes('estimate') || lowerMsg.includes('repair') || 
      lowerMsg.includes('install') || lowerMsg.includes('fix') || lowerMsg.includes('broken')) {
    await pool.query(
      `INSERT INTO leads (contractor_id, phone, status, notes) VALUES ($1, $2, 'new', $3)
       ON CONFLICT DO NOTHING`,
      [contractorId, fromNumber, message]
    );
  }

  return aiResponse;
}

async function runProactiveTask({ contractorId, taskType, data }) {
  switch (taskType) {
    case 'morning_briefing': return await generateMorningBriefing(contractorId);
    case 'estimate_followup': return await followUpEstimate(contractorId, data);
    case 'review_request': return await requestReview(contractorId, data);
    default: return null;
  }
}

async function generateMorningBriefing(contractorId) {
  const { rows: newLeads } = await pool.query(
    "SELECT * FROM leads WHERE contractor_id = $1 AND status = 'new' AND created_at > NOW() - INTERVAL '24 hours'",
    [contractorId]
  );
  const { rows: dueTasks } = await pool.query(
    "SELECT * FROM tasks WHERE contractor_id = $1 AND completed_at IS NULL AND due_at <= NOW() + INTERVAL '24 hours'",
    [contractorId]
  );

  return `Good morning! Here's your daily briefing:
New leads overnight: ${newLeads.length}
Tasks due today: ${dueTasks.length}
${newLeads.length > 0 ? 'Top lead: ' + (newLeads[0].name || newLeads[0].phone) : ''}
Reply LEADS to see all new leads.`;
}

module.exports = { runAgent, runProactiveTask };
