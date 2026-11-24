// Builds dashboard payloads strictly from stored, processed observations (no hardcoded statistics).
const fs = require('fs');
const { spawnSync } = require('child_process');
const db = require('../db');
const { config } = require('../config');
const S = require('./series');

const addMonths = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const pct = (a, b) => (b !== null && b !== undefined && Math.abs(b) > 1e-12 ? ((a - b) / Math.abs(b)) * 100 : null);

function group(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.indicator_id)) m.set(r.indicator_id, { id: r.indicator_id, code: r.code, name: r.name, category: r.category, unit: r.unit, points: [], synthetic: false });
    const g = m.get(r.indicator_id);
    g.points.push({ period: r.period, value: r.value });
    g.synthetic = g.synthetic || r.is_synthetic;
  }
  return [...m.values()];
}

function sumByPeriod(inds) {
  const t = new Map();
  for (const i of inds) for (const p of i.points) t.set(p.period, (t.get(p.period) || 0) + p.value);
  return [...t.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function pivot(inds, keyFn) {
  const rows = new Map();
  const keys = new Set();
  for (const i of inds) {
    const k = keyFn(i);
    keys.add(k);
    for (const p of i.points) {
      if (!rows.has(p.period)) rows.set(p.period, { period: p.period });
      const r = rows.get(p.period);
      r[k] = (r[k] || 0) + p.value;
    }
  }
  return { keys: [...keys], rows: [...rows.values()].sort((a, b) => (a.period < b.period ? -1 : 1)) };
}

function latestChange(points) {
  if (!points.length) return null;
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const yAgo = points.find((p) => p.period === addMonths(last.period, -12));
  return {
    latest: last.value, period: last.period,
    mom: prev ? pct(last.value, prev.value) : null,
    yoy: yAgo ? pct(last.value, yAgo.value) : null,
    yoy_abs: yAgo ? last.value - yAgo.value : null,
  };
}

async function openAlertCounts(filters) {
  const vals = [];
  const where = [`a.status IN ('new','under_review')`];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (filters.area) add('r.geographic_area = ?', filters.area);
  if (filters.category) add('i.category = ?', filters.category);
  if (filters.from) add('r.period >= ?', filters.from);
  if (filters.to) add('r.period <= ?', filters.to);
  const { rows } = await db.query(
    `SELECT r.severity, count(*)::int n FROM alerts a JOIN anomaly_results r ON r.id = a.anomaly_id
     JOIN indicators i ON i.id = r.indicator_id WHERE ${where.join(' AND ')} GROUP BY r.severity`,
    vals
  );
  const by = { high: 0, medium: 0, low: 0 };
  rows.forEach((r) => (by[r.severity] = r.n));
  const recent = await db.query(
    `SELECT a.id, a.status, i.name AS indicator_name, r.geographic_area AS area, r.period, r.severity, r.anomaly_score,
            r.direction, r.observed_value, r.expected_value
     FROM alerts a JOIN anomaly_results r ON r.id = a.anomaly_id JOIN indicators i ON i.id = r.indicator_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.period DESC LIMIT 6`,
    vals
  );
  return { open: by.high + by.medium + by.low, by_severity: by, recent: recent.rows };
}

async function regional(filters, volIds) {
  if (!volIds.length) return null;
  const vals = [volIds];
  const where = ['e.indicator_id = ANY($1)', `e.geographic_area <> 'National'`];
  if (filters.source) { vals.push(filters.source); where.push(`e.data_source_id = $${vals.length}`); }
  if (filters.to) { vals.push(filters.to); where.push(`e.period <= $${vals.length}`); }
  if (filters.from) { vals.push(filters.from); where.push(`e.period >= $${vals.length}`); }
  const { rows } = await db.query(
    `SELECT e.geographic_area AS area, e.period, sum(e.value) AS value FROM effective_observations e
     WHERE ${where.join(' AND ')} GROUP BY 1,2 ORDER BY 1,2`,
    vals
  );
  if (!rows.length) return null;
  const areas = {};
  rows.forEach((r) => (areas[r.area] = areas[r.area] || []).push({ period: r.period, value: r.value }));
  if (Object.keys(areas).length < 2) return null;
  const maxP = rows.reduce((m, r) => (r.period > m ? r.period : m), '');
  const start = addMonths(maxP, -11);
  const out = Object.entries(areas).map(([area, pts]) => {
    const last12 = pts.filter((p) => p.period >= start && p.period <= maxP);
    const prev12 = pts.filter((p) => p.period >= addMonths(start, -12) && p.period < start);
    const a = last12.reduce((s, p) => s + p.value, 0);
    const b = prev12.reduce((s, p) => s + p.value, 0);
    return { area, volume: a, growth_pct: prev12.length === last12.length && b ? pct(a, b) : null };
  });
  out.sort((x, y) => y.volume - x.volume);
  const total = out.reduce((s, r) => s + r.volume, 0);
  out.forEach((r) => (r.share_pct = total ? (r.volume / total) * 100 : null));
  return { window: [start, maxP], rows: out };
}

async function buildOverview(filters) {
  const rows = await S.seriesRows(filters);
  const inds = group(rows);
  const vol = inds.filter((i) => /volume/.test(i.code));
  const val = inds.filter((i) => /transaction_value|_value$/.test(i.code));
  const incl = inds.filter((i) => i.category === 'Financial Inclusion');
  const kpis = [];

  const totalVol = sumByPeriod(vol);
  if (totalVol.length) {
    const sum = totalVol.reduce((s, [, v]) => s + v, 0);
    const lc = latestChange(totalVol.map(([period, value]) => ({ period, value })));
    kpis.push({ key: 'total_volume', label: 'Total reported transaction volume', value: sum, unit: 'transactions',
      sub: `${totalVol[0][0].slice(0, 7)} → ${totalVol[totalVol.length - 1][0].slice(0, 7)}`, change_pct: lc.yoy, change_label: 'latest month vs same month last year' });
    if (totalVol.length >= 24) {
      const arr = totalVol.map((x) => x[1]);
      const a = arr.slice(-12).reduce((s, x) => s + x, 0);
      const b = arr.slice(-24, -12).reduce((s, x) => s + x, 0);
      kpis.push({ key: 'growth', label: 'Digital financial activity growth', value: pct(a, b), unit: '%', sub: 'last 12 months vs previous 12 months (volume)', is_pct: true });
    } else if (lc.yoy !== null) {
      kpis.push({ key: 'growth', label: 'Digital financial activity growth', value: lc.yoy, unit: '%', sub: 'latest month vs same month last year (volume)', is_pct: true });
    }
  }
  const totalVal = sumByPeriod(val);
  if (totalVal.length) {
    const units = [...new Set(val.map((i) => i.unit).filter(Boolean))];
    kpis.push({ key: 'total_value', label: 'Total reported transaction value', value: totalVal.reduce((s, [, v]) => s + v, 0),
      unit: units.length === 1 ? units[0] : 'as reported', sub: 'sum over selected period' });
  }
  for (const [cat, key, label] of [['Digital Payments', 'digital_payments', 'Digital payments – latest month volume'], ['Mobile Money', 'mobile_money', 'Mobile money – latest month volume']]) {
    const sub = vol.filter((i) => i.category === cat);
    if (sub.length) {
      const lc = latestChange(sumByPeriod(sub).map(([period, value]) => ({ period, value })));
      kpis.push({ key, label, value: lc.latest, unit: 'transactions', sub: lc.period.slice(0, 7), change_pct: lc.mom, change_label: 'vs previous month' });
    }
  }
  if (incl.length) {
    const i = incl.find((x) => x.unit === '%') || incl[0];
    const lc = latestChange(i.points);
    kpis.push({ key: 'inclusion', label: i.name, value: lc.latest, unit: i.unit || '', sub: `as of ${lc.period.slice(0, 7)}`,
      change_abs: lc.yoy_abs, change_label: 'change vs 12 months earlier', is_pct: i.unit === '%' });
  }
  kpis.push({ key: 'indicators', label: 'Monitored indicators', value: inds.length, unit: '', sub: 'with data in the selected range' });
  const alerts = await openAlertCounts(filters);
  kpis.push({ key: 'anomalies', label: 'Open anomaly alerts', value: alerts.open, unit: '', sub: `${alerts.by_severity.high} high · ${alerts.by_severity.medium} medium · ${alerts.by_severity.low} low` });

  const volTrend = pivot(vol, (i) => i.category);
  const valTrend = pivot(val, (i) => i.category);
  const inclTrend = pivot(incl, (i) => i.name);
  const snapshot = inds.map((i) => ({ id: i.id, name: i.name, category: i.category, unit: i.unit, ...latestChange(i.points),
    spark: i.points.slice(-12).map((p) => p.value), synthetic: i.synthetic }));

  return {
    has_data: inds.length > 0,
    is_synthetic: inds.some((i) => i.synthetic),
    area_label: filters.area || 'All areas (national)',
    kpis,
    charts: { volume_trend: volTrend, value_trend: valTrend, inclusion_trend: inclTrend,
      regional: await regional({ ...filters, area: undefined }, vol.map((i) => i.id)) },
    snapshot,
    anomalies: alerts,
  };
}

async function recentActivity(limit = 8) {
  const { rows } = await db.query(
    `SELECT action, entity_type, entity_id, user_email, created_at, details FROM audit_logs
     WHERE action ~ '^(DATASET|TREND|FORECAST|ANOMALY|REPORT|ALERT|DEMO)' ORDER BY id DESC LIMIT $1`, [limit]
  );
  return rows;
}

async function analystExtras() {
  const [ds, jobs, fc] = await Promise.all([
    db.query(`SELECT status, count(*)::int n FROM datasets GROUP BY status`),
    db.query(`SELECT j.id, d.name AS dataset_name, j.status, j.finished_at, j.summary FROM processing_jobs j JOIN datasets d ON d.id = j.dataset_id ORDER BY j.id DESC LIMIT 5`),
    db.query(`SELECT f.id, i.name AS indicator_name, f.area, f.method, f.created_at, f.is_synthetic,
                     f.result->'evaluation'->'selected'->>'mape_pct' AS mape, f.result->'evaluation'->'selected'->>'rmse' AS rmse,
                     f.result->'evaluation'->>'beats_naive_benchmark' AS beats_naive
              FROM forecasts f JOIN indicators i ON i.id = f.indicator_id ORDER BY f.id DESC LIMIT 6`),
  ]);
  return { dataset_status: Object.fromEntries(ds.rows.map((r) => [r.status, r.n])), recent_jobs: jobs.rows, model_evaluation: fc.rows };
}

async function adminExtras() {
  const [users, logins, counts] = await Promise.all([
    db.query(`SELECT r.label AS role, count(*)::int n FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active GROUP BY r.label ORDER BY 1`),
    db.query(`SELECT full_name, email, last_login FROM users WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 5`),
    db.query(`SELECT (SELECT count(*) FROM datasets)::int AS datasets, (SELECT count(*) FROM observations)::int AS observations,
                     (SELECT count(*) FROM audit_logs)::int AS audit_events, (SELECT count(*) FROM sessions WHERE NOT revoked AND expires_at > now())::int AS active_sessions`),
  ]);
  const py = spawnSync(config.pythonBin, ['-I', '-c', 'import pandas, numpy, sklearn, openpyxl'], { timeout: 20000 });
  let uploadsWritable = true;
  try { fs.accessSync(config.uploadDir, fs.constants.W_OK); } catch { uploadsWritable = false; }
  return {
    users_by_role: users.rows, recent_logins: logins.rows, totals: counts.rows[0],
    health: [
      { name: 'PostgreSQL database', ok: true, detail: 'Connected' },
      { name: 'Python analytics engine', ok: py.status === 0, detail: py.status === 0 ? 'pandas, NumPy, scikit-learn, openpyxl available' : 'Python libraries missing — run pip install -r analytics/requirements.txt' },
      { name: 'Upload storage', ok: uploadsWritable, detail: uploadsWritable ? 'Writable' : 'Not writable' },
    ],
  };
}

async function managementExtras(snapshot) {
  const ranked = snapshot.filter((s) => s.yoy !== null && s.yoy !== undefined).sort((a, b) => b.yoy - a.yoy);
  const reports = await db.query(`SELECT id, title, created_at FROM reports ORDER BY id DESC LIMIT 5`);
  return { top_growth: ranked.slice(0, 5), lowest_growth: ranked.slice(-3).reverse(), recent_reports: reports.rows };
}

async function filterOptions() {
  const [areas, cats, sources, range] = await Promise.all([
    S.listAreas(),
    db.query(`SELECT DISTINCT i.category FROM indicators i WHERE EXISTS (SELECT 1 FROM effective_observations e WHERE e.indicator_id = i.id) ORDER BY 1`),
    db.query(`SELECT id, name FROM data_sources WHERE id IN (SELECT DISTINCT data_source_id FROM effective_observations WHERE data_source_id IS NOT NULL) ORDER BY name`),
    db.query(`SELECT min(period) AS min, max(period) AS max FROM effective_observations`),
  ]);
  return { areas: areas.filter((a) => a !== 'National'), categories: cats.rows.map((r) => r.category), sources: sources.rows, period_range: range.rows[0] };
}

module.exports = { buildOverview, recentActivity, analystExtras, adminExtras, managementExtras, filterOptions, group, pivot, sumByPeriod, latestChange };
