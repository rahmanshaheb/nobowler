// diagnose-pair-totals-view.js
//
// READ-ONLY diagnostic: prints the LIVE database's actual current
// definition of v_pair_innings_totals, so we can compare it directly
// against the known-correct SQL in fix-pair-totals-view.js. This makes
// zero changes to the database — it only reads and prints.
//
// Usage (from server/):
//   node db/diagnose-pair-totals-view.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT pg_get_viewdef('v_pair_innings_totals'::regclass, true) AS definition`
    );
    console.log('--- Current live definition of v_pair_innings_totals ---');
    console.log(rows[0]?.definition ?? '(view not found)');
    console.log('--- end ---');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Failed to read view definition:', err.message);
  process.exit(1);
});
