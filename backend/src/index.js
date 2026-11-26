const { config, assertConfig } = require('./config');
const { initDb } = require('./scripts/initDb');
const { createApp } = require('./app');

// Optional first-boot demo load (hosted deployments without a shell). Enabled with BOOTSTRAP_DEMO=true.
// Runs once: skipped if any dataset already exists. Never resets existing data.
async function bootstrapDemo() {
  if (process.env.BOOTSTRAP_DEMO !== 'true') return;
  if (!config.demoPassword) { console.warn('BOOTSTRAP_DEMO is true but DEMO_PASSWORD is not set; skipping.'); return; }
  const db = require('./db');
  const demo = require('./services/demo');
  // Skip only when processed data already exists. Datasets with no processed observations are a failed
  // earlier load: rebuild the analytical data (users, roles and the audit trail are kept).
  const n = (await db.query('SELECT count(*)::int AS n FROM observations')).rows[0].n;
  if (n > 0) { await demo.ensureDemoUsers(config.demoPassword); console.log('Demo bootstrap: processed data exists, nothing to load.'); return; }
  console.log('Demo bootstrap: no processed data found, loading demo data...');
  await demo.resetData();
  const summary = await demo.loadDemo({ baseUrl: `http://127.0.0.1:${config.port}`, password: config.demoPassword, log: console.log });
  console.log('Demo bootstrap complete:', JSON.stringify(summary));
}

async function main() {
  assertConfig();
  await initDb(); // idempotent: creates tables/views and loads roles + permissions
  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`AI Analytics Platform API listening on port ${config.port}`);
    bootstrapDemo().catch((e) => console.error('Demo bootstrap failed:', e.message));
  });
}

main().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
