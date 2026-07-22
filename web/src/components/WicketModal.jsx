// WicketModal.jsx
import { useState } from 'react';

const ALL_WICKET_TYPES = [
  { value: 'bowled',           label: 'Bowled' },
  { value: 'caught_and_bowled',label: 'Caught & bowled' },
  { value: 'caught',           label: 'Caught' },
  { value: 'run_out',          label: 'Run out' },
  { value: 'stumped',          label: 'Stumped' },
];

// On a wide or no-ball, only run out and stumped are possible
const EXTRA_WICKET_TYPES = [
  { value: 'run_out', label: 'Run out' },
  { value: 'stumped', label: 'Stumped' },
];

const NEEDS_FIELDER_GRID = new Set(['caught', 'run_out', 'stumped']);

const IconCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);

export default function WicketModal({ strikerName, nonStrikerName, strikerId, nonStrikerId, bowlerId, deliveryType, fieldingTeamPlayers, onClose, onConfirm }) {
  const isExtra = deliveryType === 'wide' || deliveryType === 'no_ball';
  const WICKET_TYPES = isExtra ? EXTRA_WICKET_TYPES : ALL_WICKET_TYPES;

  const [step, setStep] = useState('type');
  const [wicketType, setWicketType] = useState(null);
  const [dismissedPlayerId, setDismissedPlayerId] = useState(null);
  const [fielderId, setFielderId] = useState(null);

  function selectType(type) {
    setWicketType(type);
    if (type === 'run_out') {
      setStep('fielder');
      return;
    }
    setDismissedPlayerId(strikerId);
    if (type === 'caught_and_bowled') {
      // Auto-confirm — fielder is bowler by definition
      onConfirm({ wicketType: type, dismissedPlayerId: strikerId, fielderId: bowlerId });
      return;
    }
    if (type === 'bowled' || type === 'three_dots') {
      // Auto-confirm — no fielder needed
      onConfirm({ wicketType: type, dismissedPlayerId: strikerId, fielderId: null });
      return;
    }
    if (NEEDS_FIELDER_GRID.has(type)) {
      setStep('fielder');
    }
  }

  function selectDismissedBatter(playerId) {
    // Called after fielder is chosen for run out
    onConfirm({ wicketType, dismissedPlayerId: playerId, fielderId });
  }

  function selectFielder(playerId) {
    if (wicketType === 'run_out') {
      // After fielder chosen, ask which batter was run out
      setFielderId(playerId);
      setStep('which_batter');
    } else {
      // All other types — auto-confirm immediately
      onConfirm({ wicketType, dismissedPlayerId, fielderId: playerId });
    }
  }

  function handleDone() {
    onConfirm({ wicketType, dismissedPlayerId, fielderId });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        {step === 'type' && (
          <>
            <h2 className="modal-title">
              {isExtra
                ? `Wicket on ${deliveryType === 'wide' ? 'Wide' : 'No Ball'}`
                : 'Wicket'}
            </h2>
            <div className="wicket-type-grid">
              {WICKET_TYPES.map((wt) => (
                <button
                  key={wt.value}
                  className={`modal-option-button ${wicketType === wt.value ? 'modal-option-button--selected' : ''}`}
                  onClick={() => selectType(wt.value)}
                >
                  {wt.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'fielder' && (
          <>
            <h2 className="modal-title">
              {wicketType === 'run_out' ? 'Run out by' : wicketType === 'stumped' ? (
                <><span className="modal-title--accent">{strikerName}</span><br />Stumped by</>
              ) : (
                <><span className="modal-title--accent">{dismissedPlayerId === strikerId ? strikerName : nonStrikerName}</span><br />Caught by</>
              )}
            </h2>
            <div className="fielder-grid">
              {fieldingTeamPlayers.map((p) => (
                <button
                  key={p.id}
                  className={`modal-option-button ${fielderId === p.id ? 'modal-option-button--selected' : ''}`}
                  onClick={() => selectFielder(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'which_batter' && (
          <>
            <h2 className="modal-title">Which batter ran out?</h2>
            <div className="wicket-type-grid">
              <button className="modal-option-button" onClick={() => selectDismissedBatter(strikerId)}>
                {strikerName}
              </button>
              <button className="modal-option-button" onClick={() => selectDismissedBatter(nonStrikerId)}>
                {nonStrikerName}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
