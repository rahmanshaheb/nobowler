// diagnose-innings-totals-view.js
//
// READ-ONLY diagnostic: prints the LIVE database's actual current
// definition of v_innings_totals. Makes zero changes to the database —
// only reads and prints. Used to investigate why this view is returning
// an implausibly large total_runs value (e.g. 1430+ from a normal,
// sub-200 16-over innings), suggesting deliveries may be getting
// summed more than once — a classic symptom of a JOIN that fans out
// (e.g. joining against a table with more than one matching row per
// delivery) rather than a genuine scoring issue.
//
// Usage (from server/):
//   node db/diagnose-innings-totals-view.js

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
      `SELECT pg_get_viewdef('v_innings_totals'::regclass, true) AS definition`
    );
    console.log('--- Current live definition of v_innings_totals ---');
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
