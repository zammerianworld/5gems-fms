import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fmtDate } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { calcQtyDest } from '../lib/supabase'

// ── COLUMN DEFINITIONS ──────────────────────────────────────────────────────
const DUMP_COLUMNS = [
  { key: 'trip_date',          label: 'TRANSACTION DATE',       locked: true,  field: t => fmtDate(t.trip_date).toUpperCase() },
  { key: 'smcsl_wb',           label: 'SMCSL WB',               locked: false, field: t => t.smcsl_wb || '' },
  { key: 'supplier_doc_ref',   label: 'SUPPLIER DOC REFERENCE', locked: false, field: t => t.supplier_doc_ref || '' },
  { key: 'truck_plate',        label: 'TRUCK PLATE',            locked: true,  field: t => t.truck_plate },
  { key: 'truck',              label: 'TRUCK',                  locked: false, field: t => t.truck || '' },
  { key: 'commodity_type',     label: 'COMMODITY TYPE',         locked: false, field: t => t.commodity || '' },
  { key: 'island_zone_from',   label: 'ISLAND ZONE (FROM)',     locked: false, field: t => t.island_zone || '' },
  { key: 'island_origin_code', label: 'ISLAND ORIGIN CODE',     locked: false, field: t => (t.island_origin_code||'').toUpperCase() },
  { key: 'island_zone_to',     label: 'ISLAND ZONE (TO)',       locked: false, field: t => t.island_zone_to || '' },
  { key: 'island_dest_code',   label: 'ISLAND DEST. CODE MIN',  locked: false, field: t => (t.island_dest_code||'').toUpperCase() },
  { key: 'qty_dest',           label: 'QTY DESTINATION',        locked: false, field: t => calcQtyDest ? calcQtyDest(t.weight_tons) : '' },
  { key: 'dest_weight',        label: 'DEST. WEIGHT IN TONS',   locked: false, field: t => Number(t.weight_tons||0).toFixed(3) },
  { key: 'rate',               label: 'RATE',                   locked: false, field: t => fmt(t.rate_per_ton) },
  { key: 'rmsd',               label: 'RMSD/SMFI SAF DR',       locked: false, field: t => t.rmsd_smfi_saf_dr || '' },
  { key: 'sto_no',             label: 'STO NO',                 locked: false, field: t => t.sto_no || '' },
  { key: 'svc_po',             label: 'SVC PO SUPPLIER AMOUNT', locked: false, field: t => fmt(t.svc_po_supplier_amount||0) },
  { key: 'total_amount',       label: 'TOTAL AMOUNT',           locked: true,  field: t => fmt((t.weight_tons||0)*(t.rate_per_ton||0)) },
]

const FONT_SIZES = { small: '7px', medium: '8.5px', large: '10px' }
const DENSITIES = { compact: '1px 2px', normal: '2px 4px', wide: '4px 8px' }

const DEFAULT_TEMPLATE = {
  name: 'Default',
  doc_type: 'soa_dump',
  font_size: 'medium',
  density: 'normal',
  columns: DUMP_COLUMNS.map((c, i) => ({ key: c.key, label: c.label, visible: true, order: i }))
}

