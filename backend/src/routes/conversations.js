const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/:contractorId', async (req, res) => {
    try {
          const { rows } = await db.query(
                  'SELECT * FROM conversations WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 100',
                  [req.params.contractorId]
                );
          res.json(rows);
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

router.get('/:contractorId/leads', async (req, res) => {
    try {
          const { rows } = await db.query(
                  'SELECT * FROM leads WHERE contractor_id = $1 ORDER BY created_at DESC',
                  [req.params.contractorId]
                );
          res.json(rows);
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

module.exports = router;
