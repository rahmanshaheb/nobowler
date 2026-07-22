// add-times-dismissed.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Dropping and recreating v_batting_stats view...');
    await client.query(`DROP VIEW IF EXISTS v_batting_stats CASCADE`);
    await client.query(`
      CREATE VIEW v_batting_stats AS
      SELECT
          mp.id AS player_id,
          mp.match_id,
          mp.display_name,
          mp.team,
          COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS balls_faced,
          COALESCE(SUM(d.batter_runs), 0) AS runs_scored,
          COALESCE(SUM(CASE WHEN d.zone_hit = 4 THEN 1 ELSE 0 END), 0) AS fours,
          COALESCE(SUM(CASE WHEN d.zone_hit = 6 THEN 1 ELSE 0 END), 0) AS sixes,
          BOOL_OR(d.is_wicket AND d.dismissed_player_id = mp.id) AS was_dismissed,
          COALESCE((
            SELECT COUNT(*)
            FROM delivery dw
            WHERE dw.dismissed_player_id = mp.id
              AND dw.is_undone = false
          ), 0) AS times_dismissed,
          CASE WHEN COUNT(d.id) FILTER (WHERE d.is_legal_delivery) > 0
              THEN ROUND(100.0 * COALESCE(SUM(d.batter_runs), 0) / COUNT(d.id) FILTER (WHERE d.is_legal_delivery), 2)
              ELSE 0 END AS strike_rate
      FROM match_player mp
      LEFT JOIN delivery d ON d.striker_id = mp.id AND d.is_undone = false
      GROUP BY mp.id, mp.match_id, mp.display_name, mp.team
    `);
    console.log('Done. times_dismissed now available in v_batting_stats.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
