const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { config } = require('../config');
const db = require('../db');
const { AppError, ok, wrap } = require('../errors');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const ingest = require('../services/ingest');
const v = require('../validate');

const router = express.Router();
router.use(authenticate);

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    // random server-side name: the client-supplied filename is never used as a path
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ingest.ALLOWED_EXT.includes(ext)) return cb(new AppError(415, 'Unsupported file format. Only .csv and .xlsx files are accepted.'));
    cb(null, true);
  },
});

const LIST_SQL = `
  SELECT d.id, d.name, d.description, d.category, d.status, d.is_synthetic, d.original_filename, d.file_size,
         d.record_count, d.created_at, d.processed_at, d.processing_summary,
         ds.name AS source_name, u.full_name AS uploaded_by_name,
         jsonb_array_length(d.columns) AS column_count
  FROM datasets d
  LEFT JOIN data_sources ds ON ds.id = d.data_source_id
  LEFT JOIN users u ON u.id = d.uploaded_by`;

router.get(
  '/meta',
  requirePermission('datasets.view'),
  wrap(async (_req, res) => ok(res, { categories: ingest.CATEGORIES, max_upload_mb: config.maxUploadMb }))
);

router.get(
  '/',
  requirePermission('datasets.view'),
  wrap(async (req, res) => {
    const where = [];
    const vals = [];
    if (req.query.status) { vals.push(req.query.status); where.push(`d.status = $${vals.length}`); }
    if (req.query.category) { vals.push(req.query.category); where.push(`d.category = $${vals.length}`); }
    if (req.query.q) { vals.push(`%${String(req.query.q).slice(0, 100)}%`); where.push(`(d.name ILIKE $${vals.length} OR d.original_filename ILIKE $${vals.length})`); }
    const { rows } = await db.query(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.created_at DESC`, vals);
    ok(res, rows);
  })
);

router.post(
  '/upload',
  requirePermission('datasets.upload'),
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new AppError(400, 'No file was uploaded (field name must be "file").');
    const filePath = req.file.path;
    try {
      const name = v.str(req.body.name || path.parse(req.file.originalname).name, 'Dataset name', { max: 150 });
      const category = v.oneOf(req.body.category, 'Category', ingest.CATEGORIES);
      const description = v.str(req.body.description, 'Description', { max: 1000, optional: true });
      let sourceId = null;
      if (req.body.data_source_id) {
        sourceId = v.int(req.body.data_source_id, 'Data source', { min: 1 });
        const s = await db.query('SELECT id FROM data_sources WHERE id = $1', [sourceId]);
        if (!s.rows[0]) throw new AppError(400, 'Selected data source does not exist.');
      }
      const isSynthetic = req.body.is_synthetic === undefined ? undefined : req.body.is_synthetic === 'true' || req.body.is_synthetic === true;
      const id = await ingest.registerDataset({
        filePath, originalName: req.file.originalname, userId: req.user.id, name, description, category,
        dataSourceId: sourceId, isSynthetic,
      });
      await audit(req, 'DATASET_UPLOADED', 'dataset', id, { file: req.file.originalname, size: req.file.size });
      const { rows } = await db.query(`${LIST_SQL} WHERE d.id = $1`, [id]);
      ok(res, rows[0], 201);
    } catch (e) {
      ingest.removeFile(filePath); // never keep rejected files
      throw e;
    }
  })
);

router.get(
  '/:id',
  requirePermission('datasets.view'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows } = await db.query(
      `${LIST_SQL.replace('d.processing_summary,', 'd.processing_summary, d.columns, d.column_mapping, d.validation_report, d.file_hash, d.data_source_id,')} WHERE d.id = $1`,
      [id]
    );
    if (!rows[0]) throw new AppError(404, 'Dataset not found.');
    const jobs = await db.query(
      `SELECT j.id, j.status, j.summary, j.error, j.started_at, j.finished_at, u.full_name AS started_by_name
       FROM processing_jobs j LEFT JOIN users u ON u.id = j.started_by WHERE j.dataset_id = $1 ORDER BY j.id DESC`,
      [id]
    );
    const files = await db.query(
      `SELECT f.id, f.original_name, f.file_hash, f.file_size, f.uploaded_at, u.full_name AS uploaded_by_name
       FROM dataset_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.dataset_id = $1 ORDER BY f.id DESC`,
      [id]
    );
    const obs = await db.query(
      `SELECT count(*)::int AS observations, count(DISTINCT indicator_id)::int AS indicators FROM observations WHERE dataset_id = $1`,
      [id]
    );
    ok(res, { ...rows[0], jobs: jobs.rows, files: files.rows, stored: obs.rows[0] });
  })
);

router.put(
  '/:id/mapping',
  requirePermission('datasets.process'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows } = await db.query('SELECT id, columns, status FROM datasets WHERE id = $1', [id]);
    if (!rows[0]) throw new AppError(404, 'Dataset not found.');
    if (rows[0].status === 'archived') throw new AppError(409, 'Archived datasets cannot be modified.');
    const mapping = ingest.checkMapping(req.body.mapping, rows[0].columns);
    const next = rows[0].status === 'processed' ? 'processed' : 'validated';
    await db.query(`UPDATE datasets SET column_mapping = $2, status = $3 WHERE id = $1`, [id, JSON.stringify(mapping), next]);
    await audit(req, 'DATASET_MAPPING_SAVED', 'dataset', id, { mapping });
    ok(res, { id, column_mapping: mapping });
  })
);

router.patch(
  '/:id',
  requirePermission('datasets.process'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const name = v.str(req.body.name, 'Name', { max: 150, optional: true });
    const description = v.str(req.body.description, 'Description', { max: 1000, optional: true });
    const category = req.body.category ? v.oneOf(req.body.category, 'Category', ingest.CATEGORIES) : null;
    const { rowCount } = await db.query(
      `UPDATE datasets SET name = COALESCE($2, name), description = COALESCE($3, description), category = COALESCE($4, category) WHERE id = $1`,
      [id, name, description, category]
    );
    if (!rowCount) throw new AppError(404, 'Dataset not found.');
    await audit(req, 'DATASET_METADATA_UPDATED', 'dataset', id, { name, category });
    ok(res, { id });
  })
);

router.post(
  '/:id/process',
  requirePermission('datasets.process'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows } = await db.query('SELECT * FROM datasets WHERE id = $1', [id]);
    const ds = rows[0];
    if (!ds) throw new AppError(404, 'Dataset not found.');
    if (ds.status === 'archived') throw new AppError(409, 'Archived datasets cannot be processed.');
    if (ds.status === 'processing') throw new AppError(409, 'This dataset is already being processed.');
    const summary = await ingest.processDataset(ds, req.user.id);
    await audit(req, 'DATASET_PROCESSED', 'dataset', id, {
      observations: summary.observations_created, valid: summary.valid_records, invalid: summary.invalid_records,
    });
    ok(res, summary);
  })
);

router.post(
  '/:id/archive',
  requirePermission('datasets.delete'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rowCount } = await db.query(`UPDATE datasets SET status = 'archived' WHERE id = $1`, [id]);
    if (!rowCount) throw new AppError(404, 'Dataset not found.');
    await audit(req, 'DATASET_ARCHIVED', 'dataset', id);
    ok(res, { id, status: 'archived' });
  })
);

router.delete(
  '/:id',
  requirePermission('datasets.delete'),
  wrap(async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows } = await db.query('SELECT stored_filename, name FROM datasets WHERE id = $1', [id]);
    if (!rows[0]) throw new AppError(404, 'Dataset not found.');
    await db.query('DELETE FROM datasets WHERE id = $1', [id]); // observations cascade
    ingest.removeFile(ingest.storedPath(rows[0].stored_filename));
    await audit(req, 'DATASET_DELETED', 'dataset', id, { name: rows[0].name });
    ok(res, { message: 'Dataset deleted.' });
  })
);

// processing history across all datasets (Data Processing screen)
router.get(
  '/jobs/all',
  requirePermission('datasets.view'),
  wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT j.id, j.dataset_id, d.name AS dataset_name, j.status, j.summary, j.error, j.started_at, j.finished_at,
              u.full_name AS started_by_name
       FROM processing_jobs j JOIN datasets d ON d.id = j.dataset_id LEFT JOIN users u ON u.id = j.started_by
       ORDER BY j.id DESC LIMIT 100`
    );
    ok(res, rows);
  })
);

module.exports = router;
