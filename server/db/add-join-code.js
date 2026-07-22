// add-join-code.js
//
// One-time migration: adds a join_code SMALLINT UNIQUE column to the
// match table and backfills any existing matches with unique random
// 4-digit codes (1000-9999). New matches get their code assigned at
// creation time (see createMatch in matchController.js).
//
// Usage (from server/):
//   node db/add-join-code.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Adding join_code column...');
    await client.query(`ALTER TABLE match ADD COLUMN IF NOT EXISTS join_code SMALLINT`);

    // Backfill any existing rows that don't have a code yet.
    const { rows: uncodedMatches } = await client.query(
      `SELECT id FROM match WHERE join_code IS NULL ORDER BY created_at`
    );

    if (uncodedMatches.length === 0) {
      console.log('No existing matches to backfill.');
    } else {
      console.log(`Backfilling ${uncodedMatches.length} existing match(es)...`);
      const used = new Set();
      for (const match of uncodedMatches) {
        let code;
        let attempts = 0;
        do {
          code = Math.floor(Math.random() * 9000) + 1000;
          attempts++;
          if (attempts > 500) throw new Error('Could not find a unique join code after 500 attempts.');
        } while (used.has(code));
        used.add(code);
        await client.query(`UPDATE match SET join_code = $1 WHERE id = $2`, [code, match.id]);
        console.log(`  Match ${match.id.slice(0, 8)}... → code ${code}`);
      }
    }

    // Add the unique constraint after backfilling to avoid mid-migration conflicts.
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'match_join_code_key'
        ) THEN
          ALTER TABLE match ADD CONSTRAINT match_join_code_key UNIQUE (join_code);
        END IF;
      END $$;
    `);

    console.log('Done. join_code column is live and unique-constrained.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
