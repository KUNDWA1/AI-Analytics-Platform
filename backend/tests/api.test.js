// Backend integration tests: authentication, authorization, upload security, dataset workflow,
// analytics, alerts, reports, audit logging and database integrity.
// Uses a SEPARATE database (fintech_analytics_test by default) and a temporary upload folder.
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL.replace(/\/[^/]+$/, '/fintech_analytics_test');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fintech-uploads-'));
process.env.MAX_UPLOAD_MB = '2';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { config, assertConfig } = require('../src/config');
const db = require('../src/db');
const { initDb } = require('../src/scripts/initDb');
const { createApp } = require('../src/app');
const demo = require('../src/services/demo');

const PW = config.demoPassword;
const SAMPLE = path.join(config.sampleDir, 'digital_financial_activity_synthetic.csv');
let app;
const tok = {};
const login = async (email) => (await request(app).post('/api/auth/login').send({ email, password: PW })).body.data;
const as = (role) => ({ Authorization: `Bearer ${tok[role]}` });

before(async () => {
  assertConfig();
  assert.ok(PW, 'DEMO_PASSWORD must be set');
  await initDb();
  await db.query(`TRUNCATE dataset_files, processing_jobs, observations, anomaly_results, alerts, trend_analyses,
                  forecasts, reports, datasets, indicators, data_sources, sessions, audit_logs RESTART IDENTITY CASCADE`);
  await db.query("DELETE FROM users WHERE email NOT LIKE '%@demo.local' OR email = 'temp.user@demo.local'");
  await demo.ensureDemoUsers(PW);
  app = createApp();
  for (const r of ['admin', 'analyst', 'regulator', 'management']) {
    const d = await login(`${r === 'admin' ? 'admin' : r}@demo.local`);
    tok[r] = d.token;
  }
});
after(async () => {
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
  await db.close();
});

