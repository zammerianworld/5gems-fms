import { useState, useEffect, useCallback } from 'react'
import DateInput from '../components/DateInput'
import { useAuth } from '../components/AuthContext'
import jsPDF from 'jspdf'
import SignatoryDialog from '../components/SignatoryDialog'
import autoTable from 'jspdf-autotable'
import { supabase, fmtDate, logAudit } from '../lib/supabase'
import ExcelJS from 'exceljs'
import { useToast, Toast } from '../components/Toast'

const today = () => new Date().toISOString().slice(0, 10)

const EMPTY = {
  vehicle_name: '', plate_no: '', vehicle_type: 'truck', or_number: '', cr_number: '',
  or_expiry: '', mv_file_no: '', owner: '', notes: ''
}

const getDaysUntil = (dateStr) => {
  if (!dateStr) return null
  const diff = new Date(dateStr + 'T00:00:00') - new Date()
  return Math.ceil(diff / 86400000)
}

const expiryBadge = (dateStr, threshold = 30) => {
  const days = getDaysUntil(dateStr)
  if (days === null) return null
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, color: '#dc2626', bg: 'rgba(220,38,38,0.1)', icon: '🔴' }
  if (days <= threshold) return { label: `Expires in ${days}d`, color: '#d97706', bg: 'rgba(217,119,6,0.1)', icon: '🟡' }
  if (days <= threshold * 2) return { label: `Expires in ${days}d`, color: '#2563eb', bg: 'rgba(37,99,235,0.1)', icon: '🔵' }
  return { label: `Valid — ${days}d left`, color: '#15803d', bg: 'rgba(22,163,74,0.1)', icon: '🟢' }
}

