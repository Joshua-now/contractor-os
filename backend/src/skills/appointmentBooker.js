const twilio = require('twilio');
const { pool } = require('../db');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function bookAppointment(contractorId, leadId, requestedTime) {
  const { rows: [contractor] } = await pool.query(
    'SELECT * FROM contractors WHERE id = $1', [contractorId]
  );
  const { rows: [lead] } = await pool.query(
    'SELECT * FROM leads WHERE id = $1', [leadId]
  );

  if (!lead || !lead.phone) return { success: false, error: 'Lead not found' };

  // Create a task for the appointment
  await pool.query(
    `INSERT INTO tasks (contractor_id, lead_id, type, description, due_at)
     VALUES ($1, $2, 'appointment', $3, $4)`,
    [contractorId, leadId, `Appointment for ${lead.name || 'customer'} - ${lead.job_type}`, requestedTime]
  );

  // Update lead status
  await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['appointment_set', leadId]);

  // Send confirmation SMS to customer
  const confirmationMsg = `Your appointment with ${contractor.business_name} is confirmed! We'll see you at ${requestedTime}. Questions? Reply to this message. See you soon!`;

  try {
    await twilioClient.messages.create({
      body: confirmationMsg,
      from: contractor.twilio_phone || process.env.TWILIO_PHONE_NUMBER,
      to: lead.phone
    });

    // Also alert contractor via SMS
    if (contractor.phone_number) {
      const alertMsg = `NEW APPOINTMENT: ${lead.name || 'Customer'} (${lead.phone}) for ${lead.job_type} at ${requestedTime}`;
      await twilioClient.messages.create({
        body: alertMsg,
        from: contractor.twilio_phone || process.env.TWILIO_PHONE_NUMBER,
        to: contractor.phone_number
      });
    }

    return { success: true, message: confirmationMsg };
  } catch (err) {
    console.error('Appointment booking SMS failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { bookAppointment };
