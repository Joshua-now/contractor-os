const twilio = require('twilio');
const { pool } = require('../db');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const FOLLOWUP_SEQUENCE = [
  { day: 1, message: (name, biz) => `Hi ${name}! This is ${biz}. Just checking in on the estimate we sent. Any questions? We'd love to earn your business!` },
  { day: 3, message: (name, biz) => `Hi ${name}, ${biz} here again. Our schedule is filling up - wanted to see if you're ready to move forward or if you have any concerns about the estimate?` },
  { day: 5, message: (name, biz) => `Hi ${name}! Last check-in from ${biz}. We can often work with budgets - reply if you'd like to discuss options. No pressure!` },
  { day: 7, message: (name, biz) => `Hi ${name}, ${biz} here. We'll close out this estimate but would love to help in the future! Reply anytime if you need ${biz}.` }
];

async function followUpEstimate(contractorId, leadId) {
  const { rows: [lead] } = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  const { rows: [contractor] } = await pool.query('SELECT * FROM contractors WHERE id = $1', [contractorId]);

  if (!lead || !lead.phone) return { success: false, error: 'Lead not found' };

  // Check how many follow-ups have been sent
  const { rows: sentFollowups } = await pool.query(
    "SELECT * FROM tasks WHERE lead_id = $1 AND type = 'estimate_followup' AND completed_at IS NOT NULL ORDER BY created_at",
    [leadId]
  );

  const followupIndex = sentFollowups.length;
  if (followupIndex >= FOLLOWUP_SEQUENCE.length) {
    console.log(`Follow-up sequence complete for lead ${leadId}`);
    return { success: false, reason: 'Sequence complete' };
  }

  const followup = FOLLOWUP_SEQUENCE[followupIndex];
  const message = followup.message(lead.name || 'there', contractor.business_name);

  try {
    await twilioClient.messages.create({
      body: message,
      from: contractor.twilio_phone || process.env.TWILIO_PHONE_NUMBER,
      to: lead.phone
    });

    // Mark this follow-up as complete
    await pool.query(
      `UPDATE tasks SET completed_at = NOW() WHERE lead_id = $1 AND type = 'estimate_followup' AND completed_at IS NULL
       LIMIT 1`,
      [leadId]
    );

    // Schedule the next follow-up
    if (followupIndex + 1 < FOLLOWUP_SEQUENCE.length) {
      const nextFollowup = FOLLOWUP_SEQUENCE[followupIndex + 1];
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + nextFollowup.day - followup.day);

      await pool.query(
        `INSERT INTO tasks (contractor_id, lead_id, type, description, due_at)
         VALUES ($1, $2, 'estimate_followup', $3, $4)`,
        [contractorId, leadId, `Follow-up #${followupIndex + 2} for ${lead.name || lead.phone}`, dueAt]
      );
    }

    return { success: true, message, followupNumber: followupIndex + 1 };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { followUpEstimate };