describe('authentication', () => {
  test('health endpoint is public and minimal', async () => {
    const r = await request(app).get('/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data), ['status']);
  });

  test('wrong password and unknown user give the same 401 message', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'analyst@demo.local', password: 'wrong-pass-1' });
    const b = await request(app).post('/api/auth/login').send({ email: 'nobody@demo.local', password: 'wrong-pass-1' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
  });

  test('login returns token + user without password hash', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'ANALYST@demo.local', password: PW });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.token);
    assert.equal(r.body.data.user.role, 'analyst');
    assert.equal(JSON.stringify(r.body).includes('password_hash'), false);
  });

  test('passwords are stored as bcrypt hashes, never plain text', async () => {
    const { rows } = await db.query('SELECT password_hash FROM users');
    assert.ok(rows.length >= 4);
    for (const u of rows) {
      assert.match(u.password_hash, /^\$2[aby]\$\d\d\$/);
      assert.notEqual(u.password_hash, PW);
    }
  });

  test('protected routes reject missing, malformed and forged tokens', async () => {
    assert.equal((await request(app).get('/api/auth/me')).status, 401);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi')).status, 401);
    const forged = require('jsonwebtoken').sign({ sub: 1, jti: crypto.randomUUID() }, 'a-different-secret-that-is-long-enough-123');
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status, 401);
  });

  test('logout revokes the token server-side', async () => {
    const t = (await login('management@demo.local')).token;
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`)).status, 200);
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${t}`);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`)).status, 401);
  });

  test('deactivating a user invalidates their existing sessions immediately', async () => {
    const created = await request(app).post('/api/users').set(as('admin'))
      .send({ email: 'temp.user@demo.local', full_name: 'Temp User', role: 'analyst', password: 'Temp12345pw' });
    assert.equal(created.status, 201);
    const t = (await request(app).post('/api/auth/login').send({ email: 'temp.user@demo.local', password: 'Temp12345pw' })).body.data.token;
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`)).status, 200);
    await request(app).put(`/api/users/${created.body.data.id}`).set(as('admin')).send({ is_active: false });
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`)).status, 401);
  });
});

describe('role-based authorization is enforced by the backend', () => {
  test('management cannot upload, list users, run analytics or view audit logs', async () => {
    assert.equal((await request(app).post('/api/datasets/upload').set(as('management')).attach('file', Buffer.from('a,b\n1,2\n'), 'x.csv').field('category', 'Mobile Money')).status, 403);
    assert.equal((await request(app).get('/api/users').set(as('management'))).status, 403);
    assert.equal((await request(app).post('/api/analytics/anomalies').set(as('management')).send({})).status, 403);
    assert.equal((await request(app).get('/api/audit-logs').set(as('management'))).status, 403);
    assert.equal((await request(app).get('/api/alerts').set(as('management'))).status, 403);
  });

  test('regulator can monitor but not upload, process or run models', async () => {
    assert.equal((await request(app).get('/api/dashboard/regulator').set(as('regulator'))).status, 200);
    assert.equal((await request(app).post('/api/datasets/upload').set(as('regulator')).attach('file', Buffer.from('a,b\n1,2\n'), 'x.csv')).status, 403);
    assert.equal((await request(app).post('/api/analytics/forecast').set(as('regulator')).send({ indicator_id: 1 })).status, 403);
    assert.equal((await request(app).get('/api/users').set(as('regulator'))).status, 403);
  });

  test('analyst cannot manage users, audit logs or reset the demo', async () => {
    assert.equal((await request(app).post('/api/users').set(as('analyst')).send({})).status, 403);
    assert.equal((await request(app).get('/api/audit-logs').set(as('analyst'))).status, 403);
    assert.equal((await request(app).post('/api/system/demo/reset').set(as('analyst')).send({ confirm: true })).status, 403);
  });

  test('role cannot be escalated through URL parameters, headers or body fields', async () => {
    const r1 = await request(app).get('/api/users?role=administrator').set(as('regulator'));
    const r2 = await request(app).get('/api/users').set(as('regulator')).set('X-Role', 'administrator').set('X-User-Role', 'administrator');
    const r3 = await request(app).get('/api/dashboard/admin?role=administrator').set(as('regulator'));
    const r4 = await request(app).get('/api/dashboard/management').set(as('regulator'));
    assert.deepEqual([r1.status, r2.status, r3.status, r4.status], [403, 403, 403, 403]);
  });

  test('dashboards are role-bound; administrators may open all', async () => {
    assert.equal((await request(app).get('/api/dashboard/management').set(as('management'))).status, 200);
    assert.equal((await request(app).get('/api/dashboard/analyst').set(as('management'))).status, 403);
    for (const d of ['regulator', 'analyst', 'management', 'admin']) {
      assert.equal((await request(app).get(`/api/dashboard/${d}`).set(as('admin'))).status, 200, d);
    }
  });

  test('user management validation, duplicates and self-protection', async () => {
    const weak = await request(app).post('/api/users').set(as('admin')).send({ email: 'w@demo.local', full_name: 'Weak', role: 'analyst', password: 'short' });
    assert.equal(weak.status, 400);
    const badRole = await request(app).post('/api/users').set(as('admin')).send({ email: 'x@demo.local', full_name: 'X', role: 'superuser', password: 'Valid12345' });
    assert.equal(badRole.status, 400);
    const dup = await request(app).post('/api/users').set(as('admin')).send({ email: 'analyst@demo.local', full_name: 'Dup', role: 'analyst', password: 'Valid12345' });
    assert.equal(dup.status, 409);
    const me = (await request(app).get('/api/auth/me').set(as('admin'))).body.data;
    assert.equal((await request(app).delete(`/api/users/${me.id}`).set(as('admin'))).status, 400);
    assert.equal((await request(app).put(`/api/users/${me.id}`).set(as('admin')).send({ role: 'analyst' })).status, 400);
  });
});

describe('upload security and validation', () => {
  const up = (buf, name, extra = {}) =>
    request(app).post('/api/datasets/upload').set(as('analyst')).field('category', 'Mobile Money').field('name', 'sec test')
      .field(extra).attach('file', buf, name);

  test('executables and wrong extensions are rejected', async () => {
    assert.equal((await up(Buffer.from('MZ\x90\x00binary'), 'malware.exe')).status, 415);
    assert.equal((await up(Buffer.from('a,b\n1,2'), 'data.php')).status, 415);
    assert.equal((await up(Buffer.from('a,b\n1,2'), 'data.csv.exe')).status, 415);
  });

  test('content must match the claimed type (disguised files)', async () => {
    assert.equal((await up(Buffer.from('MZ\x90\x00\x03\x00\x00\x00 fake exe'), 'report.csv')).status, 422);
    assert.equal((await up(Buffer.from('%PDF-1.4 fake'), 'report.csv')).status, 422);
    assert.equal((await up(Buffer.from('<?php system($_GET["x"]); ?>'), 'x.csv')).status, 422);
    assert.equal((await up(Buffer.from('this is not a zip'), 'book.xlsx')).status, 422);
    assert.equal((await up(Buffer.from(''), 'empty.csv')).status, 422);
  });

  test('oversized files are rejected', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 'a,b\n');
    assert.equal((await up(big, 'big.csv')).status, 413);
  });

  test('rejected uploads leave nothing on disk and no database rows', async () => {
    assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM datasets')).rows[0].n, 0);
  });

  test('uploads require a valid category', async () => {
    const r = await request(app).post('/api/datasets/upload').set(as('analyst')).field('category', 'Hacking').attach('file', SAMPLE);
    assert.equal(r.status, 400);
  });

  test('path-traversal filenames never influence where the file is stored', async () => {
    const csv = 'reporting_period,indicator_name,geographic_area,value\n2024-01,Test,National,5\n2024-02,Test,National,6\n';
    const r = await up(Buffer.from(csv), '../../../etc/evil.csv');
    assert.equal(r.status, 201);
    const stored = fs.readdirSync(process.env.UPLOAD_DIR);
    assert.equal(stored.length, 1);
    assert.match(stored[0], /^[0-9a-f-]{36}\.csv$/);
    await request(app).delete(`/api/datasets/${r.body.data.id}`).set(as('admin'));
  });

  test('analyst cannot hard-delete datasets; admin can', async () => {
    const r = await up(Buffer.from('p,i,v\n2024-01,Z,1\n'), 'tiny.csv');
    assert.equal(r.status, 201);
    assert.equal((await request(app).delete(`/api/datasets/${r.body.data.id}`).set(as('analyst'))).status, 403);
    assert.equal((await request(app).delete(`/api/datasets/${r.body.data.id}`).set(as('admin'))).status, 200);
    assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, 0, 'file is removed with the dataset');
  });
});

describe('dataset workflow, analytics, alerts and reports (end to end)', () => {
  let ds;
  let indicators;

  test('upload -> validated with detected columns, record count and original hash', async () => {
    const r = await request(app).post('/api/datasets/upload').set(as('analyst'))
      .field('name', 'Test synthetic').field('category', 'Mixed / Other').attach('file', SAMPLE);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ds = r.body.data;
    assert.equal(ds.status, 'validated');
    assert.equal(ds.record_count, 900);
    assert.equal(ds.is_synthetic, true);
    const det = (await request(app).get(`/api/datasets/${ds.id}`).set(as('analyst'))).body.data;
    assert.ok(det.columns.length >= 8);
    assert.equal(det.file_hash, crypto.createHash('sha256').update(fs.readFileSync(SAMPLE)).digest('hex'));
    assert.equal(det.files.length, 1, 'upload history recorded');
  });

  test('the same file cannot be uploaded twice', async () => {
    const r = await request(app).post('/api/datasets/upload').set(as('analyst')).field('category', 'Mixed / Other').attach('file', SAMPLE);
    assert.equal(r.status, 409);
  });

  test('invalid mappings are rejected; datasets cannot be analysed before processing', async () => {
    const bad = await request(app).put(`/api/datasets/${ds.id}/mapping`).set(as('analyst')).send({ mapping: { period: 'nope', values: ['x'] } });
    assert.equal(bad.status, 400);
    const early = await request(app).post('/api/analytics/anomalies').set(as('analyst')).send({ dataset_id: ds.id });
    assert.equal(early.status, 409);
  });

  test('processing stores observations with provenance and a complete summary', async () => {
    const r = await request(app).post(`/api/datasets/${ds.id}/process`).set(as('analyst'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = r.body.data;
    assert.equal(s.original_records, 900);
    assert.equal(s.valid_records + s.invalid_records, 900);
    assert.equal(s.observations_created, 2700);
    const { rows } = await db.query('SELECT count(*)::int n, count(source_row)::int traced FROM observations WHERE dataset_id=$1', [ds.id]);
    assert.equal(rows[0].n, 2700);
    assert.equal(rows[0].traced, 2700, 'every observation references its source row');
    const after = (await request(app).get(`/api/datasets/${ds.id}`).set(as('analyst'))).body.data;
    assert.equal(after.status, 'processed');
    assert.ok(after.processed_at);
    indicators = (await request(app).get('/api/indicators').set(as('analyst'))).body.data;
    assert.equal(indicators.length, 9);
  });

  test('re-processing is idempotent (no duplicated observations)', async () => {
    await request(app).post(`/api/datasets/${ds.id}/process`).set(as('analyst'));
    assert.equal((await db.query('SELECT count(*)::int n FROM observations WHERE dataset_id=$1', [ds.id])).rows[0].n, 2700);
  });

  test('trend analysis returns real statistics computed from stored data', async () => {
    const ind = indicators.find((i) => /Mobile Money.*Transaction Volume/.test(i.name));
    const r = await request(app).post('/api/analytics/trends').set(as('analyst')).send({ indicator_id: ind.id, area: 'Kigali City' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.n_observations, 60);
    assert.equal(r.body.data.statistics.trend_direction, 'increasing');
    assert.equal(r.body.data.is_synthetic, true);
  });

  test('forecast is backtested, labelled synthetic and persisted', async () => {
    const ind = indicators.find((i) => /Mobile Money.*Transaction Value/.test(i.name));
    const r = await request(app).post('/api/analytics/forecast').set(as('analyst')).send({ indicator_id: ind.id, horizon: 6 });
    assert.equal(r.status, 200);
    const f = r.body.data;
    assert.equal(f.status, 'ok');
    assert.equal(f.forecast.length, 6);
    assert.ok(f.evaluation.selected.mape_pct >= 0);
    assert.ok(f.evaluation.candidates.length >= 3);
    assert.match(f.data_notice, /SYNTHETIC DEMONSTRATION DATA/);
    assert.equal((await db.query('SELECT count(*)::int n FROM forecasts')).rows[0].n, 1);
    assert.equal((await request(app).post('/api/analytics/forecast').set(as('analyst')).send({ indicator_id: ind.id, horizon: 999 })).status, 400);
  });

  test('anomaly detection finds the injected case, creates alerts, no fraud claims', async () => {
    const r = await request(app).post('/api/analytics/anomalies').set(as('analyst')).send({ dataset_id: ds.id, threshold: 4 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.data.detected > 0);
    assert.match(r.body.data.disclaimer, /not evidence of fraud/i);
    const { rows } = await db.query(
      `SELECT r.*, i.name FROM anomaly_results r JOIN indicators i ON i.id=r.indicator_id
       WHERE i.name='Mobile Money – Transaction Volume' AND r.geographic_area='Kigali City' AND r.period='2023-08-01'`);
    assert.equal(rows.length, 1, 'injected synthetic anomaly (Kigali, Aug 2023) must be detected');
    assert.equal(rows[0].direction, 'increase');
    assert.ok(['medium', 'high'].includes(rows[0].severity));
    assert.match(rows[0].explanation, /requires further investigation/i);
    assert.equal(rows[0].is_synthetic, true);
    const alerts = (await db.query('SELECT count(*)::int n FROM alerts')).rows[0].n;
    assert.equal(alerts, r.body.data.detected);
    // running again must not duplicate alerts
    await request(app).post('/api/analytics/anomalies').set(as('analyst')).send({ dataset_id: ds.id, threshold: 4 });
    assert.equal((await db.query('SELECT count(*)::int n FROM alerts')).rows[0].n, alerts);
  });

  test('alert filtering and review workflow (regulator reviews, management cannot)', async () => {
    const list = await request(app).get('/api/alerts?severity=high').set(as('regulator'));
    assert.equal(list.status, 200);
    const items = list.body.data.items || list.body.data;
    assert.ok(items.length > 0);
    assert.ok(items.every((a) => a.severity === 'high'));
    const id = items[0].id;
    assert.equal((await request(app).patch(`/api/alerts/${id}`).set(as('management')).send({ status: 'reviewed' })).status, 403);
    assert.equal((await request(app).patch(`/api/alerts/${id}`).set(as('regulator')).send({ status: 'bogus' })).status, 400);
    const upd = await request(app).patch(`/api/alerts/${id}`).set(as('regulator')).send({ status: 'reviewed', analyst_note: 'Checked against source release; consistent with a known campaign.' });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.data.status, 'reviewed');
    assert.match(upd.body.data.analyst_note, /known campaign/);
    assert.ok(upd.body.data.reviewed_at);
    const detail = await request(app).get(`/api/alerts/${id}`).set(as('regulator'));
    assert.equal(detail.status, 200);
  });

  test('dashboard KPIs come from stored data and honour filters', async () => {
    const all = (await request(app).get('/api/dashboard/regulator').set(as('regulator'))).body.data;
    assert.ok(JSON.stringify(all).length > 500);
    const k = await request(app).get('/api/dashboard/regulator?area=Kigali%20City&from=2023-01-01&to=2023-12-01').set(as('regulator'));
    assert.equal(k.status, 200);
    assert.equal((await request(app).get('/api/dashboard/regulator?from=not-a-date').set(as('regulator'))).status, 400);
  });

  test('report generation, PDF download and CSV export', async () => {
    const gen = await request(app).post('/api/reports/generate').set(as('analyst'))
      .send({ title: 'Test report', from: '2023-01-01', to: '2024-12-01', categories: [], include_anomalies: true });
    assert.equal(gen.status, 201, JSON.stringify(gen.body));
    assert.equal(gen.body.data.content.is_synthetic, true);
    const pdf = await request(app).get(`/api/reports/${gen.body.data.id}/download`).set(as('management')).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.length > 5000);
    const csv = await request(app).get('/api/reports/export/csv?from=2024-01-01&to=2024-12-01').set(as('analyst'));
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.split('\n').length > 100);
    assert.equal((await request(app).post('/api/reports/generate').set(as('analyst')).send({ title: 'x', from: '2025-01-01', to: '2024-01-01' })).status, 400);
    assert.equal((await request(app).post('/api/reports/generate').set(as('analyst')).send({})).status, 400);
  });

  test('audit log captures important actions and is admin-only', async () => {
    const r = await request(app).get('/api/audit-logs?limit=200').set(as('admin'));
    assert.equal(r.status, 200);
    const actions = new Set(r.body.data.items.map((a) => a.action));
    for (const a of ['LOGIN', 'LOGIN_FAILED', 'DATASET_UPLOADED', 'DATASET_PROCESSED', 'FORECAST_RUN', 'ANOMALY_DETECTION_RUN', 'ALERT_UPDATED', 'REPORT_GENERATED', 'USER_CREATED']) {
      assert.ok(actions.has(a), `missing audit action ${a}`);
    }
    assert.equal(JSON.stringify(r.body).includes(PW), false, 'passwords never appear in audit logs');
  });

  test('sample files can be listed and downloaded; path traversal is blocked', async () => {
    const l = await request(app).get('/api/system/samples').set(as('analyst'));
    assert.equal(l.status, 200);
    assert.match(l.body.data.label, /SYNTHETIC DEMONSTRATION DATA/);
    assert.equal((await request(app).get('/api/system/samples/digital_financial_activity_synthetic.csv').set(as('analyst'))).status, 200);
    assert.equal((await request(app).get('/api/system/samples/..%2F..%2F.env').set(as('analyst'))).status, 404);
  });
});

describe('database integrity', () => {
  test('constraints reject invalid rows and duplicates', async () => {
    const ind = (await db.query('SELECT id FROM indicators LIMIT 1')).rows[0];
    const d = (await db.query('SELECT id FROM datasets LIMIT 1')).rows[0];
    await assert.rejects(db.query(`INSERT INTO observations (dataset_id, indicator_id, period, geographic_area, value) SELECT dataset_id, indicator_id, period, geographic_area, 1 FROM observations LIMIT 1`), /unique|duplicate/i);
    await assert.rejects(db.query(`INSERT INTO anomaly_results (indicator_id, geographic_area, period, observed_value, anomaly_score, severity, method, explanation)
      VALUES ($1,'X','2020-01-01',1,1,'catastrophic','m','e')`, [ind.id]), /check/i);
    await assert.rejects(db.query(`INSERT INTO observations (dataset_id, indicator_id, period, value) VALUES (99999,$1,'2020-01-01',1)`, [ind.id]), /foreign key/i);
    await assert.rejects(db.query(`INSERT INTO users (email, full_name, password_hash, role_id) VALUES ('Upper@Case.com','x','h',1)`), /check|violates/i);
    await assert.rejects(db.query(`INSERT INTO datasets (name, category, original_filename, stored_filename, file_hash, file_size, status) VALUES ('x','c','a','b','h',1,'weird')`), /check/i);
    assert.ok(d);
  });

  test('deleting a dataset cascades to its observations only', async () => {
    const before = (await db.query('SELECT count(*)::int n FROM observations')).rows[0].n;
    assert.ok(before > 0);
    const res = await request(app).delete(`/api/datasets/${(await db.query('SELECT id FROM datasets LIMIT 1')).rows[0].id}`).set(as('admin'));
    assert.equal(res.status, 200);
    assert.equal((await db.query('SELECT count(*)::int n FROM observations')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM users')).rows[0].n >= 4, true);
  });
});
