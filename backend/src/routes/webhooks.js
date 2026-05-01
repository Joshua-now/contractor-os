// routes/webhooks.js - Inbound SMS/Voice webhooks for Twilio AND Telnyx
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { parseInboundSMS: parseTelnyxSMS, verifyWebhook: verifyTelnyxWebhook } = require('../telnyx');
const { runAgentLoop } = require('../agent');
const db = require('../db');

// ── TWILIO INBOUND SMS ────────────────────────────────────────────────────────
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

      console.log(`[Twilio] Inbound SMS from ${from}: ${body}`);

      const contractorPhone = req.body.To;
          const contractorResult = await db.query(
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

// ── TELNYX INBOUND SMS ────────────────────────────────────────────────────────
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

      const contractorResult = await db.query(
              'SELECT * FROM contractors WHERE telnyx_phone = $1 LIMIT 1',
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

// ── TEST SMS ENDPOINT (no signature required) ─────────────────────────────────
// Use this to simulate inbound SMS for testing the AI pipeline
router.post('/sms-test', express.json(), async (req, res) => {
    try {
          const { from = '+14075551234', to, body = 'Hi, I need my AC fixed' } = req.body;

      console.log(`[TEST] Simulated SMS from ${from}: ${body}`);

      // Find contractor by telnyx phone, or use the first contractor
      let contractorResult;
          if (to) {
                  contractorResult = await db.query(
                            'SELECT * FROM contractors WHERE telnyx_phone = $1 OR twilio_phone = $1 LIMIT 1',
                            [to]
                          );
          } else {
                  contractorResult = await db.query('SELECT * FROM contractors LIMIT 1');
          }

      if (!contractorResult.rows.length) {
              return res.status(404).json({ error: 'No contractor found. Please onboard a contractor first via the frontend.' });
      }

      const contractor = contractorResult.rows[0];
          console.log(`[TEST] Running agent for contractor: ${contractor.business_name}`);

      // Run agent (non-blocking so we can respond immediately)
      runAgentLoop(contractor, from, body, 'telnyx').catch(err => {
              console.error('[TEST] Agent error:', err.message);
      });

      res.status(200).json({
              received: true,
              contractor: contractor.business_name,
              message: 'AI agent triggered. Check Railway logs for response.',
              from,
              body
      });
    } catch (err) {
          console.error('[TEST] SMS test error:', err);
          res.status(500).json({ error: err.message });
    }
});

module.exports = router;
