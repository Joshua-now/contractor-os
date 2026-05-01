// telnyx.js - Telnyx SMS and Voice integration for Contractor-OS
// Telnyx is the primary SMS/Voice provider (Twilio as fallback)

const Telnyx = require('telnyx');

const telnyx = Telnyx(process.env.TELNYX_API_KEY);

/**
 * Send SMS via Telnyx
 */
async function sendSMS(to, body) {
  try {
    const message = await telnyx.messages.create({
      from: process.env.TELNYX_PHONE_NUMBER,
      to: to,
      text: body,
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID || undefined
    });
    console.log('[Telnyx] SMS sent to', to, '| ID:', message.data.id);
    return { success: true, id: message.data.id, provider: 'telnyx' };
  } catch (err) {
    console.error('[Telnyx] SMS error:', err.message);
    throw err;
  }
}

/**
 * Verify Telnyx webhook signature
 */
function verifyWebhook(req) {
  const telnyxPublicKey = process.env.TELNYX_PUBLIC_KEY;
  if (!telnyxPublicKey) {
    console.warn('[Telnyx] No public key set — skipping signature verification');
    return true;
  }
  try {
    const constructedEvent = telnyx.webhooks.constructEvent(
      req.body,
      req.headers['telnyx-signature-ed25519'],
      req.headers['telnyx-timestamp'],
      telnyxPublicKey
    );
    return !!constructedEvent;
  } catch (err) {
    console.error('[Telnyx] Webhook verification failed:', err.message);
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
    console.error('[Telnyx] Error parsing inbound SMS:', err.message);
    return null;
  }
}

/**
 * Initiate outbound call via Telnyx
 */
async function makeCall(to, webhookUrl) {
  try {
    const call = await telnyx.calls.create({
      connection_id: process.env.TELNYX_CONNECTION_ID,
      to: to,
      from: process.env.TELNYX_PHONE_NUMBER,
      webhook_url: webhookUrl
    });
    console.log('[Telnyx] Call initiated to', to, '| ID:', call.data.call_control_id);
    return { success: true, callControlId: call.data.call_control_id, provider: 'telnyx' };
  } catch (err) {
    console.error('[Telnyx] Call error:', err.message);
    throw err;
  }
}

module.exports = { sendSMS, verifyWebhook, parseInboundSMS, makeCall };
