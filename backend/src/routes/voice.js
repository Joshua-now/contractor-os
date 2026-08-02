// voice.js - AI Field Office Voice Route
// Handles INBOUND calls from Joshua/contractors AND OUTBOUND customer calls via Telnyx
//
// INBOUND flow:  Call arrives → Greet → Record → Whisper → runConversation → Speak → loop
// OUTBOUND flow: Bob queues call via make_outbound_call tool → Customer answers → Bob speaks message → Hang up
//
// Bob's Telnyx number: +13214657132 / (321) 465-7132
// Telnyx webhook URL:  <SELF_URL>/api/voice/webhook
'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../db');
const FormData = require('form-data');
const { runConversation } = require('../fieldOffice');
const outboundQueue = require('../outboundQueue');
const requireAuth  = require('../middleware/auth');
const { verifyWebhook: verifyTelnyxWebhook } = require('../telnyx');
const { transferCall } = require('../telnyx');

// In-memory store for active calls (call_control_id → state)
const activeCalls = new Map();

// ─── BUSINESS HOURS CONFIG ──────────────────────────────────────────────────
// Harbor answers 24/7 but only transfers to Joshua during business hours.
// After hours: Harbor takes a message and tells the caller to leave details.
const BUSINESS_HOURS = {
  timezone: 'America/New_York',       // Eastern Time
  days: [1, 2, 3, 4, 5],             // Monday=1 through Friday=5
  start: 8,                           // 8:00 AM
  end: 18,                            // 6:00 PM
  transferTo: process.env.JOSHUA_CELL || '+13212055991',  // (321) 205-5991
};

function isBusinessHours() {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: BUSINESS_HOURS.timezone });
  const etDate = new Date(etStr);
  const day = etDate.getDay();         // 0=Sun, 1=Mon ... 6=Sat
  const hour = etDate.getHours();
  return BUSINESS_HOURS.days.includes(day) && hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Strip non-ASCII characters (emoji, symbols) that Polly TTS renders as "AA" or garbled audio.
// Workflow names like "🛡️ Sentinel" become "Sentinel" — all meaningful text is ASCII anyway.
function stripEmoji(text) {
  return (text || '')
    .replace(/[^\x00-\x7F]/g, ' ')  // replace non-ASCII with space
    .replace(/\s+/g, ' ')           // collapse extra whitespace
    .trim();
}

