import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fmtDate, fetchAllRows } from '../lib/supabase'
import { useToast, Toast } from '../components/Toast'
import { useAuth } from '../components/AuthContext'
import SignatoryDialog from '../components/SignatoryDialog'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function YearOverYear() {
  const { toast, showToast } = useToast()
  const { profile } = useAuth()
  const [sigDialog, setSigDialog] = useState(false)
  const [sigPendingFormat, setSigPendingFormat] = useState(null) // 'pdf' | 'excel'
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [expenses, setExpenses] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  const currentYear = new Date().getFullYear()
  const [yearA, setYearA] = useState(currentYear - 1)
  const [yearB, setYearB] = useState(currentYear)

  const [historicalData, setHistoricalData] = useState([])
  const [extraIncomeData, setExtraIncomeData] = useState([])
  const [modeA, setModeA] = useState('auto') // 'auto' | 'live' | 'historical'
  const [modeB, setModeB] = useState('auto')
  const [activeTab, setActiveTab] = useState('yoy') // 'yoy' | 'yes'
  const [summaryYear, setSummaryYear] = useState(currentYear)
  const [yesOrientation, setYesOrientation] = useState('landscape')
  const [employees, setEmployees] = useState([])
  const [payrollEntries, setPayrollEntries] = useState([])
  const [pmTripsDetail, setPmTripsDetail] = useState([])
  const [settings, setSettings] = useState({})
  const [trucks, setTrucks] = useState([])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [dt, pt, exp, inv, hist, ei, emp, pay, ptd, cs, tk] = await Promise.all([
      fetchAllRows(() => supabase.from('trips_dump').select('trip_date,truck_plate,weight_tons,rate_per_ton').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('trips_pm').select('trip_date,truck_plate,trip_code,supplier_amount,stripping_fee').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('expenses').select('expense_date,amount,expense_type,category').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('invoices').select('invoice_date,total_sales_net,status,date_credited,actual_amount_credited,truck_type').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('historical_data').select('*')),
      fetchAllRows(() => supabase.from('extra_income').select('*')),
      supabase.from('payroll_employees').select('id,full_name,is_active'),
      supabase.from('payroll_entries').select('cutoff_date,basic_salary,overtime_pay,rest_day_duty,salary_adjustment,allowance,sss_employee,philhealth_employee,hdmf_premium,ca_deduction'),
      fetchAllRows(() => supabase.from('trips_pm').select('trip_date,trip_code,container_size,containers,supplier_amount,stripping_fee').is('deleted_at', null)),
      supabase.from('company_settings').select('*').eq('id',1).maybeSingle(),
      supabase.from('trucks').select('id,plate'),
    ])
    if (dt.data) setDumpTrips(dt.data)
    if (pt.data) setPmTrips(pt.data)
    if (exp.data) setExpenses(exp.data)
    if (inv.data) setInvoices(inv.data)
    if (hist.data) setHistoricalData(hist.data)
    if (ei.data) setExtraIncomeData(ei.data)
    if (emp.data) setEmployees(emp.data)
    if (pay.data) setPayrollEntries(pay.data)
    if (ptd.data) setPmTripsDetail(ptd.data)
    if (cs.data) setSettings(cs.data)
    if (tk.data) setTrucks(tk.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // SMC trip_code stores supplier_amount + stripping_fee as VAT-inclusive; divide by 1.12 to get net sales.
  const pmNet = (t) => {
    const raw = (parseFloat(t.supplier_amount) || 0) + (parseFloat(t.stripping_fee) || 0)
    return t.trip_code === 'SMC' ? raw / 1.12 : raw
  }

  const getYearData = (year, mode = 'auto') => {
    const histYear = historicalData.filter(h => h.period_year === String(year))
    // Trucks that have a historical_data row for this year are matched by plate
    // and excluded from the live trip sum below — their sales come from the
    // historical row instead. This blends live + historical PER TRUCK instead
    // of an all-or-nothing switch for the whole year, so a truck with no
    // historical entry never loses its live data just because some other
    // truck happens to have one.
    const histTruckIds = new Set(histYear.map(h => h.truck_id))
    const histPlates = new Set(trucks.filter(t => histTruckIds.has(t.id)).map(t => t.plate))

    const yearDumpTrips = dumpTrips.filter(t => t.trip_date?.startsWith(year))
    const yearPmTrips = pmTrips.filter(t => t.trip_date?.startsWith(year))
    const liveOnlyDumpTrips = yearDumpTrips.filter(t => !histPlates.has(t.truck_plate))
    const liveOnlyPmTrips = yearPmTrips.filter(t => !histPlates.has(t.truck_plate))

    const liveDumpSales = yearDumpTrips.reduce((s, t) => s + (t.weight_tons || 0) * (t.rate_per_ton || 0), 0)
    const livePmSales = yearPmTrips.reduce((s, t) => s + pmNet(t), 0)
    const liveExp = expenses.filter(e => e.expense_date?.startsWith(year)).reduce((s, e) => s + (e.amount || 0), 0)
    const histExp = histYear.reduce((s,h) => s+Object.values(h.expenses||{}).reduce((ss,v)=>ss+(parseFloat(v)||0),0), 0)
    const hasLive = liveDumpSales + livePmSales > 0
    const hasHistorical = histYear.length > 0
    // Mode: auto = per-truck blend; live = force live only (debug/comparison); historical = force historical only.
    const blendDumpSales = liveOnlyDumpTrips.reduce((s, t) => s + (t.weight_tons || 0) * (t.rate_per_ton || 0), 0)
      + histYear.reduce((s,h)=>s+(parseFloat(h.sales_dump)||0),0)
    const blendPmSales = liveOnlyPmTrips.reduce((s, t) => s + pmNet(t), 0)
      + histYear.reduce((s,h)=>s+(parseFloat(h.sales_pm)||0),0)
    const useHist = mode === 'historical' || (mode === 'auto' && (!hasLive || hasHistorical))
    const yearExtraIncome = extraIncomeData.filter(e => e.income_date?.startsWith(String(year))).reduce((s,e)=>s+(parseFloat(e.amount)||0),0)
    const dumpSales = mode === 'live' ? liveDumpSales : mode === 'historical' ? histYear.reduce((s,h)=>s+(parseFloat(h.sales_dump)||0),0) : blendDumpSales
    const pmSales = mode === 'live' ? livePmSales : mode === 'historical' ? histYear.reduce((s,h)=>s+(parseFloat(h.sales_pm)||0),0) : blendPmSales
    const totalSales = dumpSales + pmSales + yearExtraIncome
    const totalExp = useHist && hasHistorical && histExp > 0 ? histExp : liveExp
    const dumpTripsCount = mode === 'historical' ? null : mode === 'live' ? yearDumpTrips.length : (hasHistorical ? liveOnlyDumpTrips.length : (hasLive ? yearDumpTrips.length : null))
    const pmTripsCount = mode === 'historical' ? null : mode === 'live' ? yearPmTrips.length : (hasHistorical ? liveOnlyPmTrips.length : (hasLive ? yearPmTrips.length : null))
    const paidInv = invoices.filter(i => i.status === 'Paid' && (i.date_credited || '').startsWith(String(year)))
    const totalCollected = paidInv.reduce((s, i) => s + (parseFloat(i.actual_amount_credited) || (i.total_sales_net || 0) * 1.10), 0)

    const monthly = MONTHS.map((_, mi) => {
      const mo = String(year) + '-' + String(mi + 1).padStart(2, '0')
      const moStr = String(mi + 1).padStart(2, '0')
      const histMo = histYear.filter(h => h.period_month === moStr)
      const histMoTruckIds = new Set(histMo.map(h => h.truck_id))
      const histMoPlates = new Set(trucks.filter(t => histMoTruckIds.has(t.id)).map(t => t.plate))
      const mDumpAll = dumpTrips.filter(t => t.trip_date?.startsWith(mo))
      const mPmAll = pmTrips.filter(t => t.trip_date?.startsWith(mo))
      const mDump = mDumpAll.reduce((s, t) => s + (t.weight_tons || 0) * (t.rate_per_ton || 0), 0)
      const mPm = mPmAll.reduce((s, t) => s + pmNet(t), 0)
      const mDumpLiveOnly = mDumpAll.filter(t => !histMoPlates.has(t.truck_plate)).reduce((s, t) => s + (t.weight_tons || 0) * (t.rate_per_ton || 0), 0)
      const mPmLiveOnly = mPmAll.filter(t => !histMoPlates.has(t.truck_plate)).reduce((s, t) => s + pmNet(t), 0)
      const mExp = expenses.filter(e => e.expense_date?.startsWith(mo)).reduce((s, e) => s + (e.amount || 0), 0)
      const hMoSales = histMo.reduce((s,h)=>s+(parseFloat(h.sales_dump)||0)+(parseFloat(h.sales_pm)||0),0)
      const extraMo = extraIncomeData.filter(e => e.income_date?.startsWith(mo)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0)
      const hExp = histMo.reduce((s,h)=>s+Object.values(h.expenses||{}).reduce((ss,v)=>ss+(parseFloat(v)||0),0),0)
      const mLive = mDump + mPm > 0
      // Blend: live sales for trucks with no historical row this month, plus historical sales for trucks that have one.
      const sales = (mDumpLiveOnly + mPmLiveOnly + hMoSales) + extraMo
      const mExpFinal = mLive ? mExp : (hExp > 0 ? hExp : mExp)
      return { sales, expenses: mExpFinal, net: sales - mExpFinal, isHistorical: !mLive && hMoSales > 0 }
    })

    return { dumpSales, pmSales, totalSales, totalExp, netIncome: totalSales - totalExp, dumpTripsCount, pmTripsCount, totalCollected, monthly, hasHistorical, hasLive, usingHist: useHist && hasHistorical }
  }

  const dataA = getYearData(String(yearA))
  const dataB = getYearData(String(yearB))

  const pct = (a, b) => {
    if (!a) return b > 0 ? '+100%' : '0%'
    const diff = ((b - a) / a) * 100
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`
  }
  const pctColor = (a, b) => b >= a ? 'var(--success)' : 'var(--danger)'

  const metrics = [
    { label: 'Total Sales', a: dataA.totalSales, b: dataB.totalSales, fmt: v => `PHP ${fmt(v)}` },
    { label: 'Dump Truck Sales', a: dataA.dumpSales, b: dataB.dumpSales, fmt: v => `PHP ${fmt(v)}` },
    { label: 'Prime Mover Sales', a: dataA.pmSales, b: dataB.pmSales, fmt: v => `PHP ${fmt(v)}` },
    { label: 'Total Expenses', a: dataA.totalExp, b: dataB.totalExp, fmt: v => `PHP ${fmt(v)}`, inverse: true },
    { label: 'Net Income', a: dataA.netIncome, b: dataB.netIncome, fmt: v => `PHP ${fmt(v)}` },
    { label: 'Dump Trips', a: dataA.dumpTripsCount, b: dataB.dumpTripsCount, fmt: v => v === null ? '—' : v },
    { label: 'PM Trips', a: dataA.pmTripsCount, b: dataB.pmTripsCount, fmt: v => v === null ? '—' : v },
    { label: 'Total Trips', a: dataA.dumpTripsCount === null ? null : dataA.dumpTripsCount + (dataA.pmTripsCount||0), b: dataB.dumpTripsCount === null ? null : dataB.dumpTripsCount + (dataB.pmTripsCount||0), fmt: v => v === null ? '—' : v },
    { label: 'Collections Received', a: dataA.totalCollected, b: dataB.totalCollected, fmt: v => `PHP ${fmt(v)}` },
  ]

  // ── YEAR-END SUMMARY COMPUTATION ──────────────────────────────────────────
  const getYearEndData = (year) => {
    const y = String(year)
    const f2 = n => Number(Math.round((n||0)*100)/100).toLocaleString('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 })
    const p2 = v => parseFloat(v||0)||0

    // Revenue — invoiced (by invoice_date) vs collected (by date_credited)
    const monthlyRevenue = MONTHS.map((_, mi) => {
      const mo = `${y}-${String(mi+1).padStart(2,'0')}`
      const invoiced_net = invoices.filter(i => i.invoice_date?.startsWith(mo)).reduce((s,i) => s+p2(i.total_sales_net), 0)
      const collected_net = invoices.filter(i => i.status==='Paid' && (i.date_credited||'').startsWith(mo)).reduce((s,i) => s+(p2(i.actual_amount_credited)||p2(i.total_sales_net)*1.10), 0)
      const extras = extraIncomeData.filter(e => e.income_date?.startsWith(mo)).reduce((s,e) => s+p2(e.amount), 0)
      return {
        month: MONTHS[mi],
        invoiced_net: invoiced_net + extras,
        invoiced_vat: (invoiced_net + extras) * 1.12,
        collected_net: collected_net + extras,
        collected_vat: (collected_net + extras) * 1.12,
      }
    })
    const totInvoicedNet = monthlyRevenue.reduce((s,r) => s+r.invoiced_net, 0)
    const totCollectedNet = monthlyRevenue.reduce((s,r) => s+r.collected_net, 0)

    // Expenses
    const yearExp = expenses.filter(e => e.expense_date?.startsWith(y))
    const totalExp = yearExp.reduce((s,e) => s+p2(e.amount), 0)
    const expByCategory = {}
    yearExp.forEach(e => { const k=e.category||'Uncategorized'; expByCategory[k]=(expByCategory[k]||0)+p2(e.amount) })

    // Dump trips
    const dumpYear = dumpTrips.filter(t => t.trip_date?.startsWith(y))
    const dumpCount = dumpYear.length
    const dumpTons = dumpYear.reduce((s,t) => s+p2(t.weight_tons), 0)
    const dumpSales = dumpYear.reduce((s,t) => s+p2(t.weight_tons)*p2(t.rate_per_ton), 0)

    // PM trips — container counts per trip code
    const pmYear = pmTripsDetail.filter(t => t.trip_date?.startsWith(y))
    const pmCount = pmYear.length
    const pmSales = pmYear.reduce((s,t) => s+pmNet(t), 0)
    const pmByCode = {}
    pmYear.forEach(t => {
      const code = t.trip_code || 'Unknown'
      if (!pmByCode[code]) pmByCode[code] = { trips:0, c20:0, c40:0, amount:0 }
      pmByCode[code].trips++
      pmByCode[code].amount += pmNet(t)
      const containers = t.containers || []
      if (t.container_size === '20ft') {
        pmByCode[code].c20 += containers.length > 1 ? containers.length : 1
      } else {
        pmByCode[code].c40 += containers.length > 1 ? containers.length : 1
      }
    })

    // Payroll
    const payYear = payrollEntries.filter(e => e.cutoff_date?.startsWith(y))
    const totalPayroll = payYear.reduce((s,e) => {
      const earnings = p2(e.basic_salary)+p2(e.overtime_pay)+p2(e.rest_day_duty)+p2(e.salary_adjustment)+p2(e.allowance)
      return s + earnings
    }, 0)

    // 13th month (from payroll entries — total basic earned ÷ 12)
    const activeEmps = employees.filter(e => e.is_active !== false)
    const headcount = activeEmps.length

    return { y, monthlyRevenue, totInvoicedNet, totCollectedNet, totalExp, expByCategory, dumpCount, dumpTons, dumpSales, pmCount, pmSales, pmByCode, totalPayroll, headcount, f2 }
  }

  const handleSaveYESpdf = (sigs = []) => {
    const d = getYearEndData(summaryYear)
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const isPort = yesOrientation === 'portrait'
    const doc = new jsPDF({ orientation: yesOrientation, unit:'mm', format:'letter' })
    const W = isPort ? 215.9 : 279.4
    doc.setFontSize(13); doc.setFont('helvetica','bold')
    doc.text(companyName, W/2, 12, { align:'center' })
    doc.setFontSize(10); doc.setFont('helvetica','normal')
    doc.text(`YEAR-END SUMMARY — ${d.y}`, W/2, 18, { align:'center' })
    doc.setDrawColor(200); doc.line(14, 22, W-14, 22)

    // Revenue table
    autoTable(doc, {
      startY: 26, margin:{ left:14, right:14 },
      head: [['Month','Invoiced (Net)','Invoiced (VAT Inc.)','Collected (Net)','Collected (VAT Inc.)']],
      body: [
        ...d.monthlyRevenue.map(r => [r.month, `PHP ${d.f2(r.invoiced_net)}`, `PHP ${d.f2(r.invoiced_vat)}`, `PHP ${d.f2(r.collected_net)}`, `PHP ${d.f2(r.collected_vat)}`]),
        [{ content:'TOTAL', styles:{fontStyle:'bold'} }, `PHP ${d.f2(d.totInvoicedNet)}`, `PHP ${d.f2(d.totInvoicedNet*1.12)}`, `PHP ${d.f2(d.totCollectedNet)}`, `PHP ${d.f2(d.totCollectedNet*1.12)}`],
      ],
      styles:{ fontSize:8, cellPadding:2 },
      headStyles:{ fillColor:[31,41,55], textColor:255, fontStyle:'bold', fontSize:8 },
      alternateRowStyles:{ fillColor:[249,250,251] },
      didParseCell: (data) => { if (data.row.index === d.monthlyRevenue.length) data.cell.styles.fontStyle = 'bold' }
    })

    // Operations + Expenses side by side
    const opsY = doc.lastAutoTable.finalY + 6
    autoTable(doc, {
      startY: opsY, margin:{ left:14, right: W/2+2 },
      head: [['Operations','Value']],
      body: [
        ['Dump Truck Trips', d.dumpCount],
        ['Dump Truck Tons Hauled', `${d.dumpTons.toFixed(3)} t`],
        ['Dump Truck Revenue', `PHP ${d.f2(d.dumpSales)}`],
        ['PM Trips', d.pmCount],
        ['PM Revenue', `PHP ${d.f2(d.pmSales)}`],
        ...Object.entries(d.pmByCode).map(([code,v]) => [`  ${code}`, `${v.trips} trips · 20ft:${v.c20} 40ft:${v.c40}`]),
        ['Active Employees', d.headcount],
        ['Total Payroll Disbursed', `PHP ${d.f2(d.totalPayroll)}`],
      ],
      styles:{ fontSize:8, cellPadding:2 },
      headStyles:{ fillColor:[31,41,55], textColor:255, fontStyle:'bold', fontSize:8 },
      alternateRowStyles:{ fillColor:[249,250,251] },
    })
    autoTable(doc, {
      startY: opsY, margin:{ left: W/2+2, right:14 },
      head: [['Expense Category','Amount']],
      body: [
        ...Object.entries(d.expByCategory).sort((a,b)=>b[1]-a[1]).map(([cat,amt]) => [cat, `PHP ${d.f2(amt)}`]),
        [{ content:'TOTAL EXPENSES', styles:{fontStyle:'bold'} }, `PHP ${d.f2(d.totalExp)}`],
        [{ content:'NET INCOME', styles:{fontStyle:'bold',textColor:[22,163,74]} }, { content:`PHP ${d.f2(d.totInvoicedNet - d.totalExp)}`, styles:{fontStyle:'bold',textColor:[22,163,74]} }],
      ],
      styles:{ fontSize:8, cellPadding:2 },
      headStyles:{ fillColor:[31,41,55], textColor:255, fontStyle:'bold', fontSize:8 },
      alternateRowStyles:{ fillColor:[249,250,251] },
    })

    // Signatures
    if (sigs && sigs.length > 0) {
      const sigY = doc.lastAutoTable.finalY + 12
      const sigColW = (W - 28) / sigs.length
      sigs.forEach((s, i) => {
        const x = 14 + i * sigColW + sigColW / 2
        doc.setFontSize(7); doc.setTextColor(140)
        doc.text(`${s.label}:`, x, sigY, { align:'center' })
        doc.setDrawColor(80); doc.line(x - sigColW*0.35, sigY+14, x + sigColW*0.35, sigY+14)
        doc.setFontSize(8.5); doc.setFont('helvetica','bold'); doc.setTextColor(0)
        doc.text(s.name, x, sigY+18, { align:'center' })
        if (s.title) { doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(255,30,0); doc.text(s.title, x, sigY+22, { align:'center' }) }
        doc.setTextColor(0)
      })
    }
    doc.save(`Year-End-Summary-${d.y}.pdf`)
    showToast('PDF saved.')
  }

  const handleSaveYESexcel = async (sigs = []) => {
    const d = getYearEndData(summaryYear)
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const wb = new ExcelJS.Workbook()
    const thin = { style:'thin', color:{argb:'FFAAAAAA'} }
    const allB = { top:thin, left:thin, bottom:thin, right:thin }
    const hdrFill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1F2937'} }
    const hdrFont = { bold:true, color:{argb:'FFFFFFFF'}, size:9 }

    // Sheet 1: Revenue
    const ws1 = wb.addWorksheet('Revenue')
    ws1.columns = [{width:14},{width:16},{width:18},{width:16},{width:18}]
    ws1.mergeCells('A1:E1'); ws1.getCell('A1').value = companyName
    ws1.getCell('A1').font = {bold:true, size:13}; ws1.getCell('A1').alignment = {horizontal:'center'}
    ws1.mergeCells('A2:E2'); ws1.getCell('A2').value = `YEAR-END SUMMARY — ${d.y} — Revenue`
    ws1.getCell('A2').font = {bold:true, size:11}; ws1.getCell('A2').alignment = {horizontal:'center'}
    const rh = ws1.getRow(4)
    ;['Month','Invoiced (Net)','Invoiced (VAT Inc.)','Collected (Net)','Collected (VAT Inc.)'].forEach((h,i) => {
      const cell = rh.getCell(i+1); cell.value=h; cell.font=hdrFont; cell.fill=hdrFill; cell.border=allB; cell.alignment={horizontal:'center'}
    })
    d.monthlyRevenue.forEach((r,i) => {
      const row = ws1.getRow(5+i)
      const bg = i%2===0?'FFFFFFFF':'FFF9FAFB'
      const fill = { type:'pattern', pattern:'solid', fgColor:{argb:bg} }
      ;[r.month, r.invoiced_net, r.invoiced_vat, r.collected_net, r.collected_vat].forEach((v,ci) => {
        const cell = row.getCell(ci+1); cell.value=v; cell.border=allB; cell.fill=fill
        if (ci>0) cell.numFmt='#,##0.00'
      })
    })
    const tr = ws1.getRow(17)
    ;['TOTAL', d.totInvoicedNet, d.totInvoicedNet*1.12, d.totCollectedNet, d.totCollectedNet*1.12].forEach((v,ci) => {
      const cell = tr.getCell(ci+1); cell.value=v; cell.font={bold:true,size:10}; cell.border=allB
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFEF9C3'}}
      if (ci>0) cell.numFmt='#,##0.00'
    })
    ws1.views = [{showGridLines:false}]

    // Sheet 2: Operations
    const ws2 = wb.addWorksheet('Operations')
    ws2.columns = [{width:28},{width:20}]
    ws2.mergeCells('A1:B1'); ws2.getCell('A1').value = `OPERATIONS — ${d.y}`
    ws2.getCell('A1').font={bold:true,size:12}; ws2.getCell('A1').alignment={horizontal:'center'}
    const opsRows = [
      ['Dump Truck Trips', d.dumpCount],
      ['Dump Truck Tons Hauled', `${d.dumpTons.toFixed(3)} t`],
      ['Dump Truck Revenue', d.dumpSales],
      ['PM Trips', d.pmCount],
      ['PM Revenue', d.pmSales],
      ...Object.entries(d.pmByCode).map(([code,v]) => [`  ${code} — ${v.trips} trips`, `20ft: ${v.c20}  |  40ft: ${v.c40}`]),
      ['Active Employees', d.headcount],
      ['Total Payroll Disbursed', d.totalPayroll],
    ]
    opsRows.forEach((r,i) => {
      const row = ws2.getRow(3+i)
      const bg = i%2===0?'FFFFFFFF':'FFF9FAFB'
      ;[r[0],r[1]].forEach((v,ci) => {
        const cell = row.getCell(ci+1); cell.value=v; cell.border=allB
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:bg}}
        if (typeof v === 'number' && ci===1) cell.numFmt='#,##0.00'
      })
    })
    ws2.views = [{showGridLines:false}]

    // Sheet 3: Expenses
    const ws3 = wb.addWorksheet('Expenses')
    ws3.columns = [{width:28},{width:16}]
    ws3.mergeCells('A1:B1'); ws3.getCell('A1').value = `EXPENSES — ${d.y}`
    ws3.getCell('A1').font={bold:true,size:12}; ws3.getCell('A1').alignment={horizontal:'center'}
    const expRows = Object.entries(d.expByCategory).sort((a,b)=>b[1]-a[1])
    expRows.forEach((r,i) => {
      const row = ws3.getRow(3+i)
      const bg = i%2===0?'FFFFFFFF':'FFF9FAFB'
      ;[r[0],r[1]].forEach((v,ci) => {
        const cell = row.getCell(ci+1); cell.value=v; cell.border=allB
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:bg}}
        if (ci===1) cell.numFmt='#,##0.00'
      })
    })
    const expTot = ws3.getRow(3+expRows.length)
    ;['TOTAL EXPENSES', d.totalExp].forEach((v,ci) => {
      const cell = expTot.getCell(ci+1); cell.value=v; cell.font={bold:true}; cell.border=allB
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFEE2E2'}}
      if (ci===1) cell.numFmt='#,##0.00'
    })
    const netRow = ws3.getRow(4+expRows.length)
    ;['NET INCOME', d.totInvoicedNet - d.totalExp].forEach((v,ci) => {
      const cell = netRow.getCell(ci+1); cell.value=v; cell.font={bold:true,color:{argb:'FF16A34A'}}; cell.border=allB
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDCFCE7'}}
      if (ci===1) cell.numFmt='#,##0.00'
    })
    ws3.views = [{showGridLines:false}]

    // Append signatures to each sheet
    if (sigs && sigs.length > 0) {
      [ws1, ws2, ws3].forEach(ws => {
        const lastRow = ws.lastRow ? ws.lastRow.number + 2 : 20
        const COLS = ws.columnCount || 5
        const sigCols = Math.max(1, Math.floor(COLS / sigs.length))
        const sigRowLabel = lastRow, sigRowGap = lastRow+1, sigRowName = lastRow+2, sigRowTitle = lastRow+3
        sigs.forEach((s, i) => {
          const startCol = i*sigCols + 1
          const endCol = (i === sigs.length-1) ? COLS : startCol + sigCols - 1
          ws.mergeCells(sigRowLabel, startCol, sigRowLabel, endCol)
          const lc = ws.getCell(sigRowLabel, startCol)
          lc.value = `${s.label}:`; lc.font={size:7,color:{argb:'FF888888'}}; lc.alignment={horizontal:'center'}
          ws.mergeCells(sigRowGap, startCol, sigRowGap, endCol)
          ws.getRow(sigRowGap).height = 22
          ws.mergeCells(sigRowName, startCol, sigRowName, endCol)
          const nc = ws.getCell(sigRowName, startCol)
          nc.value=s.name; nc.font={bold:true,size:8.5}; nc.alignment={horizontal:'center'}
          nc.border={top:{style:'thin',color:{argb:'FF333333'}}}
          if (s.title) {
            ws.mergeCells(sigRowTitle, startCol, sigRowTitle, endCol)
            const tc = ws.getCell(sigRowTitle, startCol)
            tc.value=s.title; tc.font={size:7.5,color:{argb:'FFFF1E00'}}; tc.alignment={horizontal:'center'}
          }
        })
        ws.views = [{showGridLines:false}]
      })
    }

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href=url; a.download=`Year-End-Summary-${d.y}.xlsx`; a.click(); URL.revokeObjectURL(url)
    showToast('Excel exported.')
  }


  const handleSavePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
    const W = 279.4
    doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text((settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase(), W / 2, 12, { align: 'center' })
    doc.setFontSize(10); doc.setFont('helvetica', 'normal')
    doc.text(`YEAR-OVER-YEAR COMPARISON — ${yearA} vs ${yearB}`, W / 2, 18, { align: 'center' })
    doc.setDrawColor(200); doc.line(14, 22, W - 14, 22)

    autoTable(doc, {
      startY: 26,
      head: [['Metric', String(yearA), String(yearB), 'Change']],
      body: metrics.map(m => [
        m.label,
        m.fmt(m.a),
        m.fmt(m.b),
        pct(m.a, m.b),
      ]),
      headStyles: { fillColor: [255,30,0], fontSize: 9, fontStyle: 'bold', halign: 'center' },
      bodyStyles: { fontSize: 9, halign: 'right' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
      tableLineColor: [150, 150, 150], tableLineWidth: 0.15,
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3) {
          const val = data.cell.raw
          data.cell.styles.textColor = val.startsWith('+') ? [0, 150, 0] : val.startsWith('-') ? [180, 0, 0] : [0, 0, 0]
        }
      },
    })

    // Monthly comparison
    const y2 = doc.lastAutoTable.finalY + 8
    doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text('MONTHLY SALES COMPARISON', 14, y2)
    autoTable(doc, {
      startY: y2 + 4,
      head: [['Month', `${yearA} Sales`, `${yearA} Net`, `${yearB} Sales`, `${yearB} Net`, 'Sales Change']],
      body: MONTHS.map((m, i) => [
        m,
        `PHP ${fmt(dataA.monthly[i].sales)}`,
        `PHP ${fmt(dataA.monthly[i].net)}`,
        `PHP ${fmt(dataB.monthly[i].sales)}`,
        `PHP ${fmt(dataB.monthly[i].net)}`,
        pct(dataA.monthly[i].sales, dataB.monthly[i].sales),
      ]),
      headStyles: { fillColor: [50, 50, 50], fontSize: 8, fontStyle: 'bold', halign: 'center' },
      bodyStyles: { fontSize: 8, halign: 'right' },
      columnStyles: { 0: { halign: 'left' } },
      tableLineColor: [150, 150, 150], tableLineWidth: 0.15,
      margin: { left: 14, right: 14 },
    })
    doc.save(`YOY-${yearA}-vs-${yearB}.pdf`)
    showToast('Year-over-Year PDF saved.')
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Year-over-Year</h1><p className="page-sub">Fleet performance comparison by year</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
            <select value={yearA} onChange={e => { setYearA(Number(e.target.value)); setModeA('auto') }} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13 }}>
              {[currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <div style={{ display:'flex', gap:4 }}>
              {dataA.hasHistorical && dataA.hasLive && ['auto','live','historical'].map(m => (
                <button key={m} onClick={()=>setModeA(m)} style={{ fontSize:10, padding:'1px 6px', borderRadius:4, border:'1px solid var(--border)', background: modeA===m?'var(--accent)':'var(--surface)', color: modeA===m?'#fff':'var(--muted)', cursor:'pointer' }}>
                  {m==='auto'?'Auto':m==='live'?'Live':'Hist'}
                </button>
              ))}
              {dataA.usingHist && <span style={{ fontSize:10, color:'var(--accent)' }}>📅 Hist</span>}
              {!dataA.usingHist && dataA.hasLive && !dataA.hasHistorical && <span style={{ fontSize:10, color:'var(--success)' }}>🔴 Live</span>}
            </div>
          </div>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>vs</span>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
            <select value={yearB} onChange={e => { setYearB(Number(e.target.value)); setModeB('auto') }} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13 }}>
              {[currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <div style={{ display:'flex', gap:4 }}>
              {dataB.hasHistorical && dataB.hasLive && ['auto','live','historical'].map(m => (
                <button key={m} onClick={()=>setModeB(m)} style={{ fontSize:10, padding:'1px 6px', borderRadius:4, border:'1px solid var(--border)', background: modeB===m?'var(--accent)':'var(--surface)', color: modeB===m?'#fff':'var(--muted)', cursor:'pointer' }}>
                  {m==='auto'?'Auto':m==='live'?'Live':'Hist'}
                </button>
              ))}
              {dataB.usingHist && <span style={{ fontSize:10, color:'var(--accent)' }}>📅 Hist</span>}
              {!dataB.usingHist && dataB.hasLive && !dataB.hasHistorical && <span style={{ fontSize:10, color:'var(--success)' }}>🔴 Live</span>}
            </div>
          </div>
          <button className="btn-ghost" onClick={handleSavePDF}>📄 Save PDF</button>
        </div>
      </div>

      {/* Tab toggle */}
      <div style={{ display:'flex', gap:8, marginBottom:20 }}>
        {[['yoy','📊 Year-over-Year'],['yes','📋 Year-End Summary']].map(([key,label]) => (
          <button key={key} onClick={() => setActiveTab(key)} style={{
            padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500,
            background: activeTab===key?'var(--accent)':'var(--surface)',
            color: activeTab===key?'#fff':'var(--muted)',
            border:`1.5px solid ${activeTab===key?'var(--accent)':'var(--border)'}`,
          }}>{label}</button>
        ))}
      </div>

      {/* ══ YEAR-END SUMMARY TAB ══ */}
      {activeTab === 'yes' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <label className="label" style={{ margin:0 }}>Year</label>
              <select value={summaryYear} onChange={e => setSummaryYear(Number(e.target.value))} style={{ width:'auto' }}>
                {Array.from({length:6}, (_,i) => currentYear-i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {[['landscape','⬛ Landscape'],['portrait','▯ Portrait']].map(([o,label]) => (
                <button key={o} onClick={() => setYesOrientation(o)} style={{
                  padding:'6px 12px', borderRadius:6, fontSize:12, cursor:'pointer',
                  background: yesOrientation===o ? 'var(--text)' : 'var(--surface)',
                  color: yesOrientation===o ? 'var(--surface)' : 'var(--muted)',
                  border:`1px solid ${yesOrientation===o ? 'var(--text)' : 'var(--border)'}`,
                }}>{label}</button>
              ))}
              <button className="btn-ghost" onClick={() => { setSigPendingFormat('pdf'); setSigDialog(true) }}>📄 Save PDF</button>
              <button className="btn-ghost" onClick={() => { setSigPendingFormat('excel'); setSigDialog(true) }}>📊 Excel</button>
            </div>
          </div>

          {loading ? <div className="empty-state"><p>Loading…</p></div> : (() => {
            const d = getYearEndData(summaryYear)
            return (
              <>
                {/* Revenue — Monthly Breakdown */}
                <div className="card" style={{ marginBottom:20 }}>
                  <h2 style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Revenue — Monthly Breakdown</h2>
                  <p style={{ fontSize:12, color:'var(--muted)', marginBottom:12 }}>Invoiced = trips billed that month (invoice date). Collected = payments received that month (date credited).</p>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="text-right">Invoiced (Net)</th>
                          <th className="text-right">Invoiced (VAT Inc.)</th>
                          <th className="text-right">Collected (Net)</th>
                          <th className="text-right">Collected (VAT Inc.)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.monthlyRevenue.map((r,i) => (
                          <tr key={i}>
                            <td style={{ fontWeight:500 }}>{r.month}</td>
                            <td className="text-right mono muted">₱{d.f2(r.invoiced_net)}</td>
                            <td className="text-right mono muted">₱{d.f2(r.invoiced_vat)}</td>
                            <td className="text-right mono" style={{ fontWeight:500 }}>₱{d.f2(r.collected_net)}</td>
                            <td className="text-right mono" style={{ fontWeight:500 }}>₱{d.f2(r.collected_vat)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background:'var(--accent-light)' }}>
                          <td style={{ fontWeight:700 }}>TOTAL</td>
                          <td className="text-right mono" style={{ fontWeight:700 }}>₱{d.f2(d.totInvoicedNet)}</td>
                          <td className="text-right mono" style={{ fontWeight:700 }}>₱{d.f2(d.totInvoicedNet*1.12)}</td>
                          <td className="text-right mono" style={{ fontWeight:700, color:'var(--success)' }}>₱{d.f2(d.totCollectedNet)}</td>
                          <td className="text-right mono" style={{ fontWeight:700, color:'var(--success)' }}>₱{d.f2(d.totCollectedNet*1.12)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
                  {/* Operations */}
                  <div className="card">
                    <h2 style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>Operations</h2>
                    <table className="table">
                      <tbody>
                        <tr><td style={{ fontWeight:500 }}>Dump Truck Trips</td><td className="text-right mono">{d.dumpCount}</td></tr>
                        <tr><td style={{ fontWeight:500 }}>Dump Truck Tons Hauled</td><td className="text-right mono">{d.dumpTons.toFixed(3)} t</td></tr>
                        <tr><td style={{ fontWeight:500 }}>Dump Truck Revenue</td><td className="text-right mono">₱{d.f2(d.dumpSales)}</td></tr>
                        <tr><td style={{ fontWeight:500 }}>PM Trips</td><td className="text-right mono">{d.pmCount}</td></tr>
                        <tr><td style={{ fontWeight:500 }}>PM Revenue</td><td className="text-right mono">₱{d.f2(d.pmSales)}</td></tr>
                        {Object.entries(d.pmByCode).map(([code,v]) => (
                          <tr key={code} style={{ background:'var(--bg)' }}>
                            <td style={{ paddingLeft:20, fontSize:12, color:'var(--muted)' }}>{code}</td>
                            <td className="text-right" style={{ fontSize:12, color:'var(--muted)' }}>{v.trips} trips · <span style={{ color:'var(--accent)' }}>20ft:{v.c20}</span> · <span style={{ color:'var(--text)' }}>40ft:{v.c40}</span></td>
                          </tr>
                        ))}
                        <tr><td style={{ fontWeight:500 }}>Active Employees</td><td className="text-right mono">{d.headcount}</td></tr>
                        <tr><td style={{ fontWeight:500 }}>Total Payroll Disbursed</td><td className="text-right mono">₱{d.f2(d.totalPayroll)}</td></tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Expenses + Net */}
                  <div className="card">
                    <h2 style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>Expenses</h2>
                    <table className="table">
                      <tbody>
                        {Object.entries(d.expByCategory).sort((a,b)=>b[1]-a[1]).map(([cat,amt]) => (
                          <tr key={cat}><td style={{ fontSize:12 }}>{cat}</td><td className="text-right mono" style={{ fontSize:12 }}>₱{d.f2(amt)}</td></tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background:'rgba(220,38,38,0.08)' }}>
                          <td style={{ fontWeight:700 }}>TOTAL EXPENSES</td>
                          <td className="text-right mono" style={{ fontWeight:700, color:'var(--danger)' }}>₱{d.f2(d.totalExp)}</td>
                        </tr>
                        <tr style={{ background:'rgba(22,163,74,0.08)' }}>
                          <td style={{ fontWeight:700 }}>NET INCOME</td>
                          <td className="text-right mono" style={{ fontWeight:700, color:'var(--success)' }}>₱{d.f2(d.totInvoicedNet - d.totalExp)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {activeTab === 'yoy' && loading ? <div className="empty-state"><p>Loading…</p></div> : activeTab === 'yoy' && (<>
        {/* Comparison table */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="text-right">{yearA}</th>
                  <th className="text-right">{yearB}</th>
                  <th className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(m => (
                  <tr key={m.label}>
                    <td style={{ fontWeight: 500 }}>{m.label}</td>
                    <td className="text-right mono" style={{ color: 'var(--muted)' }}>{m.fmt(m.a)}</td>
                    <td className="text-right mono" style={{ fontWeight: 500 }}>{m.fmt(m.b)}</td>
                    <td className="text-right" style={{ fontWeight: 500, color: m.inverse ? pctColor(m.b, m.a) : pctColor(m.a, m.b) }}>
                      {pct(m.a, m.b)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly comparison */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Monthly Sales — {yearA} vs {yearB}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">{yearA} Sales</th>
                  <th className="text-right">{yearA} Net</th>
                  <th className="text-right">{yearB} Sales</th>
                  <th className="text-right">{yearB} Net</th>
                  <th className="text-right">Sales Change</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((m, i) => (
                  <tr key={m}>
                    <td style={{ fontWeight: 500 }}>{m}</td>
                    <td className="text-right mono muted" style={{ fontSize: 12 }}>₱{fmt(dataA.monthly[i].sales)}</td>
                    <td className="text-right mono" style={{ fontSize: 12, color: dataA.monthly[i].net >= 0 ? 'var(--success)' : 'var(--danger)' }}>₱{fmt(dataA.monthly[i].net)}</td>
                    <td className="text-right mono" style={{ fontSize: 12, fontWeight: 500 }}>₱{fmt(dataB.monthly[i].sales)}</td>
                    <td className="text-right mono" style={{ fontSize: 12, fontWeight: 500, color: dataB.monthly[i].net >= 0 ? 'var(--success)' : 'var(--danger)' }}>₱{fmt(dataB.monthly[i].net)}</td>
                    <td className="text-right" style={{ fontWeight: 500, color: pctColor(dataA.monthly[i].sales, dataB.monthly[i].sales) }}>
                      {pct(dataA.monthly[i].sales, dataB.monthly[i].sales)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>)}
      <Toast toast={toast} />
      <SignatoryDialog
        open={sigDialog}
        onClose={() => { setSigDialog(false); setSigPendingFormat(null) }}
        onPrint={(sigs) => {
          setSigDialog(false)
          if (sigPendingFormat === 'pdf') handleSaveYESpdf(sigs)
          else handleSaveYESexcel(sigs)
          setSigPendingFormat(null)
        }}
        settings={settings}
        profile={profile}
        docType="Year-End Summary"
      />
    </div>
  )
}
