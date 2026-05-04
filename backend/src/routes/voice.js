// voice.js - AI Field Office Voice Route
// Handles inbound calls from contractors via Telnyx
// Flow: Contractor calls → AI greets → Records voice memo → Transcribes → Field Office runs → AI reads summary back
'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../db');
const { runFieldOffice } = require('../fieldOffice');

// In-memory store for active calls (call_control_id → state)
const activeCalls = new Map();

// ─── HELPERS ────────────────────────────────────────────────────────────────

function telnyxAction(callControlId, action, payload = {}) {
      const token = process.env.TELNYX_API_KEY;
      return axios.post(
              `https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`,
              payload,
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
            );
}

async function lookupContractorByPhone(phone) {
      // Normalize: strip non-digits, keep last 10
  const normalized = phone.replace(/\D/g, '').slice(-10);
      const result = await pool.query(
              `SELECT * FROM contractors WHERE telnyx_phone LIKE $1 AND active = true LIMIT 1`,
              [`%${normalized}`]
            );
      return result.rows[0] || null;
}

// Convert field office summary to SSML-friendly text
function toVoiceText(summary) {
      return summary
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/#+\s/g, '')
        .replace(/Done:/g, 'Done.')
        .trim();
}

// ─── TELNYX WEBHOOK HANDLER ──────────────────────────────────────────────────

