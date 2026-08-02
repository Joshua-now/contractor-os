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
              const msg = err?.message || String(err);
              const raw = JSON.stringify(err, Object.getOwnPropertyNames(err));
              console.error('[Telnyx] SMS error:', msg, '| details:', raw);
              throw new Error('[Telnyx] SMS failed: ' + msg);
      }
}

/**
 * Verify Telnyx webhook signature.
 * In production (NODE_ENV=production), TELNYX_PUBLIC_KEY MUST be set — requests
 * fail closed (return false) if missing. In dev/staging, missing key logs a warning
 * and passes through so you can test without a real Telnyx account.
 */
function verifyWebhook(req) {
  const telnyxPublicKey = process.env.TELNYX_PUBLIC_KEY;
  const isProd = process.env.NODE_ENV === 'production';

  if (!telnyxPublicKey) {
    if (isProd) {
      console.error('[Telnyx] CRITICAL: TELNYX_PUBLIC_KEY not set in production — rejecting webhook');
      return false; // Fail closed in production
    }
    console.warn('[Telnyx] No public key set — skipping signature verification (dev mode only)');
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

/**
 * Transfer an active call to another number (warm transfer via Telnyx)
 */
async function transferCall(callControlId, toNumber) {
      try {
              const telnyx = getTelnyx();
              const resp = await telnyx.calls.create({
                        connection_id: process.env.TELNYX_CONNECTION_ID,
                        to: toNumber,
                        from: process.env.TELNYX_PHONE_NUMBER,
              });
              const legB = resp.data.call_control_id;
              console.log(`[Telnyx] Bridge leg created: ${legB} → transferring ${callControlId} to ${toNumber}`);
              // Bridge the two legs
              await telnyx.calls.bridge(callControlId, { call_control_id: legB });
              return { success: true, legB };
      } catch (err) {
              console.error('[Telnyx] Transfer error:', err?.message || String(err));
              throw err;
      }
}

module.exports = { sendSMS, verifyWebhook, parseInboundSMS, makeCall, transferCall };
