// routes/webhooks.js - Inbound SMS/Voice webhooks for Twilio AND Telnyx
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { parseInboundSMS: parseTelnyxSMS, verifyWebhook: verifyTelnyxWebhook } = require('../telnyx');
const { runAgentLoop } = require('../agent');
const pool = require('../db');

// ─── TWILIO INBOUND SMS ───────────────────────────────────────────────────────
router.post('/twilio/sms', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    // Verify Twilio signature in production
    if (process.env.NODE_ENV === 'production') {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioSignature = req.headers['x-twilio-signature'];
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const isValid = twilio.validateRequest(authToken, twilioSignature, url, req.body);
      if (!isValid) return res.status(403).send('Forbidden');
    }

    const from = req.body.From;
    const body = req.body.Body;
    const contractorPhone = req.body.To;

    console.log(`[Twilio] Inbound SMS from ${from}: ${body}`);

    // Find contractor by their Twilio number
    const contractorResult = await pool.query(
      'SELECT * FROM contractors WHERE twilio_phone = $1 LIMIT 1',
      [contractorPhone]
    );

    if (!contractorResult.rows.length) {
      console.warn('[Twilio] No contractor found for number:', contractorPhone);
      return res.set('Content-Type', 'text/xml').send('<Response></Response>');
    }

    const contractor = contractorResult.rows[0];
    await runAgentLoop(contractor, from, body, 'twilio');

    res.set('Content-Type', 'text/xml').send('<Response></Response>');
  } catch (err) {
    console.error('[Twilio] Webhook error:', err);
    res.status(500).send('Error');
  }
});

// ─── TELNYX INBOUND SMS ───────────────────────────────────────────────────────
router.post('/telnyx/sms', express.json(), async (req, res) => {
  try {
    // Verify Telnyx signature
    if (process.env.NODE_ENV === 'production') {
      const valid = verifyTelnyxWebhook(req);
      if (!valid) return res.status(403).json({ error: 'Invalid signature' });
    }

    const parsed = parseTelnyxSMS(req.body);
    if (!parsed) {
      return res.status(200).json({ received: true });
    }

    const { from, to: contractorPhone, body } = parsed;
    console.log(`[Telnyx] Inbound SMS from ${from}: ${body}`);

    // Find contractor by their Telnyx number
    const contractorResult = await pool.query(
      'SELECT * FROM contractors WHERE telnyx_phone = $1 OR twilio_phone = $1 LIMIT 1',
      [contractorPhone]
    );

    if (!contractorResult.rows.length) {
      console.warn('[Telnyx] No contractor found for number:', contractorPhone);
      return res.status(200).json({ received: true });
    }

    const contractor = contractorResult.rows[0];
    await runAgentLoop(contractor, from, body, 'telnyx');

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Telnyx] Webhook error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── WEB FORM / LEAD CAPTURE ─────────────────────────────────────────────────
router.post('/lead', express.json(), async (req, res) => {
  try {
    const { contractorId, name, phone, email, service, message } = req.body;

    if (!contractorId || !phone) {
      return res.status(400).json({ error: 'contractorId and phone are required' });
    }

    const contractorResult = await pool.query(
      'SELECT * FROM contractors WHERE id = $1',
      [contractorId]
    );

    if (!contractorResult.rows.length) {
      return res.status(404).json({ error: 'Contractor not found' });
    }

    const contractor = contractorResult.rows[0];

    // Save lead to DB
    await pool.query(
      `INSERT INTO leads (contractor_id, name, phone, email, service_type, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'new', NOW())`,
      [contractorId, name, phone, email, service]
    );

    // Kick off speed-to-lead via preferred provider
    const greeting = message
      ? `Hi ${name || 'there'}! Got your request about ${service || 'your inquiry'}. ${message.substring(0, 50)}...`
      : `Hi ${name || 'there'}! We got your request. What can we help you with today?`;

    await runAgentLoop(contractor, phone, greeting, contractor.sms_provider || 'twilio');

    res.json({ success: true, message: 'Lead captured and agent notified' });
  } catch (err) {
    console.error('[Lead Webhook] Error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
