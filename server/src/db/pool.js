// pool.js — single shared pg Pool instance.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL requirement is determined by whether the database is reachable
  // over the public internet, NOT by NODE_ENV. Gating this on
  // NODE_ENV==='production' is a common mistake — it breaks the moment
  // someone runs the app with NODE_ENV=development against a real hosted
  // database (e.g. testing locally against a Render/Railway/Supabase
  // instance before deploying). Virtually every hosted Postgres provider
  // requires SSL for external connections; the only case that doesn't is
  // a genuinely local Postgres on localhost. So: default to SSL on,
  // and only turn it off when the connection string points at
  // localhost/127.0.0.1.
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  // Idle client errors (e.g. connection dropped by the host) should not
  // crash the whole process — log and let the pool recover.
  console.error('Unexpected error on idle PG client', err);
});

/**
 * Runs `fn` inside a transaction. Rolls back on any thrown error.
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
