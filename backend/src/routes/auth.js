const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const db = require('../db');
const { AppError, ok, wrap } = require('../errors');
const { authenticate } = require('../middleware/auth');
const { audit } = require('../services/audit');
const v = require('../validate');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.env === 'test' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many login attempts. Try again later.' } },
});

// A pre-computed hash so that unknown e-mails take the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 10);

router.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const email = v.str(req.body.email, 'Email', { max: 254 }).toLowerCase();
    const pw = typeof req.body.password === 'string' ? req.body.password : '';
    if (!pw) throw new AppError(400, 'Password is required.');

    const { rows } = await db.query(
      `SELECT u.*, r.name AS role, r.label AS role_label FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`,
      [email]
    );
    const user = rows[0];
    const match = await bcrypt.compare(pw, user ? user.password_hash : DUMMY_HASH);
    if (!user || !match) {
      await audit(req, 'LOGIN_FAILED', 'user', null, { email }, { id: null, email });
      throw new AppError(401, 'Invalid email or password.');
    }
    if (!user.is_active) throw new AppError(403, 'This account has been deactivated.');

    const jti = crypto.randomUUID();
    const token = jwt.sign({ sub: user.id, jti }, config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: config.jwtExpiresIn,
    });
    const decoded = jwt.decode(token);
    await db.query('INSERT INTO sessions (jti, user_id, expires_at) VALUES ($1,$2,to_timestamp($3))', [
      jti,
      user.id,
      decoded.exp,
    ]);
    await db.query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);
    await audit(req, 'LOGIN', 'user', user.id, null, { id: user.id, email: user.email });

    const perms = await db.query(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
      [user.role_id]
    );
    ok(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        role_label: user.role_label,
        permissions: perms.rows.map((r) => r.code),
      },
    });
  })
);

router.post(
  '/logout',
  authenticate,
  wrap(async (req, res) => {
    await db.query('UPDATE sessions SET revoked = TRUE WHERE jti = $1', [req.jti]);
    await audit(req, 'LOGOUT', 'user', req.user.id);
    ok(res, { message: 'Signed out.' });
  })
);

router.get(
  '/me',
  authenticate,
  wrap(async (req, res) => ok(res, { user: req.user }))
);

router.post(
  '/change-password',
  authenticate,
  wrap(async (req, res) => {
    const { current_password, new_password } = req.body;
    v.password(new_password);
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(current_password || ''), rows[0].password_hash))) {
      throw new AppError(400, 'Current password is incorrect.');
    }
    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    // revoke all other sessions
    await db.query('UPDATE sessions SET revoked = TRUE WHERE user_id = $1 AND jti <> $2', [req.user.id, req.jti]);
    await audit(req, 'PASSWORD_CHANGED', 'user', req.user.id);
    ok(res, { message: 'Password updated.' });
  })
);

module.exports = router;
