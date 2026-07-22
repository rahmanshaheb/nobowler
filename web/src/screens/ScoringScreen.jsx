// ScoringScreen.jsx
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import './ScoringScreen.css';
import { computeDeliveryPreview, getSubmitLabel } from '../hooks/useDeliveryComputation';
import WicketModal from '../components/WicketModal';
import UndoConfirmModal from '../components/UndoConfirmModal';
import OverBallHistory from '../components/OverBallHistory';
import { playDingSound } from '../utils/sound';

const ZONES = [1, 2, 4, 6];

/**
 * @param {Object} props
 * @param {Object} props.matchState - { overNumber, ballNumberInOver, runs, wickets, ballsInOver: boolean[6] (filled/wide/noball/empty) }
 * @param {Object} props.pair - { pairNumber, strikerName, nonStrikerName, bowlerName }
 * @param {string[]} props.fieldingTeamPlayers - names for the wicket fielder-attribution screen
 * @param {number} props.scorerCount - how many scorer sessions are active (co-scoring badge)
 * @param {(delivery: object) => Promise<void>} props.onSubmit
 * @param {() => Promise<void>} props.onUndo
 * @param {boolean} props.canUndo
 * @param {() => void} props.onOpenMenu
 * @param {() => void} props.onEditPair - opens the "who's batting" editor (the pen icon next to "Pair 1")
 * @param {() => void} props.onChangeBowler - opens the bowler-selection screen
 * @param {() => void} props.onSwapStriker - immediately swaps which batter is shown as striker (the ⇄ icon next to the striker's name). Distinct from the internal battersCrossed rotation guess used for the NEXT delivery's scoring math — this is a direct, visible correction for right now, e.g. when the auto-rotation guessed wrong on the previous ball.
 */
