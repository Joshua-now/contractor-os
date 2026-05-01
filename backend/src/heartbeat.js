const cron = require('node-cron');
const db = require('./db');
const { runProactiveTask } = require('./agent');

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

    // Morning briefing - every day at 7am
    cron.schedule('0 7 * * *', async () => {
                console.log('Running morning briefing...');
                try {
                                const { rows: contractors } = await db.query('SELECT * FROM contractors WHERE phone_number IS NOT NULL');
                                for (const contractor of contractors) {
                                                    const briefing = await runProactiveTask({
                                                                            contractorId: contractor.id,
                                                                            taskType: 'morning_briefing'
                                                    });
                                                    if (briefing && contractor.phone_number) {
                                                                            const fromNumber = contractor.telnyx_phone || contractor.twilio_phone || null;
                                                                            await sendHeartbeatSMS(contractor.phone_number, fromNumber, briefing);
                                                    }
                                }
                } catch (err) {
                                console.error('Morning briefing error:', err.message);
                }
    });

    // Estimate follow-ups - every hour
    cron.schedule('0 * * * *', async () => {
                console.log('Checking estimate follow-ups...');
                try {
                                const { rows: dueTasks } = await db.query(
                                                    `SELECT t.*, l.contractor_id FROM tasks t
                                                                     JOIN leads l ON t.lead_id = l.id
                                                                                      WHERE t.type = 'estimate_followup'
                                                                                                       AND t.completed_at IS NULL
                                                                                                                        AND t.due_at <= NOW()`
                                                );
                                for (const task of dueTasks) {
                                                    await runProactiveTask({
                                                                            contractorId: task.contractor_id,
                                                                            taskType: 'estimate_followup',
                                                                            data: { leadId: task.lead_id }
                                                    });
                                }
                } catch (err) {
                                console.error('Follow-up cron error:', err.message);
                }
    });

    // Review requests - every day at 5pm
    cron.schedule('0 17 * * *', async () => {
                console.log('Checking review requests...');
                try {
                                const { rows: completedLeads } = await db.query(
                                                    `SELECT * FROM leads
                                                                     WHERE status = 'job_complete'
                                                                                      AND updated_at >= NOW() - INTERVAL '25 hours'
                                                                                                       AND updated_at <= NOW() - INTERVAL '23 hours'`
                                                );
                                for (const lead of completedLeads) {
                                                    await runProactiveTask({
                                                                            contractorId: lead.contractor_id,
                                                                            taskType: 'review_request',
                                                                            data: { leadId: lead.id }
                                                    });
                                }
                } catch (err) {
                                console.error('Review request cron error:', err.message);
                }
    });
}

module.exports = { startHeartbeat };
