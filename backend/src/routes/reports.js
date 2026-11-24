const express = require('express');
const db = require('../db');
const { AppError, ok, wrap } = require('../errors');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const R = require('../services/report');
const v = require('../validate');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  requirePermission('reports.view'),
  wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT r.id, r.title, r.params, r.created_at, u.full_name AS created_by_name,
              (r.content->>'is_synthetic')::boolean AS is_synthetic,
              r.content->'period' AS period
       FROM reports r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.id DESC LIMIT 100`
    );
    ok(res, rows);
  })
);

router.post(
  '/generate',
  requirePermission('reports.generate'),
  wrap(async (req, res) => {
    const params = {
      title: v.str(req.body.title, 'Report title', { max: 160 }),
      from: req.body.from ? v.dateStr(req.body.from, 'from') : undefined,
      to: req.body.to ? v.dateStr(req.body.to, 'to') : undefined,
      area: req.body.area ? v.str(req.body.area, 'area', { max: 80 }) : undefined,
      categories: Array.isArray(req.body.categories) ? req.body.categories.map((c) => String(c).slice(0, 80)).slice(0, 12) : [],
      include_anomalies: req.body.include_anomalies !== false,
    };
    if (params.from && params.to && params.from > params.to) throw new AppError(400, 'The start date must not be after the end date.');
    const content = await R.buildContent(params, req.user);
    const { rows } = await db.query(
      `INSERT INTO reports (title, params, content, created_by) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [params.title, JSON.stringify(params), JSON.stringify(content), req.user.id]
    );
    await audit(req, 'REPORT_GENERATED', 'report', rows[0].id, { title: params.title, synthetic: content.is_synthetic });
    ok(res, { id: rows[0].id, created_at: rows[0].created_at, content }, 201);
  })
);

router.get(
  '/export/csv',
  requirePermission('reports.generate'),
  wrap(async (req, res) => {
    const out = await R.exportCsv(req.query);
    if (!out.rows) throw new AppError(404, 'No processed data matches the selected filters.');
    await audit(req, 'DATA_EXPORTED_CSV', 'export', null, { rows: out.rows, filters: req.query });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="processed_observations_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(out.csv);
  })
);

router.get(
  '/:id',
  requirePermission('reports.view'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows } = await db.query('SELECT id, title, params, content, created_at FROM reports WHERE id = $1', [id]);
    if (!rows[0]) throw new AppError(404, 'Report not found.');
    ok(res, rows[0]);
  })
);

router.get(
  '/:id/download',
  requirePermission('reports.view'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows } = await db.query('SELECT title, content FROM reports WHERE id = $1', [id]);
    if (!rows[0]) throw new AppError(404, 'Report not found.');
    await audit(req, 'REPORT_DOWNLOADED', 'report', id);
    const safe = rows[0].title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'report';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    R.renderPdf(rows[0].content).pipe(res);
  })
);

module.exports = router;
