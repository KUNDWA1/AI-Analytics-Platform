const express = require('express');
const db = require('../db');
const { AppError, ok, wrap } = require('../errors');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { runAnalytics } = require('../services/python');
const S = require('../services/series');
const v = require('../validate');

const router = express.Router();
router.use(authenticate);

router.get(
  '/overview',
  requirePermission('analytics.view'),
  wrap(async (_req, res) => {
    const q = await Promise.all([
      db.query(`SELECT count(*)::int n FROM indicators WHERE is_active`),
      db.query(`SELECT count(*)::int n FROM datasets WHERE status = 'processed'`),
      db.query(`SELECT count(*)::int n FROM trend_analyses`),
      db.query(`SELECT count(*)::int n FROM forecasts`),
      db.query(`SELECT count(*)::int n FROM anomaly_results`),
      db.query(`SELECT min(period) AS first, max(period) AS last FROM effective_observations`),
    ]);
    ok(res, {
      indicators: q[0].rows[0].n, processed_datasets: q[1].rows[0].n, trend_analyses: q[2].rows[0].n,
      forecasts: q[3].rows[0].n, anomalies: q[4].rows[0].n, period_start: q[5].rows[0].first, period_end: q[5].rows[0].last,
    });
  })
);

function seriesInput(body) {
  const indicator_id = v.int(body.indicator_id, 'indicator_id', { min: 1 });
  const area = body.area ? v.str(body.area, 'area', { max: 80 }) : S.NATIONAL;
  return { indicator_id, area, filters: S.parseFilters({ from: body.from, to: body.to }) };
}

// ------------------------------------------------------------------ trends
router.post(
  '/trends',
  requirePermission('analytics.view'),
  wrap(async (req, res) => {
    const { indicator_id, area, filters } = seriesInput(req.body);
    const ind = await S.getIndicator(indicator_id);
    const { points, is_synthetic } = await S.getPoints(indicator_id, area, filters);
    if (!points.length) throw new AppError(404, 'No processed observations exist for this indicator/area.');
    const result = await runAnalytics('trend', { points, name: ind.name, unit: ind.unit });
    result.indicator = { id: ind.id, name: ind.name, category: ind.category, unit: ind.unit };
    result.area = area === S.NATIONAL ? 'All areas (national)' : area;
    result.is_synthetic = is_synthetic;
    await db.query(`INSERT INTO trend_analyses (indicator_id, area, params, result, created_by) VALUES ($1,$2,$3,$4,$5)`, [
      indicator_id, result.area, JSON.stringify({ area, ...filters }),
      JSON.stringify({ statistics: result.statistics, summary: result.summary, frequency: result.frequency, is_synthetic }), req.user.id,
    ]);
    await audit(req, 'TREND_ANALYSIS_RUN', 'indicator', indicator_id, { area });
    ok(res, result);
  })
);

router.post(
  '/compare',
  requirePermission('analytics.view'),
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body.indicator_ids) ? req.body.indicator_ids.map(Number).filter(Number.isInteger) : [];
    if (ids.length < 2 || ids.length > 6) throw new AppError(400, 'Select between 2 and 6 indicators to compare.');
    const area = req.body.area ? v.str(req.body.area, 'area', { max: 80 }) : S.NATIONAL;
    const series = [];
    for (const id of ids) {
      const ind = await S.getIndicator(id);
      const { points } = await S.getPoints(id, area);
      if (points.length) series.push({ label: ind.name, points });
    }
    if (series.length < 2) throw new AppError(422, 'At least two of the selected indicators need processed data.');
    const out = await runAnalytics('compare', { series });
    ok(res, { ...out, area: area === S.NATIONAL ? 'All areas (national)' : area });
  })
);

router.post(
  '/regions',
  requirePermission('analytics.view'),
  wrap(async (req, res) => {
    const indicator_id = v.int(req.body.indicator_id, 'indicator_id', { min: 1 });
    const ind = await S.getIndicator(indicator_id);
    const rows = await S.seriesRows({}, { indicatorIds: [indicator_id] });
    // need per-area rows
    const areas = (await S.listAreas(indicator_id)).filter((a) => a !== 'National');
    if (areas.length < 2) throw new AppError(422, 'Regional comparison needs data for at least two geographic areas.');
    const byArea = {};
    for (const a of areas) byArea[a] = (await S.getPoints(indicator_id, a)).points;
    const out = await runAnalytics('regions', { areas: byArea });
    ok(res, { indicator: { id: ind.id, name: ind.name, unit: ind.unit }, ...out, n_national_points: rows.length });
  })
);

