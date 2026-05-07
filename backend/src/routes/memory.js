const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');

// All memory is scoped to the authenticated contractor. Uses req.contractor.id from JWT.

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM memory WHERE contractor_id = $1 ORDER BY category, key',
      [req.contractor.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[Memory] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch memory' });
  }
});

router.put('/', requireAuth, async (req, res) => {
  const { key, value, category } = req.body;
  if (!key || value === undefined || value === null) {
    return res.status(400).json({ error: 'key and value required' });
  }
  if (typeof key !== 'string' || key.length > 255) {
    return res.status(400).json({ error: 'key must be a string ≤ 255 chars' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO memory (contractor_id, key, value, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (contractor_id, key) DO UPDATE SET value = $3, updated_at = NOW()
       RETURNING *`,
      [req.contractor.id, key, String(value), category || null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[Memory] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to save memory' });
  }
});

router.delete('/:key', requireAuth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM memory WHERE contractor_id = $1 AND key = $2',
      [req.contractor.id, req.params.key]
    );
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Memory] DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

module.exports = router;
