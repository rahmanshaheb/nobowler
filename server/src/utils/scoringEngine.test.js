const { test } = require('node:test');
const assert = require('node:assert');
const { computeDelivery, ScoringRuleError, shouldRotateStrike, validateBowlerActivatedForNewOver, validateBowlerSpellMatch } = require('./scoringEngine');

// ---- Examples lifted directly from the design screenshots ----

test('Zone 6 + swap = 7 runs (batter), batter changes', () => {
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: 6, battersCrossed: true, manualRunAdjustment: 0 });
  assert.strictEqual(r.batterRuns, 7);
  assert.strictEqual(r.totalRuns, 7);
  assert.strictEqual(shouldRotateStrike({ battersCrossed: true }), true);
});

// ---- Zone-override scenarios (confirmed explicitly this round) ----
//
// Overriding the auto-selected zone (e.g. tap 3 -> Zone 2 default, then
// scorer picks Zone 1 instead) must NOT change the total runs for the
// ball — only the split between zone value and leftover physical runs
// changes. Strike rotation then follows real cricket's odd/even parity
// on the TOTAL crossings (the zone's own swap + every leftover physical
// run), computed client-side and passed in as battersCrossed — these
// tests verify computeDelivery() produces the right run totals given
// that pre-computed input, matching the confirmed conversation examples
// exactly.

test('Tap 3, default Zone 2 (no override): 3 runs total, 1 crossing (odd) -> strike changes', () => {
  // 2 (zone value) + 1 (swap) = 3, manualRunAdjustment = 0 (no leftover
  // for the default case). totalCrossings = 1, odd, rotates.
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: 2, battersCrossed: true, manualRunAdjustment: 0 });
  assert.strictEqual(r.totalRuns, 3);
  assert.strictEqual(shouldRotateStrike({ battersCrossed: true }), true);
});

test('Tap 3, overridden to Zone 1: STILL 3 runs total (1 zone + 1 swap + 1 more physical), 2 crossings (even) -> same striker stays', () => {
  // Zone value 1, leftover physical = 3 - 1 - 1 = 1 (verified via code,
  // not mental arithmetic, after catching a subtraction slip while
  // first drafting this test). zoneSwapApplies defaults to true (a
  // zone IS selected), so: 1 (zone) + 1 (swap) + 1 (leftover physical)
  // = 3 — matches the tapped number exactly, as confirmed.
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: 1, manualRunAdjustment: 1 });
  assert.strictEqual(r.totalRuns, 3);
  // totalCrossings = 1 (zone's own swap) + 1 (leftover physical) = 2,
  // even -> does NOT rotate, confirmed explicitly ("same batter on
  // strike again").
  assert.strictEqual(shouldRotateStrike({ battersCrossed: false }), false);
});

test('Tap 7, default Zone 6, stepper +1: 8 runs total, 2 crossings (even) -> same striker stays', () => {
  // Zone value 6, swap 1 (zone's own, default case has 0 leftover from
  // the table), plus stepper +1 folded into manualRunAdjustment = 1.
  // 6 (zone) + 1 (swap) + 1 (stepper) = 8.
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: 6, manualRunAdjustment: 1 });
  assert.strictEqual(r.totalRuns, 8);
  // totalCrossings = 1 (zone's swap) + 1 (stepper) = 2, even -> does NOT rotate.
  assert.strictEqual(shouldRotateStrike({ battersCrossed: false }), false);
});

