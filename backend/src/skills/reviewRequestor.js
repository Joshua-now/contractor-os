const { pool } = require('../db');
const { sendSMS } = require('../telnyx');

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

  const message = `Hi ${lead.name || 'there'}! Hope your ${lead.job_type || 'project'} is going well! We'd love a quick review: ${reviewLink} - ${contractor.business_name || 'Your Contractor'}`;

  try {
        const toNumber = lead.phone;
        const fromNumber = contractor.telnyx_phone || process.env.TELNYX_PHONE_NUMBER;
        await sendSMS(fromNumber, toNumber, message);

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
        console.error('Review requestor error:', err.message);
        return { success: false, error: err.message };
  }
}

module.exports = { requestReview };
