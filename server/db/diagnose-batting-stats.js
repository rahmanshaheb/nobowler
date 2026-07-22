// Diagnostic: show raw delivery data for the most recent match
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT
        mp.display_name,
        d.delivery_type,
        d.zone_hit,
        d.batter_runs,
        d.extra_runs,
        d.total_runs,
        d.penalty_runs,
        d.is_wicket,
        d.wicket_type,
        d.dismissed_player_id = d.striker_id AS striker_dismissed
      FROM delivery d
      JOIN match_player mp ON mp.id = d.striker_id
      JOIN innings i ON i.id = d.innings_id
      JOIN match m ON m.id = i.match_id
      WHERE m.created_at = (SELECT MAX(created_at) FROM match)
        AND d.is_undone = false
      ORDER BY d.sequence_number
    `);
    console.table(rows);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
