const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');

// All conversation/lead data is scoped to the authenticated contractor's JWT.
// Ignores URL :contractorId entirely — uses req.contractor.id from the token.

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM conversations WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.contractor.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[Conversations] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

router.get('/leads', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM leads WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 200',
      [req.contractor.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[Conversations] GET leads error:', err.message);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

module.exports = router;
