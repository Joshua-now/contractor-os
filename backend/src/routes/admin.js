// routes/admin.js — Super admin API (Joshua only)
// All routes require: valid JWT with role = 'admin'
//
// GET  /api/admin/contractors          — list all contractor accounts
// GET  /api/admin/contractors/:id      — full detail on one contractor
// PUT  /api/admin/contractors/:id      — update any contractor's settings
// POST /api/admin/contractors/:id/impersonate — get a short-lived token scoped to that contractor
// GET  /api/admin/stats                — platform-wide stats
// GET  /api/admin/conversations        — recent conversations across all accounts
// GET  /api/admin/jobs                 — recent jobs across all accounts

'use strict';

const express      = require('express');
const router       = express.Router();
const jwt          = require('jsonwebtoken');
const pool         = require('../db');
const requireAuth  = require('../middleware/auth');
const requireAdmin = require('../middleware/adminAuth');

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ─── GET /api/admin/contractors ─────────────────────────────────────────────
// List all contractor accounts with summary stats
router.get('/contractors', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.name, c.company_name, c.email, c.phone,
        c.plan, c.role, c.active, c.onboarded, c.created_at,
        c.telnyx_phone, c.sms_provider, c.service_area,
        (SELECT COUNT(*) FROM leads    l WHERE l.contractor_id = c.id) AS lead_count,
        (SELECT COUNT(*) FROM jobs     j WHERE j.contractor_id = c.id) AS job_count,
        (SELECT COUNT(*) FROM conversations cv WHERE cv.contractor_id = c.id) AS conversation_count,
        (SELECT COALESCE(SUM(amount),0) FROM jobs j2 WHERE j2.contractor_id = c.id AND j2.status = 'paid') AS revenue_paid,
        (SELECT MAX(created_at) FROM conversations cv2 WHERE cv2.contractor_id = c.id) AS last_active
      FROM contractors c
      WHERE c.role != 'admin'
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[Admin] list contractors error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/contractors/:id ─────────────────────────────────────────
router.get('/contractors/:id', async (req, res) => {
  try {
    const { rows: [contractor] } = await pool.query(
      `SELECT id, name, company_name, email, phone, telnyx_phone, sms_provider,
              plan, role, active, onboarded, service_area, services, ai_persona,
              review_link, ghl_location_id, created_at, updated_at
       FROM contractors WHERE id = $1`,
      [req.params.id]
    );
    if (!contractor) return res.status(404).json({ error: 'Not found' });

    // Pull recent activity
    const [leads, jobs, convos, memory] = await Promise.all([
      pool.query(`SELECT * FROM leads WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]),
      pool.query(`SELECT * FROM jobs  WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]),
      pool.query(`SELECT * FROM conversations WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]),
      pool.query(`SELECT key, value, category FROM memory WHERE contractor_id = $1 AND lead_phone IS NULL ORDER BY key`, [req.params.id]),
    ]);

    res.json({
      contractor,
      leads:         leads.rows,
      jobs:          jobs.rows,
      conversations: convos.rows,
      memory:        memory.rows,
    });
  } catch (err) {
    console.error('[Admin] get contractor error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/admin/contractors/:id ─────────────────────────────────────────
router.put('/contractors/:id', async (req, res) => {
  try {
    const { name, company_name, phone, plan, active, telnyx_phone, sms_provider, ai_persona, service_area, review_link } = req.body;
    const { rows: [updated] } = await pool.query(
      `UPDATE contractors SET
        name         = COALESCE($1, name),
        company_name = COALESCE($2, company_name),
        phone        = COALESCE($3, phone),
        plan         = COALESCE($4, plan),
        active       = COALESCE($5, active),
        telnyx_phone = COALESCE($6, telnyx_phone),
        sms_provider = COALESCE($7, sms_provider),
        ai_persona   = COALESCE($8, ai_persona),
        service_area = COALESCE($9, service_area),
        review_link  = COALESCE($10, review_link),
        updated_at   = NOW()
       WHERE id = $11
       RETURNING id, name, company_name, email, plan, active`,
      [name, company_name, phone, plan, active, telnyx_phone, sms_provider, ai_persona, service_area, review_link, req.params.id]
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/contractors/:id/impersonate ─────────────────────────────
// Returns a short-lived (2h) token scoped to that contractor — lets you log in as them
router.post('/contractors/:id/impersonate', async (req, res) => {
  try {
    const { rows: [contractor] } = await pool.query(
      'SELECT id, email, role FROM contractors WHERE id = $1',
      [req.params.id]
    );
    if (!contractor) return res.status(404).json({ error: 'Not found' });
    const secret = process.env.JWT_SECRET;
    const token = jwt.sign(
      { contractorId: contractor.id, email: contractor.email, role: contractor.role, impersonatedBy: req.contractor.id },
      secret,
      { expiresIn: '2h' }
    );
    res.json({ token, contractorId: contractor.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/stats ────────────────────────────────────────────────────
// Platform-wide numbers
router.get('/stats', async (req, res) => {
  try {
    const [contractors, leads, jobs, convos, revenue] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM contractors WHERE role = 'contractor' AND active = true`),
      pool.query(`SELECT COUNT(*) FROM leads`),
      pool.query(`SELECT COUNT(*) FROM jobs`),
      pool.query(`SELECT COUNT(*) FROM conversations WHERE created_at > NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM jobs WHERE status = 'paid'`),
    ]);
    res.json({
      active_contractors: parseInt(contractors.rows[0].count),
      total_leads:        parseInt(leads.rows[0].count),
      total_jobs:         parseInt(jobs.rows[0].count),
      conversations_7d:   parseInt(convos.rows[0].count),
      total_revenue_paid: parseFloat(revenue.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/conversations ────────────────────────────────────────────
router.get('/conversations', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT cv.*, c.company_name, c.name AS contractor_name
      FROM conversations cv
      JOIN contractors c ON c.id = cv.contractor_id
      ORDER BY cv.created_at DESC LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/jobs ──────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT j.*, c.company_name, c.name AS contractor_name
      FROM jobs j
      JOIN contractors c ON c.id = j.contractor_id
      ORDER BY j.created_at DESC LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
