// routes/auth.js — Multitenant authentication for contractor-os
//
// POST /api/auth/login      — email + password → JWT (24h)
// POST /api/auth/provision  — admin-only: create a new contractor account with password
// GET  /api/auth/me         — return current contractor (requires Bearer token)

'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

// ─── Helper: sign a JWT for a contractor ────────────────────────────────────
function signToken(contractorId, email, role = 'contractor') {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var not set');
  return jwt.sign(
    { contractorId, email, role },
    secret,
    { expiresIn: '24h' }
  );
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────
// Body: { email, password }
// Returns: { token, contractor: { id, name, email, company_name, plan } }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const { rows: [contractor] } = await pool.query(
      'SELECT * FROM contractors WHERE email = $1 AND active = true',
      [email.toLowerCase().trim()]
    );

    if (!contractor) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!contractor.password_hash) {
      return res.status(401).json({ error: 'Account not yet set up with a password. Contact your admin.' });
    }

    const valid = await bcrypt.compare(password, contractor.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(contractor.id, contractor.email, contractor.role || 'contractor');

    return res.json({
      token,
      contractor: {
        id: contractor.id,
        name: contractor.name,
        email: contractor.email,
        company_name: contractor.company_name,
        plan: contractor.plan,
        role: contractor.role || 'contractor',
        ai_persona: contractor.ai_persona,
        service_area: contractor.service_area,
      }
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
// Returns current contractor from JWT
router.get('/me', requireAuth, (req, res) => {
  res.json({ contractor: req.contractor });
});

// ─── POST /api/auth/provision ────────────────────────────────────────────────
// Admin-only: create a new contractor account and set their password
// Header: x-admin-secret: <ADMIN_SECRET env var>
// Body: { name, email, password, company_name?, phone?, plan? }
router.post('/provision', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(500).json({ error: 'ADMIN_SECRET not configured on server' });
    }
    if (req.headers['x-admin-secret'] !== adminSecret) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, email, password, company_name, phone, plan, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password required' });
    }

    // Check if contractor already exists
    const { rows: existing } = await pool.query(
      'SELECT id FROM contractors WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    if (existing.length > 0) {
      // Update existing contractor's password AND role
      await pool.query(
        'UPDATE contractors SET password_hash = $1, role = $2, updated_at = NOW() WHERE email = $3',
        [password_hash, role || 'contractor', email.toLowerCase().trim()]
      );
      const token = signToken(existing[0].id, email.toLowerCase().trim(), role || 'contractor');
      return res.json({ ok: true, action: 'password_updated', contractorId: existing[0].id, token });
    }

    // Create new contractor
    const { rows: [newContractor] } = await pool.query(
      `INSERT INTO contractors (name, email, company_name, phone, plan, role, password_hash, active, onboarded)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, false)
       RETURNING id, name, email, company_name, plan, role`,
      [
        name,
        email.toLowerCase().trim(),
        company_name || null,
        phone || null,
        plan || 'trial',
        role || 'contractor',
        password_hash
      ]
    );

    const token = signToken(newContractor.id, newContractor.email, newContractor.role);

    return res.status(201).json({
      ok: true,
      action: 'created',
      token,
      contractor: newContractor
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error('[Auth] Provision error:', err.message);
    res.status(500).json({ error: 'Provision failed' });
  }
});

// ─── POST /api/auth/set-password ─────────────────────────────────────────────
// Allows an authenticated contractor to change their own password
// Body: { currentPassword, newPassword }
router.post('/set-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const { rows: [contractor] } = await pool.query(
      'SELECT password_hash FROM contractors WHERE id = $1',
      [req.contractor.id]
    );

    if (contractor.password_hash) {
      const valid = await bcrypt.compare(currentPassword, contractor.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    }

    const password_hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      'UPDATE contractors SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [password_hash, req.contractor.id]
    );

    res.json({ ok: true, message: 'Password updated' });
  } catch (err) {
    console.error('[Auth] Set-password error:', err.message);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// ─── GET /api/auth/profile ───────────────────────────────────────────────────
// Returns own contractor profile — safe alternative to /api/contractors/:id
router.get('/profile', requireAuth, (req, res) => {
  res.json(req.contractor);
});

// ─── PUT /api/auth/profile ───────────────────────────────────────────────────
// Contractor updates their own safe profile fields (cannot change plan, role, active)
router.put('/profile', requireAuth, async (req, res) => {
  const ALLOWED = [
    'name', 'company_name', 'phone', 'ai_persona', 'service_area', 'services',
    'review_link', 'ghl_location_id', 'ghl_contact_id', 'telnyx_phone', 'twilio_phone',
    'sms_provider', 'bob_enabled', 'crm_type', 'crm_api_key', 'crm_account_id', 'onboarded',
  ];
  const updates = [];
  const values  = [];
  let i = 1;

  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${i++}`);
      values.push(req.body[field]);
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    const { rows: [updated] } = await pool.query(
      `UPDATE contractors SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${i} AND active = true RETURNING
         id, name, company_name, email, phone, telnyx_phone, sms_provider,
         plan, role, active, bob_enabled, ai_persona, service_area, services,
         review_link, ghl_location_id, crm_type, crm_account_id, onboarded`,
      [...values, req.contractor.id]
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    console.error('[Auth] Profile update error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
