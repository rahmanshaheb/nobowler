// reassign-over-bowler.js
//
// Fix deliveries credited to the wrong bowler (usually from the stale
// bowling_spell_id bug when the previous over's bowler was not cleared).
//
// Usage:
//   node db/reassign-over-bowler.js --match <uuid|join-code> --innings 1 --over 16 --bowler Asef
//
// Finds the match/innings, moves every non-undone delivery in that over
// onto the named bowler's bowling_spell row (creating the spell if needed).

require('dotenv').config();
const { pool } = require('../src/db/pool');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--match') {
      args.match = value;
      i += 1;
    } else if (key === '--innings') {
      args.innings = Number(value);
      i += 1;
    } else if (key === '--over') {
      args.over = Number(value);
      i += 1;
    } else if (key === '--bowler') {
      args.bowler = value;
      i += 1;
    }
  }
  return args;
}

async function resolveMatchId(client, matchRef) {
  if (/^[0-9a-f-]{36}$/i.test(matchRef)) {
    return matchRef;
  }
  const { rows } = await client.query(
    `SELECT id FROM match
     WHERE join_code::text = $1 OR team_a_name ILIKE $2 OR team_b_name ILIKE $2
     ORDER BY match_date DESC
     LIMIT 1`,
    [matchRef, `%${matchRef}%`]
  );
  if (rows.length === 0) {
    throw new Error(`No match found for "${matchRef}".`);
  }
  return rows[0].id;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.match || !args.innings || args.over == null || !args.bowler) {
    console.error('Usage: node db/reassign-over-bowler.js --match <uuid|code|name> --innings 1 --over 16 --bowler Asef');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const matchId = await resolveMatchId(client, args.match);
    const { rows: inningsRows } = await client.query(
      'SELECT id FROM innings WHERE match_id = $1 AND innings_number = $2',
      [matchId, args.innings]
    );
    if (inningsRows.length === 0) {
      throw new Error(`Innings ${args.innings} not found for match ${matchId}.`);
    }
    const inningsId = inningsRows[0].id;

    const { rows: bowlerRows } = await client.query(
      `SELECT mp.id AS bowler_id, mp.display_name
       FROM match_player mp
       WHERE mp.match_id = $1 AND mp.display_name ILIKE $2`,
      [matchId, args.bowler]
    );
    if (bowlerRows.length === 0) {
      throw new Error(`Bowler "${args.bowler}" not found in this match.`);
    }
    const { bowler_id: bowlerId, display_name: bowlerName } = bowlerRows[0];

    const { rows: spellRows } = await client.query(
      `INSERT INTO bowling_spell (innings_id, bowler_id)
       VALUES ($1, $2)
       ON CONFLICT (innings_id, bowler_id) DO UPDATE SET innings_id = EXCLUDED.innings_id
       RETURNING id`,
      [inningsId, bowlerId]
    );
    const targetSpellId = spellRows[0].id;

    const { rows: beforeRows } = await client.query(
      `SELECT mp.display_name, COUNT(*) FILTER (WHERE d.is_legal_delivery) AS legal_balls
       FROM delivery d
       JOIN bowling_spell bs ON bs.id = d.bowling_spell_id
       JOIN match_player mp ON mp.id = bs.bowler_id
       WHERE d.innings_id = $1 AND d.over_number = $2 AND d.is_undone = false
       GROUP BY mp.display_name`,
      [inningsId, args.over]
    );

    const { rowCount, rows: updatedRows } = await client.query(
      `UPDATE delivery
       SET bowling_spell_id = $1
       WHERE innings_id = $2 AND over_number = $3 AND is_undone = false
       RETURNING id, is_legal_delivery, is_wicket, wicket_type`,
      [targetSpellId, inningsId, args.over]
    );

    if (rowCount === 0) {
      throw new Error(`No deliveries found for over ${args.over} in innings ${args.innings}.`);
    }

    const { rows: afterTotals } = await client.query(
      `SELECT mp.display_name,
         COUNT(d.id) FILTER (WHERE d.is_legal_delivery) AS legal_balls
       FROM bowling_spell bs
       JOIN match_player mp ON mp.id = bs.bowler_id
       LEFT JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
       WHERE bs.innings_id = $1
         AND mp.display_name ILIKE ANY(
           SELECT DISTINCT mp2.display_name
           FROM delivery d2
           JOIN bowling_spell bs2 ON bs2.id = d2.bowling_spell_id
           JOIN match_player mp2 ON mp2.id = bs2.bowler_id
           WHERE d2.innings_id = $1
             AND (d2.over_number = $2 OR mp2.id = $3)
         )
       GROUP BY mp.display_name
       ORDER BY mp.display_name`,
      [inningsId, args.over, bowlerId]
    );

    await client.query('COMMIT');

    console.log(`Match: ${matchId}`);
    console.log(`Innings ${args.innings}, over ${args.over}`);
    console.log(`Previously credited to: ${beforeRows.map((r) => `${r.display_name} (${r.legal_balls} legal)`).join(', ') || 'unknown'}`);
    console.log(`Reassigned ${rowCount} delivery row(s) to ${bowlerName}.`);
    console.log(`Wickets in this over: ${updatedRows.filter((r) => r.is_wicket).length}`);
    console.log('Updated bowler legal-ball totals:');
    afterTotals.forEach((r) => {
      const overs = Math.floor(r.legal_balls / 6);
      const balls = r.legal_balls % 6;
      const label = balls === 0 ? String(overs) : `${overs}.${balls}`;
      console.log(`  ${r.display_name}: ${r.legal_balls} legal balls (${label} overs)`);
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
