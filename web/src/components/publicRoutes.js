// publicRoutes.js
const express = require('express');
const { pool } = require('../db/pool');
const { totalOversForSquadSize } = require('../utils/scoringEngine');

const router = express.Router();

/**
 * GET /api/public/matches
 * "Previous matches" list — most recent first, with live status flag.
 */
router.get('/matches', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, match_date, team_a_name, team_b_name, status, result_summary
       FROM match
       WHERE deleted_at IS NULL
       ORDER BY match_date DESC, created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/matches/:matchId
 * Full match summary: both teams' batting/bowling lines, per the
 * "3 June 2026 / Team A won by 19 runs" screen.
 */
router.get('/matches/:matchId', async (req, res, next) => {
  const { matchId } = req.params;
  try {
    const { rows: matchRows } = await pool.query(
      'SELECT * FROM match WHERE id = $1 AND deleted_at IS NULL',
      [matchId]
    );
    if (matchRows.length === 0) return res.status(404).json({ error: 'Match not found.' });

    const { rows: battingStats } = await pool.query(
      'SELECT * FROM v_batting_stats WHERE match_id = $1 ORDER BY team, runs_scored DESC',
      [matchId]
    );
    const { rows: bowlingStats } = await pool.query(
      'SELECT * FROM v_bowling_stats WHERE match_id = $1',
      [matchId]
    );
    const { rows: innings } = await pool.query(
      'SELECT * FROM v_innings_totals WHERE match_id = $1 ORDER BY innings_number',
      [matchId]
    );
    const { rows: pairStats } = await pool.query(
      `SELECT
         vpit.pair_innings_id,
         vpit.innings_id,
         vpit.pair_number,
         vpit.pair_total_runs,
         vpit.legal_balls_faced,
         mp1.display_name AS batter_1_name,
         mp2.display_name AS batter_2_name,
         i.innings_number,
         i.batting_team
       FROM v_pair_innings_totals vpit
       JOIN innings i ON i.id = vpit.innings_id
       JOIN match_player mp1 ON mp1.id = vpit.batter_1_id
       JOIN match_player mp2 ON mp2.id = vpit.batter_2_id
       WHERE i.match_id = $1
       ORDER BY i.innings_number, vpit.pair_number`,
      [matchId]
    );

    const { rows: zoneStats } = await pool.query(
      `SELECT i.innings_number, d.zone_hit, SUM(d.batter_runs) AS runs
       FROM delivery d
       JOIN innings i ON i.id = d.innings_id
       WHERE i.match_id = $1 AND d.is_undone = false AND d.zone_hit IS NOT NULL
       GROUP BY i.innings_number, d.zone_hit
       ORDER BY i.innings_number, d.zone_hit`,
      [matchId]
    );

    const { rows: fieldingStats } = await pool.query(
      `SELECT i.innings_number, mp.display_name AS fielder,
              d.wicket_type, COUNT(*) AS count
       FROM delivery d
       JOIN innings i ON i.id = d.innings_id
       JOIN match_player mp ON mp.id = d.fielder_id
       WHERE i.match_id = $1 AND d.is_undone = false AND d.fielder_id IS NOT NULL
       GROUP BY i.innings_number, mp.display_name, d.wicket_type
       ORDER BY i.innings_number, count DESC`,
      [matchId]
    );

    res.json({ match: matchRows[0], battingStats, bowlingStats, innings, pairStats, zoneStats, fieldingStats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/matches/:matchId/players/:playerId
 * Individual player detail screen (batting / bowling for one player in a match).
 */
router.get('/matches/:matchId/players/:playerId', async (req, res, next) => {
  const { matchId, playerId } = req.params;
  try {
    const { rows: playerRows } = await pool.query(
      'SELECT * FROM match_player WHERE id = $1 AND match_id = $2',
      [playerId, matchId]
    );
    if (playerRows.length === 0) return res.status(404).json({ error: 'Player not found.' });

    const { rows: battingRows } = await pool.query(
      'SELECT * FROM v_batting_stats WHERE player_id = $1',
      [playerId]
    );
    const { rows: bowlingRows } = await pool.query(
      'SELECT * FROM v_bowling_stats WHERE player_id = $1',
      [playerId]
    );

    // "Most run from Zone X" — the zone that produced the most total runs
    // for this player as a batter.
    const { rows: zoneBreakdown } = await pool.query(
      `SELECT zone_hit, SUM(batter_runs) AS runs_from_zone
       FROM delivery
       WHERE striker_id = $1 AND is_undone = false AND zone_hit IS NOT NULL
       GROUP BY zone_hit
       ORDER BY runs_from_zone DESC
       LIMIT 1`,
      [playerId]
    );

    // Pair partnerships — which partners this player batted with, and
    // the combined pair total for those stints ("Paired with Emon, Asif
    // and Rasel: 42").
    const { rows: partnerships } = await pool.query(
      `SELECT
         CASE WHEN pi.batter_1_id = $1 THEN pi.batter_2_id ELSE pi.batter_1_id END AS partner_id,
         mp.display_name AS partner_name,
         vpit.pair_total_runs
       FROM pair_innings pi
       JOIN v_pair_innings_totals vpit ON vpit.pair_innings_id = pi.id
       JOIN match_player mp ON mp.id = CASE WHEN pi.batter_1_id = $1 THEN pi.batter_2_id ELSE pi.batter_1_id END
       WHERE pi.batter_1_id = $1 OR pi.batter_2_id = $1`,
      [playerId]
    );

    res.json({
      player: playerRows[0],
      batting: battingRows[0] || null,
      bowling: bowlingRows,
      mostRunsFromZone: zoneBreakdown[0]?.zone_hit ?? null,
      partnerships,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/matches/:matchId/live
 * TV/Live view polling endpoint. Returns the current innings state.
 * For true real-time push, layer a WebSocket broadcast on top of the
 * same delivery-insert path (see index.js) — this REST endpoint is the
 * fallback/initial-load path.
 */
router.get('/matches/:matchId/live', async (req, res, next) => {
  const { matchId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT vit.*, m.team_a_name, m.team_b_name, m.status
       FROM v_innings_totals vit
       JOIN match m ON m.id = vit.match_id
       WHERE vit.match_id = $1
       ORDER BY vit.innings_number DESC
       LIMIT 1`,
      [matchId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No live innings for this match.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/rules
 * The public rulebook page — ordered sections.
 */
router.get('/rules', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT title, body FROM rule_section ORDER BY sort_order');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/pair-innings/:pairInningsId/state
 * Returns who's currently on strike for this pair. Used by the scorer
 * UI to re-sync after an UNDO, since undoing a delivery can change who
 * should be facing the next ball.
 */
router.get('/pair-innings/:pairInningsId/state', async (req, res, next) => {
  const { pairInningsId } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT current_striker_id, current_non_striker_id FROM pair_innings_state WHERE pair_innings_id = $1',
      [pairInningsId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No state found for this pair.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/live-now
 * Returns the currently in-progress match (status='live'), with
 * everything a TV display needs in one request: team names, current
 * innings totals, and who's currently batting/bowling. Built
 * specifically for the TV view's polling loop — no matchId required,
 * since there's only ever one live match at a time tonight.
 *
 * 404 if no match is currently live (e.g. between innings setup, or
 * after the match ends) — the TV view shows a "waiting for play to
 * start" message in that case rather than treating it as a real error.
 */
router.get('/live-now', async (req, res, next) => {
  try {
    const { rows: matchRows } = await pool.query(
      "SELECT id, team_a_name, team_b_name, status FROM match WHERE status = 'live' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
    );
    if (matchRows.length === 0) {
      return res.status(404).json({ error: 'No match is currently live.' });
    }
    const match = matchRows[0];

    const { rows: inningsRows } = await pool.query(
      `SELECT vit.*
       FROM v_innings_totals vit
       WHERE vit.match_id = $1
       ORDER BY vit.innings_number DESC
       LIMIT 1`,
      [match.id]
    );
    if (inningsRows.length === 0) {
      return res.status(404).json({ error: 'No live innings for this match yet.' });
    }
    const innings = inningsRows[0];

    // Target runs for the chasing team (innings 2 only) — lives on the
    // raw innings table, not v_innings_totals, so needs its own lookup.
    const { rows: targetRows } = await pool.query('SELECT target_runs FROM innings WHERE id = $1', [innings.innings_id]);
    const targetRuns = targetRows[0]?.target_runs ?? null;

    // Effective, ROLLED-OVER over/ball numbers — confirmed explicit
    // pattern, mirroring the scoring screen's BALLS header exactly: the
    // moment the 6th legal ball of an over completes, the display
    // should show the NEXT over starting (e.g. "1.0"), without waiting
    // for the backend to actually advance last_over_number (which only
    // happens once a delivery is recorded in the new over). Computed
    // once here, used both for the runThisOver query below (so it
    // correctly returns 0 for the brand new, not-yet-started over
    // rather than the just-finished over's total) and the response.
    const rawOverNumber = innings.last_over_number ?? 0;
    const rawBallNumber = innings.last_ball_number ?? 0;
    const effectiveOverNumber = rawBallNumber === 6 ? rawOverNumber + 1 : rawOverNumber;
    const effectiveBallNumber = rawBallNumber === 6 ? 0 : rawBallNumber;

    // Runs scored so far in the CURRENT (possibly incomplete) over —
    // shown as "RUN THIS OVER" on the TV view. Computed directly from
    // deliveries rather than a view, since this resets every over and
    // isn't a running/cumulative total like everything else here.
    // Scoped by effectiveOverNumber (not the raw value) — confirmed
    // explicitly: the instant the over rolls over, this should reset to
    // 0 immediately, not keep showing the just-finished over's total.
    const { rows: thisOverRows } = await pool.query(
      `SELECT COALESCE(SUM(total_runs), 0) + COALESCE(SUM(penalty_runs), 0) AS run_this_over
       FROM delivery
       WHERE innings_id = $1 AND over_number = $2 AND is_undone = false`,
      [innings.innings_id, effectiveOverNumber]
    );
    const runThisOver = parseInt(thisOverRows[0]?.run_this_over ?? '0', 10);

    // Current striker/non-striker: most recent pair_innings for this
    // innings, joined to its state row and player names. Also pulls the
    // pair's combined total (v_pair_innings_totals, fixed to include
    // penalty_runs so this can correctly go negative after a wicket).
    const { rows: pairRows } = await pool.query(
      `SELECT
         pis.current_striker_id, sp.display_name AS striker_name,
         pis.current_non_striker_id, nsp.display_name AS non_striker_name,
         vpit.pair_total_runs
       FROM pair_innings pi
       JOIN pair_innings_state pis ON pis.pair_innings_id = pi.id
       LEFT JOIN match_player sp ON sp.id = pis.current_striker_id
       LEFT JOIN match_player nsp ON nsp.id = pis.current_non_striker_id
       LEFT JOIN v_pair_innings_totals vpit ON vpit.pair_innings_id = pi.id
       WHERE pi.innings_id = $1
       ORDER BY pi.pair_number DESC, pi.stint_number DESC
       LIMIT 1`,
      [innings.innings_id]
    );

    // Current bowler: most recently created bowling_spell for this
    // innings. Since bowling_spell has no created_at column, we infer
    // "most recent" via the most recent delivery's bowling_spell_id —
    // more reliable than spell creation order if a previous bowler is
    // ever brought back (not expected tonight, but safer).
    const { rows: bowlerRows } = await pool.query(
      `SELECT mp.display_name AS bowler_name
       FROM delivery d
       JOIN bowling_spell bs ON bs.id = d.bowling_spell_id
       JOIN match_player mp ON mp.id = bs.bowler_id
       WHERE d.innings_id = $1 AND d.is_undone = false
       ORDER BY d.sequence_number DESC
       LIMIT 1`,
      [innings.innings_id]
    );

    // Total overs allowed this innings, derived from the BATTING team's
    // squad size → ceil(squadSize / 2) pairs × 4 overs (8–12 players per team).
    // Wrapped in try/catch rather than letting an unsupported squad size
    // (e.g. 9) crash the whole endpoint — the TV/scoring UI just won't
    // show an overs-limit banner in that case, which is an acceptable
    // degradation until that rule variant gets built.
    const { rows: squadRows } = await pool.query(
      'SELECT COUNT(*) AS squad_size FROM match_player WHERE match_id = $1 AND team = $2',
      [match.id, innings.batting_team]
    );
    const squadSize = parseInt(squadRows[0]?.squad_size ?? '0', 10);
    let totalOvers = null;
    try {
      totalOvers = totalOversForSquadSize(squadSize);
    } catch {
      totalOvers = null;
    }

    res.json({
      matchId: match.id,
      inningsId: innings.innings_id,
      teamAName: match.team_a_name,
      teamBName: match.team_b_name,
      battingTeam: innings.batting_team,
      inningsNumber: innings.innings_number,
      // Number() coercion here and below: total_runs/total_wickets come
      // from v_innings_totals' SUM(), which Postgres returns as bigint
      // — node-postgres deserializes bigint as a STRING (not a number)
      // to avoid silently losing precision on huge values. Left
      // uncoerced, these "happen to work" in places that don't do
      // arithmetic on them, but carry the exact same latent risk that
      // caused the target_runs bug just above (a string flowing
      // unnoticed into a `+`, silently concatenating instead of
      // adding). Coercing every aggregate-derived value at the point
      // it's read — not just where arithmetic currently happens to
      // occur — is the project's own established fix for this bug
      // family, applied consistently here rather than leaving the rest
      // as a latent trap for a future calculation.
      totalRuns: Number(innings.total_runs),
      totalWickets: Number(innings.total_wickets),
      overNumber: effectiveOverNumber,
      ballNumberInOver: effectiveBallNumber,
      strikerName: pairRows[0]?.striker_name ?? null,
      nonStrikerName: pairRows[0]?.non_striker_name ?? null,
      bowlerName: bowlerRows[0]?.bowler_name ?? null,
      totalOvers,
      // Only present on innings 2 (the chasing team) — null on innings 1,
      // since there's no target yet. Can go negative once the target is
      // passed, since this format plays out all overs regardless (rule:
      // the chasing team never stops early just for reaching the target).
      targetRuns,
      runsRequired: targetRuns != null ? targetRuns - Number(innings.total_runs) : null,
      runThisOver,
      // Current pair's combined runs, including any wicket penalty
      // they've incurred — can go negative (e.g. a pair that's lost a
      // wicket with few runs scored). Also SUM()-derived (see comment
      // above) — coerced for the same reason.
      pairTotalRuns: Number(pairRows[0]?.pair_total_runs ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/matches/lookup/:joinCode
 *
 * "Join a match" entry point: accepts the 4-digit numeric join code
 * (generated when the match was created, shown in the hamburger menu)
 * and returns the full UUID so the joining device can call
 * /matches/:matchId/rehydrate.
 */
router.get('/matches/lookup/:joinCode', async (req, res, next) => {
  const { joinCode } = req.params;
  if (!joinCode || !/^\d{4}$/.test(joinCode)) {
    return res.status(400).json({ error: 'Join code must be exactly 4 digits.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, team_a_name, team_b_name, status
       FROM match
       WHERE join_code = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [parseInt(joinCode, 10)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No match found with that code. Check the number and try again.' });
    res.json({ matchId: rows[0].id, teamAName: rows[0].team_a_name, teamBName: rows[0].team_b_name, status: rows[0].status });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/matches/:matchId/innings/:inningsId/over-deliveries
 *
 * Public mirror of the authenticated over-deliveries endpoint — needed
 * by the TV live view (LiveViewScreen.jsx) which has no auth token.
 * The authenticated version lives in scoringRoutes.js and is used by
 * the scoring screen itself; this one is identical in query and
 * response shape, just accessible without a token so the read-only TV
 * view can fetch ball-history dots without silently failing.
 */
router.get('/matches/:matchId/innings/:inningsId/over-deliveries', async (req, res, next) => {
  const { inningsId } = req.params;
  const overNumber = parseInt(req.query.overNumber, 10);
  if (Number.isNaN(overNumber)) {
    return res.status(400).json({ error: 'overNumber query parameter is required and must be a number.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.delivery_type, d.total_runs, d.penalty_runs, d.is_wicket,
              d.is_legal_delivery, d.sequence_number, d.zone_hit,
              d.dismissed_player_id, mp.display_name AS dismissed_player_name
       FROM delivery d
       LEFT JOIN match_player mp ON mp.id = d.dismissed_player_id
       WHERE d.innings_id = $1 AND d.over_number = $2 AND d.is_undone = false
       ORDER BY d.sequence_number ASC`,
      [inningsId, overNumber]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        deliveryType: r.delivery_type,
        totalRuns: r.total_runs,
        penaltyRuns: r.penalty_runs,
        isWicket: r.is_wicket,
        isLegalDelivery: r.is_legal_delivery,
        sequenceNumber: r.sequence_number,
        zoneHit: r.zone_hit,
        dismissedPlayerName: r.dismissed_player_name ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
