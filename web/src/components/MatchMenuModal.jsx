// MatchMenuModal.jsx
import { useState } from 'react';

const IconEditTeams = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 21a8 8 0 0 1 10.821-7.487"/>
    <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>
    <circle cx="10" cy="8" r="5"/>
  </svg>
);

const IconEndInnings = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 9-6 6"/><path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/>
    <path d="m9 9 6 6"/>
  </svg>
);

const IconScorecard = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const IconToggle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="15" cy="12" r="3"/><rect width="20" height="14" x="2" y="5" rx="7"/>
  </svg>
);

const IconSwap = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>
  </svg>
);

const IconCopy = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
  </svg>
);

export default function MatchMenuModal({ onClose, onEditTeams, onEndInnings, onOpenRulebook, onOpenScorecard, matchId, joinCode, wideCountEnabled = true, hasDeliveries = false, onToggleWideCount, canSwapBatting = false, battingTeamName = '', bowlingTeamName = '', teamAName = '', teamBName = '', battingIsTeamA = true, isSwapping = false, onSwapBatting, onExit }) {
  const [copied, setCopied] = useState(false);
  const [showWideConfirm, setShowWideConfirm] = useState(false);
  const [showSwapConfirm, setShowSwapConfirm] = useState(false);

  function handle(action) { onClose(); action(); }

  function handleCopyId() {
    const toCopy = joinCode ? String(joinCode) : matchId;
    navigator.clipboard.writeText(toCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const displayCode = joinCode ? String(joinCode) : (matchId ? matchId.slice(0, 8).toUpperCase() : '—');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--menu" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="modal-title">Menu</h2>

        <button className="match-id-display" onClick={handleCopyId}>
          <span className="match-id-display__label">Match code</span>
          <span className="match-id-display__value">{displayCode}</span>
          <span className="match-id-display__action">
            {copied ? '✓ Copied' : <><span>COPY</span> <IconCopy /></>}
          </span>
        </button>

        <div className="match-menu-list" style={{ marginTop: 'var(--space-4)' }}>
          <button className="match-menu-item" onClick={() => handle(onEditTeams)}>
            <IconEditTeams /> Edit teams
          </button>

          {canSwapBatting ? (
            <button className="match-menu-item" style={{ alignItems: 'flex-start' }} onClick={() => !isSwapping && setShowSwapConfirm(true)}>
              <div style={{ paddingTop: 2 }}>
                {isSwapping ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : <IconSwap />}
              </div>
              <div className="match-menu-item__toggle-text">
                <span>{isSwapping ? 'Updating…' : `${battingTeamName || (battingIsTeamA ? 'Team A' : 'Team B')} is batting`}</span>
                <span className="match-menu-item__toggle-sub">Change before the first delivery.</span>
              </div>
            </button>
          ) : (
            <div className="match-menu-item match-menu-item--wide-locked" style={{ alignItems: 'flex-start' }}>
              <div style={{ paddingTop: 2 }}><IconSwap /></div>
              <div className="match-menu-item__toggle-text">
                <span>{battingTeamName || (battingIsTeamA ? 'Team A' : 'Team B')} is batting</span>
                <span className="match-menu-item__toggle-sub">Can't be changed after first delivery.</span>
              </div>
            </div>
          )}

          <button className="match-menu-item" onClick={() => handle(onOpenScorecard)}>
            <IconScorecard /> Scorecard
          </button>

          <div className={`match-menu-item match-menu-item--toggle${hasDeliveries ? ' match-menu-item--wide-locked' : ''}`} style={{ alignItems: 'flex-start' }}>
            <div style={{ paddingTop: 2 }}><IconToggle /></div>
            <div className="match-menu-item__toggle-text">
              <span>Count wide balls?</span>
              <span className="match-menu-item__toggle-sub">
                {hasDeliveries
                  ? 'Locked after first ball'
                  : 'If NO, each wide counts as a legal delivery and adds 2 extra runs. Any runs taken by the batter are added as extras.'}
              </span>
            </div>
            <button
              className={`menu-wide-btn ${wideCountEnabled ? 'menu-wide-btn--yes' : 'menu-wide-btn--no'}`}
              onClick={hasDeliveries ? undefined : () => setShowWideConfirm(true)}
              type="button"
            >
              {wideCountEnabled ? 'YES' : 'NO'}
            </button>
          </div>

          <button className="match-menu-item match-menu-item--danger" onClick={() => handle(onEndInnings)}>
            <IconEndInnings /> End innings
          </button>
        </div>

        {/* Sponsor logo + Exit button */}
        <div style={{ marginTop: 'auto', paddingTop: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-4)' }}>
          <div>
            <p style={{ fontSize: 14, fontFamily: 'var(--font-body)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-4)' }}>Sponsored by</p>
            <img src="/sponsor-logo.svg" alt="Sponsor" style={{ width: 150, height: 'auto', display: 'block' }} />
          </div>
          {onExit && (
            <button onClick={onExit} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--space-2)', color: 'var(--color-yellow)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '18px', fontFamily: 'var(--font-body)', fontWeight: 600, textTransform: 'uppercase' }} title="Exit to home">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m10 17 5-5-5-5"/>
                <path d="M15 12H3"/>
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              </svg>
              Exit
            </button>
          )}
        </div>
      </div>

      {showSwapConfirm && (
        <div className="modal-overlay" style={{ alignItems: 'center' }} onClick={() => setShowSwapConfirm(false)}>
          <div className="modal-card modal-card--compact" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSwapConfirm(false)} aria-label="Close">×</button>
            <div style={{ marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'center' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
              </svg>
            </div>
            <h2 className="modal-title" style={{ textAlign: 'center', marginBottom: 'var(--space-2)' }}>Who bats first?</h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-7)', lineHeight: 1.5 }}>
              Change before the first delivery.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                className={`modal-confirm-button${battingIsTeamA ? '' : ' modal-confirm-button--secondary'}`}
                style={{ flex: 1 }}
                onClick={() => { if (!battingIsTeamA) onSwapBatting(); setShowSwapConfirm(false); }}
              >
                {teamAName || 'Team A'}
              </button>
              <button
                className={`modal-confirm-button${battingIsTeamA ? ' modal-confirm-button--secondary' : ''}`}
                style={{ flex: 1 }}
                onClick={() => { if (battingIsTeamA) onSwapBatting(); setShowSwapConfirm(false); }}
              >
                {teamBName || 'Team B'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWideConfirm && (
        <div className="modal-overlay" style={{ alignItems: 'center' }} onClick={() => setShowWideConfirm(false)}>
          <div className="modal-card modal-card--compact" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'center' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
              </svg>
            </div>
            <h2 className="modal-title" style={{ textAlign: 'center' }}>
              {wideCountEnabled ? 'Turn off wide count?' : 'Turn on wide count?'}
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-5)', lineHeight: 1.5 }}>
              {wideCountEnabled
                ? 'Each wide counts as a legal delivery and adds 2 extra runs. Any runs taken by the batter are added as extras.'
                : 'Wides will be tracked separately as extras.'}
            </p>
            <button className="modal-confirm-button" style={{ marginBottom: 'var(--space-3)' }} onClick={() => { onToggleWideCount(); setShowWideConfirm(false); }}>Yes</button>
            <button className="modal-confirm-button modal-confirm-button--secondary" onClick={() => setShowWideConfirm(false)}>No</button>
          </div>
        </div>
      )}
    </div>
  );
}