router.post('/telnyx', async (req, res) => {
      // Acknowledge immediately — Telnyx requires fast response
              res.sendStatus(200);

              const event = req.body?.data;
      if (!event) return;

              const eventType = event.event_type;
      const payload = event.payload;
      const callControlId = payload?.call_control_id;

              console.log(`[Voice] Event: ${eventType} | Call: ${callControlId?.substring(0, 20)}...`);

              try {
                      switch (eventType) {

                        // ── INBOUND CALL ARRIVES ──
                          case 'call.initiated': {
                                      if (payload.direction !== 'incoming') break;

                                      const fromNumber = payload.from;
                                      const toNumber = payload.to;

                                      const contractor = await lookupContractorByPhone(toNumber);
                                      activeCalls.set(callControlId, {
                                                    contractorId: contractor?.id || null,
                                                    contractorName: contractor?.company_name || contractor?.name || 'your company',
                                                    fromNumber,
                                                    state: 'ringing',
                                      });

                                      await telnyxAction(callControlId, 'answer');
                                      break;
                          }

                        // ── CALL ANSWERED — PLAY GREETING ──
                          case 'call.answered': {
                                      const callState = activeCalls.get(callControlId);
                                      if (!callState) break;

                                      callState.state = 'greeting';
                                      const greeting = callState.contractorId
                                        ? `Hey, ${callState.contractorName} field office here. Go ahead with your report after the beep. I'm recording.`
                                                    : `AI field office. I couldn't find your account. Please call back from your registered number.`;

                                      await telnyxAction(callControlId, 'speak', {
                                                    payload: greeting,
                                                    voice: 'male',
                                                    language: 'en-US',
                                                    command_id: 'greeting',
                                      });
                                      break;
                          }

                        // ── SPEAK ENDED — UNIFIED HANDLER (fixes duplicate case bug) ──
                        // Branches on callState.state to handle all three speak.ended transitions:
                        //   greeting   → start recording
                        //   processing → run field office (after "processing" ack speak ends)
                        //   summary    → hang up (after summary read-back ends)
                          case 'call.speak.ended': {
                                      const callState = activeCalls.get(callControlId);
                                      if (!callState) break;

                                      // ── GREETING DONE → START RECORDING ──
                                      if (callState.state === 'greeting') {
                                                    if (!callState.contractorId) {
                                                                    await telnyxAction(callControlId, 'hangup');
                                                                    break;
                                                    }
                                                    callState.state = 'recording';
                                                    await telnyxAction(callControlId, 'record_start', {
                                                                    format: 'mp3',
                                                                    channels: 'single',
                                                                    play_beep: true,
                                                                    timeout_secs: 3,      // Stop after 3s silence
                                                                    time_limit_secs: 180, // Max 3 minutes
                                                                    command_id: 'field_report',
                                                    });

                                      // ── PROCESSING ACK DONE → RUN FIELD OFFICE ──
                                      } else if (callState.state === 'processing' && callState.transcript) {
                                                    callState.state = 'running';

                                        let voiceResponse = 'Done. Your report has been processed.';
                                                    try {
                                                                    const result = await runFieldOffice(callState.contractorId, callState.transcript);
                                                                    voiceResponse = toVoiceText(result.voice_response);
                                                                    console.log(`[Voice] Field office completed: ${result.actions_taken} actions`);
                                                    } catch (err) {
                                                                    console.error('[Voice] Field office error:', err.message);
                                                                    voiceResponse = "I ran into an issue processing your report. It's been logged and we'll follow up.";
                                                    }

                                        callState.state = 'summary';
                                                    await telnyxAction(callControlId, 'speak', {
                                                                    payload: voiceResponse,
                                                                    voice: 'male',
                                                                    language: 'en-US',
                                                                    command_id: 'summary',
                                                    });

                                      // ── SUMMARY READ → HANG UP ──
                                      } else if (callState.state === 'summary') {
                                                    callState.state = 'done';
                                                    await new Promise(r => setTimeout(r, 1000));
                                                    await telnyxAction(callControlId, 'hangup');
                                      }

                                      break;
                          }

                        // ── RECORDING COMPLETE — TRANSCRIBE + ACK ──
                          case 'call.recording.saved': {
                                      const callState = activeCalls.get(callControlId);
                                      if (!callState) break;

                                      callState.state = 'processing';
                                      const recordingUrl = payload.recording_urls?.mp3;

                                      if (!recordingUrl) {
                                                    console.error('[Voice] No recording URL in payload');
                                                    await telnyxAction(callControlId, 'speak', {
                                                                    payload: "Sorry, I didn't catch that. Please call back and try again.",
                                                                    voice: 'male',
                                                                    language: 'en-US',
                                                                    command_id: 'error',
                                                    });
                                                    break;
                                      }

                                      console.log(`[Voice] Recording saved: ${recordingUrl}`);

                                      // Transcribe using OpenAI Whisper
                                      let transcript = '';
                                      try {
                                                    const audioResponse = await axios.get(recordingUrl, {
                                                                    responseType: 'arraybuffer',
                                                                    headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
                                                    });

                                        const FormData = require('form-data');
                                                    const form = new FormData();
                                                    form.append('file', Buffer.from(audioResponse.data), {
                                                                    filename: 'recording.mp3',
                                                                    contentType: 'audio/mpeg',
                                                    });
                                                    form.append('model', 'whisper-1');

                                        const whisperResponse = await axios.post(
                                                        'https://api.openai.com/v1/audio/transcriptions',
                                                        form,
                                            {
                                                              headers: {
                                                                                  ...form.getHeaders(),
                                                                                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                                                              },
                                            }
                                                      );

                                        transcript = whisperResponse.data?.text || '';
                                                    console.log(`[Voice] Transcript: "${transcript.substring(0, 200)}"`);

                                      } catch (transcribeErr) {
                                                    console.error('[Voice] Transcription failed:', transcribeErr.message);
                                                    transcript = '';
                                      }

                                      if (!transcript.trim()) {
                                                    await telnyxAction(callControlId, 'speak', {
                                                                    payload: "I couldn't understand the recording. Please try again.",
                                                                    voice: 'male',
                                                                    language: 'en-US',
                                                                    command_id: 'transcribe_error',
                                                    });
                                                    break;
                                      }

                                      // Store transcript, then ack while field office runs
                                      callState.transcript = transcript;
                                      await telnyxAction(callControlId, 'speak', {
                                                    payload: 'Got it. Processing your report now.',
                                                    voice: 'male',
                                                    language: 'en-US',
                                                    command_id: 'processing',
                                      });
                                      break;
                          }

                        // ── CALL ENDED — CLEANUP ──
                          case 'call.hangup': {
                                      activeCalls.delete(callControlId);
                                      console.log(`[Voice] Call ended. Active calls: ${activeCalls.size}`);
                                      break;
                          }
                      }

              } catch (err) {
                      console.error(`[Voice] Handler error for ${eventType}:`, err.message);
              }
});

// ─── REST ENDPOINT — TEST WITHOUT A REAL CALL ────────────────────────────────
// POST /api/voice/test { contractorId, transcript }
router.post('/test', async (req, res) => {
      const { contractorId, transcript } = req.body;
      if (!contractorId || !transcript) {
              return res.status(400).json({ error: 'contractorId and transcript required' });
      }
      try {
              const result = await runFieldOffice(contractorId, transcript);
              res.json(result);
      } catch (err) {
              res.status(500).json({ error: err.message });
      }
});

module.exports = router;
