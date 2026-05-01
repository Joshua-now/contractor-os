const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET all contractors
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contractors ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single contractor
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contractors WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Contractor not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create contractor (onboarding)
router.post('/', async (req, res) => {
  const { business_name, trade_type, service_zips, working_hours, phone_number,
          ghl_api_key, ghl_location_id, twilio_phone, calendly_url } = req.body;
  try {
    const { rows: [contractor] } = await pool.query(
      `INSERT INTO contractors (business_name, trade_type, service_zips, working_hours,
        phone_number, ghl_api_key, ghl_location_id, twilio_phone, calendly_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [business_name, trade_type, service_zips, JSON.stringify(working_hours),
       phone_number, ghl_api_key, ghl_location_id, twilio_phone, calendly_url]
    );

    // Seed initial memory
    const memorySeeds = [
      { key: 'business_name', value: business_name, category: 'business' },
      { key: 'trade_type', value: trade_type, category: 'business' },
      { key: 'service_area', value: (service_zips || []).join(', '), category: 'business' },
    ];
    for (const m of memorySeeds) {
      await pool.query(
        `INSERT INTO memory (contractor_id, key, value, category) VALUES ($1, $2, $3, $4)
         ON CONFLICT (contractor_id, key) DO UPDATE SET value = $3`,
        [contractor.id, m.key, m.value, m.category]
      );
    }

    res.status(201).json(contractor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update contractor
router.put('/:id', async (req, res) => {
  const fields = ['business_name', 'trade_type', 'service_zips', 'working_hours',
                  'phone_number', 'ghl_api_key', 'ghl_location_id', 'twilio_phone', 'calendly_url'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${i++}`);
      values.push(req.body[field]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE contractors SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
