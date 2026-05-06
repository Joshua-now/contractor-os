// middleware/auth.js — JWT auth middleware for multitenant contractor-os
// Usage: router.post('/chat', requireAuth, async (req, res) => { ... })
// On success: req.contractor = { id, email, name, company_name, plan, ... }

const jwt = require('jsonwebtoken');
const pool = require('../db');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET not configured');

    const payload = jwt.verify(token, secret);

    // Fetch fresh contractor record so req.contractor always has current data
    const { rows: [contractor] } = await pool.query(
      'SELECT id, name, company_name, email, phone, telnyx_phone, sms_provider, plan, active, ai_persona, service_area, services, review_link, ghl_location_id FROM contractors WHERE id = $1 AND active = true',
      [payload.contractorId]
    );

    if (!contractor) {
      return res.status(401).json({ error: 'Contractor not found or inactive' });
    }

    req.contractor = contractor;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired — please log in again' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('[Auth] Middleware error:', err.message);
    return res.status(500).json({ error: 'Auth error' });
  }
}

module.exports = requireAuth;
