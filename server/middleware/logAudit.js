const db = require('../db');

async function logAudit(userId, action, resourceType, resourceId, details = {}) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, action, resourceType, resourceId, JSON.stringify(details), details.ip || null]
    );
  } catch (err) {
    // Non-fatal: log to console but don't throw
    console.error('Audit log error:', err.message);
  }
}

module.exports = { logAudit };
