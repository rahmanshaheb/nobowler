/**
 * Test script: Creates a dummy match, scores with dismissals,
 * validates data integrity, then deletes everything.
 *
 * Run: node src/utils/testValidation.js
 */

const { pool } = require('../db/pool');
const { validateMatchData } = require('./validateMatchData');
const crypto = require('crypto');

async function runTest() {
  const client = await pool.connect();

  try {
    console.log('\n=== DATA VALIDATION TEST ===\n');

    // 1. Create test match
    const matchId = crypto.randomUUID();
    console.log('1. Creating test match...');
    await client.query(
      `INSERT INTO match (id, team_a_name, team_b_name, batting_first_team, status, wide_count_enabled)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [matchId, 'Test Team A', 'Test Team B', 'A', 'live', true]
    );

    // 2. Create players
    console.log('2. Adding players...');
    const players = [];
    for (let i = 1; i <= 4; i++) {
      const playerId = crypto.randomUUID();
      const team = i <= 2 ? 'A' : 'B';
      await client.query(
        `INSERT INTO match_player (id, match_id, team, display_name)
         VALUES ($1, $2, $3, $4)`,
        [playerId, matchId, team, `Player${i}`]
      );
      players.push({ id: playerId, team, name: `Player${i}` });
    }

    // 3. Start innings 1
    console.log('3. Starting innings 1...');
    const inningsId = crypto.randomUUID();
    await client.query(
      `INSERT INTO innings (id, match_id, innings_number, batting_team)
       VALUES ($1, $2, $3, $4)`,
      [inningsId, matchId, 1, 'A']
    );

    // 4. Create pair (Team A batters)
    console.log('4. Creating batting pair...');
    const pairId = crypto.randomUUID();
    await client.query(
      `INSERT INTO pair_innings (id, innings_id, pair_number, batter_1_id, batter_2_id, stint_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pairId, inningsId, 1, players[0].id, players[1].id, 1]
    );

    await client.query(
      `INSERT INTO pair_innings_state (pair_innings_id, current_striker_id, current_non_striker_id)
       VALUES ($1, $2, $3)`,
      [pairId, players[0].id, players[1].id]
    );

    // 5. Create bowling spell
    console.log('5. Creating bowling spell...');
    const bowlingSpellId = crypto.randomUUID();
    await client.query(
      `INSERT INTO bowling_spell (id, innings_id, bowler_id, over_number, legal_balls_bowled)
       VALUES ($1, $2, $3, $4, $5)`,
      [bowlingSpellId, inningsId, players[2].id, 1, 1]
    );

    // 6. Record deliveries with dismissals
    console.log('6. Recording deliveries with dismissals...');

    // Delivery 1: Legal ball (no wicket)
    await client.query(
      `INSERT INTO delivery (id, innings_id, bowling_spell_id, pair_innings_id, sequence_number, over_number, ball_number, is_wicket, runs, deliveryType)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [crypto.randomUUID(), inningsId, bowlingSpellId, pairId, 1, 1, 1, false, 1, 'normal']
    );

    // Delivery 2: Dismissed (LINKED to bowling_spell - correct)
    await client.query(
      `INSERT INTO delivery (id, innings_id, bowling_spell_id, pair_innings_id, sequence_number, over_number, ball_number, is_wicket, wicket_type, dismissed_player_id, runs, deliveryType)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [crypto.randomUUID(), inningsId, bowlingSpellId, pairId, 2, 1, 2, true, 'caught', players[0].id, 0, 'normal']
    );

    // Delivery 3: Dismissed but NO bowling_spell_id (SIMULATING BUG)
    await client.query(
      `INSERT INTO delivery (id, innings_id, bowling_spell_id, pair_innings_id, sequence_number, over_number, ball_number, is_wicket, wicket_type, dismissed_player_id, runs, deliveryType)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [crypto.randomUUID(), inningsId, NULL, pairId, 3, 1, 3, true, 'bowled', players[1].id, 0, 'normal']
    );

    // Update innings total wickets
    await client.query(
      `UPDATE innings SET total_wickets = 2 WHERE id = $1`,
      [inningsId]
    );

    // 7. Run validation
    console.log('7. Running validation...\n');
    const validation = await validateMatchData(matchId, pool);

    console.log('VALIDATION RESULTS:');
    console.log('==================');
    console.log(`Valid: ${validation.isValid}`);
    console.log(`Issues found: ${validation.issues.length}\n`);

    if (validation.issues.length > 0) {
      validation.issues.forEach((issue, i) => {
        console.log(`Issue ${i + 1}:`);
        console.log(`  Type: ${issue.type}`);
        console.log(`  Severity: ${issue.severity || 'INFO'}`);
        console.log(`  Message: ${issue.message}\n`);
      });
    }

    // 8. Cleanup - delete test match
    console.log('8. Cleaning up test data...');
    await client.query('DELETE FROM delivery WHERE innings_id = $1', [inningsId]);
    await client.query('DELETE FROM bowling_spell WHERE innings_id = $1', [inningsId]);
    await client.query('DELETE FROM pair_innings_state WHERE pair_innings_id = $1', [pairId]);
    await client.query('DELETE FROM pair_innings WHERE innings_id = $1', [inningsId]);
    await client.query('DELETE FROM innings WHERE id = $1', [inningsId]);
    await client.query('DELETE FROM match_player WHERE match_id = $1', [matchId]);
    await client.query('DELETE FROM match WHERE id = $1', [matchId]);

    console.log('✓ Test data deleted. Database is clean.\n');
    console.log('=== TEST COMPLETE ===\n');

  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

runTest();
