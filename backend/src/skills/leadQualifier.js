const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const QUALIFICATION_QUESTIONS = [
  'What type of work do you need done?',
  'What is the address of the property?',
  'How urgent is this? (emergency, within a week, flexible)',
  'Do you have a budget range in mind?'
];

async function qualifyLead(contractorId, leadId, message, conversationHistory = []) {
  const { rows: [lead] } = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  
  const missingInfo = [];
  if (!lead.job_type) missingInfo.push('job_type');
  if (!lead.address) missingInfo.push('address');
  if (!lead.urgency || lead.urgency === 'normal') missingInfo.push('urgency');
  if (!lead.budget_range) missingInfo.push('budget_range');

  if (missingInfo.length === 0) {
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['qualified', leadId]);
    return 'Great! I have all the info I need. I will have our team reach out to schedule your appointment. What time works best for you?';
  }

  const systemPrompt = `You are a lead qualifier for a contractor. Extract information from the customer's message.
Missing info needed: ${missingInfo.join(', ')}.
If the customer provided any of this info, acknowledge it and ask for the next missing piece.
Keep responses under 160 characters. Be friendly and professional.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    system: systemPrompt,
    messages: [
      ...conversationHistory,
      { role: 'user', content: message }
    ]
  });

  // Parse and save any extracted info
  await extractAndSaveleadInfo(leadId, message);

  return response.content[0].text;
}

async function extractAndSaveleadInfo(leadId, message) {
  const lower = message.toLowerCase();
  const updates = {};

  // Simple extraction logic
  if (lower.includes('ac') || lower.includes('air conditioning') || lower.includes('hvac')) {
    updates.job_type = 'HVAC - ' + message.substring(0, 100);
  }
  if (lower.includes('roof') || lower.includes('shingle') || lower.includes('leak')) {
    updates.job_type = 'Roofing - ' + message.substring(0, 100);
  }
  if (lower.includes('emergency') || lower.includes('urgent') || lower.includes('asap')) {
    updates.urgency = 'emergency';
  }
  if (lower.includes('week') || lower.includes('flexible') || lower.includes('soon')) {
    updates.urgency = 'within_week';
  }

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...Object.values(updates), leadId];
    await pool.query(
      `UPDATE leads SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length}`,
      values
    );
  }
}

module.exports = { qualifyLead };
