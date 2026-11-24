const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError, ok, wrap } = require('../errors');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const v = require('../validate');

const router = express.Router();
router.use(authenticate, requirePermission('users.manage'));

const ROLES = ['administrator', 'analyst', 'regulator', 'management'];

const SELECT = `SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, u.last_login,
                       r.name AS role, r.label AS role_label
                FROM users u JOIN roles r ON r.id = u.role_id`;

router.get(
  '/',
  wrap(async (_req, res) => {
    const { rows } = await db.query(`${SELECT} ORDER BY u.id`);
    ok(res, rows);
  })
);

router.get(
  '/roles',
  wrap(async (_req, res) => {
    const { rows } = await db.query('SELECT id, name, label, description FROM roles ORDER BY id');
    ok(res, rows);
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const email = v.str(req.body.email, 'Email', { max: 254 }).toLowerCase();
    if (!v.isEmail(email)) throw new AppError(400, 'Email is not valid.');
    const full_name = v.str(req.body.full_name, 'Full name', { max: 120 });
    const role = v.oneOf(req.body.role, 'Role', ROLES);
    v.password(req.body.password);
    const hash = await bcrypt.hash(req.body.password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, full_name, password_hash, role_id)
       VALUES ($1,$2,$3,(SELECT id FROM roles WHERE name = $4)) RETURNING id`,
      [email, full_name, hash, role]
    );
    await audit(req, 'USER_CREATED', 'user', rows[0].id, { email, role });
    const created = await db.query(`${SELECT} WHERE u.id = $1`, [rows[0].id]);
    ok(res, created.rows[0], 201);
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const existing = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (!existing.rows[0]) throw new AppError(404, 'User not found.');

    const sets = [];
    const vals = [];
    const push = (col, val) => {
      vals.push(val);
      sets.push(`${col} = $${vals.length}`);
    };
    if (req.body.full_name !== undefined) push('full_name', v.str(req.body.full_name, 'Full name', { max: 120 }));
    if (req.body.role !== undefined) {
      v.oneOf(req.body.role, 'Role', ROLES);
      vals.push(req.body.role);
      sets.push(`role_id = (SELECT id FROM roles WHERE name = $${vals.length})`);
    }
    if (req.body.is_active !== undefined) push('is_active', Boolean(req.body.is_active));
    if (req.body.password) {
      v.password(req.body.password);
      push('password_hash', await bcrypt.hash(req.body.password, 12));
    }
    if (!sets.length) throw new AppError(400, 'No changes supplied.');

    // guard: an admin must not lock themselves out
    if (id === req.user.id && (req.body.is_active === false || (req.body.role && req.body.role !== 'administrator'))) {
      throw new AppError(400, 'You cannot deactivate or demote your own account.');
    }
    vals.push(id);
    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    if (req.body.is_active === false || req.body.role || req.body.password) {
      await db.query('UPDATE sessions SET revoked = TRUE WHERE user_id = $1', [id]);
    }
    await audit(req, 'USER_UPDATED', 'user', id, {
      fields: Object.keys(req.body).filter((k) => k !== 'password'),
      password_reset: Boolean(req.body.password),
    });
    const updated = await db.query(`${SELECT} WHERE u.id = $1`, [id]);
    ok(res, updated.rows[0]);
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    if (id === req.user.id) throw new AppError(400, 'You cannot delete your own account.');
    const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [id]);
    if (!rowCount) throw new AppError(404, 'User not found.');
    await audit(req, 'USER_DELETED', 'user', id);
    ok(res, { message: 'User deleted.' });
  })
);

module.exports = router;
