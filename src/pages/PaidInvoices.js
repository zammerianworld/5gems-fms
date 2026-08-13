import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fmtDate, fetchAllRows } from '../lib/supabase'
import { useToast, Toast } from '../components/Toast'
import { useNavigate } from 'react-router-dom'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'

const STATUS_COLORS = {
  Paid: { bg: 'var(--success-light)', color: 'var(--success)' },
  Returned: { bg: 'var(--danger-light)', color: 'var(--danger)' },
}

export default function PaidInvoices() {
  const { toast, showToast } = useToast()
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [filterClient, setFilterClient] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCreditedMonth, setFilterCreditedMonth] = useState('')
  const [filterCreditedQuarter, setFilterCreditedQuarter] = useState('') // e.g. '2026-Q3'
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('list') // 'list' | 'summary'
  const [periodType, setPeriodType] = useState('monthly') // 'monthly' | 'quarterly' | 'midyear' | 'annual'
  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear())
  const [settings, setSettings] = useState({})
  const [truckScope, setTruckScope] = useState('company') // 'company' | 'all'
  const [trucks, setTrucks] = useState([])
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [inv, cs, tr, dt, pt] = await Promise.all([
      fetchAllRows(() => supabase.from('invoices').select('*').is('deleted_at', null).in('status', ['Paid', 'Returned']).order('date_credited', { ascending: false })),
      supabase.from('company_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('trucks').select('id,plate,ownership,active'),
      fetchAllRows(() => supabase.from('trips_dump').select('invoice_id,truck_plate,weight_tons,rate_per_ton').is('deleted_at', null).not('invoice_id', 'is', null)),
      fetchAllRows(() => supabase.from('trips_pm').select('invoice_id,truck_plate,trip_code,supplier_amount,stripping_fee').is('deleted_at', null).not('invoice_id', 'is', null)),
    ])
    if (inv.data) setInvoices(inv.data)
    if (cs.data) setSettings(cs.data)
    if (tr.data) setTrucks(tr.data)
    if (dt.data) setDumpTrips(dt.data)
    if (pt.data) setPmTrips(pt.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = invoices.filter(i => {
    if (filterYear && !i.invoice_date?.startsWith(filterYear)) return false
    if (filterClient && i.client !== filterClient) return false
    if (filterType && i.truck_type !== filterType) return false
    if (filterCreditedMonth && !i.date_credited?.startsWith(filterCreditedMonth)) return false
    if (filterCreditedQuarter) {
      const [qy, q] = filterCreditedQuarter.split('-Q')
      const cm = i.date_credited?.slice(0, 7) // 'YYYY-MM'
      if (!cm || cm.slice(0, 4) !== qy) return false
      const mm = Number(cm.slice(5, 7))
      const qOf = Math.ceil(mm / 3)
      if (String(qOf) !== q) return false
    }
    if (search && !i.invoice_no?.toLowerCase().includes(search.toLowerCase()) &&
        !i.client?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const uniqueClients = [...new Set(invoices.map(i => i.client).filter(Boolean))].sort()
  const years = [...new Set(invoices.map(i => i.invoice_date?.slice(0, 4)).filter(Boolean))].sort().reverse()
  const creditedMonths = [...new Set(invoices.map(i => i.date_credited?.slice(0, 7)).filter(Boolean))].sort().reverse()
  const creditedQuarters = [...new Set(invoices.map(i => {
    if (!i.date_credited) return null
    const y = i.date_credited.slice(0, 4)
    const m = Number(i.date_credited.slice(5, 7))
    return `${y}-Q${Math.ceil(m / 3)}`
  }).filter(Boolean))].sort().reverse()
  const monthLabel = (ym) => {
    const [y, m] = ym.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const totalCollected = filtered.filter(i => i.status === 'Paid').reduce((s, i) => s + (parseFloat(i.actual_amount_credited) || (i.total_sales_net || 0) * 1.10), 0)
  const totalNet = filtered.reduce((s, i) => s + (i.total_sales_net || 0), 0)

  // ── SALES INVOICE SUMMARY (Monthly / Quarterly / Mid-Year / Annual) ────────
  const lastDay = (y, m) => new Date(y, m, 0).getDate() // m is 1-indexed month
  const paidInvoices = invoices.filter(i => i.status === 'Paid' && i.date_credited)

  const getPeriods = (type, year) => {
    if (type === 'monthly') {
      return Array.from({ length: 12 }, (_, i) => {
        const m = i + 1
        return {
          label: `Sales Invoices ${new Date(year, i, 1).toLocaleDateString('en-US', { month: 'long' })} ${year}`,
          start: `${year}-${String(m).padStart(2, '0')}-01`,
          end: `${year}-${String(m).padStart(2, '0')}-${String(lastDay(year, m)).padStart(2, '0')}`,
        }
      })
    }
    if (type === 'quarterly') {
      const qs = [[1, 3, 'Q1'], [4, 6, 'Q2'], [7, 9, 'Q3'], [10, 12, 'Q4']]
      return qs.map(([sm, em, label]) => ({
        label: `Sales Invoices ${label} ${year} (${new Date(year, sm - 1, 1).toLocaleDateString('en-US', { month: 'short' })}–${new Date(year, em - 1, 1).toLocaleDateString('en-US', { month: 'short' })})`,
        start: `${year}-${String(sm).padStart(2, '0')}-01`,
        end: `${year}-${String(em).padStart(2, '0')}-${String(lastDay(year, em)).padStart(2, '0')}`,
      }))
    }
    if (type === 'midyear') {
      return [
        { label: `Sales Invoices H1 ${year} (Jan–Jun)`, start: `${year}-01-01`, end: `${year}-06-${lastDay(year, 6)}` },
        { label: `Sales Invoices H2 ${year} (Jul–Dec)`, start: `${year}-07-01`, end: `${year}-12-31` },
      ]
    }
    // annual
    return [{ label: `Sales Invoices Full Year ${year}`, start: `${year}-01-01`, end: `${year}-12-31` }]
  }

  // Scope must match Reports.js exactly: only trips whose plate matches an ACTIVE truck record.
  // Reports filters per-truck (t.truck_plate === truck.plate) over activeTrucks, so any trip whose
  // plate has no matching active truck is silently dropped there — we mirror that here.
  const activeTrucks = trucks.filter(t => t.active !== false)
  const ownedPlates = new Set(activeTrucks.filter(t => t.ownership !== 'subcon' && t.ownership !== 'special_subcon').map(t => t.plate))
  const allScopePlates = new Set(activeTrucks.map(t => t.plate))
  const inScope = (plate) => truckScope === 'all' ? allScopePlates.has(plate) : ownedPlates.has(plate)
  const pmNet = (t) => {
    const raw = (parseFloat(t.supplier_amount) || 0) + (parseFloat(t.stripping_fee) || 0)
    return t.trip_code === 'SMC' ? raw / 1.12 : raw
  }

  const summaryRows = getPeriods(periodType, summaryYear).map(p => {
    const rows = paidInvoices.filter(i => i.date_credited >= p.start && i.date_credited <= p.end)
    const invoiceIds = new Set(rows.map(i => i.id))
    // Trip-based net — respects truck scope (company-only vs all incl. subcon) and SMC VAT adjustment
    const dumpNet = dumpTrips.filter(t => invoiceIds.has(t.invoice_id) && inScope(t.truck_plate))
      .reduce((s, t) => s + (parseFloat(t.weight_tons) || 0) * (parseFloat(t.rate_per_ton) || 0), 0)
    const pmNetSum = pmTrips.filter(t => invoiceIds.has(t.invoice_id) && inScope(t.truck_plate))
      .reduce((s, t) => s + pmNet(t), 0)
    const net = dumpNet + pmNetSum
    const vat = net * 0.12
    const vatInc = net * 1.12
    const wht = net * 0.02
    const total = vatInc - wht
    return { label: p.label, count: rows.length, net, vat, vatInc, wht, total }
  })
  const summaryTotal = summaryRows.reduce((acc, r) => ({
    net: acc.net + r.net, vat: acc.vat + r.vat, vatInc: acc.vatInc + r.vatInc, wht: acc.wht + r.wht, total: acc.total + r.total,
  }), { net: 0, vat: 0, vatInc: 0, wht: 0, total: 0 })

  // ── DIAGNOSTIC: trips excluded by truck-scope matching ──────────────────────
  // Classified by reason. Subcon trips are EXPECTED to be excluded from a
  // company-only view (their revenue passes through to the subcontractor).
  // Only trips with no truck record at all indicate a real data problem.
  const subconPlates = new Set(trucks.filter(t => t.ownership === 'subcon' || t.ownership === 'special_subcon').map(t => t.plate))
  const inactivePlates = new Set(trucks.filter(t => t.active === false).map(t => t.plate))
  const knownPlates = new Set(trucks.map(t => t.plate))
  const classify = (plate) => {
    if (!plate) return 'blank'
    if (subconPlates.has(plate)) return 'subcon'
    if (inactivePlates.has(plate)) return 'inactive'
    if (!knownPlates.has(plate)) return 'unknown'
    return 'other'
  }
  const yearPaidIds = new Set(paidInvoices.filter(i => i.date_credited?.startsWith(String(summaryYear))).map(i => i.id))
  const orphanTrips = [
    ...dumpTrips.filter(t => yearPaidIds.has(t.invoice_id) && !inScope(t.truck_plate))
      .map(t => ({ plate: t.truck_plate, amt: (parseFloat(t.weight_tons)||0)*(parseFloat(t.rate_per_ton)||0), reason: classify(t.truck_plate) })),
    ...pmTrips.filter(t => yearPaidIds.has(t.invoice_id) && !inScope(t.truck_plate))
      .map(t => ({ plate: t.truck_plate, amt: pmNet(t), reason: classify(t.truck_plate) })),
  ]
  const orphanByPlate = {}
  orphanTrips.forEach(o => {
    const k = o.plate || '(blank plate)'
    if (!orphanByPlate[k]) orphanByPlate[k] = { count: 0, amt: 0, reason: o.reason }
    orphanByPlate[k].count++
    orphanByPlate[k].amt += o.amt
  })
  const orphanTotal = orphanTrips.reduce((s, o) => s + o.amt, 0)
  // Only these need attention — subcon exclusions are correct by design
  const problemTotal = orphanTrips.filter(o => o.reason === 'unknown' || o.reason === 'blank').reduce((s, o) => s + o.amt, 0)
  const REASON_LABEL = {
    subcon: { text: 'Sub-con — excluded by design', color: 'var(--muted)' },
    inactive: { text: 'Inactive truck', color: 'var(--warning)' },
    unknown: { text: '⚠️ No truck record — check plate', color: 'var(--danger)' },
    blank: { text: '⚠️ Blank plate', color: 'var(--danger)' },
    other: { text: 'Other', color: 'var(--muted)' },
  }

  const handleSaveSummaryPDF = () => {
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
    const W = 279.4
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text(companyName, W / 2, 12, { align: 'center' })
    doc.setFontSize(11); doc.setFont('helvetica', 'normal')
    doc.text('SALES INVOICE', W / 2, 19, { align: 'center' })
    doc.setDrawColor(200); doc.line(14, 23, W - 14, 23)

    autoTable(doc, {
      startY: 27, margin: { left: 14, right: 14 },
      head: [['', 'Total Sales Net of VAT', 'VAT (12%)', 'Total Sales VAT Inclusive', 'Withholding Tax (2%)', 'Total Amount']],
      body: [
        ...summaryRows.map(r => [r.label, `PHP ${fmt(r.net)}`, `PHP ${fmt(r.vat)}`, `PHP ${fmt(r.vatInc)}`, `PHP ${fmt(r.wht)}`, `PHP ${fmt(r.total)}`]),
        [{ content: 'TOTAL', styles: { fontStyle: 'bold' } }, `PHP ${fmt(summaryTotal.net)}`, `PHP ${fmt(summaryTotal.vat)}`, `PHP ${fmt(summaryTotal.vatInc)}`, `PHP ${fmt(summaryTotal.wht)}`, `PHP ${fmt(summaryTotal.total)}`],
      ],
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bolditalic', fontSize: 8.5 },
      columnStyles: { 0: { fontStyle: 'bold' } },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      didParseCell: (data) => { if (data.row.index === summaryRows.length) data.cell.styles.fillColor = [254, 249, 195] },
    })

    doc.save(`Sales-Invoice-Summary-${periodType}-${summaryYear}.pdf`)
    showToast('PDF saved.')
  }

  const handleSaveSummaryExcel = async () => {
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sales Invoice Summary')
    ws.columns = [{ width: 30 }, { width: 20 }, { width: 16 }, { width: 22 }, { width: 18 }, { width: 18 }]
    ws.mergeCells('A1:F1'); ws.getCell('A1').value = companyName
    ws.getCell('A1').font = { bold: true, size: 13 }; ws.getCell('A1').alignment = { horizontal: 'center' }
    ws.mergeCells('A2:F2'); ws.getCell('A2').value = 'SALES INVOICE'
    ws.getCell('A2').font = { bold: true, size: 11 }; ws.getCell('A2').alignment = { horizontal: 'center' }

    const thin = { style: 'thin', color: { argb: 'FFAAAAAA' } }
    const allB = { top: thin, left: thin, bottom: thin, right: thin }
    const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
    const hdrFont = { bold: true, italic: true, color: { argb: 'FFFFFFFF' }, size: 9 }

    const hRow = ws.getRow(4)
    ;['', 'Total Sales Net of VAT', 'VAT (12%)', 'Total Sales VAT Inclusive', 'Withholding Tax (2%)', 'Total Amount'].forEach((h, i) => {
      const cell = hRow.getCell(i + 1); cell.value = h; cell.font = hdrFont; cell.fill = hdrFill; cell.border = allB; cell.alignment = { horizontal: 'center', wrapText: true }
    })

    summaryRows.forEach((r, i) => {
      const row = ws.getRow(5 + i)
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB'
      ;[r.label, r.net, r.vat, r.vatInc, r.wht, r.total].forEach((v, ci) => {
        const cell = row.getCell(ci + 1); cell.value = v; cell.border = allB
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        if (ci === 0) cell.font = { bold: true }
        else cell.numFmt = '#,##0.00'
      })
    })

    const tRow = ws.getRow(5 + summaryRows.length)
    ;['TOTAL', summaryTotal.net, summaryTotal.vat, summaryTotal.vatInc, summaryTotal.wht, summaryTotal.total].forEach((v, ci) => {
      const cell = tRow.getCell(ci + 1); cell.value = v; cell.font = { bold: true }; cell.border = allB
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } }
      if (ci > 0) cell.numFmt = '#,##0.00'
    })
    ws.views = [{ showGridLines: false }]

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `Sales-Invoice-Summary-${periodType}-${summaryYear}.xlsx`; a.click(); URL.revokeObjectURL(url)
    showToast('Excel exported.')
  }

  // ── BOOKKEEPER EXPORT — one row per invoice, for forwarding to the bookkeeper ──
  const handleBookkeeperExport = async (label) => {
    const candidates = filtered.filter(i => i.status === 'Paid')
    // When scoped to company-only, recompute each invoice's net sales from just
    // its in-scope trips (an invoice can mix company and subcon trucks) and
    // drop any invoice with nothing in scope — mirrors how the Summary tab
    // already handles this, just at invoice level instead of trip level.
    const rows = candidates.map(inv => {
      if (truckScope === 'all') return { ...inv, _net: inv.total_sales_net || 0, _fullyInScope: true }
      const tbl = inv.truck_type === 'Dump Truck' ? dumpTrips : pmTrips
      const invTrips = tbl.filter(t => t.invoice_id === inv.id && inScope(t.truck_plate))
      const net = inv.truck_type === 'Dump Truck'
        ? invTrips.reduce((s, t) => s + (parseFloat(t.weight_tons) || 0) * (parseFloat(t.rate_per_ton) || 0), 0)
        : invTrips.reduce((s, t) => s + pmNet(t), 0)
      const fullyInScope = Math.abs(net - (inv.total_sales_net || 0)) < 1
      return { ...inv, _net: net, _fullyInScope: fullyInScope }
    }).filter(inv => inv._net > 0)

    if (rows.length === 0) { showToast('No paid invoices in this selection.', 'error'); return }
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Paid Invoices')
    ws.columns = [
      { width: 16 }, { width: 26 }, { width: 13 }, { width: 13 }, { width: 13 },
      { width: 16 }, { width: 14 }, { width: 13 }, { width: 17 },
    ]
    ws.mergeCells('A1:I1'); ws.getCell('A1').value = companyName
    ws.getCell('A1').font = { bold: true, size: 13 }; ws.getCell('A1').alignment = { horizontal: 'center' }
    ws.mergeCells('A2:I2'); ws.getCell('A2').value = `PAID INVOICES — ${label.toUpperCase()}${truckScope === 'company' ? ' (COMPANY TRUCKS ONLY)' : ' (ALL TRUCKS)'}`
    ws.getCell('A2').font = { bold: true, size: 11 }; ws.getCell('A2').alignment = { horizontal: 'center' }

    const thin = { style: 'thin', color: { argb: 'FFAAAAAA' } }
    const allB = { top: thin, left: thin, bottom: thin, right: thin }
    const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
    const hdrFont = { bold: true, italic: true, color: { argb: 'FFFFFFFF' }, size: 9 }

    const headers = ['Invoice No.', 'Client', 'Truck Type', 'Invoice Date', 'Date Paid', 'Net Sales', 'VAT (12%)', 'WHT (2%)', 'Amount Received']
    const hRow = ws.getRow(4)
    headers.forEach((h, i) => {
      const cell = hRow.getCell(i + 1); cell.value = h; cell.font = hdrFont; cell.fill = hdrFill; cell.border = allB; cell.alignment = { horizontal: 'center', wrapText: true }
    })

    const sorted = [...rows].sort((a, b) => (a.date_credited || '').localeCompare(b.date_credited || ''))
    let totals = { net: 0, vat: 0, wht: 0, received: 0 }
    sorted.forEach((inv, i) => {
      const net = inv._net
      const vat = net * 0.12
      const wht = net * 0.02
      // If scoped to company-only and this invoice also had subcon trips, the
      // full actual_amount_credited isn't this invoice's company-only share —
      // fall back to the 1.10 estimate on the adjusted net instead.
      const received = (parseFloat(inv.actual_amount_credited) && (truckScope === 'all' || inv._fullyInScope))
        ? parseFloat(inv.actual_amount_credited)
        : (net * 1.10)
      totals.net += net; totals.vat += vat; totals.wht += wht; totals.received += received
      const row = ws.getRow(5 + i)
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB'
      ;[inv.invoice_no, inv.client, inv.truck_type, fmtDate(inv.invoice_date), fmtDate(inv.date_credited), net, vat, wht, received].forEach((v, ci) => {
        const cell = row.getCell(ci + 1); cell.value = v; cell.border = allB
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        if (ci >= 5) cell.numFmt = '#,##0.00'
      })
    })

    const tRow = ws.getRow(5 + sorted.length)
    ;['', '', '', '', 'TOTAL', totals.net, totals.vat, totals.wht, totals.received].forEach((v, ci) => {
      const cell = tRow.getCell(ci + 1); cell.value = v; cell.font = { bold: true }; cell.border = allB
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } }
      if (ci >= 5) cell.numFmt = '#,##0.00'
    })
    ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 4 }]

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `Paid-Invoices-${label.replace(/\s+/g, '-')}${truckScope === 'company' ? '-CompanyOnly' : ''}.xlsx`; a.click(); URL.revokeObjectURL(url)
    showToast(`Exported ${sorted.length} invoice${sorted.length !== 1 ? 's' : ''}.`)
  }

  const handlePrintSummary = () => {
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const rowsHtml = summaryRows.map(r => `
      <tr>
        <td style="font-weight:600;padding:8px 10px;border:1px solid #333;">${r.label}</td>
        <td style="text-align:right;padding:8px 10px;border:1px solid #333;">PHP ${fmt(r.net)}</td>
        <td style="text-align:right;padding:8px 10px;border:1px solid #333;">PHP ${fmt(r.vat)}</td>
        <td style="text-align:right;padding:8px 10px;border:1px solid #333;">PHP ${fmt(r.vatInc)}</td>
        <td style="text-align:right;padding:8px 10px;border:1px solid #333;">PHP ${fmt(r.wht)}</td>
        <td style="text-align:right;padding:8px 10px;border:1px solid #333;font-weight:700;">PHP ${fmt(r.total)}</td>
      </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><title>Sales Invoice Summary</title><style>
      body{font-family:Arial,sans-serif;padding:24px;}
      h1{text-align:center;font-size:16px;margin:0 0 4px;}
      h2{text-align:center;font-size:14px;font-weight:normal;margin:0 0 16px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th{background:#1F2937;color:#fff;padding:8px 10px;border:1px solid #333;font-style:italic;font-weight:bold;}
      tfoot td{font-weight:bold;background:#FEF9C3;padding:8px 10px;border:1px solid #333;}
      @media print{@page{size:landscape;margin:12mm}}
    </style></head><body>
      <h1>${companyName}</h1>
      <h2>SALES INVOICE</h2>
      <table>
        <thead><tr><th></th><th>Total Sales Net of VAT</th><th>VAT (12%)</th><th>Total Sales VAT Inclusive</th><th>Withholding Tax (2%)</th><th>Total Amount</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><td>TOTAL</td><td style="text-align:right">PHP ${fmt(summaryTotal.net)}</td><td style="text-align:right">PHP ${fmt(summaryTotal.vat)}</td><td style="text-align:right">PHP ${fmt(summaryTotal.vatInc)}</td><td style="text-align:right">PHP ${fmt(summaryTotal.wht)}</td><td style="text-align:right">PHP ${fmt(summaryTotal.total)}</td></tr></tfoot>
      </table>
      <script>window.onload=()=>{window.print()}</script>
    </body></html>`
    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Paid Invoices</h1><p className="page-sub">Completed and returned invoices</p></div>
      </div>

      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[['list', '📋 List'], ['summary', '🧾 Sales Invoice Summary']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)} style={{
            padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
            background: activeTab === key ? 'var(--accent)' : 'var(--surface)',
            color: activeTab === key ? '#fff' : 'var(--muted)',
            border: `1.5px solid ${activeTab === key ? 'var(--accent)' : 'var(--border)'}`,
          }}>{label}</button>
        ))}
      </div>

      {activeTab === 'summary' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <select value={periodType} onChange={e => setPeriodType(e.target.value)} style={{ width: 'auto' }}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="midyear">Mid-Year</option>
                <option value="annual">Annual</option>
              </select>
              <select value={summaryYear} onChange={e => setSummaryYear(Number(e.target.value))} style={{ width: 'auto' }}>
                {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>Truck scope:</span>
              {[['company', '🚛 Company Trucks Only'], ['all', '🚛🤝 All (incl. Subcon)']].map(([key, label]) => (
                <button key={key} onClick={() => setTruckScope(key)} style={{ padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 500, background: truckScope === key ? 'var(--text)' : 'var(--surface)', color: truckScope === key ? 'var(--surface)' : 'var(--muted)', border: `1.5px solid ${truckScope === key ? 'var(--text)' : 'var(--border)'}` }}>{label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={handlePrintSummary}>🖨️ Print</button>
              <button className="btn-ghost" onClick={handleSaveSummaryPDF}>📄 Save PDF</button>
              <button className="btn-ghost" onClick={handleSaveSummaryExcel}>📊 Excel</button>
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Based on payments credited (Date Credited), combining both Dump Truck and Prime Mover (SMC + PSACC) invoices.
            {truckScope === 'company' && ' Excludes trips run on subcontracted trucks.'}
          </p>

          {loading ? <div className="empty-state"><p>Loading…</p></div> : (
            <div className="card">
              <h2 style={{ textAlign: 'center', fontSize: 15, fontWeight: 700, marginBottom: 16, letterSpacing: '0.02em' }}>SALES INVOICE</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th></th>
                      <th className="text-right">Total Sales Net of VAT</th>
                      <th className="text-right">VAT (12%)</th>
                      <th className="text-right">Total Sales VAT Inclusive</th>
                      <th className="text-right">Withholding Tax (2%)</th>
                      <th className="text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{r.label}{r.count === 0 && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}> (no payments)</span>}</td>
                        <td className="text-right mono">₱{fmt(r.net)}</td>
                        <td className="text-right mono muted">₱{fmt(r.vat)}</td>
                        <td className="text-right mono muted">₱{fmt(r.vatInc)}</td>
                        <td className="text-right mono muted">₱{fmt(r.wht)}</td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--accent-light)' }}>
                      <td style={{ fontWeight: 700 }}>TOTAL</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(summaryTotal.net)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(summaryTotal.vat)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(summaryTotal.vatInc)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(summaryTotal.wht)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--success)' }}>₱{fmt(summaryTotal.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {!loading && orphanTotal > 0 && (
            <div className="card" style={{ marginTop: 16, borderLeft: `3px solid ${problemTotal > 0 ? 'var(--danger)' : 'var(--border-md)'}` }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Excluded from totals — {orphanTrips.length} trip{orphanTrips.length !== 1 ? 's' : ''} ({summaryYear})
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                {truckScope === 'company'
                  ? 'Trips on paid invoices not counted in the company-only view. Sub-con trips are excluded by design — that revenue passes through to the subcontractor.'
                  : 'Trips on paid invoices whose plate matches no active truck record.'}
                {problemTotal > 0 && <> <strong style={{ color: 'var(--danger)' }}>Rows marked in red need attention</strong> — the plate matches no truck record, so this revenue is invisible to every report.</>}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Plate</th><th>Reason</th><th className="text-right">Trips</th><th className="text-right">Net Amount</th></tr></thead>
                  <tbody>
                    {Object.entries(orphanByPlate).sort((a, b) => b[1].amt - a[1].amt).map(([plate, v]) => {
                      const rl = REASON_LABEL[v.reason] || REASON_LABEL.other
                      return (
                        <tr key={plate}>
                          <td style={{ fontWeight: 500 }}>{plate}</td>
                          <td style={{ fontSize: 11.5, color: rl.color }}>{rl.text}</td>
                          <td className="text-right mono">{v.count}</td>
                          <td className="text-right mono" style={{ color: rl.color }}>₱{fmt(v.amt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ fontWeight: 700 }}>TOTAL EXCLUDED</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>{orphanTrips.length}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(orphanTotal)}</td>
                    </tr>
                    {problemTotal > 0 && (
                      <tr>
                        <td colSpan={2} style={{ fontWeight: 700, color: 'var(--danger)' }}>NEEDS ATTENTION</td>
                        <td></td>
                        <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--danger)' }}>₱{fmt(problemTotal)}</td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'list' && (<>
      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Showing{filterCreditedMonth ? ` — ${monthLabel(filterCreditedMonth)}` : ''}</div>
          <div className="stat-value">{filtered.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Net Sales</div>
          <div className="stat-value sm">₱{fmt(totalNet)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Collected</div>
          <div className="stat-value sm" style={{ color: 'var(--success)' }}>₱{fmt(totalCollected)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Returned</div>
          <div className="stat-value sm" style={{ color: 'var(--danger)' }}>{invoices.filter(i => i.status === 'Returned').length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <input placeholder="Search invoice no. or client…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 2 }} />
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All clients</option>
          {uniqueClients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All types</option>
          <option value="Dump Truck">Dump Truck</option>
          <option value="Prime Mover">Prime Mover</option>
        </select>
        <select value={filterCreditedMonth} onChange={e => { setFilterCreditedMonth(e.target.value); if (e.target.value) { setFilterYear(''); setFilterCreditedQuarter('') } }} style={{ width: 'auto' }}>
          <option value="">All credited months</option>
          {creditedMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={filterCreditedQuarter} onChange={e => { setFilterCreditedQuarter(e.target.value); if (e.target.value) { setFilterYear(''); setFilterCreditedMonth('') } }} style={{ width: 'auto' }}>
          <option value="">All credited quarters</option>
          {creditedQuarters.map(q => <option key={q} value={q}>{q.replace('-', ' ')}</option>)}
        </select>
        {(search || filterClient || filterType || filterCreditedMonth || filterCreditedQuarter) && (
          <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterClient(''); setFilterType(''); setFilterCreditedMonth(''); setFilterCreditedQuarter('') }}>Clear</button>
        )}
      </div>

      {/* Bookkeeper export — one row per paid invoice for the current filter selection */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: 'var(--accent-light)', borderRadius: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--accent-dark)' }}>📤 For your bookkeeper: exports the paid invoices currently shown above{filterCreditedMonth ? ` (${monthLabel(filterCreditedMonth)})` : filterCreditedQuarter ? ` (${filterCreditedQuarter.replace('-', ' ')})` : ''} as one reconciliation spreadsheet.</span>
        <div style={{ display: 'flex', marginLeft: 'auto', gap: 4 }}>
          {[{ key: 'company', label: 'Company Only' }, { key: 'all', label: 'All Trucks' }].map(({ key, label }) => (
            <button key={key} onClick={() => setTruckScope(key)} style={{ padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontWeight: 500, background: truckScope === key ? 'var(--text)' : 'var(--surface)', color: truckScope === key ? 'var(--surface)' : 'var(--muted)', border: `1.5px solid ${truckScope === key ? 'var(--text)' : 'var(--border)'}` }}>{label}</button>
          ))}
        </div>
        <button className="btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}
          onClick={() => handleBookkeeperExport(filterCreditedMonth ? monthLabel(filterCreditedMonth) : filterCreditedQuarter ? filterCreditedQuarter.replace('-', ' ') : filterYear ? `Year ${filterYear}` : 'All Filtered Results')}>
          📊 Export for Bookkeeper
        </button>
      </div>

      {/* Invoice cards */}
      {loading ? <div className="empty-state"><p>Loading…</p></div> :
        filtered.length === 0 ? <div className="empty-state"><p>No paid invoices found.</p></div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(inv => {
              const net = inv.total_sales_net || 0
              const due = (net * 1.12) - (net * 0.02)
              const collected = parseFloat(inv.actual_amount_credited) || due
              return (
                <div key={inv.id} className="card" style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>{inv.invoice_no}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(inv.invoice_date)}</span>
                    <span style={{ fontWeight: 500, flex: 1 }}>{inv.client}</span>
                    <span className={`badge ${inv.truck_type === 'Dump Truck' ? 'badge-dump' : 'badge-prime'}`} style={{ fontSize: 10 }}>
                      {inv.truck_type === 'Dump Truck' ? 'Dump' : 'PM'}
                    </span>
                    <span className="badge" style={{ fontSize: 10, background: STATUS_COLORS[inv.status]?.bg, color: STATUS_COLORS[inv.status]?.color }}>
                      {inv.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                    <span>Net: <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>₱{fmt(net)}</span></span>
                    <span>Total Due: <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>₱{fmt(due)}</span></span>
                    {inv.status === 'Paid' && (
                      <span style={{ color: 'var(--success)' }}>
                        Collected: <span style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>₱{fmt(collected)}</span>
                        {inv.date_credited && ` on ${fmtDate(inv.date_credited)}`}
                      </span>
                    )}
                    {inv.remarks && <span style={{ fontStyle: 'italic' }}>{inv.remarks}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className="btn-ghost btn-sm" onClick={() => navigate('/billing', { state: { searchInvoice: inv.invoice_no, autoPreview: true } })}>🖨️ Reprint SOA</button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
      </>)}
      <Toast toast={toast} />
    </div>
  )
}
