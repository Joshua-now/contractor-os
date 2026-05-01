const twilio = require('twilio');
const { pool } = require('../db');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function speedToLead(contractorId, leadData) {
  const { rows: [contractor] } = await pool.query(
    'SELECT * FROM contractors WHERE id = $1', [contractorId]
  );

  if (!contractor || !contractor.twilio_phone) {
    console.error('No Twilio phone configured for contractor:', contractorId);
    return null;
  }

  const { name, phone, jobType, source } = leadData;
  
  const message = `Hi ${name || 'there'}! Thanks for reaching out to ${contractor.business_name}. I saw your ${jobType || 'service'} request. When is a good time to schedule a free estimate? Reply with a time that works for you!`;

  try {
    const sms = await twilioClient.messages.create({
      body: message,
      from: contractor.twilio_phone || process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });

    // Log the conversation
    await pool.query(
      `INSERT INTO conversations (contractor_id, channel, direction, to_number, message, ai_response)
       VALUES ($1, 'sms', 'outbound', $2, $3, $4)`,
      [contractorId, phone, 'Speed-to-lead triggered', message]
    );

    console.log(`Speed-to-lead SMS sent to ${phone}: ${sms.sid}`);
    return { success: true, messageSid: sms.sid };
  } catch (err) {
    console.error('Speed-to-lead SMS failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { speedToLead };
