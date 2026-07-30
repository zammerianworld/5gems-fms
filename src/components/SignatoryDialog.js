import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const LABELS = ['Prepared by', 'Verified by', 'Noted by', 'Checked by', 'Reviewed by', 'Approved by', 'Received by']
const EMPTY_SIG = () => ({ enabled: true, label: 'Prepared by', name: '', title: '' })

function NamePicker({ value, title, onChange, directory, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = directory.filter(d =>
    !value || d.full_name.toLowerCase().includes(value.toLowerCase())
  )

  return (
    <div ref={ref} style={{ position: 'relative', flex: 2 }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value.toUpperCase(), null); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Full name"
        disabled={disabled}
        style={{ width: '100%', fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 12 }}
      />
      {open && directory.length > 0 && !disabled && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
          background: 'var(--surface)', border: '1px solid var(--border-md)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          maxHeight: 200, overflowY: 'auto', marginTop: 2
        }}>
          {filtered.length === 0
            ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)' }}>No match</div>
            : filtered.map(d => (
                <div key={d.id}
                  onMouseDown={e => { e.preventDefault(); onChange(d.full_name, d.title); setOpen(false) }}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '0.5px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ fontWeight: 600, fontSize: 12, fontFamily: 'var(--mono)' }}>{d.full_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--accent)' }}>{d.title}</div>
                </div>
              ))
          }
        </div>
      )}
    </div>
  )
}

export default function SignatoryDialog({ open, onClose, onPrint, settings, profile, docType = '' }) {
  const [sigs, setSigs] = useState([])
  const [directory, setDirectory] = useState([])

  useEffect(() => {
    if (!open) return
    supabase.from('signatories').select('*').order('sort_order').order('full_name').then(({ data: dir }) => {
      if (dir) setDirectory(dir)
      const defaultPrepared = dir?.find(d => d.is_default_prepared)
      const defaultApproved = dir?.find(d => d.is_default_approved)
      const prepName = defaultPrepared?.full_name || profile?.full_name || settings?.prepared_by_name || ''
      const prepTitle = defaultPrepared?.title || profile?.title || settings?.prepared_by_title || ''
      const appName = defaultApproved?.full_name || settings?.noted_by_name || ''
      const appTitle = defaultApproved?.title || settings?.noted_by_title || ''
      setSigs([
        { enabled: true, label: 'Prepared by', name: prepName.toUpperCase(), title: prepTitle },
        { enabled: false, label: 'Verified by', name: '', title: '' },
        { enabled: true, label: 'Approved by', name: appName ? appName.toUpperCase() : '', title: appTitle },
      ])
    })
  }, [open, settings, profile])

  const update = (i, field, val) => setSigs(s => s.map((x, idx) => idx === i ? { ...x, [field]: val } : x))
  const handleNameChange = (i, name, autoTitle) => {
    setSigs(s => s.map((x, idx) => idx === i
      ? { ...x, name, ...(autoTitle !== null ? { title: autoTitle } : {}) }
      : x
    ))
  }
  const addSlot = () => { if (sigs.length < 4) setSigs(s => [...s, EMPTY_SIG()]) }
  const removeSlot = (i) => setSigs(s => s.filter((_, idx) => idx !== i))
  const handlePrint = () => onPrint(sigs.filter(s => s.enabled && s.name.trim()))

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '96vw' }}>
        <h3 style={{ marginBottom: 4 }}>✍️ Signatories</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Configure who signs this document. Uncheck to hide. Up to 4 signatories.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sigs.map((sig, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: sig.enabled ? 'var(--surface)' : 'var(--bg)', borderRadius: 8, border: `1px solid ${sig.enabled ? 'var(--border-md)' : 'var(--border)'}`, opacity: sig.enabled ? 1 : 0.5 }}>
              <input type="checkbox" checked={sig.enabled} onChange={e => update(i, 'enabled', e.target.checked)} style={{ width: 'auto', marginTop: 6 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <select value={sig.label} onChange={e => update(i, 'label', e.target.value)} disabled={!sig.enabled}
                  style={{ width: 'auto', fontSize: 11, padding: '3px 6px', fontWeight: 600, color: 'var(--accent)' }}>
                  {LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  <NamePicker
                    value={sig.name}
                    title={sig.title}
                    directory={directory}
                    disabled={!sig.enabled}
                    onChange={(name, autoTitle) => handleNameChange(i, name, autoTitle)}
                  />
                  <input
                    value={sig.title}
                    onChange={e => update(i, 'title', e.target.value)}
                    placeholder="Title / Position"
                    disabled={!sig.enabled}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                </div>
              </div>
              {sigs.length > 1 && (
                <button onClick={() => removeSlot(i)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '4px', marginTop: 2 }}>✕</button>
              )}
            </div>
          ))}
        </div>

        {sigs.length < 4 && (
          <button className="btn-ghost btn-sm" onClick={addSlot} style={{ marginTop: 10 }}>+ Add Signatory</button>
        )}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handlePrint}>🖨️ Print / Save PDF</button>
        </div>
      </div>
    </div>
  )
}
