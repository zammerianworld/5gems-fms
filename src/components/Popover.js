// Popover — minimal positioned dropdown with click-outside-to-close.
// Used by the date pickers to show the Calendar under its trigger.
import { useEffect, useRef } from 'react'

export default function Popover({ open, onClose, trigger, children, align = 'start' }) {
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose() }
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleEsc) }
  }, [open, onClose])

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      {trigger}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', [align === 'end' ? 'right' : 'left']: 0,
          zIndex: 1000, background: 'var(--surface)', border: '0.5px solid var(--border)',
          borderRadius: 16, boxShadow: 'var(--shadow), 0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
        }}>
          {children}
        </div>
      )}
    </div>
  )
}
