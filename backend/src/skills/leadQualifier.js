const { pool } = require('../db');
const { callLLM } = require('../llm');
const { sendSMS } = require('../telnyx');

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
        return 'Great! I have all the info I need. I will have our team reach out to schedule your appointment!';
  }

  const systemPrompt = `You are an AI assistant for an HVAC and roofing contractor. Your job is to qualify leads by gathering missing information.

  Missing info needed: ${missingInfo.join(', ')}

  Ask ONE question at a time. Be friendly and conversational. Keep responses under 160 characters for SMS.
  When you get the answer, extract and save it. Do not ask the same question twice.`;

  const messages = [
        ...conversationHistory.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
      ];

  try {
        const aiResponse = await callLLM(systemPrompt, messages);

      // Parse response and update lead fields
      const lower = message.toLowerCase();
        if (missingInfo.includes('job_type') && lower.match(/hvac|ac|heat|cool|roof|shingle|gutter/)) {
                const jobType = lower.includes('roof') ? 'roofing' : 'hvac';
                await pool.query('UPDATE leads SET job_type = $1 WHERE id = $2', [jobType, leadId]);
        }
        if (missingInfo.includes('urgency')) {
                if (lower.includes('emergency') || lower.includes('urgent') || lower.includes('asap')) {
                          await pool.query('UPDATE leads SET urgency = $1 WHERE id = $2', ['emergency', leadId]);
                } else if (lower.includes('week') || lower.includes('soon')) {
                          await pool.query('UPDATE leads SET urgency = $1 WHERE id = $2', ['within_week', leadId]);
                } else if (lower.includes('flexible') || lower.includes('no rush')) {
                          await pool.query('UPDATE leads SET urgency = $1 WHERE id = $2', ['flexible', leadId]);
                }
        }

      return aiResponse;
  } catch (err) {
        console.error('Lead qualifier error:', err.message);
        // Fallback to next qualification question
      const q = QUALIFICATION_QUESTIONS.find(q =>
              (q.includes('type') && missingInfo.includes('job_type')) ||
              (q.includes('address') && missingInfo.includes('address')) ||
              (q.includes('urgent') && missingInfo.includes('urgency')) ||
              (q.includes('budget') && missingInfo.includes('budget_range'))
                                                 );
        return q || 'Thanks! Our team will follow up shortly.';
  }
}

module.exports = { qualifyLead };
