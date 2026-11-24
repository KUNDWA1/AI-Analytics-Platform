const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { config } = require('../config');
const { AppError } = require('../errors');
const { runAnalytics } = require('./python');

const CATEGORIES = [
  'Mobile Money',
  'Digital Payments',
  'Mobile Banking',
  'Financial Inclusion',
  'Internet & Connectivity',
  'Economic Indicators',
  'Mixed / Other',
];
const ALLOWED_EXT = ['.csv', '.xlsx'];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Defence against disguised uploads: extension + magic-byte / content sanity checks. */
function assertSafeFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw new AppError(415, 'Unsupported file format. Only .csv and .xlsx files are accepted.');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8192);
  const n = fs.readSync(fd, buf, 0, 8192, 0);
  fs.closeSync(fd);
  if (n === 0) throw new AppError(422, 'The uploaded file is empty.');
  const head = buf.slice(0, n);
  if (ext === '.xlsx') {
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
      throw new AppError(422, 'The file is not a valid Excel (.xlsx) workbook.');
    }
  } else {
    if (head.includes(0x00)) throw new AppError(422, 'The file is not a valid text CSV (binary content detected).');
    const sig = head.slice(0, 4).toString('latin1');
    if (sig.startsWith('MZ') || sig.startsWith('%PDF') || sig.startsWith('PK') || sig.startsWith('\x7fELF')) {
      throw new AppError(422, 'The file content does not match a CSV file.');
    }
    const text = head.toString('utf8').trimStart().toLowerCase();
    if (text.startsWith('<?php') || text.startsWith('<script') || text.startsWith('<html')) {
      throw new AppError(422, 'The file content does not look like tabular CSV data.');
    }
  }
}

