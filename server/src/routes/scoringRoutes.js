// scoringRoutes.js
const express = require('express');
const {
  createMatch,
  addPlayers,
  renamePlayer,
  renameTeam,
  startInnings,
  startPair,
  startOrGetBowlingSpell,
  rehydrateMatch,
  getBowlerOvers,
  getCurrentOverDeliveries,
} = require('../controllers/matchController');
const { recordDelivery, undoDelivery } = require('../controllers/deliveryController');
const { requireUuidParam } = require('../middleware/validateUuid');

const router = express.Router();

// NOTE: passcode verification happens once at the "Create new match" gate
// (see authRoutes.js /scorer-passcode/verify) per the design flow, not on
// every single scoring request — re-checking on every ball would be a poor
// UX match to "Enter match passcode -> Next" happening once at setup.
// If you want per-request passcode enforcement instead, wrap these routes
// with requireScorerPasscode from middleware/auth.js.

router.post('/matches', createMatch);
router.get('/matches/:matchId/rehydrate', requireUuidParam('matchId'), rehydrateMatch);
router.post('/matches/:matchId/players', requireUuidParam('matchId'), addPlayers);
router.patch('/matches/:matchId/players/:playerId', requireUuidParam('matchId', 'playerId'), renamePlayer);
router.patch('/matches/:matchId/team-name', requireUuidParam('matchId'), renameTeam);
router.patch('/matches/:matchId/wide-count', requireUuidParam('matchId'), async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { wideCountEnabled } = req.body;
    const { pool } = require('../db/pool');
    await pool.query(
      'UPDATE match SET wide_count_enabled = $1 WHERE id = $2',
      [wideCountEnabled !== false, matchId]
    );
    res.json({ wideCountEnabled: wideCountEnabled !== false });
  } catch (err) { next(err); }
});
router.post('/matches/:matchId/innings', requireUuidParam('matchId'), startInnings);
router.post('/matches/:matchId/innings/:inningsId/pairs', requireUuidParam('matchId', 'inningsId'), startPair);
router.post('/matches/:matchId/innings/:inningsId/bowling-spells', requireUuidParam('matchId', 'inningsId'), startOrGetBowlingSpell);
router.get('/matches/:matchId/innings/:inningsId/bowler-overs', requireUuidParam('matchId', 'inningsId'), getBowlerOvers);
router.get('/matches/:matchId/innings/:inningsId/over-deliveries', requireUuidParam('matchId', 'inningsId'), getCurrentOverDeliveries);
router.post('/innings/:inningsId/deliveries', requireUuidParam('inningsId'), recordDelivery);
router.post('/deliveries/:deliveryId/undo', requireUuidParam('deliveryId'), undoDelivery);

router.patch('/matches/:matchId/swap-batting', requireUuidParam('matchId'), async (req, res, next) => {
  try {
    const { pool, withTransaction } = require('../db/pool');
    const { matchId } = req.params;

    const result = await withTransaction(async (client) => {
      // Block if any delivery exists — cannot swap after play has started
      const { rows: deliveryCheck } = await client.query(
        `SELECT 1 FROM delivery d
         JOIN innings i ON i.id = d.innings_id
         WHERE i.match_id = $1 AND d.is_undone = false
         LIMIT 1`,
        [matchId]
      );
      if (deliveryCheck.length > 0) {
        throw Object.assign(
          new Error('Cannot swap batting teams after a ball has been bowled.'),
          { statusCode: 422 }
        );
      }

      // Find the current (only) innings
      const { rows: inningsRows } = await client.query(
        `SELECT id, batting_team FROM innings WHERE match_id = $1 ORDER BY innings_number LIMIT 1`,
        [matchId]
      );
      if (inningsRows.length === 0) {
        throw Object.assign(new Error('No innings found.'), { statusCode: 404 });
      }
      const innings = inningsRows[0];
      const newBattingTeam = innings.batting_team === 'A' ? 'B' : 'A';

      // First two players from new batting team alphabetically
      const { rows: players } = await client.query(
        `SELECT id, display_name FROM match_player
         WHERE match_id = $1 AND team = $2
         ORDER BY display_name ASC`,
        [matchId, newBattingTeam]
      );
      if (players.length < 2) {
        throw Object.assign(
          new Error('New batting team needs at least 2 players.'),
          { statusCode: 422 }
        );
      }
      const [batter1, batter2] = players;

      // Flip innings batting_team and match batting_first_team
      await client.query(`UPDATE innings SET batting_team = $1 WHERE id = $2`, [newBattingTeam, innings.id]);
      await client.query(`UPDATE match SET batting_first_team = $1 WHERE id = $2`, [newBattingTeam, matchId]);

      // Update the existing pair and its state
      const { rows: pairRows } = await client.query(
        `SELECT id FROM pair_innings WHERE innings_id = $1 ORDER BY pair_number, stint_number LIMIT 1`,
        [innings.id]
      );
      if (pairRows.length > 0) {
        const pairId = pairRows[0].id;
        await client.query(
          `UPDATE pair_innings SET batter_1_id = $1, batter_2_id = $2 WHERE id = $3`,
          [batter1.id, batter2.id, pairId]
        );
        await client.query(
          `UPDATE pair_innings_state SET current_striker_id = $1, current_non_striker_id = $2 WHERE pair_innings_id = $3`,
          [batter1.id, batter2.id, pairId]
        );
      }

      // Clear deliveries then bowling spells — deliveries reference spells via FK
      // so they must go first. All deliveries here are is_undone=true (the check
      // above guarantees no live deliveries exist).
      await client.query(
        `DELETE FROM delivery WHERE innings_id = $1`,
        [innings.id]
      );
      await client.query(`DELETE FROM bowling_spell WHERE innings_id = $1`, [innings.id]);

      return {
        battingTeam: newBattingTeam,
        pairInningsId: pairRows[0]?.id ?? null,
        batter1Id: batter1.id,
        batter2Id: batter2.id,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

router.patch('/matches/:matchId/complete', requireUuidParam('matchId'), async (req, res, next) => {
  try {
    const { pool } = require('../db/pool');
    await pool.query(
      "UPDATE match SET status = 'completed' WHERE id = $1",
      [req.params.matchId]
    );
    res.json({ status: 'completed' });
  } catch (err) { next(err); }
});

module.exports = router;
