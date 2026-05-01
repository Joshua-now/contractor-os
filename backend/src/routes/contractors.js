const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all contractors
router.get('/', async (req, res) => {
    try {
          const { rows } = await db.query('SELECT * FROM contractors ORDER BY created_at DESC');
          res.json(rows);
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

// GET single contractor
router.get('/:id', async (req, res) => {
    try {
          const { rows } = await db.query('SELECT * FROM contractors WHERE id = $1', [req.params.id]);
          if (!rows.length) return res.status(404).json({ error: 'Contractor not found' });
          res.json(rows[0]);
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

// POST create contractor
router.post('/', async (req, res) => {
    try {
          const {
                  business_name, trade_type, phone_number, email,
                  service_area, telnyx_phone, twilio_phone,
                  ghl_api_key, ghl_location_id, calendly_url,
                  working_hours, service_zips
          } = req.body;

      const { rows } = await db.query(
              `INSERT INTO contractors
                      (business_name, trade_type, phone_number, email, service_area,
                               telnyx_phone, twilio_phone, ghl_api_key, ghl_location_id,
                                        calendly_url, working_hours, service_zips)
                                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                                                      RETURNING *`,
              [business_name, trade_type, phone_number, email, service_area,
                      telnyx_phone, twilio_phone, ghl_api_key, ghl_location_id,
                      calendly_url, working_hours, service_zips]
            );

      res.status(201).json(rows[0]);
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

// PUT update contractor
router.put('/:id', async (req, res) => {
    const fields = ['business_name', 'trade_type', 'service_zips', 'working_hours',
                                      'phone_number', 'ghl_api_key', 'ghl_location_id', 'twilio_phone', 'calendly_url',
                                      'telnyx_phone', 'email', 'service_area'];
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

             try {
                   const { rows } = await db.query(
                           `UPDATE contractors SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
                           [...values, req.params.id]
                         );
                   if (!rows.length) return res.status(404).json({ error: 'Contractor not found' });
                   res.json(rows[0]);
             } catch (err) {
                   res.status(500).json({ error: err.message });
             }
});

// DELETE contractor
router.delete('/:id', async (req, res) => {
    try {
          await db.query('DELETE FROM contractors WHERE id = $1', [req.params.id]);
          res.json({ deleted: true });
    } catch (err) {
          res.status(500).json({ error: err.message });
    }
});

module.exports = router;
