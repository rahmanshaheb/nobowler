// apply-schema.js
//
// Runs db/schema.sql against the database in DATABASE_URL. Exists so we
// don't need a separate psql installation just to apply the schema —
// the `pg` package we already depend on can execute raw SQL files directly.
//
// Usage (from server/):
//   node db/apply-schema.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render requires SSL on external connections (the connection Render
  // docs/community confirm needs `ssl: { rejectUnauthorized: false }`
  // when connecting from outside Render's own network, which is exactly
  // our situation running this from a laptop). Always-on here is
  // intentional, not a placeholder.
  ssl: { rejectUnauthorized: false },
});

async function applySchema() {
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log(`Applying schema from ${schemaPath} ...`);
    await client.query(sql);
    console.log('Schema applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

applySchema().catch((err) => {
  console.error('Failed to apply schema:', err.message);
  process.exit(1);
});
