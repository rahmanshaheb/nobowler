// MatchResultScreen.jsx
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import './MatchResultScreen.css';

export default function MatchResultScreen({ matchId, joinCode, onReturnHome }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const result = await api.get(`/public/matches/${matchId}`);
        setData(result);
      } catch (err) {
        setError(err.message || 'Unable to load match result.');
      }
    }
    load();
  }, [matchId]);

  function handleCopyId() {
    navigator.clipboard.writeText(joinCode ? String(joinCode) : matchId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  if (error) {
    return (
      <div className="result-screen">
        <p className="result-status result-status--error">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="result-screen">
        <p className="result-status">Loading result…</p>
      </div>
    );
  }

  const { match, innings } = data;
  const inningsOne = innings.find((i) => i.innings_number === 1);
  const inningsTwo = innings.find((i) => i.innings_number === 2);

  if (!inningsOne || !inningsTwo) {
    return (
      <div className="result-screen">
        <p className="result-status">Both innings aren't complete yet.</p>
      </div>
    );
  }

  const teamOneName = inningsOne.batting_team === 'A' ? match.team_a_name : match.team_b_name;
  const teamTwoName = inningsTwo.batting_team === 'A' ? match.team_a_name : match.team_b_name;
  const teamOneRuns = Number(inningsOne.total_runs);
  const teamTwoRuns = Number(inningsTwo.total_runs);

  let resultText;
  if (teamOneRuns === teamTwoRuns) {
    resultText = 'Match tied';
  } else if (teamOneRuns > teamTwoRuns) {
    resultText = `${teamOneName} won by ${teamOneRuns - teamTwoRuns} runs`;
  } else {
    resultText = `${teamTwoName} won by ${teamTwoRuns - teamOneRuns} runs`;
  }

  const displayCode = joinCode ? String(joinCode) : (matchId ? matchId.slice(0, 8).toUpperCase() : "—");

  return (
    <div className="result-screen">
      <h1 className="result-title">{resultText}</h1>
      <div className="result-innings-row">
        <span className="result-team-name">{teamOneName}</span>
        <span className="result-team-score">{teamOneRuns}</span>
      </div>
      <div className="result-innings-row">
        <span className="result-team-name">{teamTwoName}</span>
        <span className="result-team-score">{teamTwoRuns}</span>
      </div>
      <button className="match-id-display" onClick={handleCopyId}>
        <span className="match-id-display__label">Match code</span>
        <span className="match-id-display__value">{displayCode}</span>
        <span className="match-id-display__action">
          {copied ? '✓ Copied' : (
            <>
              <span>COPY</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
            </>
          )}
        </span>
      </button>
      <button className="result-home-button" onClick={onReturnHome}>
        Homepage
      </button>
    </div>
  );
}
