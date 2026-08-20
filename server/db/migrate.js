// migrate.js — idempotent schema migrations applied before the server starts.
//
// Render (and any fresh deploy) runs `npm start`, which calls runMigrations()
// from index.js so hosted databases pick up view fixes without manual psql.
//
// Usage (from server/):
//   node db/migrate.js

require('dotenv').config();
const { pool } = require('../src/db/pool');

const MIGRATIONS = [
  {
    id: '2026-08-11_bowler_wicket_credit',
    description: 'Credit caught and stumped wickets to bowlers in v_bowling_stats',
    async up(client) {
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
    },
  },
  {
    id: '2026-08-20_bowler_activation',
    description: 'Require explicit bowler pick after each over (activated_after_sequence)',
    async up(client) {
      await client.query(`
        ALTER TABLE bowling_spell
        ADD COLUMN IF NOT EXISTS activated_after_sequence INTEGER NOT NULL DEFAULT 0
      `);
    },
  },
];

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of MIGRATIONS) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE id = $1',
        [migration.id]
      );
      if (rows.length > 0) continue;

      console.log(`Running migration: ${migration.id} — ${migration.description}`);
      await migration.up(client);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      console.log(`Migration applied: ${migration.id}`);
    }
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .then(() => {
      console.log('Migrations complete.');
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}
