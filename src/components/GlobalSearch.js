import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'

export default function GlobalSearch({ open, onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ invoices: [], dumpTrips: [], pmTrips: [] })
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery(''); setResults({ invoices: [], dumpTrips: [], pmTrips: [] }); setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const runSearch = useCallback(async (q) => {
    if (!q || q.trim().length < 2) { setResults({ invoices: [], dumpTrips: [], pmTrips: [] }); return }
    setLoading(true)
    const term = q.trim()
    const [invRes, dumpRes, pmRes] = await Promise.all([
      supabase.from('invoices').select('id,invoice_no,client,invoice_date,truck_type,status')
        .or(`invoice_no.ilike.%${term}%,client.ilike.%${term}%`)
        .is('deleted_at', null).order('invoice_date', { ascending: false }).limit(8),
      supabase.from('trips_dump').select('id,trip_date,truck_plate,smcsl_wb,client,invoice_id')
        .or(`truck_plate.ilike.%${term}%,smcsl_wb.ilike.%${term}%,client.ilike.%${term}%`)
        .is('deleted_at', null).order('trip_date', { ascending: false }).limit(8),
      supabase.from('trips_pm').select('id,trip_date,truck_plate,waybill_no,client,invoice_id')
        .or(`truck_plate.ilike.%${term}%,waybill_no.ilike.%${term}%,client.ilike.%${term}%`)
        .is('deleted_at', null).order('trip_date', { ascending: false }).limit(8),
    ])
    setResults({
      invoices: invRes.data || [],
      dumpTrips: dumpRes.data || [],
      pmTrips: pmRes.data || [],
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 250)
    return () => clearTimeout(t)
  }, [query, runSearch])

  const flatResults = [
    ...results.invoices.map(r => ({ type: 'invoice', ...r })),
    ...results.dumpTrips.map(r => ({ type: 'dump', ...r })),
    ...results.pmTrips.map(r => ({ type: 'pm', ...r })),
  ]

  const goTo = (item) => {
    if (item.type === 'invoice') {
      navigate('/billing', { state: { tab: 'Invoice List', searchInvoice: item.invoice_no } })
    } else if (item.type === 'dump' || item.type === 'pm') {
      if (item.invoice_id) {
        navigate('/billing', { state: { tab: 'Invoice List' } })
      } else {
        navigate('/trips', { state: { activeTab: item.type === 'dump' ? 'Dump Truck' : 'Prime Mover', search: item.smcsl_wb || item.waybill_no || item.truck_plate } })
      }
    }
    onClose()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flatResults.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); if (flatResults[activeIdx]) goTo(flatResults[activeIdx]) }
  }

  if (!open) return null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 12, width: '92%', maxWidth: 560, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search invoice no, client, truck plate, waybill / SAF DR…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: 'var(--text)' }}
          />
          <kbd style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>Esc</kbd>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Searching…</div>}
          {!loading && query.trim().length >= 2 && flatResults.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No results found.</div>
          )}
          {!loading && query.trim().length < 2 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>Type at least 2 characters to search.</div>
          )}

          {results.invoices.length > 0 && (
            <div>
              <div style={{ padding: '6px 16px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--bg)' }}>Invoices</div>
              {results.invoices.map((r, i) => {
                const idx = i
                return (
                  <div key={r.id} onClick={() => goTo({ type: 'invoice', ...r })}
                    style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: activeIdx === idx ? 'var(--accent-light)' : 'transparent' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>#{r.invoice_no}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>{r.client}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(r.invoice_date)} · {r.status}</div>
                  </div>
                )
              })}
            </div>
          )}

          {results.dumpTrips.length > 0 && (
            <div>
              <div style={{ padding: '6px 16px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--bg)' }}>Dump Truck Trips</div>
              {results.dumpTrips.map((r, i) => {
                const idx = results.invoices.length + i
                return (
                  <div key={r.id} onClick={() => goTo({ type: 'dump', ...r })}
                    style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: activeIdx === idx ? 'var(--accent-light)' : 'transparent' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{r.truck_plate}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>{r.smcsl_wb || '—'} · {r.client}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(r.trip_date)} {r.invoice_id ? '· Invoiced' : '· Pending'}</div>
                  </div>
                )
              })}
            </div>
          )}

          {results.pmTrips.length > 0 && (
            <div>
              <div style={{ padding: '6px 16px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--bg)' }}>Prime Mover Trips</div>
              {results.pmTrips.map((r, i) => {
                const idx = results.invoices.length + results.dumpTrips.length + i
                return (
                  <div key={r.id} onClick={() => goTo({ type: 'pm', ...r })}
                    style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: activeIdx === idx ? 'var(--accent-light)' : 'transparent' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{r.truck_plate}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>{r.waybill_no || '—'} · {r.client}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(r.trip_date)} {r.invoice_id ? '· Invoiced' : '· Pending'}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 12 }}>
          <span>↑↓ Navigate</span><span>↵ Open</span><span>Esc Close</span>
        </div>
      </div>
    </div>
  )
}
