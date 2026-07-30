// ConfirmDialog — styled replacement for window.confirm().
// Renders as a proper modal matching the app's design system instead of
// the browser's native dialog. Supports multi-line messages and an
// optional warning variant (for dupe checks, destructive actions, etc).
//
// Usage:
//   const [confirmState, setConfirmState] = useState(null)
//   setConfirmState({
//     title: 'Possible Duplicate',
//     message: 'SMCSL WB "1234" already exists...\nSave anyway?',
//     variant: 'warning',            // 'default' | 'warning' | 'danger'
//     confirmLabel: 'Save Anyway',   // optional, defaults to 'Confirm'
//     onConfirm: () => { ... }
//   })
//   <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />

export default function ConfirmDialog({ state, onClose }) {
  if (!state) return null

  const variant = state.variant || 'default'
  const icon = variant === 'warning' ? '⚠️' : variant === 'danger' ? '🗑️' : null
  const confirmBtnClass = variant === 'danger' ? 'btn-danger' : variant === 'warning' ? 'btn-warning' : 'btn-primary'

  const handleConfirm = () => {
    onClose()
    state.onConfirm?.()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && <span>{icon}</span>}
          {state.title || 'Confirm'}
        </h3>
        <p style={{ whiteSpace: 'pre-line', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)' }}>
          {state.message}
        </p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>{state.cancelLabel || 'Cancel'}</button>
          <button className={confirmBtnClass} onClick={handleConfirm}>{state.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