function telnyxAction(callControlId, action, payload = {}) {
  const token = process.env.TELNYX_API_KEY;
  return axios.post(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`,
    payload,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

async function transcribeAudio(recordingUrl) {
  const token = process.env.TELNYX_API_KEY;
  const audioResp = await axios.get(recordingUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
  });

  const formData = new FormData();
  formData.append('file', Buffer.from(audioResp.data), {
    filename: 'recording.mp3',
    contentType: 'audio/mpeg',
  });
  formData.append('model', 'whisper-1');

  const whisperResp = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    formData,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
    }
  );
  return whisperResp.data.text || '';
}

// ─── HARBOR: Customer-Facing Conversation Handler ────────────────────────────
// Harbor handles external customer calls. Friendly, professional, qualifies leads.
// After 2-3 exchanges, asks if they want to speak to someone (transfer during business hours).
const HARBOR_SYSTEM_PROMPT = `You are Harbor, a friendly and professional phone receptionist for AI Teammate, a company that provides AI phone answering and automation services for small businesses (roofers, plumbers, HVAC, etc).

Your job:
- Be warm, helpful, and conversational
- Find out what the caller needs
- If they're interested in services: ask about their business, what problems they have with missed calls or after-hours coverage
- Keep responses SHORT — 1-2 sentences max. This is a phone call, not an essay.
- After understanding their need, say something like: "I'd love to connect you with Joshua to talk more about how we can help. One moment."
- If they have a question you can't answer, say you'll have someone follow up
- NEVER say you're an AI. You're Harbor, part of the team.

IMPORTANT: Respond in plain text only. Keep it natural and conversational. No markdown, no bullet points.`;

async function runHarborConversation(history, transcript, turnCount) {
  try {
    const messages = [
      { role: 'system', content: HARBOR_SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: transcript },
    ];

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4',
        messages,
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${err}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "I'm sorry, could you repeat that?";
    
    // Add to history
    const updatedHistory = [
      ...history,
      { role: 'user', content: transcript },
      { role: 'assistant', content: reply },
    ];

    // After 2+ turns, check if we should transfer
    const shouldTransfer = turnCount >= 2 && (
      reply.toLowerCase().includes('connect you') ||
      reply.toLowerCase().includes('joshua') ||
      reply.toLowerCase().includes('one moment') ||
      reply.toLowerCase().includes('let me')
    );

    return {
      reply,
      history: updatedHistory,
      shouldTransfer,
      shouldHangUp: false,
    };
  } catch (err) {
    console.error('[Harbor] Conversation error:', err.message);
    return {
      reply: "I'm having a bit of trouble right now. Could you try again in a moment?",
      history: history,
      shouldTransfer: false,
      shouldHangUp: false,
    };
  }
}

// ─── WEBHOOK ENTRY POINT ──────────────────────────────────────────────────────

router.post('/webhook', async (req, res) => {
  // Verify Telnyx signature (fails closed in production if TELNYX_PUBLIC_KEY not set)
  if (!verifyTelnyxWebhook(req)) {
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  res.sendStatus(200); // Acknowledge immediately

  const event = req.body?.data;
  if (!event) return;

  const eventType = event.event_type;
  const payload = event.payload || {};
  const callControlId = payload.call_control_id;
  const to = payload.to;
  const from = payload.from;
  const direction = payload.direction; // 'incoming' | 'outgoing'

  console.log(`[Voice] Event: ${eventType} | direction: ${direction} | callControlId: ${callControlId}`);

  try {
    switch (eventType) {

      // ── CALL INITIATED ──
      case 'call.initiated': {
        if (direction === 'outgoing') {
          // Outbound call initiated — just wait for call.answered
          // The message is already stored in outboundQueue by fieldOffice.js
          console.log(`[Voice] Outbound call initiated to ${to}`);
          break;
        }

        // ── INBOUND: Look up contractor by the number they called
        const result = await pool.query(
          'SELECT * FROM contractors WHERE telnyx_phone = $1',
          [to]
        );
        const contractor = result.rows[0];
        if (!contractor) {
          console.log(`[Voice] No contractor found for telnyx_phone: ${to}`);
          break;
        }

        // Determine if Joshua is calling his own line (internal) or a customer (external)
        const isInternal = from === BUSINESS_HOURS.transferTo || from === contractor.phone;

        activeCalls.set(callControlId, {
          contractorId: contractor.id,
          contractorName: contractor.name,
          conversationHistory: [],
          state: 'ringing',
          direction: 'inbound',
          isInternal,              // true = Joshua calling Bob, false = customer calling Harbor
          callerNumber: from,
        });

        await telnyxAction(callControlId, 'answer');
        break;
      }

      // ── CALL ANSWERED ──
      case 'call.answered': {
        // ── OUTBOUND: speak the queued message then hang up ──
        if (direction === 'outgoing' || outboundQueue.has(callControlId)) {
          const outbound = outboundQueue.get(callControlId);
          if (outbound) {
            console.log(`[Voice] Outbound answered by ${outbound.contactName} — type: ${outbound.type || 'simple'}`);
            activeCalls.set(callControlId, {
              direction: 'outbound',
              state: 'speaking',
              type: outbound.type || 'simple',
              briefingType: outbound.briefingType,
              contractorId: outbound.contractorId,
              contactName: outbound.contactName,
              conversationHistory: [],
            });
            outboundQueue.delete(callControlId);

            await telnyxAction(callControlId, 'speak', {
              payload: outbound.message,
              voice: 'Polly.Matthew',
              language: 'en-US',
            });
          } else {
            // Outbound call answered but no message queued — just hang up
            await telnyxAction(callControlId, 'hangup');
          }
          break;
        }

        // ── INBOUND: play greeting (Harbor for customers, Bob for Joshua) ──
        const callState = activeCalls.get(callControlId);
        if (!callState) break;

        callState.state = 'greeting';
        const greeting = callState.isInternal
          ? `Hey Joshua, it's Bob. What do you need?`
          : `Thanks for calling! This is Harbor. I'm part of the team here. How can I help you today?`;
        await telnyxAction(callControlId, 'speak', {
          payload: greeting,
          voice: 'Polly.Matthew',
          language: 'en-US',
        });
        break;
      }

      // ── SPEAK FINISHED ──
      case 'call.speak.ended': {
        const callState = activeCalls.get(callControlId);
        if (!callState) break;

        // OUTBOUND
        if (callState.direction === 'outbound') {
          // BRIEFING call: greeting spoken → now run the actual status report
          if (callState.type === 'briefing' && callState.state === 'speaking') {
            callState.state = 'thinking';
            const briefingPrompt = callState.briefingType === 'morning'
              ? 'Run the full morning status check — check all systems and give me a tight briefing.'
              : 'Run the evening status check — focus on Instantly campaigns and n8n workflow health.';
            try {
              const { reply, shouldHangUp, updatedHistory } = await runConversation(
                callState.contractorId,
                callState.conversationHistory,
                briefingPrompt,
                'briefing'
              );
              callState.conversationHistory = updatedHistory;
              callState.state = shouldHangUp ? 'hanging_up' : 'listening';
              await telnyxAction(callControlId, 'speak', {
                payload: stripEmoji(reply),
                voice: 'Polly.Matthew',
                language: 'en-US',
              });
            } catch (err) {
              console.error('[Voice] Briefing runConversation error:', err.message);
              // Don't hang up silently — tell Joshua what happened and stay on the line
              callState.state = 'listening';
              try {
                await telnyxAction(callControlId, 'speak', {
                  payload: "Sorry Joshua, I hit a snag pulling your status — probably an API timeout. Go ahead and ask me something directly and I'll take care of it.",
                  voice: 'Polly.Matthew',
                  language: 'en-US',
                });
              } catch (e2) {
                console.error('[Voice] Fallback speak failed, hanging up:', e2.message);
                await telnyxAction(callControlId, 'hangup');
                activeCalls.delete(callControlId);
              }
            }
            break;
          }

          // BRIEFING call: status spoken → start listening for follow-up
          if (callState.type === 'briefing' && callState.state === 'listening') {
            callState.state = 'recording';
            await telnyxAction(callControlId, 'record_start', {
              format: 'mp3',
              channels: 'single',
              trim_silence: false,
              timeout_secs: 8,
              max_length_secs: 120,
            });
            break;
          }

          // BRIEFING hang up
          if (callState.type === 'briefing' && callState.state === 'hanging_up') {
            await telnyxAction(callControlId, 'hangup');
            activeCalls.delete(callControlId);
            break;
          }

          // SIMPLE outbound: message was spoken — hang up
          console.log(`[Voice] Outbound message delivered to ${callState.contactName} — hanging up`);
          await telnyxAction(callControlId, 'hangup');
          activeCalls.delete(callControlId);
          break;
        }

        // INBOUND: after greeting or Bob's reply → start listening
        if (callState.state === 'greeting' || callState.state === 'listening') {
          callState.state = 'recording';
          await telnyxAction(callControlId, 'record_start', {
            format: 'mp3',
            channels: 'single',
            trim_silence: false,
            timeout_secs: 8,
            max_length_secs: 120,
          });
        } else if (callState.state === 'transferring') {
          // Harbor finished speaking — now actually transfer the call
          const transferNumber = BUSINESS_HOURS.transferTo;
          console.log(`[Voice] Transferring call ${callControlId} to ${transferNumber}`);
          try {
            const result = await transferCall(callControlId, transferNumber);
            console.log(`[Voice] Transfer initiated: legB=${result.legB}`);
            // Don't delete from activeCalls — call.hangup will clean up
          } catch (err) {
            console.error(`[Voice] Transfer failed: ${err.message}`);
            // Fallback: tell the caller and take a message
            callState.state = 'listening';
            await telnyxAction(callControlId, 'speak', {
              payload: "I'm sorry, I'm having trouble connecting you right now. Could you leave your name and number and I'll have Joshua call you back?",
              voice: 'Polly.Matthew',
              language: 'en-US',
            });
          }
        } else if (callState.state === 'hanging_up') {
          await telnyxAction(callControlId, 'hangup');
          activeCalls.delete(callControlId);
        }
        break;
      }

      // ── RECORDING SAVED → TRANSCRIBE → AI → SPEAK ──
      case 'call.recording.saved': {
        const callState = activeCalls.get(callControlId);
        if (!callState) break;

        callState.state = 'thinking';
        const recordingUrl = payload.recording_urls?.mp3 || payload.public_recording_urls?.mp3;

        if (!recordingUrl) {
          console.error('[Voice] No recording URL in payload');
          callState.state = 'listening';
          await telnyxAction(callControlId, 'speak', {
            payload: "Sorry, I didn't catch that. Go ahead.",
            voice: 'Polly.Matthew',
            language: 'en-US',
          });
          break;
        }

        // Transcribe
        let transcript = '';
        try {
          transcript = await transcribeAudio(recordingUrl);
          console.log(`[Voice] Transcript: "${transcript}"`);
        } catch (err) {
          console.error('[Voice] Transcription error:', err.message);
          callState.state = 'listening';
          await telnyxAction(callControlId, 'speak', {
            payload: "Sorry, I had trouble hearing that. Try again.",
            voice: 'Polly.Matthew',
            language: 'en-US',
          });
          break;
        }

        if (!transcript.trim()) {
          callState.state = 'listening';
          await telnyxAction(callControlId, 'speak', {
            payload: "I didn't hear anything. What do you need?",
            voice: 'Polly.Matthew',
            language: 'en-US',
          });
          break;
        }

        // ── EXTERNAL CALL: Harbor conversation (customer-facing) ──
        if (!callState.isInternal) {
          // Use a lightweight Harbor prompt for customer calls
          const harborReply = await runHarborConversation(
            callState.conversationHistory,
            transcript,
            callState.turnCount || 0
          );
          callState.conversationHistory = harborReply.history;
          callState.turnCount = (callState.turnCount || 0) + 1;

          // Check if Harbor decided to transfer the call
          if (harborReply.shouldTransfer) {
            if (isBusinessHours()) {
              // Business hours: transfer to Joshua's cell
              callState.state = 'transferring';
              await telnyxAction(callControlId, 'speak', {
                payload: stripEmoji(harborReply.reply),
                voice: 'Polly.Matthew',
                language: 'en-US',
              });
              // After speak.ended we'll do the actual transfer
            } else {
              // After hours: say we'll follow up
              callState.state = 'hanging_up';
              const afterHoursReply = harborReply.afterHoursReply ||
                "I appreciate you calling. We're currently after hours, but I've noted your information and someone will follow up with you during business hours. Have a great day!";
              await telnyxAction(callControlId, 'speak', {
                payload: stripEmoji(afterHoursReply),
                voice: 'Polly.Matthew',
                language: 'en-US',
              });
            }
          } else {
            callState.state = harborReply.shouldHangUp ? 'hanging_up' : 'listening';
            await telnyxAction(callControlId, 'speak', {
              payload: stripEmoji(harborReply.reply),
              voice: 'Polly.Matthew',
              language: 'en-US',
            });
          }
          break;
        }

        // ── INTERNAL CALL: Bob conversation (Joshua's personal assistant) ──
        let reply, shouldHangUp, updatedHistory;
        try {
          ({ reply, shouldHangUp, updatedHistory } = await runConversation(
            callState.contractorId,
            callState.conversationHistory,
            transcript
          ));
          callState.conversationHistory = updatedHistory;
        } catch (err) {
          console.error('[Voice] runConversation error:', err.message);
          reply = "Something went wrong on my end. Try again.";
          shouldHangUp = false;
        }

        console.log(`[Voice] AI reply: "${reply}" | shouldHangUp: ${shouldHangUp}`);

        callState.state = shouldHangUp ? 'hanging_up' : 'listening';

        await telnyxAction(callControlId, 'speak', {
          payload: stripEmoji(reply),
          voice: 'Polly.Matthew',
          language: 'en-US',
        });
        break;
      }

      // ── CALL ENDED (remote hangup or error) ──
      case 'call.hangup': {
        if (activeCalls.has(callControlId)) {
          console.log(`[Voice] Call ended: ${callControlId}`);
          activeCalls.delete(callControlId);
        }
        // Clean up any orphaned outbound queue entries
        if (outboundQueue.has(callControlId)) {
          outboundQueue.delete(callControlId);
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`[Voice] Unhandled error for ${eventType}:`, err.message);
  }
});

// ─── ACTIVE CALL STATUS (admin/debug endpoint — requires JWT) ─────────────────
// GET /api/voice/active
router.get('/active', requireAuth, (req, res) => {
  const calls = [];
  for (const [id, state] of activeCalls.entries()) {
    calls.push({ callControlId: id, ...state, conversationHistory: undefined });
  }
  res.json({ activeCalls: calls.length, calls });
});

module.exports = router;