function removeFile(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

const storedPath = (stored) => path.join(config.uploadDir, path.basename(stored));

/** Validate a mapping object against the dataset's detected columns. */
function checkMapping(mapping, columns) {
  const names = new Set(columns.map((c) => c.name));
  if (!mapping || typeof mapping !== 'object') throw new AppError(400, 'A column mapping is required.');
  if (!mapping.period || !names.has(mapping.period)) throw new AppError(400, 'Select a valid period/date column.');
  if (!Array.isArray(mapping.values) || !mapping.values.length) throw new AppError(400, 'Select at least one numeric value column.');
  for (const v of mapping.values) if (!names.has(v)) throw new AppError(400, `Value column '${v}' does not exist in the file.`);
  for (const k of ['indicator', 'category', 'area', 'unit']) {
    if (mapping[k] && !names.has(mapping[k])) throw new AppError(400, `Mapped column '${mapping[k]}' does not exist in the file.`);
  }
  const overrides = {};
  if (mapping.unit_overrides && typeof mapping.unit_overrides === 'object') {
    for (const [k, val] of Object.entries(mapping.unit_overrides)) {
      if (mapping.values.includes(k) && typeof val === 'string' && val.trim()) overrides[k] = val.trim().slice(0, 40);
    }
  }
  return {
    period: mapping.period,
    indicator: mapping.indicator || null,
    category: mapping.category || null,
    area: mapping.area || null,
    unit: mapping.unit || null,
    values: mapping.values,
    default_category: typeof mapping.default_category === 'string' ? mapping.default_category.slice(0, 60) : null,
    unit_overrides: overrides,
  };
}

async function bulkInsertObservations(client, datasetId, indicatorIds, records) {
  const CH = 4000;
  for (let i = 0; i < records.length; i += CH) {
    const part = records.slice(i, i + CH);
    await client.query(
      `INSERT INTO observations (dataset_id, indicator_id, period, geographic_area, value, pct_change, moving_avg, source_row)
       SELECT $1, ind, per, area, val, pc, ma, sr
       FROM unnest($2::int[], $3::date[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::int[])
            AS t(ind, per, area, val, pc, ma, sr)`,
      [
        datasetId,
        part.map((r) => indicatorIds[r.indicator_code]),
        part.map((r) => r.period),
        part.map((r) => r.area),
        part.map((r) => r.value),
        part.map((r) => r.pct_change),
        part.map((r) => r.moving_avg),
        part.map((r) => r.source_row),
      ]
    );
  }
}

/** Run the Python processing pipeline for a dataset and store the processed observations. */
async function processDataset(dataset, userId) {
  if (!dataset.column_mapping) throw new AppError(400, 'Confirm the column mapping before processing.');
  const job = await db.query(
    `INSERT INTO processing_jobs (dataset_id, started_by) VALUES ($1,$2) RETURNING id`,
    [dataset.id, userId || null]
  );
  const jobId = job.rows[0].id;
  await db.query(`UPDATE datasets SET status = 'processing' WHERE id = $1`, [dataset.id]);

  try {
    const result = await runAnalytics('process', {
      path: storedPath(dataset.stored_filename),
      filename: dataset.original_filename,
      mapping: dataset.column_mapping,
    });
    await db.tx(async (c) => {
      const indicatorIds = {};
      for (const ind of result.indicators) {
        const { rows } = await c.query(
          `INSERT INTO indicators (code, name, category, unit)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (code) DO UPDATE SET unit = COALESCE(indicators.unit, EXCLUDED.unit)
           RETURNING id`,
          [ind.code, ind.name, ind.category || 'Uncategorised', ind.unit]
        );
        indicatorIds[ind.code] = rows[0].id;
      }
      await c.query('DELETE FROM observations WHERE dataset_id = $1', [dataset.id]);
      await bulkInsertObservations(c, dataset.id, indicatorIds, result.records);
      await c.query(
        `UPDATE datasets SET status = 'processed', processing_summary = $2, processed_at = now() WHERE id = $1`,
        [dataset.id, JSON.stringify(result.summary)]
      );
      await c.query(
        `UPDATE processing_jobs SET status = 'completed', summary = $2, finished_at = now() WHERE id = $1`,
        [jobId, JSON.stringify(result.summary)]
      );
    });
    return result.summary;
  } catch (e) {
    await db.query(`UPDATE datasets SET status = 'failed' WHERE id = $1`, [dataset.id]);
    await db.query(`UPDATE processing_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [
      jobId,
      e.message,
    ]);
    throw e;
  }
}

/** Register an already-saved file as a dataset (used by upload route and demo seeding). */
async function registerDataset({ filePath, originalName, userId, name, description, category, dataSourceId, isSynthetic }) {
  assertSafeFile(filePath, originalName);
  const hash = sha256(filePath);
  const dup = await db.query(`SELECT id, name FROM datasets WHERE file_hash = $1 AND status <> 'archived'`, [hash]);
  if (dup.rows[0]) {
    throw new AppError(409, `This exact file has already been uploaded as dataset #${dup.rows[0].id} (“${dup.rows[0].name}”).`);
  }
  const report = await runAnalytics('inspect', { path: filePath, filename: originalName });
  const stored = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const synthetic = isSynthetic === undefined ? Boolean(report.synthetic_hint) : Boolean(isSynthetic);
  const { rows } = await db.query(
    `INSERT INTO datasets (name, description, category, data_source_id, uploaded_by, is_synthetic, status,
        original_filename, stored_filename, file_hash, file_size, record_count, columns, column_mapping, validation_report)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [
      name, description || null, category, dataSourceId || null, userId || null, synthetic,
      report.is_valid ? 'validated' : 'uploaded',
      originalName, stored, hash, size, report.record_count,
      JSON.stringify(report.columns), JSON.stringify(report.suggested_mapping), JSON.stringify(report),
    ]
  );
  await db.query(
    `INSERT INTO dataset_files (dataset_id, original_name, stored_name, file_hash, file_size, mime_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [rows[0].id, originalName, stored, hash, size, path.extname(originalName).toLowerCase(), userId || null]
  );
  return rows[0].id;
}

module.exports = { CATEGORIES, ALLOWED_EXT, assertSafeFile, removeFile, storedPath, checkMapping, processDataset, registerDataset };