export default function ORCR() {
  const { toast, showToast } = useToast()
  const { isAdmin, profile } = useAuth()
  const [records, setRecords] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [sigDialog, setSigDialog] = useState(false)
  const [exportFormat, setExportFormat] = useState('pdf') // 'pdf' | 'excel'
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmModal, setConfirmModal] = useState(null)
  const [filterType, setFilterType] = useState('')
  const [viewMode, setViewMode] = useState('list') // 'list' | 'calendar'
  const [calMonth, setCalMonth] = useState(new Date().toISOString().slice(0,7))
  const [reminderDays, setReminderDays] = useState(() => parseInt(localStorage.getItem('orcr_reminder_days') || '30'))
  const [showSettings, setShowSettings] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: sett }] = await Promise.all([
      supabase.from('orcr_records').select('*').order('or_expiry'),
      supabase.from('company_settings').select('*').eq('id',1).maybeSingle(),
    ])
    setRecords(data || [])
    if (sett) setSettings(sett)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleSave = async () => {
    if (!form.vehicle_name || !form.plate_no) {
      showToast('Vehicle name and plate number are required.', 'error'); return
    }
    setSaving(true)
    const { error } = editingId
      ? await supabase.from('orcr_records').update(form).eq('id', editingId)
      : await supabase.from('orcr_records').insert(form)
    if (error) showToast('Error: ' + error.message, 'error')
    else { logAudit(editingId?'destructive':'generate', editingId?'Updated':'Added', 'ORCR', `${editingId?'Updated':'Added'} OR/CR: ${form.vehicle_name||''} ${form.plate_no||''}`, editingId||'', profile?.id, profile?.full_name); showToast(editingId ? 'Record updated.' : 'Record added.'); setShowForm(false); setEditingId(null); setForm(EMPTY); fetchAll() }
    setSaving(false)
  }

  const filtered = records.filter(r => !filterType || r.vehicle_type === filterType)

  // Sort: expired first, then expiring soon, then valid
  const sorted = [...filtered].sort((a, b) => {
    const da = getDaysUntil(a.or_expiry) ?? 999
    const db = getDaysUntil(b.or_expiry) ?? 999
    return da - db
  })

  const expiredCount = records.filter(r => getDaysUntil(r.or_expiry) !== null && getDaysUntil(r.or_expiry) < 0).length
  const expiringSoonCount = records.filter(r => { const d = getDaysUntil(r.or_expiry); return d !== null && d >= 0 && d <= reminderDays }).length

  const doPrint = (sigs) => {
    setSigDialog(false)
    if (exportFormat === 'excel') { doExcel(sigs); return }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
    const W = 279.4
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text((settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase(), W / 2, 12, { align: 'center' })
    doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    doc.text(`OR Expiry Report — Generated ${new Date().toLocaleDateString('en-PH')}`, W / 2, 18, { align: 'center' })
    doc.setDrawColor(200); doc.line(14, 22, W - 14, 22)
    const rows = sorted.map(r => {
      const orDays = getDaysUntil(r.or_expiry)
      const status = orDays !== null && orDays < 0 ? 'EXPIRED' : orDays !== null && orDays <= 30 ? 'EXPIRING SOON' : 'OK'
      return [
        r.vehicle_name, r.plate_no, r.vehicle_type?.replace('_', ' '),
        r.or_number || '—', r.or_expiry || '—', orDays !== null ? `${orDays}d` : '—',
        r.cr_number || '—', 'Permanent',
        status
      ]
    })
    autoTable(doc, {
      startY: 26,
      head: [['Vehicle', 'Plate', 'Type', 'OR No.', 'OR Expiry', 'OR Days', 'CR No.', 'CR Issued Date', 'Status']],
      body: rows,
      headStyles: { fillColor: [255,30,0], fontSize: 7, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 9) {
          const val = data.cell.text[0]
          if (val === 'EXPIRED') data.cell.styles.textColor = [220, 38, 38]
          else if (val === 'EXPIRING SOON') data.cell.styles.textColor = [217, 119, 6]
          else data.cell.styles.textColor = [22, 163, 74]
        }
      },
      margin: { left: 10, right: 10 },
    })
    // ORCR signatories
    const orcrPrepName = settings.orcr_prepared_by_name || settings.prepared_by_name || ''
    const orcrPrepTitle = settings.orcr_prepared_by_title || settings.prepared_by_title || ''
    const orcrNotedName = settings.orcr_noted_by_name || settings.noted_by_name || ''
    const orcrNotedTitle = settings.orcr_noted_by_title || settings.noted_by_title || ''
    if (orcrPrepName || orcrNotedName) {
      const finalY2 = doc.lastAutoTable?.finalY || 100
      const sigY = finalY2 + 18
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(120)
      if (orcrPrepName) {
        doc.text('Prepared by:', 14, sigY)
        doc.setDrawColor(100); doc.line(14, sigY + 10, 90, sigY + 10)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0)
        doc.text(orcrPrepName.toUpperCase(), 14, sigY + 14)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(255,30,0)
        doc.text(orcrPrepTitle, 14, sigY + 18)
      }
      if (orcrNotedName) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(120)
        doc.text('Noted by:', W - 14, sigY, { align: 'right' })
        doc.setDrawColor(100); doc.line(W - 90, sigY + 10, W - 14, sigY + 10)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0)
        doc.text(orcrNotedName.toUpperCase(), W - 14, sigY + 14, { align: 'right' })
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(255,30,0)
        doc.text(orcrNotedTitle, W - 14, sigY + 18, { align: 'right' })
      }
      doc.setTextColor(0)
    }
    // Signatories from dialog
    if (sigs && sigs.length > 0) {
      const W2 = 279.4
      const sigY3 = (doc.lastAutoTable?.finalY || 100) + 20
      sigs.forEach((s, idx) => {
        const x = idx === 0 ? 14 : idx === sigs.length-1 ? W2-14 : W2/2
        const align = idx === 0 ? 'left' : idx === sigs.length-1 ? 'right' : 'center'
        doc.setFontSize(6); doc.setFont('helvetica','normal'); doc.setTextColor(120)
        doc.text(`${s.label}:`, x, sigY3, { align })
        doc.setDrawColor(100)
        if (align==='left') doc.line(x, sigY3+10, x+70, sigY3+10)
        else if (align==='right') doc.line(x-70, sigY3+10, x, sigY3+10)
        else doc.line(x-35, sigY3+10, x+35, sigY3+10)
        doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(0)
        doc.text(s.name, x, sigY3+14, { align })
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(255,30,0)
        doc.text(s.title||'', x, sigY3+18, { align })
        doc.setTextColor(0)
      })
    }
    doc.save(`ORCR-Report-${new Date().toISOString().slice(0,10)}.pdf`)
    showToast('PDF saved.')
  }

  const doExcel = async (sigs) => {
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const COLS = 9
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('OR-CR Report')
    ws.columns = [{width:24},{width:12},{width:12},{width:14},{width:13},{width:9},{width:14},{width:16},{width:14}]
    const thin = { style:'thin', color:{argb:'FFAAAAAA'} }
    const allBorders = { top:thin, left:thin, bottom:thin, right:thin }

    let r = 1
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = companyName
    ws.getCell(r,1).font = { bold:true, size:13 }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    r++
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = `OR EXPIRY REPORT — Generated ${new Date().toLocaleDateString('en-PH')}`
    ws.getCell(r,1).font = { bold:true, size:11 }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    ws.getCell(r,1).border = { bottom:{style:'medium', color:{argb:'FF000000'}} }
    r++
    r++ // spacer

    const headerRow = r
    const headers = ['Vehicle','Plate','Type','OR No.','OR Expiry','OR Days','CR No.','CR Issued Date','Status']
    headers.forEach((h,i) => {
      const cell = ws.getCell(headerRow, i+1)
      cell.value = h
      cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:8.5 }
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF000000'} }
      cell.border = allBorders
    })
    r++

    sorted.forEach((rec,i) => {
      const orDays = getDaysUntil(rec.or_expiry)
      const status = orDays !== null && orDays < 0 ? 'EXPIRED' : orDays !== null && orDays <= 30 ? 'EXPIRING SOON' : 'OK'
      const statusColor = status === 'EXPIRED' ? 'FFDC2626' : status === 'EXPIRING SOON' ? 'FFD97706' : 'FF16A34A'
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF5F5F5'
      const vals = [rec.vehicle_name, rec.plate_no, (rec.vehicle_type||'').replace('_',' '), rec.or_number||'—', rec.or_expiry||'—', orDays!==null?`${orDays}d`:'—', rec.cr_number||'—', 'Permanent', status]
      vals.forEach((v,ci) => {
        const cell = ws.getCell(r, ci+1)
        cell.value = v
        cell.font = { size:8.5, bold: ci===8, color: ci===8?{argb:statusColor}:undefined }
        cell.alignment = { horizontal: ci===0?'left':'center', vertical:'middle' }
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:bg} }
        cell.border = allBorders
        if (ci===3 || ci===6) cell.numFmt = '@'
      })
      r++
    })
    r++ // spacer

    // Signatures
    if (sigs && sigs.length > 0) {
      r++
      const sigCols = Math.max(1, Math.floor(COLS / sigs.length))
      const sigRowLabel = r, sigRowGap = r+1, sigRowName = r+2, sigRowTitle = r+3
      sigs.forEach((s, i) => {
        const startCol = i*sigCols + 1
        const endCol = (i === sigs.length-1) ? COLS : startCol + sigCols - 1
        ws.mergeCells(sigRowLabel, startCol, sigRowLabel, endCol)
        const lc = ws.getCell(sigRowLabel, startCol)
        lc.value = `${s.label}:`
        lc.font = { size:7, color:{argb:'FF888888'} }
        lc.alignment = { horizontal:'center' }
        ws.mergeCells(sigRowGap, startCol, sigRowGap, endCol)
        ws.getRow(sigRowGap).height = 22
        ws.mergeCells(sigRowName, startCol, sigRowName, endCol)
        const nc = ws.getCell(sigRowName, startCol)
        nc.value = s.name
        nc.font = { bold:true, size:8.5 }
        nc.alignment = { horizontal:'center' }
        nc.border = { top:{style:'thin', color:{argb:'FF333333'}} }
        if (s.title) {
          ws.mergeCells(sigRowTitle, startCol, sigRowTitle, endCol)
          const tc = ws.getCell(sigRowTitle, startCol)
          tc.value = s.title
          tc.font = { size:7.5, color:{argb:'FFFF1E00'} }
          tc.alignment = { horizontal:'center' }
        }
      })
    }

    ws.views = [{ showGridLines: false }]
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `ORCR-Report-${new Date().toISOString().slice(0,10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    showToast('Excel exported.')
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">OR/CR Tracking</h1><p className="page-sub">Vehicle registration and document expiry monitoring</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={() => setShowSettings(s => !s)}>⚙️ Reminder: {reminderDays}d</button>
          <button className="btn-ghost" onClick={() => { setExportFormat('pdf'); setSigDialog(true) }}>🖨️ Print PDF</button>
          <button className="btn-ghost" onClick={() => { setExportFormat('excel'); setSigDialog(true) }}>📊 Excel</button>
          <button className="btn-primary" onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(EMPTY) }}>
          {showForm ? '✕ Cancel' : '+ Add Vehicle'}
        </button>
        </div>
      </div>

      {/* Reminder settings */}
      {showSettings && (
        <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>⚙️ Alert me when OR/CR expires within:</span>
          {[15, 30, 45, 60, 90].map(d => (
            <button key={d} onClick={() => { setReminderDays(d); localStorage.setItem('orcr_reminder_days', d); setShowSettings(false) }}
              className={reminderDays === d ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}>{d} days</button>
          ))}
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Currently: {reminderDays} days</span>
        </div>
      )}

      {/* Alert summary */}
      {(expiredCount > 0 || expiringSoonCount > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {expiredCount > 0 && (
            <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, fontSize: 13, color: '#dc2626', fontWeight: 500 }}>
              🔴 {expiredCount} vehicle{expiredCount > 1 ? 's' : ''} with expired OR
            </div>
          )}
          {expiringSoonCount > 0 && (
            <div style={{ padding: '10px 14px', background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 8, fontSize: 13, color: '#d97706', fontWeight: 500 }}>
              🟡 {expiringSoonCount} vehicle{expiringSoonCount > 1 ? 's' : ''} expiring within 30 days
            </div>
          )}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>{editingId ? 'Edit Record' : 'New Vehicle Record'}</h2>
          <div className="form-grid">
            <div className="form-group">
              <label className="label required">Vehicle Name / Description</label>
              <input value={form.vehicle_name} onChange={e => setForm(f => ({ ...f, vehicle_name: e.target.value }))} placeholder="e.g. Dump Truck NKH 9643" />
            </div>
            <div className="form-group">
              <label className="label required">Plate Number</label>
              <input value={form.plate_no} onChange={e => setForm(f => ({ ...f, plate_no: e.target.value.toUpperCase() }))} placeholder="e.g. NKH 9643" />
            </div>
            <div className="form-group">
              <label className="label">Vehicle Type</label>
              <select value={form.vehicle_type} onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}>
                <option value="truck">Dump Truck</option>
                <option value="prime_mover">Prime Mover</option>
                <option value="car">Car</option>
                <option value="van">Van</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">Owner</label>
              <input value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} placeholder="e.g. Company Name Corp" />
            </div>
            <div className="form-group">
              <label className="label">OR Number</label>
              <input value={form.or_number} onChange={e => setForm(f => ({ ...f, or_number: e.target.value }))} placeholder="Official Receipt No." />
            </div>
            <div className="form-group">
              <label className="label">OR Expiry Date</label>
              <DateInput value={form.or_expiry} onChange={e => setForm(f => ({ ...f, or_expiry: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">CR Number</label>
              <input value={form.cr_number} onChange={e => setForm(f => ({ ...f, cr_number: e.target.value }))} placeholder="Certificate of Registration No." />
            </div>
            <div className="form-group">
              <label className="label">CR Date (Issued / Processed)</label>
              <DateInput value={form.cr_expiry} onChange={e => setForm(f => ({ ...f, cr_expiry: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">MV File No.</label>
              <input value={form.mv_file_no} onChange={e => setForm(f => ({ ...f, mv_file_no: e.target.value }))} placeholder="Motor Vehicle File Number" />
            </div>
            <div className="form-group">
              <label className="label">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY) }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Record'}</button>
          </div>
        </div>
      )}

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={viewMode === 'list' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setViewMode('list')}>📋 List</button>
        <button className={viewMode === 'calendar' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setViewMode('calendar')}>📅 Calendar</button>
      </div>

      {/* Filter */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All types</option>
          <option value="truck">Dump Truck</option>
          <option value="prime_mover">Prime Mover</option>
          <option value="car">Car</option>
          <option value="van">Van</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Calendar view */}
      {viewMode === 'calendar' && !loading && (() => {
        const [calYr, calMo] = calMonth.split('-').map(Number)
        const firstDay = new Date(calYr, calMo - 1, 1).getDay()
        const daysInMonth = new Date(calYr, calMo, 0).getDate()
        const calLabel = new Date(calYr, calMo - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

        // Map expiry dates -> records
        const expiryMap = {}
        records.forEach(r => {
          ;[r.or_expiry].filter(Boolean).forEach(dt => {
            if (dt?.startsWith(calMonth)) {
              const day = parseInt(dt.slice(8, 10))
              if (!expiryMap[day]) expiryMap[day] = []
              expiryMap[day].push({ ...r, _expField: 'OR' })
            }
          })
        })

        const cells = []
        for (let i = 0; i < firstDay; i++) cells.push(null)
        for (let d = 1; d <= daysInMonth; d++) cells.push(d)

        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <button className="btn-ghost btn-sm" onClick={() => { const d = new Date(calYr, calMo - 2, 1); setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }}>◀</button>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{calLabel}</span>
              <button className="btn-ghost btn-sm" onClick={() => { const d = new Date(calYr, calMo, 1); setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }}>▶</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                <div key={d} style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', fontWeight: 600 }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {cells.map((day, i) => {
                if (!day) return <div key={i} />
                const items = expiryMap[day] || []
                const today2 = new Date(); const isToday = day === today2.getDate() && calMo === today2.getMonth()+1 && calYr === today2.getFullYear()
                return (
                  <div key={day} style={{ minHeight: 52, padding: '4px 5px', borderRadius: 6, background: isToday ? 'var(--accent-light)' : items.length ? 'rgba(220,38,38,0.04)' : 'var(--bg)', border: `0.5px solid ${isToday ? 'var(--accent)' : items.length ? 'rgba(220,38,38,0.2)' : 'var(--border)'}` }}>
                    <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent)' : 'var(--text)', marginBottom: 2 }}>{day}</div>
                    {items.map((r, j) => {
                      const days = getDaysUntil(`${calMonth}-${String(day).padStart(2,'0')}`)
                      const color = days < 0 ? '#dc2626' : days <= reminderDays ? '#d97706' : '#15803d'
                      return <div key={j} title={`${r.vehicle_name} — ${r._expField} expiry`} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: color, color: '#fff', marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r._expField}: {r.plate_no}</div>
                    })}
                  </div>
                )
              })}
            </div>
            {Object.keys(expiryMap).length === 0 && <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>No expirations in {calLabel}.</p>}
          </div>
        )
      })()}

      {/* Records */}
      {loading ? <div className="empty-state"><p>Loading…</p></div> :
        viewMode === 'calendar' ? null : sorted.length === 0 ? <div className="empty-state"><p>No records found.</p></div> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Plate</th>
                  <th>Type</th>
                  <th>OR No.</th>
                  <th>OR Expiry</th>
                  <th>CR No.</th>
                  <th>CR Issued</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const orBadge = expiryBadge(r.or_expiry, reminderDays)
                  const isCritical = orBadge && getDaysUntil(r.or_expiry) < 0
                  return (
                    <tr key={r.id} style={{ background: isCritical ? 'rgba(220,38,38,0.03)' : 'transparent' }}>
                      <td style={{ fontWeight: 500 }}>{r.vehicle_name}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{r.plate_no}</td>
                      <td style={{ fontSize: 12 }}>{r.vehicle_type?.replace('_', ' ')}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.or_number || '—'}</td>
                      <td>
                        <div style={{ fontSize: 12 }}>{r.or_expiry ? fmtDate(r.or_expiry) : '—'}</div>
                        {orBadge && <span style={{ fontSize: 10, color: orBadge.color, background: orBadge.bg, padding: '1px 6px', borderRadius: 4, display: 'inline-block', marginTop: 2 }}>{orBadge.icon} {orBadge.label}</span>}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.cr_number || '—'}</td>
                      <td>
                        <div style={{ fontSize: 12 }}>{r.cr_expiry ? fmtDate(r.cr_expiry) : '—'}</div>
                        <div style={{ fontSize: 10, color:'var(--muted)' }}>CR issued date</div>
                      </td>
                      <td>
                        {isCritical
                          ? <span className="badge" style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626', fontSize: 10 }}>🔴 Action needed</span>
                          : <span className="badge badge-success" style={{ fontSize: 10 }}>✅ OK</span>
                        }
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-ghost btn-sm" onClick={() => { setEditingId(r.id); setForm({ ...r }); setShowForm(true) }}>Edit</button>
                          <button className="btn-danger btn-sm" onClick={() => setConfirmModal({ message: `Delete record for ${r.vehicle_name}?`, onConfirm: async () => { const { data, error } = await supabase.rpc('permanent_delete', { p_table: 'orcr_records', p_id: r.id }); if (error) showToast('Error: ' + error.message, 'error'); else { logAudit('destructive', 'Deleted', 'ORCR', `Deleted OR/CR record ${r.vehicle_name||''} ${r.plate_no||''}`, r.id, profile?.id, profile?.full_name); showToast('Deleted.', 'info'); fetchAll() } } })}>Del</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
      <SignatoryDialog open={sigDialog} onClose={()=>setSigDialog(false)} onPrint={doPrint} settings={settings} profile={profile} docType="OR/CR Report" />
      <Toast toast={toast} />
    </div>
  )
}
