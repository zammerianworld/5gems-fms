import { useState, useEffect, useCallback } from 'react'
import DateInput from '../components/DateInput'
import { supabase, fmt, fmtDate, logAudit } from '../lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'

const today = () => new Date().toISOString().slice(0, 10)
const currentMonth = () => new Date().toISOString().slice(0, 7)

const EMPTY = {
  lender: '', description: '', total_payable: '', term_months: '',
  start_date: today(), monthly_payment: '', status: 'active', notes: ''
}

export default function Loans() {
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()
  const [activeTab, setActiveTab] = useState('loans') // 'loans' | 'lending'

  // ── COMPANY LENDING STATE ────────────────────────────────────────────────
  const [companyLoans, setCompanyLoans] = useState([])
  const [clLoading, setClLoading] = useState(false)
  const [showClForm, setShowClForm] = useState(false)
  const [editingClId, setEditingClId] = useState(null)
  const [clForm, setClForm] = useState({ borrower:'', borrower_type:'Employee', purpose:'', principal:'', interest_rate:'0', term_months:'', start_date:new Date().toISOString().slice(0,10), monthly_payment:'', notes:'' })
  const [expandedCl, setExpandedCl] = useState(null)
  const [loanSettings, setLoanSettings] = useState({})
  const [payments, setPayments] = useState({})
  const [showPayForm, setShowPayForm] = useState(null)
  const [payForm, setPayForm] = useState({ payment_date: new Date().toISOString().slice(0,10), amount:'', notes:'' })
  const [clFilterStatus, setClFilterStatus] = useState('Active')
  const [scheduleTab, setScheduleTab] = useState({})
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmModal, setConfirmModal] = useState(null)
  const [filterStatus, setFilterStatus] = useState('active')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('loans').select('*').order('start_date', { ascending: false })
    setLoans(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const fetchCompanyLoans = useCallback(async () => {
    setClLoading(true)
    const { data } = await supabase.from('company_loans').select('*').order('start_date', { ascending: false })
    setCompanyLoans(data || [])
    setClLoading(false)
  }, [])

  useEffect(() => {
    supabase.from('company_settings').select('company_name,address,contact,email,vat_tin').eq('id',1).maybeSingle().then(({data}) => { if(data) setLoanSettings(data) })
  }, [])
  useEffect(() => { if (activeTab === 'lending') fetchCompanyLoans() }, [activeTab, fetchCompanyLoans])

  const fetchPayments = async (loanId) => {
    const { data } = await supabase.from('company_loan_payments').select('*').eq('loan_id', loanId).order('payment_date')
    setPayments(p => ({ ...p, [loanId]: data || [] }))
  }

  const pf = (n) => 'P' + Number(n||0).toLocaleString('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 })

  const buildScheduleData = (loan, paidList, mode) => {
    const mInt = loan.principal * (loan.interest_rate / 100)
    const mPrin = loan.monthly_payment - mInt
    const startD = new Date(loan.start_date + 'T00:00:00')

    // Original schedule
    const origSched = []
    let op = loan.principal
    for (let i = 0; i < loan.term_months; i++) {
      const d = new Date(startD); d.setMonth(d.getMonth() + i + 1)
      const isLast = i === loan.term_months - 1
      const prinPmt = isLast ? op : Math.min(mPrin, op)
      const amort = isLast ? prinPmt + mInt : loan.monthly_payment
      op = Math.max(0, op - prinPmt)
      origSched.push({ month: i+1, date: d, amort, interest: mInt, principal: prinPmt, outstanding: op, actual: paidList[i]||null })
    }

    if (mode === 'original') return origSched

    // Revised — eat excess from tail
    let totalPaid = paidList.reduce((s,p)=>s+(p.amount||0),0)
    let totalSched = paidList.length * loan.monthly_payment
    let excessLeft = Math.max(0, totalPaid - totalSched)
    let rev = origSched.map(r=>({...r}))
    for (let i = rev.length-1; i >= 0 && excessLeft > 0; i--) {
      if (excessLeft >= rev[i].amort) { excessLeft -= rev[i].amort; rev[i].eliminated = true }
      else { rev[i].amort -= excessLeft; rev[i].principal = Math.max(0, rev[i].amort - rev[i].interest); excessLeft = 0 }
    }
    let revised = rev.filter(r=>!r.eliminated)
    let runOut = loan.principal
    return revised.map((r,i) => { runOut = Math.max(0,runOut-r.principal); return {...r, outstanding:runOut, actual:paidList[i]||null} })
  }

  const handlePrintSchedule = (loan, paidList, mode) => {
    const rows = buildScheduleData(loan, paidList, mode)
    const title = `${loan.borrower} — ${mode === 'original' ? 'Original' : 'Revised'} Amortization Schedule`
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'letter' })
    const W = 279.4
    doc.setFontSize(13); doc.setFont(undefined,'bold')
    doc.text((loanSettings.company_name||'DRAGON SPEED TRUCKING CORPORATION').toUpperCase(), W/2, 12, {align:'center'})
    doc.setFontSize(8); doc.setFont(undefined,'normal')
    if (loanSettings.vat_tin) doc.text(`VAT REG. TIN: ${loanSettings.vat_tin}`, W/2, 17, {align:'center'})
    if (loanSettings.address) doc.text(loanSettings.address, W/2, 21, {align:'center'})
    const contact = [loanSettings.contact, loanSettings.email].filter(Boolean).join(' / ')
    if (contact) doc.text(contact, W/2, 25, {align:'center'})
    doc.setFontSize(10); doc.setFont(undefined,'bold')
    doc.text('COMPANY LENDING — AMORTIZATION SCHEDULE', W/2, 30, {align:'center'})
    doc.setFontSize(9); doc.setFont(undefined,'normal')
    doc.text(title, W/2, 36, {align:'center'})
    doc.text(`Principal: ${pf(loan.principal)}  |  Rate: ${loan.interest_rate}%/mo  |  Term: ${loan.term_months} months  |  Monthly: ${pf(loan.monthly_payment)}`, W/2, 41, {align:'center'})
    doc.setDrawColor(200); doc.line(10, 44, W-10, 44)

    const head = mode === 'original'
      ? [['#','Sched. Date','Monthly Amort.','Interest','Principal Pmt','Outstanding','Amount Paid','Running Balance','As of']]
      : [['#','Date','Amort.','Interest','Principal','Outstanding','Status']]

    const body = mode === 'original'
      ? rows.map((r,i) => {
          let rb = loan.total_collectible - paidList.slice(0,i+1).reduce((s,p)=>s+(p?.amount||0),0)
          return [r.month, r.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}), pf(r.amort), pf(r.interest), pf(r.principal), pf(r.outstanding), r.actual?pf(r.actual.amount):'—', r.actual?pf(Math.max(0,rb)):'—', r.actual?fmtDate(r.actual.payment_date):'—']
        })
      : rows.map(r => [r.month, r.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}), pf(r.amort), pf(r.interest), pf(r.principal), pf(r.outstanding), r.actual?'Paid':r===rows[rows.length-1]?'Final':'Pending'])

    autoTable(doc, { startY:47, head, body, styles:{fontSize:8}, headStyles:{fillColor:[241,114,0]}, alternateRowStyles:{fillColor:[250,250,250]} })

    const finalY = doc.lastAutoTable.finalY + 4
    const totAmort = rows.reduce((s,r)=>s+r.amort,0)
    const totInt = rows.reduce((s,r)=>s+r.interest,0)
    doc.setFontSize(8)
    doc.text(`Total Amortization: ${pf(totAmort)}  |  Total Interest: ${pf(totInt)}  |  Principal: ${pf(loan.principal)}  |  Term: ${rows.length} months`, 10, finalY)

    doc.save(`${loan.borrower}-${mode}-schedule.pdf`)
    showToast('PDF saved.')
  }

  const handleExportScheduleExcel = (loan, paidList, mode) => {
    const rows = buildScheduleData(loan, paidList, mode)
    const title = `${loan.borrower} — ${mode === 'original' ? 'Original' : 'Revised'} Amortization Schedule`
    const headers = mode === 'original'
      ? ['#','Sched. Date','Monthly Amort.','Interest','Principal Pmt','Outstanding','Amount Paid','Running Balance','As of']
      : ['#','Date','Amort.','Interest','Principal','Outstanding','Status']
    const data = mode === 'original'
      ? rows.map((r,i) => {
          let rb = loan.total_collectible - paidList.slice(0,i+1).reduce((s,p)=>s+(p?.amount||0),0)
          return [r.month, r.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}), r.amort, r.interest, r.principal, r.outstanding, r.actual?(r.actual.amount):'', r.actual?Math.max(0,rb):'', r.actual?fmtDate(r.actual.payment_date):'']
        })
      : rows.map(r => [r.month, r.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}), r.amort, r.interest, r.principal, r.outstanding, r.actual?'Paid':r===rows[rows.length-1]?'Final':'Pending'])
    const ws = XLSX.utils.aoa_to_sheet([[title],[],headers,...data])
    ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:headers.length-1}}]
    ws['!cols'] = headers.map(()=>({wch:16}))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, mode === 'original' ? 'Original Schedule' : 'Revised Schedule')
    XLSX.writeFile(wb, `${loan.borrower}-${mode}-schedule.xlsx`)
    showToast('Excel exported.')
  }

  const handleExportBothExcel = (loan, paidList) => {
    const origRows = buildScheduleData(loan, paidList, 'original')
    const revRows = buildScheduleData(loan, paidList, 'revised')
    const makeSheet = (rows, mode) => {
      const headers = mode === 'original'
        ? ['#','Sched. Date','Monthly Amort.','Interest','Principal Pmt','Outstanding','Amount Paid','Running Balance','As of']
        : ['#','Date','Amort.','Interest','Principal','Outstanding','Status']
      const data = mode === 'original'
        ? rows.map((r,i) => { let rb = loan.total_collectible - paidList.slice(0,i+1).reduce((s,p)=>s+(p?.amount||0),0); return [r.month, r.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}), r.amort, r.interest, r.principal, r.outstanding, r.actual?(r.actual.amount):'', r.actual?Math.max(0,rb):'', r.actual?fmtDate(r.actual.payment_date):''] })
        : rows.map(r => [r.month, r.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}), r.amort, r.interest, r.principal, r.outstanding, r.actual?'Paid':r===rows[rows.length-1]?'Final':'Pending'])
      const ws = XLSX.utils.aoa_to_sheet([[`${loan.borrower} — ${mode==='original'?'Original':'Revised'} Schedule`],[],headers,...data])
      ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:headers.length-1}}]
      ws['!cols'] = headers.map(()=>({wch:16}))
      return ws
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, makeSheet(origRows,'original'), 'Original Schedule')
    XLSX.utils.book_append_sheet(wb, makeSheet(revRows,'revised'), 'Revised Schedule')
    XLSX.writeFile(wb, `${loan.borrower}-amortization.xlsx`)
    showToast('Excel exported — both sheets.')
  }

  const handleSaveCl = async () => {
    if (!clForm.borrower || !clForm.principal || !clForm.term_months || !clForm.monthly_payment) {
      showToast('Borrower, principal, term, and monthly payment are required.', 'error'); return
    }
    const principal = parseFloat(clForm.principal) || 0
    const rate = parseFloat(clForm.interest_rate) || 0
    const term = parseInt(clForm.term_months) || 1
    const monthly = parseFloat(clForm.monthly_payment) || 0
    const total = monthly * term
    const payload = { borrower: clForm.borrower.trim(), borrower_type: clForm.borrower_type, purpose: clForm.purpose, principal, interest_rate: rate, term_months: term, start_date: clForm.start_date, monthly_payment: monthly, total_collectible: total, notes: clForm.notes || null, status: 'Active' }
    const { error } = editingClId
      ? await supabase.from('company_loans').update(payload).eq('id', editingClId)
      : await supabase.from('company_loans').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      logAudit(editingClId?'destructive':'generate', editingClId?'Updated':'Added', 'Loans', `${editingClId?'Updated':'Added'} company loan to ${payload.borrower} ₱${fmt(principal)}`, editingClId||'', profile?.id, profile?.full_name)
      showToast(editingClId ? 'Updated.' : 'Loan added.')
      setShowClForm(false); setEditingClId(null)
      setClForm({ borrower:'', borrower_type:'Employee', purpose:'', principal:'', interest_rate:'0', term_months:'', start_date:new Date().toISOString().slice(0,10), monthly_payment:'', notes:'' })
      fetchCompanyLoans()
    }
  }

  const handleDeleteCl = async (id, borrower) => {
    const { error } = await supabase.from('company_loans').delete().eq('id', id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { logAudit('destructive', 'Deleted', 'Loans', `Deleted company loan to ${borrower}`, id, profile?.id, profile?.full_name); showToast('Deleted.', 'info'); fetchCompanyLoans() }
  }

  const handleSavePayment = async (loanId) => {
    if (!payForm.amount || !payForm.payment_date) { showToast('Date and amount required.', 'error'); return }
    const { error } = await supabase.from('company_loan_payments').insert({ loan_id: loanId, payment_date: payForm.payment_date, amount: parseFloat(payForm.amount)||0, notes: payForm.notes||null })
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      showToast('Payment recorded.')
      setShowPayForm(null); setPayForm({ payment_date: new Date().toISOString().slice(0,10), amount:'', notes:'' })
      fetchPayments(loanId)
    }
  }

  const handleDeletePayment = async (payId, loanId) => {
    await supabase.from('company_loan_payments').delete().eq('id', payId)
    fetchPayments(loanId)
    showToast('Payment deleted.', 'info')
  }

  const getBalance = (loan) => {
    const paid = (payments[loan.id] || []).reduce((s,p) => s+(p.amount||0), 0)
    return loan.total_collectible - paid
  }

  const handleSave = async () => {
    if (!form.lender || !form.total_payable || !form.monthly_payment || !form.start_date) {
      showToast('Lender, principal, monthly payment, and start date are required.', 'error'); return
    }
    setSaving(true)
    const payload = {
      lender: form.lender,
      description: form.description,
      principal: parseFloat(form.total_payable) || 0,
      interest_rate: 0,
      term_months: parseInt(form.term_months) || 0,
      start_date: form.start_date,
      monthly_payment: parseFloat(form.monthly_payment) || 0,
      status: form.status,
      notes: form.notes,
    }
    const { error } = editingId
      ? await supabase.from('loans').update(payload).eq('id', editingId)
      : await supabase.from('loans').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else { logAudit(editingId?'destructive':'generate', editingId?'Updated':'Added', 'Loans', `${editingId?'Updated':'Added'} loan: ${payload.lender} ₱${payload.total_payable}`, editingId||'', profile?.id, profile?.full_name); showToast(editingId ? 'Loan updated.' : 'Loan added.'); setShowForm(false); setEditingId(null); setForm(EMPTY); fetchAll() }
    setSaving(false)
  }

  const handleDelete = (id, lender) => {
    setConfirmModal({
      message: `Delete loan from "${lender}"? This cannot be undone.`,
      onConfirm: async () => {
        const { data: _del, error } = await supabase.rpc('permanent_delete', { p_table: 'loans', p_id: id })
        if (error) { showToast('Delete failed: ' + error.message, 'error'); return }
        logAudit('destructive', 'Deleted', 'Loans', `Deleted loan id:${id}`, id, profile?.id, profile?.full_name); showToast('Loan deleted.', 'info'); fetchAll()
      }
    })
  }

  const getMonthlyStatus = (loan) => {
    if (loan.status !== 'active') return null
    const start = new Date(loan.start_date + 'T00:00:00')
    const now = new Date()
    const monthsPassed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
    const totalPaid = monthsPassed * (loan.monthly_payment || 0)
    const remaining = Math.max((loan.principal || 0) - totalPaid, 0)
    const monthsLeft = loan.term_months ? Math.max(loan.term_months - monthsPassed, 0) : null
    const isOverpaid = loan.term_months > 0 && monthsPassed >= loan.term_months
    return { monthsPassed, totalPaid, remaining, monthsLeft, isOverpaid }
  }

  const filtered = loans.filter(l => filterStatus === 'all' || l.status === filterStatus)
  const totalMonthly = loans.filter(l => l.status === 'active').reduce((s, l) => s + (l.monthly_payment || 0), 0)
  const totalPrincipal = loans.filter(l => l.status === 'active').reduce((s, l) => s + (l.principal || 0), 0)

  return (
    <div className="page">
      {/* Tab switcher */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:16, gap:2 }}>
        {[['loans','🏦 DSTC Loans'],['lending','💸 Company Lending']].map(([key,label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{ padding:'8px 18px', background:'none', border:'none', cursor:'pointer', fontSize:13, fontWeight: activeTab===key?600:400, color: activeTab===key?'var(--accent)':'var(--muted)', borderBottom: activeTab===key?'2px solid var(--accent)':'2px solid transparent', marginBottom:-1 }}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'loans' && <>
      <div className="page-header">
        <div><h1 className="page-title">Loans</h1><p className="page-sub">Track company loans and monthly obligations</p></div>
        <button className="btn-primary" onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(EMPTY) }}>
          {showForm ? '✕ Cancel' : '+ Add Loan'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Active Loans</div>
          <div className="stat-value">{loans.filter(l => l.status === 'active').length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Monthly Obligation</div>
          <div className="stat-value sm" style={{ color: 'var(--danger)' }}>₱{fmt(totalMonthly)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Principal</div>
          <div className="stat-value sm">₱{fmt(totalPrincipal)}</div>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>{editingId ? 'Edit Loan' : 'New Loan'}</h2>
          <div className="form-grid">
            <div className="form-group">
              <label className="label required">Lender</label>
              <input value={form.lender} onChange={e => setForm(f => ({ ...f, lender: e.target.value }))} placeholder="e.g. BDO, BPI, SSS" />
            </div>
            <div className="form-group">
              <label className="label">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Vehicle loan — NKH 9643" />
            </div>
            <div className="form-group">
              <label className="label required">Total Payable (₱) <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>Principal + Interest combined</span></label>
              <input type="number" step="0.01" value={form.total_payable} onChange={e => setForm(f => ({ ...f, total_payable: e.target.value }))} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label className="label required">Monthly Payment (₱)</label>
              <input type="number" step="0.01" value={form.monthly_payment} onChange={e => setForm(f => ({ ...f, monthly_payment: e.target.value }))} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label className="label required">Number of Months</label>
              <input type="number" value={form.term_months} onChange={e => setForm(f => ({ ...f, term_months: e.target.value }))} placeholder="e.g. 36" />
            </div>
            {form.total_payable > 0 && form.term_months > 0 && (
              <div style={{ padding: '8px 12px', background: 'var(--accent-light)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
                Check: {form.term_months} × ₱{Number(form.monthly_payment||0).toLocaleString('en-PH',{minimumFractionDigits:2})} = ₱{(form.term_months * (parseFloat(form.monthly_payment)||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}
                {Math.abs((form.term_months * (parseFloat(form.monthly_payment)||0)) - parseFloat(form.total_payable||0)) > 1 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠️ Doesn't match total payable</span>}
              </div>
            )}
            <div className="form-group">
              <label className="label required">Start Date</label>
              <DateInput value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="paid">Paid Off</option>
                <option value="restructured">Restructured</option>
              </select>
            </div>
            <div className="form-group span-2">
              <label className="label">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY) }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Loan'}</button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        {['active', 'paid', 'restructured', 'all'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} className={filterStatus === s ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Loans list */}
      {loading ? <div className="empty-state"><p>Loading…</p></div> :
        filtered.length === 0 ? <div className="empty-state"><p>No {filterStatus} loans.</p></div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(loan => {
              const ms = getMonthlyStatus(loan)
              return (
                <div key={loan.id} className="card" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{loan.lender}</span>
                        <span className={`badge ${loan.status === 'active' ? 'badge-success' : ''}`} style={{ fontSize: 10 }}>
                          {loan.status === 'active' ? '🟢 Active' : loan.status === 'paid' ? '✅ Paid' : '🔄 Restructured'}
                        </span>
                      </div>
                      {loan.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{loan.description}</div>}
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                        <span>Total Payable: <strong>₱{fmt(loan.principal)}</strong></span>
                        <span>Monthly: <strong style={{ color: 'var(--danger)' }}>₱{fmt(loan.monthly_payment)}</strong></span>
                        {loan.interest_rate > 0 && <span>Rate: <strong>{loan.interest_rate}%/yr</strong></span>}
                        {loan.term_months > 0 && <span>Term: <strong>{loan.term_months} months</strong></span>}
                        <span>Started: <strong>{fmtDate(loan.start_date)}</strong></span>
                        {loan.term_months > 0 && loan.start_date && (() => {
                          const end = new Date(loan.start_date + 'T00:00:00')
                          end.setMonth(end.getMonth() + loan.term_months)
                          return <span>End Date: <strong>{fmtDate(end.toISOString().slice(0,10))}</strong></span>
                        })()}
                        {loan.term_months > 0 && loan.interest_rate > 0 && (
                          <span>Total (P+I): <strong style={{ color: 'var(--danger)' }}>₱{fmt(loan.monthly_payment * loan.term_months)}</strong></span>
                        )}
                        {loan.term_months > 0 && loan.interest_rate === 0 && (
                          <span>Total Payable: <strong>₱{fmt(loan.monthly_payment * loan.term_months)}</strong></span>
                        )}
                      </div>
                      {ms && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap', marginBottom: 6 }}>
                            <span>Paid so far: <strong style={{ color: 'var(--text)' }}>₱{fmt(ms.totalPaid)}</strong></span>
                            <span>Est. remaining: <strong style={{ color: ms.remaining > 0 ? 'var(--danger)' : 'var(--success)' }}>₱{fmt(ms.remaining)}</strong></span>
                            {ms.monthsLeft !== null && <span>Months left: <strong>{ms.monthsLeft}</strong></span>}
                          </div>
                          {loan.term_months > 0 && (() => {
                            const pct = Math.min((ms.monthsPassed / loan.term_months) * 100, 100)
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--success)' : 'var(--accent)', borderRadius: 3, transition: 'width 0.3s' }} />
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 36 }}>{pct.toFixed(0)}%</span>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                      {loan.notes && <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 4 }}>{loan.notes}</div>}
                      {ms?.isOverpaid && (
                        <div style={{ marginTop: 6, padding: '5px 10px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, fontSize: 11, color: '#dc2626', fontWeight: 500 }}>
                          ⚠️ Loan term completed — consider marking as <strong>Paid Off</strong>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-ghost btn-sm" onClick={() => { setEditingId(loan.id); setForm({ ...loan }); setShowForm(true) }}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={() => handleDelete(loan.id, loan.lender)}>Delete</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      }

      {confirmModal && (
        <div className="modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Confirm</h3>
            <p>{confirmModal.message}</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmModal(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => { confirmModal.onConfirm(); setConfirmModal(null) }}>Delete</button>
            </div>
          </div>
        </div>
      )}
      </> /* end loans tab */}

      {/* ── COMPANY LENDING TAB ── */}
      {activeTab === 'lending' && (
        <div>
          {/* Header */}
          <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16, flexWrap:'wrap' }}>
            <select value={clFilterStatus} onChange={e => setClFilterStatus(e.target.value)}
              style={{ padding:'7px 12px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', fontSize:13 }}>
              <option value="">All Status</option>
              <option value="Active">Active</option>
              <option value="Fully Paid">Fully Paid</option>
              <option value="Written Off">Written Off</option>
            </select>
            <div style={{ marginLeft:'auto' }}>
              {isAdmin && <button className="btn-primary" onClick={() => { setEditingClId(null); setShowClForm(true) }}>+ New Loan Out</button>}
            </div>
          </div>

          {/* Summary cards */}
          {(() => {
            const active = companyLoans.filter(l => l.status === 'Active')
            const totalOut = active.reduce((s,l) => s + (l.principal||0), 0)
            const totalBalance = active.reduce((s,l) => s + getBalance(l), 0)
            return (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:10, marginBottom:16 }}>
                {[
                  { label:'Active Loans', value: active.length, color:'var(--accent)', icon:'📋' },
                  { label:'Total Lent Out', value:`₱${fmt(totalOut)}`, color:'#d97706', icon:'💵' },
                  { label:'Outstanding Balance', value:`₱${fmt(totalBalance)}`, color:'#dc2626', icon:'⏳' },
                  { label:'Fully Paid', value: companyLoans.filter(l=>l.status==='Fully Paid').length, color:'#16a34a', icon:'✅' },
                ].map(c => (
                  <div key={c.label} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px', position:'relative', overflow:'hidden' }}>
                    <div style={{ position:'absolute', top:8, right:10, fontSize:20, opacity:.15 }}>{c.icon}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{c.label}</div>
                    <div style={{ fontSize:18, fontWeight:800, color:c.color }}>{c.value}</div>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Loan list */}
          {clLoading ? <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Loading…</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {companyLoans.filter(l => !clFilterStatus || l.status === clFilterStatus).length === 0 ? (
                <div style={{ textAlign:'center', padding:'60px 20px', color:'var(--muted)' }}>
                  <div style={{ fontSize:36, marginBottom:12 }}>💸</div>
                  <div style={{ fontWeight:600 }}>No loans recorded</div>
                  <div style={{ fontSize:13, marginTop:6 }}>Track money lent out by DSTC.</div>
                </div>
              ) : companyLoans.filter(l => !clFilterStatus || l.status === clFilterStatus).map(loan => {
                const isExpanded = expandedCl === loan.id
                const paidTotal = (payments[loan.id] || []).reduce((s,p) => s+(p.amount||0), 0)
                const balance = loan.total_collectible - paidTotal
                const pct = loan.total_collectible > 0 ? Math.min(100, (paidTotal / loan.total_collectible) * 100) : 0
                const statusColor = loan.status === 'Fully Paid' ? '#16a34a' : loan.status === 'Written Off' ? '#6b7280' : '#d97706'
                return (
                  <div key={loan.id} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                    {/* Loan header */}
                    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', cursor:'pointer', flexWrap:'wrap' }}
                      onClick={() => { setExpandedCl(isExpanded ? null : loan.id); if (!isExpanded) fetchPayments(loan.id) }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                          <span style={{ fontWeight:700, fontSize:14 }}>{loan.borrower}</span>
                          <span style={{ fontSize:11, padding:'1px 7px', borderRadius:10, background:`${statusColor}18`, color:statusColor, fontWeight:600 }}>{loan.status}</span>
                          <span style={{ fontSize:11, color:'var(--muted)', background:'var(--bg)', padding:'1px 6px', borderRadius:4 }}>{loan.borrower_type}</span>
                        </div>
                        {loan.purpose && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{loan.purpose}</div>}
                        <div style={{ marginTop:6, height:4, background:'var(--border)', borderRadius:4, overflow:'hidden', maxWidth:200 }}>
                          <div style={{ height:'100%', width:`${pct}%`, background: pct>=100?'#16a34a':'var(--accent)', borderRadius:4, transition:'width .3s' }} />
                        </div>
                        <div style={{ fontSize:10, color:'var(--muted)', marginTop:2 }}>{pct.toFixed(1)}% collected</div>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        <div style={{ fontSize:13, color:'var(--muted)' }}>Principal: <strong>₱{fmt(loan.principal)}</strong></div>
                        <div style={{ fontSize:13, color:'var(--muted)' }}>Collected: <span style={{ color:'#16a34a', fontWeight:600 }}>₱{fmt(paidTotal)}</span></div>
                        <div style={{ fontSize:14, fontWeight:700, color: balance<=0?'#16a34a':'#dc2626' }}>Balance: ₱{fmt(Math.max(0,balance))}</div>
                        <div style={{ fontSize:11, color:'var(--muted)' }}>₱{fmt(loan.monthly_payment)}/mo · {loan.term_months}mo · {fmtDate(loan.start_date)}</div>
                      </div>
                      <span style={{ color:'var(--muted)', fontSize:16 }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>

                    {/* Expanded — payment ledger */}
                    {isExpanded && (
                      <div style={{ borderTop:'1px solid var(--border)', padding:'12px 16px', background:'var(--bg)' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                          <span style={{ fontSize:13, fontWeight:600 }}>Payment Ledger</span>
                          <div style={{ display:'flex', gap:8 }}>

                            {isAdmin && (
                              <button className="btn-ghost btn-sm" onClick={() => {
                                setEditingClId(loan.id)
                                setClForm({ borrower:loan.borrower, borrower_type:loan.borrower_type, purpose:loan.purpose||'', principal:String(loan.principal), interest_rate:String(loan.interest_rate), term_months:String(loan.term_months), start_date:loan.start_date, monthly_payment:String(loan.monthly_payment), notes:loan.notes||'' })
                                setShowClForm(true)
                              }}>✏️ Edit</button>
                            )}
                            <button className="btn-ghost btn-sm" onClick={() => handlePrintSchedule(loan, payments[loan.id]||[], scheduleTab[loan.id]||'original')} title="Print current schedule as PDF">🖨️ PDF</button>
                            <button className="btn-ghost btn-sm" onClick={() => handleExportBothExcel(loan, payments[loan.id]||[])} title="Export both schedules to Excel">📊 Excel</button>
                            {isAdmin && <button className="btn-danger btn-sm" onClick={() => handleDeleteCl(loan.id, loan.borrower)}>Delete</button>}
                          </div>
                        </div>

                            {/* Sub-tab: Original / Revised */}
                        <div style={{ display:'flex', gap:4, marginBottom:12 }}>
                          {['original','revised'].map(t => (
                            <button key={t} onClick={() => setScheduleTab(s=>({...s,[loan.id]:t}))}
                              style={{ padding:'5px 14px', borderRadius:6, border:'1px solid var(--border)', cursor:'pointer', fontSize:12, fontWeight:(scheduleTab[loan.id]||'original')===t?700:400, background:(scheduleTab[loan.id]||'original')===t?'var(--accent)':'var(--surface)', color:(scheduleTab[loan.id]||'original')===t?'#fff':'var(--text)' }}>
                              {t === 'original' ? '📋 Original Schedule' : '🔄 Revised Schedule'}
                            </button>
                          ))}
                        </div>

                        {/* Amortization schedule + actual payments side by side */}
                        {(() => {
                          // Build schedule
                          const schedule = []
                          const startD = new Date(loan.start_date + 'T00:00:00')
                          const monthlyInt = loan.principal * (loan.interest_rate / 100)
                          const monthlyPrincipal = loan.monthly_payment - monthlyInt
                          let outstanding = loan.principal
                          for (let i = 0; i < loan.term_months; i++) {
                            const d = new Date(startD)
                            d.setMonth(d.getMonth() + i + 1)
                            const isLast = i === loan.term_months - 1
                            const principalPmt = isLast ? outstanding : Math.min(monthlyPrincipal, outstanding)
                            const amort = isLast ? principalPmt + monthlyInt : loan.monthly_payment
                            outstanding = Math.max(0, outstanding - principalPmt)
                            schedule.push({ month: i+1, date: d, amort, interest: monthlyInt, principal: principalPmt, outstanding })
                          }
                          const paidList = payments[loan.id] || []
                          let runBal = loan.total_collectible
                          const currentTab = scheduleTab[loan.id] || 'original'

                          if (currentTab === 'revised') {
                            // Build revised schedule:
                            // Excess payments eat from the LAST scheduled payment backwards.
                            // The original schedule stays fixed — excess just eliminates tail months.
                            const monthlyInt2 = loan.monthly_payment  // fixed monthly amort
                            const startD2 = new Date(loan.start_date + 'T00:00:00')

                            // Step 1: Build full original schedule (same as left side)
                            const origSched = []
                            let op = loan.principal
                            const mInt = loan.principal * (loan.interest_rate / 100)
                            const mPrin = loan.monthly_payment - mInt
                            for (let i = 0; i < loan.term_months; i++) {
                              const d2 = new Date(startD2)
                              d2.setMonth(d2.getMonth() + i + 1)
                              const isLast = i === loan.term_months - 1
                              const prinPmt = isLast ? op : Math.min(mPrin, op)
                              const amort = isLast ? prinPmt + mInt : loan.monthly_payment
                              op = Math.max(0, op - prinPmt)
                              origSched.push({ month: i+1, date: d2, amort, interest: mInt, principal: prinPmt, outstanding: op })
                            }

                            // Step 2: Calculate total excess payments
                            let totalPaid = paidList.reduce((s,p) => s+(p.amount||0), 0)
                            let totalScheduledSoFar = paidList.length * loan.monthly_payment
                            let totalExcess = Math.max(0, totalPaid - totalScheduledSoFar)

                            // Step 3: Eat excess from the tail of origSched
                            let revisedSched = origSched.map(r => ({ ...r }))
                            let excessLeft = totalExcess
                            for (let i = revisedSched.length - 1; i >= 0 && excessLeft > 0; i--) {
                              if (excessLeft >= revisedSched[i].amort) {
                                excessLeft -= revisedSched[i].amort
                                revisedSched[i].eliminated = true
                              } else {
                                revisedSched[i].amort -= excessLeft
                                revisedSched[i].principal = revisedSched[i].amort - revisedSched[i].interest
                                if (revisedSched[i].principal < 0) revisedSched[i].principal = 0
                                excessLeft = 0
                              }
                            }

                            // Step 4: Remove eliminated rows, recalc outstanding
                            let revisedRows = revisedSched.filter(r => !r.eliminated)
                            let runOut = loan.principal
                            revisedRows = revisedRows.map((r, i) => {
                              runOut = Math.max(0, runOut - r.principal)
                              return { ...r, outstanding: runOut, actual: paidList[i] || null, isLastRevised: i === revisedRows.length - 1 }
                            })

                            const origMonths = loan.term_months
                            const revisedMonths = revisedRows.length
                            const savedMonths = origMonths - revisedMonths
                            const totalRevisedAmort = revisedRows.reduce((s,r)=>s+r.amort,0)
                            const totalRevisedInt = revisedRows.reduce((s,r)=>s+r.interest,0)
                            const lastRow = revisedRows[revisedRows.length-1]

                            return (
                              <div>
                                {/* Summary */}
                                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:8, marginBottom:12 }}>
                                  {[
                                    { label:'Revised Term', value:`${revisedMonths} months`, color: savedMonths>0?'#16a34a':'var(--text)' },
                                    { label:'Months Saved', value: savedMonths > 0 ? `−${savedMonths} months` : 'No change', color: savedMonths>0?'#16a34a':'var(--muted)' },
                                    { label:'Last Payment', value:`₱${fmt(lastRow?.amort||0)}`, color:'var(--accent)' },
                                    { label:'Last Payment Date', value: lastRow ? lastRow.date.toLocaleDateString('en-PH',{month:'short',year:'numeric'}) : '—', color:'var(--text)' },
                                    { label:'Total Interest', value:`₱${fmt(totalRevisedInt)}`, color:'#d97706' },
                                  ].map(c => (
                                    <div key={c.label} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px' }}>
                                      <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.06em' }}>{c.label}</div>
                                      <div style={{ fontSize:14, fontWeight:700, color:c.color, marginTop:3 }}>{c.value}</div>
                                    </div>
                                  ))}
                                </div>

                                {/* Revised table */}
                                <div style={{ overflowX:'auto' }}>
                                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                                    <thead>
                                      <tr style={{ background:'var(--bg)', borderBottom:'2px solid var(--border)' }}>
                                        <th style={{ padding:'6px 8px', textAlign:'left', color:'var(--muted)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>#</th>
                                        <th style={{ padding:'6px 8px', textAlign:'left', color:'var(--muted)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Date</th>
                                        <th style={{ padding:'6px 8px', textAlign:'right', color:'var(--muted)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Amort.</th>
                                        <th style={{ padding:'6px 8px', textAlign:'right', color:'var(--muted)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Interest</th>
                                        <th style={{ padding:'6px 8px', textAlign:'right', color:'var(--muted)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Principal</th>
                                        <th style={{ padding:'6px 8px', textAlign:'right', color:'var(--muted)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Outstanding</th>
                                        <th style={{ padding:'6px 8px', textAlign:'center', color:'var(--muted)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {revisedRows.map((row, i) => (
                                        <tr key={i} style={{ borderBottom:'1px solid var(--border)', background: row.actual ? 'rgba(22,163,74,0.05)' : row.isLastRevised ? 'rgba(241,114,0,0.06)' : 'transparent' }}>
                                          <td style={{ padding:'5px 8px', color:'var(--muted)' }}>{row.month}</td>
                                          <td style={{ padding:'5px 8px' }}>{row.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</td>
                                          <td style={{ padding:'5px 8px', textAlign:'right', fontWeight: row.isLastRevised?700:500, color: row.isLastRevised?'var(--accent)':'var(--text)' }}>₱{fmt(row.amort)}</td>
                                          <td style={{ padding:'5px 8px', textAlign:'right', color:'#d97706' }}>₱{fmt(row.interest)}</td>
                                          <td style={{ padding:'5px 8px', textAlign:'right', color:'#7c3aed' }}>₱{fmt(row.principal)}</td>
                                          <td style={{ padding:'5px 8px', textAlign:'right', color: row.outstanding<=0?'#16a34a':'var(--muted)' }}>₱{fmt(row.outstanding)}</td>
                                          <td style={{ padding:'5px 8px', textAlign:'center' }}>
                                            {row.actual
                                              ? <span style={{ fontSize:10, background:'#dcfce7', color:'#16a34a', padding:'1px 6px', borderRadius:10, fontWeight:600 }}>✅ Paid</span>
                                              : row.isLastRevised
                                                ? <span style={{ fontSize:10, background:'rgba(241,114,0,0.1)', color:'var(--accent)', padding:'1px 6px', borderRadius:10, fontWeight:600 }}>Final</span>
                                                : <span style={{ fontSize:10, background:'var(--bg)', color:'var(--muted)', padding:'1px 6px', borderRadius:10 }}>Pending</span>
                                            }
                                          </td>
                                        </tr>
                                      ))}
                                      <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg)', fontWeight:700 }}>
                                        <td colSpan={2} style={{ padding:'6px 8px', fontSize:11 }}>TOTAL</td>
                                        <td style={{ padding:'6px 8px', textAlign:'right' }}>₱{fmt(totalRevisedAmort)}</td>
                                        <td style={{ padding:'6px 8px', textAlign:'right', color:'#d97706' }}>₱{fmt(totalRevisedInt)}</td>
                                        <td style={{ padding:'6px 8px', textAlign:'right', color:'#7c3aed' }}>₱{fmt(loan.principal)}</td>
                                        <td colSpan={2} />
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )
                          }

                          return (
                            <div style={{ overflowX:'auto' }}>
                              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                                <thead>
                                  <tr style={{ background:'var(--bg)', borderBottom:'2px solid var(--border)' }}>
                                    <th style={{ padding:'6px 8px', textAlign:'left', color:'var(--muted)', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>#</th>
                                    <th style={{ padding:'6px 8px', textAlign:'left', color:'var(--muted)', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>Sched. Date</th>
                                    <th style={{ padding:'6px 8px', textAlign:'right', color:'var(--muted)', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>Monthly Amort.</th>
                                    <th style={{ padding:'6px 8px', textAlign:'right', color:'var(--muted)', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>Interest</th>
                                    <th style={{ padding:'6px 8px', textAlign:'right', color:'var(--muted)', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>Principal</th>
                                    <th style={{ padding:'6px 8px', textAlign:'right', color:'var(--muted)', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>Outstanding</th>
                                    <th style={{ padding:'6px 8px', borderLeft:'2px solid var(--border)', textAlign:'center', color:'#2563eb', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>Payment #</th>
                                    <th style={{ padding:'6px 8px', textAlign:'right', color:'#2563eb', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>Amount Paid</th>
                                    <th style={{ padding:'6px 8px', textAlign:'right', color:'#2563eb', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>Running Bal.</th>
                                    <th style={{ padding:'6px 8px', textAlign:'left', color:'#2563eb', fontWeight:600, textTransform:'uppercase', fontSize:10 }}>As of</th>
                                    {isAdmin && <th style={{ width:30 }} />}
                                  </tr>
                                </thead>
                                <tbody>
                                  {schedule.map((row, idx) => {
                                    const pay = paidList[idx]
                                    if (pay) runBal -= pay.amount
                                    const isPaid = !!pay
                                    return (
                                      <tr key={idx} style={{ borderBottom:'1px solid var(--border)', background: isPaid ? 'rgba(22,163,74,0.04)' : 'transparent' }}>
                                        <td style={{ padding:'5px 8px', color:'var(--muted)' }}>{row.month}</td>
                                        <td style={{ padding:'5px 8px' }}>{row.date.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</td>
                                        <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:500 }}>₱{fmt(row.amort)}</td>
                                        <td style={{ padding:'5px 8px', textAlign:'right', color:'#d97706' }}>₱{fmt(row.interest)}</td>
                                        <td style={{ padding:'5px 8px', textAlign:'right', color:'#7c3aed' }}>₱{fmt(row.principal)}</td>
                                        <td style={{ padding:'5px 8px', textAlign:'right', color:'var(--muted)' }}>₱{fmt(row.outstanding)}</td>
                                        <td style={{ padding:'5px 8px', borderLeft:'2px solid var(--border)', textAlign:'center', color: isPaid?'#16a34a':'var(--muted)' }}>
                                          {isPaid ? `${idx+1}${['st','nd','rd'][idx]||'th'}` : '—'}
                                        </td>
                                        <td style={{ padding:'5px 8px', textAlign:'right', color:'#16a34a', fontWeight: isPaid?600:400 }}>
                                          {isPaid ? `₱${fmt(pay.amount)}` : '—'}
                                        </td>
                                        <td style={{ padding:'5px 8px', textAlign:'right', fontWeight: isPaid?700:400, color: isPaid?(runBal<=0?'#16a34a':'#dc2626'):'var(--muted)' }}>
                                          {isPaid ? `₱${fmt(Math.max(0,runBal))}` : '—'}
                                        </td>
                                        <td style={{ padding:'5px 8px', color:'var(--muted)', fontSize:11 }}>
                                          {isPaid ? fmtDate(pay.payment_date) : '—'}
                                        </td>
                                        {isAdmin && <td style={{ padding:'5px 8px', textAlign:'right' }}>
                                          {isPaid
                                            ? <button onClick={() => handleDeletePayment(pay.id, loan.id)} style={{ padding:'1px 5px', background:'#ef4444', color:'#fff', border:'none', borderRadius:3, cursor:'pointer', fontSize:10 }}>✕</button>
                                            : <button onClick={() => { setShowPayForm(loan.id + '_' + idx); setPayForm({ payment_date: row.date.toISOString().slice(0,10), amount: String(row.amort), notes:'' }) }}
                                                style={{ padding:'1px 5px', background:'var(--accent)', color:'#fff', border:'none', borderRadius:3, cursor:'pointer', fontSize:10 }}>+</button>
                                          }
                                        </td>}
                                      </tr>
                                    )
                                  })}
                                  {/* Totals row */}
                                  <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg)', fontWeight:700 }}>
                                    <td colSpan={2} style={{ padding:'6px 8px', fontSize:11 }}>TOTAL</td>
                                    <td style={{ padding:'6px 8px', textAlign:'right' }}>₱{fmt(schedule.reduce((s,r)=>s+r.amort,0))}</td>
                                    <td style={{ padding:'6px 8px', textAlign:'right', color:'#d97706' }}>₱{fmt(schedule.reduce((s,r)=>s+r.interest,0))}</td>
                                    <td style={{ padding:'6px 8px', textAlign:'right', color:'#7c3aed' }}>₱{fmt(loan.principal)}</td>
                                    <td />
                                    <td style={{ borderLeft:'2px solid var(--border)' }} />
                                    <td style={{ padding:'6px 8px', textAlign:'right', color:'#16a34a' }}>₱{fmt(paidList.reduce((s,p)=>s+(p.amount||0),0))}</td>
                                    <td colSpan={3} />
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )
                        })()}

                        {/* Add payment form */}
                        {showPayForm && showPayForm.startsWith(loan.id) && (
                          <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr 1fr auto auto', gap:8, alignItems:'end' }}>
                            <div>
                              <label style={{ fontSize:11, color:'var(--muted)', display:'block', marginBottom:3 }}>Date</label>
                              <DateInput value={payForm.payment_date} onChange={e => setPayForm(f=>({...f,payment_date:e.target.value}))}
                                style={{ width:'100%', padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize:11, color:'var(--muted)', display:'block', marginBottom:3 }}>Amount</label>
                              <input type="number" value={payForm.amount} onChange={e => setPayForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"
                                style={{ width:'100%', padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} />
                            </div>
                            <button className="btn-primary btn-sm" onClick={() => handleSavePayment(loan.id)}>Save</button>
                            <button className="btn-ghost btn-sm" onClick={() => setShowPayForm(null)}>Cancel</button>
                          </div>
                        )}

                        {/* Mark fully paid */}
                        {isAdmin && loan.status === 'Active' && balance <= 0 && (
                          <div style={{ marginTop:10, padding:'8px 12px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ fontSize:13, color:'#16a34a', fontWeight:600 }}>✅ Fully collected! Mark as Fully Paid?</span>
                            <button onClick={async () => { await supabase.from('company_loans').update({ status:'Fully Paid' }).eq('id', loan.id); fetchCompanyLoans() }}
                              style={{ padding:'4px 12px', background:'#16a34a', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 }}>Mark Paid</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Add/Edit Loan Modal */}
          {showClForm && (
            <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'20px 16px', overflowY:'auto' }}
              onClick={e => e.target === e.currentTarget && setShowClForm(false)}>
              <div style={{ background:'var(--surface)', borderRadius:10, border:'1px solid var(--border)', width:'100%', maxWidth:520, padding:24, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
                <h3 style={{ margin:'0 0 16px', fontSize:16, fontWeight:700 }}>{editingClId ? 'Edit Loan' : '+ New Loan Out'}</h3>
                <div style={{ display:'grid', gap:12 }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Borrower *</label>
                      <input value={clForm.borrower} onChange={e => setClForm(f=>({...f,borrower:e.target.value}))} style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Type</label>
                      <select value={clForm.borrower_type} onChange={e => setClForm(f=>({...f,borrower_type:e.target.value}))} style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13 }}>
                        <option>Employee</option><option>Driver</option><option>Client</option><option>Partner</option><option>Other</option>
                      </select></div>
                  </div>
                  <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Purpose</label>
                    <input value={clForm.purpose} onChange={e => setClForm(f=>({...f,purpose:e.target.value}))} placeholder="e.g. Emergency loan, Equipment" style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Principal *</label>
                      <input type="number" value={clForm.principal} onChange={e => setClForm(f=>({...f,principal:e.target.value}))} style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Interest %</label>
                      <input type="number" value={clForm.interest_rate} onChange={e => setClForm(f=>({...f,interest_rate:e.target.value}))} placeholder="0" style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Term (months) *</label>
                      <input type="number" value={clForm.term_months} onChange={e => setClForm(f=>({...f,term_months:e.target.value}))} style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Start Date</label>
                      <DateInput value={clForm.start_date} onChange={e => setClForm(f=>({...f,start_date:e.target.value}))} style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Monthly Collection *</label>
                      <input type="number" value={clForm.monthly_payment} onChange={e => setClForm(f=>({...f,monthly_payment:e.target.value}))} style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                  </div>
                  {clForm.monthly_payment && clForm.term_months && (
                    <div style={{ padding:'8px 12px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6, fontSize:12, color:'var(--muted)' }}>
                      Total Collectible: <strong style={{ color:'var(--text)' }}>₱{fmt((parseFloat(clForm.monthly_payment)||0)*(parseInt(clForm.term_months)||0))}</strong>
                    </div>
                  )}
                  <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Notes</label>
                    <input value={clForm.notes} onChange={e => setClForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                  <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:4 }}>
                    <button onClick={() => { setShowClForm(false); setEditingClId(null) }} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:6, background:'transparent', cursor:'pointer', fontSize:13 }}>Cancel</button>
                    <button onClick={handleSaveCl} style={{ padding:'8px 20px', background:'var(--accent)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:600 }}>Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
