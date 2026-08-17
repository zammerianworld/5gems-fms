import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, fmt, fmtDate, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'

// SMC trip_code stores supplier_amount + stripping_fee as VAT-inclusive; divide by 1.12 for net.
const pmNet = (t) => {
  const raw = (parseFloat(t.supplier_amount) || 0) + (parseFloat(t.stripping_fee) || 0)
  return t.trip_code === 'SMC' ? raw / 1.12 : raw
}
const dumpNet = (t) => (parseFloat(t.weight_tons) || 0) * (parseFloat(t.rate_per_ton) || 0)

const PaidBadge = ({ paid, label }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
    padding: '2px 8px', borderRadius: 20,
    color: paid ? 'var(--success)' : 'var(--muted)',
    background: paid ? 'rgba(22,163,74,0.1)' : 'rgba(148,163,184,0.15)',
  }}>{paid ? '✅' : '⏳'} {label}</span>
)

export default function MyTrips() {
  const { profile, viewerPlates } = useAuth()
  const [view, setView] = useState('trips')
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [expenses, setExpenses] = useState([])
  const [myInvoices, setMyInvoices] = useState([])
  const [shareCounts, setShareCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('dump')
  const [tripView, setTripView] = useState('invoice')
  const [expandedInvoice, setExpandedInvoice] = useState(null)
  const [month, setMonth] = useState('')
  const [sharesOverhead, setSharesOverhead] = useState(true) // default true avoids a misleading flash before the check resolves
  const [settings, setSettings] = useState({})
  const [creditedMap, setCreditedMap] = useState({})

  const fetchAll = useCallback(async () => {
    setLoading(true)
    // RLS already scopes trips/expenses to the logged-in viewer's own
    // plate(s) — no extra filtering is required (or trusted) client-side.
    // Invoices never come from the shared invoices table directly (one
    // invoice can cover multiple trucks) — get_my_invoices() returns only
    // this account's own trip totals per invoice.
    const [dt, pt, ex, inv, shares, st, cred] = await Promise.all([
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('expenses').select('*').order('expense_date', { ascending: false })),
      supabase.rpc('get_my_invoices'),
      supabase.rpc('viewer_shares_overhead'),
      supabase.from('company_settings').select('company_name').eq('id', 1).maybeSingle(),
      supabase.rpc('get_my_credited_amounts'),
    ])
    if (dt.data) setDumpTrips(dt.data)
    if (pt.data) setPmTrips(pt.data)
    if (ex.data) setExpenses(ex.data)
    if (inv.data) setMyInvoices(inv.data)
    if (typeof shares.data === 'boolean') setSharesOverhead(shares.data)
    if (st.data) setSettings(st.data)
    if (cred.data) {
      const map = {}
      cred.data.forEach(r => { map[`${r.trip_type}-${r.trip_id}`] = parseFloat(r.credited_amount) || 0 })
      setCreditedMap(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Default to whichever trip type actually has data for this account
  useEffect(() => {
    if (!loading && dumpTrips.length === 0 && pmTrips.length > 0) setTab('pm')
  }, [loading, dumpTrips.length, pmTrips.length])

  // Shared (scope='all') expenses need a per-date truck count to compute this
  // account's share — fetch it once per unique date that shows up.
  useEffect(() => {
    const sharedDates = [...new Set(expenses.filter(e => e.scope === 'all').map(e => e.expense_date))]
    const missing = sharedDates.filter(d => !(d in shareCounts))
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const results = await Promise.all(missing.map(d => supabase.rpc('expense_share_truck_count', { for_date: d })))
      if (cancelled) return
      setShareCounts(prev => {
        const next = { ...prev }
        missing.forEach((d, i) => { next[d] = results[i]?.data || 1 })
        return next
      })
    })()
    return () => { cancelled = true }
  }, [expenses])

  const filteredDump = useMemo(() => dumpTrips.filter(t => !month || t.trip_date?.startsWith(month)), [dumpTrips, month])
  const filteredPm = useMemo(() => pmTrips.filter(t => !month || t.trip_date?.startsWith(month)), [pmTrips, month])

  const filteredInvoices = useMemo(() => myInvoices.filter(i => !month || i.invoice_date?.startsWith(month)), [myInvoices, month])
  const tripsForInvoice = useCallback((invId) => [
    ...dumpTrips.filter(t => t.invoice_id === invId).map(t => ({ ...t, _kind: 'dump' })),
    ...pmTrips.filter(t => t.invoice_id === invId).map(t => ({ ...t, _kind: 'pm' })),
  ], [dumpTrips, pmTrips])
  const uninvoicedDump = useMemo(() => filteredDump.filter(t => !t.invoice_id), [filteredDump])
  const uninvoicedPm = useMemo(() => filteredPm.filter(t => !t.invoice_id), [filteredPm])

  const individualExpenses = useMemo(() => expenses.filter(e => e.scope === 'individual' && (!month || e.expense_date?.startsWith(month))), [expenses, month])
  const sharedExpenses = useMemo(() => expenses.filter(e => e.scope === 'all' && (!month || e.expense_date?.startsWith(month))), [expenses, month])
  const shareOf = (e) => (parseFloat(e.amount) || 0) / (shareCounts[e.expense_date] || 1)

  const netOf = (t, kind) => kind === 'dump' ? dumpNet(t) : pmNet(t)
  const credited = (t, kind) => {
    const v = creditedMap[`${kind}-${t.id}`]
    return v !== undefined ? v : netOf(t, kind) * 0.98 // fallback while RPC is loading
  }
  const whtOf = (t, kind) => netOf(t, kind) - credited(t, kind)

  const dumpTotal = filteredDump.reduce((s, t) => s + credited(t, 'dump'), 0)
  const pmTotal = filteredPm.reduce((s, t) => s + credited(t, 'pm'), 0)
  const rows = tab === 'dump' ? filteredDump : filteredPm
  const total = tab === 'dump' ? dumpTotal : pmTotal
  const paidCount = rows.filter(t => t.client_paid).length
  const settledCount = rows.filter(t => t.subcon_paid).length

  const individualTotal = individualExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const sharedShareTotal = sharesOverhead ? sharedExpenses.reduce((s, e) => s + shareOf(e), 0) : 0
  const totalExpenses = individualTotal + sharedShareTotal
  const tripIncome = dumpTotal + pmTotal
  const netAfterExpenses = tripIncome - totalExpenses

  const monthLabel = (ym) => ym ? new Date(ym + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) : 'All Time'
  const periodLabel = monthLabel(month)
  const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    const W = 215.9
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text(companyName, W / 2, 14, { align: 'center' })
    doc.setFontSize(11)
    doc.text('My Trips & Expenses', W / 2, 20, { align: 'center' })
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`${viewerPlates.join(', ') || 'No truck assigned'}  ·  ${periodLabel}`, W / 2, 26, { align: 'center' })

    let y = 34
    doc.setFontSize(9); doc.setFont('helvetica', 'bold')
    doc.text(`Trip Income: PHP ${fmt(tripIncome)}      Expenses: PHP ${fmt(totalExpenses)}      Net: PHP ${fmt(netAfterExpenses)}`, W / 2, y, { align: 'center' })
    y += 8

    if (filteredDump.length > 0) {
      doc.setFontSize(10); doc.text('Dump Truck Trips', 14, y); y += 2
      autoTable(doc, {
        startY: y, margin: { left: 14, right: 14 },
        head: [['Date', 'Truck', 'Route', 'Commodity', 'Weight (t)', 'Rate/t', 'Gross Sales', 'WHT (2%)', 'Net Total', 'Client Paid', 'Settled']],
        body: filteredDump.map(t => [
          fmtDate(t.trip_date), t.truck_plate, t.route, t.commodity,
          fmt(t.weight_tons), `PHP ${fmt(t.rate_per_ton)}`,
          `PHP ${fmt(netOf(t, 'dump'))}`, `PHP ${fmt(whtOf(t, 'dump'))}`, `PHP ${fmt(credited(t, 'dump'))}`,
          t.client_paid ? 'Paid' : 'Unpaid', t.subcon_paid ? 'Settled' : 'Pending',
        ]),
        styles: { fontSize: 7.5 }, headStyles: { fillColor: [31, 41, 55] },
      })
      y = doc.lastAutoTable.finalY + 8
    }

    if (filteredPm.length > 0) {
      if (y > 250) { doc.addPage(); y = 16 }
      doc.setFontSize(10); doc.text('Prime Mover Trips', 14, y); y += 2
      autoTable(doc, {
        startY: y, margin: { left: 14, right: 14 },
        head: [['Date', 'Truck', 'Trip Code', 'Size', 'Gross Sales', 'WHT (2%)', 'Net Total', 'Client Paid', 'Settled']],
        body: filteredPm.map(t => [
          fmtDate(t.trip_date), t.truck_plate, t.trip_code, t.container_size || '—',
          `PHP ${fmt(netOf(t, 'pm'))}`, `PHP ${fmt(whtOf(t, 'pm'))}`, `PHP ${fmt(credited(t, 'pm'))}`,
          t.client_paid ? 'Paid' : 'Unpaid', t.subcon_paid ? 'Settled' : 'Pending',
        ]),
        styles: { fontSize: 7.5 }, headStyles: { fillColor: [31, 41, 55] },
      })
      y = doc.lastAutoTable.finalY + 8
    }

    if (individualExpenses.length > 0) {
      if (y > 250) { doc.addPage(); y = 16 }
      doc.setFontSize(10); doc.text('Charged to Your Truck', 14, y); y += 2
      autoTable(doc, {
        startY: y, margin: { left: 14, right: 14 },
        head: [['Date', 'Category', 'Description', 'Amount']],
        body: individualExpenses.map(e => [fmtDate(e.expense_date), e.category, e.description, `PHP ${fmt(e.amount)}`]),
        foot: [['', '', 'Total', `PHP ${fmt(individualTotal)}`]],
        styles: { fontSize: 7.5 }, headStyles: { fillColor: [31, 41, 55] }, footStyles: { fillColor: [254, 249, 195], textColor: 0, fontStyle: 'bold' },
      })
      y = doc.lastAutoTable.finalY + 8
    }

    if (sharedExpenses.length > 0) {
      if (y > 240) { doc.addPage(); y = 16 }
      doc.setFontSize(10); doc.text('Shared Company Overhead', 14, y); y += 2
      doc.setFontSize(7.5); doc.setFont('helvetica', 'italic')
      doc.text(sharesOverhead ? 'Split evenly across all active company trucks each day, including yours.' : "Shown for transparency — your truck doesn't participate in shared overhead costs.", 14, y + 3)
      y += 6
      autoTable(doc, {
        startY: y, margin: { left: 14, right: 14 },
        head: [['Date', 'Category', 'Description', 'Full Amount', 'Trucks Sharing', 'Your Share']],
        body: sharedExpenses.map(e => [
          fmtDate(e.expense_date), e.category, e.description, `PHP ${fmt(e.amount)}`,
          sharesOverhead ? (shareCounts[e.expense_date] || '—') : '—',
          sharesOverhead ? `PHP ${fmt(shareOf(e))}` : 'N/A',
        ]),
        foot: [['', '', '', '', 'Your Share — Total', sharesOverhead ? `PHP ${fmt(sharedShareTotal)}` : 'PHP 0.00']],
        styles: { fontSize: 7.5 }, headStyles: { fillColor: [31, 41, 55] }, footStyles: { fillColor: [254, 249, 195], textColor: 0, fontStyle: 'bold' },
      })
    }

    doc.save(`My-Trips-Expenses-${month || 'All-Time'}.pdf`)
  }

  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook()
    const thin = { style: 'thin', color: { argb: 'FFAAAAAA' } }
    const allB = { top: thin, left: thin, bottom: thin, right: thin }
    const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
    const hdrFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }
    const addHeaderRow = (ws, rowNum, labels) => {
      const row = ws.getRow(rowNum)
      labels.forEach((l, i) => { const c = row.getCell(i + 1); c.value = l; c.font = hdrFont; c.fill = hdrFill; c.border = allB })
    }

    const tws = wb.addWorksheet('Trips')
    tws.mergeCells('A1:K1'); tws.getCell('A1').value = companyName; tws.getCell('A1').font = { bold: true, size: 13 }; tws.getCell('A1').alignment = { horizontal: 'center' }
    tws.mergeCells('A2:K2'); tws.getCell('A2').value = `MY TRIPS — ${periodLabel.toUpperCase()}`; tws.getCell('A2').font = { bold: true, size: 11 }; tws.getCell('A2').alignment = { horizontal: 'center' }
    tws.columns = [{ width: 12 }, { width: 8 }, { width: 12 }, { width: 20 }, { width: 12 }, { width: 20 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }]
    addHeaderRow(tws, 4, ['Date', 'Type', 'Truck', 'Route / Trip Code', 'Weight (t)', 'Commodity / Size', 'Gross Sales', 'WHT (2%)', 'Net Total', 'Client Paid', 'Settled'])
    let r = 5
    const allTrips = [
      ...filteredDump.map(t => ({ date: t.trip_date, type: 'Dump', truck: t.truck_plate, route: t.route, weight: t.weight_tons, extra: t.commodity, vatEx: netOf(t,'dump'), wht: whtOf(t,'dump'), netTotal: credited(t,'dump'), paid: t.client_paid, settled: t.subcon_paid })),
      ...filteredPm.map(t => ({ date: t.trip_date, type: 'PM', truck: t.truck_plate, route: t.trip_code, weight: '', extra: t.container_size, vatEx: netOf(t,'pm'), wht: whtOf(t,'pm'), netTotal: credited(t,'pm'), paid: t.client_paid, settled: t.subcon_paid })),
    ].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    allTrips.forEach(t => {
      const row = tws.getRow(r); const bg = (r % 2 === 0) ? 'FFFFFFFF' : 'FFF9FAFB'
      ;[fmtDate(t.date), t.type, t.truck, t.route, t.weight, t.extra, t.vatEx, t.wht, t.netTotal, t.paid ? 'Paid' : 'Unpaid', t.settled ? 'Settled' : 'Pending'].forEach((v, ci) => {
        const c = row.getCell(ci + 1); c.value = v; c.border = allB; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        if (ci >= 6 && ci <= 8) c.numFmt = '#,##0.00'
      })
      r++
    })
    const tTotalRow = tws.getRow(r)
    ;['', '', '', '', '', 'TOTAL', '', '', tripIncome, '', ''].forEach((v, ci) => {
      const c = tTotalRow.getCell(ci + 1); c.value = v; c.font = { bold: true }; c.border = allB; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } }
      if (ci === 8) c.numFmt = '#,##0.00'
    })
    tws.views = [{ showGridLines: false, state: 'frozen', ySplit: 4 }]

    const ews = wb.addWorksheet('Expenses')
    ews.mergeCells('A1:D1'); ews.getCell('A1').value = companyName; ews.getCell('A1').font = { bold: true, size: 13 }; ews.getCell('A1').alignment = { horizontal: 'center' }
    ews.mergeCells('A2:D2'); ews.getCell('A2').value = `MY EXPENSES — ${periodLabel.toUpperCase()}`; ews.getCell('A2').font = { bold: true, size: 11 }; ews.getCell('A2').alignment = { horizontal: 'center' }
    ews.columns = [{ width: 12 }, { width: 16 }, { width: 26 }, { width: 15 }]
    ews.getCell('A4').value = 'Charged to Your Truck'; ews.getCell('A4').font = { bold: true }
    addHeaderRow(ews, 5, ['Date', 'Category', 'Description', 'Amount'])
    let er = 6
    individualExpenses.forEach(e => {
      const row = ews.getRow(er); const bg = (er % 2 === 0) ? 'FFFFFFFF' : 'FFF9FAFB'
      ;[fmtDate(e.expense_date), e.category, e.description, parseFloat(e.amount) || 0].forEach((v, ci) => {
        const c = row.getCell(ci + 1); c.value = v; c.border = allB; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        if (ci === 3) c.numFmt = '#,##0.00'
      })
      er++
    })
    const iTotalRow = ews.getRow(er)
    ;['', '', 'Total', individualTotal].forEach((v, ci) => {
      const c = iTotalRow.getCell(ci + 1); c.value = v; c.font = { bold: true }; c.border = allB; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } }
      if (ci === 3) c.numFmt = '#,##0.00'
    })
    er += 2
    ews.getCell(`A${er}`).value = 'Shared Company Overhead'; ews.getCell(`A${er}`).font = { bold: true }; er++
    ews.getCell(`A${er}`).value = sharesOverhead ? 'Split evenly across all active company trucks each day, including yours.' : "Shown for transparency — your truck doesn't participate in shared overhead costs."
    ews.getCell(`A${er}`).font = { italic: true, size: 9 }; er++
    addHeaderRow(ews, er, ['Date', 'Category', 'Description', 'Amount']); er++
    ews.getCell(`E${er - 1}`).value = 'Trucks Sharing'; ews.getCell(`E${er - 1}`).font = hdrFont; ews.getCell(`E${er - 1}`).fill = hdrFill; ews.getCell(`E${er - 1}`).border = allB
    ews.getCell(`F${er - 1}`).value = 'Your Share'; ews.getCell(`F${er - 1}`).font = hdrFont; ews.getCell(`F${er - 1}`).fill = hdrFill; ews.getCell(`F${er - 1}`).border = allB
    ews.getColumn(5).width = 14; ews.getColumn(6).width = 14
    sharedExpenses.forEach(e => {
      const row = ews.getRow(er); const bg = (er % 2 === 0) ? 'FFFFFFFF' : 'FFF9FAFB'
      const vals = [fmtDate(e.expense_date), e.category, e.description, parseFloat(e.amount) || 0, sharesOverhead ? (shareCounts[e.expense_date] || '') : '—', sharesOverhead ? shareOf(e) : 0]
      vals.forEach((v, ci) => {
        const c = row.getCell(ci + 1); c.value = v; c.border = allB; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        if (ci === 3 || ci === 5) c.numFmt = '#,##0.00'
      })
      er++
    })
    const sTotalRow = ews.getRow(er)
    ;['', '', '', '', 'Your Share — Total', sharesOverhead ? sharedShareTotal : 0].forEach((v, ci) => {
      const c = sTotalRow.getCell(ci + 1); c.value = v; c.font = { bold: true }; c.border = allB; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } }
      if (ci === 5) c.numFmt = '#,##0.00'
    })
    ews.views = [{ showGridLines: false }]

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `My-Trips-Expenses-${month || 'All-Time'}.xlsx`; a.click(); URL.revokeObjectURL(url)
  }

  if (loading) return <div className="page"><div className="empty-state"><p>Loading your account…</p></div></div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Trips & Expenses</h1>
          <p className="page-sub">
            {profile?.full_name ? `${profile.full_name} · ` : ''}
            {viewerPlates.length > 0 ? `Truck${viewerPlates.length > 1 ? 's' : ''}: ${viewerPlates.join(', ')}` : 'No truck assigned yet — contact the office'}
          </p>
        </div>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ maxWidth: 170 }} />
      </div>

      <div style={{ padding: '8px 12px', background: 'var(--accent-light)', borderRadius: 6, fontSize: 12, color: 'var(--accent-dark)', marginBottom: 18 }}>
        ℹ️ Read-only view of your own trips and expenses. For questions about any figure here, please contact the office.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[{ key: 'trips', label: '🚛 Trips' }, { key: 'expenses', label: '💸 Expenses' }].map(o => (
          <button key={o.key} onClick={() => setView(o.key)} style={{
            padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: view === o.key ? 'var(--accent)' : 'var(--surface)',
            color: view === o.key ? '#fff' : 'var(--muted)',
            border: `1.5px solid ${view === o.key ? 'var(--accent)' : 'var(--border)'}`,
          }}>{o.label}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn-ghost btn-sm" onClick={handleExportPDF}>📄 Export PDF</button>
          <button className="btn-ghost btn-sm" onClick={handleExportExcel}>📊 Export Excel</button>
        </div>
      </div>

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card"><div className="muted" style={{ fontSize: 11 }}>Trip Income</div><div style={{ fontSize: 20, fontWeight: 700 }}>₱{fmt(tripIncome)}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: 11 }}>Expenses</div><div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>₱{fmt(totalExpenses)}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: 11 }}>Net (after expenses)</div><div style={{ fontSize: 20, fontWeight: 700, color: netAfterExpenses >= 0 ? 'var(--success)' : 'var(--danger)' }}>₱{fmt(netAfterExpenses)}</div></div>
      </div>

      {view === 'trips' ? (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[{ key: 'invoice', label: '🧾 By Invoice' }, { key: 'flat', label: '📋 All Trips' }].map(o => (
              <button key={o.key} onClick={() => setTripView(o.key)} style={{
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: tripView === o.key ? 'var(--accent)' : 'var(--surface)',
                color: tripView === o.key ? '#fff' : 'var(--muted)',
                border: `1.5px solid ${tripView === o.key ? 'var(--accent)' : 'var(--border)'}`,
              }}>{o.label}</button>
            ))}
          </div>

          {tripView === 'invoice' ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {filteredInvoices.length === 0 && uninvoicedDump.length === 0 && uninvoicedPm.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}><p className="muted">No invoices or trips found for this period.</p></div>
              ) : (
                <>
                  {filteredInvoices.map(inv => {
                    const isOpen = expandedInvoice === inv.invoice_id
                    const trips = tripsForInvoice(inv.invoice_id)
                    return (
                      <div key={inv.invoice_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <div onClick={() => setExpandedInvoice(isOpen ? null : inv.invoice_id)}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer' }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>{inv.invoice_no || 'Invoice'}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{fmtDate(inv.invoice_date)} · {inv.my_trip_count} trip{inv.my_trip_count > 1 ? 's' : ''}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{ textAlign: 'right' }}>
                              <div className="mono" style={{ fontWeight: 700 }}>₱{fmt(inv.my_amount)}</div>
                              <PaidBadge paid={inv.status === 'Paid'} label={inv.status === 'Paid' ? (inv.date_credited ? fmtDate(inv.date_credited) : 'Paid') : inv.status} />
                            </div>
                            <span className="muted">{isOpen ? '▲' : '▼'}</span>
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ padding: '0 16px 16px' }}>
                            <div className="table-wrap">
                              <table className="table">
                                <thead>
                                  <tr><th>Date</th><th>Truck</th><th>Route / Trip Code</th><th className="text-right">Credited Amount</th><th>Settled to You</th></tr>
                                </thead>
                                <tbody>
                                  {trips.map(t => (
                                    <tr key={t._kind + t.id}>
                                      <td>{fmtDate(t.trip_date)}</td>
                                      <td style={{ fontWeight: 600 }}>{t.truck_plate}</td>
                                      <td>{t._kind === 'dump' ? t.route : t.trip_code}</td>
                                      <td className="text-right mono">₱{fmt(credited(t, t._kind))}</td>
                                      <td><PaidBadge paid={t.subcon_paid} label={t.subcon_paid ? (t.subcon_paid_date ? fmtDate(t.subcon_paid_date) : 'Settled') : 'Pending'} /></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {(uninvoicedDump.length > 0 || uninvoicedPm.length > 0) && (
                    <div style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>⏳ Not Yet Invoiced</div>
                      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{uninvoicedDump.length + uninvoicedPm.length} trip(s) not yet on an invoice</div>
                      <div className="table-wrap">
                        <table className="table">
                          <thead><tr><th>Date</th><th>Truck</th><th>Route / Trip Code</th><th className="text-right">Credited Amount</th></tr></thead>
                          <tbody>
                            {[...uninvoicedDump.map(t => ({ ...t, _kind: 'dump' })), ...uninvoicedPm.map(t => ({ ...t, _kind: 'pm' }))]
                              .sort((a, b) => (b.trip_date || '').localeCompare(a.trip_date || ''))
                              .map(t => (
                                <tr key={t._kind + t.id}>
                                  <td>{fmtDate(t.trip_date)}</td>
                                  <td style={{ fontWeight: 600 }}>{t.truck_plate}</td>
                                  <td>{t._kind === 'dump' ? t.route : t.trip_code}</td>
                                  <td className="text-right mono">₱{fmt(credited(t, t._kind))}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
          {(dumpTrips.length > 0 && pmTrips.length > 0) && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[{ key: 'dump', label: '🚛 Dump Truck Trips' }, { key: 'pm', label: '📦 Prime Mover Trips' }].map(o => (
                <button key={o.key} onClick={() => setTab(o.key)} style={{
                  padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  background: tab === o.key ? 'var(--accent)' : 'var(--surface)',
                  color: tab === o.key ? '#fff' : 'var(--muted)',
                  border: `1.5px solid ${tab === o.key ? 'var(--accent)' : 'var(--border)'}`,
                }}>{o.label}</button>
              ))}
            </div>
          )}

          <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div className="card"><div className="muted" style={{ fontSize: 11 }}>Trips</div><div style={{ fontSize: 22, fontWeight: 700 }}>{rows.length}</div></div>
            <div className="card"><div className="muted" style={{ fontSize: 11 }}>Total Amount</div><div style={{ fontSize: 22, fontWeight: 700 }}>₱{fmt(total)}</div></div>
            <div className="card"><div className="muted" style={{ fontSize: 11 }}>Client Paid</div><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--success)' }}>{paidCount} / {rows.length}</div></div>
            <div className="card"><div className="muted" style={{ fontSize: 11 }}>Settled to You</div><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--success)' }}>{settledCount} / {rows.length}</div></div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                {tab === 'dump' ? (
                  <>
                    <thead>
                      <tr>
                        <th>Date</th><th>Truck</th><th>Route</th><th>Commodity</th>
                        <th className="text-right">Weight (t)</th><th className="text-right">Rate/t</th>
                        <th className="text-right">Credited Amount</th><th>Client Paid</th><th>Settled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDump.length === 0 ? (
                        <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>No trips found for this period.</td></tr>
                      ) : filteredDump.map(t => (
                        <tr key={t.id}>
                          <td>{fmtDate(t.trip_date)}</td>
                          <td style={{ fontWeight: 600 }}>{t.truck_plate}</td>
                          <td>{t.route}</td>
                          <td>{t.commodity}</td>
                          <td className="text-right mono">{fmt(t.weight_tons)}</td>
                          <td className="text-right mono">₱{fmt(t.rate_per_ton)}</td>
                          <td className="text-right mono" style={{ fontWeight: 600 }}>₱{fmt(credited(t, 'dump'))}</td>
                          <td><PaidBadge paid={t.client_paid} label={t.client_paid ? (t.client_paid_date ? fmtDate(t.client_paid_date) : 'Paid') : 'Unpaid'} /></td>
                          <td><PaidBadge paid={t.subcon_paid} label={t.subcon_paid ? (t.subcon_paid_date ? fmtDate(t.subcon_paid_date) : 'Settled') : 'Pending'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th>Date</th><th>Truck</th><th>Trip Code</th><th>Size</th>
                        <th className="text-right">Credited Amount</th><th>Client Paid</th><th>Settled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPm.length === 0 ? (
                        <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>No trips found for this period.</td></tr>
                      ) : filteredPm.map(t => (
                        <tr key={t.id}>
                          <td>{fmtDate(t.trip_date)}</td>
                          <td style={{ fontWeight: 600 }}>{t.truck_plate}</td>
                          <td>{t.trip_code}</td>
                          <td>{t.container_size || '—'}</td>
                          <td className="text-right mono" style={{ fontWeight: 600 }}>₱{fmt(credited(t, 'pm'))}</td>
                          <td><PaidBadge paid={t.client_paid} label={t.client_paid ? (t.client_paid_date ? fmtDate(t.client_paid_date) : 'Paid') : 'Unpaid'} /></td>
                          <td><PaidBadge paid={t.subcon_paid} label={t.subcon_paid ? (t.subcon_paid_date ? fmtDate(t.subcon_paid_date) : 'Settled') : 'Pending'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>
            </>
          )}
        </>
      ) : (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Charged to Your Truck</h3>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Date</th><th>Category</th><th>Description</th><th className="text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {individualExpenses.length === 0 ? (
                    <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}>No expenses charged to your truck for this period.</td></tr>
                  ) : individualExpenses.map(e => (
                    <tr key={e.id}>
                      <td>{fmtDate(e.expense_date)}</td>
                      <td>{e.category}</td>
                      <td>{e.description}</td>
                      <td className="text-right mono">₱{fmt(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {individualExpenses.length > 0 && (
                  <tfoot>
                    <tr style={{ background: 'var(--accent-light)' }}>
                      <td colSpan={3} style={{ fontWeight: 700 }}>Total</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(individualTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Shared Company Overhead</h3>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
            {sharesOverhead
              ? 'Split evenly across all active company trucks each day, including yours.'
              : "Shown for transparency — your truck doesn't participate in shared overhead costs, so none of this is deducted from you."}
          </p>
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Date</th><th>Category</th><th>Description</th><th className="text-right">Full Amount</th><th className="text-right">Trucks Sharing</th><th className="text-right">Your Share</th></tr>
                </thead>
                <tbody>
                  {sharedExpenses.length === 0 ? (
                    <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No shared expenses for this period.</td></tr>
                  ) : sharedExpenses.map(e => (
                    <tr key={e.id}>
                      <td>{fmtDate(e.expense_date)}</td>
                      <td>{e.category}</td>
                      <td>{e.description}</td>
                      <td className="text-right mono">₱{fmt(e.amount)}</td>
                      <td className="text-right mono muted">{sharesOverhead ? (shareCounts[e.expense_date] || '…') : '—'}</td>
                      <td className="text-right mono" style={{ fontWeight: 600 }}>{sharesOverhead ? `₱${fmt(shareOf(e))}` : 'Not applicable'}</td>
                    </tr>
                  ))}
                </tbody>
                {sharedExpenses.length > 0 && (
                  <tfoot>
                    <tr style={{ background: 'var(--accent-light)' }}>
                      <td colSpan={5} style={{ fontWeight: 700 }}>Your Share — Total</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(sharedShareTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
