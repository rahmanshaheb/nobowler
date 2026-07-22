// clear-test-matches.js
//
// Deletes ALL match data accumulated during testing — matches, players,
// innings, pairs, bowling spells, deliveries, notes, scorer sessions,
// and audit log entries tied to a match. Everything cascades from the
// `match` table (every other match-related table has ON DELETE CASCADE
// back to it), so a single DELETE on `match` cleans up all nine related
// tables in one transaction.
//
// REQUIRES fix-match-player-cascades.js to have been run first — the
// original schema was missing ON DELETE CASCADE on every foreign key
// pointing at match_player, which caused this exact deletion to fail
// with a constraint violation the first time it was attempted. That
// migration fixes the underlying gap; this script then works correctly.
//
// Deliberately does NOT touch: admin_account, scorer_passcode, or
// rule_section — none of these are "match data," they're account/auth/
// static-content tables, and clearing them isn't what was asked for.
//
// This only removes DATA — no tables, views, or schema structure are
// affected.
//
// Usage (from server/):
//   node db/clear-test-matches.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query('SELECT id, team_a_name, team_b_name, status FROM match');
    console.log(`Found ${existing.length} match(es) to clear:`);
    existing.forEach((m) => console.log(`  - ${m.team_a_name} vs ${m.team_b_name} (${m.status})`));

    if (existing.length === 0) {
      console.log('Nothing to clear.');
      return;
    }

    const { rowCount } = await client.query('DELETE FROM match');
    console.log(`Deleted ${rowCount} match(es). All related innings, players, deliveries, etc. were removed via cascade.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Failed to clear test data:', err.message);
  process.exit(1);
});