export default function PrintLayouts() {
  const { isSuperuser, profile } = useAuth()
  const { toast, showToast } = useToast()
  const [templates, setTemplates] = useState([])
  const [confirmState, setConfirmState] = useState(null)
  const [selected, setSelected] = useState(null)
  const [previewTrips, setPreviewTrips] = useState([])
  const [previewInvoice, setPreviewInvoice] = useState(null)
  const [previewSettings, setPreviewSettings] = useState({})
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')

  const fetchAll = useCallback(async () => {
    const [tmpl, trip, inv, sett] = await Promise.all([
      supabase.from('print_templates').select('*').eq('doc_type', 'soa_dump').order('created_at'),
      supabase.from('trips_dump').select('*').is('deleted_at', null).order('trip_date', { ascending: false }).limit(5),
      supabase.from('invoices').select('*').is('deleted_at', null).eq('truck_type', 'Dump Truck').order('invoice_date', { ascending: false }).limit(1),
      supabase.from('company_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    if (tmpl.data) setTemplates(tmpl.data)
    if (sett.data) setPreviewSettings(sett.data)
    if (inv.data?.[0] && trip.data) {
      const inv0 = inv.data[0]
      setPreviewInvoice(inv0)
      const invTrips = trip.data.filter(t => t.invoice_id === inv0.id)
      setPreviewTrips(invTrips.length > 0 ? invTrips : trip.data.slice(0, 3))
    } else if (trip.data) {
      setPreviewTrips(trip.data.slice(0, 3))
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const startNew = () => {
    setSelected({
      ...DEFAULT_TEMPLATE,
      id: undefined,
      name: newName || 'New Template',
      columns: DUMP_COLUMNS.map((c, i) => ({ key: c.key, label: c.label, visible: true, order: i }))
    })
    setNewName('')
  }

  const loadTemplate = (tmpl) => {
    const savedCols = tmpl.columns || []
    const merged = DUMP_COLUMNS.map((c, i) => {
      const saved = savedCols.find(s => s.key === c.key)
      return saved || { key: c.key, label: c.label, visible: true, order: i }
    }).sort((a, b) => a.order - b.order)
    setSelected({ ...tmpl, columns: merged })
  }

  const updateCol = (key, field, value) => {
    setSelected(s => ({
      ...s,
      columns: s.columns.map(c => c.key === key ? { ...c, [field]: value } : c)
    }))
  }

  const moveCol = (key, dir) => {
    setSelected(s => {
      const cols = [...s.columns].sort((a, b) => a.order - b.order)
      const idx = cols.findIndex(c => c.key === key)
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= cols.length) return s
      const tmp = cols[idx].order
      cols[idx] = { ...cols[idx], order: cols[swapIdx].order }
      cols[swapIdx] = { ...cols[swapIdx], order: tmp }
      return { ...s, columns: cols }
    })
  }

  const saveTemplate = async () => {
    if (!selected?.name) { showToast('Template name required.', 'error'); return }
    setSaving(true)
    const payload = {
      name: selected.name,
      doc_type: 'soa_dump',
      columns: selected.columns,
      font_size: selected.font_size,
      density: selected.density,
      updated_at: new Date().toISOString(),
    }
    if (selected.id && typeof selected.id === 'string') {
      const { error: updErr } = await supabase.from('print_templates').update(payload).eq('id', selected.id)
      if (updErr) { showToast('Error: ' + updErr.message, 'error'); setSaving(false); return }
    } else {
      const { data, error: insErr } = await supabase.from('print_templates').insert({ ...payload, created_by: profile?.id }).select().maybeSingle()
      if (insErr) { showToast('Error: ' + insErr.message, 'error'); setSaving(false); return }
      if (data) setSelected(s => ({ ...s, id: data.id }))
    }
    showToast('Template saved.')
    await fetchAll()
    setSaving(false)
  }

  const setDefault = async (id) => {
    await supabase.from('print_templates').update({ is_default: false }).eq('doc_type', 'soa_dump')
    await supabase.from('print_templates').update({ is_default: true }).eq('id', id)
    showToast('Default template set.')
    fetchAll()
  }

  const deleteTemplate = (id) => {
    setConfirmState({
      title: 'Delete Template',
      variant: 'danger',
      confirmLabel: 'Delete',
      message: 'Delete this template? This cannot be undone.',
      onConfirm: async () => {
        await supabase.from('print_templates').delete().eq('id', id)
        if (selected?.id === id) setSelected(null)
        fetchAll()
        showToast('Deleted.', 'info')
      },
    })
  }

  if (!isSuperuser) return <div className="page"><div className="empty-state"><p>Superuser access only.</p></div></div>

  const sortedCols = selected ? [...selected.columns].sort((a, b) => a.order - b.order) : []
  const visibleCols = sortedCols.filter(c => c.visible)
  const fs = FONT_SIZES[selected?.font_size || 'medium']
  const pad = DENSITIES[selected?.density || 'normal']
  const thStyle = { background: '#000', color: '#fff', padding: pad, fontSize: fs, border: '0.5px solid #000', textAlign: 'center', whiteSpace: 'nowrap' }
  const tdStyle = { padding: pad, border: '0.5px solid #aaa', fontSize: fs, textAlign: 'center' }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">🖨️ Print Layout Builder</h1>
          <p className="page-sub">SOA Dump Truck — superuser only — does not affect current printing</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>

        {/* ── LEFT ── */}
        <div style={{ position: 'sticky', top: 16 }}>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Templates</div>
            {templates.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>No templates yet.</div>}
            {templates.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, background: selected?.id === t.id ? 'var(--accent-light)' : 'transparent', marginBottom: 4, cursor: 'pointer' }}
                onClick={() => loadTemplate(t)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                  {t.is_default && <span style={{ fontSize: 10, color: 'var(--accent)' }}>● Default</span>}
                </div>
                <button className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setDefault(t.id) }} title="Set as default" style={{ fontSize: 10, padding: '2px 6px' }}>★</button>
                <button className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); deleteTemplate(t.id) }} style={{ fontSize: 10, padding: '2px 6px', color: 'var(--danger)' }}>✕</button>
              </div>
            ))}
            <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Template name…" style={{ flex: 1, fontSize: 12 }} />
              <button className="btn-primary btn-sm" onClick={startNew}>+ New</button>
            </div>
          </div>

          {selected && (
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Settings</div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="label">Template Name</label>
                <input value={selected.name} onChange={e => setSelected(s => ({ ...s, name: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="label">Font Size</label>
                <select value={selected.font_size} onChange={e => setSelected(s => ({ ...s, font_size: e.target.value }))}>
                  <option value="small">Small (7px)</option>
                  <option value="medium">Medium (8.5px)</option>
                  <option value="large">Large (10px)</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="label">Density</label>
                <select value={selected.density} onChange={e => setSelected(s => ({ ...s, density: e.target.value }))}>
                  <option value="compact">Compact</option>
                  <option value="normal">Normal</option>
                  <option value="wide">Wide</option>
                </select>
              </div>
              <button className="btn-primary" style={{ width: '100%', marginTop: 6 }} onClick={saveTemplate} disabled={saving}>
                {saving ? 'Saving…' : '💾 Save Template'}
              </button>
            </div>
          )}
        </div>

        {/* ── RIGHT ── */}
        <div>
          {!selected ? (
            <div className="empty-state"><p>Select a template or create a new one.</p></div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Columns — ↑↓ reorder, toggle visibility, rename label</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sortedCols.map((col, idx) => {
                    const def = DUMP_COLUMNS.find(c => c.key === col.key)
                    const isLocked = def?.locked
                    return (
                      <div key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: col.visible ? 'var(--surface)' : 'var(--bg)', borderRadius: 6, border: '0.5px solid var(--border)', opacity: col.visible ? 1 : 0.5 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <button onClick={() => moveCol(col.key, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '0 2px', color: 'var(--muted)', lineHeight: 1 }}>▲</button>
                          <button onClick={() => moveCol(col.key, 1)} disabled={idx === sortedCols.length - 1} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '0 2px', color: 'var(--muted)', lineHeight: 1 }}>▼</button>
                        </div>
                        <input type="checkbox" checked={col.visible} disabled={isLocked}
                          onChange={e => updateCol(col.key, 'visible', e.target.checked)}
                          style={{ width: 'auto' }} title={isLocked ? 'Required column' : ''} />
                        <input value={col.label} onChange={e => updateCol(col.key, 'label', e.target.value.toUpperCase())}
                          style={{ flex: 1, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 500 }} />
                        {isLocked && <span style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>🔒 required</span>}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card">
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                  Live Preview — {previewTrips.length} trips · {selected.font_size} · {selected.density}
                  {previewInvoice && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>Invoice #{previewInvoice.invoice_no}</span>}
                </div>
                <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8, background: '#fff' }}>
                  <div style={{ textAlign: 'center', marginBottom: 6, fontFamily: 'Arial', fontSize: fs }}>
                    <div style={{ fontWeight: 'bold', fontSize: '11px', textTransform: 'uppercase' }}>
                      {(previewSettings.company_name || 'DRAGON SPEED TRUCKING CORPORATION').toUpperCase()}
                    </div>
                    {previewSettings.vat_tin && <div style={{ fontSize: '7px' }}>VAT REG.TIN: {previewSettings.vat_tin}</div>}
                    {previewSettings.address && <div style={{ fontSize: '7px' }}>ADDRESS: {previewSettings.address.toUpperCase()}</div>}
                    <div style={{ fontWeight: 'bold', marginTop: 4, fontSize: '9px', textDecoration: 'underline' }}>STATEMENT OF ACCOUNTS</div>
                  </div>
                  {previewInvoice && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontFamily: 'Arial', fontSize: fs }}>
                      <div style={{ fontWeight: 'bold' }}>{previewInvoice.client?.toUpperCase()}</div>
                      <div style={{ fontWeight: 'bold' }}>SALES INV #: {previewInvoice.invoice_no}</div>
                    </div>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Arial', tableLayout: 'auto' }}>
                    <thead>
                      <tr>{visibleCols.map(col => <th key={col.key} style={thStyle}>{col.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {previewTrips.length === 0
                        ? <tr><td colSpan={visibleCols.length} style={{ ...tdStyle, color: '#999' }}>No trip data available</td></tr>
                        : previewTrips.map((t, i) => (
                          <tr key={t.id} style={{ background: i % 2 === 0 ? '#fff' : '#f5f5f5' }}>
                            {visibleCols.map(col => {
                              const def = DUMP_COLUMNS.find(c => c.key === col.key)
                              return <td key={col.key} style={{ ...tdStyle, fontWeight: col.key === 'truck_plate' || col.key === 'total_amount' ? 'bold' : 'normal' }}>{def ? def.field(t) : ''}</td>
                            })}
                          </tr>
                        ))
                      }
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f5f5f5' }}>
                        {visibleCols.map((col, i) => {
                          if (col.key === 'total_amount') return <td key={col.key} style={{ ...tdStyle, fontWeight: 'bold' }}>{fmt(previewTrips.reduce((s,t)=>s+(t.weight_tons||0)*(t.rate_per_ton||0),0))}</td>
                          if (col.key === 'dest_weight') return <td key={col.key} style={{ ...tdStyle, fontWeight: 'bold' }}>{previewTrips.reduce((s,t)=>s+parseFloat(t.weight_tons||0),0).toFixed(3)}</td>
                          if (i === visibleCols.length - 2) return <td key={col.key} style={{ ...tdStyle, fontWeight: 'bold', textAlign: 'right' }}>TOTAL</td>
                          return <td key={col.key} style={tdStyle}></td>
                        })}
                      </tr>
                    </tfoot>
                  </table>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, fontFamily: 'Arial', fontSize: fs }}>
                    <table style={{ borderCollapse: 'collapse' }}>
                      <tbody>
                        {(() => {
                          const net = previewTrips.reduce((s,t)=>s+(t.weight_tons||0)*(t.rate_per_ton||0),0)
                          return <>
                            <tr><td style={{ padding: '1px 6px', textAlign: 'right', fontWeight: 'bold', borderBottom: '0.5px solid #000' }}>GRAND TOTAL</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', borderBottom: '0.5px solid #000', minWidth: 80 }}>{fmt(net)}</td></tr>
                            <tr><td style={{ padding: '1px 6px', textAlign: 'right' }}>VAT 12%</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(net*0.12)}</td></tr>
                            <tr><td style={{ padding: '1px 6px', textAlign: 'right' }}>VAT N</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(net*1.12)}</td></tr>
                          </>
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <Toast toast={toast} />
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}
