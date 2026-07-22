// InningsSummaryModal.jsx
import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function InningsSummaryModal({ matchId, inningsNumber, battingTeamName, totalRuns, onContinue }) {
  const [pairStats, setPairStats] = useState([]);

  useEffect(() => {
    api.get(`/public/matches/${matchId}`)
      .then((data) => {
        const pairs = (data.pairStats || [])
          .filter((p) => Number(p.innings_number) === inningsNumber)
          .sort((a, b) => a.pair_number - b.pair_number);
        let display = 1;
        setPairStats(pairs.map((p) => ({ ...p, displayNumber: display++ })));
      })
      .catch(() => {});
  }, [matchId, inningsNumber]);

  return (
    <div className="modal-overlay">
      <div className="modal-card modal-card--innings-summary">
        <h2 className="innings-summary__heading">End of Innings {inningsNumber}</h2>
        <p className="innings-summary__team">{battingTeamName}</p>

        <div className="innings-summary__total-block">
          <span className="innings-summary__total-label">Total Runs</span>
          <span className="innings-summary__total-value">{totalRuns}</span>
        </div>

        {pairStats.length > 0 && (
          <div className="innings-summary__pairs">
            <h4 className="innings-summary__pairs-heading">Pair Totals</h4>
            <div className="innings-summary__content">
              {pairStats.map((p) => (
                <div className="innings-summary__pair-row" key={p.pair_innings_id}>
                  <span className="innings-summary__pair-name">
                    Pair {p.displayNumber} — {p.batter_1_name} &amp; {p.batter_2_name}
                  </span>
                  <span
                    className="innings-summary__pair-runs"
                    style={{ color: Number(p.pair_total_runs) < 0 ? 'var(--color-coral)' : 'var(--color-text-primary)' }}
                  >
                    {p.pair_total_runs}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="modal-confirm-button innings-summary__continue" onClick={onContinue}>
          Continue to Innings 2
        </button>
      </div>
    </div>
  );
}
