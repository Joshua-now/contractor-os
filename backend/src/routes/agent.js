const express = require('express');
const router = express.Router();
const { runAgent, runProactiveTask } = require('../agent');

// Internal API key guard — these routes are for server-to-server calls (n8n, cron, etc.)
// They are NOT for browser clients — browser uses /api/desk/chat with JWT instead.
function requireInternalKey(req, res, next) {
  const key = req.headers['x-internal-key'] || req.body?.internalKey;
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    // No key configured — block in production, warn in dev
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Agent API not configured for external access' });
    }
    console.warn('[Agent] INTERNAL_API_KEY not set — allowing in dev mode only');
  } else if (key !== expected) {
    return res.status(401).json({ error: 'Invalid internal API key' });
  }
  next();
}

// POST send a message to the agent (internal/server-to-server only)
router.post('/message', requireInternalKey, async (req, res) => {
  const { contractorId, message, channel, fromNumber } = req.body;
  if (!contractorId || !message) {
    return res.status(400).json({ error: 'contractorId and message are required' });
  }
  try {
    const response = await runAgent({ contractorId, message, channel, fromNumber });
    res.json({ response });
  } catch (err) {
    console.error('[Agent] /message error:', err.message);
    res.status(500).json({ error: 'Agent error' });
  }
});

// POST trigger a proactive task (internal/server-to-server only)
router.post('/task', requireInternalKey, async (req, res) => {
  const { contractorId, taskType, data } = req.body;
  if (!contractorId || !taskType) {
    return res.status(400).json({ error: 'contractorId and taskType are required' });
  }
  try {
    const result = await runProactiveTask({ contractorId, taskType, data });
    res.json({ result });
  } catch (err) {
    console.error('[Agent] /task error:', err.message);
    res.status(500).json({ error: 'Task error' });
  }
});

module.exports = router;
