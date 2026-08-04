// publicRoutes.js
const express = require('express');
const { pool } = require('../db/pool');
const { totalOversForSquadSize } = require('../utils/scoringEngine');
const { validateMatchData } = require('../utils/validateMatchData');
const { logValidationIssue } = require('../utils/logValidationIssues');
const { requireUuidParam } = require('../middleware/validateUuid');
const { isValidUuid } = require('../utils/uuid');

const router = express.Router();

/**
 * GET /api/public/matches
 * "Previous matches" list — most recent first, with live status flag.
 */
router.get('/matches', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, match_date, created_at, team_a_name, team_b_name, status, result_summary, join_code
       FROM match
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`
    );
    res.json(rows);
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
 *
 * Registered before /matches/:matchId so "lookup" is never treated as a UUID.
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
 * DELETE /api/public/matches/:matchId
 * Soft-delete a match when the caller supplies the correct 4-digit join code.
 */
router.delete('/matches/:matchId', requireUuidParam('matchId'), async (req, res, next) => {
  const { matchId } = req.params;
  const joinCodeRaw = req.body?.joinCode;
  const joinCodeStr = joinCodeRaw != null ? String(joinCodeRaw).trim() : '';

  if (!/^\d{4}$/.test(joinCodeStr)) {
    return res.status(400).json({ error: 'Match code is required (4 digits).' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE match SET deleted_at = now()
       WHERE id = $1 AND join_code = $2 AND deleted_at IS NULL
       RETURNING id`,
      [matchId, parseInt(joinCodeStr, 10)]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: 'Invalid match code or match not found.' });
    }

    await pool.query(
      `INSERT INTO audit_log (match_id, actor, action, detail) VALUES ($1, $2, $3, $4)`,
      [matchId, 'public:join_code', 'match_deleted', JSON.stringify({ via: 'matches_list' })]
    );

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/player-stats
 * Career stats aggregated across all non-deleted matches, grouped by player name.
 */
