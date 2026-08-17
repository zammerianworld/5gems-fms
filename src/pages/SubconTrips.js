import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fmtDate, sortRows, logAudit, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import SignatoryDialog from '../components/SignatoryDialog'
import { useToast, Toast } from '../components/Toast'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'
const today = () => new Date().toISOString().slice(0, 10)
const currentMonth = () => new Date().toISOString().slice(0, 7)
const pf = (n) => 'P' + Number(n||0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const getPaymentStatus = (t, tab) => {
  const clientPaid = t.client_paid
  const subconPaid = t.subcon_paid
  if (tab === 'special') {
    if (clientPaid) return { label: '✅ Client Paid', color: '#15803d', bg: 'rgba(22,163,74,0.1)' }
    return { label: '⏳ Unpaid', color: '#a16207', bg: 'rgba(234,179,8,0.1)' }
  }
  if (clientPaid && subconPaid) return { label: '✅ Fully Settled', color: '#15803d', bg: 'rgba(22,163,74,0.1)' }
  if (clientPaid && !subconPaid) return { label: '🔵 Client Paid', color: '#1d4ed8', bg: 'rgba(29,78,216,0.1)' }
  if (!clientPaid && subconPaid) return { label: '🟠 Advanced', color: '#c2410c', bg: 'rgba(194,65,12,0.1)' }
  return { label: '⏳ Unpaid', color: '#a16207', bg: 'rgba(234,179,8,0.1)' }
}
export default function SubconTrips() {
  const { profile } = useAuth()
  const { toast, showToast } = useToast()
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [trucks, setTrucks] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [subconTab, setSubconTab] = useState('regular')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterCreditMonth, setFilterCreditMonth] = useState('')
  const [filterTruck, setFilterTruck] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [editingTrip, setEditingTrip] = useState(null)
  const [bulkSelected, setBulkSelected] = useState([])
  const [expandedInvoices, setExpandedInvoices] = useState(new Set())
  const [groupByInvoice, setGroupByInvoice] = useState(false)
  const toggleInvoice = (invId) => setExpandedInvoices(s => { const n = new Set(s); n.has(invId) ? n.delete(invId) : n.add(invId); return n })
  const [sortKey, setSortKey] = useState('trip_date')
  const [sortDir, setSortDir] = useState('desc')
  const toggleSort = (k) => { setSortKey(k); setSortDir(d => k === sortKey ? (d === 'asc' ? 'desc' : 'asc') : 'desc') }
  const [bulkPaidDate, setBulkPaidDate] = useState(new Date().toISOString().slice(0,10))
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkSubconVoucher, setBulkSubconVoucher] = useState('')
  const [bulkSubconDate, setBulkSubconDate] = useState(new Date().toISOString().slice(0,10))
  const [bulkSubconSaving, setBulkSubconSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expenses, setExpenses] = useState([])
  const [amortizations, setAmortizations] = useState([])
  const [insurances, setInsurances] = useState([])
  const [allCompanyTrucks, setAllCompanyTrucks] = useState([])
  const [printMode, setPrintMode] = useState(null)
  const [printInvoice, setPrintInvoice] = useState('')
  const [printCreditMonth, setPrintCreditMonth] = useState(currentMonth())
  const [printOrientation, setPrintOrientation] = useState('landscape')
  const [sigDialog, setSigDialog] = useState(false)
  const [pendingPrintFn, setPendingPrintFn] = useState(null)
  const [settings, setSettings] = useState({})
  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [tr, dt, pt, inv, exp, am, ins, allTr, stg] = await Promise.all([
      supabase.from('trucks').select('id,plate,truck_type,ownership,subcon_name,start_date,end_date').in('ownership', ['subcon', 'special_subcon']),
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('invoices').select('id,invoice_no,status,date_credited,client,actual_amount_credited,total_sales_net').is('deleted_at', null).order('invoice_date', { ascending: false })),
      fetchAllRows(() => supabase.from('expenses').select('*').is('deleted_at', null)),
      supabase.from('amortizations').select('*'),
      supabase.from('insurances').select('*'),
      supabase.from('trucks').select('id,plate,ownership,start_date,end_date').neq('ownership', 'subcon'),
      supabase.from('company_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    const subconPlates = new Set((tr.data || []).map(t => t.plate))
    if (dt.data) setDumpTrips(dt.data.filter(t => subconPlates.has(t.truck_plate)))
    if (pt.data) setPmTrips(pt.data.filter(t => subconPlates.has(t.truck_plate)))
    if (tr.data) setTrucks(tr.data)
    if (inv.data) setInvoices(inv.data)
    if (exp.data) setExpenses(exp.data)
    if (am.data) setAmortizations(am.data)
    if (ins.data) setInsurances(ins.data)
    // Admin/shared-expense divisor for special_subcon trucks' own share calc:
    // includes OTHER special_subcon trucks too — they all share in general
    // overhead together with owned trucks, only true third-party subcon is excluded.
    if (allTr.data) setAllCompanyTrucks(allTr.data.filter(t => t.ownership !== 'subcon'))
    if (stg.data) setSettings(stg.data)
    setLoading(false)
  }, [])
  useEffect(() => { fetchAll() }, [fetchAll])
  const invoiceMap = Object.fromEntries(invoices.map(i => [i.id, i]))
  const enrichTrip = (t) => {
    const inv = invoiceMap[t.invoice_id]
    if (inv && inv.status === 'Paid' && !t.client_paid) {
      return { ...t, client_paid: true, client_paid_date: t.client_paid_date || inv.date_credited }
    }
    return t
  }
  const getPartnerName = (plate) => trucks.find(t => t.plate === plate)?.subcon_name || '—'
  // ── AUTO EXPENSE SHARE CALCULATOR ──────────────────────────────────────────
  // Computes the special_subcon truck's share of admin+fleet expenses for a given month
  const calcExpenseShare = (truckId, tripMonth) => {
    if (!tripMonth) return 0
    const ym = tripMonth.slice(0, 7)
    // Active company trucks on the expense date (for division)
    const getCount = (date) => {
      const d = date || ym + '-01'
      const count = allCompanyTrucks.filter(t => {
        const start = t.start_date || '2024-01-01'
        const end = t.end_date || '9999-12-31'
        return d >= start && d <= end
      }).length
      return count || 1
    }
    // Admin expenses in the month
    const adminTotal = expenses
      .filter(e => e.expense_type === 'admin' && e.expense_date?.startsWith(ym))
      .reduce((s, e) => s + (e.amount || 0) / getCount(e.expense_date), 0)
    // Fleet-wide operation expenses in the month
    const opTotal = expenses
      .filter(e => e.expense_type === 'operation' && e.scope === 'all' && e.expense_date?.startsWith(ym))
      .reduce((s, e) => s + (e.amount || 0) / getCount(e.expense_date), 0)
    // Amortization for this truck in the month
    const amortTotal = amortizations
      .filter(a => a.truck_id === truckId && a.start_date?.slice(0,7) <= ym && (!a.end_date || a.end_date?.slice(0,7) >= ym))
      .reduce((s, a) => s + (a.monthly_amount || 0), 0)
    // Insurance for this truck in the month
    const insTotal = insurances
      .filter(ins => {
        if (!ins.truck_ids?.includes(truckId)) return false
        const start = new Date(ins.start_date)
        const end = new Date(start); end.setMonth(end.getMonth() + 12)
        return new Date(ym + '-01') >= start && new Date(ym + '-01') < end
      })
      .reduce((s, ins) => s + (ins.annual_amount || 0) / (ins.truck_ids?.length || 1) / 12, 0)
    return adminTotal + opTotal + amortTotal + insTotal
  }

  const getTripAmount = (t, type) => type === 'dump'
    ? (t.weight_tons || 0) * (t.rate_per_ton || 0)
    : (t.trip_code === 'SMC' ? ((t.supplier_amount || 0) + (t.stripping_fee || 0)) / 1.12 : (t.supplier_amount || 0) + (t.stripping_fee || 0))
  const regularTrucks = trucks.filter(t => t.ownership === 'subcon')
  const specialTrucks = trucks.filter(t => t.ownership === 'special_subcon')
  const subconTrucks = subconTab === 'regular' ? regularTrucks : specialTrucks
  const subconPlateSet = new Set(subconTrucks.map(t => t.plate))
  // "Collected"/"Credited"/"DS Billing" for special subcon reflects what Paid
  // Invoices actually shows as collected from the client (see creditedAmount
  // above). Regular subcon's cost/profit margin intentionally stays on the
  // net basis, since VAT/WHT aren't real profit, they're a pass-through.
  const billingAmount = (t) => subconTab === 'special' ? t._vatIncAmount : t._amount
  // Backed into from net minus the actual credited amount (real or
  // estimated), rather than a flat 2% of net — stays accurate even when a
  // real actual_amount_credited doesn't land exactly on the standard formula.
  // Backed into from the invoice's VAT-inclusive-or-net amount minus the
  // actual credited amount (real or estimated) — for a VAT invoice, credited
  // can exceed net, so this must subtract from the VAT-inclusive figure, not
  // bare net, or WHT would compute negative.
  const whtAmount = (t) => {
    const inv = invoiceMap[t.invoice_id]
    const gross = inv?.is_vat ? t._amount * 1.12 : t._amount
    return gross - t._vatIncAmount
  }
  // Each invoice's total net across ALL its linked trips (any truck), needed to
  // proportion a real actual_amount_credited down to a single trip's share.
  const invoiceNetTotals = {}
  dumpTrips.forEach(t => { if (t.invoice_id) invoiceNetTotals[t.invoice_id] = (invoiceNetTotals[t.invoice_id] || 0) + getTripAmount(t, 'dump') })
  pmTrips.forEach(t => { if (t.invoice_id) invoiceNetTotals[t.invoice_id] = (invoiceNetTotals[t.invoice_id] || 0) + getTripAmount(t, 'pm') })
  // Always base "credited" on what Paid Invoices actually shows for that
  // invoice: the real actual_amount_credited (prorated by this trip's share
  // of the invoice's total net) when present, otherwise the same estimate
  // Paid Invoices itself falls back to — VAT invoices: net×1.12−net×0.02 =
  // net×1.10; Non-VAT: net−net×0.02 = net×0.98.
  const creditedAmount = (t, amt) => {
    const inv = invoiceMap[t.invoice_id]
    const invNet = invoiceNetTotals[t.invoice_id] || 0
    const realCredited = inv && parseFloat(inv.actual_amount_credited)
    if (realCredited && invNet > 0) return (amt / invNet) * parseFloat(inv.actual_amount_credited)
    return amt * (inv?.is_vat ? 1.10 : 0.98)
  }
  // FIX 1: renamed to enrichedTrips to avoid conflict with Running Balance's allTrips
  const enrichedTrips = [
    ...dumpTrips.map(t => { const amt = getTripAmount(t, 'dump'); return enrichTrip({ ...t, _type: 'dump', _amount: amt, _vatIncAmount: creditedAmount(t, amt) }) }),
    ...pmTrips.map(t => { const amt = getTripAmount(t, 'pm'); return enrichTrip({ ...t, _type: 'pm', _amount: amt, _vatIncAmount: creditedAmount(t, amt) }) }),
  ].sort((a, b) => b.trip_date?.localeCompare(a.trip_date))
  const applyFilters = (trips) => trips.filter(t => {
    if (!subconPlateSet.has(t.truck_plate)) return false
    if (filterMonth && !t.trip_date?.startsWith(filterMonth)) return false
    if (filterCreditMonth) {
      const creditDate = t.client_paid_date || invoiceMap[t.invoice_id]?.date_credited || ''
      if (creditDate?.slice(0, 7) !== filterCreditMonth) return false
    }
    if (filterTruck && t.truck_plate !== filterTruck) return false
    if (search && ![t.truck_plate, t.client, t.trip_code, t.route].some(v => v?.toLowerCase().includes(search.toLowerCase()))) return false
    if (filterStatus === 'client_paid' && !t.client_paid) return false
    if (filterStatus === 'subcon_paid' && !t.subcon_paid) return false
    if (filterStatus === 'fully_settled' && !(t.client_paid && t.subcon_paid)) return false
    if (filterStatus === 'unpaid' && (t.client_paid || t.subcon_paid)) return false
    return true
  })
  const filtered = sortRows(applyFilters(enrichedTrips), sortKey, sortDir)
  const totalBilled = filtered.reduce((s, t) => s + t._amount, 0)
  const totalCollected = filtered.filter(t => t.client_paid).reduce((s, t) => s + billingAmount(t), 0)
  const totalSubconCost = filtered.reduce((s, t) => s + (t.subcon_cost || 0), 0)
  const totalSubconPaid = filtered.filter(t => t.subcon_paid).reduce((s, t) => s + (t.subcon_cost || 0), 0)
  const totalProfit = totalBilled - totalSubconCost
  const netHolding = totalCollected - totalSubconPaid
  const totalExpenseShare = filtered.reduce((s, t) => s + (t.subcon_expense_share || 0), 0)
  const totalCredited = filtered.filter(t => t.client_paid).reduce((s, t) => s + (t._vatIncAmount - (t.subcon_expense_share || 0)), 0)
  const handleBulkClientPaid = async () => {
    if (!bulkSelected.length) return
    setBulkSaving(true)
    const dumpIds = bulkSelected.filter(s => s._type === 'dump').map(s => s.id)
    const pmIds = bulkSelected.filter(s => s._type === 'pm').map(s => s.id)
    const payload = { client_paid: true, client_paid_date: bulkPaidDate }
    if (dumpIds.length) await supabase.from('trips_dump').update(payload).in('id', dumpIds)
    if (pmIds.length) await supabase.from('trips_pm').update(payload).in('id', pmIds)
    showToast(`${bulkSelected.length} trips marked as client paid.`)
    setBulkSelected([]); setBulkSaving(false); fetchAll()
  }
  const handleBulkSubconPaid = async () => {
    const eligible = bulkSelected.filter(t => !t.subcon_paid)
    if (!eligible.length) return
    setBulkSubconSaving(true)
    const dumpIds = eligible.filter(s => s._type === 'dump').map(s => s.id)
    const pmIds = eligible.filter(s => s._type === 'pm').map(s => s.id)
    const payload = { subcon_paid: true, subcon_paid_date: bulkSubconDate, subcon_voucher_no: bulkSubconVoucher || '' }
    if (dumpIds.length) await supabase.from('trips_dump').update(payload).in('id', dumpIds)
    if (pmIds.length) await supabase.from('trips_pm').update(payload).in('id', pmIds)
    showToast(`${eligible.length} trips marked as sub-con paid.`)
    setBulkSelected([]); setBulkSubconSaving(false); fetchAll()
  }
  const handleSave = async () => {
    if (!editingTrip) return
    setSaving(true)
    const tbl = editingTrip._type === 'dump' ? 'trips_dump' : 'trips_pm'
    const payload = {
      subcon_cost: parseFloat(editingTrip.subcon_cost) || 0,
      subcon_paid: editingTrip.subcon_paid || false,
      subcon_paid_date: editingTrip.subcon_paid ? (editingTrip.subcon_paid_date || today()) : null,
      subcon_paid_notes: editingTrip.subcon_paid_notes || '',
      subcon_voucher_no: editingTrip.subcon_voucher_no || '',
      client_paid: editingTrip.client_paid || false,
      client_paid_date: editingTrip.client_paid ? (editingTrip.client_paid_date || today()) : null,
      subcon_expense_share: parseFloat(editingTrip.subcon_expense_share) || 0,
    }
    const { error } = await supabase.from(tbl).update(payload).eq('id', editingTrip.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { logAudit('destructive', 'Updated', 'Sub-con Trips', `Updated sub-con trip`, editingTrip?.id||'', profile?.id, profile?.full_name); showToast('Updated.'); setEditingTrip(null); fetchAll() }
    setSaving(false)
  }
  const buildPDF = (rows, title, subtitle, cols, totals, orientation = 'landscape') => {
    const isLandscape = orientation === 'landscape'
    const doc = new jsPDF({ orientation, unit: 'mm', format: 'letter' })
    const W = isLandscape ? 279.4 : 215.9
    doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text((settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase(), W / 2, 12, { align: 'center' })
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    doc.text(title, W / 2, 18, { align: 'center' })
    if (subtitle) { doc.setFontSize(8); doc.text(subtitle, W / 2, 23, { align: 'center' }) }
    doc.setDrawColor(200); doc.line(10, subtitle ? 27 : 23, W - 10, subtitle ? 27 : 23)
    autoTable(doc, {
      startY: subtitle ? 30 : 26, head: [cols], body: rows,
      headStyles: { fillColor: [255,30,0], fontSize: 7, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      margin: { left: 10, right: 10 },
    })
    let finalY = doc.lastAutoTable.finalY
    if (totals) { doc.setFontSize(7.5); doc.text(totals, 10, finalY + 5); finalY += 5 }
    doc._pendingSigY = finalY + 10
    return doc
  }
  const addSigsToDoc = (doc, sigs, W) => {
    if (!sigs || sigs.length === 0) return
    const pageH = doc.internal.pageSize.getHeight()
    let sigY = doc._pendingSigY || (pageH - 30)
    if (sigY + 28 > pageH - 6) { doc.addPage(); sigY = 14 }
    const perSlot = (W - 28) / sigs.length
    sigs.forEach((s, idx) => {
      const slotX = 14 + idx * perSlot + perSlot / 2
      doc.setFontSize(5.5); doc.setFont(undefined, 'normal'); doc.setTextColor(120)
      doc.text(`${s.label}:`, slotX, sigY, { align: 'center' })
      doc.setDrawColor(150); doc.line(slotX - 28, sigY + 7, slotX + 28, sigY + 7)
      doc.setFont(undefined, 'bold'); doc.setFontSize(7); doc.setTextColor(0)
      doc.text((s.name || '').toUpperCase(), slotX, sigY + 11, { align: 'center' })
      doc.setFont(undefined, 'normal'); doc.setFontSize(6); doc.setTextColor(255,30,0)
      doc.text(s.title || '', slotX, sigY + 15, { align: 'center' })
      doc.setTextColor(0)
    })
  }
  const regCols = ['Date', 'Plate', 'Partner', 'Client', 'Invoice', 'Type', 'DS Billing', 'Sub-con Cost', 'Profit', 'Client Paid', 'Sub-con Paid', 'CV/Check No.']
  const spcCols = ['Date', 'Plate', 'Partner', 'Client', 'Invoice', 'Type', 'Gross Sales', 'WHT (2%)', 'Net Total', 'Exp. Share', 'Net Credited', 'Client Paid', 'CV/Check No.']
  const toRegRow = (t) => {
    const inv = invoiceMap[t.invoice_id]
    return [fmtDate(t.trip_date), t.truck_plate, getPartnerName(t.truck_plate), t.client || '—',
      inv?.invoice_no || '—', t._type === 'dump' ? 'Dump' : 'PM',
      pf(t._amount), pf(t.subcon_cost || 0), pf(t._amount - (t.subcon_cost || 0)),
      t.client_paid ? (t.client_paid_date ? fmtDate(t.client_paid_date) : 'Yes') : '—',
      t.subcon_paid ? (t.subcon_paid_date ? fmtDate(t.subcon_paid_date) : 'Yes') : '—',
      t.subcon_voucher_no || '—']
  }
  const toSpcRow = (t) => {
    const inv = invoiceMap[t.invoice_id]
    return [fmtDate(t.trip_date), t.truck_plate, getPartnerName(t.truck_plate), t.client || '—',
      inv?.invoice_no || '—', t._type === 'dump' ? 'Dump' : 'PM',
      pf(t._amount), pf(whtAmount(t)), pf(t._vatIncAmount),
      pf(t.subcon_expense_share || 0), pf(t._vatIncAmount - (t.subcon_expense_share || 0)),
      t.client_paid ? (t.client_paid_date ? fmtDate(t.client_paid_date) : 'Yes') : '—',
      t.subcon_voucher_no || '—']
  }
  const r2 = (n) => Math.round((n||0) * 100) / 100

  const buildExcelSheet = (wb, sheetName, title, subtitle, headers, rows, sigs) => {
    const COLS = headers.length
    const ws = wb.addWorksheet(sheetName.slice(0,31))
    ws.columns = headers.map((h,i) => ({ width: i===0 ? 12 : h.toLowerCase().includes('client')||h.toLowerCase().includes('partner') ? 18 : 14 }))
    const thin = { style:'thin', color:{argb:'FFAAAAAA'} }
    const allBorders = { top:thin, left:thin, bottom:thin, right:thin }
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()

    let r = 1
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = companyName
    ws.getCell(r,1).font = { bold:true, size:13 }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    r++
    if (settings.vat_tin) { ws.mergeCells(r,1,r,COLS); ws.getCell(r,1).value=`VAT REG.TIN: ${settings.vat_tin}`; ws.getCell(r,1).font={size:8}; ws.getCell(r,1).alignment={horizontal:'center'}; r++ }
    if (settings.address) { ws.mergeCells(r,1,r,COLS); ws.getCell(r,1).value=`ADDRESS: ${settings.address.toUpperCase()}`; ws.getCell(r,1).font={size:8}; ws.getCell(r,1).alignment={horizontal:'center'}; r++ }
    if (settings.contact) { ws.mergeCells(r,1,r,COLS); ws.getCell(r,1).value=`CONTACT INFO: ${settings.contact}${settings.email?' / '+settings.email:''}`; ws.getCell(r,1).font={size:8}; ws.getCell(r,1).alignment={horizontal:'center'}; r++ }
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = title
    ws.getCell(r,1).font = { bold:true, size:11 }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    ws.getCell(r,1).border = { bottom:{style:'medium', color:{argb:'FF000000'}} }
    r++
    if (subtitle) {
      ws.mergeCells(r,1,r,COLS)
      ws.getCell(r,1).value = subtitle
      ws.getCell(r,1).font = { italic:true, size:9, color:{argb:'FF666666'} }
      ws.getCell(r,1).alignment = { horizontal:'center' }
      r++
    }
    r++ // spacer

    // Header row
    const headerRow = r
    headers.forEach((h,i) => {
      const cell = ws.getCell(headerRow, i+1)
      cell.value = h
      cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:8.5 }
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF000000'} }
      cell.border = allBorders
    })
    ws.getRow(headerRow).height = 24
    r++

    // Data rows
    const moneyCols = headers.map((h,i) => /billing|cost|profit|share|credited/i.test(h) ? i : -1).filter(i=>i>=0)
    const isTotalRow = (row) => row[0] === 'TOTAL'
    rows.forEach((row, ri) => {
      const isTotal = isTotalRow(row)
      const bg = isTotal ? 'FFFEF9C3' : (ri % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2')
      row.forEach((v, ci) => {
        const cell = ws.getCell(r, ci+1)
        cell.value = v
        cell.font = { size:8.5, bold: isTotal }
        cell.alignment = { horizontal: moneyCols.includes(ci) ? 'right' : ci===0 ? 'center' : 'left', vertical:'middle' }
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:bg} }
        cell.border = allBorders
        if (moneyCols.includes(ci) && typeof v === 'number') cell.numFmt = '#,##0.00'
        if (ci===0 && !isTotal && typeof v === 'string' && /^\d/.test(v)) cell.numFmt = '@'
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
  }

  const buildExcel = async (rows, headers, title, filename, summaryRows, summaryHeaders, sigs = []) => {
    const wb = new ExcelJS.Workbook()
    buildExcelSheet(wb, 'Itemized', title, 'Itemized — one row per trip', headers, rows, sigs)
    if (summaryRows && summaryHeaders) {
      buildExcelSheet(wb, 'Summary by Invoice', title, 'Summary — grouped by invoice', summaryHeaders, summaryRows, sigs)
    }
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
  }

  const buildSummaryReg = (trips) => {
    const headers = ['Invoice No.','Client','Plate','Trips','Total Billed','Subcon Cost','Profit','Client Paid Date','Subcon Paid Date','Voucher No.']
    const groups = {}
    trips.forEach(t => {
      const inv = invoiceMap[t.invoice_id]
      const key = inv?.invoice_no || 'No Invoice'
      if (!groups[key]) groups[key] = { invoice_no: key, client: t.client, plate: t.truck_plate, trips: 0, billed: 0, cost: 0, client_paid_date: t.client_paid_date, subcon_paid_date: t.subcon_paid_date, voucher: t.subcon_voucher_no }
      groups[key].trips++
      groups[key].billed += t._amount || 0
      groups[key].cost += t.subcon_cost || 0
      if (t.client_paid_date && (!groups[key].client_paid_date || t.client_paid_date > groups[key].client_paid_date)) groups[key].client_paid_date = t.client_paid_date
      if (t.subcon_paid_date && (!groups[key].subcon_paid_date || t.subcon_paid_date > groups[key].subcon_paid_date)) groups[key].subcon_paid_date = t.subcon_paid_date
      if (t.subcon_voucher_no) groups[key].voucher = t.subcon_voucher_no
    })
    const rows = Object.values(groups).map(g => [g.invoice_no, g.client||'—', g.plate, g.trips, r2(g.billed), r2(g.cost), r2(g.billed-g.cost), g.client_paid_date?fmtDate(g.client_paid_date):'—', g.subcon_paid_date?fmtDate(g.subcon_paid_date):'—', g.voucher||'—'])
    // Total row
    const total = Object.values(groups).reduce((s,g)=>({ trips: s.trips+g.trips, billed: s.billed+g.billed, cost: s.cost+g.cost }),{trips:0,billed:0,cost:0})
    rows.push(['TOTAL', '', '', total.trips, r2(total.billed), r2(total.cost), r2(total.billed-total.cost), '', '', ''])
    return { headers, rows }
  }

  const buildSummarySpc = (trips) => {
    const headers = ['Invoice No.','Client','Plate','Trips','Gross Sales','WHT (2%)','Net Total','Exp. Share','Net Credited','Client Paid Date','Voucher No.']
    const groups = {}
    trips.forEach(t => {
      const inv = invoiceMap[t.invoice_id]
      const key = inv?.invoice_no || 'No Invoice'
      if (!groups[key]) groups[key] = { invoice_no: key, client: t.client, plate: t.truck_plate, trips: 0, vatEx: 0, wht: 0, billed: 0, share: 0, client_paid_date: t.client_paid_date, voucher: t.subcon_voucher_no }
      groups[key].trips++
      groups[key].vatEx += t._amount || 0
      groups[key].wht += whtAmount(t)
      groups[key].billed += t._vatIncAmount || 0
      groups[key].share += t.subcon_expense_share || 0
      if (t.client_paid_date && (!groups[key].client_paid_date || t.client_paid_date > groups[key].client_paid_date)) groups[key].client_paid_date = t.client_paid_date
      if (t.subcon_voucher_no) groups[key].voucher = t.subcon_voucher_no
    })
    const rows = Object.values(groups).map(g => [g.invoice_no, g.client||'—', g.plate, g.trips, r2(g.vatEx), r2(g.wht), r2(g.billed), r2(g.share), r2(g.billed-g.share), g.client_paid_date?fmtDate(g.client_paid_date):'—', g.voucher||'—'])
    const total = Object.values(groups).reduce((s,g)=>({ trips: s.trips+g.trips, vatEx: s.vatEx+g.vatEx, wht: s.wht+g.wht, billed: s.billed+g.billed, share: s.share+g.share }),{trips:0,vatEx:0,wht:0,billed:0,share:0})
    rows.push(['TOTAL', '', '', total.trips, r2(total.vatEx), r2(total.wht), r2(total.billed), r2(total.share), r2(total.billed-total.share), '', ''])
    return { headers, rows }
  }

  const handleExportCurrentExcel = () => {
    setPendingPrintFn(() => async (sigs) => {
      const isReg = subconTab === 'regular'
      if (isReg) {
        const headers = ['Date','Plate','Partner','Client','Invoice','Type','DS Billing','Subcon Cost','Profit','Client Paid Date','Subcon Paid Date','Voucher No.']
        const rows = filtered.map(t => { const inv = invoiceMap[t.invoice_id]; return [fmtDate(t.trip_date), t.truck_plate, t._partner||'—', t.client||'—', inv?.invoice_no||'—', t._type==='dump'?'Dump':'PM', r2(t._amount), r2(t.subcon_cost), r2(t._amount-(t.subcon_cost||0)), t.client_paid_date?fmtDate(t.client_paid_date):'—', t.subcon_paid_date?fmtDate(t.subcon_paid_date):'—', t.subcon_voucher_no||'—'] })
        const s1 = buildSummaryReg(filtered); await buildExcel(rows, headers, `Regular Sub-con — ${filterMonth||'All'}`, `Subcon-regular-${filterMonth||'all'}.xlsx`, s1.rows, s1.headers, sigs)
      } else {
        const headers = ['Date','Plate','Partner','Client','Invoice','Type','DS Billing','Exp. Share','Net Credited','Client Paid Date','Voucher No.']
        const rows = filtered.map(t => { const inv = invoiceMap[t.invoice_id]; return [fmtDate(t.trip_date), t.truck_plate, t._partner||'—', t.client||'—', inv?.invoice_no||'—', t._type==='dump'?'Dump':'PM', r2(t._amount), r2(t.subcon_expense_share), r2(t._amount-(t.subcon_expense_share||0)), t.client_paid_date?fmtDate(t.client_paid_date):'—', t.subcon_voucher_no||'—'] })
        const s2 = buildSummarySpc(filtered); await buildExcel(rows, headers, `Special Sub-con — ${filterMonth||filterCreditMonth||'All'}`, `Subcon-special-${filterMonth||filterCreditMonth||'all'}.xlsx`, s2.rows, s2.headers, sigs)
      }
      showToast('Excel exported.')
    })
    setSigDialog(true)
  }

  const handleExportByInvoiceExcel = () => {
    const inv = invoices.find(i => i.invoice_no === printInvoice)
    if (!inv) { showToast('Invoice not found.', 'error'); return }
    setPendingPrintFn(() => async (sigs) => {
      const trips = enrichedTrips.filter(t => subconPlateSet.has(t.truck_plate) && t.invoice_id === inv.id)
      const isReg = subconTab === 'regular'
      if (isReg) {
        const headers = ['Date','Plate','Partner','Client','Invoice','Type','DS Billing','Subcon Cost','Profit','Client Paid Date','Subcon Paid Date','Voucher No.']
        const rows = trips.map(t => [fmtDate(t.trip_date), t.truck_plate, t._partner||'—', t.client||'—', inv.invoice_no, t._type==='dump'?'Dump':'PM', r2(t._amount), r2(t.subcon_cost), r2(t._amount-(t.subcon_cost||0)), t.client_paid_date?fmtDate(t.client_paid_date):'—', t.subcon_paid_date?fmtDate(t.subcon_paid_date):'—', t.subcon_voucher_no||'—'])
        const s3 = buildSummaryReg(trips); await buildExcel(rows, headers, `Sub-con Invoice ${printInvoice}`, `Subcon-Invoice-${printInvoice}.xlsx`, s3.rows, s3.headers, sigs)
      } else {
        const headers = ['Date','Plate','Partner','Client','Invoice','Type','DS Billing','Exp. Share','Net Credited','Client Paid Date','Voucher No.']
        const rows = trips.map(t => [fmtDate(t.trip_date), t.truck_plate, t._partner||'—', t.client||'—', inv.invoice_no, t._type==='dump'?'Dump':'PM', r2(t._amount), r2(t.subcon_expense_share), r2(t._amount-(t.subcon_expense_share||0)), t.client_paid_date?fmtDate(t.client_paid_date):'—', t.subcon_voucher_no||'—'])
        const s4 = buildSummarySpc(trips); await buildExcel(rows, headers, `Sub-con Invoice ${printInvoice}`, `Subcon-Invoice-${printInvoice}.xlsx`, s4.rows, s4.headers, sigs)
      }
      showToast('Excel exported.')
    })
    setSigDialog(true)
  }

  const handleExportByCreditMonthExcel = () => {
    setPendingPrintFn(() => async (sigs) => {
      const trips = enrichedTrips.filter(t => subconPlateSet.has(t.truck_plate) && (t.client_paid_date||'').startsWith(printCreditMonth))
      const isReg = subconTab === 'regular'
      if (isReg) {
        const headers = ['Date','Plate','Partner','Client','Invoice','Type','DS Billing','Subcon Cost','Profit','Client Paid Date','Subcon Paid Date','Voucher No.']
        const rows = trips.map(t => { const inv = invoiceMap[t.invoice_id]; return [fmtDate(t.trip_date), t.truck_plate, t._partner||'—', t.client||'—', inv?.invoice_no||'—', t._type==='dump'?'Dump':'PM', r2(t._amount), r2(t.subcon_cost), r2(t._amount-(t.subcon_cost||0)), t.client_paid_date?fmtDate(t.client_paid_date):'—', t.subcon_paid_date?fmtDate(t.subcon_paid_date):'—', t.subcon_voucher_no||'—'] })
        const s5 = buildSummaryReg(trips); await buildExcel(rows, headers, `Regular Sub-con Credit Month ${printCreditMonth}`, `Subcon-CreditMonth-${printCreditMonth}.xlsx`, s5.rows, s5.headers, sigs)
      } else {
        const headers = ['Date','Plate','Partner','Client','Invoice','Type','DS Billing','Exp. Share','Net Credited','Client Paid Date','Voucher No.']
        const rows = trips.map(t => { const inv = invoiceMap[t.invoice_id]; return [fmtDate(t.trip_date), t.truck_plate, t._partner||'—', t.client||'—', inv?.invoice_no||'—', t._type==='dump'?'Dump':'PM', r2(t._amount), r2(t.subcon_expense_share), r2(t._amount-(t.subcon_expense_share||0)), t.client_paid_date?fmtDate(t.client_paid_date):'—', t.subcon_voucher_no||'—'] })
        const s6 = buildSummarySpc(trips); await buildExcel(rows, headers, `Special Sub-con Credit Month ${printCreditMonth}`, `Subcon-CreditMonth-${printCreditMonth}.xlsx`, s6.rows, s6.headers, sigs)
      }
      showToast('Excel exported.')
    })
    setSigDialog(true)
  }

    const handlePrintCurrent = () => {
    setPendingPrintFn(() => (sigs) => doPrintCurrent(sigs))
    setSigDialog(true)
  }
  const doPrintCurrent = (sigs = []) => {
    const isReg = subconTab === 'regular'
    if (isReg) {
      const rows = filtered.map(t => toRegRow(t))
      const totals = `Billed: ${pf(totalBilled)}  |  Collected: ${pf(totalCollected)}  |  Sub-con Cost: ${pf(totalSubconCost)}  |  Profit: ${pf(totalProfit)}  |  Trips: ${filtered.length}`
      const title = `Regular Sub-contractor Trips — ${filterMonth || filterCreditMonth || 'All'}`
      const doc = buildPDF(rows, title, filterCreditMonth ? `Credit Month: ${filterCreditMonth}` : null, regCols, totals, printOrientation)
      const W = printOrientation === 'landscape' ? 279.4 : 215.9
      addSigsToDoc(doc, sigs, W)
      doc.save(`Subcon-regular-${filterMonth || filterCreditMonth || 'all'}.pdf`)
      showToast('PDF saved.'); setPrintMode(null)
      return
    }
    // Special subcon — monthly grouped PDF
    const isLandscape = printOrientation === 'landscape'
    const doc = new jsPDF({ orientation: printOrientation, unit: 'mm', format: 'letter' })
    const W = isLandscape ? 279.4 : 215.9
    const f2 = (n) => Number(n||0).toLocaleString('en-PH', { minimumFractionDigits: 2 })
    doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text((settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase(), W/2, 12, { align: 'center' })
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    doc.text(`Special Sub-con — ${filterCreditMonth ? 'Credit Month: ' + filterCreditMonth : filterMonth || 'All'}`, W/2, 18, { align: 'center' })
    doc.setFontSize(8)
    doc.text('All trips where client payment was credited in this month', W/2, 23, { align: 'center' })
    doc.setDrawColor(200); doc.line(10, 26, W-10, 26)
    // Group by credit month
    const monthGroups = {}
    filtered.forEach(t => {
      const creditDate = t.client_paid_date || invoiceMap[t.invoice_id]?.date_credited || ''
      const mo = creditDate ? creditDate.slice(0, 7) : 'uncredited'
      if (!monthGroups[mo]) monthGroups[mo] = { trips: [], month: mo }
      monthGroups[mo].trips.push(t)
    })
    const sortedMonths = Object.entries(monthGroups).sort(([a],[b]) => b.localeCompare(a))
    let startY = 30
    let grandCollected = 0, grandShare = 0, grandNet = 0
    sortedMonths.forEach(([mo, group], idx) => {
      const totalCollected = group.trips.reduce((s,t) => s + t._vatIncAmount, 0)
      const sampleTruck = trucks.find(tr => tr.plate === group.trips[0]?.truck_plate)
      const expShare = mo !== 'uncredited' && sampleTruck ? calcExpenseShare(sampleTruck.id, mo + '-01') : 0
      const netCredited = totalCollected - expShare
      grandCollected += totalCollected; grandShare += expShare; grandNet += netCredited
      const moLabel = mo === 'uncredited' ? 'Not Yet Credited' : new Date(mo + '-01').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
      // Month header bar
      doc.setFillColor(255,30,0); doc.rect(10, startY, W-20, 7, 'F')
      doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold')
      doc.text(moLabel.toUpperCase(), 13, startY+5)
      doc.text(`${group.trips.length} trip${group.trips.length>1?'s':''}`, W/2, startY+5, { align: 'center' })
      doc.text(`Collected: ${pf(totalCollected)}  |  Exp. Share: -${pf(expShare)}  |  Net: ${pf(netCredited)}`, W-12, startY+5, { align: 'right' })
      doc.setTextColor(0); doc.setFont('helvetica','normal')
      startY += 9
      // Trip rows
      const tripRows = group.trips.map(t => {
        const inv = invoiceMap[t.invoice_id]
        return [
          fmtDate(t.trip_date), t.truck_plate, getPartnerName(t.truck_plate),
          t.client || '—', inv?.invoice_no || '—',
          t._type === 'dump' ? 'Dump' : 'PM',
          pf(t._vatIncAmount),
          pf(t.subcon_expense_share || 0),
          pf(t._vatIncAmount - (t.subcon_expense_share || 0)),
          t.client_paid ? (t.client_paid_date ? fmtDate(t.client_paid_date) : 'Yes') : '—',
          t.subcon_voucher_no || '—'
        ]
      })
      autoTable(doc, {
        startY,
        head: [['Date','Plate','Partner','Client','Invoice','Type','DS Billing','Exp. Share','Net Credited','Client Paid','CV/Check No.']],
        body: tripRows,
        headStyles: { fillColor: [50,50,50], fontSize: 6.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 6.5 },
        alternateRowStyles: { fillColor: [250,250,250] },
        margin: { left: 10, right: 10 },
        tableLineWidth: 0.1,
      })
      startY = doc.lastAutoTable.finalY + 4
      // Check if need new page
      if (startY > 175 && idx < sortedMonths.length - 1) { doc.addPage(); startY = 14 }
    })
    // Grand total footer
    startY += 4
    if (startY > 180) { doc.addPage(); startY = 20 }
    doc.setFillColor(30,30,30); doc.rect(10, startY, W-20, 8, 'F')
    doc.setTextColor(255,255,255); doc.setFontSize(8.5); doc.setFont('helvetica','bold')
    doc.text('GRAND TOTAL', 13, startY+5.5)
    doc.text(`Total Collected: ${pf(grandCollected)}  |  Total Exp. Share: -${pf(grandShare)}  |  Total Net Credited: ${pf(grandNet)}`, W-12, startY+5.5, { align: 'right' })
    doc.setTextColor(0)
    addSigsToDoc(doc, sigs, W)
    doc.save(`Subcon-special-${filterMonth || filterCreditMonth || 'all'}.pdf`)
    showToast('PDF saved.'); setPrintMode(null)
  }
  const handlePrintByInvoice = () => {
    setPendingPrintFn(() => (sigs) => doPrintByInvoice(sigs))
    setSigDialog(true)
  }
  const doPrintByInvoice = (sigs = []) => {
    const inv = invoices.find(i => i.invoice_no === printInvoice)
    if (!inv) { showToast('Invoice not found.', 'error'); return }
    // FIX: use enrichedTrips not allTrips
    const trips = enrichedTrips.filter(t => subconPlateSet.has(t.truck_plate) && t.invoice_id === inv.id)
    const isReg = subconTab === 'regular'
    const rows = trips.map(t => isReg ? toRegRow(t) : toSpcRow(t))
    const total = trips.reduce((s, t) => s + billingAmount(t), 0)
    const doc = buildPDF(rows, `Sub-contractor Trips — Invoice ${printInvoice}`, `Client: ${inv.client}  |  Status: ${inv.status}`, isReg ? regCols : spcCols, `Total: ${pf(total)}  |  Trips: ${trips.length}`, printOrientation)
    const W2 = printOrientation === 'landscape' ? 279.4 : 215.9
    addSigsToDoc(doc, sigs, W2)
    doc.save(`Subcon-Invoice-${printInvoice}.pdf`)
    showToast('PDF saved.'); setPrintMode(null)
  }
  const handlePrintByCreditMonth = () => {
    setPendingPrintFn(() => (sigs) => doPrintByCreditMonth(sigs))
    setSigDialog(true)
  }
  const doPrintByCreditMonth = (sigs = []) => {
    // FIX: use enrichedTrips not allTrips
    const trips = enrichedTrips.filter(t => subconPlateSet.has(t.truck_plate) && t.client_paid_date?.slice(0, 7) === printCreditMonth)
    const isReg = subconTab === 'regular'
    const rows = trips.map(t => isReg ? toRegRow(t) : toSpcRow(t))
    const total = trips.reduce((s, t) => s + billingAmount(t), 0)
    const doc = buildPDF(rows, `${isReg ? 'Regular' : 'Special'} Sub-con — Credit Month: ${printCreditMonth}`, 'All trips where client payment was credited in this month', isReg ? regCols : spcCols, `Total Collected: ${pf(total)}  |  Trips: ${trips.length}`, printOrientation)
    const W3 = printOrientation === 'landscape' ? 279.4 : 215.9
    addSigsToDoc(doc, sigs, W3)
    doc.save(`Subcon-CreditMonth-${printCreditMonth}.pdf`)
    showToast('PDF saved.'); setPrintMode(null)
  }
  // FIX: use enrichedTrips for invoice nos
  const subconInvoiceNos = [...new Set(enrichedTrips.filter(t => subconPlateSet.has(t.truck_plate) && t.invoice_id).map(t => invoiceMap[t.invoice_id]?.invoice_no).filter(Boolean))].sort()
  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Sub-con Trips</h1><p className="page-sub">Track billing, payments, and settlements</p></div>
        {subconTab !== 'balance' && <button className="btn-ghost" onClick={() => setPrintMode('open')}>🖨️ Print / Export</button>}
      </div>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {[{ key: 'regular', label: '🤝 Regular Sub-con', count: regularTrucks.length }, { key: 'special', label: '⭐ Special Sub-con', count: specialTrucks.length }, { key: 'balance', label: '💰 Running Balance', count: null }].map(tab => (
          <button key={tab.key} onClick={() => { setSubconTab(tab.key); setFilterStatus(''); setFilterTruck('') }}
            style={{ padding: '10px 20px', background: 'none', border: 'none', borderBottom: subconTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent', color: subconTab === tab.key ? 'var(--accent)' : 'var(--muted)', fontWeight: subconTab === tab.key ? 600 : 400, cursor: 'pointer', fontSize: 13 }}>
            {tab.label} {tab.count !== null && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--border)', borderRadius: 10, padding: '1px 6px' }}>{tab.count} trucks</span>}
          </button>
        ))}
      </div>

      {/* FIX 3: Only show stats/filters/table when NOT on balance tab */}
      {subconTab !== 'balance' && (
        <>
          {/* Summary cards */}
          <div className="stats-grid" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-label">Total Billed</div>
              <div className="stat-value sm">₱{fmt(totalBilled)}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{filtered.length} trips</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Collected from Client</div>
              <div className="stat-value sm" style={{ color: 'var(--success)' }}>₱{fmt(totalCollected)}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{filtered.filter(t => t.client_paid).length} invoices paid</div>
            </div>
            {subconTab === 'regular' && <>
              <div className="stat-card">
                <div className="stat-label">Paid to Sub-con</div>
                <div className="stat-value sm" style={{ color: 'var(--danger)' }}>₱{fmt(totalSubconPaid)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{filtered.filter(t => t.subcon_paid).length} settled</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">DS Holding</div>
                <div className="stat-value sm" style={{ color: 'var(--accent)' }}>₱{fmt(netHolding)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Collected − paid to sub-con</div>
              </div>
            </>}
            {subconTab === 'special' && <>
              <div className="stat-card">
                <div className="stat-label">Expense Share</div>
                <div className="stat-value sm" style={{ color: 'var(--danger)' }}>₱{fmt(totalExpenseShare)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Net Credited to Sub-con</div>
                <div className="stat-value sm" style={{ color: 'var(--success)' }}>₱{fmt(totalCredited)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Collected − expense share</div>
              </div>
            </>}
          </div>

          {/* Bulk actions */}
          {bulkSelected.length > 0 && (
            <div style={{ padding: '10px 14px', background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{bulkSelected.length} trip{bulkSelected.length > 1 ? 's' : ''} selected</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Date paid:</label>
                <input type="date" value={bulkPaidDate} onChange={e => setBulkPaidDate(e.target.value)} style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} />
              </div>
              <button className="btn-primary btn-sm" onClick={handleBulkClientPaid} disabled={bulkSaving}>{bulkSaving ? 'Saving…' : '✅ Mark Client Paid'}</button>
              {subconTab === 'regular' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>Sub-con paid:</label>
                  <input type="date" value={bulkSubconDate} onChange={e => setBulkSubconDate(e.target.value)} style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} />
                  <input value={bulkSubconVoucher} onChange={e => setBulkSubconVoucher(e.target.value)} placeholder="CV/Check No." style={{ width: 120, padding: '4px 8px', fontSize: 12 }} />
                  <button className="btn-ghost btn-sm" onClick={handleBulkSubconPaid} disabled={bulkSubconSaving}>{bulkSubconSaving ? 'Saving…' : '💸 Mark Sub-con Paid'}</button>
                </div>
              )}
              <button className="btn-ghost btn-sm" onClick={() => setBulkSelected([])}>Clear</button>
            </div>
          )}

          {/* View mode toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <button onClick={() => setGroupByInvoice(false)} className={!groupByInvoice ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}>📋 All Trips</button>
            <button onClick={() => setGroupByInvoice(true)} className={groupByInvoice ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}>🧾 By Invoice</button>
          </div>

          {/* Filters */}
          <div className="filter-bar" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            <input placeholder="Search plate, client…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 2, minWidth: 120 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)' }}>Trip Month</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <select value={filterMonth ? filterMonth.slice(0,4) : ''} onChange={e => { const m = filterMonth ? filterMonth.slice(5,7) : '01'; setFilterMonth(e.target.value ? `${e.target.value}-${m}` : ''); setFilterCreditMonth('') }} style={{ width: 80 }}>
                  <option value="">Year</option>
                  {[2023,2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={filterMonth ? filterMonth.slice(5,7) : ''} onChange={e => { const y = filterMonth ? filterMonth.slice(0,4) : new Date().getFullYear(); setFilterMonth(e.target.value ? `${y}-${e.target.value}` : ''); setFilterCreditMonth('') }} style={{ width: 100 }}>
                  <option value="">Month</option>
                  {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m,i) => <option key={m} value={m}>{new Date(2000,i,1).toLocaleDateString('en-PH',{month:'long'})}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)' }}>Credit Month</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <select value={filterCreditMonth ? filterCreditMonth.slice(0,4) : ''} onChange={e => { const m = filterCreditMonth ? filterCreditMonth.slice(5,7) : '01'; setFilterCreditMonth(e.target.value ? `${e.target.value}-${m}` : ''); setFilterMonth('') }} style={{ width: 80 }}>
                  <option value="">Year</option>
                  {[2023,2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={filterCreditMonth ? filterCreditMonth.slice(5,7) : ''} onChange={e => { const y = filterCreditMonth ? filterCreditMonth.slice(0,4) : new Date().getFullYear(); setFilterCreditMonth(e.target.value ? `${y}-${e.target.value}` : ''); setFilterMonth('') }} style={{ width: 100 }}>
                  <option value="">Month</option>
                  {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m,i) => <option key={m} value={m}>{new Date(2000,i,1).toLocaleDateString('en-PH',{month:'long'})}</option>)}
                </select>
              </div>
            </div>
            <select value={filterTruck} onChange={e => setFilterTruck(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All trucks</option>
              {subconTrucks.map(t => <option key={t.id} value={t.plate}>{t.plate}{t.subcon_name ? ` — ${t.subcon_name}` : ''}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All status</option>
              <option value="client_paid">✅ Client Paid</option>
              {subconTab === 'regular' && <option value="subcon_paid">🔵 Sub-con Paid</option>}
              {subconTab === 'regular' && <option value="fully_settled">✅ Fully Settled</option>}
              <option value="unpaid">⏳ Unpaid</option>
            </select>
            {(search || filterTruck || filterStatus || filterCreditMonth) &&
              <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterTruck(''); setFilterStatus(''); setFilterCreditMonth(''); setFilterMonth(currentMonth()) }}>Clear</button>}
          </div>

          {/* Edit panel */}
          {editingTrip && (
            <div className="card" style={{ marginBottom: 16, border: '1.5px solid var(--accent)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>
                Edit: {editingTrip.truck_plate} · {fmtDate(editingTrip.trip_date)} · ₱{fmt(editingTrip._amount)}
              </h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', marginBottom: 10 }}>👤 Client Payment</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 10 }}>
                    <input type="checkbox" checked={editingTrip.client_paid || false}
                      onChange={e => setEditingTrip(t => ({ ...t, client_paid: e.target.checked, client_paid_date: e.target.checked ? (t.client_paid_date || today()) : '' }))} />
                    Mark Client as Paid
                  </label>
                  {editingTrip.client_paid && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="label">Date Paid by Client</label>
                      <input type="date" value={editingTrip.client_paid_date || today()} onChange={e => setEditingTrip(t => ({ ...t, client_paid_date: e.target.value }))} />
                    </div>
                  )}
                </div>
                {subconTab === 'regular' && (
                  <div style={{ flex: 1, minWidth: 220, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', marginBottom: 10 }}>🤝 Sub-con Payment</div>
                    <div className="form-group" style={{ marginBottom: 10 }}>
                      <label className="label">Sub-con Cost (₱)</label>
                      <input type="number" step="0.01" value={editingTrip.subcon_cost || ''} onChange={e => setEditingTrip(t => ({ ...t, subcon_cost: e.target.value }))} placeholder="0.00" />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 10 }}>
                      <input type="checkbox" checked={editingTrip.subcon_paid || false}
                        onChange={e => setEditingTrip(t => ({ ...t, subcon_paid: e.target.checked, subcon_paid_date: e.target.checked ? (t.subcon_paid_date || today()) : '' }))} />
                      Mark Sub-con as Paid
                    </label>
                    {editingTrip.subcon_paid && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ flex: 1, minWidth: 110, margin: 0 }}>
                          <label className="label">Date Paid</label>
                          <input type="date" value={editingTrip.subcon_paid_date || today()} onChange={e => setEditingTrip(t => ({ ...t, subcon_paid_date: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ flex: 1, minWidth: 130, margin: 0 }}>
                          <label className="label">Check / Voucher No.</label>
                          <input value={editingTrip.subcon_voucher_no || ''} onChange={e => setEditingTrip(t => ({ ...t, subcon_voucher_no: e.target.value }))} placeholder="CV-2024-001" />
                        </div>
                      </div>
                    )}
                    <div className="form-group" style={{ marginTop: 8, marginBottom: 0 }}>
                      <label className="label">Notes</label>
                      <input value={editingTrip.subcon_paid_notes || ''} onChange={e => setEditingTrip(t => ({ ...t, subcon_paid_notes: e.target.value }))} placeholder="Optional" />
                    </div>
                    {(editingTrip.subcon_cost > 0) && (
                      <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--accent-light)', borderRadius: 6, fontSize: 11 }}>
                        DS Billing: ₱{fmt(editingTrip._amount)} — Sub-con: ₱{fmt(parseFloat(editingTrip.subcon_cost) || 0)} =
                        <strong style={{ color: (editingTrip._amount - (parseFloat(editingTrip.subcon_cost) || 0)) >= 0 ? 'var(--success)' : 'var(--danger)', marginLeft: 4 }}>
                          Profit ₱{fmt(editingTrip._amount - (parseFloat(editingTrip.subcon_cost) || 0))}
                        </strong>
                      </div>
                    )}
                  </div>
                )}
                {subconTab === 'special' && (
                  <div style={{ flex: 1, minWidth: 200, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 10 }}>⭐ Credit to Sub-con</div>
                    <div className="form-group" style={{ marginBottom: 10 }}>
                      <label className="label">Expense Share Deducted (₱)</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input type="number" step="0.01" value={editingTrip.subcon_expense_share || ''} onChange={e => setEditingTrip(t => ({ ...t, subcon_expense_share: e.target.value }))} placeholder="0.00" style={{ flex: 1 }} />
                        <button type="button" className="btn-ghost btn-sm" title="Auto-calculate from expenses" onClick={() => {
                          const truck = trucks.find(tr => tr.plate === editingTrip.truck_plate)
                          if (truck) setEditingTrip(t => ({ ...t, subcon_expense_share: calcExpenseShare(truck.id, editingTrip.trip_date) }))
                        }}>🔄 Calc</button>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, display: 'block' }}>Auto-calculated from admin + fleet expenses for this trip's month</span>
                    </div>
                    {editingTrip._vatIncAmount > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--success)', fontWeight: 500, marginBottom: 8 }}>
                        Net to sub-con: ₱{fmt(editingTrip._vatIncAmount - (parseFloat(editingTrip.subcon_expense_share) || 0))}
                      </div>
                    )}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="label">Check / Voucher No. (when crediting)</label>
                      <input value={editingTrip.subcon_voucher_no || ''} onChange={e => setEditingTrip(t => ({ ...t, subcon_voucher_no: e.target.value }))} placeholder="CV-2024-001" />
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn-ghost" onClick={() => setEditingTrip(null)}>Cancel</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          )}

          {/* Print Modal */}
          {printMode && (
            <div className="modal-overlay" onClick={() => setPrintMode(null)}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
                <h3 style={{ marginBottom: 12 }}>🖨️ Print / Export PDF</h3>
                {/* Orientation toggle */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {['landscape', 'portrait'].map(o => (
                    <button key={o} onClick={() => setPrintOrientation(o)}
                      style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, fontWeight: printOrientation === o ? 700 : 400, background: printOrientation === o ? 'var(--accent)' : 'var(--surface)', color: printOrientation === o ? '#fff' : 'var(--text)' }}>
                      {o === 'landscape' ? '🖥️ Landscape' : '📄 Portrait'}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary" onClick={handlePrintCurrent} style={{ flex: 1, textAlign: 'left', padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600 }}>Print Current View</div>
                      <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>Exports whatever is currently filtered</div>
                    </button>
                    <button className="btn-ghost" onClick={handleExportCurrentExcel} title="Export to Excel" style={{ padding: '10px 14px', alignSelf: 'stretch' }}>📊</button>
                  </div>
                  <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>🧾 By Invoice</div>
                    <select value={printInvoice} onChange={e => setPrintInvoice(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
                      <option value="">Select invoice…</option>
                      {subconInvoiceNos.map(no => <option key={no} value={no}>{no}</option>)}
                    </select>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-ghost" onClick={handlePrintByInvoice} disabled={!printInvoice} style={{ flex: 1 }}>Print Invoice Trips</button>
                      <button className="btn-ghost" onClick={handleExportByInvoiceExcel} disabled={!printInvoice} title="Export to Excel">📊</button>
                    </div>
                  </div>
                  <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>📅 By Credit Month</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>All trips where client payment was credited in a specific month</div>
                    <input type="month" value={printCreditMonth} onChange={e => setPrintCreditMonth(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-ghost" onClick={handlePrintByCreditMonth} disabled={!printCreditMonth} style={{ flex: 1 }}>Print Credit Month</button>
                      <button className="btn-ghost" onClick={handleExportByCreditMonthExcel} disabled={!printCreditMonth} title="Export to Excel">📊</button>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <button className="btn-ghost btn-sm" onClick={() => setPrintMode(null)}>Close</button>
                </div>
              </div>
            </div>
          )}

          {/* Special Sub-con: Monthly grouped view */}
          {subconTab === 'special' && !loading && (() => {
            // Group filtered trips by credit month (client_paid_date)
            const monthGroups = {}
            filtered.forEach(t => {
              const creditDate = t.client_paid_date || invoiceMap[t.invoice_id]?.date_credited || ''
              const mo = creditDate ? creditDate.slice(0, 7) : 'uncredited'
              if (!monthGroups[mo]) monthGroups[mo] = { trips: [], month: mo }
              monthGroups[mo].trips.push(t)
            })
            const sortedMonths = Object.entries(monthGroups).sort(([a],[b]) => b.localeCompare(a))
            if (sortedMonths.length === 0) return <div className="empty-state"><p>No trips found.</p></div>
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sortedMonths.map(([mo, group]) => {
                  const totalCollected = group.trips.reduce((s,t) => s + t._vatIncAmount, 0)
                  // Get any special subcon truck in this group to find truck id
                  const sampleTruck = trucks.find(tr => tr.plate === group.trips[0]?.truck_plate)
                  const expShare = mo !== 'uncredited' && sampleTruck
                    ? calcExpenseShare(sampleTruck.id, mo + '-01')
                    : 0
                  const netCredited = totalCollected - expShare
                  const moLabel = mo === 'uncredited' ? 'Not Yet Credited' : new Date(mo + '-01').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
                  return (
                    <div key={mo} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {/* Month header */}
                      <div style={{ padding: '10px 16px', background: mo === 'uncredited' ? 'var(--bg)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: mo === 'uncredited' ? 'var(--muted)' : '#fff' }}>{moLabel}</span>
                        <span style={{ fontSize: 12, color: mo === 'uncredited' ? 'var(--muted)' : 'rgba(255,255,255,0.8)' }}>{group.trips.length} trip{group.trips.length > 1 ? 's' : ''}</span>
                      </div>
                      {/* Month summary */}
                      <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border)' }}>
                        {[
                          { label: 'Total Collected', value: `₱${fmt(totalCollected)}`, color: 'var(--success)' },
                          { label: 'Expense Share', value: expShare > 0 ? `−₱${fmt(expShare)}` : '—', color: 'var(--danger)' },
                          { label: 'Net Credited', value: `₱${fmt(netCredited)}`, color: 'var(--accent)', bold: true },
                        ].map((item, i) => (
                          <div key={i} style={{ flex: 1, padding: '10px 16px', borderRight: i < 2 ? '0.5px solid var(--border)' : 'none' }}>
                            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{item.label}</div>
                            <div style={{ fontSize: 15, fontWeight: item.bold ? 600 : 500, fontFamily: 'var(--mono)', color: item.color }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                      {/* Trips detail */}
                      <div className="table-wrap" style={{ margin: 0, borderRadius: 0 }}>
                        <table className="table" style={{ fontSize: 12 }}>
                          <thead><tr>
                            <th style={{ width: 32 }}><input type="checkbox" checked={bulkSelected.length > 0 && group.trips.filter(t => !t.client_paid).every(t => bulkSelected.some(s => s.id === t.id && s._type === t._type))} onChange={e => { const unpaid = group.trips.filter(t => !t.client_paid); setBulkSelected(p => e.target.checked ? [...p.filter(s => !unpaid.some(t => t.id === s.id && t._type === s._type)), ...unpaid] : p.filter(s => !unpaid.some(t => t.id === s.id && t._type === s._type))) }} style={{ width: 'auto' }} /></th>
                            <th>Date</th><th>Plate</th><th>Client</th><th>Invoice</th><th>Trip</th>
                            <th className="text-right">DS Billing</th><th>Status</th><th></th>
                          </tr></thead>
                          <tbody>
                            {group.trips.map(t => {
                              const ps = getPaymentStatus(t, 'special')
                              const inv = invoiceMap[t.invoice_id]
                              return (
                                <tr key={`${t._type}-${t.id}`}>
                                  <td>{!t.client_paid && <input type="checkbox" checked={bulkSelected.some(s => s.id === t.id && s._type === t._type)} onChange={e => setBulkSelected(p => e.target.checked ? [...p, t] : p.filter(s => !(s.id === t.id && s._type === t._type)))} style={{ width: 'auto' }} />}</td>
                                  <td className="mono">{fmtDate(t.trip_date)}</td>
                                  <td style={{ fontWeight: 500, fontFamily: 'var(--mono)' }}>{t.truck_plate}</td>
                                  <td>{t.client}</td>
                                  <td className="mono muted">{inv?.invoice_no || '—'}</td>
                                  <td className="muted">{t._type === 'dump' ? (t.route || '—') : `${t.trip_code || '—'} · ${t.container_size || ''}`}</td>
                                  <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(t._vatIncAmount)}</td>
                                  <td><span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 500, background: ps.bg, color: ps.color }}>{ps.label}</span></td>
                                  <td><button className="btn-ghost btn-sm" onClick={() => setEditingTrip({ ...t })}>Edit</button></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Regular Sub-con: Trips table */}
          {subconTab !== 'special' && loading ? <div className="empty-state"><p>Loading…</p></div> :
            subconTab !== 'special' && filtered.length === 0 ? <div className="empty-state"><p>No trips found.</p></div> :
            subconTab !== 'special' && groupByInvoice ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(() => {
                  const groups = {}
                  filtered.forEach(t => {
                    const inv = invoiceMap[t.invoice_id]
                    const key = inv?.invoice_no || 'No Invoice'
                    if (!groups[key]) groups[key] = { invoice_no: inv?.invoice_no || null, invoice_id: t.invoice_id, trips: [], client: t.client }
                    groups[key].trips.push(t)
                  })
                  return Object.entries(groups).sort(([a],[b]) => (parseFloat(b)||0)-(parseFloat(a)||0)).map(([invNo, group]) => {
                    const groupTotal = group.trips.reduce((s,t) => s+t._amount, 0)
                    const groupCost = group.trips.reduce((s,t) => s+(t.subcon_cost||0), 0)
                    const groupProfit = groupTotal - groupCost
                    const allClientPaid = group.trips.every(t => t.client_paid)
                    const isExpanded = expandedInvoices.has(invNo)
                    return (
                      <div key={invNo} style={{ border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                        <div onClick={() => toggleInvoice(invNo)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', cursor: 'pointer', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{invNo}</span>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{group.client}</span>
                          <span style={{ fontSize: 11, background: 'var(--bg)', borderRadius: 10, padding: '1px 8px', color: 'var(--muted)' }}>{group.trips.length} trip{group.trips.length>1?'s':''}</span>
                          {allClientPaid && <span style={{ fontSize: 10, background: 'rgba(22,163,74,0.1)', color: 'var(--success)', borderRadius: 10, padding: '1px 8px' }}>✅ Client Paid</span>}
                          <span style={{ marginLeft: 'auto', fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 600 }}>₱{fmt(groupTotal)}</span>
                          {subconTab === 'regular' && groupCost > 0 && <span style={{ fontSize: 12, color: groupProfit>=0?'var(--success)':'var(--danger)' }}>Profit: ₱{fmt(groupProfit)}</span>}
                          <span style={{ fontSize: 12 }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                        {isExpanded && (
                          <div className="table-wrap" style={{ margin: 0, borderRadius: 0 }}>
                            <table className="table" style={{ fontSize: 12 }}>
                              <thead><tr>
                                <th>Date</th><th>Plate</th><th>Trip</th>
                                <th className="text-right">DS Billing</th>
                                {subconTab === 'regular' && <th className="text-right">Cost</th>}
                                {subconTab === 'special' && <th className="text-right">Exp. Share</th>}
                                <th>Status</th><th></th>
                              </tr></thead>
                              <tbody>
                                {group.trips.map(t => {
                                  const ps = getPaymentStatus(t, subconTab)
                                  return (
                                    <tr key={`${t._type}-${t.id}`}>
                                      <td>{fmtDate(t.trip_date)}</td>
                                      <td style={{ fontFamily:'var(--mono)' }}>{t.truck_plate}</td>
                                      <td style={{ color:'var(--muted)' }}>{t._type==='dump'?(t.route||'—'):`${t.trip_code||'—'} · ${t.container_size||''}`}</td>
                                      <td className="text-right mono">₱{fmt(t._amount)}</td>
                                      {subconTab === 'regular' && <td className="text-right mono" style={{ color:'var(--danger)' }}>{t.subcon_cost>0?`₱${fmt(t.subcon_cost)}`:'—'}</td>}
                                      {subconTab === 'special' && <td className="text-right mono" style={{ color:'var(--danger)' }}>{t.subcon_expense_share>0?`₱${fmt(t.subcon_expense_share)}`:'—'}</td>}
                                      <td><span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:500, background:ps.bg, color:ps.color }}>{ps.label}</span></td>
                                      <td><button className="btn-ghost btn-sm" onClick={e => {
                                        e.stopPropagation()
                                        const trip = { ...t }
                                        if (subconTab === 'special' && !trip.subcon_expense_share) {
                                          const truck = trucks.find(tr => tr.plate === t.truck_plate)
                                          if (truck) trip.subcon_expense_share = calcExpenseShare(truck.id, t.trip_date)
                                        }
                                        setEditingTrip(trip)
                                      }}>Edit</button></td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}><input type="checkbox" checked={bulkSelected.length === filtered.filter(t => !t.client_paid).length && filtered.filter(t => !t.client_paid).length > 0} onChange={e => setBulkSelected(e.target.checked ? filtered.filter(t => !t.client_paid) : [])} style={{ width: 'auto' }} /></th>
                      {[['trip_date','Date'],['truck_plate','Plate'],null,['client','Client'],null,null].map((col,i) => col
                        ? <th key={i} onClick={() => toggleSort(col[0])} style={{ cursor:'pointer', userSelect:'none' }}>{col[1]} {sortKey===col[0]?(sortDir==='asc'?'▲':'▼'):''}</th>
                        : <th key={i}>{['Partner','Invoice','Trip'][i-2]}</th>
                      )}
                      <th className="text-right">DS Billing</th>
                      {subconTab === 'regular' && <th className="text-right">Sub-con Cost</th>}
                      {subconTab === 'regular' && <th className="text-right">Profit</th>}
                      {subconTab === 'special' && <th className="text-right">Exp. Share</th>}
                      {subconTab === 'special' && <th className="text-right">Net Credited</th>}
                      <th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(t => {
                      const profit = t._amount - (t.subcon_cost || 0)
                      const netCredited = t._vatIncAmount - (t.subcon_expense_share || 0)
                      const hasCost = (t.subcon_cost || 0) > 0
                      const ps = getPaymentStatus(t, subconTab)
                      const inv = invoiceMap[t.invoice_id]
                      return (
                        <tr key={`${t._type}-${t.id}`}>
                          <td>{!t.client_paid && <input type="checkbox" checked={bulkSelected.some(s => s.id === t.id && s._type === t._type)} onChange={e => setBulkSelected(p => e.target.checked ? [...p, t] : p.filter(s => !(s.id === t.id && s._type === t._type)))} style={{ width: 'auto' }} />}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{fmtDate(t.trip_date)}</td>
                          <td style={{ fontWeight: 500, fontFamily: 'var(--mono)', fontSize: 12 }}>{t.truck_plate}</td>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>{getPartnerName(t.truck_plate)}</td>
                          <td style={{ fontSize: 12 }}>{t.client}</td>
                          <td style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{inv?.invoice_no || '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>{t._type === 'dump' ? (t.route || '—') : `${t.trip_code || '—'} · ${t.container_size || ''}`}</td>
                          <td className="text-right mono" style={{ fontSize: 12 }}>₱{fmt(billingAmount(t))}</td>
                          {subconTab === 'regular' && <td className="text-right mono" style={{ fontSize: 12, color: hasCost ? 'var(--danger)' : 'var(--hint)' }}>{hasCost ? `₱${fmt(t.subcon_cost)}` : '—'}</td>}
                          {subconTab === 'regular' && <td className="text-right mono" style={{ fontSize: 12, fontWeight: hasCost ? 500 : 400, color: hasCost ? (profit >= 0 ? 'var(--success)' : 'var(--danger)') : 'var(--hint)' }}>{hasCost ? `₱${fmt(profit)}` : '—'}</td>}
                          {subconTab === 'special' && <td className="text-right mono" style={{ fontSize: 12, color: 'var(--danger)' }}>{t.subcon_expense_share > 0 ? `₱${fmt(t.subcon_expense_share)}` : '—'}</td>}
                          {subconTab === 'special' && <td className="text-right mono" style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>₱{fmt(netCredited)}</td>}
                          <td>
                            <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 500, background: ps.bg, color: ps.color, whiteSpace: 'nowrap' }}>{ps.label}</span>
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                              {t.client_paid && t.client_paid_date && <div>Client: {fmtDate(t.client_paid_date)}</div>}
                              {subconTab === 'regular' && t.subcon_paid && t.subcon_paid_date && <div>Sub-con: {fmtDate(t.subcon_paid_date)}</div>}
                              {t.subcon_voucher_no && <div style={{ fontFamily: 'var(--mono)' }}>{t.subcon_voucher_no}</div>}
                            </div>
                          </td>
                          <td><button className="btn-ghost btn-sm" onClick={() => {
            const trip = { ...t }
            // Auto-fill expense share for special subcon if not already set
            if (subconTab === 'special' && !trip.subcon_expense_share) {
              const truck = trucks.find(tr => tr.plate === t.truck_plate)
              if (truck) trip.subcon_expense_share = calcExpenseShare(truck.id, t.trip_date)
            }
            setEditingTrip(trip)
          }}>Edit</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ borderTop: '1px solid var(--border-md)' }}></td>
                      <td colSpan={6} style={{ padding: '8px 14px', fontWeight: 600, borderTop: '1px solid var(--border-md)' }}>TOTAL ({filtered.length})</td>
                      <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalBilled)}</td>
                      {subconTab === 'regular' && <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', color: 'var(--danger)', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalSubconCost)}</td>}
                      {subconTab === 'regular' && <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', color: totalProfit >= 0 ? 'var(--success)' : 'var(--danger)', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalProfit)}</td>}
                      {subconTab === 'special' && <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', color: 'var(--danger)', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalExpenseShare)}</td>}
                      {subconTab === 'special' && <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', color: 'var(--success)', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalCredited)}</td>}
                      <td colSpan={2} style={{ borderTop: '1px solid var(--border-md)' }}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          }
        </>
      )}

      {/* ── RUNNING BALANCE TAB ── */}
      {subconTab === 'balance' && (() => {
        const allSubconTrucks = [...regularTrucks, ...specialTrucks]
        // FIX 1: renamed to rawTrips to avoid shadowing outer enrichedTrips
        const rawTrips = [...dumpTrips, ...pmTrips]
        return (
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>All sub-contractor trucks — total earned vs total paid out</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allSubconTrucks.map(truck => {
                const truckTrips = rawTrips.filter(t => t.truck_plate === truck.plate)
                // FIX 2: use subcon_cost (regular) or _amount for earned, not subcon_rate which doesn't exist
                const isSpecial = truck.ownership === 'special_subcon'
                const totalEarned = truckTrips.reduce((s,t) => {
                  const amt = truck.truck_type === 'Dump Truck' || t.weight_tons
                    ? (t.weight_tons||0)*(t.rate_per_ton||0)
                    : (t.trip_code==='SMC' ? ((t.supplier_amount||0)+(t.stripping_fee||0))/1.12 : (t.supplier_amount||0)+(t.stripping_fee||0))
                  return s + amt
                }, 0)
                const totalPaid = truckTrips.filter(t => t.subcon_paid).reduce((s,t) => s + (t.subcon_cost||0), 0)
                const outstanding = isSpecial ? 0 : totalEarned - totalPaid
                const paidCount = truckTrips.filter(t => t.subcon_paid).length
                return (
                  <div key={truck.id} style={{ padding: '12px 16px', background: 'var(--surface)', borderRadius: 10, border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 100 }}>
                      <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 14 }}>{truck.plate}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{truck.subcon_name || '—'} · {truck.truck_type}</div>
                      <div style={{ fontSize: 10, color: truck.ownership === 'special_subcon' ? 'var(--accent)' : 'var(--muted)' }}>{truck.ownership === 'special_subcon' ? '⭐ Special' : '🤝 Regular'}</div>
                    </div>
                    <div style={{ flex: 1, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Total Trips</div>
                        <div style={{ fontWeight: 500 }}>{truckTrips.length}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>DS Billed</div>
                        <div style={{ fontWeight: 500 }}>₱{fmt(totalEarned)}</div>
                      </div>
                      {!isSpecial && <>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Paid Out</div>
                          <div style={{ fontWeight: 500, color: 'var(--success)' }}>₱{fmt(totalPaid)} ({paidCount} trips)</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Outstanding</div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: outstanding > 0 ? 'var(--danger)' : 'var(--success)' }}>₱{fmt(outstanding)}</div>
                        </div>
                      </>}
                      {isSpecial && (() => {
                        // For special subcon: group by credit month, calc net credited per month
                        const creditedTrips = truckTrips.filter(t => t.client_paid)
                        const monthMap = {}
                        creditedTrips.forEach(t => {
                          const mo = (t.client_paid_date || '').slice(0, 7)
                          if (!mo) return
                          if (!monthMap[mo]) monthMap[mo] = []
                          monthMap[mo].push(t)
                        })
                        const totalNetCredited = Object.entries(monthMap).reduce((s, [mo, trips]) => {
                          const collected = trips.reduce((ss, t) => ss + ((t.weight_tons||0)*(t.rate_per_ton||0)||(t.trip_code==='SMC'?((t.supplier_amount||0)+(t.stripping_fee||0))/1.12:(t.supplier_amount||0)+(t.stripping_fee||0))), 0)
                          const expShare = calcExpenseShare(truck.id, mo + '-01')
                          return s + collected - expShare
                        }, 0)
                        const totalPaidOut = truckTrips.filter(t => t.subcon_paid).reduce((s,t) => s + (t.subcon_cost||0), 0)
                        const outstanding = totalNetCredited - totalPaidOut
                        return (
                          <>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Total Net Credited</div>
                              <div style={{ fontWeight: 500, color: 'var(--success)' }}>₱{fmt(totalNetCredited)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Paid Out</div>
                              <div style={{ fontWeight: 500 }}>₱{fmt(totalPaidOut)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>We Owe</div>
                              <div style={{ fontWeight: 700, fontSize: 15, color: outstanding > 0 ? 'var(--danger)' : 'var(--success)' }}>₱{fmt(outstanding)}</div>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
              {allSubconTrucks.length === 0 && <div className="empty-state"><p>No sub-contractor trucks found.</p></div>}
            </div>
            {/* Fleet total — regular subcon only */}
            {regularTrucks.length > 0 && (() => {
              const regTrips = rawTrips.filter(t => regularTrucks.some(tr => tr.plate === t.truck_plate))
              const grandBilled = regTrips.reduce((s,t) => s + ((t.weight_tons||0)*(t.rate_per_ton||0)||(t.trip_code==='SMC'?((t.supplier_amount||0)+(t.stripping_fee||0))/1.12:(t.supplier_amount||0)+(t.stripping_fee||0))), 0)
              const grandPaid = regTrips.filter(t => t.subcon_paid).reduce((s,t) => s+(t.subcon_cost||0), 0)
              return (
                <div style={{ marginTop: 12, padding: '12px 16px', background: 'var(--accent)', borderRadius: 10, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div style={{ color: '#fff' }}><div style={{ fontSize: 10, opacity: 0.8 }}>REGULAR SUBCON — GRAND DS BILLED</div><div style={{ fontWeight: 700, fontSize: 16 }}>₱{fmt(grandBilled)}</div></div>
                  <div style={{ color: '#fff' }}><div style={{ fontSize: 10, opacity: 0.8 }}>TOTAL PAID OUT</div><div style={{ fontWeight: 700, fontSize: 16 }}>₱{fmt(grandPaid)}</div></div>
                  <div style={{ color: '#fff' }}><div style={{ fontSize: 10, opacity: 0.8 }}>TOTAL OUTSTANDING</div><div style={{ fontWeight: 700, fontSize: 16 }}>₱{fmt(grandBilled - grandPaid)}</div></div>
                </div>
              )
            })()}
          </div>
        )
      })()}

      <SignatoryDialog
        open={sigDialog}
        onClose={() => setSigDialog(false)}
        onPrint={(sigs) => { setSigDialog(false); pendingPrintFn && pendingPrintFn(sigs) }}
        settings={settings}
        profile={profile}
        docType="Sub-con Report"
      />
      <Toast toast={toast} />
    </div>
  )
}
