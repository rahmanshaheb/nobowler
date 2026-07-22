// fix-pair-totals-view.js
//
// Targeted, one-time fix: updates v_pair_innings_totals to include
// penalty_runs in pair_total_runs (it was missing — a pair that's lost
// a wicket should show a total that reflects the -5 penalty, which it
// wasn't before this fix). Uses CREATE OR REPLACE VIEW rather than
// re-running the whole schema.sql, since plain CREATE VIEW would fail
// against a database that already has this view from the original
// schema run — re-running the full file isn't safe here.
//
// Usage (from server/):
//   node db/fix-pair-totals-view.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const sql = `
CREATE OR REPLACE VIEW v_pair_innings_totals AS
SELECT
    pi.id AS pair_innings_id,
    pi.innings_id,
    pi.pair_number,
    pi.stint_number,
    pi.batter_1_id,
    pi.batter_2_id,
    COALESCE(SUM(d.total_runs), 0) + COALESCE(SUM(d.penalty_runs), 0) AS pair_total_runs,
    COALESCE(SUM(d.batter_runs) FILTER (WHERE d.striker_id = pi.batter_1_id), 0) AS batter_1_runs,
    COALESCE(SUM(d.batter_runs) FILTER (WHERE d.striker_id = pi.batter_2_id), 0) AS batter_2_runs,
    COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS legal_balls_faced
FROM pair_innings pi
LEFT JOIN delivery d ON d.pair_innings_id = pi.id AND d.is_undone = false
GROUP BY pi.id, pi.innings_id, pi.pair_number, pi.stint_number, pi.batter_1_id, pi.batter_2_id;
`;

async function run() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('v_pair_innings_totals updated successfully — pair_total_runs now includes penalty_runs.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Failed to update view:', err.message);
  process.exit(1);
});
