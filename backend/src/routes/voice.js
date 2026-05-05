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

// In-memory store for active calls (call_control_id → state)
const activeCalls = new Map();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

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

// ─── WEBHOOK ENTRY POINT ──────────────────────────────────────────────────────

router.post('/webhook', async (req, res) => {
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

        // INBOUND: Look up contractor by the number they called
        const result = await pool.query(
          'SELECT * FROM contractors WHERE telnyx_phone = $1',
          [to]
        );
        const contractor = result.rows[0];
        if (!contractor) {
          console.log(`[Voice] No contractor found for telnyx_phone: ${to}`);
          break;
        }

        activeCalls.set(callControlId, {
          contractorId: contractor.id,
          contractorName: contractor.name,
          conversationHistory: [],
          state: 'ringing',
          direction: 'inbound',
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
            console.log(`[Voice] Outbound answered by ${outbound.contactName} — speaking message`);
            activeCalls.set(callControlId, {
              direction: 'outbound',
              state: 'speaking',
              contactName: outbound.contactName,
            });
            outboundQueue.delete(callControlId);

            await telnyxAction(callControlId, 'speak', {
              payload: outbound.message,
              voice: 'female',
              language: 'en-US',
            });
          } else {
            // Outbound call answered but no message queued — just hang up
            await telnyxAction(callControlId, 'hangup');
          }
          break;
        }

        // ── INBOUND: play greeting ──
        const callState = activeCalls.get(callControlId);
        if (!callState) break;

        callState.state = 'greeting';
        await telnyxAction(callControlId, 'speak', {
          payload: `Hey, Fluid Productions field office. What do you need?`,
          voice: 'female',
          language: 'en-US',
        });
        break;
      }

      // ── SPEAK FINISHED ──
      case 'call.speak.ended': {
        const callState = activeCalls.get(callControlId);
        if (!callState) break;

        // OUTBOUND: message was spoken — hang up
        if (callState.direction === 'outbound') {
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
            trim_silence: true,
            timeout_secs: 5,
            max_length_secs: 120,
          });
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
            voice: 'female',
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
            voice: 'female',
            language: 'en-US',
          });
          break;
        }

        if (!transcript.trim()) {
          callState.state = 'listening';
          await telnyxAction(callControlId, 'speak', {
            payload: "I didn't hear anything. What do you need?",
            voice: 'female',
            language: 'en-US',
          });
          break;
        }

        // Run conversation turn
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
          payload: reply,
          voice: 'female',
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

// ─── ACTIVE CALL STATUS (optional debug endpoint) ─────────────────────────────
// GET /api/voice/active
router.get('/active', (req, res) => {
  const calls = [];
  for (const [id, state] of activeCalls.entries()) {
    calls.push({ callControlId: id, ...state, conversationHistory: undefined });
  }
  res.json({ activeCalls: calls.length, calls });
});

module.exports = router;
