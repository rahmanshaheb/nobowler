// JoinMatchScreen.jsx
//
// Lets a second device join an already-in-progress match by entering
// the 8-character short match ID shown in the hamburger menu on the
// scoring device. Looks up the full UUID via the public lookup
// endpoint, then rehydrates the full match state the same way
// RehydrateGate does — no special join logic needed beyond that,
// since the rehydrate endpoint already reconstructs everything
// LiveMatchContainer needs to resume scoring.
//
// No passcode required here — the match ID itself is the implicit
// access control (only people in the group know it, and it's only
// visible in the hamburger menu to someone already scoring).

import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { totalOversForSquadSize } from '../hooks/useDeliveryComputation';
import './MatchSetupScreen.css';

export default function JoinMatchScreen({
onJoined, onBack }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [shortId, setShortId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleJoin() {
    const trimmed = shortId.trim();
    if (trimmed.length !== 4 || !/^\d{4}$/.test(trimmed)) {
      setError('Match code must be exactly 4 digits.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Step 1: resolve the short ID to a full UUID.
      const lookup = await api.get(`/public/matches/lookup/${trimmed}`);

      // Step 2: rehydrate the full match state — same endpoint and
      // same shape as RehydrateGate uses, so LiveMatchContainer gets
      // exactly the context it expects regardless of how the session started.
      const data = await api.get(`/matches/${lookup.matchId}/rehydrate`);

      if (data.isComplete) {
        setError('This match has already finished.');
        return;
      }

      onJoined({
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
        battingRoster: data.battingRoster,
        bowlingRoster: data.bowlingRoster,
        resumeOverNumber: Number(data.overNumber ?? 0),
        resumeBallNumberInOver: Number(data.ballNumberInOver ?? 0),
        resumeRuns: Number(data.runs ?? 0),
        resumeTargetRuns: data.targetRuns ?? null,
        totalOvers: totalOversForSquadSize(data.battingRoster.length),
        wideCountEnabled: data.wideCountEnabled !== false,
        resumeLastDeliveryId: data.lastDeliveryId ?? null,
      });
    } catch (err) {
      setError(err.message || 'Could not find that match. Check the ID and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-header">
          <button
            className="setup-back"
            onClick={onBack}
            aria-label="Back"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 className="setup-title">Join a match</h1>
        </div>
        <p className="setup-subtitle">
          Enter the 4-digit match code from the scorer's hamburger menu.
        </p>

        <label className="setup-label">Match code</label>
        <input
          className="setup-input"
          type="text"
          inputMode="numeric"
          pattern="\d*"
          maxLength={4}
          placeholder="e.g. 7432"
          value={shortId}
          onChange={(e) => {
            // Only allow digits
            const val = e.target.value.replace(/\D/g, '');
            setShortId(val);
            setError('');
          }}
          autoFocus
          autoCorrect="off"
          spellCheck={false}
          style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: 24 }}
        />

        {error && <p className="setup-error">{error}</p>}

        <button
          className="setup-button"
          disabled={busy || shortId.trim().length !== 4}
          onClick={handleJoin}
          style={{ marginTop: 'var(--space-4)' }}
        >
          {busy ? 'Joining…' : 'Join match'}
        </button>
      </div>
    </div>
  );
}
