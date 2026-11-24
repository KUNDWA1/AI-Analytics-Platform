const db = require('../db');

/** Write an audit-log entry. Never throws (auditing must not break the request). */
async function audit(req, action, entityType = null, entityId = null, details = null, userOverride = null) {
  try {
    const user = userOverride || (req && req.user) || null;
    await db.query(
      `INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        user ? user.id : null,
        user ? user.email : null,
        action,
        entityType,
        entityId === null || entityId === undefined ? null : String(entityId),
        details ? JSON.stringify(details) : null,
        req && req.ip ? req.ip : null,
      ]
    );
  } catch (e) {
    console.error('[audit] failed to write log:', e.message);
  }
}

module.exports = { audit };
