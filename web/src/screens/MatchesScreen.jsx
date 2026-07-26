// MatchesScreen.jsx
import { useState, useEffect } from 'react';
import './MatchesScreen.css';
import '../screens/ScoringScreen.css';
import { api } from '../api/client';

function openScoreSummary(matchId) {
  window.location.href = `/summary/${matchId}`;
}

const IconVerified = ({ size = 16 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--color-mint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/>
    <path d="m9 12 2 2 4-4"/>
  </svg>
);

function formatMatchDate(dateStr, index, sameDay) {
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.toLocaleString('en-AU', { month: 'long' });
  const base = `${day} ${month}`;
  return sameDay ? `${base} ${index + 1}` : base;
}

function DeleteMatchModal({ match, onCancel, onDeleted }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!/^\d{4}$/.test(code)) {
      setError('Enter the 4-digit match code.');
      return;
    }

    setDeleting(true);
    setError('');

    try {
      await api.delete(`/public/matches/${match.id}`, { joinCode: code });
      onDeleted(match.id);
    } catch (err) {
      setError(err.message || 'Could not delete match.');
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay matches-delete-overlay" onClick={onCancel}>
      <div className="modal-card modal-card--compact matches-delete-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        <h2 className="modal-title matches-delete-modal__title">Delete match?</h2>
        <p className="matches-delete-modal__teams">{match.team_a_name} vs {match.team_b_name}</p>
        <p className="matches-delete-modal__hint">
          Enter the match code to confirm. You can find it in the scoring menu.
        </p>
        <label className="matches-delete-modal__label" htmlFor="match-delete-code">
          Match code
        </label>
        <input
          id="match-delete-code"
          className="matches-delete-modal__input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          placeholder="0000"
          value={code}
          autoComplete="off"
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 4));
            setError('');
          }}
        />
        {error && <p className="matches-delete-modal__error">{error}</p>}
        <button
          type="button"
          className="modal-confirm-button matches-delete-modal__confirm"
          disabled={deleting || code.length !== 4}
          onClick={handleDelete}
        >
          {deleting ? 'Deleting…' : 'Delete match'}
        </button>
        <button
          type="button"
          className="modal-confirm-button modal-confirm-button--secondary"
          disabled={deleting}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function MatchesScreen({ onBack }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    api.get('/public/matches')
      .then((data) => {
        const sorted = [...data].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setMatches(sorted);
      })
      .catch(() => setError('Could not load matches.'))
      .finally(() => setLoading(false));
  }, []);

  const dateCounts = {};
  matches.forEach((m) => {
    const day = new Date(m.created_at).toDateString();
    dateCounts[day] = (dateCounts[day] || 0) + 1;
  });

  const dayCounters = {};
  const matchesWithLabels = matches.map((m) => {
    const day = new Date(m.created_at).toDateString();
    const sameDay = dateCounts[day] > 1;
    dayCounters[day] = (dayCounters[day] || 0);
    const label = formatMatchDate(m.created_at, dayCounters[day], sameDay);
    dayCounters[day]++;
    return { ...m, label };
  });

  function handleDeleted(matchId) {
    setMatches((prev) => prev.filter((m) => m.id !== matchId));
    setDeleteTarget(null);
  }

  return (
    <div className="matches-screen">
      <div className="matches-header">
        <button type="button" className="matches-back" onClick={onBack}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <h1 className="matches-title">Matches</h1>
      </div>

      <div className="matches-list">
        {loading && <p className="matches-empty">Loading…</p>}
        {error && <p className="matches-empty">{error}</p>}
        {!loading && !error && matchesWithLabels.length === 0 && (
          <p className="matches-empty">No matches found.</p>
        )}
        {matchesWithLabels.map((m) => (
          <div key={m.id} className="matches-item">
            <button
              type="button"
              className="matches-item__main"
              onClick={() => openScoreSummary(m.id)}
            >
              <div className="matches-item__date">
                {m.label}
                {[2423, 7091, 7585, 8081, 9567].includes(m.join_code) && (
                  <span style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}>
                    <IconVerified />
                  </span>
                )}
              </div>
              <div className="matches-item__teams">{m.team_a_name} vs {m.team_b_name}</div>
            </button>
            <button
              type="button"
              className="matches-item__delete"
              aria-label={`Delete ${m.team_a_name} vs ${m.team_b_name}`}
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(m);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="matches-legend">
        <IconVerified />
        <span>Matches with verified icons are official. All others are test matches and are periodically deleted.</span>
      </div>

      {deleteTarget && (
        <DeleteMatchModal
          match={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
