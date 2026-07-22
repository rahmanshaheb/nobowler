// useDeliveryComputation.js
//
// Mirrors server/src/utils/scoringEngine.js computeDelivery() so the UI
// can show a live "Submit N" / "Submit dot ball" label as the scorer taps,
// without waiting on a round trip. This is a PREVIEW only — the backend
// recomputes authoritatively on submit and is the source of truth if the
// two ever drift. If you change the rules, update both files; consider
// extracting this into a shared package once the API contract is stable.

const VALID_ZONES = [1, 2, 4, 6];

export function computeDeliveryPreview({
  deliveryType = 'normal',
  zoneHit = null,
  manualRunAdjustment = 0,
  // NEW, confirmed explicitly: a separate signal from battersCrossed.
  // Whenever a zone is selected at all, its own +1 swap bonus ALWAYS
  // counts toward the run total — this preserves rule 12 ("zone hit
  // without a swap scores zero") exactly as originally built, since the
  // real-world "zone hit, no run" scenario is represented by tapping 0
  // with NO zone selected at all, not by selecting a zone with this
  // flag false. battersCrossed now means something different (odd/even
  // total-crossing parity for STRIKE ROTATION only, computed separately
  // in ScoringScreen.jsx) and is no longer read by this function at all
  // — it never gates the run calculation for ANY delivery type any
  // more, including wide/no-ball (see the confirmed rule below).
  zoneSwapApplies = zoneHit !== null,
}) {
  let zoneRuns = 0;
  let crossingRun = 0;
  let extraMandatoryRun = 0;
  let batterRuns = 0;
  let extraRuns = 0;

  if (zoneHit !== null && !VALID_ZONES.includes(zoneHit)) {
    return { totalRuns: 0, isLegalDelivery: deliveryType === 'normal', error: 'invalid_zone' };
  }

  const isLegalDelivery = deliveryType === 'normal';

  if (deliveryType === 'wide') {
    // CONFIRMED explicitly this round: a wide is ALWAYS exactly the
    // mandatory +1, full stop — there is no separate "+1 more if
    // crossed" mechanic any more (the old extraPhysicalRun concept is
    // removed; it wasn't a real, separate rule). Zones can NEVER apply
    // on a wide (the bat can't make contact — if it's hit, it's not a
    // wide at all), so zoneHit is ignored defensively even if some
    // stale value were present. The only way a wide can total more
    // than 1 is the scorer's stepper (manualRunAdjustment), representing
    // batters running without the bat touching the ball — confirmed
    // explicitly: "batter can leave the ball as wide and then make a
    // quick run... 2 runs from wide." None of this is ever a batter run.
    extraMandatoryRun = 1;
    if (manualRunAdjustment > 0) extraRuns += manualRunAdjustment;
    extraRuns += extraMandatoryRun;
  } else if (deliveryType === 'no_ball') {
    // CONFIRMED explicitly: a no-ball gets the same flat mandatory +1
    // (always an extra, never a batter run), but UNLIKE a wide, it's a
    // fair-length delivery the batter CAN legitimately hit. Per rule 7
    // ("any runs scored off the bat on a no-ball are credited to the
    // batter"), a zone hit's value + swap bonus (gated by
    // zoneSwapApplies, exactly like a normal delivery) goes to
    // batterRuns, NOT extraRuns — this is the existing, original rule,
    // unchanged. Only the manual/stepper adjustment is carved out as an
    // extra, per rule 13's specific exception for wide/no-ball.
    extraMandatoryRun = 1;
    if (zoneHit !== null && zoneSwapApplies) {
      zoneRuns = zoneHit;
      crossingRun = 1;
      batterRuns += zoneRuns + crossingRun;
    }
    if (manualRunAdjustment > 0) extraRuns += manualRunAdjustment;
    extraRuns += extraMandatoryRun;
  } else {
    if (zoneHit !== null) {
      zoneRuns = zoneHit;
      batterRuns += zoneRuns;
      if (zoneSwapApplies) {
        crossingRun = 1;
        batterRuns += crossingRun;
      }
    }
    if (manualRunAdjustment > 0) batterRuns += manualRunAdjustment;
  }

  const totalRuns = batterRuns + extraRuns;

  return { zoneRuns, crossingRun, extraMandatoryRun, batterRuns, extraRuns, totalRuns, isLegalDelivery };
}

/**
 * Produces the submit button label exactly matching the mockup variants:
 * "Submit dot ball", "Submit 1", "Submit 2"... "Submit WKT", "Submit -4".
 *
 * Verified against both wicket examples in the screenshots:
 * - Normal delivery, wicket, zero runs scored before dismissal:
 *   totalRuns=0, penalty=-5 -> net -5, but mockup shows "Submit WKT" (image
 *   19/Screen 99), not "Submit -5". So when total-runs-before-penalty is
 *   zero, the label is "WKT" regardless of the penalty.
 * - No-ball + wicket (Screen 144): the no-ball's mandatory +1 extra run
 *   means totalRuns=1 BEFORE penalty, so the label switches to showing the
 *   net numeric value: 1 + (-5) = "Submit -4". This is NOT "runs scored off
 *   the bat" — it's specifically "was this delivery's total non-penalty
 *   run value zero or not," which differs for wide/no-ball (always >=1
 *   from the mandatory extra) vs. a clean normal-delivery wicket (can be
 *   exactly 0).
 */
export function getSubmitLabel({ totalRuns, isWicket, deliveryType, tappedNumber }) {
  if (isWicket) {
    // Confirmed explicitly: only the simple case (no other runs scored
    // on this ball) gets the penalty spelled out — "Submit WKT (-5)"
    // rather than just "Submit WKT". The rarer no-ball/wide + wicket
    // case (totalRuns > 0 pre-penalty, e.g. "Submit -4") is unchanged.
    if (totalRuns === 0) return 'Submit WKT (-5)';
    return `Submit ${totalRuns - 5}`;
  }
  if (totalRuns === 0 && deliveryType === 'normal') {
    // Both "nothing tapped yet" and "explicitly tapped 0" produce
    // totalRuns === 0 — tappedNumber is the only thing that
    // distinguishes them. Confirmed explicitly: the empty/disabled
    // default state shows plain "Submit", while a deliberate tap on
    // "0" (a genuine, intentional dot ball) keeps "Submit dot ball".
    return tappedNumber === 0 ? 'Submit dot ball' : 'Submit';
  }
  return `Submit ${totalRuns}`;
}

/**
 * Mirrors server/src/utils/scoringEngine.js totalOversForSquadSize().
 * Confirmed rule: 8 players/team = 16 overs, 9 or 10 players/team = 20
 * overs (a 9-player squad re-uses an existing player to fill the pair,
 * so the over count matches a full 10-player squad). Returns null only
 * for genuinely unsupported squad sizes.
 */
export function totalOversForSquadSize(squadSize) {
  if (squadSize === 8) return 16;
  if (squadSize === 9 || squadSize === 10) return 20;
  return null;
}
