import { useState, useCallback } from 'react'

export function useToast() {
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    // Errors often carry real diagnostic detail (a database error message,
    // an RLS failure) — auto-dismissing those after 3s means nobody gets a
    // chance to actually read or relay them. Only success/info auto-clear;
    // errors stay until the user dismisses them.
    if (type !== 'error') setTimeout(() => setToast(null), 3000)
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  return { toast, showToast, dismissToast }
}

export function Toast({ toast, onDismiss }) {
  if (!toast) return null
  return (
    <div className={`toast toast-${toast.type}`} onClick={onDismiss} style={toast.type === 'error' ? { cursor: 'pointer' } : undefined}>
      {toast.msg}
    </div>
  )
}