test('Zone 6 selected: the zone always gets its swap bonus once chosen (rule 12, re-confirmed under the zone-override model)', () => {
  // Rule 12 ("no swapping no run from zones") was originally implemented
  // wrong — it credited the zone's base value (6) even with no swap.
  // That was corrected so a zone hit without a swap scores ZERO.
  //
  // This round (zone-override + odd/even rotation model) clarified
  // WHERE that "no swap" scenario actually lives in the UI: it's
  // represented by the scorer tapping 0 with NO zone selected at all
  // — not by selecting a zone and passing battersCrossed=false. Once
  // any zone IS selected, its swap bonus always applies (zoneSwapApplies
  // defaults to true whenever zoneHit is not null). battersCrossed, for
  // a normal delivery, is now a SEPARATE odd/even rotation signal and no
  // longer gates whether the zone's value counts toward the run total.
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: 6, manualRunAdjustment: 1 });
  assert.strictEqual(r.zoneRuns, 6);
  assert.strictEqual(r.crossingRun, 1);
  assert.strictEqual(r.batterRuns, 8); // zone(6) + swap(1) + manual(1)
});

test('Zone 6 hit with NO run at all is represented by tapping 0, no zone selected — not by zoneSwapApplies=false', () => {
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: null, manualRunAdjustment: 0 });
  assert.strictEqual(r.zoneRuns, 0);
  assert.strictEqual(r.crossingRun, 0);
  assert.strictEqual(r.batterRuns, 0);
});

test('Zone 4 + swap = 5 runs', () => {
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: 4, battersCrossed: true, manualRunAdjustment: 0 });
  assert.strictEqual(r.batterRuns, 5);
});

test('Zone 2 + swap = 3 runs', () => {
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: 2, battersCrossed: true, manualRunAdjustment: 0 });
  assert.strictEqual(r.batterRuns, 3);
});

test('Zone 1 + swap = 2 runs', () => {
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: 1, battersCrossed: true, manualRunAdjustment: 0 });
  assert.strictEqual(r.batterRuns, 2);
});

test('Same run total (2), reached via zone+swap vs. pure manual runs — confirms swap is independent of runs', () => {
  // The run MATH for reaching the same total can come from different
  // sources: a zone hit WITH a swap, or pure physical runs with no zone
  // at all. Both should be able to total 2 runs; the rotation flag is
  // independently controlled by battersCrossed in either case.
  const viaZoneSwap = computeDelivery({ deliveryType: 'normal', zoneHit: 1, battersCrossed: true, manualRunAdjustment: 0 });
  const viaPureManual = computeDelivery({ deliveryType: 'normal', zoneHit: null, battersCrossed: false, manualRunAdjustment: 2 });
  // viaZoneSwap: zone(1) + crossing(1) = 2
  assert.strictEqual(viaZoneSwap.batterRuns, 2);
  // viaPureManual: manual(2), no zone involved at all
  assert.strictEqual(viaPureManual.batterRuns, 2);
  assert.strictEqual(shouldRotateStrike({ battersCrossed: true }), true);
  assert.strictEqual(shouldRotateStrike({ battersCrossed: false }), false);
});

test('Wide alone = 1 extra run, not a legal delivery, not a batter run', () => {
  const r = computeDelivery({ deliveryType: 'wide', zoneHit: null, manualRunAdjustment: 0 });
  assert.strictEqual(r.isLegalDelivery, false);
  assert.strictEqual(r.extraMandatoryRun, 1);
  assert.strictEqual(r.batterRuns, 0);
  assert.strictEqual(r.extraRuns, 1);
  assert.strictEqual(r.totalRuns, 1);
});

test('Wide + batters run without hitting (stepper) = mandatory +1 plus the stepper, still zero batter runs', () => {
  // CONFIRMED explicitly this round: a wide is ALWAYS exactly the
  // mandatory +1 — the old "extra +1 if crossed on the wide itself"
  // mechanic is removed; it wasn't a real, separate rule. The only way
  // a wide totals more than 1 is the scorer's stepper, representing
  // batters running without the bat touching the ball: "batter can
  // leave the ball as wide and then make a quick run... 2 runs from
  // wide. No batter will get this run." Zones can never apply on a
  // wide at all (the bat can't make contact), so zoneHit is ignored
  // even if passed.
  const r = computeDelivery({ deliveryType: 'wide', zoneHit: null, manualRunAdjustment: 1 });
  assert.strictEqual(r.extraMandatoryRun, 1);
  assert.strictEqual(r.batterRuns, 0);
  assert.strictEqual(r.extraRuns, 2); // mandatory(1) + stepper(1)
  assert.strictEqual(r.totalRuns, 2);
});

