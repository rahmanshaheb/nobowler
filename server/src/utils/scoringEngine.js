// scoringEngine.js
//
// Pure functions that turn a "ball event" (what the scorer tapped) into
// the run breakdown that gets written to the `delivery` table.
//
// Deliberately has zero DB/HTTP dependencies so it can be tested in
// isolation against the exact examples from the design screenshots.
//
// RULES IMPLEMENTED (cross-referenced to your rule sheet + screenshots):
//
// - Zones are 1, 2, 4, 6 only. A zone hit WITHOUT a swap scores ZERO
//   runs (rule 12, "no swapping no run from zones") — this was gotten
//   WRONG in an earlier version of this file, which incorrectly
//   credited the zone's base value (1/2/4/6) even with no swap.
//   Confirmed explicitly and corrected: zones only ever produce runs
//   together with a swap.
// - If batters cross ("swap") after a zone hit, the batter gets
//   zoneHit + 1 (rules 8-11; e.g. "7 runs from zone 6" = zone(6)+swap(1)).
//   The +1 is NOT a separate, independently-scorable event — it only
//   ever appears bundled with the zone's value when a swap occurs.
// - "8 runs from zone 6" in the screenshots is zone(6) + swap(1) + a manual
//   +1 via the stepper — i.e. the stepper is a general extra-runs control,
//   not exclusive to wide/no-ball. Modeled as `manualRunAdjustment`.
// - Wide: +1 mandatory extra run (rule 5), does NOT count as a legal ball.
//   If batters cross on a wide, +1 additional run (rule 5) — screenshots
//   label this "physical run" and clarify it is NOT a batter run; it's
//   still an extra. (Distinguishes wide-swap from zone-swap, which IS a
//   batter run — this asymmetry is easy to get wrong, flagged clearly below.)
// - No-ball: identical mechanics to wide (+1 mandatory extra, +1 if crossed,
//   does not count as legal ball) — rule 6. Any runs scored off the bat on
//   a no-ball ARE credited to the batter (rule 7) — but the same rule-12
//   zone-without-swap-is-zero correction applies on a no-ball too.
// - Manual run adjustment (the +/- stepper) on a NORMAL delivery (no zone
//   tapped) is a batter run, per rule 13 ("additional runs recorded for
//   the batter except no and wide balls").
// - Out: -5 penalty (rule 3). Zone 6 is exempt from outs entirely (rule 14)
//   — enforced here as a hard validation error, not a silent ignore.
// - Crossing on a wicket ball: a run-out can occur mid-run, so a wicket
//   delivery can still carry zone_runs/crossing_run earned before the dismissal.
//   This engine does not assume "wicket == zero runs"; caller passes
//   whatever runs were completed before the dismissal.

const VALID_ZONES = [1, 2, 4, 6];

class ScoringRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScoringRuleError';
  }
}

/**
 * @typedef {Object} BallInput
 * @property {'normal'|'wide'|'no_ball'} deliveryType
 * @property {number|null} zoneHit - one of 1,2,4,6, or null if no zone tapped
 * @property {boolean} battersCrossed - did the batters swap ends
 * @property {number} manualRunAdjustment - value from the +/- stepper (>=0)
 * @property {boolean} isWicket
 * @property {'bowled'|'caught_and_bowled'|'caught'|'run_out'|'stumped'|null} wicketType
 */

/**
 * Computes the full run breakdown for a single delivery.
 * Throws ScoringRuleError on inputs that violate the rule set
 * (e.g. a catch credited off a Zone 6 hit).
 *
 * @param {BallInput} input
 * @returns {{
 *   zoneRuns: number,
 *   crossingRun: number,
 *   extraMandatoryRun: number,
 *   manualRunAdjustment: number,
 *   batterRuns: number,
 *   extraRuns: number,
 *   totalRuns: number,
 *   isLegalDelivery: boolean,
 *   penaltyRuns: number
 * }}
 */
