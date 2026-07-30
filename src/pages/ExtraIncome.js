import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fmtDate, logAudit } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'

const EMPTY = { income_date: new Date().toISOString().slice(0,10), amount: '', source_type: 'Side Trip', truck_id: '', description: '', payment_method: 'cash', notes: '' }
const SOURCE_TYPES = ['Side Trip', 'Sale of Asset', 'Rental', 'Other']

export default function ExtraIncome() {
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()
  const [income, setIncome] = useState([])
  const [trucks, setTrucks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [filterMonth, setFilterMonth] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [sortKey, setSortKey] = useState('income_date')
  const [sortDir, setSortDir] = useState('desc')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [inc, tr] = await Promise.all([
      supabase.from('extra_income').select('*').order('income_date', { ascending: false }),
      supabase.from('trucks').select('id,plate,truck_type,ownership').eq('ownership','company').order('plate'),
    ])
    if (inc.data) setIncome(inc.data)
    if (tr.data) setTrucks(tr.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = income.filter(i => {
    if (filterMonth && !i.income_date?.startsWith(filterMonth)) return false
    if (filterSource && i.source_type !== filterSource) return false
    return true
  }).sort((a,b) => {
    let av = a[sortKey]||'', bv = b[sortKey]||''
    const an = parseFloat(av), bn = parseFloat(bv)
    if (!isNaN(an)&&!isNaN(bn)) return sortDir==='asc'?an-bn:bn-an
    if (typeof av==='string') av=av.toLowerCase(); if (typeof bv==='string') bv=bv.toLowerCase()
    return sortDir==='asc'?(av<bv?-1:av>bv?1:0):(av<bv?1:av>bv?-1:0)
  })

  const totalAmount = filtered.reduce((s,i) => s+(parseFloat(i.amount)||0), 0)
  const getTruckName = (id) => trucks.find(t=>t.id===id)?.plate || '—'

  const handleSave = async () => {
    if (!form.income_date || !form.amount || parseFloat(form.amount) <= 0) {
      showToast('Date and amount are required.', 'error'); return
    }
    setSaving(true)
    const payload = { ...form, amount: parseFloat(form.amount), truck_id: form.truck_id||null }
    let error
    if (editId) ({ error } = await supabase.from('extra_income').update(payload).eq('id', editId))
    else ({ error } = await supabase.from('extra_income').insert(payload))
    if (error) showToast('Error: '+error.message, 'error')
    else { logAudit(editId?'destructive':'generate', editId?'Updated':'Added', 'Extra Income', `${editId?'Updated':'Added'} extra income ₱${form.amount}`, editId||'', profile?.id, profile?.full_name); showToast(editId?'Updated.':'Saved.'); setForm(EMPTY); setEditId(null); setShowForm(false); fetchAll() }
    setSaving(false)
  }

  const handleDelete = async () => {
    const { data: _del, error: delErr } = await supabase.rpc('permanent_delete', { p_table: 'extra_income', p_id: deleteTarget })
    if (delErr) { showToast('Error: ' + delErr.message, 'error'); return }
    logAudit('destructive', 'Deleted', 'Extra Income', `Deleted extra income`, deleteTarget||'', profile?.id, profile?.full_name); setDeleteTarget(null); showToast('Deleted.','info'); fetchAll()
  }

  const toggleSort = (k) => { setSortKey(k); setSortDir(d => k===sortKey?(d==='asc'?'desc':'asc'):'desc') }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Extra Income</h1><p className="page-sub">Side trips, asset sales, and other non-operating income</p></div>
        {isAdmin && <button className="btn-primary" onClick={() => { setShowForm(!showForm); setEditId(null); setForm(EMPTY) }}>{showForm ? '✕ Cancel' : '+ Add Income'}</button>}
      </div>

      {/* Summary cards */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Total {filterMonth||'All Time'}</div>
          <div className="stat-value sm" style={{ color: 'var(--success)' }}>₱{fmt(totalAmount)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{filtered.length} entries</div>
        </div>
        {SOURCE_TYPES.map(src => {
          const amt = filtered.filter(i=>i.source_type===src).reduce((s,i)=>s+(parseFloat(i.amount)||0),0)
          return amt > 0 ? (
            <div key={src} className="stat-card">
              <div className="stat-label">{src}</div>
              <div className="stat-value sm">₱{fmt(amt)}</div>
            </div>
          ) : null
        })}
      </div>

      {/* Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>{editId ? 'Edit Income' : 'New Extra Income'}</h3>
          <div className="form-grid">
            <div className="form-group">
              <label className="label required">Date</label>
              <input type="date" value={form.income_date} max={new Date().toISOString().slice(0,10)} onChange={e => setForm(f=>({...f,income_date:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label required">Source Type</label>
              <select value={form.source_type} onChange={e => setForm(f=>({...f,source_type:e.target.value}))}>
                {SOURCE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label required">Amount (₱)</label>
              <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label className="label">Truck <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional — adds to truck monthly sales)</span></label>
              <select value={form.truck_id} onChange={e => setForm(f=>({...f,truck_id:e.target.value}))}>
                <option value="">No specific truck</option>
                {trucks.map(t => <option key={t.id} value={t.id}>{t.plate} ({t.truck_type})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Description</label>
              <input value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Side trip to Cotabato, sold old unit..." />
            </div>
            <div className="form-group">
              <label className="label">Payment Method</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['cash','💵 Cash'],['check','🖊️ Check'],['transfer','🏦 Transfer']].map(([val,lbl]) => (
                  <button type="button" key={val} onClick={() => setForm(f=>({...f,payment_method:val}))}
                    style={{ flex:1, padding:'7px 4px', borderRadius:8, border:`1.5px solid ${form.payment_method===val?'var(--accent)':'var(--border)'}`, background:form.payment_method===val?'var(--accent-light)':'var(--surface)', color:form.payment_method===val?'var(--accent)':'var(--muted)', fontWeight:form.payment_method===val?600:400, cursor:'pointer', fontSize:12 }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="label">Notes</label>
              <input value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY) }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar" style={{ marginBottom: 12 }}>
        <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ width: 'auto' }} />
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All sources</option>
          {SOURCE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(filterMonth || filterSource) && <button className="btn-ghost btn-sm" onClick={() => { setFilterMonth(''); setFilterSource('') }}>Clear</button>}
      </div>

      {/* Table */}
      {loading ? <div className="empty-state"><p>Loading…</p></div> :
        filtered.length === 0 ? <div className="empty-state"><p>No extra income entries found.</p></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              {[['income_date','Date'],['source_type','Source'],['truck_id','Truck'],['description','Description'],['payment_method','Method'],['amount','Amount (₱)']].map(([k,l]) => (
                <th key={k} onClick={() => toggleSort(k)} style={{ cursor:'pointer', userSelect:'none' }}>{l} {sortKey===k?(sortDir==='asc'?'▲':'▼'):''}</th>
              ))}
              <th></th>
            </tr></thead>
            <tbody>
              {filtered.map(i => (
                <tr key={i.id}>
                  <td className="mono" style={{ fontSize:12 }}>{fmtDate(i.income_date)}</td>
                  <td><span style={{ padding:'2px 8px', borderRadius:6, fontSize:11, background:'rgba(22,163,74,0.1)', color:'var(--success)', fontWeight:500 }}>{i.source_type}</span></td>
                  <td style={{ fontSize:12, fontFamily:'var(--mono)' }}>{i.truck_id ? getTruckName(i.truck_id) : <span style={{ color:'var(--muted)' }}>Fleet</span>}</td>
                  <td style={{ fontSize:12 }}>{i.description||'—'}</td>
                  <td style={{ fontSize:11 }}>
                    <span style={{ padding:'1px 6px', borderRadius:4, background:i.payment_method==='cash'?'rgba(59,130,246,0.1)':i.payment_method==='check'?'rgba(100,100,100,0.1)':'rgba(22,163,74,0.1)', color:i.payment_method==='cash'?'#3B82F6':i.payment_method==='check'?'var(--muted)':'var(--success)' }}>
                      {i.payment_method==='cash'?'💵 Cash':i.payment_method==='check'?'🖊️ Check':'🏦 Transfer'}
                    </span>
                  </td>
                  <td className="text-right mono" style={{ fontWeight:600, color:'var(--success)' }}>₱{fmt(i.amount)}</td>
                  <td>
                    {isAdmin && <div style={{ display:'flex', gap:4 }}>
                      <button className="btn-ghost btn-sm" onClick={() => { setEditId(i.id); setForm({...i,truck_id:i.truck_id||''}); setShowForm(true) }}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={() => setDeleteTarget(i.id)}>Del</button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={5} style={{ padding:'8px 14px', fontWeight:600, borderTop:'1px solid var(--border-md)' }}>TOTAL ({filtered.length})</td>
              <td className="text-right mono" style={{ fontWeight:600, color:'var(--success)', padding:'8px 14px', borderTop:'1px solid var(--border-md)' }}>₱{fmt(totalAmount)}</td>
              <td style={{ borderTop:'1px solid var(--border-md)' }}></td>
            </tr></tfoot>
          </table>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Delete this income entry?</h3>
            <p>This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  )
}
