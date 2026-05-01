const express = require('express');
const router = express.Router();
const { runAgent, runProactiveTask } = require('../agent');

// POST send a message to the agent
router.post('/message', async (req, res) => {
  const { contractorId, message, channel, fromNumber } = req.body;
  if (!contractorId || !message) {
    return res.status(400).json({ error: 'contractorId and message are required' });
  }
  try {
    const response = await runAgent({ contractorId, message, channel, fromNumber });
    res.json({ response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST trigger a proactive task
router.post('/task', async (req, res) => {
  const { contractorId, taskType, data } = req.body;
  if (!contractorId || !taskType) {
    return res.status(400).json({ error: 'contractorId and taskType are required' });
  }
  try {
    const result = await runProactiveTask({ contractorId, taskType, data });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