test('Wide with a zoneHit present is still ignored entirely — zones can never apply on a wide', () => {
  const r = computeDelivery({ deliveryType: 'wide', zoneHit: 6, manualRunAdjustment: 0 });
  assert.strictEqual(r.zoneRuns, 0);
  assert.strictEqual(r.crossingRun, 0);
  assert.strictEqual(r.totalRuns, 1); // just the mandatory run, zoneHit=6 contributes nothing
});

test('No-ball alone = 1 extra run, not legal delivery', () => {
  const r = computeDelivery({ deliveryType: 'no_ball', zoneHit: null, manualRunAdjustment: 0 });
  assert.strictEqual(r.isLegalDelivery, false);
  assert.strictEqual(r.extraMandatoryRun, 1);
  assert.strictEqual(r.totalRuns, 1);
});

test('No-ball + zone hit credits the zone+swap runs to the batter (rule 7), plus the mandatory extra', () => {
  // Rule 7 says runs off the bat on a no-ball go to the batter. Once a
  // zone is selected, zoneSwapApplies defaults to true (same as a
  // normal delivery — see the rule-12 comment), so the zone's value +
  // swap bonus go to batterRuns. The mandatory no-ball run itself
  // always stays a separate extra, never a batter run.
  const r = computeDelivery({ deliveryType: 'no_ball', zoneHit: 4, manualRunAdjustment: 0 });
  assert.strictEqual(r.batterRuns, 5); // zone(4) + swap(1) = 5, credited to the batter
  assert.strictEqual(r.extraRuns, 1); // just the mandatory no-ball extra
  assert.strictEqual(r.totalRuns, 6);
});

test('No-ball + zone hit + stepper: zone+swap to batter, stepper as a separate extra (rule 13)', () => {
  // Confirmed explicitly this round: on a no-ball, "if the batter hits
  // any zone or any physical run those will be counted additionally."
  // The zone+swap is a batter run (rule 7); the stepper/manual
  // adjustment stays an extra (rule 13's wide/no-ball carve-out) —
  // mirrors the exact screenshot scenario (tap 7, Zone 6, no-ball,
  // stepper +1 -> total 9).
  const r = computeDelivery({ deliveryType: 'no_ball', zoneHit: 6, manualRunAdjustment: 1 });
  assert.strictEqual(r.batterRuns, 7); // zone(6) + swap(1) = 7
  assert.strictEqual(r.extraRuns, 2); // stepper(1) + mandatory(1)
  assert.strictEqual(r.totalRuns, 9);
});

test('No-ball with zoneSwapApplies explicitly false: zone contributes 0 (defensive API-level case, not reachable through the current UI)', () => {
  // Mirrors the equivalent normal-delivery defensive test — the
  // confirmed UI flow never produces "zone hit, no swap" any more (that
  // real-world scenario is represented by tapping 0 with no zone
  // selected), but the function still handles an explicit
  // zoneSwapApplies=false correctly if ever called this way directly.
  const r = computeDelivery({ deliveryType: 'no_ball', zoneHit: 4, zoneSwapApplies: false, manualRunAdjustment: 0 });
  assert.strictEqual(r.batterRuns, 0);
  assert.strictEqual(r.extraRuns, 1); // just the mandatory no-ball extra
  assert.strictEqual(r.totalRuns, 1);
});

test('Dot ball — zero everything', () => {
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: null, battersCrossed: false, manualRunAdjustment: 0 });
  assert.strictEqual(r.totalRuns, 0);
  assert.strictEqual(r.isLegalDelivery, true);
});

