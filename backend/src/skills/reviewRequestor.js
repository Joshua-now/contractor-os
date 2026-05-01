const twilio = require('twilio');
const { pool } = require('../db');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function requestReview(contractorId, leadId) {
  const { rows: [lead] } = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  const { rows: [contractor] } = await pool.query('SELECT * FROM contractors WHERE id = $1', [contractorId]);

  if (!lead || !lead.phone) return { success: false, error: 'Lead not found' };

  // Get Google review link from memory if stored
  const { rows: memoryRows } = await pool.query(
    "SELECT value FROM memory WHERE contractor_id = $1 AND key = 'google_review_link'",
    [contractorId]
  );
  const reviewLink = memoryRows[0]?.value || 'https://g.page/r/review';

  const message = `Hi ${lead.name || 'there'}! Hope your ${lead.job_type || 'project'} is going well! We'd love to hear your feedback. If you have 60 seconds, a Google review would mean the world to us: ${reviewLink} - Thank you!`;

  try {
    await twilioClient.messages.create({
      body: message,
      from: contractor.twilio_phone || process.env.TWILIO_PHONE_NUMBER,
      to: lead.phone
    });

    // Log the review request
    await pool.query(
      `INSERT INTO conversations (contractor_id, channel, direction, to_number, message, ai_response)
       VALUES ($1, 'sms', 'outbound', $2, 'Review request sent', $3)`,
      [contractorId, lead.phone, message]
    );

    // Update lead status
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['review_requested', leadId]);

    return { success: true, message };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { requestReview };
