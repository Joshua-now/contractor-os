// routes/webhooks.js - Inbound SMS webhooks for Twilio and Telnyx
const express = require('express');
const router = express.Router();
const { parseInboundSMS: parseTelnyxSMS, verifyWebhook: verifyTelnyxWebhook } = require('../telnyx');
const { runAgentLoop } = require('../agent');
const db = require('../db');

// -- TWILIO INBOUND SMS -------------------------------------------
router.post('/twilio/sms', express.urlencoded({ extended: false }), async (req, res) => {
      try {
              const from = req.body.From;
              const body = req.body.Body;
              const to = req.body.To;

        console.log(`[Twilio] Inbound SMS from ${from}: ${body}`);

        const { rows } = await db.query(
                  'SELECT * FROM contractors WHERE twilio_phone = $1 AND active = true LIMIT 1',
                  [to]
                );
              const contractor = rows[0];
              if (!contractor) {
                        console.warn('[Twilio] No contractor found for number:', to);
                        return res.status(200).send('<Response></Response>');
              }

        res.status(200).send('<Response></Response>');

        setImmediate(async () => {
                  try {
                              await runAgentLoop(contractor, from, body, 'twilio');
                  } catch (err) {
                              console.error('[Twilio] Agent error:', err?.message || String(err));
                  }
        });
      } catch (err) {
              console.error('[Twilio] Webhook error:', err?.message || String(err));
              res.status(500).send('<Response></Response>');
      }
});

// -- TELNYX INBOUND SMS ------------------------------------------
router.post('/telnyx/sms', express.json(), async (req, res) => {
      try {
              if (!verifyTelnyxWebhook(req)) {
                        return res.status(403).json({ error: 'Invalid signature' });
              }

        const parsed = parseTelnyxSMS(req.body);
              if (!parsed) {
                        return res.status(200).json({ received: true });
              }

        const { from, to, body } = parsed;
              console.log(`[Telnyx] Inbound SMS from ${from}: ${body}`);

        const { rows } = await db.query(
                  'SELECT * FROM contractors WHERE telnyx_phone = $1 AND active = true LIMIT 1',
                  [to]
                );
              const contractor = rows[0];
              if (!contractor) {
                        console.warn('[Telnyx] No contractor found for number:', to);
                        return res.status(200).json({ received: true });
              }

        res.status(200).json({ received: true });

        setImmediate(async () => {
                  try {
                              await runAgentLoop(contractor, from, body, 'telnyx');
                  } catch (err) {
                              console.error('[Telnyx] Agent error:', err?.message || String(err));
                  }
        });
      } catch (err) {
              console.error('[Telnyx] Webhook error:', err?.message || String(err));
              res.status(500).json({ error: 'Internal server error' });
      }
});

// -- SMS TEST ENDPOINT (dev/testing only) ------------------------
// Requires X-Test-Secret header matching TEST_SECRET env var.
// Blocked entirely in production unless TEST_SECRET is explicitly set.
router.post('/sms-test', express.json(), async (req, res) => {
      const testSecret = process.env.TEST_SECRET;
      const providedSecret = req.headers['x-test-secret'];
      if (!testSecret || providedSecret !== testSecret) {
            return res.status(403).json({ error: 'Forbidden — set X-Test-Secret header matching TEST_SECRET env var' });
      }
      const { from, to, body } = req.body;
      const testFrom = from || '+15555550100';
      const testTo = to || process.env.TELNYX_PHONE_NUMBER || '+13217324521';
      const testBody = body || 'Test: My AC unit is not working.';

              console.log(`[TEST] Simulated SMS from ${testFrom}: ${testBody}`);

              res.status(200).json({
                      received: true,
                      message: 'AI agent triggered. Check Railway logs for response.',
                      from: testFrom,
                      body: testBody
              });

              setImmediate(async () => {
                      try {
                                let { rows } = await db.query(
                                            'SELECT * FROM contractors WHERE active = true LIMIT 1'
                                          );
                                let contractor = rows[0];

                        if (!contractor) {
                                    console.log('[TEST] No contractor found, creating demo contractor...');
                                    const insert = await db.query(
                                                  `INSERT INTO contractors
                                                              (name, company_name, email, phone, telnyx_phone, sms_provider,
                                                                           service_area, services, ai_persona, plan, active)
                                                                                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
                                                                                                 RETURNING *`,
                                                  [
                                                                  'Demo User', 'Demo HVAC Co.', 'demo@contractoros.test',
                                                                  testTo, testTo, 'telnyx',
                                                                  'Central Florida', 'HVAC, AC Repair, Heating',
                                                                  'Friendly and professional HVAC technician', 'starter'
                                                                ]
                                                );
                                    contractor = insert.rows[0];
                                    console.log('[TEST] Demo contractor created:', contractor.id);
                        }

                        console.log(`[TEST] Running agent for contractor: ${contractor.id}`);
                                await runAgentLoop(contractor, testFrom, testBody, 'telnyx');
                      } catch (err) {
                                console.error('[TEST] Agent error:', err?.message || String(err));
                      }
              });
});

module.exports = router;
