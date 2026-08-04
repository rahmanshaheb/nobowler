// LiveMatchContainer.jsx
import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import { totalOversForSquadSize } from '../hooks/useDeliveryComputation';
import { clearActiveMatchId } from '../utils/matchStorage';
import { triggerSubmitHaptic } from '../utils/haptics';
import ScoringScreen from './ScoringScreen';
import RosterPickerModal from '../components/RosterPickerModal';
import MatchMenuModal from '../components/MatchMenuModal';
import EditTeamsScreen from './EditTeamsScreen';
import MatchResultScreen from './MatchResultScreen';
import OverCompleteOverlay from '../components/OverCompleteOverlay';
import InningsSummaryModal from '../components/InningsSummaryModal';
import RulebookModal from '../components/RulebookModal';
import UndoConfirmModal from '../components/UndoConfirmModal';

/**
 * Wraps ScoringScreen with real API calls. Owns the match-state values
 * that come back from the server (over/ball position, running total) and
 * the IDs needed for every delivery request (pairInningsId,
 * bowlingSpellId, strikerId, nonStrikerId).
 *
 * Bowler is chosen here, not at setup — matchContext.bowlerId/
 * bowlingSpellId may be null on first load, in which case scoring is
 * blocked until the scorer picks one via the arrow icon next to "Bowler".
 *
 * Team names and rosters (teamAName/teamBName/teamARoster/teamBRoster)
 * are tracked as LOCAL state, separate from which team is currently
 * batting vs bowling — this lets "End innings" swap batting/bowling
 * roles for innings 2 without losing edits made via "Edit teams", and
 * lets renames made mid-match persist across that same transition.
 *
 * Deliberately minimal for tonight's match: single scorer, no co-scoring
 * conflict handling, and "End innings" only supports the 1st-to-2nd
 * innings transition (not ending the match itself).
 */
