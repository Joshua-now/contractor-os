const { pool } = require('../db');
const { sendSMS } = require('../telnyx');

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

  // Send confirmation SMS
  const message = `Hi ${lead.name || 'there'}! Your appointment is confirmed for ${requestedTime}. We'll see you then! - ${contractor.business_name || 'Your Contractor'}`;

  try {
        const fromNumber = contractor.telnyx_phone || process.env.TELNYX_PHONE_NUMBER;
        await sendSMS(fromNumber, lead.phone, message);

      await pool.query(
              `INSERT INTO conversations (contractor_id, channel, direction, to_number, message, ai_response)
                     VALUES ($1, 'sms', 'outbound', $2, 'Appointment confirmation sent', $3)`,
              [contractorId, lead.phone, message]
            );
  } catch (err) {
        console.error('Appointment SMS error:', err.message);
  }

  return { success: true, message };
}

module.exports = { bookAppointment };