router.get('/player-stats', async (req, res, next) => {
  try {
    const { rows: battingStats } = await pool.query(
      `SELECT
         vbs.display_name,
         COUNT(DISTINCT vbs.match_id) AS matches_played,
         COALESCE(SUM(vbs.balls_faced), 0) AS balls_faced,
         COALESCE(SUM(vbs.runs_scored), 0) AS runs_scored,
         COALESCE(SUM(vbs.fours), 0) AS fours,
         COALESCE(SUM(vbs.sixes), 0) AS sixes,
         COALESCE(SUM(vbs.times_dismissed), 0) AS times_dismissed,
         CASE WHEN COALESCE(SUM(vbs.balls_faced), 0) > 0
           THEN ROUND(100.0 * COALESCE(SUM(vbs.runs_scored), 0) / SUM(vbs.balls_faced), 2)
           ELSE 0 END AS strike_rate
       FROM v_batting_stats vbs
       JOIN match m ON m.id = vbs.match_id AND m.deleted_at IS NULL
       GROUP BY vbs.display_name
       HAVING COALESCE(SUM(vbs.balls_faced), 0) > 0
       ORDER BY COALESCE(SUM(vbs.runs_scored), 0) - COALESCE(SUM(vbs.times_dismissed), 0) * 5 DESC,
                vbs.display_name ASC`
    );

    const { rows: bowlingStats } = await pool.query(
      `SELECT
         vbs.display_name,
         COUNT(DISTINCT vbs.match_id) AS matches_bowled,
         COALESCE(SUM(vbs.legal_balls_bowled), 0) AS legal_balls_bowled,
         COALESCE(SUM(vbs.runs_conceded), 0) AS runs_conceded,
         COALESCE(SUM(vbs.bowler_credited_wickets), 0) AS wickets,
         COALESCE(SUM(extra.extra_runs), 0) AS extra_runs
       FROM v_bowling_stats vbs
       JOIN match m ON m.id = vbs.match_id AND m.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(d.extra_runs), 0) AS extra_runs
         FROM bowling_spell bs
         JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
         WHERE bs.bowler_id = vbs.player_id AND bs.innings_id = vbs.innings_id
       ) extra ON true
       GROUP BY vbs.display_name
       HAVING COALESCE(SUM(vbs.legal_balls_bowled), 0) > 0
       ORDER BY COALESCE(SUM(vbs.bowler_credited_wickets), 0) DESC,
                vbs.display_name ASC`
    );

    const { rows: fieldingStats } = await pool.query(
      `SELECT
         mp.display_name,
         COUNT(DISTINCT i.match_id) AS matches_fielded,
         COALESCE(SUM(CASE WHEN d.wicket_type = 'caught' THEN 1 ELSE 0 END), 0) AS catches,
         COALESCE(SUM(CASE WHEN d.wicket_type = 'run_out' THEN 1 ELSE 0 END), 0) AS run_outs,
         COALESCE(SUM(CASE WHEN d.wicket_type = 'stumped' THEN 1 ELSE 0 END), 0) AS stumpings
       FROM delivery d
       JOIN innings i ON i.id = d.innings_id
       JOIN match m ON m.id = i.match_id AND m.deleted_at IS NULL
       JOIN match_player mp ON mp.id = d.fielder_id
       WHERE d.is_undone = false AND d.fielder_id IS NOT NULL
       GROUP BY mp.display_name
       HAVING COALESCE(SUM(CASE WHEN d.wicket_type IN ('caught', 'run_out', 'stumped') THEN 1 ELSE 0 END), 0) > 0
       ORDER BY
         COALESCE(SUM(CASE WHEN d.wicket_type IN ('caught', 'run_out', 'stumped') THEN 1 ELSE 0 END), 0) DESC,
         mp.display_name ASC`
    );

    const { rows: matchCountRows } = await pool.query(
      'SELECT COUNT(*) AS total FROM match WHERE deleted_at IS NULL'
    );

    res.json({
      matchCount: Number(matchCountRows[0]?.total ?? 0),
      battingStats,
      bowlingStats,
      fieldingStats,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/matches/:matchId
 * Full match summary: both teams' batting/bowling lines, per the
 * "3 June 2026 / Team A won by 19 runs" screen.
 */
router.get('/matches/:matchId', requireUuidParam('matchId'), async (req, res, next) => {
  const { matchId } = req.params;
  try {
    const { rows: matchRows } = await pool.query(
      'SELECT * FROM match WHERE id = $1 AND deleted_at IS NULL',
      [matchId]
    );
    if (matchRows.length === 0) return res.status(404).json({ error: 'Match not found.' });

    const { rows: roster } = await pool.query(
      `SELECT id, display_name, team, squad_position
       FROM match_player
       WHERE match_id = $1
       ORDER BY team, squad_position`,
      [matchId]
    );

    const { rows: battingStats } = await pool.query(
      `SELECT vbs.*,
              (SELECT MIN(d.sequence_number) FROM delivery d
               WHERE (d.striker_id = vbs.player_id OR d.non_striker_id = vbs.player_id) AND d.is_undone = false) AS first_appearance
       FROM v_batting_stats vbs
       WHERE vbs.match_id = $1
       ORDER BY vbs.team, first_appearance ASC NULLS LAST`,
      [matchId]
    );
    const { rows: bowlingStats } = await pool.query(
      `SELECT vbs.*,
              (SELECT COALESCE(SUM(d.extra_runs), 0)
               FROM bowling_spell bs
               JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
               WHERE bs.bowler_id = vbs.player_id AND bs.innings_id = vbs.innings_id) AS extra_runs,
              (SELECT MIN(d.sequence_number)
               FROM bowling_spell bs
               JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
               WHERE bs.bowler_id = vbs.player_id AND bs.innings_id = vbs.innings_id) AS first_ball
       FROM v_bowling_stats vbs
       WHERE vbs.match_id = $1
       ORDER BY vbs.innings_id, first_ball ASC NULLS LAST`,
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
         i.batting_team,
         (SELECT COALESCE(SUM(d.extra_runs), 0) FROM delivery d WHERE d.pair_innings_id = vpit.pair_innings_id AND d.is_undone = false) AS extra_runs
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
      `SELECT i.innings_number, mp.id AS fielder_id, mp.display_name AS fielder,
              d.wicket_type, COUNT(*) AS count
       FROM delivery d
       JOIN innings i ON i.id = d.innings_id
       JOIN match_player mp ON mp.id = d.fielder_id
       WHERE i.match_id = $1 AND d.is_undone = false AND d.fielder_id IS NOT NULL
       GROUP BY i.innings_number, mp.id, mp.display_name, d.wicket_type
       ORDER BY i.innings_number, count DESC`,
      [matchId]
    );

    // Validate data integrity (non-blocking — errors logged but don't break scorecard)
    let validation = { isValid: true, issues: [] };
    try {
      validation = await validateMatchData(matchId, pool);
      if (!validation.isValid) {
        logValidationIssue(matchId, validation);
      }
    } catch (validationErr) {
      console.error('[VALIDATION] Error during validation:', validationErr.message);
      // Continue anyway — validation shouldn't break the scorecard
    }

    res.json({
      match: matchRows[0],
      roster,
      battingStats,
      bowlingStats,
      innings,
      pairStats,
      zoneStats,
      fieldingStats,
      validation, // Include validation results for debugging
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/matches/:matchId/players/:playerId
 * Individual player detail screen (batting / bowling for one player in a match).
 */
router.get('/matches/:matchId/players/:playerId', requireUuidParam('matchId', 'playerId'), async (req, res, next) => {
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
router.get('/matches/:matchId/live', requireUuidParam('matchId'), async (req, res, next) => {
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
router.get('/pair-innings/:pairInningsId/state', requireUuidParam('pairInningsId'), async (req, res, next) => {
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
    const { matchId } = req.query;
    let match;
    if (matchId) {
      if (!isValidUuid(matchId)) {
        return res.status(400).json({ error: 'Invalid matchId query parameter.' });
      }
      const { rows } = await pool.query(
        'SELECT id, team_a_name, team_b_name, status FROM match WHERE id = $1 AND deleted_at IS NULL',
        [matchId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Match not found.' });
      match = rows[0];
    } else {
      const { rows: matchRows } = await pool.query(
        "SELECT id, team_a_name, team_b_name, status FROM match WHERE status = 'live' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
      );
      if (matchRows.length === 0) return res.status(404).json({ error: 'No match is currently live.' });
      match = matchRows[0];
    }

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
         pi.pair_number,
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
      `SELECT mp.id AS bowler_id, mp.display_name AS bowler_name
       FROM delivery d
       JOIN bowling_spell bs ON bs.id = d.bowling_spell_id
       JOIN match_player mp ON mp.id = bs.bowler_id
       WHERE d.innings_id = $1 AND d.is_undone = false
       ORDER BY d.sequence_number DESC
       LIMIT 1`,
      [innings.innings_id]
    );

    // Current bowler's full-innings figures (not just this over) — pulled
    // from v_bowling_stats, which already aggregates across every spell
    // that bowler has had in this innings. Only queried if a bowler
    // exists yet (first ball of the innings has none).
    let bowlerFigures = { oversBowled: '0.0', runsConceded: 0, wickets: 0 };
    if (bowlerRows[0]?.bowler_id) {
      const { rows: figureRows } = await pool.query(
        `SELECT legal_balls_bowled, runs_conceded, bowler_credited_wickets
         FROM v_bowling_stats
         WHERE innings_id = $1 AND player_id = $2`,
        [innings.innings_id, bowlerRows[0].bowler_id]
      );
      const legalBalls = parseInt(figureRows[0]?.legal_balls_bowled ?? '0', 10);
      bowlerFigures = {
        oversBowled: `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`,
        runsConceded: Number(figureRows[0]?.runs_conceded ?? 0),
        wickets: Number(figureRows[0]?.bowler_credited_wickets ?? 0),
      };
    }

    // All batting pairs so far this innings, collapsed to one row per
    // pair_number (a pair can have multiple pair_innings "stints" if
    // play paused and resumed) — used for the live view's pair-by-pair
    // ticker. Ordered oldest-first so the current pair is always last.
    const { rows: allPairRows } = await pool.query(
      `SELECT pair_number, SUM(pair_total_runs) AS total_runs
       FROM v_pair_innings_totals
       WHERE innings_id = $1
       GROUP BY pair_number
       ORDER BY pair_number ASC`,
      [innings.innings_id]
    );
    const allPairs = allPairRows.map((row) => ({
      pairNumber: row.pair_number,
      totalRuns: Number(row.total_runs),
    }));

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
      bowlerFigures,
      allPairs,
      currentPairNumber: pairRows[0]?.pair_number ?? null,
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
 * GET /api/public/matches/:matchId/innings/:inningsId/over-deliveries
 *
 * Public mirror of the authenticated over-deliveries endpoint — needed
 * by the TV live view (LiveViewScreen.jsx) which has no auth token.
 * The authenticated version lives in scoringRoutes.js and is used by
 * the scoring screen itself; this one is identical in query and
 * response shape, just accessible without a token so the read-only TV
 * view can fetch ball-history dots without silently failing.
 */
router.get('/matches/:matchId/innings/:inningsId/over-deliveries', requireUuidParam('matchId', 'inningsId'), async (req, res, next) => {
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
