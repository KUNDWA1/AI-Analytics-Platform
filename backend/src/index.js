const { config, assertConfig } = require('./config');
const { initDb } = require('./scripts/initDb');
const { createApp } = require('./app');

async function main() {
  assertConfig();
  await initDb(); // idempotent: creates tables/views and loads roles + permissions
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`AI Analytics Platform API listening on http://localhost:${config.port}`);
  });
}

main().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
