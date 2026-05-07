// middleware/adminAuth.js — Super admin gate
// Requires requireAuth to have already run (req.contractor populated)
// Usage: router.get('/something', requireAuth, requireAdmin, handler)

module.exports = function requireAdmin(req, res, next) {
  if (!req.contractor) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.contractor.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
