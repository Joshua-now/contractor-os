const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/:contractorId', async (req, res) => {
    try {
          const { rows } = await db.query(
                  'SELECT * FROM memory WHERE contractor_id = $1 ORDER BY category, key',
                  [req.params.contractorId]
                );
          res.json(rows);
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

router.put('/:contractorId', async (req, res) => {
    const { key, value, category } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'key and value required' });
    try {
          const { rows } = await db.query(
                  `INSERT INTO memory (contractor_id, key, value, category)
                         VALUES ($1, $2, $3, $4)
                                ON CONFLICT (contractor_id, key) DO UPDATE SET value = $3, updated_at = NOW()
                                       RETURNING *`,
                  [req.params.contractorId, key, value, category]
                );
          res.json(rows[0]);
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

router.delete('/:contractorId/:key', async (req, res) => {
    try {
          await db.query(
                  'DELETE FROM memory WHERE contractor_id = $1 AND key = $2',
                  [req.params.contractorId, req.params.key]
                );
          res.json({ deleted: true });
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

module.exports = router;
