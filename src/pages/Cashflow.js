import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fmtDate, fetchAllRows } from '../lib/supabase'
import { useToast, Toast } from '../components/Toast'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function Cashflow() {
  const { toast, showToast } = useToast()
  const [vouchers, setVouchers] = useState([])
  const [subconDump, setSubconDump] = useState([])
  const [subconPM, setSubconPM] = useState([])
  const [loans, setLoans] = useState([])
  const [expenses, setExpenses] = useState([])
  const [extraIncome, setExtraIncome] = useState([])
  const [historicalBookkeeper, setHistoricalBookkeeper] = useState([])
  const [settings, setSettings] = useState({})
  const [showExpenseBreakdown, setShowExpenseBreakdown] = useState(false)
  const [showSalesBreakdown, setShowSalesBreakdown] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportFormat, setExportFormat] = useState('pdf')
  const [exportDetail, setExportDetail] = useState('summary')
  const [amortizations, setAmortizations] = useState([])
  const [insurances, setInsurances] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const now2 = new Date()
  const [selYear, setSelYear] = useState(now2.getFullYear())
  const [selMonth, setSelMonth] = useState(now2.getMonth() + 1)
  const month = `${selYear}-${String(selMonth).padStart(2, '0')}`

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [v, am, ins, inv, sd, sp, ln, ex, ei, hd, st] = await Promise.all([
      supabase.from('check_vouchers').select('*').order('voucher_date'),
      supabase.from('amortizations').select('*'),
      supabase.from('insurances').select('*'),
      fetchAllRows(() => supabase.from('invoices').select('*').is('deleted_at', null).order('invoice_date')),
      fetchAllRows(() => supabase.from('trips_dump').select('trip_date,subcon_cost,weight_tons,rate_per_ton').is('deleted_at', null).gt('subcon_cost', 0)),
      fetchAllRows(() => supabase.from('trips_pm').select('trip_date,subcon_cost,supplier_amount,stripping_fee').is('deleted_at', null).gt('subcon_cost', 0)),
      supabase.from('loans').select('*').eq('status', 'active'),
      fetchAllRows(() => supabase.from('expenses').select('*').is('deleted_at', null).order('expense_date')),
      fetchAllRows(() => supabase.from('extra_income').select('*').order('income_date')),
      fetchAllRows(() => supabase.from('historical_data').select('*').eq('entry_type','simple_bookkeeper')),
      supabase.from('company_settings').select('company_name').eq('id', 1).maybeSingle(),
    ])
    if (v.data) setVouchers(v.data)
    if (am.data) setAmortizations(am.data)
    if (ins.data) setInsurances(ins.data)
    if (inv.data) setInvoices(inv.data)
    if (sd.data) setSubconDump(sd.data)
    if (sp.data) setSubconPM(sp.data)
    if (ln.data) setLoans(ln.data)
    if (ex.data) setExpenses(ex.data)
    if (ei.data) setExtraIncome(ei.data)
    if (hd.data) setHistoricalBookkeeper(hd.data)
    if (st.data) setSettings(st.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Cash OUT — PDC checks appear on their specific check date month
  // For single checks: use check_date; for multiple: split by individual check_date
  const getVoucherChecksForMonth = (mo) => {
    let total = 0
    vouchers.filter(v => v.status !== 'Cancelled').forEach(v => {
      if (v.mode === 'multiple' && v.check_rows) {
        const rows = typeof v.check_rows === 'string' ? JSON.parse(v.check_rows) : v.check_rows
        rows.forEach(r => {
          if (r.check_date?.startsWith(mo)) total += parseFloat(r.amount) || 0
        })
      } else {
        const checkMo = v.check_date?.slice(0, 7) || v.voucher_date?.slice(0, 7)
        if (checkMo === mo) total += v.amount || 0
      }
    })
    return total
  }
  const getVoucherRowsForMonth = (mo) => {
    const rows = []
    vouchers.filter(v => v.status !== 'Cancelled').forEach(v => {
      if (v.mode === 'multiple' && v.check_rows) {
        const cr = typeof v.check_rows === 'string' ? JSON.parse(v.check_rows) : v.check_rows
        cr.forEach(r => {
          if (r.check_date?.startsWith(mo)) rows.push({ ...v, check_no: r.check_no, check_date: r.check_date, amount: parseFloat(r.amount) || 0, description: r.description || v.description })
        })
      } else {
        const checkMo = v.check_date?.slice(0, 7) || v.voucher_date?.slice(0, 7)
        if (checkMo === mo) rows.push(v)
      }
    })
    return rows
  }
  const monthVoucherRows = getVoucherRowsForMonth(month)
  const totalChecks = getVoucherChecksForMonth(month)

  // Fixed monthly obligations — amortization
  const monthAmort = amortizations.filter(a => {
    const start = a.start_date?.slice(0, 7)
    const end = a.end_date?.slice(0, 7)
    return (!start || month >= start) && (!end || month <= end)
  })
  const totalAmort = monthAmort.reduce((s, a) => s + (a.monthly_amount || 0), 0)
  // Loan monthly payments — active loans that started on or before this month
  const monthLoans = loans.filter(l => {
    const loanStart = l.start_date?.slice(0, 7)
    if (!loanStart || loanStart > month) return false
    if (l.term_months) {
      const start = new Date(l.start_date + 'T00:00:00')
      const [yr, mo] = month.split('-').map(Number)
      const months = (yr - start.getFullYear()) * 12 + (mo - (start.getMonth() + 1))
      return months < l.term_months
    }
    return true
  })
  const totalLoanPayments = monthLoans.reduce((s, l) => s + (l.monthly_payment || 0), 0)

  // Cash expenses for the month (payment_method !== 'check')
  const monthCashExpenses = expenses.filter(e =>
    e.expense_date?.startsWith(month) && e.payment_method !== 'check'
  )
  const totalCashExpenses = monthCashExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  // Grouped by type
  const adminCashExp = monthCashExpenses.filter(e => e.expense_type === 'admin')
  const opCashExp = monthCashExpenses.filter(e => e.expense_type === 'operation')
  const totalAdminExp = adminCashExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const totalOpExp = opCashExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)

  // Insurance excluded from fixed monthly (paid via PDC checks, already in check vouchers)
  const monthIns = []
  const totalIns = 0

  // Cash IN — based on date_credited in selected month
  const monthPaid = invoices.filter(i => 
    i.status === 'Paid' && 
    i.date_credited?.slice(0, 7) === month
  )
  const invoiceCashIn = monthPaid.reduce((s, i) => s + (parseFloat(i.actual_amount_credited) || (i.total_sales_net || 0) * 1.10), 0)
  // Sub-con profit margin for the month (must be before totalCashIn)
  const subconProfit = [
    ...subconDump.filter(t => t.trip_date?.startsWith(month) && (t.subcon_cost || 0) > 0)
      .map(t => ({ profit: (t.weight_tons || 0) * (t.rate_per_ton || 0) - (t.subcon_cost || 0) })),
    ...subconPM.filter(t => t.trip_date?.startsWith(month) && (t.subcon_cost || 0) > 0)
      .map(t => ({ profit: (t.supplier_amount || 0) + (t.stripping_fee || 0) - (t.subcon_cost || 0) })),
  ].reduce((s, t) => s + Math.max(t.profit, 0), 0)
  const monthExtraIncome = extraIncome.filter(e => e.income_date?.startsWith(month))
  // Historical bookkeeper cash in — only if no live invoice credits for that month
  const histBkMo = historicalBookkeeper.find(h => `${h.period_year}-${h.period_month}` === month)
  const histBkCashIn = (!monthPaid.length && histBkMo) ? (parseFloat(histBkMo.credited_to_bank)||0) : 0
  const totalExtraIncome = monthExtraIncome.reduce((s,e) => s+(parseFloat(e.amount)||0), 0)
  const totalCashIn = invoiceCashIn + subconProfit + totalExtraIncome + histBkCashIn

  // Expected cash in — invoiced but unpaid
  const unpaidInvoices = invoices.filter(i => i.status === 'Invoiced' || i.status === 'On Hold')
  const expectedCashIn = unpaidInvoices.reduce((s, i) => s + (i.total_sales_net || 0) * 1.10, 0)

  const totalCashOut = totalChecks + totalAmort + totalIns + totalLoanPayments + totalCashExpenses
  const netCashflow = totalCashIn - totalCashOut

  const monthLabel = new Date(month + '-01').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

  // Cash position — last 6 months
  const cashMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(selYear, selMonth - 1 - (5 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const cashPosition = cashMonths.map(mo => {
    const cashIn = invoices.filter(i => i.status === 'Paid' && i.date_credited?.slice(0, 7) === mo)
      .reduce((s, i) => s + (parseFloat(i.actual_amount_credited) || (i.total_sales_net || 0) * 1.10), 0)
    const cashOut = getVoucherChecksForMonth(mo)
    const loanOut = loans.filter(l => {
      if (!l.start_date || l.start_date.slice(0,7) > mo) return false
      if (l.term_months) {
        const start = new Date(l.start_date + 'T00:00:00')
        const [yr, moN] = mo.split('-').map(Number)
        const months = (yr - start.getFullYear()) * 12 + (moN - (start.getMonth() + 1))
        return months < l.term_months
      }
      return true
    }).reduce((s, l) => s + (l.monthly_payment || 0), 0)
    const fixedOut = amortizations.filter(a => {
      const start = a.start_date?.slice(0, 7); const end = a.end_date?.slice(0, 7)
      return (!start || mo >= start) && (!end || mo <= end)
    }).reduce((s, a) => s + (a.monthly_amount || 0), 0)
    return {
      month: mo,
      label: new Date(mo + '-01').toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }),
      cashIn, cashOut: cashOut + fixedOut + loanOut, net: cashIn - cashOut - fixedOut - loanOut
    }
  })
  const maxCashAbs = Math.max(...cashPosition.map(d => Math.max(Math.abs(d.cashIn), Math.abs(d.cashOut))), 1)

  const handleSavePDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    const W = 215.9
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(0)
    doc.text((settings?.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase(), W / 2, 14, { align: 'center' })
    doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    doc.text('CASHFLOW REPORT', W / 2, 20, { align: 'center' })
    doc.text(monthLabel.toUpperCase(), W / 2, 26, { align: 'center' })
    doc.setDrawColor(200); doc.line(14, 30, W - 14, 30)

    let y = 38
    // Cash In
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 120, 0)
    doc.text('CASH IN', 14, y); y += 6
    autoTable(doc, {
      startY: y,
      head: [['Description', 'Invoice No.', 'Client', 'Amount (PHP)']],
      body: monthPaid.map(i => [fmtDate(i.invoice_date), i.invoice_no, i.client, fmt(parseFloat(i.actual_amount_credited) || (i.total_sales_net || 0) * 1.10)]),
      headStyles: { fillColor: [0, 120, 0], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      tableLineColor: [150, 150, 150], tableLineWidth: 0.1,
      margin: { left: 14, right: 14 },
      foot: [[{ content: 'Total Checks', colSpan: 4, styles: { fontStyle: 'bold' } }, { content: `₱${fmt(totalCashIn)}`, styles: { fontStyle: 'bold', halign: 'right' } }]],
      footStyles: { fillColor: [220, 255, 220], textColor: [0, 0, 0] },
    })
    y = doc.lastAutoTable.finalY + 8

    // Cash Out — Checks
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(180, 0, 0)
    doc.text('CASH OUT — Checks Issued', 14, y); y += 6
    autoTable(doc, {
      startY: y,
      head: [['Voucher No.', 'Payee', 'Description', 'Check No.', 'Amount (PHP)']],
      body: monthVoucherRows.map(v => [v.voucher_no, v.payee, v.description || v.remarks || '—', v.check_no || '—', fmt(v.amount || 0)]),
      headStyles: { fillColor: [180, 0, 0], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      tableLineColor: [150, 150, 150], tableLineWidth: 0.1,
      margin: { left: 14, right: 14 },
      foot: [[{ content: 'Total Checks', colSpan: 3, styles: { fontStyle: 'bold' } }, { content: `₱${fmt(totalChecks)}`, styles: { fontStyle: 'bold', halign: 'right' } }]],
      footStyles: { fillColor: [255, 220, 220], textColor: [0, 0, 0] },
    })
    y = doc.lastAutoTable.finalY + 8

    // Fixed Obligations
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(180, 0, 0)
    doc.text('CASH OUT — Fixed Monthly Obligations', 14, y); y += 6
    const fixedRows = [
      ...monthAmort.map(a => [`Amortization — ${a.description}`, '—', '—', fmt(a.monthly_amount)]),
      ...monthIns.map(ins => [`Insurance — ${ins.description}`, '—', '—', fmt((ins.annual_amount || 0) / (ins.truck_ids?.length || 1) / 12)]),
    ]
    autoTable(doc, {
      startY: y,
      head: [['Description', 'Truck', 'Period', 'Amount (PHP)']],
      body: fixedRows.length ? fixedRows : [['No fixed obligations this month', '', '', '—']],
      headStyles: { fillColor: [120, 0, 0], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      tableLineColor: [150, 150, 150], tableLineWidth: 0.1,
      margin: { left: 14, right: 14 },
      foot: [[{ content: 'Total Fixed', colSpan: 3, styles: { fontStyle: 'bold' } }, { content: `₱${fmt(totalAmort + totalIns)}`, styles: { fontStyle: 'bold', halign: 'right' } }]],
      footStyles: { fillColor: [255, 220, 220], textColor: [0, 0, 0] },
    })
    y = doc.lastAutoTable.finalY + 10

    // Summary
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(0)
    const summaryRows = [
      ['Total Cash In', `₱${fmt(totalCashIn)}`],
      ['Total Cash Out (Checks)', `₱${fmt(totalChecks)}`],
      ['Total Fixed Obligations', `₱${fmt(totalAmort + totalIns)}`],
      ['TOTAL CASH OUT', `₱${fmt(totalCashOut)}`],
      ['NET CASHFLOW', `${netCashflow >= 0 ? '+' : ''}₱${fmt(netCashflow)}`],
    ]
    autoTable(doc, {
      startY: y,
      body: summaryRows,
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', fontFamily: 'courier' } },
      tableLineColor: [100, 100, 100], tableLineWidth: 0.2,
      margin: { left: 100, right: 14 },
    })
    doc.save(`Cashflow-${selYear}-${String(selMonth).padStart(2,'0')}.pdf`)
    showToast('Cashflow PDF saved.')
  }

  const handleExport = () => {
    const f2 = (n) => Number(n||0).toLocaleString('en-PH', { minimumFractionDigits: 2 })
    const companyName = (settings?.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const title = `CASHFLOW STATEMENT — ${monthLabel}`
    const isDetail = exportDetail === 'detail'

    if (exportFormat === 'excel') {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8"><style>body{font-family:Calibri,Arial;font-size:9pt;}table{border-collapse:collapse;width:100%;}th{background:#1F2937;color:#fff;font-weight:bold;padding:4px 8px;border:1px solid #999;}td{padding:3px 8px;border:1px solid #ddd;font-size:9pt;}</style></head><body>
      <table>
        <tr><td colspan="2" style="background:#FF1E00;color:#fff;font-weight:bold;font-size:12pt;text-align:center;padding:6px">${companyName}</td></tr>
        <tr><td colspan="2" style="background:#1F2937;color:#fff;font-weight:bold;font-size:11pt;text-align:center;padding:5px">${title}</td></tr>
        <tr><td colspan="2"></td></tr>
        <tr><th>Item</th><th>Amount (₱)</th></tr>
        <tr><td style="color:#166534;font-weight:bold">↑ Cash In — Collected Invoices</td><td style="text-align:right;color:#166534;font-weight:bold">₱${f2(invoiceCashIn)}</td></tr>`
      if (isDetail) monthPaid.forEach(i => { html += `<tr style="background:#F0FFF4"><td style="padding-left:20px">${i.invoice_no} · ${i.client}</td><td style="text-align:right">₱${f2(parseFloat(i.actual_amount_credited)||(i.total_sales_net||0)*1.10)}</td></tr>` })
      if (subconProfit>0) html += `<tr><td style="padding-left:12px">Sub-con Profit</td><td style="text-align:right">₱${f2(subconProfit)}</td></tr>`
      if (totalExtraIncome>0) html += `<tr><td style="padding-left:12px">Extra Income</td><td style="text-align:right">₱${f2(totalExtraIncome)}</td></tr>`
      html += `<tr style="background:#DCFCE7;font-weight:bold"><td>TOTAL CASH IN</td><td style="text-align:right">₱${f2(totalCashIn)}</td></tr>
        <tr><td colspan="2"></td></tr>
        <tr><td style="color:#991B1B;font-weight:bold">↓ Cash Out — Checks Issued</td><td style="text-align:right;color:#991B1B;font-weight:bold">₱${f2(totalChecks)}</td></tr>`
      if (isDetail) monthVoucherRows.forEach(v => { html += `<tr style="background:#FFF5F5"><td style="padding-left:20px">${v.voucher_no} · ${v.payee}</td><td style="text-align:right">₱${f2(v.amount)}</td></tr>` })
      html += `<tr><td style="padding-left:12px">Amortization</td><td style="text-align:right">₱${f2(totalAmort)}</td></tr>
        <tr><td style="padding-left:12px">Loan Payments</td><td style="text-align:right">₱${f2(totalLoanPayments)}</td></tr>
        <tr><td style="padding-left:12px">Cash/Transfer Expenses</td><td style="text-align:right">₱${f2(totalCashExpenses)}</td></tr>
        <tr style="background:#FEE2E2;font-weight:bold"><td>TOTAL CASH OUT</td><td style="text-align:right">₱${f2(totalCashOut)}</td></tr>
        <tr><td colspan="2"></td></tr>
        <tr style="background:${totalCashIn-totalCashOut>=0?'#DCFCE7':'#FEE2E2'};font-weight:bold;font-size:11pt">
          <td>NET CASH POSITION</td><td style="text-align:right">₱${f2(totalCashIn-totalCashOut)}</td>
        </tr>
      </table></body></html>`
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `Cashflow-${month}.xls`
      a.click(); URL.revokeObjectURL(url)
    } else {
      // PDF
      const doc = new jsPDF({ unit: 'mm', format: 'letter' })
      const W = 215.9
      doc.setFontSize(12); doc.setFont('helvetica','bold')
      doc.text(companyName, W/2, 14, { align: 'center' })
      doc.setFontSize(10); doc.setFont('helvetica','normal')
      doc.text(title, W/2, 20, { align: 'center' })
      doc.setDrawColor(200); doc.line(14, 23, W-14, 23)
      let y = 28
      const row = (label, val, bold, color) => {
        doc.setFont('helvetica', bold?'bold':'normal')
        if (color) doc.setTextColor(...color); else doc.setTextColor(0)
        doc.setFontSize(9)
        doc.text(label, 16, y)
        doc.text(`PHP ${f2(val)}`, W-14, y, { align: 'right' })
        y += 6
      }
      row('↑ CASH IN — COLLECTED INVOICES', invoiceCashIn, true, [21,128,61])
      if (isDetail) monthPaid.forEach(i => { doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(80); doc.text(`  ${i.invoice_no} · ${i.client}`, 20, y); doc.text(`PHP ${f2(parseFloat(i.actual_amount_credited)||(i.total_sales_net||0)*1.10)}`, W-14, y, { align:'right'}); y+=5 })
      if (subconProfit>0) row('  Sub-con Profit', subconProfit, false, [80,80,80])
      if (totalExtraIncome>0) row('  Extra Income', totalExtraIncome, false, [80,80,80])
      doc.setFillColor(220,252,231); doc.rect(14, y-1, W-28, 7, 'F')
      row('TOTAL CASH IN', totalCashIn, true, [21,128,61])
      y += 3
      row('↓ CASH OUT — CHECKS ISSUED', totalChecks, true, [153,27,27])
      if (isDetail) monthVoucherRows.forEach(v => { doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(80); doc.text(`  ${v.voucher_no} · ${v.payee}`, 20, y); doc.text(`PHP ${f2(v.amount)}`, W-14, y, { align:'right'}); y+=5 })
      row('  Amortization', totalAmort, false, [80,80,80])
      row('  Loan Payments', totalLoanPayments, false, [80,80,80])
      row('  Cash/Transfer Expenses', totalCashExpenses, false, [80,80,80])
      doc.setFillColor(254,226,226); doc.rect(14, y-1, W-28, 7, 'F')
      row('TOTAL CASH OUT', totalCashOut, true, [153,27,27])
      y += 4
      const net = totalCashIn - totalCashOut
      if (net>=0) doc.setFillColor(220,252,231); else doc.setFillColor(254,226,226)
      doc.rect(14, y-1, W-28, 9, 'F')
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(net>=0?21:153, net>=0?128:27, net>=0?61:27)
      doc.text('NET CASH POSITION', 16, y+5)
      doc.text(`PHP ${f2(net)}`, W-14, y+5, { align: 'right' })
      doc.setTextColor(0)
      doc.save(`Cashflow-${month}.pdf`)
    }
    setShowExportModal(false)
    showToast('Exported.')
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Cashflow Report</h1><p className="page-sub">Cash in from collections, cash out from checks and fixed obligations</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13 }}>
            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
              <option key={i+1} value={i+1}>{m}</option>
            ))}
          </select>
          <select value={selYear} onChange={e => setSelYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13 }}>
            {[now2.getFullYear()-2, now2.getFullYear()-1, now2.getFullYear(), now2.getFullYear()+1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="btn-ghost" onClick={handleSavePDF}>📄 Save PDF</button>
        </div>
      </div>

      {loading ? <div className="empty-state"><p>Loading…</p></div> : (<>
        {/* Summary cards */}
        <div className="stats-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-label">Cash In (Collected)</div>
            <div className="stat-value sm" style={{ color: 'var(--success)' }}>₱{fmt(totalCashIn)}</div>
            {subconProfit > 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Incl. sub-con profit ₱{fmt(subconProfit)}</div>}
          </div>
          <div className="stat-card">
            <div className="stat-label">Checks Issued</div>
            <div className="stat-value sm" style={{ color: 'var(--danger)' }}>₱{fmt(totalChecks)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Fixed Obligations</div>
            <div className="stat-value sm" style={{ color: 'var(--danger)' }}>₱{fmt(totalAmort + totalIns + totalLoanPayments)}</div>
            {totalLoanPayments > 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Incl. loans ₱{fmt(totalLoanPayments)}</div>}
          </div>
          <div className="stat-card">
            <div className="stat-label">Net Cashflow</div>
            <div className="stat-value sm" style={{ color: netCashflow >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {netCashflow >= 0 ? '+' : ''}₱{fmt(netCashflow)}
            </div>
          </div>
        </div>

        {/* Expected cash in */}
        {unpaidInvoices.length > 0 && (
          <div style={{ padding: '10px 14px', background: 'var(--accent-light)', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
            <span style={{ color: 'var(--accent-dark)' }}>📋 Expected cash in from {unpaidInvoices.length} unpaid invoice{unpaidInvoices.length > 1 ? 's' : ''}: </span>
            <span style={{ fontWeight: 500, fontFamily: 'var(--mono)' }}>₱{fmt(expectedCashIn)}</span>
          </div>
        )}

        {/* Cash Position Chart */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>📈 Cash Position — Last 6 Months</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 100 }}>
            {cashPosition.map((d, i) => (
              <div key={d.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
                  <div title={`Cash In: ₱${fmt(d.cashIn)}`} style={{ flex: 1, borderRadius: '3px 3px 0 0', height: `${(d.cashIn / maxCashAbs) * 76}px`, background: 'rgba(22,163,74,0.6)' }} />
                  <div title={`Cash Out: ₱${fmt(d.cashOut)}`} style={{ flex: 1, borderRadius: '3px 3px 0 0', height: `${(d.cashOut / maxCashAbs) * 76}px`, background: 'rgba(220,38,38,0.6)' }} />
                </div>
                <div style={{ fontSize: 9, color: d.month === month ? 'var(--accent)' : 'var(--muted)', fontWeight: d.month === month ? 600 : 400 }}>{d.label}</div>
                <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: d.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{d.net >= 0 ? '+' : ''}₱{(Math.abs(d.net)/1000).toFixed(0)}K</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(22,163,74,0.6)', borderRadius: 2, marginRight: 4 }} />Cash In</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(220,38,38,0.6)', borderRadius: 2, marginRight: 4 }} />Cash Out</span>
          </div>
        </div>

        {/* Cash In */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--success)', margin: 0 }}>↑ Cash In — Collections Received</h2>
            {monthPaid.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setShowSalesBreakdown(s => !s)}>{showSalesBreakdown ? '▲ Summary' : '▼ Breakdown'}</button>}
          </div>
          {monthPaid.length === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No payments collected in {monthLabel}.</p>
            : showSalesBreakdown ? <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Invoice No.</th><th>Client</th><th>Date Credited</th><th className="text-right">Amount (₱)</th></tr></thead>
                <tbody>
                  {monthPaid.map(i => (
                    <tr key={i.id}>
                      <td className="mono">{i.invoice_no}</td>
                      <td>{i.client}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(i.date_credited)}</td>
                      <td className="text-right mono" style={{ fontWeight: 500, color: 'var(--success)' }}>₱{fmt(parseFloat(i.actual_amount_credited) || (i.total_sales_net || 0) * 1.10)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td colSpan={3} style={{ padding: '8px 14px', fontWeight: 500, borderTop: '1px solid var(--border-md)' }}>Total</td>
                  <td className="text-right mono" style={{ padding: '8px 14px', fontWeight: 500, color: 'var(--success)', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalCashIn)}</td>
                </tr></tfoot>
              </table>
            </div>
            : <div style={{ fontSize: 13, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <span>Invoices collected: <strong>{monthPaid.length}</strong></span>
                <span>Total: <strong style={{ color: 'var(--success)', fontFamily: 'var(--mono)' }}>₱{fmt(invoiceCashIn)}</strong></span>
                {subconProfit > 0 && <span>Sub-con profit: <strong>₱{fmt(subconProfit)}</strong></span>}
                {totalExtraIncome > 0 && <span>Extra income: <strong style={{ color: 'var(--success)' }}>₱{fmt(totalExtraIncome)}</strong></span>}
                {histBkCashIn > 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}>📅 Historical: <strong>₱{fmt(histBkCashIn)}</strong></span>}
              </div>
          }
        </div>

        {/* Cash Out — Checks */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--danger)', marginBottom: 12 }}>↓ Cash Out — Checks Issued</h2>
          {monthVoucherRows.length === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No checks due in {monthLabel}.</p>
            : <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Voucher No.</th><th>Payee</th><th>Description</th><th>Check No.</th><th>Check Date</th><th className="text-right">Amount (₱)</th><th className="text-right">Running</th></tr></thead>
                <tbody>
                  {(() => { let running = 0; return monthVoucherRows.map(v => { running += parseFloat(v.amount || 0); return (
                    <tr key={v.id + (v.check_date || '')}>
                      <td className="mono">{v.voucher_no}</td>
                      <td style={{ fontWeight: 500 }}>{v.payee}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{v.description || v.remarks || '—'}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{v.check_no || '—'}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(v.check_date)}</td>
                      <td className="text-right mono" style={{ fontWeight: 500, color: 'var(--danger)' }}>₱{fmt(v.amount)}</td>
                      <td className="text-right mono" style={{ fontSize: 11, color: 'var(--muted)' }}>₱{fmt(running)}</td>
                    </tr>
                  )})})()}
                </tbody>
                <tfoot><tr>
                  <td colSpan={5} style={{ padding: '8px 14px', fontWeight: 500, borderTop: '1px solid var(--border-md)' }}>Total ({monthVoucherRows.length} checks)</td>
                  <td className="text-right mono" style={{ padding: '8px 14px', fontWeight: 500, color: 'var(--danger)', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalChecks)}</td>
                  <td style={{ borderTop: '1px solid var(--border-md)' }}></td>
                </tr></tfoot>
              </table>
            </div>
          }
        </div>

        {/* Checks issued summary */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="stat-card" style={{ flex: 1, minWidth: 140 }}>
            <div className="stat-label">Checks Issued</div>
            <div className="stat-value">{monthVoucherRows.length}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>this month</div>
          </div>
          <div className="stat-card" style={{ flex: 1, minWidth: 140 }}>
            <div className="stat-label">Total Check Amount</div>
            <div className="stat-value sm" style={{ color: 'var(--danger)' }}>₱{fmt(totalChecks)}</div>
          </div>
        </div>

        {/* Cash Out — Fixed obligations */}
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--danger)', marginBottom: 12 }}>↓ Fixed Monthly Obligations</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Type</th><th>Description</th><th className="text-right">Monthly Amount (₱)</th></tr></thead>
              <tbody>
                {monthAmort.map(a => (
                  <tr key={a.id}>
                    <td><span className="badge" style={{ fontSize: 10, background: 'var(--accent-light)', color: 'var(--accent)' }}>Amortization</span></td>
                    <td>{a.description}</td>
                    <td className="text-right mono" style={{ color: 'var(--danger)' }}>₱{fmt(a.monthly_amount)}</td>
                  </tr>
                ))}

                {monthLoans.map(l => (
                  <tr key={l.id}>
                    <td><span className="badge" style={{ fontSize: 10, background: 'rgba(220,38,38,0.1)', color: 'var(--danger)' }}>🏦 Loan</span></td>
                    <td>{l.lender}{l.description ? ` — ${l.description}` : ''}</td>
                    <td className="text-right mono" style={{ color: 'var(--danger)' }}>₱{fmt(l.monthly_payment)}</td>
                  </tr>
                ))}
                {monthAmort.length === 0 && monthIns.length === 0 && monthLoans.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>No fixed obligations this month.</td></tr>
                )}
              </tbody>
              <tfoot><tr>
                <td colSpan={2} style={{ padding: '8px 14px', fontWeight: 500, borderTop: '1px solid var(--border-md)' }}>Total</td>
                <td className="text-right mono" style={{ padding: '8px 14px', fontWeight: 500, color: 'var(--danger)', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalAmort + totalIns + totalLoanPayments)}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>

        {/* Cash Expenses */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--danger)', margin: 0 }}>↓ Cash / Transfer Expenses</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--danger)' }}>₱{fmt(totalCashExpenses)}</span>
              <button className="btn-ghost btn-sm" onClick={() => setShowExpenseBreakdown(s => !s)}>
                {showExpenseBreakdown ? '▲ Hide' : '▼ Breakdown'}
              </button>
            </div>
          </div>
          {totalCashExpenses === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No cash/transfer expenses in {monthLabel}.</p>
            : !showExpenseBreakdown
              ? <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                  {totalAdminExp > 0 && <span>Admin: <strong style={{ color: 'var(--danger)' }}>₱{fmt(totalAdminExp)}</strong></span>}
                  {totalOpExp > 0 && <span>Operation: <strong style={{ color: 'var(--danger)' }}>₱{fmt(totalOpExp)}</strong></span>}
                </div>
              : <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Category</th><th className="text-right">Amount (₱)</th></tr></thead>
                    <tbody>
                      {monthCashExpenses.map(e => (
                        <tr key={e.id}>
                          <td style={{ fontSize: 12 }}>{fmtDate(e.expense_date)}</td>
                          <td><span className="badge" style={{ fontSize: 10 }}>{e.expense_type === 'admin' ? 'Admin' : 'Operation'}</span></td>
                          <td style={{ fontSize: 12 }}>{e.description}</td>
                          <td style={{ fontSize: 12, color: 'var(--muted)' }}>{e.category || '—'}</td>
                          <td className="text-right mono" style={{ color: 'var(--danger)', fontSize: 12 }}>₱{fmt(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr>
                      <td colSpan={4} style={{ padding: '8px 14px', fontWeight: 500, borderTop: '1px solid var(--border-md)' }}>Total</td>
                      <td className="text-right mono" style={{ padding: '8px 14px', fontWeight: 500, color: 'var(--danger)', borderTop: '1px solid var(--border-md)' }}>₱{fmt(totalCashExpenses)}</td>
                    </tr></tfoot>
                  </table>
                </div>
          }
        </div>

        {/* Net summary */}
        <div className="card" style={{ border: `1.5px solid ${netCashflow >= 0 ? 'var(--success)' : 'var(--danger)'}` }}>
          <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Summary — {monthLabel}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Total Cash In', value: totalCashIn, color: 'var(--success)' },
              { label: 'Total Checks Issued', value: -totalChecks, color: 'var(--danger)' },
              { label: 'Total Fixed Obligations', value: -(totalAmort + totalIns + totalLoanPayments), color: 'var(--danger)' },
              { label: 'Cash / Transfer Expenses', value: -totalCashExpenses, color: 'var(--danger)' },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '0.5px solid var(--border)' }}>
                <span style={{ fontSize: 13 }}>{r.label}</span>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 500, color: r.color }}>{r.value >= 0 ? '+' : ''}₱{fmt(Math.abs(r.value))}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', marginTop: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>NET CASHFLOW</span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 15, color: netCashflow >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {netCashflow >= 0 ? '+' : ''}₱{fmt(netCashflow)}
              </span>
            </div>
          </div>
        </div>
      </>)}
      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
            <h3 style={{ marginBottom: 14 }}>📊 Export Cashflow</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="label">Format</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['pdf','excel'].map(f => <button key={f} onClick={() => setExportFormat(f)} className={exportFormat===f?'btn-primary btn-sm':'btn-ghost btn-sm'} style={{ flex: 1 }}>{f==='pdf'?'📄 PDF':'📊 Excel'}</button>)}
                </div>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="label">Detail Level</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['summary','detail'].map(d => <button key={d} onClick={() => setExportDetail(d)} className={exportDetail===d?'btn-primary btn-sm':'btn-ghost btn-sm'} style={{ flex: 1 }}>{d==='summary'?'📋 Summary':'🔍 Full Breakdown'}</button>)}
                </div>
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn-ghost" onClick={() => setShowExportModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleExport}>Export {month}</button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  )
}
