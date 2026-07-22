// add-three-dots-wicket.js
//
// Two things:
// 1. Drops the existing CHECK constraint on delivery.wicket_type and
//    recreates it with 'three_dots' added.
// 2. Updates v_bowling_stats to credit the bowler for three_dots wickets.
//
// Usage (from server/):
//   node db/add-three-dots-wicket.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    // Find the constraint name first
    const { rows } = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'delivery'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%wicket_type%'
    `);

    if (rows.length > 0) {
      const constraintName = rows[0].conname;
      console.log(`Dropping constraint: ${constraintName}`);
      await client.query(`ALTER TABLE delivery DROP CONSTRAINT "${constraintName}"`);
    }

    console.log('Adding updated CHECK constraint with three_dots...');
    await client.query(`
      ALTER TABLE delivery
      ADD CONSTRAINT delivery_wicket_type_check
      CHECK (wicket_type IN ('bowled','caught_and_bowled','caught','run_out','stumped','three_dots'))
    `);

    console.log('Updating v_bowling_stats view...');
    await client.query(`
      CREATE OR REPLACE VIEW v_bowling_stats AS
      SELECT
        mp.id AS player_id, mp.match_id, mp.display_name, mp.team, bs.innings_id,
        COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS legal_balls_bowled,
        COALESCE(SUM(d.total_runs), 0) + COALESCE(SUM(d.penalty_runs), 0) AS runs_conceded,
        COALESCE(SUM(CASE WHEN d.is_wicket AND d.wicket_type IN ('bowled','caught_and_bowled','three_dots') THEN 1 ELSE 0 END), 0) AS bowler_credited_wickets,
        COALESCE(SUM(CASE WHEN d.is_wicket THEN 1 ELSE 0 END), 0) AS total_wickets_in_spell
      FROM match_player mp
      JOIN bowling_spell bs ON bs.bowler_id = mp.id
      LEFT JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
      GROUP BY mp.id, mp.match_id, mp.display_name, mp.team, bs.innings_id
    `);

    console.log('Done. three_dots wickets will now save and credit the bowler.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
