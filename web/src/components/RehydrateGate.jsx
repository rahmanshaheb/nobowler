// RehydrateGate.jsx
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { totalOversForSquadSize } from '../hooks/useDeliveryComputation';
import { getActiveMatchId, clearActiveMatchId } from '../utils/matchStorage';

/**
 * On mount, checks localStorage for a saved matchId from a previous
 * session. If found, calls the server's rehydrate endpoint to rebuild
 * the FULL match state from the database (the real source of truth) —
 * not from any cached/stale client-side snapshot. This is what lets a
 * page refresh mid-match resume instead of losing all scoring progress.
 *
 * @param {(matchContext: object) => void} props.onResume - called with a
 *   reconstructed matchContext if a live match was found
 * @param {() => void} props.onNoMatch - called if there's nothing to
 *   resume (no saved ID, or the saved match is no longer rehydratable)
 */
export default function RehydrateGate({ onResume, onNoMatch }) {
  // Read synchronously at render time (not inside the effect) since
  // it's a plain, side-effect-free localStorage read — avoids an extra
  // render cycle just to discover there's nothing to do.
  const [savedMatchId] = useState(() => getActiveMatchId());
  const [checked, setChecked] = useState(!savedMatchId);
  const [resumeError, setResumeError] = useState(false);

  useEffect(() => {
    if (!savedMatchId) {
      onNoMatch();
      return;
    }

    api
      .get(`/matches/${savedMatchId}/rehydrate`)
      .then((data) => {
        if (data.isComplete) {
          clearActiveMatchId();
          onNoMatch();
          return;
        }
        if (data.needsSetup) {
          // Match exists but innings not started — clear so scorer goes
          // through setup fresh rather than getting stuck.
          clearActiveMatchId();
          onNoMatch();
          return;
        }
        const battingRoster = data.battingRoster ?? [];
        const bowlingRoster = data.bowlingRoster ?? [];
        onResume({
          matchId: data.matchId,
          joinCode: data.joinCode ?? null,
          teamAName: data.teamAName,
          teamBName: data.teamBName,
          battingTeam: data.battingTeam,
          resumeInningsNumber: data.inningsNumber ?? 1,
          inningsId: data.inningsId,
          pairInningsId: data.pairInningsId,
          resumePairNumber: Number(data.pairNumber ?? 1),
          strikerId: data.strikerId,
          nonStrikerId: data.nonStrikerId,
          bowlingSpellId: data.bowlingSpellId,
          bowlerId: data.bowlerId,
          battingRoster,
          bowlingRoster,
          resumeOverNumber: Number(data.overNumber ?? 0),
          resumeBallNumberInOver: Number(data.ballNumberInOver ?? 0),
          resumeRuns: Number(data.runs ?? 0),
          resumeTargetRuns: data.targetRuns ?? null,
          totalOvers: totalOversForSquadSize(battingRoster.length),
          wideCountEnabled: data.wideCountEnabled !== false,
          resumeLastDeliveryId: data.lastDeliveryId ?? null,
          resumeNeedsBowlerSelection: data.needsBowlerSelection ?? false,
          resumeNeedsPairRotation: data.needsPairRotation ?? false,
        });
      })
      .catch((err) => {
        // Only clear the saved match and drop to homepage if the match
        // is genuinely gone (404). Any other error (network timeout, 500)
        // shows an error state so the scorer can retry — losing a match
        // mid-game due to a transient error is unacceptable.
        if (err?.status === 404 || err?.status === 410) {
          clearActiveMatchId();
          onNoMatch();
        } else {
          // Leave matchId in localStorage so next refresh can retry.
          // Show error so scorer knows something went wrong.
          setChecked(true);
          setResumeError(true);
        }
      })
      .finally(() => setChecked(true));
    // savedMatchId is captured once via useState's lazy initializer and
    // never changes across this component's lifetime, so it's safe to
    // omit from deps without re-running this effect spuriously; onResume/
    // onNoMatch are stable callbacks passed from App.jsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!checked) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1a4a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa6d6' }}>
        Checking for an in-progress match…
      </div>
    );
  }

  if (resumeError) {
    return (
      <div style={{ minHeight: '100vh', background: '#102564', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, color: '#fff', fontFamily: 'sans-serif' }}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Connection problem</p>
        <p style={{ margin: 0, fontSize: 14, color: '#7a90b4', textAlign: 'center' }}>Could not reconnect to your match. Check your connection and try again.</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: 8, background: '#f5c842', color: '#111', border: 'none', borderRadius: 9999, padding: '12px 32px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>
          Retry
        </button>
        <button onClick={() => { clearActiveMatchId(); onNoMatch(); }} style={{ background: 'none', border: 'none', color: '#7a90b4', fontSize: 14, cursor: 'pointer' }}>
          Go to homepage
        </button>
      </div>
    );
  }

  return null;
}
