// UndoConfirmModal.jsx
// Generic yes/no confirm dialog — name kept for backward compatibility
// with its original (and still primary) use undoing the last delivery.
// `message` defaults to that original text so every existing call site
// (just the undo flow, as of this change) needs no update; other flows
// (e.g. ending an innings) pass their own message explicitly.

export default function UndoConfirmModal({
  message = 'Are you sure you want to undo the last action?',
  onCancel,
  onConfirm,
}) {
  return (
    <div className="modal-overlay" style={{ alignItems: 'center' }} onClick={onCancel}>
      <div className="modal-card modal-card--compact" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'center' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" x2="12" y1="8" y2="12"/>
            <line x1="12" x2="12.01" y1="16" y2="16"/>
          </svg>
        </div>
        <h2 className="modal-title" style={{ textAlign: 'center' }}>
          {message}
        </h2>
        <button className="modal-confirm-button" onClick={onConfirm} style={{ marginBottom: 'var(--space-3)' }}>
          Yes
        </button>
        <button className="modal-confirm-button modal-confirm-button--secondary" onClick={onCancel}>
          No
        </button>
      </div>
    </div>
  );
}