function computeDelivery(input) {
  const {
    deliveryType = 'normal',
    zoneHit = null,
    battersCrossed = false,
    manualRunAdjustment = 0,
    isWicket = false,
    wicketType = null,
    // NEW, confirmed explicitly: decoupled from battersCrossed. See the
    // matching comment in useDeliveryComputation.js for the full
    // rationale — battersCrossed, for a NORMAL delivery, now means
    // "odd/even total-crossing parity for strike rotation" rather than
    // "did this zone hit get its swap bonus." zoneSwapApplies is the
    // latter, and defaults to "any zone selected at all" if the caller
    // doesn't pass it explicitly, matching the original, unchanged
    // rule 12 behavior.
    zoneSwapApplies = zoneHit !== null,
  } = input;

  if (zoneHit !== null && !VALID_ZONES.includes(zoneHit)) {
    throw new ScoringRuleError(`Invalid zone: ${zoneHit}. Must be one of ${VALID_ZONES.join(', ')}.`);
  }
  if (manualRunAdjustment < 0) {
    throw new ScoringRuleError('manualRunAdjustment cannot be negative.');
  }
  if (isWicket && !wicketType) {
    throw new ScoringRuleError('wicketType is required when isWicket is true.');
  }

  // Rule 14: Zone 6 is exempt from catch-out and run-out. Stumped/bowled
  // are bat-and-wicket-keeper dismissals unrelated to a zone hit having
  // occurred on a PRIOR ball, so we only block the combination where the
  // wicket is being attributed to *this* delivery's Zone 6 hit.
  if (isWicket && zoneHit === 6 && (wicketType === 'caught' || wicketType === 'run_out' || wicketType === 'caught_and_bowled')) {
    throw new ScoringRuleError(
      `No run out if the batter hits 6.`
    );
  }

  const isLegalDelivery = deliveryType === 'normal' || deliveryType === 'no_wide_count';

  let zoneRuns = 0;
  let crossingRun = 0;
  let extraMandatoryRun = 0;
  let batterRuns = 0;
  let extraRuns = 0;

  if (deliveryType === 'wide') {
    // CONFIRMED explicitly this round: a wide is ALWAYS exactly the
    // mandatory +1, full stop. The old extraPhysicalRun mechanic ("+1
    // more if battersCrossed on the wide itself") is removed — it
    // wasn't a real, separate rule. Zones can NEVER apply on a wide
    // (the bat can't make contact — if it's hit, it isn't a wide), so
    // zoneHit is ignored defensively even if some stale value were
    // present. The only way a wide totals more than 1 is the scorer's
    // manualRunAdjustment (the stepper), representing batters running
    // without the bat touching the ball — confirmed explicitly: "batter
    // can leave the ball as wide and then make a quick run... 2 runs
    // from wide." None of this is ever a batter run (rule 5).
    extraMandatoryRun = 1;
    if (manualRunAdjustment > 0) {
      extraRuns += manualRunAdjustment;
    }
    extraRuns += extraMandatoryRun;
  } else if (deliveryType === 'no_wide_count') {
    // Wide when wide count is disabled — legal delivery, 2 mandatory
    // extra runs. Stepper runs are extras (never batter credit) but
    // battersCrossed is still determined by odd/even stepper (rotation).
    extraMandatoryRun = 2;
    extraRuns += extraMandatoryRun;
    if (manualRunAdjustment > 0) {
      extraRuns += manualRunAdjustment;
    }
  } else if (deliveryType === 'no_ball') {
    // CONFIRMED explicitly: a no-ball gets the same flat mandatory +1
    // (always an extra, never a batter run), but UNLIKE a wide, it's a
    // fair-length delivery the batter CAN legitimately hit. Per rule 7
    // ("any runs scored off the bat on a no-ball are credited to the
    // batter"), a zone hit's value + swap bonus (gated by
    // zoneSwapApplies, exactly like a normal delivery — see the rule-12
    // comment in the normal-delivery branch below) goes to batterRuns,
    // NOT extraRuns — this is the existing, original rule, unchanged.
    // Only the manual/stepper adjustment is carved out as an extra, per
    // rule 13's specific exception for wide/no-ball.
    extraMandatoryRun = 1;
    if (zoneHit !== null && zoneSwapApplies) {
      zoneRuns = zoneHit;
      crossingRun = 1;
      batterRuns += zoneRuns + crossingRun;
    }
    if (manualRunAdjustment > 0) {
      extraRuns += manualRunAdjustment;
    }
    extraRuns += extraMandatoryRun;
  } else {
    // Normal delivery.
    if (zoneHit !== null) {
      // Rule 12 (corrected): a zone hit WITHOUT a swap scores ZERO runs.
      // zoneSwapApplies (not battersCrossed — see the parameter comment
      // above) governs this: it's true whenever any zone is selected at
      // all, preserving this rule exactly as originally built. The
      // "zone hit, no run" real-world scenario is represented by the
      // scorer tapping 0 with no zone selected, not by a zone with this
      // false — confirmed explicitly.
      if (zoneSwapApplies) {
        zoneRuns = zoneHit;
        crossingRun = 1;
        batterRuns += zoneRuns + crossingRun;
      }
      // If zoneSwapApplies is false, zoneRuns/crossingRun both stay 0 —
      // the zone hit contributed nothing to batterRuns. This is
      // intentional, not a missing case.
    } else if (battersCrossed) {
      // Batters can cross without a zone hit (e.g. a quick single with no
      // zone tapped) — handled via the manual run stepper, not an
      // automatic +1. This branch intentionally no-ops.
    }

    // Rule 13: manual extra runs ARE batter runs on a normal delivery.
    if (manualRunAdjustment > 0) {
      batterRuns += manualRunAdjustment;
    }
  }

  // Rule 3: -5 penalty per out, tracked separately from batter/extra runs
  // so it can be applied at team/bowler level without corrupting the
  // batter's personal tally.
  const penaltyRuns = isWicket ? -5 : 0;

  const totalRuns = batterRuns + extraRuns;

  return {
    zoneRuns,
    crossingRun,
    extraMandatoryRun,
    manualRunAdjustment,
    batterRuns,
    extraRuns,
    totalRuns,
    isLegalDelivery,
    penaltyRuns,
  };
}

