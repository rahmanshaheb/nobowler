// matchController.js
const { pool, withTransaction } = require('../db/pool');
const { totalOversForSquadSize } = require('../utils/scoringEngine');

/**
 * POST /api/matches
 * Creates a new match in 'setup' status. Does not go live until the first
 * legal-or-illegal delivery is recorded (per "match is LIVE as soon as a
 * score has been recorded" / "1 ball is delivered").
 */
async function createMatch(req, res, next) {
  const { matchDate, teamAName, teamBName, wideCountEnabled } = req.body;
  if (!matchDate) {
    return res.status(400).json({ error: 'matchDate is required.' });
  }
  const wideEnabled = wideCountEnabled !== false; // default true
  try {
    let match;
    for (let attempt = 0; attempt < 10; attempt++) {
      const joinCode = Math.floor(Math.random() * 9000) + 1000;
      try {
        const { rows } = await pool.query(
          `INSERT INTO match (match_date, team_a_name, team_b_name, join_code, wide_count_enabled)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, match_date, team_a_name, team_b_name, status, join_code, wide_count_enabled`,
          [matchDate, teamAName || 'Team A', teamBName || 'Team B', joinCode, wideEnabled]
        );
        match = rows[0];
        break;
      } catch (err) {
        if (err.code === '23505' && attempt < 9) continue;
        throw err;
      }
    }
    res.status(201).json(match);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/matches/:matchId/players
 * Bulk-adds players to a team roster. Rule 1: up to 12 players per team,
 * 24 total across both teams — validated here before insert.
 */
async function addPlayers(req, res, next) {
  const { matchId } = req.params;
  const { team, names } = req.body; // names: string[]
  if (!['A', 'B'].includes(team)) {
    return res.status(400).json({ error: "team must be 'A' or 'B'." });
  }
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'names must be a non-empty array.' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const { rows: teamRows } = await client.query(
        'SELECT COUNT(*) FROM match_player WHERE match_id = $1 AND team = $2',
        [matchId, team]
      );
      const existingTeamCount = parseInt(teamRows[0].count, 10);
      if (existingTeamCount + names.length > 12) {
        throw Object.assign(
          new Error(`A team can have at most 12 players (would be ${existingTeamCount + names.length} on team ${team}).`),
          { statusCode: 422 }
        );
      }

      const { rows: totalRows } = await client.query(
        'SELECT COUNT(*) FROM match_player WHERE match_id = $1',
        [matchId]
      );
      const existingTotal = parseInt(totalRows[0].count, 10);
      if (existingTotal + names.length > 24) {
        throw Object.assign(
          new Error(`Adding these players exceeds the 24-player maximum (would be ${existingTotal + names.length}).`),
          { statusCode: 422 }
        );
      }

      const startPosition = existingTotal;

      const inserted = [];
      for (let i = 0; i < names.length; i++) {
        const { rows } = await client.query(
          `INSERT INTO match_player (match_id, team, display_name, squad_position)
           VALUES ($1, $2, $3, $4)
           RETURNING id, display_name, team, squad_position`,
          [matchId, team, names[i], startPosition + i + 1]
        );
        inserted.push(rows[0]);
      }

      return inserted;
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/matches/:matchId/players/:playerId
 * Renames a player mid-match ("Change players name on the go").
 */
async function renamePlayer(req, res, next) {
  const { matchId, playerId } = req.params;
  const { displayName } = req.body;
  if (!displayName || !displayName.trim()) {
    return res.status(400).json({ error: 'displayName is required.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE match_player SET display_name = $1
       WHERE id = $2 AND match_id = $3
       RETURNING id, display_name`,
      [displayName.trim(), playerId, matchId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Player not found in this match.' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/matches/:matchId/team-name
 * Renames Team A or Team B mid-match (e.g. the scorer set up with
 * placeholder names and wants to fill in the real team name later).
 */
async function renameTeam(req, res, next) {
  const { matchId } = req.params;
  const { team, name } = req.body;
  if (team !== 'A' && team !== 'B') {
    return res.status(400).json({ error: "team must be 'A' or 'B'." });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required.' });
  }
  const column = team === 'A' ? 'team_a_name' : 'team_b_name';
  try {
    // Column name is interpolated from a hardcoded two-value check above
    // (never from raw user input), so this is not a SQL injection risk —
    // same pattern used safely elsewhere for fixed, validated identifiers.
    const { rows } = await pool.query(
      `UPDATE match SET ${column} = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, team_a_name, team_b_name`,
      [name.trim(), matchId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Match not found.' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/matches/:matchId/innings
 * Starts an innings. Innings 1's batting_team becomes the match's
 * permanent batting_first_team (locked — "cannot be changed... please end
 * this innings and start a new match").
 */
async function startInnings(req, res, next) {
  const { matchId } = req.params;
  const { battingTeam } = req.body;
  if (!['A', 'B'].includes(battingTeam)) {
    return res.status(400).json({ error: "battingTeam must be 'A' or 'B'." });
  }

  try {
    const result = await withTransaction(async (client) => {
      const { rows: matchRows } = await client.query('SELECT * FROM match WHERE id = $1', [matchId]);
      if (matchRows.length === 0) {
        throw Object.assign(new Error('Match not found.'), { statusCode: 404 });
      }
      const match = matchRows[0];

      const { rows: existingInnings } = await client.query(
        'SELECT innings_number FROM innings WHERE match_id = $1 ORDER BY innings_number',
        [matchId]
      );

      let inningsNumber;
      if (existingInnings.length === 0) {
        inningsNumber = 1;
        // Lock batting_first_team on the match row.
        await client.query('UPDATE match SET batting_first_team = $1 WHERE id = $2', [battingTeam, matchId]);
      } else if (existingInnings.length === 1) {
        inningsNumber = 2;
        if (battingTeam === match.batting_first_team) {
          throw Object.assign(
            new Error('The second innings batting team must be the opposite of the first innings.'),
            { statusCode: 422 }
          );
        }
        // Target = first innings total + 1. Computed from v_innings_totals.
        //
        // IMPORTANT: total_runs comes from a SQL SUM() over an integer
        // column, which Postgres returns as bigint — and node-postgres
        // deserializes bigint as a STRING (not a number), specifically
        // to avoid silently losing precision on values too large for
        // JS to represent safely. Without explicit Number() coercion
        // here, firstInningsTotal stays a string, and `+ 1` below
        // performs STRING CONCATENATION rather than addition (e.g.
        // "143" + 1 -> "1431", not 144). This is the exact same bug
        // family as the project's original string-concatenation
        // bug — same root cause, just a code path that never got the
        // same Number() coercion treatment. Confirmed via diagnostic:
        // a clean, sane 143-run innings produced a target of 1431,
        // exactly matching "143" + 1 as a string.
        const { rows: totals } = await client.query(
          `SELECT total_runs FROM v_innings_totals
           WHERE match_id = $1 AND innings_number = 1`,
          [matchId]
        );
        const firstInningsTotal = Number(totals[0]?.total_runs ?? 0);
        const { rows: inningsRows } = await client.query(
          `INSERT INTO innings (match_id, innings_number, batting_team, target_runs)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [matchId, inningsNumber, battingTeam, firstInningsTotal + 1]
        );
        return inningsRows[0];
      } else {
        throw Object.assign(new Error('This match already has both innings.'), { statusCode: 422 });
      }

      const { rows: inningsRows } = await client.query(
        `INSERT INTO innings (match_id, innings_number, batting_team)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [matchId, inningsNumber, battingTeam]
      );
      return inningsRows[0];
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/matches/:matchId/innings/:inningsId/pairs
 * Starts a new batting pair (or a new stint for a returning pair).
 */
async function startPair(req, res, next) {
  const { inningsId } = req.params;
  const { batter1Id, batter2Id, helperPlayerId, pairNumber, stintNumber } = req.body;
  if (!batter1Id || !batter2Id) {
    return res.status(400).json({ error: 'batter1Id and batter2Id are required.' });
  }
  if (batter1Id === batter2Id) {
    return res.status(400).json({ error: 'A pair must consist of two different players.' });
  }
  try {
    const result = await withTransaction(async (client) => {
      // A row for this (innings_id, pair_number, stint_number) can
      // already exist if the scorer undid back past an earlier pair
      // selection and is now re-picking at the same boundary (with the
      // SAME or DIFFERENT batters — confirmed explicitly: no
      // restrictions on who can be re-picked, including re-picking an
      // earlier pair number). Without this check, that re-pick would
      // crash on the pair_innings unique constraint, since undo only
      // reverses deliveries, never the pair/bowler records they were
      // attributed to.
      const { rows: existingRows } = await client.query(
        `SELECT * FROM pair_innings WHERE innings_id = $1 AND pair_number = $2 AND stint_number = $3`,
        [inningsId, pairNumber, stintNumber || 1]
      );

      if (existingRows.length > 0) {
        const existing = existingRows[0];
        const { rows: deliveryRows } = await client.query(
          `SELECT 1 FROM delivery WHERE pair_innings_id = $1 AND is_undone = false LIMIT 1`,
          [existing.id]
        );
        if (deliveryRows.length > 0) {
          // Real deliveries are already recorded against this pair —
          // updating its batters now would silently misattribute that
          // history to different players. This is a genuinely different
          // situation from the plain re-pick-after-undo case (which has
          // zero deliveries, since undo always removes the most recent
          // ones first) and needs a human decision, not a silent fix.
          throw Object.assign(
            new Error(
              `Pair ${pairNumber} already has recorded deliveries under different batters. ` +
                `Undo those deliveries first if you need to change who's batting.`
            ),
            { statusCode: 422 }
          );
        }
        // No deliveries yet — safe to just update this existing row to
        // reflect whatever's being picked now, rather than inserting a
        // duplicate. Covers re-picking the SAME batters (a no-op update)
        // and DIFFERENT batters (the team genuinely changed their mind)
        // identically.
        const { rows: updatedRows } = await client.query(
          `UPDATE pair_innings
           SET batter_1_id = $1, batter_2_id = $2, helper_player_id = $3
           WHERE id = $4
           RETURNING *`,
          [batter1Id, batter2Id, helperPlayerId || null, existing.id]
        );
        await client.query(
          `UPDATE pair_innings_state
           SET current_striker_id = $1, current_non_striker_id = $2
           WHERE pair_innings_id = $3`,
          [batter1Id, batter2Id, existing.id]
        );
        return updatedRows[0];
      }

      const { rows } = await client.query(
        `INSERT INTO pair_innings (innings_id, pair_number, stint_number, batter_1_id, batter_2_id, helper_player_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [inningsId, pairNumber, stintNumber || 1, batter1Id, batter2Id, helperPlayerId || null]
      );
      const pairInnings = rows[0];

      await client.query(
        `INSERT INTO pair_innings_state (pair_innings_id, current_striker_id, current_non_striker_id)
         VALUES ($1, $2, $3)`,
        [pairInnings.id, batter1Id, batter2Id]
      );

      return pairInnings;
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/matches/:matchId/innings/:inningsId/bowling-spells
 * Registers a bowler for the innings (idempotent — one row per bowler per
 * innings, deliveries accumulate against it across however many overs they
 * end up bowling, up to the 3-over cap enforced in scoringEngine).
 */
async function startOrGetBowlingSpell(req, res, next) {
  const { inningsId } = req.params;
  const { bowlerId } = req.body;
  if (!bowlerId) {
    return res.status(400).json({ error: 'bowlerId is required.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO bowling_spell (innings_id, bowler_id, activated_after_sequence)
       VALUES (
         $1, $2,
         (SELECT COALESCE(MAX(sequence_number), 0)
          FROM delivery
          WHERE innings_id = $1 AND is_undone = false)
       )
       ON CONFLICT (innings_id, bowler_id) DO UPDATE SET
         activated_after_sequence = EXCLUDED.activated_after_sequence
       RETURNING *`,
      [inningsId, bowlerId]
    );
    res.status(200).json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/matches/:matchId/rehydrate
 * Reconstructs everything LiveMatchContainer needs to resume an
 * in-progress match after a page refresh — built because React state
 * (runs, over/ball position, current pair/bowler) evaporates on reload,
 * but the database already has the real, authoritative truth for all
 * of it via the delivery ledger and the various *_state tables. Rather
 * than persisting a snapshot client-side (which could drift from what's
 * actually been scored), this re-derives everything fresh from the
 * database every time — the only thing that needs to survive a reload
 * client-side is the matchId itself.
 */
async function rehydrateMatch(req, res, next) {
  const { matchId } = req.params;
  try {
    const { rows: matchRows } = await pool.query(
      'SELECT id, team_a_name, team_b_name, status, join_code, wide_count_enabled FROM match WHERE id = $1 AND deleted_at IS NULL',
      [matchId]
    );
    if (matchRows.length === 0) {
      return res.status(404).json({ error: 'Match not found.' });
    }
    const match = matchRows[0];

    const { rows: players } = await pool.query(
      'SELECT id, display_name, team FROM match_player WHERE match_id = $1 ORDER BY squad_position',
      [matchId]
    );
    const teamAPlayers = players.filter((p) => p.team === 'A').map((p) => ({ id: p.id, display_name: p.display_name }));
    const teamBPlayers = players.filter((p) => p.team === 'B').map((p) => ({ id: p.id, display_name: p.display_name }));

    const { rows: inningsRows } = await pool.query(
      `SELECT i.id, i.innings_number, i.batting_team, i.target_runs, vit.total_runs, vit.last_over_number, vit.last_ball_number
       FROM innings i
       LEFT JOIN v_innings_totals vit ON vit.innings_id = i.id
       WHERE i.match_id = $1
       ORDER BY i.innings_number DESC
       LIMIT 1`,
      [matchId]
    );
    if (inningsRows.length === 0) {
      // Match exists but no innings started yet — return match data so
      // frontend can resume setup rather than dropping to homepage.
      return res.status(200).json({
        needsSetup: true,
        matchId: match.id,
        teamAName: match.team_a_name,
        teamBName: match.team_b_name,
        wideCountEnabled: match.wide_count_enabled !== false,
      });
    }
    const innings = inningsRows[0];

    // Only redirect to result screen if the match is actually finished.
    // Innings 2 in progress should rehydrate normally.
    if (match.status === 'completed') {
      return res.status(200).json({ isComplete: true, matchId });
    }

    const { rows: pairRows } = await pool.query(
      `SELECT pi.id AS pair_innings_id, pi.pair_number, pis.current_striker_id, pis.current_non_striker_id
       FROM pair_innings pi
       JOIN pair_innings_state pis ON pis.pair_innings_id = pi.id
       WHERE pi.innings_id = $1
       ORDER BY pi.pair_number DESC, pi.stint_number DESC
       LIMIT 1`,
      [innings.id]
    );
    const pair = pairRows[0] || null;

    const battingRoster = innings.batting_team === 'A' ? teamAPlayers : teamBPlayers;

    // Derive the active bowler from the last LEGAL delivery — not the
    // last ledger row overall (which may be a wide/no-ball between overs).
    // When that legal delivery completed an over (ball 6), leave bowler
    // unset so a refresh cannot resume with a stale bowling_spell_id and
    // silently credit the next over to the wrong bowler.
    const { rows: lastLegalRows } = await pool.query(
      `SELECT bs.id AS bowling_spell_id, bs.bowler_id, d.over_number, d.ball_number_in_over
       FROM delivery d
       JOIN bowling_spell bs ON bs.id = d.bowling_spell_id
       WHERE d.innings_id = $1 AND d.is_undone = false AND d.is_legal_delivery = true
       ORDER BY d.sequence_number DESC
       LIMIT 1`,
      [innings.id]
    );

    let bowlingSpellId = null;
    let bowlerId = null;
    let needsBowlerSelection = false;
    let needsPairRotation = false;

    if (lastLegalRows.length > 0) {
      const lastLegal = lastLegalRows[0];
      if (lastLegal.ball_number_in_over >= 6) {
        const oversJustCompleted = lastLegal.over_number + 1;
        const totalOvers = totalOversForSquadSize(battingRoster.length);
        needsPairRotation = oversJustCompleted % 4 === 0 && oversJustCompleted < totalOvers;
        needsBowlerSelection = !needsPairRotation;
      } else {
        bowlingSpellId = lastLegal.bowling_spell_id;
        bowlerId = lastLegal.bowler_id;
      }
    } else {
      // No legal ball yet — restore a bowler picked before the first
      // delivery (e.g. scorer selected one, then refreshed).
      const { rows: spellRows } = await pool.query(
        `SELECT bs.id, bs.bowler_id
         FROM bowling_spell bs
         WHERE bs.innings_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM delivery d
             WHERE d.bowling_spell_id = bs.id AND d.is_undone = false
           )
         LIMIT 1`,
        [innings.id]
      );
      if (spellRows.length > 0) {
        bowlingSpellId = spellRows[0].id;
        bowlerId = spellRows[0].bowler_id;
      }
    }
    const bowlingRoster = innings.batting_team === 'A' ? teamBPlayers : teamAPlayers;

    // Get last delivery ID for undo support on refresh
    let lastDeliveryId = null;
    if (pair?.pair_innings_id) {
      const { rows: lastDeliveryRows } = await pool.query(
        `SELECT id FROM delivery
         WHERE pair_innings_id = $1 AND is_undone = false
         ORDER BY sequence_number DESC LIMIT 1`,
        [pair.pair_innings_id]
      );
      lastDeliveryId = lastDeliveryRows[0]?.id ?? null;
    }

    res.json({
      matchId: match.id,
      joinCode: match.join_code ?? null,
      teamAName: match.team_a_name,
      teamBName: match.team_b_name,
      teamAPlayers,
      teamBPlayers,
      battingTeam: innings.batting_team,
      inningsNumber: innings.innings_number,
      inningsId: innings.id,
      pairInningsId: pair?.pair_innings_id ?? null,
      pairNumber: pair?.pair_number ?? 1,
      strikerId: pair?.current_striker_id ?? null,
      nonStrikerId: pair?.current_non_striker_id ?? null,
      bowlingSpellId,
      bowlerId,
      overNumber: innings.last_over_number ?? 0,
      ballNumberInOver: innings.last_ball_number ?? 0,
      // Number() coercion: total_runs comes from v_innings_totals' SUM(),
      // which Postgres/node-postgres returns as a string, not a number
      // (see the project's established fix for this bug family elsewhere
      // in this file and in publicRoutes.js). Coerced here at the source
      // rather than relying on every caller to remember to do it.
      runs: Number(innings.total_runs ?? 0),
      targetRuns: innings.target_runs ?? null,
      battingRoster,
      bowlingRoster,
      wideCountEnabled: match.wide_count_enabled !== false,
      lastDeliveryId,
      needsBowlerSelection,
      needsPairRotation,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/matches/:matchId/innings/:inningsId/bowler-overs
 * Returns each bowler's overs progress for this innings, in the same
 * "completedOvers.ballsIntoCurrentOver" notation used on the main
 * scoring screen (e.g. 3 legal balls -> {completedOvers: 0, ballsIntoCurrentOver: 3},
 * displayed as "0.3"; 8 legal balls -> {completedOvers: 1, ballsIntoCurrentOver: 2},
 * displayed as "1.2").
 *
 * Counts TOTAL legal balls per bowler across the whole innings (same
 * basis as the 3-over cap in validateBowlerOverLimit), not completed
 * over_number groups — a bowler returning for a later spell accumulates
 * correctly on their single bowling_spell row.
 *
 * Only includes bowlers who've bowled at least one legal ball; a bowler
 * who hasn't bowled at all simply won't appear in the result, which the
 * frontend uses to decide whether to show anything next to their name.
 */
async function getBowlerOvers(req, res, next) {
  const { inningsId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT bs.bowler_id,
         COUNT(d.id) FILTER (WHERE d.is_legal_delivery = true) AS total_legal_balls
       FROM bowling_spell bs
       LEFT JOIN delivery d ON d.bowling_spell_id = bs.id AND d.is_undone = false
       WHERE bs.innings_id = $1
       GROUP BY bs.bowler_id
       HAVING COUNT(d.id) FILTER (WHERE d.is_legal_delivery = true) > 0`,
      [inningsId]
    );
    res.json(
      rows.map((r) => {
        const totalLegal = parseInt(r.total_legal_balls || 0, 10);
        return {
          bowlerId: r.bowler_id,
          completedOvers: Math.floor(totalLegal / 6),
          ballsIntoCurrentOver: totalLegal % 6,
        };
      })
    );
  } catch (err) {
    next(err);
  }
}

/**
 * Returns every delivery recorded for a SPECIFIC over within an innings,
 * in the exact order they were bowled — used to render the per-ball dot
 * row on the scoring screen (confirmed design, this round: each dot
 * shows that ball's run total, with distinct treatment for wide/no-ball
 * and wicket deliveries). Scoped by overNumber (query param) rather than
 * "whatever the current over is" server-side, since the frontend already
 * tracks overNumber as live state and is in the best position to know
 * which over it actually wants — this also means the same endpoint can
 * be reused later if a "view a past over" feature is ever wanted, with
 * no changes needed here.
 *
 * is_undone deliveries are excluded, matching every other read query in
 * this codebase (rehydrateMatch, getBowlerOvers) — an undone ball never
 * happened as far as any display is concerned.
 */
async function getCurrentOverDeliveries(req, res, next) {
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
        zoneHit: r.zone_hit,
        dismissedPlayerName: r.dismissed_player_name ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
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
};
