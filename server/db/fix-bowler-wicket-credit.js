// fix-bowler-wicket-credit.js
// Updates v_bowling_stats so bowler_credited_wickets includes bowled,
// caught, caught_and_bowled, stumped, and three_dots (run_out excluded).
//
// Run: node db/fix-bowler-wicket-credit.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Updating v_bowling_stats bowler wicket credit...');
    await client.query(`
      CREATE OR REPLACE VIEW v_bowling_stats AS
      SELECT
        mp.id AS player_id,
        mp.match_id,
        mp.display_name,
        mp.team,
        bs.innings_id,
        COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS legal_balls_bowled,
        COALESCE(SUM(d.total_runs), 0) AS runs_conceded,
        COALESCE(SUM(CASE WHEN d.is_wicket AND d.wicket_type IN ('bowled','caught_and_bowled','caught','three_dots','stumped') THEN 1 ELSE 0 END), 0) AS bowler_credited_wickets,
        COALESCE(SUM(CASE WHEN d.is_wicket THEN 1 ELSE 0 END), 0) AS total_wickets_in_spell
      FROM match_player mp
      JOIN bowling_spell bs ON bs.bowler_id = mp.id
      LEFT JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
      GROUP BY mp.id, mp.match_id, mp.display_name, mp.team, bs.innings_id
    `);
    console.log('Done. Bowler wickets now credit bowled, caught, c&b, stumped, and three_dots.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
