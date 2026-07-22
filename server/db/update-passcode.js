// update-passcode.js
//
// Updates the scorer passcode in the database.
// Edit NEW_PASSCODE below, then run from server/:
//   node db/update-passcode.js

require('dotenv').config();
const { Pool } = require('pg');

const NEW_PASSCODE = '0000';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    const { rowCount } = await client.query(
      `UPDATE scorer_passcode SET passcode = $1 WHERE id = 1`,
      [NEW_PASSCODE]
    );
    if (rowCount === 0) {
      console.error('No passcode row found — has the database been seeded?');
      process.exit(1);
    }
    console.log(`Passcode updated to: ${NEW_PASSCODE}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
