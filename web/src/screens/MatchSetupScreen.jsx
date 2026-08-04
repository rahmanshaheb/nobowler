// MatchSetupScreen.jsx
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { totalOversForSquadSize } from '../hooks/useDeliveryComputation';
import { saveActiveMatchId, clearActiveMatchId } from '../utils/matchStorage';
import './MatchSetupScreen.css';

/**
 * Linear setup flow matching the mockup's sequence:
 * 1. Enter match passcode
 * 2. Team A roster, Team B roster
 * 3. Who's batting first
 * 4. First pair + first bowler
 * Calls onReady(matchContext) once everything needed to start scoring exists.
 */
export default function MatchSetupScreen({ onReady, onBack }) {
  const [step, setStep] = useState('passcode');

  useEffect(() => { window.scrollTo(0, 0); }, [step]);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function goBack() {
    setError('');
    if (step === 'passcode') { clearActiveMatchId(); onBack?.(); return; }
    if (step === 'teamA')    { setStep('passcode'); return; }
    if (step === 'teamB')    { setStep('teamA'); return; }
    if (step === 'whosBatting') { setStep('teamB'); return; }
  }

  const [matchId, setMatchId] = useState(null);
  const [joinCode, setJoinCode] = useState(null);
  const [teamAName, setTeamAName] = useState('');
  const [teamBName, setTeamBName] = useState('');
  const [teamAPlayers, setTeamAPlayers] = useState(Array(8).fill(''));
  const [teamBPlayers, setTeamBPlayers] = useState(Array(8).fill(''));
  const [teamAIds, setTeamAIds] = useState([]);
  const [teamBIds, setTeamBIds] = useState([]);
  const [wideCountEnabled, setWideCountEnabled] = useState(true);

  async function handlePasscodeSubmit() {
    setBusy(true);
    setError('');
    try {
      const { valid } = await api.post('/auth/scorer-passcode/verify', { passcode });
      if (!valid) {
        setError('Incorrect passcode.');
        return;
      }
      const match = await api.post('/matches', {
        matchDate: new Date().toISOString().slice(0, 10),
        teamAName,
        teamBName,
        wideCountEnabled,
      });
      setMatchId(match.id);
      setJoinCode(match.join_code ?? null);
      saveActiveMatchId(match.id);
      setStep('teamA');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function updatePlayerName(team, index, value) {
    const setter = team === 'A' ? setTeamAPlayers : setTeamBPlayers;
    setter((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function addPlayerField(team) {
    const players = team === 'A' ? teamAPlayers : teamBPlayers;
    if (players.length >= 12) return;
    const setter = team === 'A' ? setTeamAPlayers : setTeamBPlayers;
    setter((prev) => [...prev, '']);
  }

  function removePlayerField(team, index) {
    const setter = team === 'A' ? setTeamAPlayers : setTeamBPlayers;
    setter((prev) => prev.filter((_, i) => i !== index));
  }

  async function submitTeam(team) {
    setBusy(true);
    setError('');
    const rawNames = team === 'A' ? teamAPlayers : teamBPlayers;
    // Blank entries default to "Player N" (N = their position in the
    // list), rather than being dropped — a scorer setting up an hour
    // before the match often doesn't have full names yet, and forcing
    // entry here would block setup for no real benefit.
    const names = rawNames.map((n, i) => (n.trim() ? n.trim() : `Player ${i + 1}`));
    try {
      const inserted = await api.post(`/matches/${matchId}/players`, { team, names });
      if (team === 'A') {
        setTeamAIds(inserted);
        setStep('teamB');
      } else {
        setTeamBIds(inserted);
        setStep('whosBatting');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function chooseBattingTeam(team) {
    setBusy(true);
    setError('');
    try {
      const innings = await api.post(`/matches/${matchId}/innings`, { battingTeam: team });

      const battingRoster = team === 'A' ? teamAIds : teamBIds;
      const bowlingRoster = team === 'A' ? teamBIds : teamAIds;

      if (battingRoster.length < 2) {
        // Genuinely shouldn't happen with a normal roster, but guarding
        // explicitly rather than letting pair creation fail with a confusing API error.
        throw new Error('Batting team needs at least 2 players to open the innings.');
      }

      // Auto-select the first two players in the roster as the opening
      // pair, per the explicit instruction: choosing who's batting
      // should go straight to the scoring screen with Pair 1 preset to
      // the roster's first two names. The pen icon on the scoring screen
      // is the correction tool if this default guess is wrong.
      const pair = await api.post(`/matches/${matchId}/innings/${innings.id}/pairs`, {
        batter1Id: battingRoster[0].id,
        batter2Id: battingRoster[1].id,
        pairNumber: 1,
        stintNumber: 1,
      });

      onReady({
        matchId,
        joinCode,
        inningsId: innings.id,
        pairInningsId: pair.id,
        bowlingSpellId: null,
        strikerId: battingRoster[0].id,
        nonStrikerId: battingRoster[1].id,
        bowlerId: null,
        battingTeam: team,
        teamAName,
        teamBName,
        battingRoster,
        bowlingRoster,
        totalOvers: totalOversForSquadSize(battingRoster.length),
        wideCountEnabled,
      });
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-screen">
      {step === 'passcode' && (
        <div className="setup-card">
          <div className="setup-header">
            <button className="setup-back" onClick={goBack}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
            <h1 className="setup-title">Create new match</h1>
          </div>
          <label className="setup-label">Team</label>
          <input className="setup-input" placeholder="Team name" value={teamAName} onChange={(e) => setTeamAName(e.target.value)} />
          <label className="setup-label">Team</label>
          <input className="setup-input" placeholder="Team name" value={teamBName} onChange={(e) => setTeamBName(e.target.value)} />

          <label className="setup-label">Enter match passcode</label>
          <input
            className="setup-input"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
          />
          {error && <p className="setup-error">{error}</p>}
          <button className="setup-button" disabled={busy || passcode.length !== 4} onClick={handlePasscodeSubmit}>
            {busy ? 'Checking…' : 'Next →'}
          </button>
        </div>
      )}

      {(step === 'teamA' || step === 'teamB') && (
        <div className="setup-card">
          <div className="setup-header">
            <button className="setup-back" onClick={goBack}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
            <h1 className="setup-title">{step === 'teamA' ? (teamAName || 'Team A') : (teamBName || 'Team B')} — Players</h1>
          </div>
          {(step === 'teamA' ? teamAPlayers : teamBPlayers).map((name, i) => (
            <div key={i} className="setup-player-row">
              <input
                className="setup-input setup-input--player"
                placeholder={`Player ${i + 1}`}
                value={name}
                onChange={(e) => updatePlayerName(step === 'teamA' ? 'A' : 'B', i, e.target.value)}
              />
              {i >= 8 && (
                <button
                  className="setup-delete-player"
                  onClick={() => removePlayerField(step === 'teamA' ? 'A' : 'B', i)}
                  type="button"
                  aria-label="Remove player"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 11v6"/><path d="M14 11v6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                    <path d="M3 6h18"/>
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
          {(step === 'teamA' ? teamAPlayers : teamBPlayers).length < 12 && (
            <button className="setup-add-row" onClick={() => addPlayerField(step === 'teamA' ? 'A' : 'B')}>
              + Add player
            </button>
          )}
          <button className="setup-button" disabled={busy} onClick={() => submitTeam(step === 'teamA' ? 'A' : 'B')}>
            {busy ? 'Saving…' : 'Next →'}
          </button>
          {error && <p className="setup-error">{error}</p>}
        </div>
      )}

      {step === 'whosBatting' && (
        <div className="setup-card">
          <div className="setup-header">
            <button className="setup-back" onClick={goBack}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
            <h1 className="setup-title">Who's batting?</h1>
          </div>
          <div className="setup-team-choice-row">
            <button className="setup-team-choice" onClick={() => chooseBattingTeam('A')} disabled={busy}>
              {teamAName || 'Team A'}
            </button>
            <button className="setup-team-choice" onClick={() => chooseBattingTeam('B')} disabled={busy}>
              {teamBName || 'Team B'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
