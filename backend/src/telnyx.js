// telnyx.js - Telnyx SMS and Voice integration for Contractor-OS
// Telnyx is the primary SMS/Voice provider (Twilio as fallback)

const Telnyx = require('telnyx');

// Lazy init - only create client when first used
let _telnyx = null;
function getTelnyx() {
    if (!_telnyx) {
          _telnyx = Telnyx(process.env.TELNYX_API_KEY);
    }
    return _telnyx;
}

/**
 * Send SMS via Telnyx
 */
async function sendSMS(to, body) {
    try {
          const telnyx = getTelnyx();
          const message = await telnyx.messages.create({
                  from: process.env.TELNYX_PHONE_NUMBER,
                  to: to,
                  text: body,
                  messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID || undefined
          });
          console.log('[Telnyx] SMS sent to', to, '| ID:', message.data.id);
          return { success: true, id: message.data.id, provider: 'telnyx' };
    } catch (err) {
          console.error('[Telnyx] SMS error:', err?.message || String(err));
          if (err?.errors) console.error('[Telnyx] Details:', JSON.stringify(err.errors));
          throw err;
    }
}

/**
 * Verify Telnyx webhook signature
 */
function verifyWebhook(req) {
    const telnyxPublicKey = process.env.TELNYX_PUBLIC_KEY;
    if (!telnyxPublicKey) {
          console.warn('[Telnyx] No public key set - skipping signature verification');
          return true;
    }
    try {
          const telnyx = getTelnyx();
          const constructedEvent = telnyx.webhooks.constructEvent(
                  req.body,
                  req.headers['telnyx-signature-ed25519'],
                  req.headers['telnyx-timestamp'],
                  telnyxPublicKey
                );
          return !!constructedEvent;
    } catch (err) {
          console.error('[Telnyx] Webhook verification failed:', err?.message || String(err));
          return false;
    }
}

/**
 * Parse incoming Telnyx SMS webhook payload
 */
function parseInboundSMS(body) {
    try {
          const event = body.data;
          if (event.event_type !== 'message.received') return null;
          const payload = event.payload;
          return {
                  from: payload.from.phone_number,
                  to: payload.to[0].phone_number,
                  body: payload.text,
                  messageId: payload.id,
                  provider: 'telnyx'
          };
    } catch (err) {
          console.error('[Telnyx] Error parsing inbound SMS:', err?.message || String(err));
          return null;
    }
}

/**
 * Initiate outbound call via Telnyx
 */
async function makeCall(to, webhookUrl) {
    try {
          const telnyx = getTelnyx();
          const call = await telnyx.calls.create({
                  connection_id: process.env.TELNYX_CONNECTION_ID,
                  to: to,
                  from: process.env.TELNYX_PHONE_NUMBER,
                  webhook_url: webhookUrl
          });
          console.log('[Telnyx] Call initiated to', to, '| ID:', call.data.call_control_id);
          return { success: true, callControlId: call.data.call_control_id, provider: 'telnyx' };
    } catch (err) {
          console.error('[Telnyx] Call error:', err?.message || String(err));
          throw err;
    }
}

module.exports = { sendSMS, verifyWebhook, parseInboundSMS, makeCall };