// ------------------------------------------------------------------ forecast
router.post(
  '/forecast',
  requirePermission('analytics.run'),
  wrap(async (req, res) => {
    const { indicator_id, area } = seriesInput(req.body);
    const horizon = v.int(req.body.horizon ?? 6, 'horizon', { min: 1, max: 36 });
    const ind = await S.getIndicator(indicator_id);
    const { points, is_synthetic } = await S.getPoints(indicator_id, area);
    if (!points.length) throw new AppError(404, 'No processed observations exist for this indicator/area.');
    const result = await runAnalytics('forecast', { points, horizon });
    result.indicator = { id: ind.id, name: ind.name, category: ind.category, unit: ind.unit };
    result.area = area === S.NATIONAL ? 'All areas (national)' : area;
    result.is_synthetic = is_synthetic;
    if (is_synthetic) result.data_notice = 'SYNTHETIC DEMONSTRATION DATA — NOT OFFICIAL INSTITUTIONAL DATA.';
    if (result.status === 'ok') {
      const saved = await db.query(
        `INSERT INTO forecasts (indicator_id, area, horizon, method, result, is_synthetic, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
        [indicator_id, result.area, horizon, result.method, JSON.stringify(result), is_synthetic, req.user.id]
      );
      result.id = saved.rows[0].id;
      result.created_at = saved.rows[0].created_at;
    }
    await audit(req, 'FORECAST_RUN', 'indicator', indicator_id, { area, horizon, status: result.status, method: result.method });
    ok(res, result);
  })
);

router.get(
  '/forecasts',
  requirePermission('analytics.view'),
  wrap(async (req, res) => {
    const vals = [];
    let where = '';
    if (req.query.indicator_id) {
      vals.push(v.int(req.query.indicator_id, 'indicator_id', { min: 1 }));
      where = 'WHERE f.indicator_id = $1';
    }
    const { rows } = await db.query(
      `SELECT f.id, f.indicator_id, i.name AS indicator_name, f.area, f.horizon, f.method, f.is_synthetic, f.created_at,
              f.result->'evaluation'->'selected' AS selected, u.full_name AS created_by_name, f.result
       FROM forecasts f JOIN indicators i ON i.id = f.indicator_id LEFT JOIN users u ON u.id = f.created_by
       ${where} ORDER BY f.id DESC LIMIT 30`,
      vals
    );
    ok(res, rows);
  })
);

// ------------------------------------------------------------------ anomalies
router.post(
  '/anomalies',
  requirePermission('analytics.run'),
  wrap(async (req, res) => {
    const method = v.oneOf(req.body.method || 'both', 'method', ['both', 'zscore', 'isolation_forest']);
    const threshold = Number(req.body.threshold ?? 3);
    if (!(threshold >= 2 && threshold <= 6)) throw new AppError(400, 'Threshold must be between 2 and 6.');

    let indicatorIds = null;
    if (req.body.dataset_id) {
      const dsId = v.int(req.body.dataset_id, 'dataset_id', { min: 1 });
      const d = await db.query(`SELECT status FROM datasets WHERE id = $1`, [dsId]);
      if (!d.rows[0]) throw new AppError(404, 'Dataset not found.');
      if (d.rows[0].status !== 'processed') throw new AppError(409, 'The dataset must be processed before anomaly detection.');
      const r = await db.query(`SELECT DISTINCT indicator_id FROM observations WHERE dataset_id = $1`, [dsId]);
      indicatorIds = r.rows.map((x) => x.indicator_id);
    } else if (Array.isArray(req.body.indicator_ids) && req.body.indicator_ids.length) {
      indicatorIds = req.body.indicator_ids.map(Number).filter(Number.isInteger);
    }

    const { rows } = await db.query(
      `SELECT e.indicator_id, i.name, i.unit, e.geographic_area AS area, e.period, e.value, e.is_synthetic
       FROM effective_observations e JOIN indicators i ON i.id = e.indicator_id
       WHERE i.is_active ${indicatorIds ? 'AND e.indicator_id = ANY($1)' : ''}
       ORDER BY e.indicator_id, e.geographic_area, e.period`,
      indicatorIds ? [indicatorIds] : []
    );
    if (!rows.length) throw new AppError(404, 'No processed observations are available for anomaly detection.');

    const map = new Map();
    for (const r of rows) {
      const k = `${r.indicator_id}|${r.area}`;
      if (!map.has(k)) map.set(k, { indicator_id: r.indicator_id, indicator_name: r.name, unit: r.unit, area: r.area, points: [], synthetic: false });
      const s = map.get(k);
      s.points.push({ period: r.period, value: r.value });
      s.synthetic = s.synthetic || r.is_synthetic;
    }
    const series = [...map.values()];
    const synth = Object.fromEntries(series.map((s) => [`${s.indicator_id}|${s.area}`, s.synthetic]));

    const result = await runAnalytics('anomalies', {
      series: series.map(({ synthetic, ...s }) => s), method, threshold,
    }, 180000);

    let created = 0;
    await db.tx(async (c) => {
      for (const a of result.anomalies) {
        const r = await c.query(
          `INSERT INTO anomaly_results (indicator_id, dataset_id, geographic_area, period, observed_value, expected_value,
              anomaly_score, severity, direction, method, explanation, is_synthetic, detected_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
           ON CONFLICT (indicator_id, geographic_area, period) DO UPDATE SET
              observed_value = EXCLUDED.observed_value, expected_value = EXCLUDED.expected_value,
              anomaly_score = EXCLUDED.anomaly_score, severity = EXCLUDED.severity, direction = EXCLUDED.direction,
              method = EXCLUDED.method, explanation = EXCLUDED.explanation, detected_at = now()
           RETURNING id, (xmax = 0) AS inserted`,
          [a.indicator_id, req.body.dataset_id || null, a.area, a.period, a.observed_value, a.expected_value, a.anomaly_score,
           a.severity, a.direction, a.method, a.explanation, synth[`${a.indicator_id}|${a.area}`] || false]
        );
        const al = await c.query(`INSERT INTO alerts (anomaly_id) VALUES ($1) ON CONFLICT (anomaly_id) DO NOTHING`, [r.rows[0].id]);
        if (al.rowCount) created += 1;
      }
    });
    await audit(req, 'ANOMALY_DETECTION_RUN', 'analysis', null, {
      method, threshold, series: series.length, detected: result.anomalies.length, new_alerts: created,
    });
    ok(res, {
      series_analysed: result.series_summary.filter((s) => s.status === 'analysed').length,
      series_skipped: result.series_summary.filter((s) => s.status === 'skipped'),
      detected: result.anomalies.length, new_alerts: created,
      by_severity: ['high', 'medium', 'low'].reduce((o, k) => ({ ...o, [k]: result.anomalies.filter((a) => a.severity === k).length }), {}),
      parameters: result.parameters, evaluation_note: result.evaluation_note, disclaimer: result.disclaimer,
    });
  })
);

module.exports = router;
