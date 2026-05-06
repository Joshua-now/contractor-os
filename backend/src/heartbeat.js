const cron = require('node-cron');
const db = require('./db');

// Lazy Twilio init - only create client when actually needed
function getTwilioClient() {
          const sid = process.env.TWILIO_ACCOUNT_SID;
          const token = process.env.TWILIO_AUTH_TOKEN;
          if (!sid || !sid.startsWith('AC') || !token) return null;
          const twilio = require('twilio');
          return twilio(sid, token);
}

// Helper: send SMS via best available provider
async function sendHeartbeatSMS(to, from, body) {
          // Try Telnyx first if configured
  const telnyxKey = process.env.TELNYX_API_KEY;
          if (telnyxKey && telnyxKey.length > 10) {
                      try {
                                    const { sendSMS } = require('./telnyx');
                                    await sendSMS({ to, from: from || process.env.TELNYX_PHONE_NUMBER, text: body });
                                    return;
                      } catch (e) {
                                    console.error('Telnyx SMS failed, falling back:', e.message);
                      }
          }
          // Fallback to Twilio
  const client = getTwilioClient();
          if (client) {
                      await client.messages.create({ body, from: from || process.env.TWILIO_PHONE_NUMBER, to });
}
}

function startHeartbeat() {
          console.log('Heartbeat service started');

  // Morning briefing - 10:00 UTC = 6:00 AM EDT
  cron.schedule('0 10 * * *', async () => {
    console.log('[Heartbeat] Running morning briefing (6 AM Eastern)...');
    try {
      const { rows: contractors } = await db.query(
        'SELECT * FROM contractors WHERE active = true AND phone IS NOT NULL'
      );
      for (const contractor of contractors) {
        try {
          const fromNumber = contractor.telnyx_phone || contractor.twilio_phone || null;
          if (fromNumber && contractor.phone) {
            await sendHeartbeatSMS(contractor.phone, fromNumber,
              `Good morning! Your AI assistant is online. Switchboard, GHL, and Instantly are being checked now.`
            );
          }
        } catch (err) {
          console.error('[Heartbeat] Morning briefing SMS error for contractor', contractor.id, ':', err?.message || String(err));
        }
      }
    } catch (err) {
      console.error('[Heartbeat] Morning briefing error:', err?.message || String(err));
    }
  });

  // Evening briefing - 22:00 UTC = 6:00 PM EDT
  cron.schedule('0 22 * * *', async () => {
    console.log('[Heartbeat] Running evening briefing (6 PM Eastern)...');
    try {
      const { rows: contractors } = await db.query(
        'SELECT * FROM contractors WHERE active = true AND phone IS NOT NULL'
      );
      for (const contractor of contractors) {
        try {
          const fromNumber = contractor.telnyx_phone || contractor.twilio_phone || null;
          if (fromNumber && contractor.phone) {
            await sendHeartbeatSMS(contractor.phone, fromNumber,
              `Evening check-in: reviewing your Instantly campaigns and n8n workflow status now.`
            );
          }
        } catch (err) {
          console.error('[Heartbeat] Evening briefing SMS error for contractor', contractor.id, ':', err?.message || String(err));
        }
      }
    } catch (err) {
      console.error('[Heartbeat] Evening briefing error:', err?.message || String(err));
    }
  });

  // Estimate follow-ups - every hour
  // Checks for conversations that need follow-up
  cron.schedule('0 * * * *', async () => {
              console.log('Checking estimate follow-ups...');
              try {
                            // Find open conversations older than 24h with no recent reply from assistant
                const { rows: staleConversations } = await db.query(`
                        SELECT c.*, co.telnyx_phone, co.twilio_phone, co.name as contractor_name
                                FROM conversations c
                                        JOIN contractors co ON c.contractor_id = co.id
                                                WHERE c.status = 'open'
                                                          AND c.updated_at < NOW() - INTERVAL '24 hours'
                                                                    AND co.active = true
                                                                            LIMIT 10
                                                                                  `);

                for (const conv of staleConversations) {
                                console.log(`[Heartbeat] Follow-up check for conversation ${conv.id}`);
                                // Mark as needing follow-up (don't auto-send to avoid spam)
                              await db.query(
                                                'UPDATE conversations SET status = $1 WHERE id = $2',
                                                ['follow_up_needed', conv.id]
                                              );
                }

                if (staleConversations.length > 0) {
                                console.log(`[Heartbeat] Marked ${staleConversations.length} conversations for follow-up`);
                }
              } catch (err) {
                            console.error('Follow-up cron error:', err?.message || String(err));
              }
  });
}

module.exports = { startHeartbeat };
