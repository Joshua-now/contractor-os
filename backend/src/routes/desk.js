// desk.js — Field Office Desk API
// Powers the office computer UI for Joshua to chat with the AI employee
//
// DEFAULT: routes to agent.js — the contractor-OS AI employee (demo mode)
//   Joshua chats as himself, the AI responds as his office assistant
//   No real SMS is sent — tools run but skip SMS delivery
//
// MODE=sales: routes to fieldOffice.js — Fluid Productions sales CRM desk
'use strict';

const express = require('express');
const router = express.Router();
const { runAgentLoop } = require('../agent');
const { runConversation } = require('../fieldOffice');
const axios = require('axios');
const pool = require('../db');

// In-memory session store for sales desk mode
const sessions = new Map();

// Dedicated phone number for desk demo conversations (not a real number)
// Keeps desk test conversations separate from real inbound SMS conversations
const DESK_TEST_PHONE = '+10000000001';

// ─── CHAT ENDPOINT ──────────────────────────────────────────────────────────
// POST /api/desk/chat
// Body: { message: string, sessionId: string, mode: 'contractor' | 'sales' }
router.post('/chat', async (req, res) => {
          try {
                      const { message, sessionId, mode, docContext } = req.body;
                      if (!message) return res.status(400).json({ error: 'message required' });

            const sid = sessionId || 'default';

            // Look up Joshua's contractor record
            const { rows: [cRow] } = await pool.query(
                          "SELECT * FROM contractors WHERE phone = '+13212055991' LIMIT 1"
                        );

            if (!cRow) {
                          return res.status(500).json({ error: 'Contractor record not found. Run seed first.' });
            }

            // SALES DESK MODE: Joshua's Fluid Productions assistant
            if (mode === 'sales') {
                          const history = sessions.get(sid) || [];
                          const { reply, shouldHangUp, updatedHistory } = await runConversation(
                                          cRow.id,
                                          history,
                                          message
                                        );
                          sessions.set(sid, updatedHistory.slice(-40));
                          return res.json({ reply, shouldHangUp, sessionId: sid });
            }

            // CONTRACTOR DEMO MODE (default): AI employee demo
            // smsProvider = 'desk' triggers deskMode in agent.js (no real SMS sent)
            const result = await runAgentLoop(cRow, DESK_TEST_PHONE, message, 'desk', docContext || '');
                      const reply = result.lastReply || 'Done.';

            res.json({ reply, shouldHangUp: false, sessionId: sid });
          } catch (err) {
                      console.error('[Desk] chat error:', err.message);
                      res.status(500).json({ error: err.message });
          }
});

// ─── CLEAR SESSION ────────────────────────────────────────────────────────────
// POST /api/desk/clear
router.post('/clear', (req, res) => {
          const { sessionId } = req.body;
          if (sessionId) sessions.delete(sessionId);
          else sessions.clear();
          res.json({ ok: true });
});

// ─── SYSTEM STATUS ────────────────────────────────────────────────────────────
// GET /api/desk/status
router.get('/status', async (req, res) => {
          const results = {};

             // Check Switchboard
             try {
                         const sb = await axios.get(
                                       `${process.env.SWITCHBOARD_URL}/api/status`,
                                 { headers: { Authorization: `Bearer ${process.env.SWITCHBOARD_API_KEY}` }, timeout: 5000 }
                                     );
                         results.switchboard = { ok: true, data: sb.data };
             } catch (e) {
                         try {
                                       const sb2 = await axios.get(`${process.env.SWITCHBOARD_URL}/health`, { timeout: 5000 });
                                       results.switchboard = { ok: true, data: sb2.data };
                         } catch (e2) {
                                       results.switchboard = { ok: false, error: e2.message };
                         }
             }

             // Check n8n
             try {
                         const n8n = await axios.get(
                                       `${process.env.N8N_BASE_URL}/api/v1/workflows`,
                                 { headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY }, timeout: 5000, params: { limit: 10 } }
                                     );
                         const workflows = n8n.data?.data || [];
                         results.n8n = {
                                       ok: true,
                                       total: workflows.length,
                                       active: workflows.filter(w => w.active).length,
                                       workflows: workflows.map(w => ({ name: w.name, active: w.active })),
                         };
             } catch (e) {
                         results.n8n = { ok: false, error: e.message };
             }

             // Check Instantly (v2 API)
             try {
                         const instantly = await axios.get(
                                       'https://api.instantly.ai/api/v2/campaigns',
                                 {
                                                 headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}` },
                                                 timeout: 5000,
                                                 params: { limit: 10, skip: 0 },
                                 }
                                     );
                         const raw = instantly.data;
                                 const campaigns = Array.isArray(raw) ? raw : (raw?.items || raw?.campaigns || raw?.data || []);
                         results.instantly = {
                                       ok: true,
                                       total: campaigns.length,
                                       active: campaigns.filter(c => c.status === 1 || c.status === 'active').length,
                                       campaigns: campaigns.slice(0, 5).map(c => ({
                                                       name: c.name,
                                                       status: (c.status === 1 || c.status === 'active') ? 'active' : 'paused',
                                                       sent: c.total_sent || c.totalSent || 0,
                                                       opens: c.total_opened || c.totalOpened || 0,
                                                       replies: c.total_replied || c.totalReplied || 0,
                                       })),
                         };
             } catch (e) {
                         results.instantly = { ok: false, error: e.message };
             }

             // Check Slack
             try {
                         const slack = await axios.get(
                                       'https://slack.com/api/conversations.history',
                                 {
                                                 headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
                                                 params: { channel: process.env.SLACK_HAND_RAISES_CHANNEL || 'hand-raises', limit: 5 },
                                                 timeout: 5000,
                                 }
                                     );
                         results.slack = {
                                       ok: slack.data?.ok || false,
                                       recent_count: slack.data?.messages?.length || 0,
                                       messages: (slack.data?.messages || []).slice(0, 3).map(m => ({ text: m.text?.substring(0, 100), ts: m.ts })),
                         };
             } catch (e) {
                         results.slack = { ok: false, error: e.message };
             }

             results.backend = { ok: true, uptime: Math.floor(process.uptime()) };
          res.json(results);
});

module.exports = router;
