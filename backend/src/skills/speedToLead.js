// skills/speedToLead.js - Sub-60-second first response to new leads
// Supports Twilio (primary) and Telnyx (alternative provider)
// Uses lazy initialization - will not fail at startup if keys are not set yet

async function sendSMS(contractor, to, message) {
  const provider = (contractor && contractor.sms_provider) || process.env.SMS_PROVIDER || 'telnyx';

  if (provider === 'telnyx') {
    const { sendSMS: telnyxSend } = require('../telnyx');
    return telnyxSend(to, message);
  }

  // Twilio - lazy init to avoid startup crash when SID not yet set
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

async function speedToLead(contractor, leadPhone, leadName, service) {
  const firstName = (leadName || '').split(' ')[0] || 'there';
  const companyName = (contractor && contractor.company_name) || 'our team';
  const serviceText = service ? ` about your ${service} request` : '';
  const message = `Hi ${firstName}! ${companyName} here${serviceText}. We are on it! Reply to chat or call us now.`.substring(0, 160);

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
