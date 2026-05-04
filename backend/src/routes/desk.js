// desk.js — Field Office Desk API
// Powers the office computer UI for Joshua to chat with the AI office manager
'use strict';

const express = require('express');
const router = express.Router();
const { runConversation } = require('../fieldOffice');
const axios = require('axios');

// In-memory session store (per browser session via session token)
const sessions = new Map();

// ─── CHAT ENDPOINT ────────────────────────────────────────────────────────────
// POST /api/desk/chat
// Body: { message: string, sessionId: string }
router.post('/chat', async (req, res) => {
    try {
          const { message, sessionId } = req.body;
                if (!message) return res.status(400).json({ error: 'message required' });

                const sid = sessionId || 'default';
          const history = sessions.get(sid) || [];

          // Joshua's contractor ID is always 1 (the owner account)
          const contractorId = null; // Will look up by phone in fieldOffice

          const { reply, shouldHangUp, updatedHistory } = await runConversation(
                  contractorId,
                  history,
                  message
                );

          // Update session history (keep last 20 turns to avoid context bloat)
          const trimmed = updatedHistory.slice(-40);
          sessions.set(sid, trimmed);

          res.json({ reply, shouldHangUp, sessionId: sid });
    } catch (err) {
          console.error('[Desk] chat error:', err.message);
          res.status(500).json({ error: err.message });
    }
});

// ─── CLEAR SESSION ─────────────────────────────────────────────────────────────
// POST /api/desk/clear
router.post('/clear', (req, res) => {
    const { sessionId } = req.body;
        if (sessionId) sessions.delete(sessionId);
        else sessions.clear();
        res.json({ ok: true });
});

// ─── SYSTEM STATUS ─────────────────────────────────────────────────────────────
// GET /api/desk/status
// Returns live status of all connected systems
router.get('/status', async (req, res) => {
    const results = {};

    // Check Switchboard
    try {
          const sb = await axios.get(
                  `${process.env.SWITCHBOARD_URL}/api/status`,
            {
                      headers: { Authorization: `Bearer ${process.env.SWITCHBOARD_API_KEY}` },
                                timeout: 5000,
            }
                );
          results.switchboard = { ok: true, data: sb.data };
    } catch (e) {
          // Try /health fallback
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
            {
                      headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY },
                                timeout: 5000,
                      params: { limit: 10 },
            }
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

    // Check Instantly
    try {
          const instantly = await axios.get(
                  'https://api.instantly.ai/api/v1/campaign/list',
            {
                      headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}` },
                                timeout: 5000,
                      params: { limit: 10, skip: 0 },
            }
                );
          const campaigns = instantly.data || [];
          results.instantly = {
                  ok: true,
                  total: campaigns.length,
                  active: campaigns.filter(c => c.status === 1).length,
                  campaigns: campaigns.slice(0, 5).map(c => ({
                            name: c.name,
                            status: c.status === 1 ? 'active' : 'paused',
                            sent: c.total_sent || 0,
                            opens: c.total_opened || 0,
                            replies: c.total_replied || 0,
                  })),
          };
    } catch (e) {
          results.instantly = { ok: false, error: e.message };
    }

    // Check Slack (recent messages)
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
                  messages: (slack.data?.messages || []).slice(0, 3).map(m => ({
                            text: m.text?.substring(0, 100),
                            ts: m.ts,
                  })),
          };
    } catch (e) {
          results.slack = { ok: false, error: e.message };
    }

    // Backend self
    results.backend = { ok: true, uptime: Math.floor(process.uptime()) };

    res.json(results);
});

module.exports = router;
