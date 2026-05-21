const db = require('../db');

function requirePaidFeature(feature) {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });
      const result = await db.query(
        `SELECT id, status, expires_at FROM paid_features
         WHERE user_id = $1 AND feature = $2 AND status = 'active'
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [req.user.id, feature]
      );
      if (result.rows.length === 0) {
        return res.status(402).json({
          error: 'Payment required',
          feature,
          purchase_url: `/api/ai/dtc/purchase/${feature}`
        });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = requirePaidFeature;
