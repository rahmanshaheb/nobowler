// EditTeamsScreen.jsx
import { useState } from 'react';
import { api } from '../api/client';
import './EditTeamsScreen.css';
import './MatchSetupScreen.css';

/**
 * Mid-match team/player renaming. Reuses the existing PATCH endpoints
 * (renamePlayer, renameTeam) — this screen is just a UI on top of
 * functionality the backend already supported.
 */
export default function EditTeamsScreen({ matchContext, onSaved, onClose }) {
  const [teamAName, setTeamAName] = useState(matchContext.teamAName);
  const [teamBName, setTeamBName] = useState(matchContext.teamBName);
  const [battingNames, setBattingNames] = useState(
    matchContext.battingRoster.map((p) => ({ id: p.id, name: p.display_name }))
  );
  const [bowlingNames, setBowlingNames] = useState(
    matchContext.bowlingRoster.map((p) => ({ id: p.id, name: p.display_name }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Which roster is "A" vs "B" depends on which team is currently
  // batting — battingRoster/bowlingRoster are role-based, not fixed to
  // a letter. We need the actual A/B roster split for the rename calls
  // and to display the two team sections in their original A/B order.
  const teamARoster = matchContext.battingTeam === 'A' ? battingNames : bowlingNames;
  const teamBRoster = matchContext.battingTeam === 'A' ? bowlingNames : battingNames;
  const setTeamARoster = matchContext.battingTeam === 'A' ? setBattingNames : setBowlingNames;
  const setTeamBRoster = matchContext.battingTeam === 'A' ? setBowlingNames : setBattingNames;

  function updateName(setter, id, value) {
    setter((prev) => prev.map((p) => (p.id === id ? { ...p, name: value } : p)));
  }

  // Triggered by the × close button — saves any edits, then closes (via
  // onSaved, which the parent uses to also flip editTeamsOpen to false).
  // Stays open on failure so the scorer can see the error and retry
  // rather than silently losing their edits.
  async function handleClose() {
    setSaving(true);
    setError('');
    try {
      const renameCalls = [];

      if (teamAName.trim() && teamAName.trim() !== matchContext.teamAName) {
        renameCalls.push(api.patch(`/matches/${matchContext.matchId}/team-name`, { team: 'A', name: teamAName.trim() }));
      }
      if (teamBName.trim() && teamBName.trim() !== matchContext.teamBName) {
        renameCalls.push(api.patch(`/matches/${matchContext.matchId}/team-name`, { team: 'B', name: teamBName.trim() }));
      }

      const originalById = new Map(
        [...matchContext.battingRoster, ...matchContext.bowlingRoster].map((p) => [p.id, p.display_name])
      );

      // A blank field means "leave this player's name as it was" — NOT
      // an instruction to rename them to blank. Falling back to
      // originalById here (rather than the blank value itself) avoids a
      // real bug: without this, a player whose field gets accidentally
      // cleared would show blank on screen even though the database
      // still has their real name, since no rename call would have been
      // sent for an empty value.
      function resolvedName(p) {
        return p.name.trim() || originalById.get(p.id) || p.name;
      }

      const allPlayers = [...teamARoster, ...teamBRoster];
      for (const p of allPlayers) {
        const resolved = resolvedName(p);
        if (resolved !== originalById.get(p.id)) {
          renameCalls.push(
            api.patch(`/matches/${matchContext.matchId}/players/${p.id}`, { displayName: resolved })
          );
        }
      }

      await Promise.all(renameCalls);

      onSaved({
        teamAName: teamAName.trim() || matchContext.teamAName,
        teamBName: teamBName.trim() || matchContext.teamBName,
        battingRoster: battingNames.map((p) => ({ id: p.id, display_name: resolvedName(p) })),
        bowlingRoster: bowlingNames.map((p) => ({ id: p.id, display_name: resolvedName(p) })),
      });
    } catch (err) {
      setError(err.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="edit-teams-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={handleClose} disabled={saving} aria-label="Close">
          ×
        </button>
        <h2 className="modal-title">Edit teams</h2>
        <div className="edit-teams-content">
          {error && <div className="setup-error">{error}</div>}

          <label className="edit-teams-label">Team name</label>
          <input className="setup-input" value={teamAName} onChange={(e) => setTeamAName(e.target.value)} />
          {teamARoster.map((p) => (
            <input
              key={p.id}
              className="setup-input setup-input--player"
              value={p.name}
              onChange={(e) => updateName(setTeamARoster, p.id, e.target.value)}
            />
          ))}

          <label className="edit-teams-label" style={{ marginTop: 'var(--space-4)' }}>Team name</label>
          <input className="setup-input" value={teamBName} onChange={(e) => setTeamBName(e.target.value)} />
          {teamBRoster.map((p) => (
            <input
              key={p.id}
              className="setup-input setup-input--player"
              value={p.name}
              onChange={(e) => updateName(setTeamBRoster, p.id, e.target.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