export default function LiveMatchContainer({ matchContext, onReturnHome }) {
  // Stable across innings: the two teams' names and full rosters.
  const [teamAName, setTeamAName] = useState(matchContext.teamAName);
  const [teamBName, setTeamBName] = useState(matchContext.teamBName);
  const [teamARoster, setTeamARoster] = useState(
    matchContext.battingTeam === 'A' ? matchContext.battingRoster : matchContext.bowlingRoster
  );
  const [teamBRoster, setTeamBRoster] = useState(
    matchContext.battingTeam === 'A' ? matchContext.bowlingRoster : matchContext.battingRoster
  );

  // Changes between innings: which team's batting, and all the
  // per-innings IDs/state.
  const [battingTeam, setBattingTeam] = useState(matchContext.battingTeam);
  const [inningsNumber, setInningsNumber] = useState(matchContext.resumeInningsNumber ?? 1);
  const [inningsId, setInningsId] = useState(matchContext.inningsId);
  const [pairInningsId, setPairInningsId] = useState(matchContext.pairInningsId);
  const [pairNumber, setPairNumber] = useState(Number(matchContext.resumePairNumber ?? 1));
  const [bowlingSpellId, setBowlingSpellId] = useState(matchContext.bowlingSpellId);
  const [bowlerId, setBowlerId] = useState(matchContext.bowlerId);
  const [strikerId, setStrikerId] = useState(matchContext.strikerId);
  const [nonStrikerId, setNonStrikerId] = useState(matchContext.nonStrikerId);
  const [totalOvers, setTotalOvers] = useState(matchContext.totalOvers);

  const [overNumber, setOverNumber] = useState(Number(matchContext.resumeOverNumber ?? 0));
  const [ballNumberInOver, setBallNumberInOver] = useState(Number(matchContext.resumeBallNumberInOver ?? 0));
  const [runs, setRuns] = useState(Number(matchContext.resumeRuns ?? 0));
  const [wideCountEnabled, setWideCountEnabled] = useState(matchContext.wideCountEnabled !== false);
  const [lastDeliveryId, setLastDeliveryId] = useState(matchContext.resumeLastDeliveryId ?? null);
  // Gates undo separately from lastDeliveryId — lastDeliveryId still
  // needs to point at the real previous delivery after an undo (ball
  // history refetch, swap-batting gating, etc. all key off it), but
  // undo itself should only ever reach back ONE ball, not chain
  // backwards through the whole innings. Reset to false whenever a
  // genuinely new delivery is recorded.
  const [hasUndoneCurrentBall, setHasUndoneCurrentBall] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [overDeliveries, setOverDeliveries] = useState([]); // ball-by-ball history for the CURRENT over's dot row — see the useEffect below for how this stays in sync
  const [errorMessage, setErrorMessage] = useState('');
  const [bowlerPickerOpen, setBowlerPickerOpen] = useState(!bowlerId); // force the picker open immediately if no bowler chosen yet
  const [bowlerOvers, setBowlerOvers] = useState({}); // { [bowlerId]: completedOvers } — refreshed each time the bowler picker opens
  const [overCompleteAnimating, setOverCompleteAnimating] = useState(false);
  const [pairRotationAnimating, setPairRotationAnimating] = useState(false);
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  const [atPairBoundary, setAtPairBoundary] = useState(false);
  const [runOutStrikerPickerOpen, setRunOutStrikerPickerOpen] = useState(false);
  const [pendingBowlerOverlayAfterPair, setPendingBowlerOverlayAfterPair] = useState(false);
  const [bowlerOverlayIsPostPairRotation, setBowlerOverlayIsPostPairRotation] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [editTeamsOpen, setEditTeamsOpen] = useState(false);
  const [endInningsConfirmOpen, setEndInningsConfirmOpen] = useState(false);
  const [endInningsAnimating, setEndInningsAnimating] = useState(false);
  // Holds the server response from creating the new innings, purely so
  // the "End of Innings X / Continue to Innings Y" overlay can read the
  // real innings_number — by the time this is set, the new innings'
  // pair/bowler-cleared/etc. state is already fully live (see
  // confirmEndInnings), unlike an earlier draft of this flow.
  const [justEndedInnings, setJustEndedInnings] = useState(null);
  const [innings1Runs, setInnings1Runs] = useState(
    matchContext.resumeTargetRuns != null ? Number(matchContext.resumeTargetRuns) - 1 : 0
  );
  const [innings1LastDeliveryId, setInnings1LastDeliveryId] = useState(null);
  const [innings1BattingTeam, setInnings1BattingTeam] = useState(matchContext.battingTeam);
  const [matchComplete, setMatchComplete] = useState(false);

  const battingRoster = battingTeam === 'A' ? teamARoster : teamBRoster;
  const bowlingRoster = battingTeam === 'A' ? teamBRoster : teamARoster;

  const strikerName = battingRoster.find((p) => p.id === strikerId)?.display_name ?? '—';
  const nonStrikerName = battingRoster.find((p) => p.id === nonStrikerId)?.display_name ?? '—';
  const bowlerName = bowlingRoster.find((p) => p.id === bowlerId)?.display_name ?? 'Select bowler';

  const fieldingTeamPlayers = bowlingRoster
    .map((p) => ({ id: p.id, name: p.display_name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const openBowlerPickerWithOvers = useCallback(() => {
    // Opens the picker immediately rather than waiting on this fetch —
    // the over-counts are a non-critical display detail (see the catch
    // below), not worth making the scorer stare at nothing while this
    // round-trips. The picker's over-count/disabled-bowler display just
    // fills in a moment later once the response lands.
    setBowlerPickerOpen(true);
    api.get(`/matches/${matchContext.matchId}/innings/${inningsId}/bowler-overs`)
      .then((overs) => {
        const map = {};
        overs.forEach((o) => {
          map[o.bowlerId] = { completedOvers: o.completedOvers, ballsIntoCurrentOver: o.ballsIntoCurrentOver };
        });
        setBowlerOvers(map);
      })
      .catch(() => setBowlerOvers({}));
  }, [matchContext.matchId, inningsId]);

  // Display-only "effective over" for the dot row — mirrors the EXACT
  // same rollover formula already used in ScoringScreen.jsx's BALLS
  // header (ballNumberInOver === 6 ? overNumber + 1 : overNumber).
  // Deliberately does NOT touch the raw overNumber/ballNumberInOver
  // state itself: per the header's own documented reasoning, the
  // overs-limit banner logic depends on those raw values staying tied
  // to the database's actual confirmed state (the backend doesn't roll
  // over to the new over until the NEXT delivery is recorded). Without
  // this, the dot row kept showing the just-completed over's 6 balls
  // for the entire window between "over complete" and "first ball of
  // the new over actually scored" — confirmed as a real gap via a
  // reported screenshot, fixed here rather than by mutating overNumber
  // itself (which would have undone that earlier, deliberate decision).
  const effectiveOverForDots = ballNumberInOver === 6 ? overNumber + 1 : overNumber;

  // Keeps the per-ball dot row (overDeliveries) in sync with the
  // backend. Deliberately keyed on lastDeliveryId rather than
  // ballNumberInOver — a wide/no-ball intentionally does NOT change
  // ballNumberInOver (see deliveryController.js: "does not consume a
  // ball"), so relying on that alone would silently miss wide/no-ball
  // deliveries from refetching the row. lastDeliveryId changes on EVERY
  // submission (legal or not) and also changes (to null) after an undo,
  // so this single effect correctly covers: initial mount/rehydrate,
  // every delivery type, undo, and resets cleanly to the new over's data
  // the moment effectiveOverForDots changes (no manual "clear the
  // array" step needed — the fetch itself returns the right over's
  // data, an empty array for a brand new over with no balls yet).
  useEffect(() => {
    let cancelled = false;
    api
      .get(`/matches/${matchContext.matchId}/innings/${inningsId}/over-deliveries?overNumber=${effectiveOverForDots}`)
      .then((data) => {
        if (!cancelled) {
          // When wide count is disabled, wides are scored as normal
          // deliveries — show them as such in the ball history
          const mapped = wideCountEnabled
            ? data
            : data.map((d) => d.deliveryType === 'wide' ? { ...d, deliveryType: 'normal' } : d);
          setOverDeliveries(mapped);
        }
      })
      .catch(() => {
        // Non-critical display detail — if this fails, the dot row just
        // stays empty/stale for this one refresh. Not worth surfacing an
        // error or blocking scoring over it.
      });
    return () => {
      cancelled = true;
    };
  }, [matchContext.matchId, inningsId, effectiveOverForDots, lastDeliveryId]);

  const handleSubmit = useCallback(
    async (ballInput) => {
      if (!bowlingSpellId) {
        setErrorMessage('Select a bowler before scoring the first ball.');
        openBowlerPickerWithOvers();
        throw new Error('No bowler selected');
      }
      setErrorMessage('');
      try {
        const delivery = await api.post(`/innings/${inningsId}/deliveries`, {
          pairInningsId,
          bowlingSpellId,
          strikerId,
          nonStrikerId,
          deliveryType: ballInput.deliveryType,
          zoneHit: ballInput.zoneHit,
          battersCrossed: ballInput.battersCrossed,
          manualRunAdjustment: ballInput.manualRunAdjustment,
          zoneSwapApplies: ballInput.zoneSwapApplies,
          isWicket: ballInput.isWicket,
          wicketType: ballInput.wicketType,
          dismissedPlayerId: ballInput.dismissedPlayerId,
          fielderId: ballInput.fielderId,
          wideCountEnabled,
        });

        setLastDeliveryId(delivery.id);
        setHasUndoneCurrentBall(false);
        triggerSubmitHaptic();
        setOverNumber(Number(delivery.over_number));
        setBallNumberInOver(Number(delivery.ball_number_in_over));
        // Explicit Number() coercion on EVERY operand here, including
        // prev — this directly fixes a real bug that corrupted live
        // scoring: if any one of these ever comes back as a string
        // (even once), JavaScript's `+` silently switches from addition
        // to string concatenation, and EVERY ball after that point
        // appends digits as text instead of summing them (e.g. "0" + "1"
        // + "0" → "010" → "01010" → ...). This makes the accumulator
        // immune to that failure mode regardless of where a stray string
        // value originates.
        setRuns((prev) => Number(prev) + Number(delivery.total_runs) + Number(delivery.penalty_runs));

        const completedAnOver = delivery.is_legal_delivery && delivery.ball_number_in_over === 6;
        const rotatedThisBall = Boolean(ballInput.battersCrossed);
        const shouldSwapDisplay = rotatedThisBall !== completedAnOver;
        if (shouldSwapDisplay) {
          setStrikerId(nonStrikerId);
          setNonStrikerId(strikerId);
        }

        // After a run out, the app can't know who ended up on strike —
        // show a picker so the scorer can confirm manually. Open it
        // after the swap above so both batter IDs are still correct.
        if (ballInput.wicketType === 'run_out') {
          setRunOutStrikerPickerOpen(true);
        }

        if (completedAnOver) {
          const oversJustCompleted = Number(delivery.over_number) + 1;
          // Innings-end takes priority over everything else that could
          // also be true on this exact ball — including the 4-over pair
          // rotation, since totalOvers (16/20/24) is always itself a
          // multiple of 4, so the innings' LAST over is always also a
          // pair-rotation boundary. There's no more batting left to do,
          // so offering a new pair/bowler pick for overs that don't
          // exist would be wrong. Confirmed explicitly: no confirmation
          // dialog here, unlike the manual menu path — this fires
          // automatically the instant the final ball is recorded.
          // confirmEndInnings already has the right fallback built in
          // for innings 2 specifically: it tries to create the NEXT
          // innings, the backend rejects with "already has both
          // innings" (since there's no innings 3), and that catch
          // branch is what actually sets matchComplete — so calling it
          // here handles both "innings 1 ends, start innings 2" AND
          // "innings 2 ends, match is over" with no separate code path.
          if (totalOvers != null && oversJustCompleted >= totalOvers) {
            // Disable UNDO right here, before confirmEndInnings even
            // starts its (async) work — confirmEndInnings does clear
            // lastDeliveryId too, but only after its API calls resolve,
            // which leaves a brief window where canUndo would otherwise
            // still read true. Confirmed explicitly: once the innings
            // is over, UNDO must be fully disabled, no exceptions.
            setLastDeliveryId(null);
            confirmEndInnings();
            return;
          }
          // Confirmed explicitly: simplest possible cadence — every 4
          // overs of the INNINGS overall (after over 4, 8, 12...), not
          // tracking who's actually been batting or for how long. The
          // scorer decides everything manually when this fires; no
          // batters are restricted from being re-selected (confirmed:
          // "we are NOT restricting any batters to bat again" — the
          // pair picker passed no `disabled` entries already, so
          // nothing further is needed there).
          const isPairRotationOver = oversJustCompleted % 4 === 0;
          if (isPairRotationOver) {
            // Confirmed sequential ordering: the pair-rotation overlay
            // shows FIRST. The existing bowler-overlay flow only
            // triggers afterward, once the scorer confirms their pair
            // choice (see the pairRotationAnimating overlay below) —
            // not simultaneously with this one.
            //
            // The bowler IS cleared right here though, at the trigger
            // moment — not later, when the pair step is confirmed.
            // Confirmed explicitly: this prevents a real edge case
            // where closing the pair-rotation picker early (without
            // choosing) would otherwise leave the just-finished
            // over's bowler silently still "selected," reintroducing
            // the exact stale-bowler bug fixed earlier today, just via
            // this new path which never reaches the bowler overlay's
            // own clearing logic at all if the scorer bails out early.
            setBowlerId(null);
            setBowlingSpellId(null);
            setAtPairBoundary(true);
            setPairRotationAnimating(true);
          } else {
            // Full-screen "Over complete" overlay, persistent — confirmed
            // explicitly: NO auto-timer any more. The scorer taps "Select
            // bowler" on the overlay itself (handleSelectBowlerFromOverlay
            // below) to dismiss it and open the bowler picker, rather than
            // it fading away on its own after a fixed delay.
            setOverCompleteAnimating(true);
          }
        }
      } catch (err) {
        setErrorMessage(err.message || 'Failed to submit delivery.');
        throw err;
      }
    },
    [inningsId, pairInningsId, bowlingSpellId, strikerId, nonStrikerId, openBowlerPickerWithOvers, totalOvers, confirmEndInnings, wideCountEnabled]
  );

  const handleUndo = useCallback(async () => {
    if (!lastDeliveryId || isUndoing || hasUndoneCurrentBall) return;
    setIsUndoing(true);
    setErrorMessage('');
    try {
      const undoResult = await api.post(`/deliveries/${lastDeliveryId}/undo`);
      const liveState = await api.get(`/public/matches/${matchContext.matchId}/live`);
      setRuns(Number(liveState.total_runs ?? 0));
      setOverNumber(Number(liveState.last_over_number ?? 0));
      setBallNumberInOver(Number(liveState.last_ball_number ?? 0));
      setLastDeliveryId(undoResult.prev_delivery_id ?? null);
      setHasUndoneCurrentBall(true);

      // Restore the pair too, not just the striker/non-striker names.
      // Same failure shape as the bowler fix below: pairInningsId gets
      // switched to the NEW pair the instant the scorer confirms a
      // 4-over rotation pick — well before any ball is bowled under
      // it — so if the very last ball of the OLD pair's final over then
      // gets undone, our own pairInningsId is already wrong by the time
      // undo runs. Querying pair state with that stale id just returns
      // the new pair's (trivial, no-deliveries-yet) state, which is how
      // the new batters were appearing on what should still be the old
      // pair's last-ball screen. The undo response now returns the
      // CORRECT pair_innings_id (and striker/non-striker/pair_number
      // already restored under it) directly, so there's no need for a
      // separate, identically-stale-keyed follow-up call here at all.
      setPairInningsId(undoResult.pair_innings_id);
      if (undoResult.current_pair_number != null) {
        setPairNumber(undoResult.current_pair_number);
      }
      setStrikerId(undoResult.current_striker_id);
      setNonStrikerId(undoResult.current_non_striker_id);
      // The pair this restores to is, by definition, no longer "just
      // rotated" — any pair-rotation overlay/picker that was opened in
      // response to the now-undone over/pair-completion is stale.
      setPairRotationAnimating(false);
      setPairPickerOpen(false);
      setAtPairBoundary(false);
      setPendingBowlerOverlayAfterPair(false);

      // Restore whichever bowler was actually bowling at the point now
      // being undone to. This matters specifically when undoing the ball
      // that completed an over: the picker may already have a NEW bowler
      // selected (or no bowler at all, mid-pick) for the over that no
      // longer exists once undone. Without this, the next delivery would
      // get recorded under the wrong bowling_spell_id, corrupting both
      // bowlers' over counts (see the "0.5 instead of 1.0" bug). A null
      // current_bowler_id means the innings' very first ball was undone —
      // there's genuinely no bowler yet, so fall back to the picker.
      if (undoResult.current_bowler_id) {
        setBowlerId(undoResult.current_bowler_id);
        setBowlingSpellId(undoResult.current_bowling_spell_id);
        setOverCompleteAnimating(false);
        setBowlerPickerOpen(false);
      } else if (bowlerId) {
        // First ball undone — bowler was already chosen but their spell
        // no longer has any deliveries. Re-create the spell silently
        // so the scorer doesn't have to re-pick.
        try {
          const spell = await api.post(`/matches/${matchContext.matchId}/innings/${inningsId}/bowling-spells`, { bowlerId });
          setBowlingSpellId(spell.id);
        } catch {
          setBowlingSpellId(null);
        }
        setBowlerPickerOpen(false);
      } else {
        // No bowler at all — open picker
        setBowlingSpellId(null);
        setBowlerPickerOpen(true);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to undo.');
    } finally {
      setIsUndoing(false);
    }
  }, [lastDeliveryId, isUndoing, matchContext.matchId]);

  async function handleBowlerChosen({ id }) {
    setErrorMessage('');
    try {
      const spell = await api.post(`/matches/${matchContext.matchId}/innings/${inningsId}/bowling-spells`, {
        bowlerId: id,
      });
      setBowlerId(id);
      setBowlingSpellId(spell.id);
      setBowlerPickerOpen(false);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to set bowler.');
    }
  }

  async function handlePairChosen({ batter1Id, batter2Id }, isNewPair = false) {
    // Determine if the pair has actually changed — if same players are
    // reselected (e.g. correcting striker/non-striker swap), no API call
    // is needed at all.
    const pairActuallyChanged =
      (batter1Id !== strikerId && batter1Id !== nonStrikerId) ||
      (batter2Id !== strikerId && batter2Id !== nonStrikerId);

    if (isNewPair || pairActuallyChanged) {
      setErrorMessage('');
      try {
        // Only advance the pair number for a genuine new pair (the
        // 4-over rotation, isNewPair=true). A pencil-icon correction to
        // who's in the CURRENT pair keeps the same pair number — the
        // backend then updates that pair_innings row in place (or
        // rejects it with a clear "undo first" error if deliveries are
        // already recorded under it). Previously this always
        // incremented regardless of isNewPair, which meant every
        // pencil-icon correction was silently treated as starting a
        // brand new pair.
        const targetPairNumber = isNewPair ? pairNumber + 1 : pairNumber;
        const pair = await api.post(`/matches/${matchContext.matchId}/innings/${inningsId}/pairs`, {
          batter1Id,
          batter2Id,
          pairNumber: targetPairNumber,
          stintNumber: 1,
        });
        setPairInningsId(pair.id);
        setPairNumber(targetPairNumber);
      } catch (err) {
        setErrorMessage(err.message || 'Failed to start the new pair.');
        return false;
      }
    }
    setStrikerId(batter1Id);
    setNonStrikerId(batter2Id);
    setPairPickerOpen(false);
    setAtPairBoundary(false);
    return true;
  }

  function handleSwapStriker() {
    setStrikerId(nonStrikerId);
    setNonStrikerId(strikerId);
  }

  function handleEditTeamsSaved(updated) {
    // updated.battingRoster/bowlingRoster are role-based (from
    // EditTeamsScreen, which itself works off the current
    // battingRoster/bowlingRoster props) — convert back to the stable
    // A/B roster slots before storing.
    setTeamAName(updated.teamAName);
    setTeamBName(updated.teamBName);
    if (battingTeam === 'A') {
      setTeamARoster(updated.battingRoster);
      setTeamBRoster(updated.bowlingRoster);
    } else {
      setTeamBRoster(updated.battingRoster);
      setTeamARoster(updated.bowlingRoster);
    }
    setEditTeamsOpen(false);
  }

  function handleEndInnings() {
    // Menu tap just opens the confirmation dialog — the actual innings
    // transition (server call, state reset) doesn't happen until the
    // scorer explicitly confirms via confirmEndInnings below. Same
    // "ask before an irreversible action" pattern as UndoConfirmModal.
    setEndInningsConfirmOpen(true);
  }

  async function confirmEndInnings() {
    // Tonight's scope: ending the CURRENT (first) innings starts the
    // second one, with the opposite team batting. Ending innings 2
    // (finishing the match) isn't built yet; this only handles the
    // 1-to-2 transition. Same fallback as match start: auto-picks the
    // roster's first two players as the opening pair, bowler left
    // empty (numpad disabled until chosen) — confirmed explicitly to
    // keep this existing behavior unchanged. The scorer already has an
    // existing, separate way to correct the pair if needed (the pencil
    // icon -> onEditPair -> pairPickerOpen), so no new dedicated picker
    // is needed here for that.
    setEndInningsConfirmOpen(false);
    setAtPairBoundary(false);
    setPairRotationAnimating(false);
    setPendingBowlerOverlayAfterPair(false);
    const nextBattingTeam = battingTeam === 'A' ? 'B' : 'A';
    const nextBattingRoster = nextBattingTeam === 'A' ? teamARoster : teamBRoster;

    if (nextBattingRoster.length < 2) {
      setErrorMessage('The next batting team needs at least 2 players.');
      return;
    }

    setErrorMessage('');
    try {
      const innings = await api.post(`/matches/${matchContext.matchId}/innings`, { battingTeam: nextBattingTeam });
      const pair = await api.post(`/matches/${matchContext.matchId}/innings/${innings.id}/pairs`, {
        batter1Id: nextBattingRoster[0].id,
        batter2Id: nextBattingRoster[1].id,
        pairNumber: 1,
        stintNumber: 1,
      });

      setInnings1Runs(runs); // capture before reset
      const innings1LastDeliveryId = lastDeliveryId; // capture before reset
      setInnings1LastDeliveryId(innings1LastDeliveryId);
      setInnings1BattingTeam(battingTeam); // capture before flipping to innings 2
      setBattingTeam(nextBattingTeam);
      setInningsNumber(2);
      setInningsId(innings.id);
      setPairInningsId(pair.id);
      setPairNumber(1);
      setBowlingSpellId(null);
      setBowlerId(null);
      setStrikerId(nextBattingRoster[0].id);
      setNonStrikerId(nextBattingRoster[1].id);
      setOverNumber(0);
      setBallNumberInOver(0);
      setRuns(0);
      setLastDeliveryId(null);
      setTotalOvers(totalOversForSquadSize(nextBattingRoster.length));
      setBowlerOvers({}); // fresh innings — every bowler starts at 0 overs bowled, no fetch needed
      // Held only so the "End of Innings X / Continue to Innings Y"
      // overlay below can read the real innings_number from the
      // server response. bowlerPickerOpen is deliberately NOT set here
      // — it's set from the overlay's Continue button instead, so the
      // scorer sees "End of Innings 1" first and only reaches bowler
      // selection after dismissing it, matching the requested sequence
      // (batter pair already auto-set above, then bowler next).
      setJustEndedInnings(innings);
      setEndInningsAnimating(true);
    } catch (err) {
      // "This match already has both innings" specifically means the
      // scorer just tried to end innings 2 — i.e. the match is actually
      // OVER, not erroring. Treat that one message as the signal to show
      // the results screen rather than a generic failure banner.
      if (err.message && err.message.includes('already has both innings')) {
        setMatchComplete(true);
        clearActiveMatchId();
        api.patch(`/matches/${matchContext.matchId}/complete`).catch(() => {});
      } else {
        setErrorMessage(err.message || 'Failed to start the second innings.');
      }
    }
  }

  async function handleSwapBatting() {
    setIsSwapping(true);
    setErrorMessage('');
    try {
      const result = await api.patch(`/matches/${matchContext.matchId}/swap-batting`);
      setBattingTeam(result.battingTeam);
      setPairInningsId(result.pairInningsId);
      setStrikerId(result.batter1Id);
      setNonStrikerId(result.batter2Id);
      setBowlingSpellId(null);
      setBowlerId(null);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to swap batting teams.');
    } finally {
      setIsSwapping(false);
    }
  }

  function handleExit() {
    clearActiveMatchId();
    onReturnHome();
  }

  const editTeamsContext = {
    matchId: matchContext.matchId,
    teamAName,
    teamBName,
    battingTeam,
    battingRoster,
    bowlingRoster,
  };

  if (matchComplete) {
    return <MatchResultScreen matchId={matchContext.matchId} joinCode={matchContext.joinCode} onReturnHome={onReturnHome} />;
  }

  return (
    <>
      {errorMessage && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            background: 'var(--color-navy-900)',
            borderRadius: 16,
            padding: '28px 24px',
            maxWidth: 320,
            width: '100%',
            textAlign: 'center',
            border: '1px solid #648BC3',
          }}>
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: 16,
              color: 'var(--color-coral)',
              marginBottom: 20,
              lineHeight: 1.5,
            }}>
              {errorMessage}
            </p>
            <button
              onClick={() => setErrorMessage('')}
              style={{
                background: 'var(--color-yellow)',
                color: 'var(--color-navy-900)',
                border: 'none',
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 16,
                padding: '10px 32px',
                cursor: 'pointer',
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
      <ScoringScreen
        matchState={{ overNumber, ballNumberInOver, runs, totalOvers, overDeliveries, battingTeamName: battingTeam === 'A' ? (teamAName || 'Team A') : (teamBName || 'Team B'), inningsNumber, targetRuns: inningsNumber === 2 ? innings1Runs : null }}
        pair={{ pairNumber, strikerName, nonStrikerName, bowlerName, strikerId, nonStrikerId, bowlerId, hasBowler: Boolean(bowlerId) }}
        fieldingTeamPlayers={fieldingTeamPlayers}
        scorerCount={1}
        canUndo={Boolean(lastDeliveryId) && !isUndoing && !hasUndoneCurrentBall}
        wideCountEnabled={wideCountEnabled}
        onSubmit={handleSubmit}
        onUndo={handleUndo}
        onOpenMenu={() => setMenuOpen(true)}
        onEditPair={() => {
          if (atPairBoundary) setPendingBowlerOverlayAfterPair(true);
          setPairPickerOpen(true);
        }}
        onChangeBowler={openBowlerPickerWithOvers}
        onSwapStriker={handleSwapStriker}
      />

      {bowlerPickerOpen && (
        <RosterPickerModal
          title="Select bowler"
          roster={bowlingRoster.map((p) => {
            const o = bowlerOvers[p.id];
            const overCount = o
              ? (o.ballsIntoCurrentOver === 0 ? o.completedOvers : `${o.completedOvers}.${o.ballsIntoCurrentOver}`)
              : null;
            const disabled = (o?.completedOvers ?? 0) >= 3;
            const isCurrent = p.id === bowlerId;
            return { ...p, disabled, isCurrent, overCount };
          }).sort((a, b) => a.display_name.localeCompare(b.display_name))}
          mode="single"
          onClose={() => setBowlerPickerOpen(false)}
          onConfirm={handleBowlerChosen}
        />
      )}

      {overCompleteAnimating && (
        <OverCompleteOverlay
          message={bowlerOverlayIsPostPairRotation ? 'Select bowler' : 'Over complete'}
          buttonLabel="Select bowler"
          buttonIcon="🎾"
          onAction={() => {
            // Confirmed explicitly (two-scenario distinction): clearing
            // the bowler belongs HERE specifically — the moment the
            // scorer dismisses the over-complete overlay to choose a
            // bowler for the NEW over — not in the picker's onClose
            // (reverted back to a true no-op above). This is what
            // correctly produces both confirmed behaviors: pressing X
            // right after an over (nothing was selected yet, since it
            // was just cleared here) shows "Select Bowler" with the
            // numpad locked; pressing X after tapping the "change
            // bowler" icon mid-over (a different call site for
            // openBowlerPickerWithOvers, which does NOT go through this
            // handler) leaves the existing valid bowler untouched,
            // since it was never cleared in the first place.
            setBowlerId(null);
            setBowlingSpellId(null);
            setOverCompleteAnimating(false);
            setBowlerOverlayIsPostPairRotation(false);
            openBowlerPickerWithOvers();
          }}
        />
      )}

      {pairRotationAnimating && (
        <OverCompleteOverlay
          message="4 overs complete"
          buttonLabel="Select next batters"
          buttonIcon="🏏"
          onAction={() => {
            setPairRotationAnimating(false);
            setPendingBowlerOverlayAfterPair(true);
            setPairPickerOpen(true);
          }}
          onDismiss={() => {
            setPairRotationAnimating(false);
            setAtPairBoundary(false);
            // Bowler was cleared when rotation triggered — go straight to bowler overlay.
            setBowlerOverlayIsPostPairRotation(true);
            setOverCompleteAnimating(true);
          }}
        />
      )}

      {pairPickerOpen && (
        <RosterPickerModal
          title="Select batting pair"
          roster={battingRoster.map((p) => ({
            ...p,
            isCurrent: p.id === strikerId || p.id === nonStrikerId,
          })).sort((a, b) => a.display_name.localeCompare(b.display_name))}
          mode="pair"
          onClose={() => {
            setPairPickerOpen(false);
            // Confirmed explicitly: closing without choosing follows
            // the same already-established pattern as the bowler picker
            // — no state is forced/cleared here. If this close happened
            // mid-rotation-flow (pendingBowlerOverlayAfterPair is true),
            // the scorer just lands back on the scoring screen with the
            // existing pair still in place and no bowler chosen for the
            // new over yet; they can reopen either picker from the
            // pencil icon or the "change bowler" icon as normal. This
            // mirrors "no changes to what we have now" — the X here
            // behaves exactly as it always has for this picker.
            setPendingBowlerOverlayAfterPair(false);
          }}
          onConfirm={async (choice) => {
            const succeeded = await handlePairChosen(choice, pendingBowlerOverlayAfterPair);
            if (pendingBowlerOverlayAfterPair && succeeded) {
              // Confirmed sequential ordering: only AFTER the scorer
              // confirms their pair choice does the existing
              // bowler-overlay flow begin — exactly as it would for any
              // other over-complete moment, just one step later than
              // usual for this specific 4-over boundary. Gated on
              // `succeeded` too — if creating the new pair record
              // failed, stay put rather than silently proceed with
              // stale pairInningsId data (see handlePairChosen's own
              // comment on this for the full reasoning).
              setPendingBowlerOverlayAfterPair(false);
              setBowlerOverlayIsPostPairRotation(true);
              setOverCompleteAnimating(true);
            }
          }}
        />
      )}

      {runOutStrikerPickerOpen && (
        <RosterPickerModal
          title="Who is on strike?"
          roster={[
            { id: strikerId, display_name: battingRoster.find(p => p.id === strikerId)?.display_name ?? 'Striker', isCurrent: true },
            { id: nonStrikerId, display_name: battingRoster.find(p => p.id === nonStrikerId)?.display_name ?? 'Non-striker', isCurrent: false },
          ]}
          mode="single"
          onClose={() => setRunOutStrikerPickerOpen(false)}
          onConfirm={({ id }) => {
            if (id !== strikerId) {
              setStrikerId(nonStrikerId);
              setNonStrikerId(strikerId);
            }
            setRunOutStrikerPickerOpen(false);
          }}
        />
      )}

      {endInningsConfirmOpen && (
        // Hardcoded to "innings 1" rather than computed: this menu
        // action is only ever reachable while innings 1 is in
        // progress (the backend throws "already has both innings" once
        // innings 2 exists, which flips matchComplete and removes this
        // screen entirely) — so there's no live innings-2-ending case
        // yet to make this dynamic for.
        <UndoConfirmModal
          message={`Do you want to end innings ${inningsNumber}?`}
          onCancel={() => setEndInningsConfirmOpen(false)}
          onConfirm={confirmEndInnings}
        />
      )}

      {endInningsAnimating && justEndedInnings && justEndedInnings.innings_number === 2 && (
        <InningsSummaryModal
          matchId={matchContext.matchId}
          joinCode={matchContext.joinCode}
          inningsNumber={1}
          battingTeamName={innings1BattingTeam === 'A' ? (teamAName || 'Team A') : (teamBName || 'Team B')}
          totalRuns={innings1Runs}
          onContinue={() => {
            setEndInningsAnimating(false);
            setJustEndedInnings(null);
            setBowlerPickerOpen(true);
          }}
          onUndo={async () => {
            if (!innings1LastDeliveryId) return;
            try {
              const undoResult = await api.post(`/deliveries/${innings1LastDeliveryId}/undo`);
              const liveState = await api.get(`/public/matches/${matchContext.matchId}/live`);
              setRuns(Number(liveState.total_runs ?? 0));
              setOverNumber(Number(liveState.last_over_number ?? 0));
              setBallNumberInOver(Number(liveState.last_ball_number ?? 0));
              // lastDeliveryId must become the RESTORED innings-1 last
              // delivery (prev_delivery_id), not null — innings 1 likely
              // has earlier deliveries before the one just undone here,
              // and null would incorrectly disable Undo for the rest of
              // innings 1 and also flip canSwapBatting/hasDeliveries
              // (both keyed on lastDeliveryId) to look like no deliveries
              // exist yet. hasUndoneCurrentBall is set so the scorer
              // can't immediately chain another undo via the normal
              // button right after this one.
              setLastDeliveryId(undoResult.prev_delivery_id ?? null);
              setHasUndoneCurrentBall(true);
              setInnings1LastDeliveryId(null);
              if (undoResult.current_bowler_id) {
                setBowlerId(undoResult.current_bowler_id);
                setBowlingSpellId(undoResult.current_bowling_spell_id);
              }
              setPairInningsId(undoResult.pair_innings_id);
              if (undoResult.current_pair_number != null) setPairNumber(undoResult.current_pair_number);
              setStrikerId(undoResult.current_striker_id);
              setNonStrikerId(undoResult.current_non_striker_id);
              // Revert to innings 1 state
              setBattingTeam(innings1BattingTeam);
              setEndInningsAnimating(false);
              setJustEndedInnings(null);
            } catch (err) {
              setErrorMessage(err.message || 'Failed to undo.');
            }
          }}
          canUndo={Boolean(innings1LastDeliveryId)}
        />
      )}

      {menuOpen && (
        <MatchMenuModal
          onClose={() => setMenuOpen(false)}
          onEditTeams={() => setEditTeamsOpen(true)}
          onEndInnings={handleEndInnings}
          onOpenRulebook={() => setRulebookOpen(true)}
          onOpenScorecard={() => { window.location.href = `/summary/${matchContext.matchId}`; }}
          onOpenPlayerStats={() => { window.location.href = '/stats'; }}
          matchId={matchContext.matchId}
          joinCode={matchContext.joinCode}
          wideCountEnabled={wideCountEnabled}
          canSwapBatting={inningsNumber === 1 && !lastDeliveryId}
          isSwapping={isSwapping}
          battingTeamName={battingTeam === 'A' ? teamAName : teamBName}
          bowlingTeamName={battingTeam === 'A' ? teamBName : teamAName}
          teamAName={teamAName}
          teamBName={teamBName}
          battingIsTeamA={battingTeam === 'A'}
          onSwapBatting={handleSwapBatting}
          onExit={handleExit}
          hasDeliveries={inningsNumber === 2 || Boolean(lastDeliveryId)}
          onToggleWideCount={async () => {
            const next = !wideCountEnabled;
            setWideCountEnabled(next);
            try {
              await api.patch(`/matches/${matchContext.matchId}/wide-count`, { wideCountEnabled: next });
            } catch (err) {
              // revert on failure
              setWideCountEnabled(!next);
            }
          }}
        />
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {editTeamsOpen && (
        <EditTeamsScreen
          matchContext={editTeamsContext}
          onSaved={handleEditTeamsSaved}
          onClose={() => setEditTeamsOpen(false)}
        />
      )}
    </>
  );
}
