const cron = require('node-cron');
const db = require('./db');
const { makeCall, sendSMS } = require('./telnyx');
const outboundQueue = require('./outboundQueue');
const { runAutonomousHealthSweep } = require('./fieldOffice');

// ─── BRIEFING CALL ────────────────────────────────────────────────────────────
// Initiates an outbound Telnyx call to the contractor.
// voice.js handles the webhook: Bob speaks the greeting, runs get_system_status,
// delivers the report, then stays on the line for follow-up questions.
async function startBriefingCall(contractor, briefingType) {
  const selfUrl = process.env.SELF_URL || 'https://backend-production-b9fc.up.railway.app';
  const webhookUrl = `${selfUrl}/api/voice/webhook`;

  const greeting = briefingType === 'morning'
    ? `Good morning Joshua, it's Bob. Give me a second and I'll pull up your morning status.`
    : `Hey Joshua, Bob here. Pulling your evening status now — give me just a moment.`;

  // Use BRIEFING_PHONE env var to route calls to the office phone instead of cell.
  // Set BRIEFING_PHONE=+13214719858 in Railway env vars to call the office line.
  const phone = process.env.BRIEFING_PHONE || contractor.phone;

  // Initiate the call — voice.js will handle the rest via webhook
  const result = await makeCall(phone, webhookUrl);

  // Store briefing context so voice.js knows this is a briefing, not a simple outbound
  outboundQueue.set(result.callControlId, {
    type: 'briefing',
    briefingType,
    contractorId: contractor.id,
    contactName: contractor.name || 'Joshua',
    message: greeting,
  });

  console.log(`[Heartbeat] ${briefingType} briefing call initiated to ${phone} | callControlId: ${result.callControlId}`);
}

function startHeartbeat() {
  console.log('Heartbeat service started');

  // Morning briefing — 10:00 UTC = 6:00 AM EDT
  cron.schedule('0 10 * * *', async () => {
    console.log('[Heartbeat] Morning briefing (6 AM Eastern)...');
    try {
      const { rows: contractors } = await db.query(
        "SELECT * FROM contractors WHERE active = true AND bob_enabled = true AND phone IS NOT NULL"
      );
      for (const contractor of contractors) {
        try {
          await startBriefingCall(contractor, 'morning');
        } catch (err) {
          console.error('[Heartbeat] Morning call failed for contractor', contractor.id, ':', err?.message || String(err));
        }
      }
    } catch (err) {
      console.error('[Heartbeat] Morning briefing error:', err?.message || String(err));
    }
  });

  // Evening briefing — 22:00 UTC = 6:00 PM EDT
  cron.schedule('0 22 * * *', async () => {
    console.log('[Heartbeat] Evening briefing (6 PM Eastern)...');
    try {
      const { rows: contractors } = await db.query(
        "SELECT * FROM contractors WHERE active = true AND bob_enabled = true AND phone IS NOT NULL"
      );
      for (const contractor of contractors) {
        try {
          await startBriefingCall(contractor, 'evening');
        } catch (err) {
          console.error('[Heartbeat] Evening call failed for contractor', contractor.id, ':', err?.message || String(err));
        }
      }
    } catch (err) {
      console.error('[Heartbeat] Evening briefing error:', err?.message || String(err));
    }
  });

  // Autonomous health sweep — every hour at :30 past the hour
  // Bob checks n8n, Switchboard, Instantly, and Railway.
  // Auto-fixes what he can. SMS Joshua only when something needs human attention.
  cron.schedule('30 * * * *', async () => {
    console.log('[Heartbeat] Running autonomous health sweep...');
    try {
      const { rows } = await db.query(
        "SELECT id, phone, name FROM contractors WHERE active = true AND bob_enabled = true ORDER BY id ASC LIMIT 1"
      );
      if (!rows.length) return;
      const contractor = rows[0];

      const { fixed, failed, ok } = await runAutonomousHealthSweep(contractor.id);

      console.log(`[Heartbeat] Sweep done — fixed: ${fixed.length}, attention needed: ${failed.length}, ok: ${ok.length}`);
      if (fixed.length) console.log('[Heartbeat] Auto-fixed:', fixed);
      if (failed.length) console.log('[Heartbeat] Needs attention:', failed);

      // SMS Joshua only if there are issues Bob couldn't resolve on his own
      if (failed.length > 0 && contractor.phone) {
        const header = fixed.length
          ? `Bob fixed ${fixed.length} issue(s). Still needs attention:`
          : `Bob health sweep — needs attention:`;
        const body = failed.map((f, i) => `${i + 1}. ${f}`).join(' | ');
        const sms = `${header} ${body}`;
        await sendSMS(contractor.phone, sms.substring(0, 320));
        console.log('[Heartbeat] Alert SMS sent to', contractor.phone);
      }
    } catch (err) {
      console.error('[Heartbeat] Health sweep error:', err?.message || String(err));
    }
  });

  // Stale conversation follow-up — every hour
  cron.schedule('0 * * * *', async () => {
    try {
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
        await db.query(
          'UPDATE conversations SET status = $1 WHERE id = $2',
          ['follow_up_needed', conv.id]
        );
      }

      if (staleConversations.length > 0) {
        console.log(`[Heartbeat] Marked ${staleConversations.length} conversations for follow-up`);
      }
    } catch (err) {
      console.error('[Heartbeat] Follow-up cron error:', err?.message || String(err));
    }
  });
}

module.exports = { startHeartbeat };
