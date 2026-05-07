const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth  = require('../middleware/auth');
const requireAdmin = require('../middleware/adminAuth');

// All routes require admin JWT — use /api/admin/contractors for the full-featured admin UI.
// This file is a lightweight CRUD layer kept for backwards-compat internal tooling.
router.use(requireAuth, requireAdmin);

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

// POST create contractor - uses actual DB schema columns
router.post('/', async (req, res) => {
      try {
              const {
                        name, company_name, email, phone,
                        service_area, telnyx_phone, twilio_phone,
                        sms_provider, ghl_location_id, ghl_contact_id,
                        ai_persona, services, plan
              } = req.body;

        const { rows } = await db.query(
                  `INSERT INTO contractors
                          (name, company_name, email, phone, service_area,
                                   telnyx_phone, twilio_phone, sms_provider, ghl_location_id,
                                            ghl_contact_id, ai_persona, services, plan, active)
                                                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
                                                          RETURNING *`,
                  [name, company_name, email, phone, service_area,
                          telnyx_phone, twilio_phone, sms_provider || 'telnyx', ghl_location_id,
                          ghl_contact_id, ai_persona, services, plan || 'starter']
                );

        res.status(201).json(rows[0]);
      } catch (err) {
              res.status(500).json({ error: err.message });
      }
});

// PUT update contractor
router.put('/:id', async (req, res) => {
      const fields = ['name', 'company_name', 'email', 'phone', 'service_area',
                          'telnyx_phone', 'twilio_phone', 'sms_provider', 'ghl_location_id',
                          'ghl_contact_id', 'ai_persona', 'services', 'plan', 'active', 'onboarded',
                          'bob_enabled', 'crm_type', 'crm_api_key', 'crm_account_id'];
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
