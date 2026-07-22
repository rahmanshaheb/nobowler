// diagnose-delivery-rows.js
//
// READ-ONLY diagnostic: lists every individual delivery row for the
// MOST RECENT match's first innings, in order, showing the raw
// underlying data (not an aggregate). Makes zero changes to the
// database. Used to find the actual source of an implausibly large
// innings total — either a single delivery with a corrupted
// total_runs value, or an unexpectedly large NUMBER of rows (e.g.
// duplicate insertions), since v_innings_totals' own SQL has already
// been confirmed correct and simple (a plain LEFT JOIN + SUM, no
// fan-out source).
//
// Usage (from server/):
//   node db/diagnose-delivery-rows.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    const { rows: matches } = await client.query(
      `SELECT id, team_a_name, team_b_name, created_at FROM match ORDER BY created_at DESC LIMIT 1`
    );
    if (matches.length === 0) {
      console.log('No matches found.');
      return;
    }
    const match = matches[0];
    console.log(`Most recent match: ${match.team_a_name} vs ${match.team_b_name} (${match.id})`);

    const { rows: inningsRows } = await client.query(
      `SELECT id, innings_number FROM innings WHERE match_id = $1 AND innings_number = 1`,
      [match.id]
    );
    if (inningsRows.length === 0) {
      console.log('No first innings found for this match.');
      return;
    }
    const inningsId = inningsRows[0].id;
    console.log(`Innings 1 id: ${inningsId}`);

    const { rows: deliveries } = await client.query(
      `SELECT sequence_number, over_number, ball_number_in_over, delivery_type,
              zone_hit, batters_crossed, zone_runs, crossing_run,
              extra_mandatory_run, manual_run_adjustment,
              batter_runs, extra_runs, total_runs, is_wicket, penalty_runs,
              is_undone
       FROM delivery
       WHERE innings_id = $1
       ORDER BY sequence_number ASC`,
      [inningsId]
    );

    console.log(`Total delivery rows (including any undone): ${deliveries.length}`);
    const activeRows = deliveries.filter((d) => !d.is_undone);
    console.log(`Active (not undone) rows: ${activeRows.length}`);
    const sumTotalRuns = activeRows.reduce((acc, d) => acc + Number(d.total_runs), 0);
    console.log(`Sum of total_runs across active rows: ${sumTotalRuns}`);
    console.log('');
    console.log('--- Row-by-row (sequence_number | over.ball | type | total_runs | batter_runs | extra_runs | is_wicket | penalty_runs | is_undone) ---');
    deliveries.forEach((d) => {
      console.log(
        `${d.sequence_number} | ${d.over_number}.${d.ball_number_in_over} | ${d.delivery_type} | total_runs=${d.total_runs} | batter_runs=${d.batter_runs} | extra_runs=${d.extra_runs} | is_wicket=${d.is_wicket} | penalty_runs=${d.penalty_runs} | is_undone=${d.is_undone}`
      );
    });
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Failed to read delivery rows:', err.message);
  process.exit(1);
});
