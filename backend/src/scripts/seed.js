// Seed / reset the demonstration environment.
//   npm run seed            -> create demo users, and load demo data only if the database has no datasets yet
//   npm run seed -- --reset -> wipe analytical data and reload everything from the sample files
// The data is loaded through the application's own HTTP API (an in-process server on a random port).
const { config, assertConfig } = require('../config');
const db = require('../db');
const { initDb } = require('./initDb');
const { createApp } = require('../app');
const demo = require('../services/demo');

async function main() {
  assertConfig();
  if (!config.demoPassword) throw new Error('DEMO_PASSWORD is not set. Add it to your .env file (see .env.example).');
  await initDb();
  const reset = process.argv.includes('--reset');
  const existing = (await db.query('SELECT count(*)::int AS n FROM datasets')).rows[0].n;
  if (existing > 0 && !reset) {
    await demo.ensureDemoUsers(config.demoPassword);
    console.log('Datasets already exist; demo users refreshed. Use "npm run seed -- --reset" to reload the demo data.');
    return;
  }
  const server = await new Promise((resolve) => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const log = (m) => console.log(m);
    if (reset) { log('Resetting analytical data...'); await demo.resetData(); }
    const summary = await demo.loadDemo({ baseUrl, password: config.demoPassword, log });
    console.log('Demo environment ready:', JSON.stringify(summary));
    console.log('Demo accounts:', demo.DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(', '), '— password = DEMO_PASSWORD from your .env');
  } finally {
    server.close();
  }
}

main()
  .catch((e) => { console.error('Seed failed:', e.message); process.exitCode = 1; })
  .finally(() => db.close());
