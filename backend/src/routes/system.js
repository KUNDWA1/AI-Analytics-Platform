// Health check, audit logs, downloadable sample datasets and demo-environment reset.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const db = require('../db');
const { AppError, ok, wrap } = require('../errors');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const demo = require('../services/demo');

const router = express.Router();

// Public, minimal: used by deployment platforms. Reveals nothing beyond up/down.
router.get('/health', wrap(async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ success: true, data: { status: 'ok' } });
}));

router.get(
  '/audit-logs',
  authenticate,
  requirePermission('audit.view'),
  wrap(async (req, res) => {
    const where = [];
    const vals = [];
    const add = (sql, val) => { vals.push(val); where.push(sql.replace('?', `$${vals.length}`)); };
    if (req.query.action) add('action = ?', String(req.query.action).slice(0, 60));
    if (req.query.user) add('user_email ILIKE ?', `%${String(req.query.user).slice(0, 80)}%`);
    if (req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) add('created_at >= ?', req.query.from);
    if (req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) add("created_at < (?::date + 1)", req.query.to);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const total = await db.query(`SELECT count(*)::int AS n FROM audit_logs ${w}`, vals);
    const { rows } = await db.query(
      `SELECT id, user_email, action, entity_type, entity_id, details, ip_address, created_at
       FROM audit_logs ${w} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
      vals
    );
    const actions = await db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    ok(res, { items: rows, total: total.rows[0].n, actions: actions.rows.map((r) => r.action) });
  })
);

// ---------------------------------------------------------------- sample datasets
const SAMPLE_NOTES = {
  'digital_financial_activity_synthetic.csv': 'Monthly mobile money, digital payments and mobile banking activity by province, 2020-2024 (wide layout).',
  'connectivity_inclusion_synthetic.csv': 'Monthly connectivity and financial-inclusion indicators in long layout, 2020-2024.',
  'upload_demo_2025_extension.csv': 'Jan-Jun 2025 continuation of the first file — use this for the live upload demonstration.',
  'upload_demo_2025_extension.xlsx': 'Same continuation data as an Excel workbook (tests .xlsx upload).',
};

const sampleFiles = () =>
  fs.readdirSync(config.sampleDir).filter((f) => /\.(csv|xlsx)$/i.test(f)).sort();

router.get(
  '/system/samples',
  authenticate,
  requirePermission('datasets.view'),
  wrap(async (_req, res) => {
    ok(res, {
      label: 'SYNTHETIC DEMONSTRATION DATA — NOT OFFICIAL INSTITUTIONAL DATA.',
      files: sampleFiles().map((f) => ({
        name: f,
        size: fs.statSync(path.join(config.sampleDir, f)).size,
        description: SAMPLE_NOTES[f] || 'Synthetic sample dataset.',
      })),
    });
  })
);

router.get(
  '/system/samples/:name',
  authenticate,
  requirePermission('datasets.view'),
  wrap(async (req, res) => {
    const file = sampleFiles().find((f) => f === req.params.name); // whitelist: no path traversal possible
    if (!file) throw new AppError(404, 'Sample file not found.');
    res.download(path.join(config.sampleDir, file), file);
  })
);

// ---------------------------------------------------------------- demo reset
router.post(
  '/system/demo/reset',
  authenticate,
  requirePermission('system.manage'),
  wrap(async (req, res) => {
    if (req.body.confirm !== true) throw new AppError(400, 'Send {"confirm": true} to reset the demonstration data.');
    if (!config.demoPassword) throw new AppError(503, 'DEMO_PASSWORD is not configured on the server.');
    await audit(req, 'DEMO_RESET_STARTED', 'system');
    const summary = await demo.resetAndLoad({
      baseUrl: `http://127.0.0.1:${req.socket.localPort}`,
      password: config.demoPassword,
    });
    await audit(req, 'DEMO_RESET_COMPLETED', 'system', null, summary);
    ok(res, summary);
  })
);

module.exports = router;
