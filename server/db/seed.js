// seed.js
//
// Run once after the schema is applied, to populate the singleton
// admin_account and scorer_passcode rows. Usage (from server/):
//   node db/seed.js
//
// Requires DATABASE_URL in the environment (same as the server, reads
// from server/.env via dotenv).

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // See src/db/pool.js for why this isn't gated on NODE_ENV.
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
});

// Admin password is fixed for now per explicit instruction — not exposed
// as an env var, not changeable via the app (see authRoutes.js comment).
// If this becomes configurable again later, move this to ADMIN_PASSWORD
// in .env instead of hardcoding it here.
const FIXED_ADMIN_PASSWORD = 'noBowlers';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const DEFAULT_SCORER_PASSCODE = process.env.DEFAULT_SCORER_PASSCODE || '0000';

async function seed() {
  const client = await pool.connect();
  try {
    const passwordHash = await bcrypt.hash(FIXED_ADMIN_PASSWORD, 12);

    await client.query(
      `INSERT INTO admin_account (id, email, password_hash)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [ADMIN_EMAIL, passwordHash]
    );
    console.log(`admin_account seeded (email: ${ADMIN_EMAIL}, password fixed at "noBowlers")`);

    await client.query(
      `INSERT INTO scorer_passcode (id, passcode)
       VALUES (1, $1)
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_SCORER_PASSCODE]
    );
    console.log(`scorer_passcode seeded if not already present (default: ${DEFAULT_SCORER_PASSCODE})`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
