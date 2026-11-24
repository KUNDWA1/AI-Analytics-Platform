// Data access helpers for time series built from stored (processed) observations.
const db = require('../db');
const { AppError } = require('../errors');

const NATIONAL = 'ALL';

/** Parse dashboard/analysis filters from a query/body object. */
function parseFilters(src = {}) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const f = {};
  for (const k of ['from', 'to']) {
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    if (typeof src[k] !== 'string' || !re.test(src[k]) || isNaN(Date.parse(src[k]))) {
      throw new AppError(400, `${k} must be a date in YYYY-MM-DD format.`);
    }
    f[k] = src[k];
  }
  if (f.from && f.to && f.from > f.to) throw new AppError(400, 'from must not be after to.');
  if (src.category) f.category = String(src.category).slice(0, 80);
  if (src.area && src.area !== NATIONAL) f.area = String(src.area).slice(0, 80);
  if (src.source) {
    const n = parseInt(src.source, 10);
    if (Number.isInteger(n)) f.source = n;
  }
  return f;
}

/**
 * Rows (indicator_id, code, name, category, unit, period, value, is_synthetic) honouring filters.
 * Without an area filter the national aggregate is used; with one, that area's observations.
 */
async function seriesRows(filters = {}, { indicatorIds = null } = {}) {
  const vals = [];
  const where = ['i.is_active = TRUE'];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  const from = filters.area ? 'effective_observations e' : 'national_series e';
  if (filters.area) add('e.geographic_area = ?', filters.area);
  if (filters.from) add('e.period >= ?', filters.from);
  if (filters.to) add('e.period <= ?', filters.to);
  if (filters.category) add('i.category = ?', filters.category);
  if (filters.source) add('e.data_source_id = ?', filters.source);
  if (indicatorIds) add('e.indicator_id = ANY(?)', indicatorIds);
  const { rows } = await db.query(
    `SELECT e.indicator_id, i.code, i.name, i.category, i.unit, e.period, e.value, e.is_synthetic
     FROM ${from} JOIN indicators i ON i.id = e.indicator_id
     WHERE ${where.join(' AND ')} ORDER BY e.indicator_id, e.period`,
    vals
  );
  return rows;
}

async function getIndicator(id) {
  const { rows } = await db.query('SELECT * FROM indicators WHERE id = $1', [id]);
  if (!rows[0]) throw new AppError(404, 'Indicator not found.');
  return rows[0];
}

/** Points for one indicator. area = 'ALL' -> national aggregate. */
async function getPoints(indicatorId, area = NATIONAL, filters = {}) {
  const rows = await seriesRows({ ...filters, area: area && area !== NATIONAL ? area : undefined }, { indicatorIds: [indicatorId] });
  return {
    points: rows.map((r) => ({ period: r.period, value: r.value })),
    is_synthetic: rows.some((r) => r.is_synthetic),
  };
}

async function listAreas(indicatorId = null) {
  const { rows } = await db.query(
    `SELECT DISTINCT geographic_area FROM effective_observations ${indicatorId ? 'WHERE indicator_id = $1' : ''} ORDER BY 1`,
    indicatorId ? [indicatorId] : []
  );
  return rows.map((r) => r.geographic_area);
}

module.exports = { NATIONAL, parseFilters, seriesRows, getIndicator, getPoints, listAreas };
