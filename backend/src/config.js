// Central configuration. All secrets come from environment variables (.env) — nothing is hardcoded.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config(); // optional backend/.env override

const ROOT = path.join(__dirname, '..', '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  pythonBin: process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
  analyticsScript: path.join(ROOT, 'analytics', 'analytics_cli.py'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'backend', 'uploads')),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '10', 10),
  sampleDir: path.join(ROOT, 'sample-data'),
  schemaFile: path.join(ROOT, 'database', 'schema.sql'),
  demoPassword: process.env.DEMO_PASSWORD, // used only by the seed script
  root: ROOT,
};

function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.jwtSecret) missing.push('JWT_SECRET');
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`
    );
  }
  if (config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }
}

module.exports = { config, assertConfig };
