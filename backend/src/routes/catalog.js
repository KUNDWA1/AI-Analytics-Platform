// Data sources + indicators (metadata catalog)
const express = require('express');
const db = require('../db');
const { AppError, ok, wrap } = require('../errors');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const v = require('../validate');

const sources = express.Router();
sources.use(authenticate);

sources.get(
  '/',
  requirePermission('sources.view'),
  wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT s.*, (SELECT count(*)::int FROM datasets d WHERE d.data_source_id = s.id AND d.status <> 'archived') AS dataset_count
       FROM data_sources s ORDER BY s.id`
    );
    ok(res, rows);
  })
);

function parseSource(body) {
  const url = v.str(body.url, 'URL', { max: 300, optional: true });
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new AppError(400, 'URL must start with http:// or https://');
  return {
    name: v.str(body.name, 'Name', { max: 150 }),
    organization: v.str(body.organization, 'Organization', { max: 150, optional: true }),
    url,
    description: v.str(body.description, 'Description', { max: 1000, optional: true }),
    source_type: v.oneOf(body.source_type || 'public', 'Source type', ['public', 'manual', 'synthetic']),
  };
}

sources.post(
  '/',
  requirePermission('sources.manage'),
  wrap(async (req, res) => {
    const s = parseSource(req.body);
    const { rows } = await db.query(
      `INSERT INTO data_sources (name, organization, url, description, source_type) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [s.name, s.organization, s.url, s.description, s.source_type]
    );
    await audit(req, 'SOURCE_CREATED', 'data_source', rows[0].id, { name: s.name });
    ok(res, rows[0], 201);
  })
);

sources.put(
  '/:id',
  requirePermission('sources.manage'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = parseSource(req.body);
    const active = req.body.is_active === undefined ? true : Boolean(req.body.is_active);
    const { rows } = await db.query(
      `UPDATE data_sources SET name=$2, organization=$3, url=$4, description=$5, source_type=$6, is_active=$7 WHERE id=$1 RETURNING *`,
      [id, s.name, s.organization, s.url, s.description, s.source_type, active]
    );
    if (!rows[0]) throw new AppError(404, 'Data source not found.');
    await audit(req, 'SOURCE_UPDATED', 'data_source', id, { name: s.name });
    ok(res, rows[0]);
  })
);

// ------------------------------------------------------------------ indicators
const indicators = express.Router();
indicators.use(authenticate);

indicators.get(
  '/',
  requirePermission('indicators.view'),
  wrap(async (req, res) => {
    const vals = [];
    let where = '';
    if (req.query.category) { vals.push(req.query.category); where = `WHERE i.category = $1`; }
    const { rows } = await db.query(
      `SELECT i.*, s.n_points, s.first_period, s.last_period, s.has_synthetic, s.n_areas
       FROM indicators i
       LEFT JOIN (SELECT indicator_id, count(*)::int AS n_points, min(period) AS first_period, max(period) AS last_period,
                         bool_or(is_synthetic) AS has_synthetic, count(DISTINCT geographic_area)::int AS n_areas
                  FROM effective_observations GROUP BY indicator_id) s ON s.indicator_id = i.id
       ${where} ORDER BY i.category, i.name`,
      vals
    );
    ok(res, rows);
  })
);

indicators.put(
  '/:id',
  requirePermission('indicators.manage'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const name = v.str(req.body.name, 'Name', { max: 150 });
    const category = v.str(req.body.category, 'Category', { max: 80 });
    const unit = v.str(req.body.unit, 'Unit', { max: 40, optional: true });
    const description = v.str(req.body.description, 'Description', { max: 500, optional: true });
    const is_active = req.body.is_active === undefined ? true : Boolean(req.body.is_active);
    const { rows } = await db.query(
      `UPDATE indicators SET name=$2, category=$3, unit=$4, description=$5, is_active=$6 WHERE id=$1 RETURNING *`,
      [id, name, category, unit, description, is_active]
    );
    if (!rows[0]) throw new AppError(404, 'Indicator not found.');
    await audit(req, 'INDICATOR_UPDATED', 'indicator', id, { name, unit, is_active });
    ok(res, rows[0]);
  })
);

indicators.post(
  '/',
  requirePermission('indicators.manage'),
  wrap(async (req, res) => {
    const name = v.str(req.body.name, 'Name', { max: 150 });
    const code = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
    const category = v.str(req.body.category, 'Category', { max: 80 });
    const unit = v.str(req.body.unit, 'Unit', { max: 40, optional: true });
    const description = v.str(req.body.description, 'Description', { max: 500, optional: true });
    const { rows } = await db.query(
      `INSERT INTO indicators (code, name, category, unit, description) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, category, unit, description]
    );
    await audit(req, 'INDICATOR_CREATED', 'indicator', rows[0].id, { name });
    ok(res, rows[0], 201);
  })
);

module.exports = { sources, indicators };
