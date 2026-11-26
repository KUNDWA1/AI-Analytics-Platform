const { Pool, types } = require('pg');
const { config } = require('./config');

// Return NUMERIC as JS numbers and DATE as plain 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1082, (v) => v);

let pool;
function getPool() {
  if (!pool) pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    // Set PGSSL=true when connecting to a managed database over its external URL.
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

const query = (text, params) => getPool().query(text, params);

async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = { query, tx, getPool, close };