/**
 * Strike rotation, as of this round, has TWO layers:
 *
 * 1. DEFAULT (confirmed, this round): for a normal delivery, the
 *    scorer's chosen zone (default or overridden) plus any leftover
 *    physical/stepper runs together determine an odd/even "total
 *    crossings" count — computed entirely client-side in
 *    ScoringScreen.jsx and sent here as battersCrossed. Odd flips the
 *    strike; even keeps it. This mirrors real cricket: every actual run
 *    physically completed between the wickets is a crossing.
 *
 * 2. EXPLICIT OVERRIDE (pre-existing, unchanged): the scorer's manual
 *    "swap" icon (handleSwapStriker in LiveMatchContainer.jsx) remains
 *    a fully independent, immediate action — not tied to this function
 *    or to computeDelivery() at all. It exists for genuine exceptions
 *    where the real-world play didn't match the typical odd/even
 *    pattern (e.g. an unusual mid-run event). This reconciles an
 *    earlier finding from mockup screenshots showing "2 runs, Zone 1"
 *    with two DIFFERENT rotation outcomes across different examples —
 *    that earlier finding wasn't wrong, it was evidence of the manual
 *    override being used for an exceptional case, not evidence against
 *    having a sensible odd/even default for the common case.
 *
 * This function itself stays intentionally trivial: it just exposes
 * whatever battersCrossed value the delivery was submitted with — it's
 * the CALLER (the frontend's odd/even calculation OR the scorer's
 * manual swap) that decides what that value actually is.
 */
function shouldRotateStrike({ battersCrossed }) {
  return Boolean(battersCrossed);
}

/**
 * Validates a bowler hasn't exceeded the 3-over cap (rule 15) before
 * allowing a new spell/over to be assigned to them.
 * @param {number} legalBallsAlreadyBowled - legal balls bowled so far in this innings by this bowler
 */
function validateBowlerOverLimit(legalBallsAlreadyBowled) {
  const MAX_OVERS = 3;
  const MAX_LEGAL_BALLS = MAX_OVERS * 6;
  if (legalBallsAlreadyBowled >= MAX_LEGAL_BALLS) {
    throw new ScoringRuleError(`Bowler has already bowled the maximum ${MAX_OVERS} overs.`);
  }
}

/**
 * Total overs in an innings, derived from how many players are on the
 * BATTING team's roster. Each pair bats 4 overs; pair count is
 * ceil(squadSize / 2) — odd squads re-use a player to fill the last pair
 * (e.g. 9 players → 5 pairs → 20 overs, same as 10 players).
 *
 * Supported squad sizes: 8–12 players per team (16–24 overs).
 */
function totalOversForSquadSize(squadSize) {
  if (squadSize < 8 || squadSize > 12) {
    throw new ScoringRuleError(
      `Squad size ${squadSize} isn't supported yet (only 8–12 players per team).`
    );
  }
  return Math.ceil(squadSize / 2) * 4;
}

module.exports = {
  ScoringRuleError,
  VALID_ZONES,
  computeDelivery,
  shouldRotateStrike,
  validateBowlerOverLimit,
  totalOversForSquadSize,
};
