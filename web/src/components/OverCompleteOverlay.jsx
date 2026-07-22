// OverCompleteOverlay.jsx
import './OverCompleteOverlay.css';

/**
 * Full-screen persistent message overlay, shown right after a legal
 * delivery completes an over. PERSISTENT — confirmed explicitly: no
 * auto-timer or fade-out (an earlier version auto-dismissed after 1.5s;
 * changed because the scorer wanted a deliberate pause with an explicit
 * action, not a timed one). Stays up until the scorer taps the action
 * button, which is what dismisses it and moves to the next step.
 *
 * Generalized (message/buttonLabel props) rather than duplicated, so
 * this same component serves both the original "Over complete -> Select
 * bowler" moment AND the newer "every 4th over -> Select next batters"
 * pair-rotation moment, confirmed explicitly to share the identical
 * visual treatment.
 *
 * buttonIcon: optional trailing icon, confirmed explicitly per-button —
 * 🎾 (tennis ball) for the bowler-selection overlay, 🏏 (cricket bat &
 * ball, the only standard cricket-specific glyph available — there's no
 * separate standalone bat-only or ball-only emoji) for the
 * batter-selection overlay.
 */
export default function OverCompleteOverlay({ message = 'Over complete', buttonLabel = 'Select bowler', buttonIcon = null, onAction, onDismiss }) {
  return (
    <div className="over-complete-overlay">
      <div className="over-complete-message">{message}</div>
      <button className="over-complete-button" onClick={onAction}>
        {buttonLabel}
        {buttonIcon && <span className="over-complete-button__icon">{buttonIcon}</span>}
      </button>
      {onDismiss && (
        <button className="over-complete-skip" onClick={onDismiss}>
          Keep same batters
        </button>
      )}
    </div>
  );
}
