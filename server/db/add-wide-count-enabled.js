// add-wide-count-enabled.js
// Adds wide_count_enabled column to match table (default true)
// Run from server/: node db/add-wide-count-enabled.js
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE match
      ADD COLUMN IF NOT EXISTS wide_count_enabled BOOLEAN NOT NULL DEFAULT true
    `);
    console.log('Done. wide_count_enabled added to match table.');
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(e => { console.error(e.message); process.exit(1); });
