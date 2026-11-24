const express = require('express');
const db = require('../db');
const { AppError, ok, wrap } = require('../errors');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const S = require('../services/series');
const v = require('../validate');

const router = express.Router();
router.use(authenticate, requirePermission('alerts.view'));

const BASE = `
  SELECT a.id, a.status, a.analyst_note, a.reviewed_at, a.created_at, ru.full_name AS reviewed_by_name,
         r.id AS anomaly_id, r.indicator_id, i.name AS indicator_name, i.category, i.unit, r.geographic_area AS area, r.period,
         r.observed_value, r.expected_value, r.anomaly_score, r.severity, r.direction, r.method, r.explanation,
         r.is_synthetic, r.detected_at
  FROM alerts a
  JOIN anomaly_results r ON r.id = a.anomaly_id
  JOIN indicators i ON i.id = r.indicator_id
  LEFT JOIN users ru ON ru.id = a.reviewed_by`;

router.get(
  '/',
  wrap(async (req, res) => {
    const where = [];
    const vals = [];
    const add = (sql, val) => { vals.push(val); where.push(sql.replaceAll('?', `$${vals.length}`)); };
    if (req.query.status) add('a.status = ?', v.oneOf(req.query.status, 'status', ['new', 'under_review', 'reviewed', 'dismissed']));
    if (req.query.severity) add('r.severity = ?', v.oneOf(req.query.severity, 'severity', ['low', 'medium', 'high']));
    if (req.query.indicator_id) add('r.indicator_id = ?', v.int(req.query.indicator_id, 'indicator_id', { min: 1 }));
    if (req.query.area) add('r.geographic_area = ?', String(req.query.area).slice(0, 80));
    if (req.query.category) add('i.category = ?', String(req.query.category).slice(0, 80));
    if (req.query.from) add('r.period >= ?', v.dateStr(req.query.from, 'from'));
    if (req.query.to) add('r.period <= ?', v.dateStr(req.query.to, 'to'));
    if (req.query.q) add('(i.name ILIKE ? OR r.explanation ILIKE ?)', `%${String(req.query.q).slice(0, 80)}%`);
    const sql = `${BASE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.period DESC, r.anomaly_score DESC
                 LIMIT 500`;
    const { rows } = await db.query(sql, vals);
    ok(res, rows);
  })
);

router.get(
  '/summary',
  wrap(async (_req, res) => {
    const sev = await db.query(
      `SELECT r.severity, count(*)::int n FROM alerts a JOIN anomaly_results r ON r.id = a.anomaly_id
       WHERE a.status IN ('new','under_review') GROUP BY r.severity`
    );
    const st = await db.query(`SELECT status, count(*)::int n FROM alerts GROUP BY status`);
    const total = await db.query(`SELECT count(*)::int n FROM alerts`);
    ok(res, {
      open_by_severity: Object.fromEntries(sev.rows.map((r) => [r.severity, r.n])),
      by_status: Object.fromEntries(st.rows.map((r) => [r.status, r.n])),
      total: total.rows[0].n,
    });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows } = await db.query(`${BASE} WHERE a.id = $1`, [id]);
    if (!rows[0]) throw new AppError(404, 'Alert not found.');
    const al = rows[0];
    const { points } = await S.getPoints(al.indicator_id, al.area);
    const sibling = await db.query(
      `SELECT a.id, r.period, r.severity, a.status FROM alerts a JOIN anomaly_results r ON r.id = a.anomaly_id
       WHERE r.indicator_id = $1 AND r.geographic_area = $2 ORDER BY r.period`,
      [al.indicator_id, al.area]
    );
    ok(res, { ...al, series: points, related_alerts: sibling.rows });
  })
);

router.patch(
  '/:id',
  requirePermission('alerts.review'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const status = req.body.status === undefined ? null : v.oneOf(req.body.status, 'status', ['new', 'under_review', 'reviewed', 'dismissed']);
    const note = req.body.analyst_note === undefined ? undefined : v.str(req.body.analyst_note, 'Note', { max: 2000, optional: true });
    if (status === null && note === undefined) throw new AppError(400, 'Provide a status and/or an analyst note.');
    const finished = status === 'reviewed' || status === 'dismissed';
    const { rows } = await db.query(
      `UPDATE alerts SET status = COALESCE($2, status),
         analyst_note = CASE WHEN $3::boolean THEN $4 ELSE analyst_note END,
         reviewed_by = CASE WHEN $5::boolean THEN $6 ELSE reviewed_by END,
         reviewed_at = CASE WHEN $5::boolean THEN now() ELSE reviewed_at END
       WHERE id = $1 RETURNING id`,
      [id, status, note !== undefined, note === undefined ? null : note, finished, req.user.id]
    );
    if (!rows[0]) throw new AppError(404, 'Alert not found.');
    await audit(req, 'ALERT_UPDATED', 'alert', id, { status, note_added: note !== undefined });
    const out = await db.query(`${BASE} WHERE a.id = $1`, [id]);
    ok(res, out.rows[0]);
  })
);

module.exports = router;
