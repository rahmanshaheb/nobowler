// RosterPickerModal.jsx
import { useState } from 'react';

const IconCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);

export default function RosterPickerModal({ title, roster, mode = 'single', onClose, onConfirm }) {
  const [first, setFirst] = useState(null);
  const [second, setSecond] = useState(null);

  function handlePick(id) {
    if (mode === 'single') {
      onConfirm({ id });
      return;
    }
    if (first === id) { setFirst(null); return; }
    if (second === id) { setSecond(null); return; }
    if (first === null) { setFirst(id); }
    else if (second === null) { setSecond(id); }
  }

  function handleConfirmPair() {
    if (first && second) onConfirm({ batter1Id: first, batter2Id: second });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="modal-title">{title}</h2>
        <div className="roster-picker-list">
          {roster.map((p) => {
            const isNewSelected = mode === 'single' ? false : first === p.id || second === p.id;
            const isCurrent = Boolean(p.isCurrent);
            const isHighlighted = isNewSelected || isCurrent;
            return (
              <button
                key={p.id}
                className={`roster-picker-item ${isHighlighted ? 'roster-picker-item--selected' : ''} ${p.disabled ? 'roster-picker-item--disabled' : ''}`}
                disabled={Boolean(p.disabled)}
                onClick={() => handlePick(p.id)}
              >
                <span className="roster-picker-item__name">{p.display_name}</span>
                {isNewSelected && (
                  <span className="roster-picker-item__tick">
                    <IconCheck />
                  </span>
                )}
                {p.overCount != null && (
                  <span className="roster-picker-item__count">{p.overCount}</span>
                )}
              </button>
            );
          })}
        </div>
        {mode === 'pair' && (
          <button className="modal-confirm-button" disabled={!first || !second} onClick={handleConfirmPair}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}
