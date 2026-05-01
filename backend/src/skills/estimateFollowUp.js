const { pool } = require('../db');
const { sendSMS } = require('../telnyx');

const FOLLOWUP_SEQUENCE = [
  { day: 1, message: (name, biz) => `Hi ${name}! This is ${biz}. Just checking in on the estimate we sent. Any questions?` },
  { day: 3, message: (name, biz) => `Hi ${name}, ${biz} here again. Our schedule is filling up - wanted to make sure you got our estimate.` },
  { day: 5, message: (name, biz) => `Hi ${name}! Last check-in from ${biz}. We can often work with budgets - want to talk?` },
  { day: 7, message: (name, biz) => `Hi ${name}, ${biz} here. We'll close out this estimate but would love to earn your business!` },
  ];

async function followUpEstimate(contractorId, leadId) {
    const { rows: [lead] } = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    const { rows: [contractor] } = await pool.query('SELECT * FROM contractors WHERE id = $1', [contractorId]);

  if (!lead || !lead.phone) return { success: false, error: 'Lead not found' };

  // Check how many follow-ups have been sent
  const { rows: sentFollowups } = await pool.query(
        `SELECT * FROM tasks WHERE lead_id = $1 AND type = 'estimate_followup' AND completed_at IS NOT NULL`,
        [leadId]
      );

  const followupIndex = sentFollowups.length;
    if (followupIndex >= FOLLOWUP_SEQUENCE.length) {
          return { success: false, error: 'All follow-ups already sent' };
    }

  const { message: msgFn } = FOLLOWUP_SEQUENCE[followupIndex];
    const name = lead.name || 'there';
    const biz = contractor.business_name || 'Your Contractor';
    const message = msgFn(name, biz);

  try {
        const fromNumber = contractor.telnyx_phone || process.env.TELNYX_PHONE_NUMBER;
        await sendSMS(fromNumber, lead.phone, message);

      // Mark this follow-up as sent
      await pool.query(
              `INSERT INTO tasks (contractor_id, lead_id, type, description, completed_at)
                     VALUES ($1, $2, 'estimate_followup', $3, NOW())`,
              [contractorId, leadId, `Follow-up ${followupIndex + 1} sent`]
            );

      await pool.query(
              `INSERT INTO conversations (contractor_id, channel, direction, to_number, message, ai_response)
                     VALUES ($1, 'sms', 'outbound', $2, 'Estimate follow-up sent', $3)`,
              [contractorId, lead.phone, message]
            );

      return { success: true, message, followupNumber: followupIndex + 1 };
  } catch (err) {
        console.error('Estimate follow-up error:', err.message);
        return { success: false, error: err.message };
  }
}

module.exports = { followUpEstimate };
