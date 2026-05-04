// voice.js - AI Field Office Voice Route
// Handles inbound calls from contractors via Telnyx
// Flow: Call arrives → AI greets → Record → Transcribe → runConversation → Speak reply → Loop until [END_CALL]
'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../db');
const FormData = require('form-data');
const { runConversation } = require('../fieldOffice');

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
        // Download the recording
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

              console.log(`[Voice] Event: ${eventType} | callControlId: ${callControlId}`);

              try {
                        switch (eventType) {

                          // ── INCOMING CALL ──
                              case 'call.initiated': {
                                            // Only handle inbound calls
                                            if (payload.direction !== 'incoming') break;

                                            // Look up contractor by the number they called (telnyx_phone = TO number)
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
                                            });

                                            await telnyxAction(callControlId, 'answer');
                                            break;
                              }

                          // ── CALL ANSWERED → PLAY GREETING ──
                              case 'call.answered': {
                                            const callState = activeCalls.get(callControlId);
                                            if (!callState) break;

                                            callState.state = 'greeting';
                                            const greeting = `Hey, Fluid Productions field office. What do you need?`;

                                            await telnyxAction(callControlId, 'speak', {
                                                            payload: greeting,
                                                            voice: 'female',
                                                            language: 'en-US',
                                            });
                                            break;
                              }

                          // ── SPEAK FINISHED → START LISTENING ──
                              case 'call.speak.ended': {
                                            const callState = activeCalls.get(callControlId);
                                            if (!callState) break;

                                            if (callState.state === 'greeting' || callState.state === 'listening') {
                                                            // Start recording — wait for the contractor to speak
                                              callState.state = 'recording';
                                                            await telnyxAction(callControlId, 'record_start', {
                                                                              format: 'mp3',
                                                                              channels: 'single',
                                                                              trim_silence: true,
                                                                              timeout_secs: 5,        // stop recording after 5s of silence
                                                                              max_length_secs: 120,   // safety cap at 2 minutes
                                                            });
                                            } else if (callState.state === 'hanging_up') {
                                                            // Final goodbye was spoken — now hang up
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
                                                            // Prompt again
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
                                                            // Empty recording — prompt again
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

                                            if (shouldHangUp) {
                                                            callState.state = 'hanging_up';
                                            } else {
                                                            callState.state = 'listening';
                                            }

                                            await telnyxAction(callControlId, 'speak', {
                                                            payload: reply,
                                                            voice: 'female',
                                                            language: 'en-US',
                                            });
                                            break;
                              }

                          // ── CALL ENDED (remote hangup) ──
                              case 'call.hangup': {
                                            if (activeCalls.has(callControlId)) {
                                                            console.log(`[Voice] Call ended: ${callControlId}`);
                                                            activeCalls.delete(callControlId);
                                            }
                                            break;
                              }

                              default:
                                            // Ignore other events
                            break;
                        }
              } catch (err) {
                        console.error(`[Voice] Unhandled error for ${eventType}:`, err.message);
              }
});

module.exports = router;
