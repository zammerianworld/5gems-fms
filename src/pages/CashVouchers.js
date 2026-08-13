import { useState, useEffect, useCallback } from 'react'
import DateInput from '../components/DateInput'
import { supabase, fmt, fmtDate, numberToWords } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'
import jsPDF from 'jspdf'
import SignatoryDialog from '../components/SignatoryDialog'

const EMPTY = { voucher_date: new Date().toISOString().slice(0,10), voucher_no: '', payee: '', amount: '', purpose: '', received_by: '', remarks: '', status: 'Pending' }
const STATUS_COLORS = { Pending: { bg: '#FEF9C3', color: '#92400E' }, Approved: { bg: 'rgba(22,163,74,0.1)', color: '#15803d' }, Cancelled: { bg: 'rgba(220,38,38,0.1)', color: '#dc2626' } }

export default function CashVouchers() {
  const { isAdmin, profile } = useAuth()
  const { toast, showToast } = useToast()
  const [vouchers, setVouchers] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [sigDialog, setSigDialog] = useState(false)
  const [sigPrintVoucher, setSigPrintVoucher] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [filterMonth, setFilterMonth] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [vc, st] = await Promise.all([
      supabase.from('cash_vouchers').select('*').order('voucher_date', { ascending: false }),
      supabase.from('company_settings').select('*').eq('id',1).maybeSingle(),
    ])
    if (vc.data) setVouchers(vc.data)
    if (st.data) setSettings(st.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = vouchers.filter(v => {
    if (filterMonth && !v.voucher_date?.startsWith(filterMonth)) return false
    if (filterStatus && v.status !== filterStatus) return false
    if (search && ![v.voucher_no, v.payee, v.purpose].some(x => x?.toLowerCase().includes(search.toLowerCase()))) return false
    return true
  })

  const totalAmount = filtered.reduce((s,v) => s+(parseFloat(v.amount)||0), 0)

  const handleSave = async () => {
    if (!form.voucher_date || !form.payee || !form.amount || parseFloat(form.amount) <= 0) {
      showToast('Date, payee and amount are required.', 'error'); return
    }
    setSaving(true)
    const payload = { ...form, amount: parseFloat(form.amount) }
    let error
    if (editId) ({ error } = await supabase.from('cash_vouchers').update(payload).eq('id', editId))
    else ({ error } = await supabase.from('cash_vouchers').insert(payload))
    if (error) showToast('Error: '+error.message, 'error')
    else { showToast(editId?'Updated.':'Saved.'); setForm(EMPTY); setEditId(null); setShowForm(false); fetchAll() }
    setSaving(false)
  }

  const handleDelete = async () => {
    const { data: _del, error: delErr } = await supabase.rpc('permanent_delete', { p_table: 'cash_vouchers', p_id: deleteTarget })
    if (delErr) { showToast('Error: ' + delErr.message, 'error'); return }
    setDeleteTarget(null); showToast('Deleted.','info'); fetchAll()
  }

  const handlePrint = (v) => { setSigPrintVoucher(v); setSigDialog(true) }
  const doPrint = (sigs) => {
    setSigDialog(false)
    const v = sigPrintVoucher
    if (!v) return
    const doc = new jsPDF({ unit: 'mm', format: 'letter' })
    const W = 215.9
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()

    // Header
    doc.setFontSize(13); doc.setFont('helvetica','bold')
    doc.text(companyName, W/2, 18, { align: 'center' })
    doc.setFontSize(8); doc.setFont('helvetica','normal')
    if (settings.vat_tin) doc.text(`VAT REG.TIN: ${settings.vat_tin}`, W/2, 23, { align: 'center' })
    if (settings.address) doc.text(`ADDRESS: ${settings.address.toUpperCase()}`, W/2, 27, { align: 'center' })
    if (settings.contact) doc.text(`${settings.contact}${settings.email?' / '+settings.email:''}`, W/2, 31, { align: 'center' })

    // Title box
    doc.setFillColor(255,30,0)
    doc.rect(14, 36, W-28, 10, 'F')
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255)
    doc.text('CASH VOUCHER', W/2, 43, { align: 'center' })
    doc.setTextColor(0)

    // Voucher details box
    doc.setDrawColor(200); doc.setLineWidth(0.3)
    doc.rect(14, 50, W-28, 60)
    doc.setFontSize(9); doc.setFont('helvetica','normal')
    const drawRow = (label, value, y) => {
      doc.setFont('helvetica','bold'); doc.text(label, 18, y)
      doc.setFont('helvetica','normal'); doc.text(String(value||''), 60, y)
      doc.setDrawColor(230); doc.line(14, y+2, W-14, y+2)
    }
    drawRow('VOUCHER NO.:', v.voucher_no, 58)
    drawRow('DATE:', fmtDate(v.voucher_date), 66)
    drawRow('PAYEE:', v.payee, 74)
    drawRow('AMOUNT:', `PHP ${Number(v.amount||0).toLocaleString('en-PH',{minimumFractionDigits:2})}`, 82)
    drawRow('PURPOSE:', v.purpose, 90)
    drawRow('REMARKS:', v.remarks||'—', 98)
    drawRow('STATUS:', v.status, 106)

    // Amount in words
    doc.setFontSize(8); doc.setFont('helvetica','italic')
    const words = numberToWords(v.amount||0)
    doc.text(`Amount in Words: ${words}`, 18, 118)

    // Received By — payee signs to acknowledge receipt of cash
    const recvY = 138
    doc.setDrawColor(0); doc.setLineWidth(0.2)
    doc.line(18, recvY, 100, recvY)
    const recvName = (v.received_by || v.payee || '').toUpperCase()
    if (recvName) {
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(0)
      doc.text(recvName, 59, recvY - 2, { align: 'center' })
    }
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(120)
    doc.text('Received By (Signature over Printed Name)', 59, recvY + 5, { align: 'center' })
    doc.setTextColor(0)

    // Signatories handled by SignatoryDialog


    if (sigs && sigs.length > 0) {
      const sigY = 165
      sigs.forEach((s, i) => {
        const x = i === 0 ? 30 : i === sigs.length-1 ? 185 : 110
        const align = i === 0 ? 'left' : i === sigs.length-1 ? 'right' : 'center'
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(120)
        doc.text(s.label + ':', x, sigY, { align })
        doc.setDrawColor(100)
        if (align==='left') doc.line(x, sigY+18, x+70, sigY+18)
        else if (align==='right') doc.line(x-70, sigY+18, x, sigY+18)
        else doc.line(x-35, sigY+18, x+35, sigY+18)
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(0)
        doc.text(s.name.toUpperCase(), x, sigY+23, { align })
        doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(255,30,0)
        doc.text(s.title||'', x, sigY+27, { align })
        doc.setTextColor(0)
      })
    }
    doc.save(`CashVoucher-${v.voucher_no}.pdf`)
    showToast('PDF saved.')
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Cash Vouchers</h1><p className="page-sub">System-generated cash voucher records</p></div>
        {isAdmin && <button className="btn-primary" onClick={() => { setShowForm(!showForm); setEditId(null); setForm(EMPTY) }}>{showForm?'✕ Cancel':'+ New Voucher'}</button>}
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label">Total {filterMonth}</div><div className="stat-value sm">₱{fmt(totalAmount)}</div><div style={{ fontSize:11,color:'var(--muted)',marginTop:2 }}>{filtered.length} vouchers</div></div>
        <div className="stat-card"><div className="stat-label">Pending</div><div className="stat-value sm" style={{ color:'#92400E' }}>{filtered.filter(v=>v.status==='Pending').length}</div></div>
        <div className="stat-card"><div className="stat-label">Approved</div><div className="stat-value sm" style={{ color:'var(--success)' }}>{filtered.filter(v=>v.status==='Approved').length}</div></div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize:14, fontWeight:500, marginBottom:14 }}>{editId?'Edit Voucher':'New Cash Voucher'}</h3>
          <div className="form-grid">
            <div className="form-group"><label className="label required">Date</label><DateInput value={form.voucher_date} max={new Date().toISOString().slice(0,10)} onChange={e=>setForm(f=>({...f,voucher_date:e.target.value}))} /></div>
            <div className="form-group"><label className="label required">Voucher No.</label><input value={form.voucher_no} onChange={e=>setForm(f=>({...f,voucher_no:e.target.value}))} placeholder="CV-2024-001" /></div>
            <div className="form-group"><label className="label required">Payee</label><input value={form.payee} onChange={e=>setForm(f=>({...f,payee:e.target.value}))} placeholder="Name of payee" /></div>
            <div className="form-group"><label className="label required">Amount (₱)</label><input type="number" step="0.01" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" /></div>
            <div className="form-group"><label className="label">Purpose</label><input value={form.purpose} onChange={e=>setForm(f=>({...f,purpose:e.target.value}))} placeholder="Purpose of payment" /></div>
            <div className="form-group"><label className="label">Received By</label><input value={form.received_by} onChange={e=>setForm(f=>({...f,received_by:e.target.value}))} placeholder="Name of recipient" /></div>
            <div className="form-group"><label className="label">Status</label>
              <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                {['Pending','Approved','Cancelled'].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="label">Remarks</label><input value={form.remarks} onChange={e=>setForm(f=>({...f,remarks:e.target.value}))} placeholder="Optional" /></div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:14 }}>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY) }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':'Save'}</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar" style={{ marginBottom:12 }}>
        <input placeholder="Search voucher, payee…" value={search} onChange={e=>setSearch(e.target.value)} style={{ flex:2, minWidth:120 }} />
        <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{ width:'auto' }} />
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{ width:'auto' }}>
          <option value="">All status</option>
          {['Pending','Approved','Cancelled'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        {(search||filterStatus) && <button className="btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterStatus('')}}>Clear</button>}
      </div>

      {/* Table */}
      {loading ? <div className="empty-state"><p>Loading…</p></div> :
        filtered.length === 0 ? <div className="empty-state"><p>No cash vouchers found.</p></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th>Voucher No.</th><th>Date</th><th>Payee</th><th>Purpose</th><th>Received By</th><th>Status</th><th className="text-right">Amount (₱)</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.map(v => {
                const sc = STATUS_COLORS[v.status] || STATUS_COLORS.Pending
                return (
                  <tr key={v.id}>
                    <td style={{ fontFamily:'var(--mono)', fontWeight:600 }}>{v.voucher_no}</td>
                    <td style={{ fontSize:12 }}>{fmtDate(v.voucher_date)}</td>
                    <td style={{ fontWeight:500 }}>{v.payee}</td>
                    <td style={{ fontSize:12, color:'var(--muted)' }}>{v.purpose||'—'}</td>
                    <td style={{ fontSize:12 }}>{v.received_by||'—'}</td>
                    <td><span style={{ padding:'2px 8px', borderRadius:6, fontSize:11, background:sc.bg, color:sc.color, fontWeight:500 }}>{v.status}</span></td>
                    <td className="text-right mono" style={{ fontWeight:600 }}>₱{fmt(v.amount)}</td>
                    <td>
                      <div style={{ display:'flex', gap:4 }}>
                        <button className="btn-ghost btn-sm" onClick={()=>handlePrint(v)} title="Print">🖨️</button>
                        {isAdmin && <>
                          <button className="btn-ghost btn-sm" onClick={()=>{setEditId(v.id);setForm({...v});setShowForm(true)}}>Edit</button>
                          <button className="btn-danger btn-sm" onClick={()=>setDeleteTarget(v.id)}>Del</button>
                        </>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr>
              <td colSpan={6} style={{ padding:'8px 14px', fontWeight:600, borderTop:'1px solid var(--border-md)' }}>TOTAL ({filtered.length})</td>
              <td className="text-right mono" style={{ fontWeight:600, padding:'8px 14px', borderTop:'1px solid var(--border-md)' }}>₱{fmt(totalAmount)}</td>
              <td style={{ borderTop:'1px solid var(--border-md)' }}></td>
            </tr></tfoot>
          </table>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={()=>setDeleteTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Delete this voucher?</h3><p>This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>setDeleteTarget(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <SignatoryDialog open={sigDialog} onClose={()=>setSigDialog(false)} onPrint={doPrint} settings={settings} profile={profile} docType="Cash Voucher" />
      <Toast toast={toast} />
    </div>
  )
}