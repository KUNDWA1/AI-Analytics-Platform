const jwt = require('jsonwebtoken');
const { config } = require('../config');
const db = require('../db');
const { AppError } = require('../errors');

/**
 * Authentication: verifies the JWT, then checks the server-side session row
 * (so logout / revocation really invalidates a token) and that the user is still active.
 * Role permissions are loaded from the database on every request (cheap indexed query),
 * so permission changes apply immediately and cannot be bypassed from the browser.
 */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError(401, 'Authentication required.');

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new AppError(401, 'Invalid or expired token.');
    }

    const { rows } = await db.query(
      `SELECT u.id, u.email, u.full_name, u.is_active, r.name AS role, r.label AS role_label,
              s.revoked, s.expires_at,
              COALESCE(ARRAY(SELECT p.code FROM role_permissions rp
                             JOIN permissions p ON p.id = rp.permission_id
                             WHERE rp.role_id = u.role_id), '{}') AS permissions
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE s.jti = $1`,
      [payload.jti]
    );
    const row = rows[0];
    if (!row || row.revoked || new Date(row.expires_at) < new Date()) {
      throw new AppError(401, 'Session is no longer valid. Please sign in again.');
    }
    if (!row.is_active) throw new AppError(403, 'This account has been deactivated.');

    req.user = {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      role_label: row.role_label,
      permissions: row.permissions,
    };
    req.jti = payload.jti;
    next();
  } catch (e) {
    next(e);
  }
}

/** Authorization: user must hold at least one of the listed permissions. */
const requirePermission = (...codes) => (req, _res, next) => {
  if (!req.user) return next(new AppError(401, 'Authentication required.'));
  if (codes.some((c) => req.user.permissions.includes(c))) return next();
  return next(new AppError(403, 'You do not have permission to perform this action.'));
};

module.exports = { authenticate, requirePermission };
