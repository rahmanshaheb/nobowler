// fix-match-player-cascades.js
//
// One-time migration: adds ON DELETE CASCADE to every foreign key that
// references match_player(id), none of which had it originally. This
// is what caused clear-test-matches.js to fail with a foreign key
// violation — deleting from `match` cascades to `match_player`, but
// without CASCADE on the FKs below, Postgres could try to remove a
// match_player row while pair_innings/delivery/etc. still pointed to
// it, since cascade ordering across multiple tables isn't guaranteed.
//
// This only changes constraint BEHAVIOR (what happens on delete) — it
// does not alter any table structure, column, or existing data.
//
// Usage (from server/):
//   node db/fix-match-player-cascades.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    // Look up the REAL constraint names from Postgres rather than trust
    // the guessed defaults above — auto-generated names can vary
    // slightly, so this confirms each one before attempting to drop it.
    const { rows: actualConstraints } = await client.query(`
      SELECT tc.table_name, tc.constraint_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'match_player'
    `);

    console.log(`Found ${actualConstraints.length} foreign key(s) referencing match_player:`);
    actualConstraints.forEach((c) => console.log(`  - ${c.table_name}.${c.column_name} (${c.constraint_name})`));

    for (const c of actualConstraints) {
      await client.query(`ALTER TABLE ${c.table_name} DROP CONSTRAINT ${c.constraint_name}`);
      await client.query(
        `ALTER TABLE ${c.table_name} ADD CONSTRAINT ${c.constraint_name} FOREIGN KEY (${c.column_name}) REFERENCES match_player(id) ON DELETE CASCADE`
      );
      console.log(`  Fixed: ${c.table_name}.${c.column_name}`);
    }

    console.log('All match_player foreign keys now cascade on delete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
