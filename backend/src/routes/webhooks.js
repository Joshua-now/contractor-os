const express = require('express');
const router = express.Router();
const { runAgent } = require('../agent');
const { pool } = require('../db');

// Twilio inbound SMS webhook
router.post('/sms', async (req, res) => {
  const { From, To, Body } = req.body;

  try {
    // Find contractor by their Twilio phone number
    const { rows } = await pool.query(
      'SELECT id FROM contractors WHERE twilio_phone = $1 LIMIT 1',
      [To]
    );

    if (!rows.length) {
      console.warn(`No contractor found for phone ${To}`);
      return res.status(200).send('<Response></Response>');
    }

    const contractorId = rows[0].id;
    const aiResponse = await runAgent({
      contractorId,
      message: Body,
      channel: 'sms',
      fromNumber: From
    });

    // Respond via Twilio TwiML
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${aiResponse}</Message>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(twiml);
  } catch (err) {
    console.error('SMS webhook error:', err);
    res.status(500).send('<Response><Message>Sorry, something went wrong. Please call us directly.</Message></Response>');
  }
});

// Web form lead webhook (from website contact forms)
router.post('/lead', async (req, res) => {
  const { contractorId, name, phone, email, jobType, message, source } = req.body;

  try {
    if (!contractorId) return res.status(400).json({ error: 'contractorId required' });

    // Create the lead
    const { rows: [lead] } = await pool.query(
      `INSERT INTO leads (contractor_id, name, phone, email, job_type, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'new') RETURNING *`,
      [contractorId, name, phone, email, jobType, message]
    );

    // Trigger speed-to-lead if phone is available
    if (phone) {
      const { speedToLead } = require('../skills/speedToLead');
      await speedToLead(contractorId, { name, phone, jobType, source });
    }

    res.json({ success: true, leadId: lead.id });
  } catch (err) {
    console.error('Lead webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