test('Out carries -5 penalty, independent of runs scored before the dismissal', () => {
  const r = computeDelivery({
    deliveryType: 'normal',
    zoneHit: 1,
    battersCrossed: true,
    manualRunAdjustment: 0,
    isWicket: true,
    wicketType: 'run_out',
  });
  assert.strictEqual(r.batterRuns, 2); // runs completed before the run-out still count
  assert.strictEqual(r.penaltyRuns, -5);
});

test('Wicket requires a wicketType', () => {
  assert.throws(
    () => computeDelivery({ deliveryType: 'normal', isWicket: true, wicketType: null }),
    ScoringRuleError
  );
});

test('Rule 14: Zone 6 cannot be a run-out', () => {
  assert.throws(
    () => computeDelivery({
      deliveryType: 'normal',
      zoneHit: 6,
      isWicket: true,
      wicketType: 'run_out',
    }),
    ScoringRuleError
  );
});

test('Rule 14: Zone 6 cannot be a catch', () => {
  assert.throws(
    () => computeDelivery({
      deliveryType: 'normal',
      zoneHit: 6,
      isWicket: true,
      wicketType: 'caught',
    }),
    ScoringRuleError
  );
});

test('Zone 6 CAN be bowled or stumped (not exempted by rule 14)', () => {
  const bowled = computeDelivery({ deliveryType: 'normal', zoneHit: 6, isWicket: true, wicketType: 'bowled' });
  assert.strictEqual(bowled.penaltyRuns, -5);
  const stumped = computeDelivery({ deliveryType: 'normal', zoneHit: 6, isWicket: true, wicketType: 'stumped' });
  assert.strictEqual(stumped.penaltyRuns, -5);
});

test('Invalid zone throws', () => {
  assert.throws(() => computeDelivery({ deliveryType: 'normal', zoneHit: 3 }), ScoringRuleError);
  assert.throws(() => computeDelivery({ deliveryType: 'normal', zoneHit: 5 }), ScoringRuleError);
});

test('Manual run on normal ball is a batter run (rule 13)', () => {
  const r = computeDelivery({ deliveryType: 'normal', zoneHit: null, battersCrossed: false, manualRunAdjustment: 1 });
  assert.strictEqual(r.batterRuns, 1);
  assert.strictEqual(r.extraRuns, 0);
});

test('Manual run on wide/no-ball is NOT a batter run (rule 13 exception)', () => {
  const wide = computeDelivery({ deliveryType: 'wide', zoneHit: null, battersCrossed: false, manualRunAdjustment: 1 });
  assert.strictEqual(wide.batterRuns, 0);
  assert.strictEqual(wide.extraRuns, 2); // mandatory(1) + manual(1)
});

test('Mid-over delivery skips bowler activation check', () => {
  assert.doesNotThrow(() =>
    validateBowlerActivatedForNewOver({
      lastLegalDelivery: { sequence_number: 50, ball_number_in_over: 3 },
      spellActivatedAfterSequence: 40,
    })
  );
});

test('New over rejects stale bowling spell (not re-selected after over complete)', () => {
  assert.throws(
    () =>
      validateBowlerActivatedForNewOver({
        lastLegalDelivery: { sequence_number: 112, ball_number_in_over: 6 },
        spellActivatedAfterSequence: 72,
      }),
    ScoringRuleError
  );
});

test('New over accepts spell picked after previous over finished', () => {
  assert.doesNotThrow(() =>
    validateBowlerActivatedForNewOver({
      lastLegalDelivery: { sequence_number: 112, ball_number_in_over: 6 },
      spellActivatedAfterSequence: 112,
    })
  );
});

test('Bowler id must match bowling spell row', () => {
  assert.throws(
    () =>
      validateBowlerSpellMatch({
        bowlerId: 'bowler-a',
        spellBowlerId: 'bowler-b',
      }),
    ScoringRuleError
  );
});
