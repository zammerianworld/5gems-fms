import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fetchAllRows } from '../lib/supabase'
import { useToast, Toast } from '../components/Toast'
import { useAuth } from '../components/AuthContext'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import SignatoryDialog from '../components/SignatoryDialog'
import autoTable from 'jspdf-autotable'
const REPORT_MODES = ['Management Report', 'Bookkeeper Report', 'Per-Client Profitability']
const PERIOD_TYPES = ['Monthly', 'Quarterly', 'Annual']
const QUARTERS = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const EXPENSE_ORDER = [
  'Fuel — PO', 'Fuel — Cash',
  'Driver Salary', 'Driver Allowance',
  'Amortization',
  'Royalty', 'SOP',
  'Maintenance — Parts', 'Maintenance — Labor',
  'Cargo Insurance', 'Own Damage Insurance',
  'Oil / Lubricants', 'Tire',
  'Toll Fees', 'Parking', 'LTO Registration',
  'Admin Expenses',
  'Others',
]
const pct = (val, total) => total > 0 ? ((val / total) * 100).toFixed(2) + '%' : '0.00%'
const f2 = (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })
const fmtDate = (d) => { if (!d) return ''; return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) }
export default function Reports() {
  const { toast, showToast } = useToast()
  const { profile } = useAuth()
  const [mode, setMode] = useState('Management Report')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [useCustomRange, setUseCustomRange] = useState(false)
  const [periodType, setPeriodType] = useState('Monthly')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [selectedQuarter, setSelectedQuarter] = useState(Math.floor(new Date().getMonth() / 3))
  const [selectedTruck, setSelectedTruck] = useState('all')
  const [truckScope, setTruckScope] = useState('company') // 'company' | 'all'
  const [showComparison, setShowComparison] = useState(false)
  const [sigDialog, setSigDialog] = useState(false)
  const [dataMode, setDataMode] = useState('auto')
  const [historicalData, setHistoricalData] = useState([])
  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [expenses, setExpenses] = useState([])
  const [extraIncomeData, setExtraIncomeData] = useState([])
  const [amortizations, setAmortizations] = useState([])
  const [insurances, setInsurances] = useState([])
  const [invoices, setInvoices] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [tr, drv, dt, pt, exp, am, ins, inv, sett, hist] = await Promise.all([
      supabase.from('trucks').select('*').order('truck_type').order('plate'),
      supabase.from('drivers').select('*'),
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('expenses').select('*').is('deleted_at', null)),
      supabase.from('amortizations').select('*'),
      supabase.from('insurances').select('*'),
      fetchAllRows(() => supabase.from('invoices').select('*').is('deleted_at', null)),
      supabase.from('company_settings').select('*').maybeSingle(),
      fetchAllRows(() => supabase.from('historical_data').select('*')),
    ])
    if (tr.data) setTrucks(tr.data)
    if (drv.data) setDrivers(drv.data)
    if (dt.data) setDumpTrips(dt.data)
    if (hist.data) setHistoricalData(hist.data)
    if (pt.data) setPmTrips(pt.data)
    if (exp.data) setExpenses(exp.data)
    if (am.data) setAmortizations(am.data)
    if (ins.data) setInsurances(ins.data)
    if (inv.data) setInvoices(inv.data)
    if (sett.data) setSettings(sett.data)
    setLoading(false)
  }, [])
  useEffect(() => { fetchAll() }, [fetchAll])
  const getMonths = () => {
    if (periodType === 'Monthly') return [`${selectedYear}-${selectedMonth}`]
    if (periodType === 'Quarterly') {
      const starts = [[1,2,3],[4,5,6],[7,8,9],[10,11,12]][selectedQuarter]
      return starts.map(m => `${selectedYear}-${String(m).padStart(2,'0')}`)
    }
    return Array.from({length:12}, (_,i) => `${selectedYear}-${String(i+1).padStart(2,'0')}`)
  }
  const months = getMonths()
  const inPeriod = (d) => d && months.includes(d.slice(0,7))
  const tripInPeriod = (trip) => {
    if (mode === 'Management Report') return inPeriod(trip.trip_date)
    const inv = invoices.find(i => i.id === trip.invoice_id && i.date_credited && i.status === 'Paid')
    return inv ? inPeriod(inv.date_credited) : false
  }
  const periodLabel = periodType === 'Monthly'
    ? `${MONTHS[parseInt(selectedMonth)-1]} ${selectedYear}`
    : periodType === 'Quarterly' ? `${QUARTERS[selectedQuarter]} ${selectedYear}`
    : `Year ${selectedYear}`
  const years = Array.from({length:5}, (_,i) => new Date().getFullYear()-i)
  const activeTrucks = trucks.filter(t => t.active !== false)
  const dateRangeValid = !useCustomRange || !customStartDate || !customEndDate || customStartDate <= customEndDate
  const ownedTrucks = !dateRangeValid ? [] : activeTrucks.filter(t => t.ownership !== 'subcon' && t.ownership !== 'special_subcon')
  // Admin/shared-expense divisor is a DIFFERENT scope from revenue reporting:
  // special_subcon trucks don't count as "company" for sales/performance, but
  // they DO share in general overhead (rent, utilities, etc.) as a cost of
  // operating under the company. Only true third-party 'subcon' is excluded here.
  const expenseShareTrucks = !dateRangeValid ? [] : activeTrucks.filter(t => t.ownership !== 'subcon')
  const companyTrucks = !dateRangeValid ? [] : (truckScope === 'all' ? activeTrucks : ownedTrucks)
  // ── DATE-AWARE TRUCK COUNT ──────────────────────────────────────────────────
  // Only count trucks active on the expense date (uses start_date / end_date)
  const getActiveTruckCount = (expenseDate) => {
    const d = expenseDate || new Date().toISOString().slice(0, 10)
    const count = expenseShareTrucks.filter(t => {
      const start = t.start_date || '2024-01-01'
      const end = t.end_date || '9999-12-31'
      return d >= start && d <= end
    }).length
    return count || 1
  }
  const getDriver = (truckId) => drivers.find(d => d.truck_id === truckId)
  const getAmortForPeriod = (truckId) =>
    months.reduce((s, ym) => s + amortizations
      .filter(a => a.truck_id === truckId && a.start_date <= ym && (!a.end_date || a.end_date >= ym))
      .reduce((ss, a) => ss + (a.monthly_amount || 0), 0), 0)
  const getAmortDesc = (truckId) => {
    const active = amortizations.filter(a => a.truck_id === truckId && a.start_date <= months[0] && (!a.end_date || a.end_date >= months[months.length-1]))
    return active.map(a => a.description).join(', ') || ''
  }
  const getInsForPeriod = (truckId, insType) =>
    months.reduce((s, ym) => s + insurances
      .filter(ins => {
        if (insType && ins.insurance_type !== insType) return false
        if (!ins.truck_ids?.includes(truckId)) return false
        const start = new Date(ins.start_date)
        const end = new Date(start); end.setMonth(end.getMonth() + 12)
        return new Date(ym+'-01') >= start && new Date(ym+'-01') < end
      })
      .reduce((ss, ins) => ss + (ins.annual_amount||0)/(ins.truck_ids?.length||1)/12, 0), 0)
  const getOpExpenses = (truckId, category) => {
    const relevant = expenses.filter(e => {
      if (e.expense_type !== 'operation') return false
      if (category && e.category !== category) return false
      if (!inPeriod(e.expense_date)) return false
      if (e.scope === 'individual') return e.truck_id === truckId
      return e.scope === 'all'
    })
    const amount = relevant.reduce((s, e) => s + (e.scope === 'all' ? (e.amount||0)/getActiveTruckCount(e.expense_date) : (e.amount||0)), 0)
    const descs = [...new Set(relevant.map(e => e.description).filter(Boolean))].slice(0,2)
    return { amount, desc: descs.join(', ') }
  }
  const getAdminShare = () => {
    const relevant = expenses.filter(e => e.expense_type === 'admin' && inPeriod(e.expense_date))
    // FIX: divide each admin expense by the number of trucks active on that expense's date
    const total = relevant.reduce((s, e) => s + (e.amount||0) / getActiveTruckCount(e.expense_date), 0)
    return { amount: total, desc: `Divided by active trucks per expense date` }
  }
  const liveHasData = dumpTrips.some(t => tripInPeriod(t)) || pmTrips.some(t => tripInPeriod(t))
  const histHasData = historicalData.some(h => {
    const mo = `${h.period_year}-${String(h.period_month).padStart(2,'0')}`
    return inPeriod(mo + '-01')
  })
  const useHist = dataMode === 'historical' || (dataMode === 'auto' && histHasData)
  const getHistTruckData = (truck) => {
    const histRows = historicalData.filter(h => {
      const mo = `${h.period_year}-${String(h.period_month).padStart(2,'0')}`
      return inPeriod(mo + '-01') && h.truck_id === truck.id
    })
    const sales = histRows.reduce((s,h) => s+(parseFloat(h.sales_dump)||0)+(parseFloat(h.sales_pm)||0), 0)
    const exp = histRows.reduce((s,h) => s+Object.values(h.expenses||{}).reduce((ss,v)=>ss+(parseFloat(v)||0),0), 0)
    return { sales, exp, hasData: histRows.length > 0 }
  }
  const getTruckReport = (truck) => {
    const hist = getHistTruckData(truck)
    const useHistForTruck = dataMode === 'historical' || (dataMode === 'auto' && hist.hasData)
    if (useHistForTruck) {
      return {
        byRoute: hist.sales > 0 ? { 'Historical Summary': { trips: '—', sales: hist.sales } } : {},
        totalSales: hist.sales,
        wht2: hist.sales * 0.02,
        expenseLines: hist.exp > 0 ? [{ cat: 'Total Expenses (Historical)', label: 'Total Expenses (Historical)', basis: '', amount: hist.exp, pct: hist.sales > 0 ? hist.exp/hist.sales*100 : 0 }] : [],
        totalExpenses: hist.exp,
        netIncome: hist.sales - hist.exp,
        tripCount: '—',
        driver: drivers.find(d => d.id === truck.driver_id) || null,
        isHistorical: true,
      }
    }
    const truckExtraIncome = extraIncomeData.filter(e => e.truck_id === truck.id && inPeriod(e.income_date))
    const extraIncomeTotal = truckExtraIncome.reduce((s,e) => s+(parseFloat(e.amount)||0), 0)
    const tripsDump = dumpTrips.filter(t => t.truck_plate === truck.plate && tripInPeriod(t))
    const tripsPM = pmTrips.filter(t => t.truck_plate === truck.plate && tripInPeriod(t))
    const byRoute = {}
    tripsDump.forEach(t => {
      const key = t.route || 'Unknown'
      if (!byRoute[key]) byRoute[key] = { trips:0, sales:0 }
      byRoute[key].trips++
      byRoute[key].sales += (t.weight_tons||0)*(t.rate_per_ton||0)
    })
    tripsPM.forEach(t => {
      const key = t.trip_code || 'Unknown'
      if (!byRoute[key]) byRoute[key] = { trips:0, sales:0 }
      byRoute[key].trips++
      const raw = (t.supplier_amount||0)+(t.stripping_fee||0)
      byRoute[key].sales += t.trip_code === 'SMC' ? raw / 1.12 : raw
    })
    const totalSales = Object.values(byRoute).reduce((s,r) => s+r.sales, 0)
    const wht2 = totalSales * 0.02
    const expenseLines = []
    EXPENSE_ORDER.forEach(cat => {
      let amount = 0, desc = '', basis = ''
      if (cat === 'Amortization') {
        amount = getAmortForPeriod(truck.id)
        basis = getAmortDesc(truck.id)
      } else if (cat === 'Cargo Insurance') {
        amount = getInsForPeriod(truck.id, 'Cargo Insurance')
        basis = 'Annual ÷ 12'
      } else if (cat === 'Own Damage Insurance') {
        amount = getInsForPeriod(truck.id, 'Own Damage Insurance')
        basis = 'Annual ÷ 12'
      } else if (cat === 'Admin Expenses') {
        const r = getAdminShare()
        amount = r.amount; basis = r.desc
      } else {
        const r = getOpExpenses(truck.id, cat)
        amount = r.amount; basis = r.desc
      }
      if (amount > 0) {
        const label = cat === 'Admin Expenses' ? `Admin Expenses` : cat
        expenseLines.push({ cat: label, basis, amount })
      }
    })
    const totalExpenses = expenseLines.reduce((s,e) => s+e.amount, 0)
    const netIncome = totalSales - totalExpenses
    const tripCount = tripsDump.length + tripsPM.length
    const driver = getDriver(truck.id)
    return { byRoute, totalSales, wht2, expenseLines, totalExpenses, netIncome, tripCount, driver, isHistorical: false }
  }
  const getSigs = () => mode === 'Management Report'
    ? { prep: settings.mgmt_prepared_by_name, prepTitle: settings.mgmt_prepared_by_title, noted: settings.mgmt_noted_by_name, notedTitle: settings.mgmt_noted_by_title }
    : { prep: settings.bk_prepared_by_name, prepTitle: settings.bk_prepared_by_title, noted: settings.bk_noted_by_name, notedTitle: settings.bk_noted_by_title }
  const reportTrucks = selectedTruck === 'all' ? companyTrucks : companyTrucks.filter(t => t.id === selectedTruck)
  const handleSavePDF = () => { setSigDialog(true) }
  const doSavePDF = (sigs) => {
    setSigDialog(false)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
    let firstPage = true
    const coName = (settings.company_name || 'DRAGON SPEED TRUCKING CORPORATION').toUpperCase()
    reportTrucks.forEach(truck => {
      const r = getTruckReport(truck)
      if (!firstPage) doc.addPage()
      firstPage = false
      doc.setFontSize(11); doc.setFont(undefined, 'bold')
      doc.text(coName, 14, 12)
      doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(0)
      doc.text(`${mode} — ${periodLabel}`, 14, 17)
      doc.setTextColor(0)
      const driver = r.driver
      const truckLabel = `${truck.truck_code || truck.plate} | ${truck.plate}${driver ? ' | ' + driver.driver_name : ''}`
      doc.setFontSize(10); doc.setFont(undefined, 'bold')
      doc.setFillColor(255,30,0); doc.rect(14, 20, 183, 7, 'F')
      doc.setTextColor(255,255,255)
      doc.text(truckLabel.toUpperCase(), 16, 25)
      doc.setTextColor(0); doc.setFont(undefined, 'normal')
      doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.text('SALES', 14, 33); doc.setFont(undefined, 'normal')
      const salesRows = Object.entries(r.byRoute).map(([route, d]) => [route, String(d.trips), f2(d.sales), pct(d.sales, r.totalSales)])
      autoTable(doc, {
        startY: 35,
        head: [['Route / Trip Code', 'No. of Trips', 'Sales (PHP)', '% of Sales']],
        body: salesRows.length ? salesRows : [['No trips in this period','','','']],
        foot: [['Total Sales Net of VAT', String(r.tripCount), f2(r.totalSales), '100.00%'], ['  Withholding Tax (2%)', '', `(${f2(r.wht2)})`, '2.00%'], ['Net Receivable', '', f2(r.totalSales - r.wht2), pct(r.totalSales - r.wht2, r.totalSales)]],
        headStyles: { fillColor: [255,30,0], fontSize: 8, fontStyle: 'bold' },
        footStyles: { fillColor: [245,245,245], fontSize: 8, fontStyle: 'bold', textColor: [0,0,0] },
        tableLineColor: [100,100,100], tableLineWidth: 0.15,
        bodyStyles: { fontSize: 8.5 },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
        margin: { left: 14, right: 14 },
      })
      let y = doc.lastAutoTable.finalY + 5
      doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.text('EXPENSES', 14, y); doc.setFont(undefined, 'normal')
      const expRows = r.expenseLines.map(e => [e.cat, e.basis || '', f2(e.amount), pct(e.amount, r.totalSales)])
      autoTable(doc, {
        startY: y + 2,
        head: [['Category', 'Basis / Note', 'Amount (PHP)', '% of Sales']],
        body: expRows.length ? expRows : [['No expenses in this period','','','']],
        foot: [['Total Expenses', '', f2(r.totalExpenses), pct(r.totalExpenses, r.totalSales)], [`${truck.plate} TOTAL INCOME`, '', (r.netIncome >= 0 ? '' : '-') + f2(Math.abs(r.netIncome)), pct(r.netIncome, r.totalSales)]],
        headStyles: { fillColor: [50,50,50], fontSize: 8, fontStyle: 'bold' },
        tableLineColor: [100,100,100], tableLineWidth: 0.15,
        footStyles: [{ fillColor: [235,235,235], fontStyle: 'bold', fontSize: 8.5 }, { fillColor: r.netIncome >= 0 ? [210,240,225] : [250,215,215], fontStyle: 'bold', fontSize: 10, textColor: r.netIncome >= 0 ? [5,90,50] : [160,0,0] }],
        bodyStyles: { fontSize: 8.5 },
        alternateRowStyles: { fillColor: [250,250,250] },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
        margin: { left: 14, right: 14 },
      })
      if (sigs.prep || sigs.noted) {
        const sigY = doc.lastAutoTable.finalY + 16
        if (sigs.prep) {
          doc.setFontSize(7); doc.setTextColor(80); doc.text('Prepared by:', 14, sigY)
          doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.setTextColor(0)
          doc.text((sigs.prep||'').toUpperCase(), 14, sigY+5)
          doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(60)
          doc.text(sigs.prepTitle||'', 14, sigY+9)
        }
        if (sigs.noted) {
          doc.setFontSize(7); doc.setTextColor(80); doc.text('Noted by:', 130, sigY)
          doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.setTextColor(0)
          doc.text((sigs.noted||'').toUpperCase(), 130, sigY+5)
          doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(60)
          doc.text(sigs.notedTitle||'', 130, sigY+9)
        }
        doc.setTextColor(0)
      }
    })
    if (reportTrucks.length > 1) {
      doc.addPage()
      doc.setFontSize(11); doc.setFont(undefined,'bold')
      doc.text(coName, 14, 12)
      doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(0)
      doc.text(`${mode} — ${periodLabel} — Fleet Summary`, 14, 17); doc.setTextColor(0)
      const summaryRows = reportTrucks.map(truck => {
        const r = getTruckReport(truck)
        const driver = r.driver
        return [truck.plate, driver?.driver_name || '—', String(r.tripCount), f2(r.totalSales), f2(r.totalExpenses), (r.netIncome >= 0 ? '' : '-') + f2(Math.abs(r.netIncome)), pct(r.netIncome, r.totalSales)]
      })
      const totSales = reportTrucks.reduce((s,t) => s+getTruckReport(t).totalSales, 0)
      const totExp = reportTrucks.reduce((s,t) => s+getTruckReport(t).totalExpenses, 0)
      const totNet = reportTrucks.reduce((s,t) => s+getTruckReport(t).netIncome, 0)
      autoTable(doc, {
        startY: 21,
        head: [['Truck', 'Driver', 'Trips', 'Sales (PHP)', 'Expenses (PHP)', 'Net Income (PHP)', '% of Sales']],
        body: summaryRows,
        foot: [['TOTAL','',String(reportTrucks.reduce((s,t)=>s+getTruckReport(t).tripCount,0)), f2(totSales), f2(totExp), (totNet>=0?'':'-')+f2(Math.abs(totNet)), pct(totNet,totSales)]],
        headStyles: { fillColor: [255,30,0], fontSize: 8, fontStyle: 'bold' },
        footStyles: { fillColor: [30,30,30], textColor: [255,255,255], fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5 },
        alternateRowStyles: { fillColor: [250,250,250] },
        columnStyles: { 3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'right'}, 6:{halign:'right'} },
        margin: { left: 14, right: 14 },
      })
      if (sigs && sigs.length > 0) {
        const sigY = doc.lastAutoTable.finalY + 16
        sigs.forEach((s, idx) => {
          const x = idx === 0 ? 14 : idx === sigs.length-1 ? 195 : 105
          const align = idx === 0 ? 'left' : idx === sigs.length-1 ? 'right' : 'center'
          doc.setFontSize(5.5); doc.setFont(undefined,'normal'); doc.setTextColor(120)
          doc.text(s.label + ':', x, sigY, { align })
          doc.setDrawColor(100)
          if (align==='left') doc.line(x, sigY+10, x+70, sigY+10)
          else if (align==='right') doc.line(x-70, sigY+10, x, sigY+10)
          else doc.line(x-35, sigY+10, x+35, sigY+10)
          doc.setFont(undefined,'bold'); doc.setFontSize(7); doc.setTextColor(0)
          doc.text(s.name, x, sigY+14, { align })
          doc.setFont(undefined,'normal'); doc.setFontSize(6); doc.setTextColor(255,30,0)
          doc.text(s.title||'', x, sigY+18, { align })
          doc.setTextColor(0)
        })
      }
    }
    doc.save(`${mode.replace(/ /g,'-')}-${periodLabel.replace(/ /g,'-')}.pdf`)
    showToast('PDF saved.')
  }
  const handleExcel = () => {
    const wb = XLSX.utils.book_new()
    const companyName = (settings.company_name || '[Company Name Not Set]').toUpperCase()
    const styleCell = (ws, addr, bold, bg, color, align) => {
      if (!ws[addr]) return
      ws[addr].s = { font: { bold: !!bold, color: color ? { rgb: color } : undefined }, fill: bg ? { fgColor: { rgb: bg }, patternType: 'solid' } : undefined, alignment: { horizontal: align || 'left', wrapText: true }, border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } }
    }
    reportTrucks.forEach(truck => {
      const r = getTruckReport(truck)
      const driver = r.driver
      const data = [
        [companyName], [`${mode} — ${periodLabel}`], [`${truck.truck_code||truck.plate} | ${truck.plate}${driver?' | '+driver.driver_name:''}`], [],
        ['SALES'], ['Route / Trip Code', 'No. of Trips', 'Sales (PHP)', '% of Sales'],
        ...Object.entries(r.byRoute).map(([route,d]) => [route, d.trips, d.sales, pct(d.sales,r.totalSales)]), [],
        ['Total Sales Net of VAT', r.tripCount, r.totalSales, '100.00%'],
        ['  Withholding Tax (2%)', '', -r.wht2, '2.00%'],
        ['Net Receivable', '', r.totalSales - r.wht2, pct(r.totalSales - r.wht2, r.totalSales)], [],
        ['EXPENSES'], ['Category', 'Basis / Note', 'Amount (PHP)', '% of Sales'],
        ...r.expenseLines.map(e => [e.cat, e.basis||'', e.amount, pct(e.amount, r.totalSales)]), [],
        ['Total Expenses', '', r.totalExpenses, pct(r.totalExpenses, r.totalSales)],
        [`${truck.plate} NET INCOME`, '', r.netIncome, pct(r.netIncome, r.totalSales)],
      ]
      const ws = XLSX.utils.aoa_to_sheet(data)
      ws['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 12 }]
      styleCell(ws, 'A1', true, 'F17200', 'FFFFFF', 'left')
      styleCell(ws, 'A2', false, 'FFF3E0', '333333', 'left')
      styleCell(ws, 'A3', true, null, '333333', 'left')
      const salesRow = 5; ['A','B','C','D'].forEach(c => styleCell(ws, `${c}${salesRow}`, true, '1F2937', 'FFFFFF', c === 'A' ? 'left' : 'right'))
      const colHdrRow = 6; ['A','B','C','D'].forEach(c => styleCell(ws, `${c}${colHdrRow}`, true, 'E5E7EB', '111827', c === 'A' ? 'left' : 'right'))
      Object.entries(r.byRoute).forEach((_, i) => { const row = colHdrRow + 1 + i; ['A','B','C','D'].forEach(c => styleCell(ws, `${c}${row}`, false, i%2===0?'FAFAFA':null, '374151', c==='A'?'left':'right')) })
      const totSalesRow = colHdrRow + Object.keys(r.byRoute).length + 2; ['A','B','C','D'].forEach(c => styleCell(ws, `${c}${totSalesRow}`, true, 'FEF9C3', '374151', c==='A'?'left':'right'))
      const expHdrRow = totSalesRow + 4; ['A','B','C','D'].forEach(c => styleCell(ws, `${c}${expHdrRow}`, true, '1F2937', 'FFFFFF', c==='A'?'left':'right'))
      const lastRow = data.length; ['A','B','C','D'].forEach(c => styleCell(ws, `${c}${lastRow}`, true, r.netIncome >= 0 ? 'DCFCE7' : 'FEE2E2', r.netIncome >= 0 ? '166534' : '991B1B', c==='A'?'left':'right'))
      XLSX.utils.book_append_sheet(wb, ws, truck.plate.replace(/[^a-zA-Z0-9]/g,'-').slice(0,31))
    })
    const summaryData = [
      [companyName], [`${mode} — ${periodLabel} — Fleet Summary`], [],
      ['Truck', 'Driver', 'Trips', 'Total Sales (₱)', 'Total Expenses (₱)', 'Net Income (PHP)', '% of Sales'],
      ...reportTrucks.map(truck => { const r = getTruckReport(truck); return [truck.plate, r.driver?.driver_name||'—', r.tripCount, r.totalSales, r.totalExpenses, r.netIncome, pct(r.netIncome, r.totalSales)] }),
      [],
      ['TOTAL','', reportTrucks.reduce((s,t)=>s+getTruckReport(t).tripCount,0), reportTrucks.reduce((s,t)=>s+getTruckReport(t).totalSales,0), reportTrucks.reduce((s,t)=>s+getTruckReport(t).totalExpenses,0), reportTrucks.reduce((s,t)=>s+getTruckReport(t).netIncome,0), pct(reportTrucks.reduce((s,t)=>s+getTruckReport(t).netIncome,0), reportTrucks.reduce((s,t)=>s+getTruckReport(t).totalSales,0))],
    ]
    const wsSum = XLSX.utils.aoa_to_sheet(summaryData)
    wsSum['!cols'] = [{wch:14},{wch:20},{wch:8},{wch:18},{wch:18},{wch:18},{wch:12}]
    const styleCell2 = (ws, addr, bold, bg, color, align) => { if (!ws[addr]) return; ws[addr].s = { font: { bold: !!bold, color: color ? { rgb: color } : undefined }, fill: bg ? { fgColor: { rgb: bg }, patternType: 'solid' } : undefined, alignment: { horizontal: align || 'left' }, border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } } }
    styleCell2(wsSum, 'A1', true, 'F17200', 'FFFFFF', 'left')
    styleCell2(wsSum, 'A2', false, 'FFF3E0', '333333', 'left')
    ;['A','B','C','D','E','F','G'].forEach(c => styleCell2(wsSum, `${c}4`, true, '1F2937', 'FFFFFF', c==='A'?'left':'right'))
    reportTrucks.forEach((_, i) => { const row = 5 + i; ['A','B','C','D','E','F','G'].forEach(c => styleCell2(wsSum, `${c}${row}`, false, i%2===0?'FAFAFA':null, '374151', c==='A'?'left':'right')) })
    const totRow = 5 + reportTrucks.length + 1; ['A','B','C','D','E','F','G'].forEach(c => styleCell2(wsSum, `${c}${totRow}`, true, 'FEF9C3', '374151', c==='A'?'left':'right'))
    XLSX.utils.book_append_sheet(wb, wsSum, 'Fleet Summary')
    if (wb.SheetNames.length > 1) { const sumIdx = wb.SheetNames.indexOf('Fleet Summary'); wb.SheetNames.splice(sumIdx, 1); wb.SheetNames.unshift('Fleet Summary') }
    const companyNameR = (settings.company_name || 'DRAGON SPEED TRUCKING CORPORATION').toUpperCase()
    const f2r = (n) => Number(n||0).toLocaleString('en-PH', { minimumFractionDigits: 2 })
    let htmlR = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><style>body{font-family:Calibri,Arial;font-size:9pt;}table{border-collapse:collapse;width:100%;page-break-after:always;}th{background:#1F2937;color:#fff;font-weight:bold;font-size:8pt;padding:4px 6px;border:1px solid #999;}td{font-size:8pt;padding:3px 5px;border:1px solid #ddd;}</style></head><body>`
    htmlR += `<table><tr><td colspan="7" style="background:#F17200;color:#fff;font-weight:bold;font-size:12pt;text-align:center;padding:6px">${companyNameR}</td></tr><tr><td colspan="7" style="background:#1F2937;color:#fff;font-weight:bold;font-size:10pt;text-align:center;padding:5px">${mode} — ${periodLabel} — Fleet Summary</td></tr><tr><th>Truck</th><th>Driver</th><th>Trips</th><th>Total Sales (₱)</th><th>Total Expenses (₱)</th><th>Net Income (₱)</th><th>% of Sales</th></tr>`
    reportTrucks.forEach((truck, i) => {
      const r2 = getTruckReport(truck)
      const bg = i%2===0?'#FFFFFF':'#F5F5F5'
      const incomeColor = r2.netIncome >= 0 ? '#166534' : '#991B1B'
      htmlR += `<tr style="background:${bg}"><td style="font-weight:bold">${truck.plate}</td><td>${r2.driver?.driver_name||'—'}</td><td style="text-align:center">${r2.tripCount}</td><td style="text-align:right">${f2r(r2.totalSales)}</td><td style="text-align:right;color:#DC2626">${f2r(r2.totalExpenses)}</td><td style="text-align:right;font-weight:bold;color:${incomeColor}">${f2r(r2.netIncome)}</td><td style="text-align:center">${pct(r2.netIncome,r2.totalSales)}</td></tr>`
    })
    const totSales=reportTrucks.reduce((s,t)=>s+getTruckReport(t).totalSales,0)
    const totExp=reportTrucks.reduce((s,t)=>s+getTruckReport(t).totalExpenses,0)
    const totNet=reportTrucks.reduce((s,t)=>s+getTruckReport(t).netIncome,0)
    htmlR += `<tr style="background:#FEF9C3;font-weight:bold"><td>TOTAL</td><td></td><td style="text-align:center">${reportTrucks.reduce((s,t)=>s+getTruckReport(t).tripCount,0)}</td><td style="text-align:right">${f2r(totSales)}</td><td style="text-align:right;color:#DC2626">${f2r(totExp)}</td><td style="text-align:right;color:${totNet>=0?'#166534':'#991B1B'}">${f2r(totNet)}</td><td style="text-align:center">${pct(totNet,totSales)}</td></tr></table>`
    reportTrucks.forEach(truck => {
      const r2 = getTruckReport(truck)
      htmlR += `<table><tr><td colspan="4" style="background:#F17200;color:#fff;font-weight:bold;font-size:12pt;text-align:center;padding:6px">${companyNameR}</td></tr><tr><td colspan="4" style="background:#FFF3E0;color:#374151;text-align:center;font-size:9pt;padding:3px">${mode} — ${periodLabel}</td></tr><tr><td colspan="4" style="font-weight:bold;font-size:10pt;padding:4px">${truck.truck_code||truck.plate} | ${truck.plate}${r2.driver?' | '+r2.driver.driver_name:''}</td></tr><tr><td colspan="4"></td></tr><tr><td colspan="4" style="background:#1F2937;color:#fff;font-weight:bold;padding:4px">SALES</td></tr><tr><th>Route / Trip Code</th><th>No. of Trips</th><th>Sales (₱)</th><th>% of Sales</th></tr>`
      Object.entries(r2.byRoute).forEach(([route,d],i) => { const bg=i%2===0?'#FFFFFF':'#F5F5F5'; htmlR += `<tr style="background:${bg}"><td>${route}</td><td style="text-align:center">${d.trips}</td><td style="text-align:right">${f2r(d.sales)}</td><td style="text-align:center">${pct(d.sales,r2.totalSales)}</td></tr>` })
      htmlR += `<tr style="background:#FEF9C3;font-weight:bold"><td>Total Sales Net of VAT</td><td style="text-align:center">${r2.tripCount}</td><td style="text-align:right">${f2r(r2.totalSales)}</td><td style="text-align:center">100.00%</td></tr><tr><td>  Withholding Tax (2%)</td><td></td><td style="text-align:right;color:#DC2626">${f2r(-r2.wht2)}</td><td style="text-align:center">2.00%</td></tr><tr><td>Net Receivable</td><td></td><td style="text-align:right">${f2r(r2.totalSales-r2.wht2)}</td><td style="text-align:center">${pct(r2.totalSales-r2.wht2,r2.totalSales)}</td></tr><tr><td colspan="4"></td></tr><tr><td colspan="4" style="background:#1F2937;color:#fff;font-weight:bold;padding:4px">EXPENSES</td></tr><tr><th>Category</th><th>Basis / Note</th><th>Amount (₱)</th><th>% of Sales</th></tr>`
      r2.expenseLines.forEach((e,i) => { const bg=i%2===0?'#FFFFFF':'#F5F5F5'; htmlR += `<tr style="background:${bg}"><td>${e.cat}</td><td>${e.basis||''}</td><td style="text-align:right;color:#DC2626">${f2r(e.amount)}</td><td style="text-align:center">${pct(e.amount,r2.totalSales)}</td></tr>` })
      const netBg = r2.netIncome>=0?'#DCFCE7':'#FEE2E2'; const netColor = r2.netIncome>=0?'#166534':'#991B1B'
      htmlR += `<tr style="background:#F3F4F6;font-weight:bold"><td>Total Expenses</td><td></td><td style="text-align:right;color:#DC2626">${f2r(r2.totalExpenses)}</td><td style="text-align:center">${pct(r2.totalExpenses,r2.totalSales)}</td></tr><tr style="background:${netBg};font-weight:bold"><td>${truck.plate} NET INCOME</td><td></td><td style="text-align:right;color:${netColor}">${f2r(r2.netIncome)}</td><td style="text-align:center;color:${netColor}">${pct(r2.netIncome,r2.totalSales)}</td></tr></table>`
    })
    htmlR += '</body></html>'
    const blobR = new Blob([htmlR], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const urlR = URL.createObjectURL(blobR)
    const aR = document.createElement('a')
    aR.href = urlR; aR.download = `${mode.replace(/ /g,'-')}-${periodLabel.replace(/ /g,'-')}.xls`
    aR.click(); URL.revokeObjectURL(urlR)
    showToast('Excel exported.')
  }
  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Reports</h1><p className="page-sub">Management & bookkeeper reports — per truck and fleet summary</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={handleExcel} disabled={loading || reportTrucks.length === 0}>📊 Export Excel</button>
          <button className="btn-ghost" onClick={handleSavePDF} disabled={loading || reportTrucks.length === 0}>📄 Save PDF</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {REPORT_MODES.map(m => (
          <button key={m} onClick={() => setMode(m)} style={{ padding: '9px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, background: mode === m ? 'var(--accent)' : 'var(--surface)', color: mode === m ? '#fff' : 'var(--muted)', border: `1.5px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}` }}>{m}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Truck scope:</span>
        {[['company', '🚛 Company Trucks Only'], ['all', '🚛🤝 All (incl. Subcon)']].map(([key, label]) => (
          <button key={key} onClick={() => setTruckScope(key)} style={{ padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 500, background: truckScope === key ? 'var(--text)' : 'var(--surface)', color: truckScope === key ? 'var(--surface)' : 'var(--muted)', border: `1.5px solid ${truckScope === key ? 'var(--text)' : 'var(--border)'}` }}>{label}</button>
        ))}
      </div>
      {mode === 'Bookkeeper Report' && (
        <div style={{ padding: '8px 14px', background: 'var(--warning-light)', borderRadius: 8, fontSize: 12, color: 'var(--warning)', marginBottom: 16 }}>
          📋 Uses <strong>date credited to bank</strong> as sales date. Only paid & credited invoices included.
        </div>
      )}
      <div className="card" style={{ marginBottom: 24 }}>
        <p className="section-label" style={{ marginTop: 0 }}>Report Period</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {PERIOD_TYPES.map(p => (
            <button key={p} onClick={() => setPeriodType(p)} style={{ padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, background: periodType === p ? 'var(--text)' : 'var(--surface)', color: periodType === p ? 'var(--surface)' : 'var(--muted)', border: `1.5px solid ${periodType === p ? 'var(--text)' : 'var(--border)'}` }}>{p}</button>
          ))}
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="label">Year</label>
            <select value={selectedYear} onChange={e => { setSelectedYear(Number(e.target.value)); setDataMode('auto') }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {histHasData && liveHasData && (
              <div style={{ display:'flex', gap:4, marginTop:6 }}>
                {['auto','live','historical'].map(m => (
                  <button key={m} onClick={()=>setDataMode(m)} style={{ fontSize:10, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background: dataMode===m?'var(--accent)':'var(--surface)', color: dataMode===m?'#fff':'var(--muted)', cursor:'pointer' }}>
                    {m==='auto'?'Auto':m==='live'?'🔴 Live':'📅 Hist'}
                  </button>
                ))}
              </div>
            )}
            {histHasData && !liveHasData && <div style={{ fontSize:10, color:'var(--accent)', marginTop:4 }}>📅 Using historical data</div>}
          </div>
          {periodType === 'Monthly' && (
            <div className="form-group">
              <label className="label">Month</label>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
                {MONTHS.map((m,i) => <option key={i} value={String(i+1).padStart(2,'0')}>{m}</option>)}
              </select>
            </div>
          )}
          {periodType === 'Quarterly' && (
            <div className="form-group">
              <label className="label">Quarter</label>
              <select value={selectedQuarter} onChange={e => setSelectedQuarter(Number(e.target.value))}>
                {QUARTERS.map((q,i) => <option key={i} value={i}>{q}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="label">Truck</label>
            <select value={selectedTruck} onChange={e => setSelectedTruck(e.target.value)}>
              <option value="all">All Trucks</option>
              {companyTrucks.map(t => <option key={t.id} value={t.id}>{t.plate}{t.truck_code ? ` (${t.truck_code})` : ''}</option>)}
            </select>
          </div>
        </div>
      </div>
      {loading ? <div className="empty-state"><p>Loading…</p></div> : (
        <>
          {reportTrucks.map(truck => {
            const r = getTruckReport(truck)
            return (
              <div key={truck.id} className="card" style={{ marginBottom: 24 }}>
                <div style={{ background: 'var(--accent)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ color: '#fff' }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{truck.truck_code || truck.plate}</span>
                    <span style={{ fontSize: 13, opacity: 0.8, margin: '0 8px' }}>|</span>
                    <span style={{ fontSize: 14, fontFamily: 'var(--mono)', fontWeight: 500 }}>{truck.plate}</span>
                    {r.driver && <><span style={{ fontSize: 13, opacity: 0.8, margin: '0 8px' }}>|</span><span style={{ fontSize: 13 }}>{r.driver.driver_name}</span></>}
                  </div>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{periodLabel}</span>
                </div>
                <p className="section-label" style={{ marginTop: 0 }}>Sales</p>
                <div className="table-wrap" style={{ marginBottom: 14 }}>
                  <table className="table">
                    <thead><tr><th>Route / Trip Code</th><th className="text-right">No. of Trips</th><th className="text-right">Sales Net of VAT (₱)</th><th className="text-right">% of Sales</th></tr></thead>
                    <tbody>
                      {Object.keys(r.byRoute).length === 0
                        ? <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--muted)', padding:16 }}>No trips in this period.</td></tr>
                        : Object.entries(r.byRoute).map(([route, d]) => (
                          <tr key={route}><td>{route}</td><td className="text-right mono">{d.trips}</td><td className="text-right mono">{fmt(d.sales)}</td><td className="text-right mono muted">{pct(d.sales, r.totalSales)}</td></tr>
                        ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background:'var(--bg)' }}><td style={{ fontWeight:500 }}>Total Sales Net of VAT</td><td className="text-right mono" style={{ fontWeight:500 }}>{r.tripCount}</td><td className="text-right mono" style={{ fontWeight:500 }}>₱{fmt(r.totalSales)}</td><td className="text-right mono" style={{ fontWeight:500 }}>100.00%</td></tr>
                      <tr><td style={{ paddingLeft:24, color:'var(--muted)' }}>Withholding Tax (2%)</td><td></td><td className="text-right mono" style={{ color:'var(--danger)' }}>({fmt(r.wht2)})</td><td className="text-right mono muted">2.00%</td></tr>
                      <tr style={{ background:'var(--accent-light)' }}><td style={{ fontWeight:500, color:'var(--accent)' }}>Net Receivable</td><td></td><td className="text-right mono" style={{ fontWeight:500, color:'var(--accent)' }}>₱{fmt(r.totalSales - r.wht2)}</td><td className="text-right mono" style={{ color:'var(--accent)' }}>{pct(r.totalSales - r.wht2, r.totalSales)}</td></tr>
                    </tfoot>
                  </table>
                </div>
                <p className="section-label">Expenses</p>
                <div className="table-wrap" style={{ marginBottom: 14 }}>
                  <table className="table">
                    <thead><tr><th>Category</th><th>Basis / Note</th><th className="text-right">Amount (₱)</th><th className="text-right">% of Sales</th></tr></thead>
                    <tbody>
                      {r.expenseLines.length === 0
                        ? <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--muted)', padding:16 }}>No expenses in this period.</td></tr>
                        : r.expenseLines.map((e, i) => (
                          <tr key={i}><td style={{ paddingLeft:20 }}>{e.cat}</td><td style={{ fontSize:12, color:'var(--muted)' }}>{e.basis}</td><td className="text-right mono">{fmt(e.amount)}</td><td className="text-right mono muted">{pct(e.amount, r.totalSales)}</td></tr>
                        ))}
                    </tbody>
                    <tfoot><tr style={{ background:'var(--bg)' }}><td style={{ fontWeight:500 }} colSpan={2}>Total Expenses</td><td className="text-right mono" style={{ fontWeight:500 }}>₱{fmt(r.totalExpenses)}</td><td className="text-right mono" style={{ fontWeight:500 }}>{pct(r.totalExpenses, r.totalSales)}</td></tr></tfoot>
                  </table>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 16px', borderRadius:8, background: r.netIncome >= 0 ? 'var(--success-light)' : 'var(--danger-light)', border: `1.5px solid ${r.netIncome >= 0 ? '#5DCAA5' : '#e0a09a'}` }}>
                  <span style={{ fontSize:14, fontWeight:500, color: r.netIncome >= 0 ? 'var(--success)' : 'var(--danger)' }}>{truck.plate} TOTAL INCOME</span>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:20, fontWeight:500, fontFamily:'var(--mono)', color: r.netIncome >= 0 ? 'var(--success)' : 'var(--danger)' }}>{r.netIncome < 0 ? '-' : ''}₱{fmt(Math.abs(r.netIncome))}</div>
                    <div style={{ fontSize:12, color:'var(--muted)' }}>{pct(r.netIncome, r.totalSales)} of sales</div>
                  </div>
                </div>
              </div>
            )
          })}
          {reportTrucks.length > 1 && (
            <div className="card">
              <h2 style={{ fontSize:15, fontWeight:500, marginBottom:4 }}>Fleet Summary — {periodLabel}</h2>
              <p style={{ fontSize:13, color:'var(--muted)', marginBottom:14 }}>All trucks</p>
              <div style={{ overflowX:'auto' }}>
                <table className="table">
                  <thead><tr><th>Truck</th><th>Driver</th><th className="text-right">Trips</th><th className="text-right">Sales (₱)</th><th className="text-right">Expenses (₱)</th><th className="text-right">Net Income (₱)</th><th className="text-right">% of Sales</th></tr></thead>
                  <tbody>
                    {companyTrucks.map(truck => {
                      const r = getTruckReport(truck)
                      return (
                        <tr key={truck.id}>
                          <td style={{ fontWeight:500, fontFamily:'var(--mono)' }}>{truck.plate}</td>
                          <td style={{ fontSize:12 }}>{r.driver?.driver_name || '—'}</td>
                          <td className="text-right mono">{r.tripCount}</td>
                          <td className="text-right mono">{fmt(r.totalSales)}</td>
                          <td className="text-right mono">{fmt(r.totalExpenses)}</td>
                          <td className="text-right mono" style={{ fontWeight:500, color: r.netIncome>=0?'var(--success)':'var(--danger)' }}>{r.netIncome<0?'-':''}₱{fmt(Math.abs(r.netIncome))}</td>
                          <td className="text-right mono muted">{pct(r.netIncome, r.totalSales)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={2} style={{ fontWeight:500, borderTop:'2px solid var(--border-md)', padding:'10px 14px' }}>Fleet Total</td>
                    <td className="text-right mono" style={{ fontWeight:500, borderTop:'2px solid var(--border-md)', padding:'10px 14px' }}>{companyTrucks.reduce((s,t)=>s+getTruckReport(t).tripCount,0)}</td>
                    <td className="text-right mono" style={{ fontWeight:500, borderTop:'2px solid var(--border-md)', padding:'10px 14px' }}>₱{fmt(companyTrucks.reduce((s,t)=>s+getTruckReport(t).totalSales,0))}</td>
                    <td className="text-right mono" style={{ fontWeight:500, borderTop:'2px solid var(--border-md)', padding:'10px 14px' }}>₱{fmt(companyTrucks.reduce((s,t)=>s+getTruckReport(t).totalExpenses,0))}</td>
                    <td className="text-right mono" style={{ fontWeight:500, fontSize:14, borderTop:'2px solid var(--border-md)', padding:'10px 14px', color: companyTrucks.reduce((s,t)=>s+getTruckReport(t).netIncome,0)>=0?'var(--success)':'var(--danger)' }}>₱{fmt(companyTrucks.reduce((s,t)=>s+getTruckReport(t).netIncome,0))}</td>
                    <td className="text-right mono muted" style={{ borderTop:'2px solid var(--border-md)', padding:'10px 14px' }}>{pct(companyTrucks.reduce((s,t)=>s+getTruckReport(t).netIncome,0), companyTrucks.reduce((s,t)=>s+getTruckReport(t).totalSales,0))}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {mode === 'Per-Client Profitability' && (() => {
        const allTrips = [...dumpTrips, ...pmTrips].filter(t => inPeriod(t.trip_date))
        const clients = [...new Set(allTrips.map(t => t.client).filter(Boolean))].sort()
        return (
          <div className="card">
            <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Per-Client Profitability</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Client</th><th className="text-right">Dump Sales</th><th className="text-right">PM Sales</th><th className="text-right">Total Sales</th><th className="text-right">% of Total</th><th className="text-right">Trips</th></tr></thead>
                <tbody>
                  {(() => {
                    const pmVal = t => t.trip_code === 'SMC' ? ((t.supplier_amount||0)+(t.stripping_fee||0)) / 1.12 : (t.supplier_amount||0)+(t.stripping_fee||0)
                    const grandTotal = allTrips.reduce((s,t) => s+('trip_code' in t ? pmVal(t) : (t.weight_tons||0)*(t.rate_per_ton||0)), 0)
                    return clients.map(client => {
                      const cDump = dumpTrips.filter(t => t.client === client && inPeriod(t.trip_date))
                      const cPM = pmTrips.filter(t => t.client === client && inPeriod(t.trip_date))
                      const dumpSales = cDump.reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0)
                      const pmSales = cPM.reduce((s,t) => s+pmVal(t), 0)
                      const total = dumpSales + pmSales
                      const p = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : '0.0'
                      return (
                        <tr key={client}>
                          <td style={{ fontWeight: 500 }}>{client}</td>
                          <td className="text-right mono" style={{ fontSize: 12 }}>{dumpSales > 0 ? `₱${fmt(dumpSales)}` : '—'}</td>
                          <td className="text-right mono" style={{ fontSize: 12 }}>{pmSales > 0 ? `₱${fmt(pmSales)}` : '—'}</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(total)}</td>
                          <td className="text-right" style={{ fontSize: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              <div style={{ width: 50, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${p}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} /></div>
                              <span>{p}%</span>
                            </div>
                          </td>
                          <td className="text-right mono" style={{ fontSize: 12 }}>{cDump.length + cPM.length}</td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
                <tfoot><tr>
                  <td style={{ fontWeight: 600, padding: '8px 14px', borderTop: '1px solid var(--border-md)' }}>TOTAL</td>
                  <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', borderTop: '1px solid var(--border-md)' }}>₱{fmt(dumpTrips.filter(t=>inPeriod(t.trip_date)).reduce((s,t)=>s+(t.weight_tons||0)*(t.rate_per_ton||0),0))}</td>
                  <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', borderTop: '1px solid var(--border-md)' }}>₱{fmt(pmTrips.filter(t=>inPeriod(t.trip_date)).reduce((s,t)=>s+(t.trip_code==='SMC'?((t.supplier_amount||0)+(t.stripping_fee||0))/1.12:(t.supplier_amount||0)+(t.stripping_fee||0)),0))}</td>
                  <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', borderTop: '1px solid var(--border-md)' }}>₱{fmt(dumpTrips.filter(t=>inPeriod(t.trip_date)).reduce((s,t)=>s+(t.weight_tons||0)*(t.rate_per_ton||0),0) + pmTrips.filter(t=>inPeriod(t.trip_date)).reduce((s,t)=>s+(t.trip_code==='SMC'?((t.supplier_amount||0)+(t.stripping_fee||0))/1.12:(t.supplier_amount||0)+(t.stripping_fee||0)),0))}</td>
                  <td className="text-right" style={{ fontWeight: 600, padding: '8px 14px', borderTop: '1px solid var(--border-md)' }}>100%</td>
                  <td className="text-right mono" style={{ fontWeight: 600, padding: '8px 14px', borderTop: '1px solid var(--border-md)' }}>{[...dumpTrips,...pmTrips].filter(t=>inPeriod(t.trip_date)).length}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        )
      })()}
      <SignatoryDialog open={sigDialog} onClose={()=>setSigDialog(false)} onPrint={doSavePDF} settings={settings} profile={profile} docType="Report" />
      <Toast toast={toast} />
    </div>
  )
}
