// deliveryController.js
const { withTransaction } = require('../db/pool');
const { computeDelivery, shouldRotateStrike, validateBowlerOverLimit, ScoringRuleError } = require('../utils/scoringEngine');

/**
 * POST /api/innings/:inningsId/deliveries
 *
 * Records one ball. This is the single highest-traffic, highest-stakes
 * endpoint in the app — every other view (TV view, pair stats, player
 * stats, previous matches) is derived from rows this writes.
 *
 * Body shape:
 * {
 *   pairInningsId, bowlingSpellId, strikerId, nonStrikerId,
 *   deliveryType: 'normal'|'wide'|'no_ball',
 *   zoneHit: 1|2|4|6|null,
 *   battersCrossed: boolean,
 *   manualRunAdjustment: number,
 *   isWicket: boolean,
 *   wicketType: 'bowled'|'caught_and_bowled'|'caught'|'run_out'|'stumped'|null,
 *   dismissedPlayerId: uuid|null,   -- required if isWicket, identifies WHICH batter is out
 *   fielderId: uuid|null,           -- required for caught/run_out/stumped/caught_and_bowled
 *   note: string|null,
 *   scorerSessionId: uuid|null
 * }
 */
async function recordDelivery(req, res, next) {
  const { inningsId } = req.params;
  const {
    pairInningsId,
    bowlingSpellId,
    strikerId,
    nonStrikerId,
    deliveryType = 'normal',
    zoneHit = null,
    battersCrossed = false,
    manualRunAdjustment = 0,
    zoneSwapApplies,
    isWicket = false,
    wicketType = null,
    dismissedPlayerId = null,
    fielderId = null,
    note = null,
    scorerSessionId = null,
    wideCountEnabled = true,
  } = req.body;

  // When wide count is disabled, a wide is scored as a legal delivery
  // with 2 extra runs (mandatory 1 + 1 manual) — not a batter run.
  // Override deliveryType so the scoring engine treats it correctly.
  const effectiveDeliveryType = (!wideCountEnabled && deliveryType === 'wide') ? 'no_wide_count' : deliveryType;

  if (!pairInningsId || !bowlingSpellId || !strikerId || !nonStrikerId) {
    return res.status(400).json({ error: 'pairInningsId, bowlingSpellId, strikerId, and nonStrikerId are required.' });
  }
  if (isWicket && !dismissedPlayerId) {
    return res.status(400).json({ error: 'dismissedPlayerId is required when isWicket is true (either batter could be the one out).' });
  }
  if (isWicket && ['caught', 'run_out', 'stumped', 'caught_and_bowled'].includes(wicketType) && !fielderId) {
    return res.status(400).json({ error: `fielderId is required for wicketType '${wicketType}'.` });
  }

  let computed;
  try {
    computed = computeDelivery({ deliveryType: effectiveDeliveryType, zoneHit, battersCrossed, manualRunAdjustment, zoneSwapApplies, isWicket, wicketType });
  } catch (err) {
    if (err instanceof ScoringRuleError) {
      return res.status(422).json({ error: err.message });
    }
    return next(err);
  }

  try {
    const result = await withTransaction(async (client) => {
      // Determine next sequence number and over/ball position for this innings.
      const { rows: lastDelivery } = await client.query(
        `SELECT sequence_number, over_number, ball_number_in_over
         FROM delivery
         WHERE innings_id = $1 AND is_undone = false
         ORDER BY sequence_number DESC LIMIT 1`,
        [inningsId]
      );

      let overNumber = 0;
      let ballNumberInOver = 0;
      let nextSequence = 1;

      if (lastDelivery.length > 0) {
        const last = lastDelivery[0];
        nextSequence = last.sequence_number + 1;
        overNumber = last.over_number;
        ballNumberInOver = last.ball_number_in_over;
        if (computed.isLegalDelivery) {
          if (ballNumberInOver >= 6) {
            overNumber += 1;
            ballNumberInOver = 1;
          } else {
            ballNumberInOver += 1;
          }
        } else {
          // wide/no-ball: does not consume a legal ball slot, but if
          // the previous legal delivery completed an over (ball 6),
          // this extra belongs to the NEW over — record it at position 0
          // of the next over to avoid colliding with the existing ball 6.
          if (ballNumberInOver >= 6) {
            overNumber += 1;
            ballNumberInOver = 0;
          }
          // otherwise stays at same over/ball position as last legal delivery
        }
      } else if (computed.isLegalDelivery) {
        overNumber = 0;
        ballNumberInOver = 1;
      }
      // first ball of the innings being a wide/no-ball: overNumber=0, ballNumberInOver=0 (no legal ball yet)

      // Enforce the 3-overs-per-bowler cap (rule 15) before writing.
      const { rows: bowlerBalls } = await client.query(
        `SELECT COUNT(*) FROM delivery
         WHERE bowling_spell_id = $1 AND is_legal_delivery = true AND is_undone = false`,
        [bowlingSpellId]
      );
      if (computed.isLegalDelivery) {
        validateBowlerOverLimit(parseInt(bowlerBalls[0].count, 10));
      }

      const { rows } = await client.query(
        `INSERT INTO delivery (
           innings_id, pair_innings_id, bowling_spell_id,
           over_number, ball_number_in_over, sequence_number,
           striker_id, non_striker_id,
           delivery_type, is_legal_delivery,
           zone_hit, batters_crossed,
           zone_runs, crossing_run, extra_mandatory_run, extra_physical_run, manual_run_adjustment,
           batter_runs, extra_runs, total_runs,
           is_wicket, wicket_type, dismissed_player_id, fielder_id, penalty_runs,
           note, recorded_by_session_id
         ) VALUES (
           $1, $2, $3,
           $4, $5, $6,
           $7, $8,
           $9, $10,
           $11, $12,
           $13, $14, $15, $16, $17,
           $18, $19, $20,
           $21, $22, $23, $24, $25,
           $26, $27
         )
         RETURNING *`,
        [
          inningsId, pairInningsId, bowlingSpellId,
          overNumber, ballNumberInOver, nextSequence,
          strikerId, nonStrikerId,
          deliveryType, computed.isLegalDelivery,
          zoneHit, battersCrossed,
          computed.zoneRuns, computed.crossingRun, computed.extraMandatoryRun, 0, computed.manualRunAdjustment,
          computed.batterRuns, computed.extraRuns, computed.totalRuns,
          isWicket, wicketType, dismissedPlayerId, fielderId, computed.penaltyRuns,
          note, scorerSessionId,
        ]
      );

      const deliveryRow = rows[0];

      // Update who's on strike for the NEXT ball, per the independent
      // battersCrossed flag (see scoringEngine.shouldRotateStrike — this
      // is NOT derived from runs scored).
      if (shouldRotateStrike({ battersCrossed })) {
        const { rows: stateRows } = await client.query(
          'SELECT current_striker_id, current_non_striker_id FROM pair_innings_state WHERE pair_innings_id = $1',
          [pairInningsId]
        );
        if (stateRows.length > 0) {
          const { current_striker_id, current_non_striker_id } = stateRows[0];
          await client.query(
            `UPDATE pair_innings_state
             SET current_striker_id = $1, current_non_striker_id = $2
             WHERE pair_innings_id = $3`,
            [current_non_striker_id, current_striker_id, pairInningsId]
          );
        }
      }

      // Flip strike automatically at the end of a completed legal over
      // (standard cricket convention: whoever faced the last ball of the
      // over does NOT face the first ball of the next over, the strike
      // rotates regardless of battersCrossed). Only applies when this
      // delivery completed the 6th legal ball of the over.
      if (computed.isLegalDelivery && ballNumberInOver === 6) {
        const { rows: stateRows } = await client.query(
          'SELECT current_striker_id, current_non_striker_id FROM pair_innings_state WHERE pair_innings_id = $1',
          [pairInningsId]
        );
        if (stateRows.length > 0) {
          const { current_striker_id, current_non_striker_id } = stateRows[0];
          await client.query(
            `UPDATE pair_innings_state
             SET current_striker_id = $1, current_non_striker_id = $2
             WHERE pair_innings_id = $3`,
            [current_non_striker_id, current_striker_id, pairInningsId]
          );
        }
      }

      // Set match status to 'live' and started_at on the very first
      // delivery of the match (legal or not — "as soon as a score has
      // been recorded" / "1 ball is delivered").
      await client.query(
        `UPDATE match SET status = 'live', started_at = COALESCE(started_at, now())
         WHERE id = (SELECT match_id FROM innings WHERE id = $1) AND status = 'setup'`,
        [inningsId]
      );

      return deliveryRow;
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ScoringRuleError) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /api/deliveries/:deliveryId/undo
 * Soft-deletes the delivery (is_undone = true) rather than hard-deleting,
 * so the audit trail survives. Does NOT attempt to reverse the strike
 * rotation or over/ball counters automatically — those are recomputed
 * fresh from the remaining (non-undone) deliveries on next read, since
 * over_number/ball_number_in_over are stored per-row at write time based
 * on what preceded them. If a middle delivery is undone, sequence numbers
 * of later deliveries become inconsistent; the safe pattern (and what the
 * UI screenshots show) is UNDO only ever removes the MOST RECENT delivery.
 * This is enforced here, not just assumed.
 */
async function undoDelivery(req, res, next) {
  const { deliveryId } = req.params;
  try {
    const result = await withTransaction(async (client) => {
      const { rows: targetRows } = await client.query(
        'SELECT * FROM delivery WHERE id = $1 AND is_undone = false',
        [deliveryId]
      );
      if (targetRows.length === 0) {
        throw Object.assign(new Error('Delivery not found or already undone.'), { statusCode: 404 });
      }
      const target = targetRows[0];

      const { rows: latestRows } = await client.query(
        `SELECT id FROM delivery
         WHERE innings_id = $1 AND is_undone = false
         ORDER BY sequence_number DESC LIMIT 1`,
        [target.innings_id]
      );
      if (latestRows.length === 0 || latestRows[0].id !== target.id) {
        throw Object.assign(
          new Error('Only the most recent delivery in the innings can be undone.'),
          { statusCode: 422 }
        );
      }

      const { rows: undoneRows } = await client.query(
        'UPDATE delivery SET is_undone = true WHERE id = $1 RETURNING *',
        [deliveryId]
      );

      // Reverse the strike-rotation effect this delivery caused, by
      // re-deriving the correct striker from the delivery immediately
      // before it (or resetting to the pair's original order if this was
      // the pair's first ball).
      const { rows: priorRows } = await client.query(
        `SELECT striker_id, non_striker_id FROM delivery
         WHERE pair_innings_id = $1 AND is_undone = false
         ORDER BY sequence_number DESC LIMIT 1`,
        [target.pair_innings_id]
      );

      // Restore the bowler too. The frontend clears bowlerId/bowlingSpellId
      // the moment an over completes (so the scorer is forced to pick the
      // next bowler before the next ball) and then sets it to whichever
      // bowler is picked next — but if the very ball that completed the
      // over gets undone (the only undoable case once a new bowler has
      // been picked but hasn't bowled yet), that picker selection is now
      // wrong: the over is no longer complete, so the PREVIOUS bowler is
      // actually back on strike, not the newly picked one. Without this,
      // the next delivery would get recorded under the wrong bowling_spell,
      // silently corrupting both bowlers' over counts. We look this up the
      // same way as strike rotation above: from whichever delivery is now
      // the innings' last non-undone one (or null if undoing the innings'
      // very first ball, in which case there's no "current" bowler at all
      // — the frontend's existing null-bowlingSpellId handling covers that
      // by forcing the picker open again).
      const { rows: priorSpellRows } = await client.query(
        `SELECT bs.id AS bowling_spell_id, bs.bowler_id
         FROM delivery d
         JOIN bowling_spell bs ON bs.id = d.bowling_spell_id
         WHERE d.innings_id = $1 AND d.is_undone = false
         ORDER BY d.sequence_number DESC LIMIT 1`,
        [target.innings_id]
      );
      const currentBowler = priorSpellRows[0] || null;
      let restoredStrikerId;
      let restoredNonStrikerId;
      if (priorRows.length > 0) {
        // Restore strike to whoever was set to face the NEXT ball after
        // the prior delivery — i.e. just re-run the same rotation logic
        // using the prior delivery's own batters_crossed flag is wrong;
        // instead, the prior row's striker/non_striker reflect who faced
        // THAT ball, so the next-striker is derivable the same way the
        // original insert derived it. Simplest correct fix: copy prior
        // delivery's resulting state by re-reading pair_innings_state
        // is unreliable after an undo, so we explicitly recompute it here.
        restoredStrikerId = priorRows[0].striker_id;
        restoredNonStrikerId = priorRows[0].non_striker_id;
        await client.query(
          `UPDATE pair_innings_state
           SET current_striker_id = $1, current_non_striker_id = $2
           WHERE pair_innings_id = $3`,
          [restoredStrikerId, restoredNonStrikerId, target.pair_innings_id]
        );
      } else {
        const { rows: pairRows } = await client.query(
          'SELECT batter_1_id, batter_2_id FROM pair_innings WHERE id = $1',
          [target.pair_innings_id]
        );
        if (pairRows.length > 0) {
          restoredStrikerId = pairRows[0].batter_1_id;
          restoredNonStrikerId = pairRows[0].batter_2_id;
          await client.query(
            `UPDATE pair_innings_state
             SET current_striker_id = $1, current_non_striker_id = $2
             WHERE pair_innings_id = $3`,
            [restoredStrikerId, restoredNonStrikerId, target.pair_innings_id]
          );
        }
      }

      const { rows: targetPairRows } = await client.query(
        'SELECT pair_number FROM pair_innings WHERE id = $1',
        [target.pair_innings_id]
      );

      // The new "last delivery" after the undo — null if this was the
      // innings' first ball. The frontend uses this to keep lastDeliveryId
      // accurate, which drives canSwapBatting and canUndo correctly.
      const { rows: newLastRows } = await client.query(
        `SELECT id FROM delivery WHERE innings_id = $1 AND is_undone = false ORDER BY sequence_number DESC LIMIT 1`,
        [target.innings_id]
      );

      return {
        ...undoneRows[0],
        // pair_innings_id here comes from the `delivery` row's own
        // column (via the ...undoneRows[0] spread above) — i.e. it's
        // target.pair_innings_id, the PAIR THAT ACTUALLY BOWLED THE
        // UNDONE BALL. This matters because the frontend's own
        // pairInningsId state can already be pointing at a NEWER pair
        // by the time undo is pressed (e.g. undoing the last ball of a
        // pair's final over, after the scorer has already picked the
        // next pair via the 4-over rotation flow but before any ball
        // has been bowled under it) — exactly the same failure shape as
        // the bowler/bowling_spell fix above, just for pairs instead of
        // bowlers. The frontend must use THIS id, not its own stale
        // state, both to query pair state and to reset pairInningsId
        // itself. Striker/non-striker and pair_number are included
        // directly too so the frontend doesn't need a separate
        // follow-up call keyed on the (previously wrong) id at all.
        current_bowler_id: currentBowler?.bowler_id ?? null,
        current_bowling_spell_id: currentBowler?.bowling_spell_id ?? null,
        current_striker_id: restoredStrikerId ?? null,
        current_non_striker_id: restoredNonStrikerId ?? null,
        current_pair_number: targetPairRows[0]?.pair_number ?? null,
        prev_delivery_id: newLastRows[0]?.id ?? null,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { recordDelivery, undoDelivery };
