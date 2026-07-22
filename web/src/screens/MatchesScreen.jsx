// MatchesScreen.jsx
import { useState, useEffect } from 'react';
import './MatchesScreen.css';
import { api } from '../api/client';
import ScorecardModal from '../components/ScorecardModal';

const IconArrowRight = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14"/>
    <path d="m12 5 7 7-7 7"/>
  </svg>
);

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

export default function MatchesScreen({
onBack }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMatchId, setSelectedMatchId] = useState(null);

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

  return (
    <div className="matches-screen">
      <div className="matches-header">
        <button className="matches-back" onClick={onBack}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
        <h1 className="matches-title">Matches</h1>
      </div>

      <div className="matches-list">
        {loading && <p className="matches-empty">Loading…</p>}
        {error && <p className="matches-empty">{error}</p>}
        {!loading && !error && matchesWithLabels.length === 0 && (
          <p className="matches-empty">No matches found.</p>
        )}
        {matchesWithLabels.map((m) => (
          <button
            key={m.id}
            className="matches-item"
            onClick={() => setSelectedMatchId(m.id)}
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
            <IconArrowRight />
          </button>
        ))}
      </div>

      <div className="matches-legend">
        <IconVerified />
        <span>Matches with verified icons are official. All others are test matches and are periodically deleted.</span>
      </div>

      {selectedMatchId && (
        <ScorecardModal matchId={selectedMatchId} onClose={() => setSelectedMatchId(null)} />
      )}
    </div>
  );
}
