// skills/speedToLead.js - Sub-60-second first response to new leads
// Supports Twilio (primary) and Telnyx (alternative provider)
// Uses lazy initialization — won't fail at startup if keys aren't set yet
const { sendSMS: telnyxSend } = require('../telnyx');

/**
 * Determine which SMS provider to use and send a message
 * Lazy-initializes Twilio only when called (not at module load)
 */
async function sendSMS(contractor, to, message) {
  const provider = (contractor && contractor.sms_provider) || process.env.SMS_PROVIDER || 'telnyx';

  if (provider === 'telnyx') {
    return telnyxSend(to, message);
  }

  // Twilio — lazy init to avoid startup crash when SID not yet set
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !sid.startsWith('AC')) {
    console.warn('[SpeedToLead] Twilio SID not configured, skipping SMS');
    return { success: false, reason: 'Twilio not configured' };
  }

  const twilio = require('twilio');
  const client = twilio(sid, token);
  const result = await client.messages.create({
    body: message,
    from: (contractor && contractor.twilio_phone) || process.env.TWILIO_PHONE_NUMBER,
    to: to
  });
  return { success: true, id: result.sid, provider: 'twilio' };
}

/**
 * Speed-to-Lead: respond to a new lead in under 60 seconds
 */
async function speedToLead(contractor, leadPhone, leadName, service) {
  const firstName = (leadName || '').split(' ')[0] || 'there';
  const companyName = (contractor && contractor.company_name) || 'our team';
  const serviceText = service ? ` about your ${service} request` : '';

  const message = `Hi ${firstName}! ${companyName} here${serviceText}. We're on it! Reply to chat or call us now.`.substring(0, 160);

  try {
    const result = await sendSMS(contractor, leadPhone, message);
    console.log(`[SpeedToLead] Responded to ${leadPhone} via ${result.provider || 'unknown'}`);
    return result;
  } catch (err) {
    console.error('[SpeedToLead] SMS failed:', err.message);
    throw err;
  }
}

module.exports = { speedToLead, sendSMS };
// skills/speedToLead.js - Sub-60-second first response to new leads
// Supports Twilio (primary) and Telnyx (alternative provider)
const twilio = require('twilio');
const { sendSMS: telnyxSend } = require('../telnyx');

// Determine which SMS provider to use
async function sendSMS(contractor, to, message) {
  const provider = contractor.sms_provider || 'twilio';

  if (provider === 'telnyx') {
    return telnyxSend(to, message);
  }

  // Default: Twilio
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  const result = await client.messages.create({
    body: message,
    from: contractor.twilio_phone || process.env.TWILIO_PHONE_NUMBER,
    to: to
  });
  return { success: true, id: result.sid, provider: 'twilio' };
}

/**
 * Speed-to-Lead: respond to a new lead in under 60 seconds
 * @param {object} contractor - Contractor DB row
 * @param {string} leadPhone - Lead's phone number
 * @param {string} leadName - Lead's name (if known)
 * @param {string} service - Service requested (e.g. "AC repair", "new roof")
 */
async function speedToLead(contractor, leadPhone, leadName, service) {
  const firstName = (leadName || '').split(' ')[0] || 'there';
  const companyName = contractor.company_name || 'our team';
  const serviceText = service ? ` about your ${service} request` : '';

  // Keep under 160 chars for single SMS
  const message = `Hi ${firstName}! ${companyName} here${serviceText}. We're on it! Reply to chat or call us now.`.substring(0, 160);

  try {
    const result = await sendSMS(contractor, leadPhone, message);
    console.log(`[SpeedToLead] Responded to ${leadPhone} via ${result.provider} in < 60s`);
    return result;
  } catch (err) {
    console.error('[SpeedToLead] SMS failed:', err.message);

    // Fallback: if Telnyx fails, try Twilio and vice versa
    const fallback = (contractor.sms_provider || 'twilio') === 'telnyx' ? 'twilio' : 'telnyx';
    console.log(`[SpeedToLead] Attempting fallback via ${fallback}`);

    try {
      if (fallback === 'twilio') {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const r = await client.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: leadPhone
        });
        return { success: true, id: r.sid, provider: 'twilio-fallback' };
      } else {
        return await telnyxSend(leadPhone, message);
      }
    } catch (fallbackErr) {
      console.error('[SpeedToLead] Fallback also failed:', fallbackErr.message);
      throw fallbackErr;
    }
  }
}

module.exports = { speedToLead, sendSMS };