export default function ScoringScreen({
  matchState,
  pair,
  fieldingTeamPlayers = [],
  scorerCount = 1,
  onSubmit,
  onUndo,
  canUndo,
  onOpenMenu,
  onEditPair,
  onChangeBowler,
  onSwapStriker,
  wideCountEnabled = true,
}) {
  const [deliveryType, setDeliveryType] = useState('normal'); // 'normal' | 'wide' | 'no_ball'
  const [tappedNumber, setTappedNumber] = useState(null); // the 0-7 key the scorer tapped — the PRIMARY input
  const [zoneOverride, setZoneOverride] = useState(undefined); // undefined = use auto-derived zone; null = scorer explicitly deselected the auto zone (pure physical runs instead); a number = scorer explicitly picked a different zone
  const [stepperValue, setStepperValue] = useState(0); // ADDITIONAL physical runs on top of the tapped number's auto-derived breakdown (used directly when no zone is in play, e.g. wide/no-ball extras, or extra correction)
  const [wicketModalOpen, setWicketModalOpen] = useState(false);
  const [wicketDraft, setWicketDraft] = useState(null); // { wicketType, fielderId, dismissedPlayerId }
  const [undoModalOpen, setUndoModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Derive consecutive dot ball count from current over's deliveries.
  // Using derived state (not tracked state) means undo automatically
  // gives the correct count — no stale state to reset.
  const consecutiveDots = useMemo(() => {
    const deliveries = matchState.overDeliveries ?? [];
    let count = 0;
    // Walk backwards through deliveries counting trailing normal dot balls
    for (let i = deliveries.length - 1; i >= 0; i--) {
      const d = deliveries[i];
      if (d.deliveryType === 'normal' && Number(d.totalRuns) === 0 && !d.isWicket) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }, [matchState.overDeliveries]);

  // Striker-change flash: confirmed explicitly, this covers BOTH the
  // automatic rotation after a delivery AND the manual swap icon, with
  // one rule rather than two — a scorer raised a real concern that an
  // unnoticed striker change could go uncaught for an entire over
  // (undo can only fix the single most recent ball, not reach back
  // further), so the fix is making any CHANGE visually catch the eye
  // in the moment, not relying on the scorer reading a static name
  // every single ball. Detected at the DISPLAY level (comparing
  // pair.strikerName to its own previous value) rather than
  // instrumenting every individual place the striker could change in
  // LiveMatchContainer.jsx — this way it automatically covers every
  // current and future cause, not just the ones explicitly wired today.
  const [strikerFlashing, setStrikerFlashing] = useState(false);
  // Keyed on strikerId, not strikerName — two players can share a
  // display name (e.g. both named "Asif"), in which case the name
  // string never changes across a swap even though the striker did.
  const previousStrikerId = useRef(pair.strikerId);
  useEffect(() => {
    if (previousStrikerId.current !== pair.strikerId) {
      previousStrikerId.current = pair.strikerId;
      setStrikerFlashing(true);
      const timer = setTimeout(() => setStrikerFlashing(false), 900);
      return () => clearTimeout(timer);
    }
  }, [pair.strikerId]);

  const isWicketPending = wicketDraft !== null;

  // VERIFIED LOOKUP TABLE (corrected — rule 12, confirmed explicitly):
  // a zone hit WITHOUT a swap scores ZERO. Zones only ever produce runs
  // together with a swap (zoneValue + 1). This means there is no
  // meaningful "zone selected, no swap" state any more — whenever a
  // zone is in play, a swap is implied. The numbers below decompose
  // each tapped total into (at most one zone+swap) PLUS leftover
  // physical runs that don't come from any zone. Confirmed against the
  // backend's exact formula (zoneRuns + crossingRun(1) + manualRunAdjustment):
  //
  // 0 -> no zone, 0 physical (dot ball)
  // 1 -> no zone, 1 physical (no zone produces exactly 1 via zone+swap)
  // 2 -> Zone 1 + swap (1+1=2 exactly), 0 leftover
  // 3 -> Zone 2 + swap (2+1=3 exactly), 0 leftover
  // 4 -> Zone 2 + swap (2+1=3) + 1 leftover physical = 4 total
  // 5 -> Zone 4 + swap (4+1=5 exactly), 0 leftover
  // 6 -> Zone 4 + swap (4+1=5) + 1 leftover physical = 6 total
  // 7 -> Zone 6 + swap (6+1=7 exactly), 0 leftover
  const NUMBER_BREAKDOWN = {
    0: { zone: null, leftoverPhysical: 0 },
    1: { zone: null, leftoverPhysical: 1 },
    2: { zone: 1, leftoverPhysical: 0 },
    3: { zone: 2, leftoverPhysical: 0 },
    4: { zone: 2, leftoverPhysical: 1 },
    5: { zone: 4, leftoverPhysical: 0 },
    6: { zone: 4, leftoverPhysical: 1 },
    7: { zone: 6, leftoverPhysical: 0 },
  };

  const autoForTappedNumber = tappedNumber !== null ? NUMBER_BREAKDOWN[tappedNumber] : null;

  // zoneHit: undefined override means "use the auto-derived zone for
  // whatever number was tapped." null override means the scorer
  // explicitly deselected it (turning the WHOLE tapped number into pure
  // physical runs, since a zone without a swap is worth 0 anyway — there's
  // no in-between "zone but no swap" state to represent any more).
  const zoneHit = zoneOverride === undefined ? (autoForTappedNumber?.zone ?? null) : zoneOverride;

  // Per-number zone gating, confirmed explicitly: the zone matching the
  // tapped number's default (e.g. 3/4 -> Zone 2, 5/6 -> Zone 4, 7 ->
  // Zone 6) is pre-selected via zoneHit above, and only zones at or
  // BELOW that rank in the ZONES order [1, 2, 4, 6] stay selectable —
  // anything above is disabled. For 0/1, the default zone is null, so
  // maxZoneIndex is -1 and every zone is disabled. Computed once here
  // (rather than freshly inside the zone-row .map() below) to avoid
  // duplicating the read of autoForTappedNumber.zone in two scopes.
  const maxZoneIndex =
    autoForTappedNumber?.zone == null ? -1 : ZONES.indexOf(autoForTappedNumber.zone);

  // CONFIRMED RULE CHANGE: overriding the zone (e.g. tap 3 -> Zone 2
  // auto-selected, then scorer picks Zone 1 instead) does NOT change
  // the total runs for this ball — the tapped number is the fixed
  // total. Only the SPLIT between "zone value" and "leftover physical
  // runs" changes to match whichever zone is now selected. Formula:
  // leftoverPhysical = tappedNumber - zoneHit - 1 (the trailing -1 is
  // the zone's own mandatory swap/crossing). If the zone is fully
  // deselected (zoneOverride === null), there's no zone value or
  // implied swap at all — the whole tapped number becomes leftover
  // physical runs directly.
  const leftoverPhysicalForZone =
    zoneHit !== null && tappedNumber !== null ? tappedNumber - zoneHit - 1 : (tappedNumber ?? 0);

  // manualRunAdjustment sent to the backend: leftover physical runs
  // (recomputed above for whichever zone is currently selected) plus
  // the stepper's value. The stepper exists specifically to extend past
  // 7 (there's no numpad key for 8/9) — confirmed explicitly that
  // stepper runs are real physical/running runs too, so they're folded
  // into the same leftover-physical pool as the zone-override leftover.
  const manualRunAdjustment =
    zoneOverride === null && tappedNumber !== null
      ? tappedNumber + stepperValue
      : leftoverPhysicalForZone + stepperValue;

  // IMPORTANT: this is a SEPARATE concept from the new odd/even
  // battersCrossed below, even though both used to be the exact same
  // boolean before this round's rule change. zoneSwapApplies governs
  // whether the zone's own +1 swap bonus counts toward the RUN TOTAL —
  // confirmed explicitly that this is ALWAYS true whenever any zone is
  // selected at all (preserves rule 12 exactly as originally built: a
  // zone hit always gets its swap bonus once a zone is actually chosen;
  // the "zone hit with no swap" real-world scenario is represented by
  // tapping 0 with no zone selected at all, not by a zone with this
  // flag set false). Sent to the backend as a distinct field from
  // battersCrossed.
  const zoneSwapApplies = zoneHit !== null;

  // CONFIRMED RULE CHANGE: strike rotation now follows real cricket's
  // odd/even parity on the TOTAL number of physical/crossing runs run
  // between the wickets this ball — not simply "was any zone selected."
  // totalCrossings = (1, if a zone is in play — the zone's own implied
  // swap) + every leftover physical run (zone-override leftover AND/OR
  // stepper value, both folded into manualRunAdjustment above). The
  // strike changes only if that total is ODD. This applies universally,
  // including 0/1 (no zone at all: tap 1 now correctly auto-rotates,
  // tap 0 correctly doesn't) and a fully-deselected zone (pure physical
  // runs, same odd/even rule). Verified against three confirmed
  // examples: tap 3/Zone 2 default -> 1 crossing, rotates; tap 3
  // overridden to Zone 1 -> 2 crossings, does NOT rotate; tap 7/Zone 6
  // default + stepper +1 -> 2 crossings, does NOT rotate.
  const totalCrossings = (zoneHit !== null ? 1 : 0) + manualRunAdjustment;
  const battersCrossed = totalCrossings % 2 === 1;

  const preview = useMemo(
    () =>
      computeDeliveryPreview({
        deliveryType,
        zoneHit,
        manualRunAdjustment,
        zoneSwapApplies,
      }),
    [deliveryType, zoneHit, manualRunAdjustment, zoneSwapApplies]
  );

  const isThirdDot = consecutiveDots === 2 && tappedNumber === 0 && deliveryType === 'normal' && !isWicketPending;

  const isNoWideMode = !wideCountEnabled && deliveryType === 'wide';

  const submitLabel = useMemo(
    () => {
      if (isThirdDot) return 'Submit −5';
      if (isNoWideMode) return `Submit ${2 + stepperValue}`;
      return getSubmitLabel({ totalRuns: preview.totalRuns, isWicket: isWicketPending, deliveryType, tappedNumber });
    },
    [isThirdDot, isNoWideMode, stepperValue, preview.totalRuns, isWicketPending, deliveryType, tappedNumber]
  );

  function resetBallInputs() {
    setDeliveryType('normal');
    setTappedNumber(null);
    setZoneOverride(undefined);
    setStepperValue(0);
    setWicketDraft(null);
  }

  // Tapping a run key that's already selected clears the selection
  // ("Clear selection" behavior from the mockup: Screen 128 shows tapping
  // the active "7" key again clears it back to no selection). Tapping a
  // NEW number resets any zone override from the previous number, since
  // it was specific to the ball that's now changed.
  function handleNumberTap(n) {
    setTappedNumber((prev) => (prev === n ? null : n));
    setZoneOverride(undefined);
    // Reset the stepper on every number change — fixes a real gap: a
    // stale stepper value could otherwise silently persist into the run
    // calculation after switching away from 7, with no way to clear it
    // through the UI once the stepper buttons become disabled for any
    // other number (confirmed explicitly this round: stepper only
    // active when 7 is tapped).
    setStepperValue(0);
  }

  // Tapping a zone button directly overrides whatever zone the lookup
  // table auto-selected. Tapping the SAME zone that's already showing
  // (whether auto-derived or already overridden) clears it back to "no
  // zone" — turning the WHOLE tapped number into pure physical runs.
  // No separate "reset the swap" step is needed here any more: since
  // battersCrossed is now purely derived as (zoneHit !== null), clearing
  // the zone automatically and correctly clears battersCrossed too —
  // there's no override layer left to keep in sync.
  function handleZoneTap(zone) {
    setZoneOverride((prevOverride) => {
      const currentEffectiveZone = prevOverride === undefined ? (autoForTappedNumber?.zone ?? null) : prevOverride;
      const isDeselecting = currentEffectiveZone === zone;
      return isDeselecting ? null : zone;
    });
  }

  const INVALID_ON_EXTRA = new Set(['bowled', 'caught', 'caught_and_bowled']);

  function handleWideTap() {
    setDeliveryType((prev) => (prev === 'wide' ? 'normal' : 'wide'));
    setTappedNumber(null);
    setZoneOverride(undefined);
    setStepperValue(0);
    // Clear bowled/caught/c&b wicket — not valid on a wide
    if (wicketDraft && INVALID_ON_EXTRA.has(wicketDraft.wicketType)) {
      setWicketDraft(null);
    }
  }

  function handleNoBallTap() {
    setDeliveryType((prev) => (prev === 'no_ball' ? 'normal' : 'no_ball'));
    // Clear bowled/caught/c&b wicket — not valid on a no-ball
    if (wicketDraft && INVALID_ON_EXTRA.has(wicketDraft.wicketType)) {
      setWicketDraft(null);
    }
  }

  function handleWktTap() {
    if (isWicketPending) {
      setWicketDraft(null);
    } else {
      setWicketModalOpen(true);
    }
  }

  function handleWicketConfirm(draft) {
    setWicketDraft(draft);
    setWicketModalOpen(false);
  }

  const handleSubmit = useCallback(async () => {
    playDingSound();
    setSubmitting(true);
    const isThreeDots = consecutiveDots === 2 && tappedNumber === 0 && deliveryType === 'normal' && !isWicketPending;
    const noWideMode = !wideCountEnabled && deliveryType === 'wide';
    // In no-wide mode: the 2 mandatory runs are extras (no rotation),
    // but stepper runs are physical batter runs — odd stepper = batter changes.
    const effectiveBattersCrossed = noWideMode
      ? (stepperValue % 2 === 1)
      : battersCrossed;
    try {
      await onSubmit({
        deliveryType,
        zoneHit,
        battersCrossed: effectiveBattersCrossed,
        manualRunAdjustment,
        zoneSwapApplies,
        isWicket: isThreeDots ? true : isWicketPending,
        wicketType: isThreeDots ? 'three_dots' : (wicketDraft?.wicketType ?? null),
        dismissedPlayerId: isThreeDots ? pair.strikerId : (wicketDraft?.dismissedPlayerId ?? null),
        fielderId: isThreeDots ? null : (wicketDraft?.fielderId ?? null),
        wideCountEnabled,
      });
      resetBallInputs();
    } finally {
      setSubmitting(false);
    }
  }, [deliveryType, zoneHit, battersCrossed, manualRunAdjustment, zoneSwapApplies, isWicketPending, wicketDraft, tappedNumber, pair.strikerId, consecutiveDots, wideCountEnabled, onSubmit]);

  async function handleConfirmUndo() {
    await onUndo();
    setUndoModalOpen(false);
  }

  return (
    <div className="scoring-screen">
      <header className="scoring-header">
        <div className="scoring-header__row">
          <div className="scoring-header__stat">
            <span className="scoring-header__label">Runs</span>
            <span className="scoring-header__value">
              {matchState.inningsNumber === 2 && matchState.targetRuns ? (
                <>
                  {matchState.runs}
                  <span className="scoring-header__value-target">/{matchState.targetRuns}</span>
                </>
              ) : (
                matchState.runs
              )}
            </span>
          </div>
          <div className="scoring-header__stat">
            <span className="scoring-header__label">Over</span>
            <span className="scoring-header__value">
              {matchState.ballNumberInOver === 6 ? matchState.overNumber + 1 : matchState.overNumber}.
              {matchState.ballNumberInOver === 6 ? 0 : matchState.ballNumberInOver}
            </span>
          </div>
          <div className="scoring-header__innings">
            <span className="scoring-header__label">Innings {matchState.inningsNumber ?? 1}</span>
            <span className="scoring-header__innings-team">{matchState.battingTeamName || 'Team A'}</span>
          </div>
        </div>
        <button className="menu-button" onClick={onOpenMenu} aria-label="Open match menu">
          ≡
          {scorerCount > 1 && <span className="co-scoring-badge">{scorerCount}</span>}
        </button>
      </header>

      <OverBallHistory deliveries={matchState.overDeliveries ?? []} />

      <div className="match-context-row">
        <div className="match-context-cell match-context-cell--clickable" onClick={onEditPair} role="button" tabIndex={0}>
          <span className="match-context-cell__label">
            Pair
            <button className="icon-button-inline" aria-label="Change who's batting" tabIndex={-1}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-pencil-icon lucide-pencil"
              >
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
          </span>
          <span className="match-context-cell__value">{pair.pairNumber}</span>
        </div>
        <div className="match-context-cell match-context-cell--clickable" onClick={onSwapStriker} role="button" tabIndex={0}>
          <span className="match-context-cell__label">
            Striker
            <button className="icon-button-inline" aria-label="Swap striker — Player 2 comes on strike" tabIndex={-1}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-arrow-right-left-icon lucide-arrow-right-left"
              >
                <path d="m16 3 4 4-4 4" />
                <path d="M20 7H4" />
                <path d="m8 21-4-4 4-4" />
                <path d="M4 17h16" />
              </svg>
            </button>
          </span>
          <span className={`match-context-cell__value ${strikerFlashing ? 'match-context-cell__value--flash' : ''}`}>{pair.strikerName}</span>
        </div>
        <div className="match-context-cell match-context-cell--clickable" onClick={onChangeBowler} role="button" tabIndex={0}>
          <span className="match-context-cell__label">
            Bowler
            <button className="icon-button-inline" aria-label="Change bowler" tabIndex={-1}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-refresh-cw-icon lucide-refresh-cw"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </button>
          </span>
          <span className={`match-context-cell__value ${!pair.hasBowler ? 'match-context-cell__value--warning' : ''}`}>{pair.bowlerName}</span>
        </div>
      </div>

      <div className="delivery-type-row">
        <button
          className={`pill-button ${deliveryType === 'wide' ? 'pill-button--active' : ''}`}
          disabled={!pair.hasBowler || submitting}
          onClick={handleWideTap}
        >
          WIDE
        </button>
        <button
          className={`pill-button ${deliveryType === 'no_ball' ? 'pill-button--active' : ''}`}
          disabled={!pair.hasBowler || submitting}
          onClick={handleNoBallTap}
        >
          NO
        </button>
        <button
          className={`pill-button pill-button--wkt ${isWicketPending ? 'pill-button--wkt-active' : ''}`}
          disabled={!pair.hasBowler || submitting}
          onClick={handleWktTap}
        >
          WKT {isWicketPending && (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          )}
        </button>
      </div>

      <div className="numpad-grid">
        {/* Confirmed explicitly: numpad is disabled on WIDE — a wide
            can never be hit (if it's hit, it isn't a wide at all). The
            stepper below stays enabled, since batters can still run
            without making contact. No-ball keeps the numpad enabled,
            since it's a fair-length delivery the batter CAN legitimately
            hit. */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
          <button
            key={n}
            className={`numpad-key ${tappedNumber === n ? 'numpad-key--selected' : ''}`}
            disabled={!pair.hasBowler || deliveryType === 'wide' || submitting}
            onClick={() => handleNumberTap(n)}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="zone-row">
        {/* Explicit, defensive WIDE check here too, even though the
            numpad being disabled already keeps tappedNumber null while
            WIDE is active — this avoids depending solely on that
            indirect consequence for a rule this important. */}
        {ZONES.map((z) => {
          const aboveAllowedRank = ZONES.indexOf(z) > maxZoneIndex;
          return (
            <button
              key={z}
              className={`zone-button ${zoneHit === z ? 'zone-button--selected' : ''}`}
              disabled={tappedNumber === null || !pair.hasBowler || aboveAllowedRank || deliveryType === 'wide' || submitting}
              onClick={() => handleZoneTap(z)}
            >
              Zone {z}
            </button>
          );
        })}
      </div>

      <div className="controls-row">
        <button className="undo-button" disabled={!canUndo || !pair.hasBowler} onClick={() => setUndoModalOpen(true)}>
          UNDO
        </button>
        {/* Numeric stepper: exists to extend PAST 7 (no numpad key for
            8/9), so it's disabled for every tapped number except 7 —
            EXCEPT on WIDE, which is a separate, genuine exception: the
            numpad is locked out entirely on a wide (bat can't make
            contact), so the stepper is the ONLY way to record batters
            running without hitting the ball (confirmed explicitly:
            "batter can leave the ball as wide and then make a quick
            run... 2 runs from wide"). NO_BALL is unaffected — it
            follows the normal tappedNumber!==7 rule, same as a normal
            delivery, since a no-ball CAN be legitimately hit.

            stepperDisabled is computed once here and applied to the
            CONTAINER too, not just the individual +/- buttons — fixes
            a real visual gap where the buttons themselves correctly
            dimmed while disabled, but the surrounding border and the
            "0" value text didn't, making the stepper look active/white
            even when it wasn't actually usable yet (confirmed via
            screenshot: zone buttons dim to the disabled style while
            waiting for a number tap, the stepper border didn't). */}
        {(() => {
          const stepperDisabled = !pair.hasBowler || submitting || (deliveryType !== 'wide' && tappedNumber !== 7);
          return (
            <div
              className={`stepper ${stepperValue > 0 ? 'stepper--active' : ''} ${stepperDisabled ? 'stepper--disabled' : ''}`}
            >
              <button className="stepper__btn" disabled={stepperDisabled} onClick={() => setStepperValue((v) => Math.max(0, v - 1))}>
                −
              </button>
              <span className="stepper__value">{stepperValue}</span>
              <button className="stepper__btn" disabled={stepperDisabled} onClick={() => setStepperValue((v) => v + 1)}>
                +
              </button>
            </div>
          );
        })()}
      </div>

      {matchState.totalOvers != null &&
        (matchState.overNumber > matchState.totalOvers - 1 ||
          (matchState.overNumber === matchState.totalOvers - 1 && matchState.ballNumberInOver >= 6)) && (
          <div className="banner banner--alert">Overs complete — end this innings when ready</div>
        )}
      {matchState.totalOvers != null &&
        matchState.overNumber === matchState.totalOvers - 1 &&
        matchState.ballNumberInOver < 6 && (
          <div className="banner banner--alert">Final over</div>
        )}

      {scorerCount > 1 && (
        <div className="banner banner--alert">{scorerCount} scorers are scoring</div>
      )}

      {/* Requires an explicit number tap before submitting a NORMAL
          delivery — confirmed fix: previously the button was only
          disabled while a request was in flight, so a scorer could
          submit a blank/default dot ball repeatedly with no input at
          all, which is the likely cause of inflated/duplicated scoring
          during last night's confusion. Wicket deliveries and wide/
          no-ball are exempt (confirmed explicitly): a wicket IS the
          action being recorded even with 0 runs, and the mandatory
          wide/no-ball extra applies whether or not a number was tapped. */}
      <div className="on-strike-indicator">
        <span className="on-strike-indicator__label">On strike:</span>
        <span className="on-strike-indicator__name">{pair.strikerName}</span>
      </div>

      <button
        className={`submit-button ${isWicketPending ? 'submit-button--wicket-pending' : ''} ${isThirdDot ? 'submit-button--three-dots' : ''}`}
        disabled={!pair.hasBowler || submitting || (tappedNumber === null && !isWicketPending && deliveryType === 'normal')}
        onClick={handleSubmit}
      >
        {submitting ? 'Submitting…' : submitLabel}
      </button>

      {wicketModalOpen && (
        <WicketModal
          strikerName={pair.strikerName}
          nonStrikerName={pair.nonStrikerName}
          strikerId={pair.strikerId}
          nonStrikerId={pair.nonStrikerId}
          bowlerId={pair.bowlerId}
          deliveryType={deliveryType}
          fieldingTeamPlayers={fieldingTeamPlayers}
          onClose={() => setWicketModalOpen(false)}
          onConfirm={handleWicketConfirm}
        />
      )}

      {undoModalOpen && (
        <UndoConfirmModal onCancel={() => setUndoModalOpen(false)} onConfirm={handleConfirmUndo} />
      )}
    </div>
  );
}
