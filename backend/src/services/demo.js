// Demonstration environment: demo users, data-source catalogue and preloaded analysis.
//
// Everything analytical is produced by calling the application's OWN HTTP API (upload -> process ->
// trend -> forecast -> anomaly detection), exactly like a real user would. Nothing is hardcoded.
// All demo data is SYNTHETIC and labelled as such.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { config } = require('../config');
const db = require('../db');

const SYNTH_LABEL = 'SYNTHETIC DEMONSTRATION DATA — NOT OFFICIAL INSTITUTIONAL DATA.';

const DEMO_USERS = [
  { email: 'admin@demo.local', full_name: 'Demo Administrator', role: 'administrator' },
  { email: 'analyst@demo.local', full_name: 'Demo Data Analyst', role: 'analyst' },
  { email: 'regulator@demo.local', full_name: 'Demo Regulator', role: 'regulator' },
  { email: 'management@demo.local', full_name: 'Demo Policymaker', role: 'management' },
];

const SOURCES = [
  { name: 'National Bank of Rwanda (BNR)', organization: 'National Bank of Rwanda', url: 'https://www.bnr.rw/', source_type: 'public',
    description: 'Proposed public source for payment-system and financial-sector statistics. Import after manual download; no API access or data-sharing agreement exists.' },
  { name: 'National Institute of Statistics of Rwanda (NISR)', organization: 'NISR', url: 'https://www.statistics.gov.rw/', source_type: 'public',
    description: 'Proposed public source for economic and household statistics. Import after manual download.' },
  { name: 'Rwanda Utilities Regulatory Authority (RURA)', organization: 'RURA', url: 'https://www.rura.rw/', source_type: 'public',
    description: 'Proposed public source for telecom and internet market statistics. Import after manual download.' },
  { name: 'World Bank Global Findex', organization: 'World Bank', url: 'https://www.worldbank.org/en/publication/globalfindex', source_type: 'public',
    description: 'Proposed public source for financial-inclusion survey indicators. Import after manual download.' },
  { name: 'Synthetic demonstration generator', organization: 'This project (generate_synthetic.py)', url: null, source_type: 'synthetic',
    description: SYNTH_LABEL },
];

const PRELOAD = [
  { file: 'digital_financial_activity_synthetic.csv', name: 'Digital financial activity by province (synthetic)',
    category: 'Mixed / Other', description: `${SYNTH_LABEL} Mobile money, digital payments and mobile banking, 2020-2024.` },
  { file: 'connectivity_inclusion_synthetic.csv', name: 'Connectivity and financial inclusion (synthetic)',
    category: 'Internet & Connectivity', description: `${SYNTH_LABEL} Connectivity and financial-inclusion indicators, 2020-2024.` },
];

async function ensureDemoUsers(password) {
  const hash = await bcrypt.hash(password, 12);
  for (const u of DEMO_USERS) {
    await db.query(
      `INSERT INTO users (email, full_name, password_hash, role_id, is_active)
       VALUES ($1,$2,$3,(SELECT id FROM roles WHERE name = $4), TRUE)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE,
         role_id = EXCLUDED.role_id, full_name = EXCLUDED.full_name`,
      [u.email, u.full_name, hash, u.role]
    );
  }
}

/** Delete all analytical data (keeps users, roles and the audit trail). */
async function resetData() {
  const files = await db.query('SELECT stored_filename FROM datasets');
  await db.query(
    `TRUNCATE dataset_files, processing_jobs, observations, anomaly_results, alerts, trend_analyses,
              forecasts, reports, datasets, indicators, data_sources RESTART IDENTITY CASCADE`
  );
  for (const f of files.rows) {
    try { fs.unlinkSync(path.join(config.uploadDir, path.basename(f.stored_filename))); } catch { /* already gone */ }
  }
}

function client(baseUrl) {
  let token = null;
  const call = async (method, url, body, isForm) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      throw new Error(`${method} ${url} failed (${res.status}): ${json.error ? json.error.message : 'unknown error'}`);
    }
    return json.data;
  };
  return {
    login: async (email, password) => { token = (await call('POST', '/api/auth/login', { email, password })).token; },
    logout: () => call('POST', '/api/auth/logout', {}),
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b || {}),
    upload: (u, form) => call('POST', u, form, true),
  };
}

async function loadDemo({ baseUrl, password, log = () => {} }) {
  await ensureDemoUsers(password);
  const summary = { datasets: 0, indicators: 0, forecasts: 0, trend_analyses: 0, anomalies: 0, alerts: 0, report: null };

  const analyst = client(baseUrl);
  await analyst.login('analyst@demo.local', password);

  log('Registering data sources...');
  const sourceIds = {};
  for (const s of SOURCES) sourceIds[s.name] = (await analyst.post('/api/data-sources', s)).id;
  const synthSourceId = sourceIds['Synthetic demonstration generator'];

  for (const item of PRELOAD) {
    log(`Uploading and processing ${item.file}...`);
    const buf = fs.readFileSync(path.join(config.sampleDir, item.file));
    const form = new FormData();
    form.append('name', item.name);
    form.append('category', item.category);
    form.append('description', item.description);
    form.append('data_source_id', String(synthSourceId));
    form.append('is_synthetic', 'true');
    form.append('file', new Blob([buf], { type: 'text/csv' }), item.file);
    const ds = await analyst.upload('/api/datasets/upload', form);
    await analyst.post(`/api/datasets/${ds.id}/process`);
    summary.datasets += 1;
  }

  const indicators = await analyst.get('/api/indicators');
  summary.indicators = indicators.length;

  log('Running trend analysis and forecasts on stored data...');
  for (const ind of indicators) {
    try {
      await analyst.post('/api/analytics/trends', { indicator_id: ind.id });
      summary.trend_analyses += 1;
      const f = await analyst.post('/api/analytics/forecast', { indicator_id: ind.id, horizon: 6 });
      if (f.status === 'ok') summary.forecasts += 1;
    } catch (e) {
      log(`  skipped ${ind.name}: ${e.message}`);
    }
  }

  log('Running anomaly detection...');
  const an = await analyst.post('/api/analytics/anomalies', { method: 'both', threshold: 4 });
  summary.anomalies = an.detected;
  summary.alerts = an.new_alerts;

  log('Generating an example report...');
  const rep = await analyst.post('/api/reports/generate', {
    title: 'Digital financial activity review 2020-2024 (synthetic demonstration)', include_anomalies: true,
  });
  summary.report = rep.id;

  await analyst.logout();
  return summary;
}

async function resetAndLoad(opts) {
  await resetData();
  return loadDemo(opts);
}

module.exports = { DEMO_USERS, SOURCES, SYNTH_LABEL, ensureDemoUsers, resetData, loadDemo, resetAndLoad };
