// fix-bowler-wicket-credit.js
// One-time manual runner — prefer `npm run migrate` or a normal server start,
// which applies the same migration automatically via db/migrate.js.
//
// Run: node db/fix-bowler-wicket-credit.js

require('dotenv').config();
const { pool } = require('../src/db/pool');
const { runMigrations } = require('./migrate');

runMigrations()
  .then(() => pool.end())
  .then(() => {
    console.log('Done. Bowler wickets now credit bowled, caught, c&b, stumped, and three_dots.');
  })
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
