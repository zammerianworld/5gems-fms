import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fetchAllRows } from '../lib/supabase'
import { useToast, Toast } from '../components/Toast'
import { useAuth } from '../components/AuthContext'
import ExcelJS from 'exceljs'

// ── EXPENSE GROUPING ────────────────────────────────────────────────────────
// Maps the system's 18 expense categories into the 8 reporting groups.
// Every category is assigned exactly once, so per-truck totals reconcile
// against the Bookkeeper/Management report.
const EXPENSE_GROUPS = [
  { key: 'salary',      label: 'Salary',      cats: ['Driver Salary'] },
  { key: 'diesel',      label: 'Diesel',      cats: ['Fuel — PO', 'Fuel — Cash'] },
  { key: 'allowance',   label: 'Allowance',   cats: ['Driver Allowance'] },
  { key: 'maintenance', label: 'Maintenance', cats: ['Maintenance — Parts', 'Maintenance — Labor', 'Oil / Lubricants', 'Tire'] },
  { key: 'loans',       label: 'Loans',       cats: ['Amortization'] },
  { key: 'shares',      label: 'Shares',      cats: ['Royalty'] },
  { key: 'sop',         label: 'SOP',         cats: ['SOP'] },
  { key: 'admin',       label: 'Admin',       cats: ['Cargo Insurance', 'Own Damage Insurance', 'Toll Fees', 'Parking', 'LTO Registration', 'Admin Expenses', 'Others'] },
]
const CAT_TO_GROUP = {}
EXPENSE_GROUPS.forEach(g => g.cats.forEach(c => { CAT_TO_GROUP[c] = g.key }))
// These categories are sourced from their own tables (amortizations / insurances)
// or computed as a fleet share (Admin Expenses) — never read from expense rows,
// otherwise they'd be counted twice.
const TABLE_SOURCED = new Set(['Amortization', 'Cargo Insurance', 'Own Damage Insurance', 'Admin Expenses'])

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June']
const MONTH_KEYS = ['01', '02', '03', '04', '05', '06']
const TABS = [
  { key: 'per-truck',  label: '🚛 Per-Truck Sales vs Expenses' },
  { key: 'overall',    label: '📊 Overall Sales vs Expenses' },
  { key: 'soa',        label: '📄 Outstanding SOA' },
  { key: 'loans',      label: '🏦 Remaining Payable Loans' },
  { key: 'monthly-pay',label: '💰 Monthly Payments Received' },
  { key: 'client-pay', label: '🤝 Overall Client Payments' },
]

const pctOf = (val, total) => total > 0 ? ((val / total) * 100).toFixed(2) + '%' : '—'

export default function MidyearReport() {
  const { toast, showToast } = useToast()
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('per-truck')
  const [year, setYear] = useState(2026)
  const [loading, setLoading] = useState(true)

  const [trucks, setTrucks] = useState([])
  const [drivers, setDrivers] = useState([])
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [expenses, setExpenses] = useState([])
  const [invoices, setInvoices] = useState([])
  const [amortizations, setAmortizations] = useState([])
  const [insurances, setInsurances] = useState([])
  const [loans, setLoans] = useState([])
  const [historicalData, setHistoricalData] = useState([])
  const [historicalPayments, setHistoricalPayments] = useState([])
  const [settings, setSettings] = useState({})

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [tr, drv, dt, pt, exp, inv, am, ins, ln, hd, hp, st] = await Promise.all([
      supabase.from('trucks').select('*').order('plate'),
      supabase.from('drivers').select('*'),
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('expenses').select('*').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('invoices').select('*').is('deleted_at', null)),
      supabase.from('amortizations').select('*'),
      supabase.from('insurances').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('historical_data').select('*'),
      supabase.from('historical_payments').select('*'),
      supabase.from('company_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    if (tr.data) setTrucks(tr.data)
    if (drv.data) setDrivers(drv.data)
    if (dt.data) setDumpTrips(dt.data)
    if (pt.data) setPmTrips(pt.data)
    if (exp.data) setExpenses(exp.data)
    if (inv.data) setInvoices(inv.data)
    if (am.data) setAmortizations(am.data)
    if (ins.data) setInsurances(ins.data)
    if (ln.data) setLoans(ln.data)
    if (hd.data) setHistoricalData(hd.data)
    if (hp.data) setHistoricalPayments(hp.data)
    if (st.data) setSettings(st.data)
    setLoading(false)
  }, [])
  useEffect(() => { fetchAll() }, [fetchAll])

  const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()

  // ── SCOPE — company-owned, active trucks only (matches Reports.js) ────────
  const activeTrucks = trucks.filter(t => t.active !== false)
  const ownedTrucks = activeTrucks.filter(t => t.ownership !== 'subcon' && t.ownership !== 'special_subcon')
  const ownedPlates = new Set(ownedTrucks.map(t => t.plate))
  // Admin/shared-expense divisor is a DIFFERENT scope from revenue reporting:
  // special_subcon trucks don't count toward Sales/Per-Truck performance, but
  // they DO share in general overhead (rent, utilities, admin) — only true
  // third-party 'subcon' is excluded from cost-sharing.
  const expenseShareTrucks = activeTrucks.filter(t => t.ownership !== 'subcon')
  const driverFor = (truck) => drivers.find(d => d.id === truck.driver_id)?.full_name || '—'

  // ── SALES — MANAGEMENT BASIS (trip_date), SMC VAT-inclusive adjusted ──────
  const pmNet = (t) => {
    const raw = (parseFloat(t.supplier_amount) || 0) + (parseFloat(t.stripping_fee) || 0)
    return t.trip_code === 'SMC' ? raw / 1.12 : raw
  }
  const dumpNet = (t) => (parseFloat(t.weight_tons) || 0) * (parseFloat(t.rate_per_ton) || 0)
  const inH1 = (d) => d && d.startsWith(String(year)) && MONTH_KEYS.includes(d.slice(5, 7))
  const inMonth = (d, mk) => d && d.startsWith(`${year}-${mk}`)

  // Fleet-wide expenses are split across expense-sharing trucks active on that date
  const activeTruckCountOn = (date) => {
    const d = date || `${year}-01-01`
    const n = expenseShareTrucks.filter(t => {
      const s = t.start_date || '2024-01-01'
      const e = t.end_date || '9999-12-31'
      return d >= s && d <= e
    }).length
    return n || 1
  }

  // ── EXPENSE SOURCING ──────────────────────────────────────────────────────
  // Mirrors Reports.js exactly. Four categories do NOT come from expense rows:
  //   Amortization            → amortizations table
  //   Cargo / Own Damage Ins. → insurances table (annual ÷ 12, split across covered trucks)
  //   Admin Expenses          → expense rows where expense_type='admin', shared across fleet
  // Everything else comes from expense rows where expense_type='operation'.
  // Mixing these sources would double-count, so each is handled once and only once.
  const amortForMonth = (truckId, mk) => {
    const ym = `${year}-${mk}`
    return amortizations
      .filter(a => a.truck_id === truckId && a.start_date <= ym && (!a.end_date || a.end_date >= ym))
      .reduce((s, a) => s + (parseFloat(a.monthly_amount) || 0), 0)
  }
  const insForMonth = (truckId, insType, mk) => {
    const ym = `${year}-${mk}`
    return insurances
      .filter(ins => {
        if (ins.insurance_type !== insType) return false
        if (!ins.truck_ids?.includes(truckId)) return false
        const start = new Date(ins.start_date)
        const end = new Date(start); end.setMonth(end.getMonth() + 12)
        const d = new Date(ym + '-01')
        return d >= start && d < end
      })
      .reduce((s, ins) => s + (parseFloat(ins.annual_amount) || 0) / (ins.truck_ids?.length || 1) / 12, 0)
  }
  const adminShareForMonth = (mk) =>
    expenses
      .filter(e => e.expense_type === 'admin' && inMonth(e.expense_date, mk))
      .reduce((s, e) => s + (parseFloat(e.amount) || 0) / activeTruckCountOn(e.expense_date), 0)

  // ── PER-TRUCK, PER-MONTH ──────────────────────────────────────────────────
  const truckMonth = (truck, mk) => {
    const sales =
      dumpTrips.filter(t => t.truck_plate === truck.plate && inMonth(t.trip_date, mk)).reduce((s, t) => s + dumpNet(t), 0) +
      pmTrips.filter(t => t.truck_plate === truck.plate && inMonth(t.trip_date, mk)).reduce((s, t) => s + pmNet(t), 0)

    const groups = Object.fromEntries(EXPENSE_GROUPS.map(g => [g.key, 0]))

    // Operational expense rows only — admin rows are handled separately below,
    // and the four table-sourced categories are skipped entirely.
    expenses.filter(e => e.expense_type === 'operation' && inMonth(e.expense_date, mk)).forEach(e => {
      if (TABLE_SOURCED.has(e.category)) return
      const gk = CAT_TO_GROUP[e.category]
      if (!gk) return
      const amt = parseFloat(e.amount) || 0
      if (e.scope === 'all') groups[gk] += amt / activeTruckCountOn(e.expense_date)
      else if (e.truck_id === truck.id) groups[gk] += amt
    })

    groups.loans += amortForMonth(truck.id, mk)
    groups.admin += insForMonth(truck.id, 'Cargo Insurance', mk)
    groups.admin += insForMonth(truck.id, 'Own Damage Insurance', mk)
    groups.admin += adminShareForMonth(mk)

    const totalExp = Object.values(groups).reduce((s, v) => s + v, 0)
    const wht = sales * 0.02
    return { sales, wht, netAfterWht: sales - wht, groups, totalExp, net: sales - totalExp }
  }

  const truckH1 = (truck) => {
    const months = MONTH_KEYS.map(mk => truckMonth(truck, mk))
    const groups = Object.fromEntries(EXPENSE_GROUPS.map(g => [g.key, months.reduce((s, m) => s + m.groups[g.key], 0)]))
    const sales = months.reduce((s, m) => s + m.sales, 0)
    const totalExp = months.reduce((s, m) => s + m.totalExp, 0)
    const wht = sales * 0.02
    return { months, sales, wht, netAfterWht: sales - wht, groups, totalExp, net: sales - totalExp }
  }

  const perTruckData = ownedTrucks.map(t => ({ truck: t, ...truckH1(t) }))
  const fleetTotals = {
    sales: perTruckData.reduce((s, r) => s + r.sales, 0),
    wht: perTruckData.reduce((s, r) => s + r.wht, 0),
    totalExp: perTruckData.reduce((s, r) => s + r.totalExp, 0),
    groups: Object.fromEntries(EXPENSE_GROUPS.map(g => [g.key, perTruckData.reduce((s, r) => s + r.groups[g.key], 0)])),
  }
  fleetTotals.netAfterWht = fleetTotals.sales - fleetTotals.wht
  fleetTotals.net = fleetTotals.sales - fleetTotals.totalExp

  // ── OVERALL (monthly rollup across fleet) ─────────────────────────────────
  // Fleet-wide fallback: for months with no live trip data, historical_data
  // rows with truck_id=NULL hold a known fleet total (e.g. from an old
  // bookkeeper report) with no per-truck breakdown. Only used when live
  // sales are ₱0 — real trip data always wins once it exists, so this can
  // never mask or override an actual figure.
  const fleetHistoricalSales = (mk) => {
    const ym = `${year}-${mk}`
    return historicalData
      .filter(h => h.truck_id === null && `${h.period_year}-${h.period_month}` === ym)
      .reduce((s, h) => s + (parseFloat(h.sales_dump) || 0) + (parseFloat(h.sales_pm) || 0), 0)
  }
  const overallByMonth = MONTH_KEYS.map((mk, i) => {
    const rows = ownedTrucks.map(t => truckMonth(t, mk))
    const liveSales = rows.reduce((s, r) => s + r.sales, 0)
    const histSales = liveSales === 0 ? fleetHistoricalSales(mk) : 0
    const sales = liveSales + histSales
    const groups = Object.fromEntries(EXPENSE_GROUPS.map(g => [g.key, rows.reduce((s, r) => s + r.groups[g.key], 0)]))
    const totalExp = rows.reduce((s, r) => s + r.totalExp, 0)
    const wht = sales * 0.02
    return { month: MONTHS[i], sales, wht, netAfterWht: sales - wht, groups, totalExp, net: sales - totalExp, fromHistorical: histSales > 0 }
  })
  // Separate from fleetTotals — that one's built from per-truck sums and has
  // no historical fallback (can't attribute a fleet-wide figure to a truck).
  // The Overall tab's own TOTAL row must sum ITS rows, or it won't reconcile
  // with the historical-backed monthly figures shown above it.
  const overallTotals = overallByMonth.reduce((acc, m) => ({
    sales: acc.sales + m.sales, wht: acc.wht + m.wht, netAfterWht: acc.netAfterWht + m.netAfterWht,
    groups: Object.fromEntries(EXPENSE_GROUPS.map(g => [g.key, acc.groups[g.key] + m.groups[g.key]])),
    totalExp: acc.totalExp + m.totalExp, net: acc.net + m.net,
  }), { sales: 0, wht: 0, netAfterWht: 0, groups: Object.fromEntries(EXPENSE_GROUPS.map(g => [g.key, 0])), totalExp: 0, net: 0 })

  // ── OUTSTANDING SOA (unpaid invoices as of today) ─────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const outstanding = invoices
    .filter(i => i.status !== 'Paid' && i.invoice_date && i.invoice_date <= today)
    .sort((a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || ''))
  const ageDays = (d) => Math.floor((new Date(today) - new Date(d + 'T00:00:00')) / 86400000)
  const soaTotal = outstanding.reduce((s, i) => s + (parseFloat(i.total_sales_net) || 0), 0)

  // ── REMAINING PAYABLE LOANS ───────────────────────────────────────────────
  const loanRemaining = (l) => {
    if (!l.start_date) return { paid: 0, remaining: parseFloat(l.principal) || 0, monthsLeft: l.term_months || 0 }
    const start = new Date(l.start_date + 'T00:00:00')
    const now = new Date()
    const monthsPassed = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()))
    const paid = Math.min(monthsPassed * (parseFloat(l.monthly_payment) || 0), parseFloat(l.principal) || 0)
    const remaining = Math.max((parseFloat(l.principal) || 0) - paid, 0)
    const monthsLeft = l.term_months ? Math.max(l.term_months - monthsPassed, 0) : null
    return { paid, remaining, monthsLeft, monthsPassed }
  }
  const activeLoans = loans.filter(l => l.status === 'active')
  const loanTotals = activeLoans.reduce((acc, l) => {
    const r = loanRemaining(l)
    return { principal: acc.principal + (parseFloat(l.principal) || 0), paid: acc.paid + r.paid, remaining: acc.remaining + r.remaining, monthly: acc.monthly + (parseFloat(l.monthly_payment) || 0) }
  }, { principal: 0, paid: 0, remaining: 0, monthly: 0 })

  // Truck amortizations still running
  const activeAmorts = amortizations.filter(a => {
    const ym = `${year}-06`
    return a.start_date <= ym && (!a.end_date || a.end_date >= ym)
  })
  const amortMonthlyTotal = activeAmorts.reduce((s, a) => s + (parseFloat(a.monthly_amount) || 0), 0)
  const plateFor = (truckId) => trucks.find(t => t.id === truckId)?.plate || '—'
  const monthsRemaining = (a) => {
    if (!a.end_date) return null
    const [ey, em] = a.end_date.split('-').map(Number)
    const now = new Date()
    return Math.max(0, (ey - now.getFullYear()) * 12 + (em - (now.getMonth() + 1)))
  }

  // ── PAYMENTS RECEIVED — CREDITED BASIS (different from tabs 1-4) ──────────
  // Index trips by invoice once — invoiceNetInScope is called ~4x per invoice per
  // month, and a full scan each time turns into millions of redundant ops.
  const tripsByInvoice = {}
  ;[...dumpTrips, ...pmTrips].forEach(t => {
    if (!t.invoice_id) return
    if (!tripsByInvoice[t.invoice_id]) tripsByInvoice[t.invoice_id] = []
    tripsByInvoice[t.invoice_id].push(t)
  })
  const tripsForInvoice = (invId) => tripsByInvoice[invId] || []
  const invoiceClientType = (inv) => {
    const trips = tripsForInvoice(inv.id)
    const pm = trips.find(t => t.trip_code)
    if (pm) return pm.trip_code === 'SMC' ? 'SMC' : 'PSACC'
    return 'Dump'
  }
  const invoiceNetInScope = (inv) => {
    const trips = tripsForInvoice(inv.id).filter(t => ownedPlates.has(t.truck_plate))
    return trips.reduce((s, t) => s + (t.trip_code ? pmNet(t) : dumpNet(t)), 0)
  }
  const paidInv = invoices.filter(i => i.status === 'Paid' && i.date_credited)

  // Audited override: the app's date_credited data for Jan–Mar is confirmed
  // unreliable (real invoices exist and ARE marked Paid, but date_credited
  // grouping undercounts by orders of magnitude — e.g. ₱22K shown vs ₱3.27M
  // audited for January). Where an override exists, replace the total with
  // the audited figure. The source has no SMC/PSACC/Dump split, so rather
  // than show the live (known-wrong) breakdown next to a corrected total,
  // mark the breakdown itself as unavailable for that month.
  const paymentOverride = (mk) => historicalPayments.find(h => h.period_year === String(year) && h.period_month === mk)

  const monthlyPayments = MONTH_KEYS.map((mk, i) => {
    // Only count invoices that actually contribute to the totals — an invoice
    // run entirely on subcon trucks nets ₱0 here, so counting it would make the
    // invoice count disagree with the money shown.
    const rows = paidInv.filter(inv => inMonth(inv.date_credited, mk) && invoiceNetInScope(inv) > 0)
    const smc = rows.filter(i => invoiceClientType(i) === 'SMC').reduce((s, i) => s + invoiceNetInScope(i), 0)
    const psacc = rows.filter(i => invoiceClientType(i) === 'PSACC').reduce((s, i) => s + invoiceNetInScope(i), 0)
    const dump = rows.filter(i => invoiceClientType(i) === 'Dump').reduce((s, i) => s + invoiceNetInScope(i), 0)
    const override = paymentOverride(mk)
    if (override) {
      return { month: MONTHS[i], smc: null, psacc: null, dump: null, total: parseFloat(override.total_amount) || 0, count: null, audited: true }
    }
    return { month: MONTHS[i], smc, psacc, dump, total: smc + psacc + dump, count: rows.length, audited: false }
  })
  const mpTotals = monthlyPayments.reduce((a, r) => ({
    smc: a.smc + (r.smc || 0), psacc: a.psacc + (r.psacc || 0), dump: a.dump + (r.dump || 0), total: a.total + r.total, count: a.count + (r.count || 0),
  }), { smc: 0, psacc: 0, dump: 0, total: 0, count: 0 })

  // ── OVERALL CLIENT PAYMENTS ───────────────────────────────────────────────
  const clientPayments = (() => {
    const byClient = {}
    paidInv.filter(inv => inH1(inv.date_credited)).forEach(inv => {
      const net = invoiceNetInScope(inv)
      if (net <= 0) return   // subcon-only invoice — contributes nothing in company scope
      const k = inv.client || '—'
      if (!byClient[k]) byClient[k] = { client: k, count: 0, net: 0 }
      byClient[k].count++
      byClient[k].net += net
    })
    return Object.values(byClient).sort((a, b) => b.net - a.net)
  })()
  const cpTotal = clientPayments.reduce((s, c) => s + c.net, 0)
  const cpCount = clientPayments.reduce((s, c) => s + c.count, 0)

  // ══ PRINT ═════════════════════════════════════════════════════════════════
  const printTab = () => {
    const el = document.getElementById('report-print-area')
    if (!el) return
    const tabLabel = TABS.find(t => t.key === activeTab)?.label.replace(/^\S+\s/, '') || ''
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html><html><head><title>${tabLabel}</title><style>
      body{font-family:Arial,sans-serif;padding:16px;color:#111}
      h1{text-align:center;font-size:15px;margin:0 0 2px}
      h2{text-align:center;font-size:12px;font-weight:normal;margin:0 0 2px}
      .sub{text-align:center;font-size:10px;color:#666;margin:0 0 14px}
      table{width:100%;border-collapse:collapse;font-size:9px;margin-bottom:14px}
      th{background:#1F2937;color:#fff;padding:5px 6px;border:1px solid #333;font-size:8.5px;text-align:right}
      th:first-child{text-align:left}
      td{padding:4px 6px;border:1px solid #ccc;text-align:right}
      td:first-child{text-align:left}
      tfoot td{font-weight:bold;background:#FEF9C3}
      .ratio{color:#666;font-size:8px}
      h3{font-size:11px;margin:14px 0 6px}
      @media print{@page{size:landscape;margin:8mm}}
    </style></head><body>
      <h1>${companyName}</h1>
      <h2>${tabLabel}</h2>
      <p class="sub">January–June ${year} &nbsp;|&nbsp; Generated ${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}${profile?.full_name ? ' by ' + profile.full_name : ''}</p>
      ${el.innerHTML}
      <script>window.onload=()=>window.print()<\/script>
    </body></html>`)
    win.document.close()
  }

  // ══ EXCEL ═════════════════════════════════════════════════════════════════
  const thin = { style: 'thin', color: { argb: 'FFAAAAAA' } }
  const allB = { top: thin, left: thin, bottom: thin, right: thin }
  const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
  const hdrFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }
  const totFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } }

  const addHeader = (ws, title, cols) => {
    ws.mergeCells(1, 1, 1, cols)
    ws.getCell('A1').value = companyName
    ws.getCell('A1').font = { bold: true, size: 13 }
    ws.getCell('A1').alignment = { horizontal: 'center' }
    ws.mergeCells(2, 1, 2, cols)
    ws.getCell('A2').value = title
    ws.getCell('A2').font = { bold: true, size: 11 }
    ws.getCell('A2').alignment = { horizontal: 'center' }
    ws.mergeCells(3, 1, 3, cols)
    ws.getCell('A3').value = `January–June ${year} | Generated ${new Date().toLocaleDateString('en-PH')}`
    ws.getCell('A3').font = { size: 9, color: { argb: 'FF666666' } }
    ws.getCell('A3').alignment = { horizontal: 'center' }
  }
  const writeRow = (ws, rowIdx, values, opts = {}) => {
    const row = ws.getRow(rowIdx)
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1)
      cell.value = v
      cell.border = allB
      if (opts.header) { cell.font = hdrFont; cell.fill = hdrFill; cell.alignment = { horizontal: i === 0 ? 'left' : 'right', wrapText: true } }
      else {
        if (opts.total) { cell.font = { bold: true }; cell.fill = totFill }
        if (i > 0 && typeof v === 'number') cell.numFmt = '#,##0.00'
      }
    })
    return row
  }

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook()

    if (activeTab === 'per-truck') {
      // ── SUMMARY SHEET — one row per truck, with a "% of Sales" ratio column
      // next to every expense-group amount (matches the in-app table).
      const ws = wb.addWorksheet('Per-Truck')
      const cols = 4 + EXPENSE_GROUPS.length * 2 + 4
      ws.columns = [
        { width: 14 }, { width: 20 }, { width: 15 }, { width: 13 },
        ...EXPENSE_GROUPS.flatMap(() => [{ width: 12 }, { width: 10 }]),
        { width: 14 }, { width: 10 }, { width: 14 }, { width: 10 },
      ]
      addHeader(ws, 'Sales vs Expenses Per Truck', cols)
      const headerRow = ['Truck', 'Driver', 'Sales (Net of VAT)', 'WHT (2%)']
      EXPENSE_GROUPS.forEach(g => headerRow.push(g.label, '% of Sales'))
      headerRow.push('Total Expenses', '% of Sales', 'Net Income', 'Net Margin %')
      writeRow(ws, 5, headerRow, { header: true })
      let r = 6
      perTruckData.forEach(d => {
        const row = [d.truck.plate, driverFor(d.truck), d.sales, d.wht]
        EXPENSE_GROUPS.forEach(g => row.push(d.groups[g.key], pctOf(d.groups[g.key], d.sales)))
        row.push(d.totalExp, pctOf(d.totalExp, d.sales), d.net, pctOf(d.net, d.sales))
        writeRow(ws, r++, row)
      })
      const totalRow = ['FLEET TOTAL', '', fleetTotals.sales, fleetTotals.wht]
      EXPENSE_GROUPS.forEach(g => totalRow.push(fleetTotals.groups[g.key], pctOf(fleetTotals.groups[g.key], fleetTotals.sales)))
      totalRow.push(fleetTotals.totalExp, pctOf(fleetTotals.totalExp, fleetTotals.sales), fleetTotals.net, pctOf(fleetTotals.net, fleetTotals.sales))
      writeRow(ws, r, totalRow, { total: true })
      r += 2
      ws.getCell(`A${r}`).value = 'Cost-to-Sales Ratio (% of fleet sales)'
      ws.getCell(`A${r}`).font = { bold: true }
      r++
      writeRow(ws, r++, ['Expense Group', 'Amount', 'Ratio'], { header: true })
      EXPENSE_GROUPS.forEach(g => {
        writeRow(ws, r++, [g.label, fleetTotals.groups[g.key], pctOf(fleetTotals.groups[g.key], fleetTotals.sales)])
      })
      ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }]

      // ── PER-TRUCK SHEETS — one dedicated monthly breakdown sheet per truck,
      // so each truck can be printed/viewed on its own instead of scanning a
      // wide fleet-wide row.
      const usedNames = new Set(['Per-Truck'])
      perTruckData.forEach(d => {
        const base = (d.truck.plate || 'Truck').replace(/[\\/*?:[\]]/g, '-').slice(0, 28) || 'Truck'
        let name = base, n = 2
        while (usedNames.has(name)) name = `${base.slice(0, 25)} (${n++})`
        usedNames.add(name)
        const tws = wb.addWorksheet(name)
        const tcols = 3 + EXPENSE_GROUPS.length + 2
        tws.columns = [{ width: 12 }, { width: 15 }, { width: 12 }, ...EXPENSE_GROUPS.map(() => ({ width: 12 })), { width: 14 }, { width: 14 }]
        addHeader(tws, `${d.truck.plate} — Monthly Sales vs Expenses (Driver: ${driverFor(d.truck)})`, tcols)
        writeRow(tws, 5, ['Month', 'Sales (Net of VAT)', 'WHT (2%)', ...EXPENSE_GROUPS.map(g => g.label), 'Total Expenses', 'Net Income'], { header: true })
        let tr = 6
        MONTHS.forEach((mLabel, mi) => {
          const m = d.months[mi]
          writeRow(tws, tr++, [mLabel, m.sales, m.wht, ...EXPENSE_GROUPS.map(g => m.groups[g.key]), m.totalExp, m.net])
        })
        writeRow(tws, tr, ['TOTAL (Jan–Jun)', d.sales, d.wht, ...EXPENSE_GROUPS.map(g => d.groups[g.key]), d.totalExp, d.net], { total: true })
        tr += 2
        tws.getCell(`A${tr}`).value = "Cost-to-Sales Ratio (% of this truck's sales)"
        tws.getCell(`A${tr}`).font = { bold: true }
        tr++
        writeRow(tws, tr++, ['Expense Group', 'Amount', 'Ratio'], { header: true })
        EXPENSE_GROUPS.forEach(g => {
          writeRow(tws, tr++, [g.label, d.groups[g.key], pctOf(d.groups[g.key], d.sales)])
        })
        writeRow(tws, tr++, ['Net Income', d.net, pctOf(d.net, d.sales)], { total: true })
        tws.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }]
      })
    }

    if (activeTab === 'overall') {
      const ws = wb.addWorksheet('Overall')
      const cols = 4 + EXPENSE_GROUPS.length + 2
      ws.columns = [{ width: 14 }, { width: 16 }, { width: 13 }, { width: 14 }, ...EXPENSE_GROUPS.map(() => ({ width: 13 })), { width: 14 }, { width: 14 }]
      addHeader(ws, 'Overall Sales vs Expenses', cols)
      writeRow(ws, 5, ['Month', 'Sales (Net of VAT)', 'WHT (2%)', 'Net After WHT', ...EXPENSE_GROUPS.map(g => g.label), 'Total Expenses', 'Net Income'], { header: true })
      let r = 6
      overallByMonth.forEach(m => {
        writeRow(ws, r++, [m.month, m.sales, m.wht, m.netAfterWht, ...EXPENSE_GROUPS.map(g => m.groups[g.key]), m.totalExp, m.net])
      })
      writeRow(ws, r, ['TOTAL', overallTotals.sales, overallTotals.wht, overallTotals.netAfterWht, ...EXPENSE_GROUPS.map(g => overallTotals.groups[g.key]), overallTotals.totalExp, overallTotals.net], { total: true })
      ws.views = [{ showGridLines: false }]
    }

    if (activeTab === 'soa') {
      const ws = wb.addWorksheet('Outstanding SOA')
      ws.columns = [{ width: 14 }, { width: 13 }, { width: 24 }, { width: 12 }, { width: 10 }, { width: 16 }]
      addHeader(ws, `Outstanding Statement of Account (as of ${today})`, 6)
      writeRow(ws, 5, ['Invoice No.', 'Date', 'Client', 'Status', 'Age (days)', 'Amount (Net)'], { header: true })
      let r = 6
      outstanding.forEach(i => {
        writeRow(ws, r++, [i.invoice_no, i.invoice_date, i.client, i.status, ageDays(i.invoice_date), parseFloat(i.total_sales_net) || 0])
      })
      writeRow(ws, r, ['TOTAL OUTSTANDING', '', '', '', outstanding.length, soaTotal], { total: true })
      ws.views = [{ showGridLines: false }]
    }

    if (activeTab === 'loans') {
      const ws = wb.addWorksheet('Loans')
      ws.columns = [{ width: 22 }, { width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }]
      addHeader(ws, 'Remaining Payable Loans', 7)
      ws.getCell('A5').value = 'Bank / Institution Loans'
      ws.getCell('A5').font = { bold: true, size: 11 }
      writeRow(ws, 6, ['Lender', 'Description', 'Principal', 'Monthly', 'Est. Paid', 'Remaining', 'Months Left'], { header: true })
      let r = 7
      activeLoans.forEach(l => {
        const x = loanRemaining(l)
        writeRow(ws, r++, [l.lender, l.description || '', parseFloat(l.principal) || 0, parseFloat(l.monthly_payment) || 0, x.paid, x.remaining, x.monthsLeft ?? '—'])
      })
      writeRow(ws, r, ['TOTAL', '', loanTotals.principal, loanTotals.monthly, loanTotals.paid, loanTotals.remaining, ''], { total: true })
      r += 3
      ws.getCell(`A${r}`).value = 'Truck Amortizations (still running)'
      ws.getCell(`A${r}`).font = { bold: true, size: 11 }
      r++
      writeRow(ws, r++, ['Truck', 'Description', 'Monthly Amount', 'Start', 'End', 'Months Left', ''], { header: true })
      activeAmorts.forEach(a => {
        writeRow(ws, r++, [plateFor(a.truck_id), a.description, parseFloat(a.monthly_amount) || 0, a.start_date, a.end_date || 'ongoing', monthsRemaining(a) ?? '—', ''])
      })
      writeRow(ws, r, ['TOTAL MONTHLY', '', amortMonthlyTotal, '', '', '', ''], { total: true })
      ws.views = [{ showGridLines: false }]
    }

    if (activeTab === 'monthly-pay') {
      const ws = wb.addWorksheet('Monthly Payments')
      ws.columns = [{ width: 14 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 10 }]
      addHeader(ws, 'Monthly Payments Received (by Date Credited)', 6)
      writeRow(ws, 5, ['Month', 'SMC', 'PSACC', 'Dump Truck', 'Total', 'Invoices'], { header: true })
      let r = 6
      monthlyPayments.forEach(m => writeRow(ws, r++, [
        m.audited ? `${m.month} (audited total — see notes)` : m.month,
        m.audited ? 'n/a' : m.smc,
        m.audited ? 'n/a' : m.psacc,
        m.audited ? 'n/a' : m.dump,
        m.total,
        m.audited ? 'n/a' : m.count,
      ]))
      writeRow(ws, r, ['TOTAL', mpTotals.smc, mpTotals.psacc, mpTotals.dump, mpTotals.total, mpTotals.count], { total: true })
      ws.views = [{ showGridLines: false }]
    }

    if (activeTab === 'client-pay') {
      const ws = wb.addWorksheet('Client Payments')
      ws.columns = [{ width: 30 }, { width: 12 }, { width: 18 }, { width: 12 }]
      addHeader(ws, 'Overall Client Payments (by Date Credited)', 4)
      writeRow(ws, 5, ['Client', 'Invoices', 'Amount Paid (Net)', '% of Total'], { header: true })
      let r = 6
      clientPayments.forEach(c => writeRow(ws, r++, [c.client, c.count, c.net, pctOf(c.net, cpTotal)]))
      writeRow(ws, r, ['TOTAL', cpCount, cpTotal, '100.00%'], { total: true })
      ws.views = [{ showGridLines: false }]
    }

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Midyear-${activeTab}-${year}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    showToast('Excel exported.')
  }

  const hasHistoricalOverallSales = overallByMonth.some(m => m.fromHistorical)
  const basisNote = ['monthly-pay', 'client-pay'].includes(activeTab)
    ? { text: '💰 Credited basis — counted when payment was received (date credited to bank).', color: 'var(--accent)' }
    : activeTab === 'overall' && hasHistoricalOverallSales
    ? { text: '📅 Management basis — sales counted on trip date, EXCEPT months using the bookkeeper-report fallback (marked below), which are credited basis. The two aren\'t directly comparable within this tab.', color: 'var(--warning)' }
    : { text: '📅 Management basis — sales counted on trip date, not when paid. Will not tie to the Bookkeeper Report or the payment tabs.', color: 'var(--warning)' }

  return (
    <div className="page page-wide">
      <div className="page-header">
        <div>
          <h1 className="page-title">Midyear Report</h1>
          <p className="page-sub">January–June {year} · consolidated management report</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500,
            background: activeTab === t.key ? 'var(--accent)' : 'var(--surface)',
            color: activeTab === t.key ? '#fff' : 'var(--muted)',
            border: `1.5px solid ${activeTab === t.key ? 'var(--accent)' : 'var(--border)'}`,
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 'auto' }}>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={printTab}>🖨️ Print</button>
          <button className="btn-ghost" onClick={exportExcel}>📊 Excel</button>
        </div>
      </div>

      <div style={{ padding: '7px 12px', background: 'var(--surface)', border: `1px solid ${basisNote.color}`, borderRadius: 7, fontSize: 11.5, color: basisNote.color, marginBottom: 14 }}>
        {basisNote.text}
      </div>

      {loading ? <div className="empty-state"><p>Loading…</p></div> : (
        <div id="report-print-area">

          {/* ── 1. PER-TRUCK ─────────────────────────────────────────────── */}
          {activeTab === 'per-truck' && (
            <>
              <div className="card">
                <div className="table-wrap no-scroll">
                  <table className="table table-dense">
                    <colgroup>
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '8.5%' }} />
                      <col style={{ width: '6%' }} />
                      {EXPENSE_GROUPS.map(g => <col key={g.key} style={{ width: `${52.5 / EXPENSE_GROUPS.length}%` }} />)}
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '8%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Truck</th><th>Driver</th>
                        <th className="text-right">Sales<br/>(Net of VAT)</th>
                        <th className="text-right">WHT<br/>(2%)</th>
                        {EXPENSE_GROUPS.map(g => <th key={g.key} className="text-right">{g.label}</th>)}
                        <th className="text-right">Total<br/>Exp.</th>
                        <th className="text-right">Net<br/>Income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perTruckData.map(d => (
                        <tr key={d.truck.id}>
                          <td style={{ fontWeight: 600 }}>{d.truck.plate}</td>
                          <td>{driverFor(d.truck)}</td>
                          <td className="text-right mono">₱{fmt(d.sales)}</td>
                          <td className="text-right mono muted">₱{fmt(d.wht)}</td>
                          {EXPENSE_GROUPS.map(g => (
                            <td key={g.key} className="text-right mono">
                              ₱{fmt(d.groups[g.key])}
                              <div style={{ fontSize: 9, color: 'var(--muted)' }}>{pctOf(d.groups[g.key], d.sales)}</div>
                            </td>
                          ))}
                          <td className="text-right mono" style={{ fontWeight: 600 }}>₱{fmt(d.totalExp)}</td>
                          <td className="text-right mono" style={{ fontWeight: 700, color: d.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>₱{fmt(d.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--accent-light)' }}>
                        <td style={{ fontWeight: 700 }}>FLEET TOTAL</td><td></td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(fleetTotals.sales)}</td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(fleetTotals.wht)}</td>
                        {EXPENSE_GROUPS.map(g => (
                          <td key={g.key} className="text-right mono" style={{ fontWeight: 700 }}>
                            ₱{fmt(fleetTotals.groups[g.key])}
                            <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted)' }}>{pctOf(fleetTotals.groups[g.key], fleetTotals.sales)}</div>
                          </td>
                        ))}
                        <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(fleetTotals.totalExp)}</td>
                        <td className="text-right mono" style={{ fontWeight: 700, color: fleetTotals.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>₱{fmt(fleetTotals.net)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="card" style={{ marginTop: 14 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Cost-to-Sales Ratio — Fleet (Jan–Jun {year})</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Expense Group</th><th className="text-right">Amount</th><th className="text-right">% of Sales</th></tr></thead>
                    <tbody>
                      {EXPENSE_GROUPS.map(g => (
                        <tr key={g.key}>
                          <td>{g.label}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{g.cats.join(', ')}</div></td>
                          <td className="text-right mono">₱{fmt(fleetTotals.groups[g.key])}</td>
                          <td className="text-right mono">{pctOf(fleetTotals.groups[g.key], fleetTotals.sales)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--accent-light)' }}>
                        <td style={{ fontWeight: 700 }}>TOTAL EXPENSES</td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(fleetTotals.totalExp)}</td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>{pctOf(fleetTotals.totalExp, fleetTotals.sales)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── 2. OVERALL ───────────────────────────────────────────────── */}
          {activeTab === 'overall' && (
            <div className="card">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="text-right">Sales (Net of VAT)</th>
                      <th className="text-right">WHT (2%)</th>
                      <th className="text-right">Net After WHT</th>
                      {EXPENSE_GROUPS.map(g => <th key={g.key} className="text-right">{g.label}</th>)}
                      <th className="text-right">Total Exp.</th>
                      <th className="text-right">Net Income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overallByMonth.map(m => (m.sales > 0 || m.totalExp > 0) ? (
                      <tr key={m.month}>
                        <td style={{ fontWeight: 600 }}>
                          {m.month}
                          {m.fromHistorical && <div style={{ fontSize: 9.5, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)' }}>Sales = amount credited (from bookkeeper report) — not trip-date basis like Apr–Jun</div>}
                        </td>
                        <td className="text-right mono">₱{fmt(m.sales)}</td>
                        <td className="text-right mono muted">₱{fmt(m.wht)}</td>
                        <td className="text-right mono">₱{fmt(m.netAfterWht)}</td>
                        {EXPENSE_GROUPS.map(g => (
                          <td key={g.key} className="text-right mono" style={{ fontSize: 12 }}>
                            ₱{fmt(m.groups[g.key])}
                            <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{pctOf(m.groups[g.key], m.sales)}</div>
                          </td>
                        ))}
                        <td className="text-right mono" style={{ fontWeight: 600 }}>₱{fmt(m.totalExp)}</td>
                        <td className="text-right mono" style={{ fontWeight: 700, color: m.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>₱{fmt(m.net)}</td>
                      </tr>
                    ) : (
                      <tr key={m.month} style={{ opacity: 0.55 }}>
                        <td style={{ fontWeight: 600 }}>{m.month}</td>
                        <td colSpan={EXPENSE_GROUPS.length + 5} style={{ fontStyle: 'italic', color: 'var(--muted)', fontSize: 12 }}>
                          No data available for this month
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--accent-light)' }}>
                      <td style={{ fontWeight: 700 }}>TOTAL</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(overallTotals.sales)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(overallTotals.wht)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(overallTotals.netAfterWht)}</td>
                      {EXPENSE_GROUPS.map(g => (
                        <td key={g.key} className="text-right mono" style={{ fontWeight: 700, fontSize: 12 }}>
                          ₱{fmt(overallTotals.groups[g.key])}
                          <div style={{ fontSize: 9.5, fontWeight: 400, color: 'var(--muted)' }}>{pctOf(overallTotals.groups[g.key], overallTotals.sales)}</div>
                        </td>
                      ))}
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(overallTotals.totalExp)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700, color: overallTotals.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>₱{fmt(overallTotals.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── 3. OUTSTANDING SOA ───────────────────────────────────────── */}
          {activeTab === 'soa' && (
            <div className="card">
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Outstanding Invoices — as of {new Date(today).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</h3>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>Unpaid invoices across all clients, oldest first. Includes subcon-serviced invoices — the receivable is owed to the company regardless of which truck ran the trip.</p>
              {outstanding.length === 0 ? <div className="empty-state"><p>No outstanding invoices.</p></div> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Invoice No.</th><th>Date</th><th>Client</th><th>Status</th><th className="text-right">Age</th><th className="text-right">Amount (Net)</th></tr></thead>
                    <tbody>
                      {outstanding.map(i => {
                        const age = ageDays(i.invoice_date)
                        const col = age > 90 ? 'var(--danger)' : age > 60 ? '#d97706' : age > 30 ? '#b45309' : 'var(--muted)'
                        return (
                          <tr key={i.id}>
                            <td style={{ fontWeight: 600 }}>{i.invoice_no}</td>
                            <td className="mono" style={{ fontSize: 12 }}>{i.invoice_date}</td>
                            <td>{i.client}</td>
                            <td><span className="badge badge-warning" style={{ fontSize: 10 }}>{i.status}</span></td>
                            <td className="text-right mono" style={{ color: col, fontWeight: age > 60 ? 600 : 400 }}>{age}d</td>
                            <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(i.total_sales_net)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--accent-light)' }}>
                        <td colSpan={4} style={{ fontWeight: 700 }}>TOTAL OUTSTANDING ({outstanding.length} invoice{outstanding.length !== 1 ? 's' : ''})</td>
                        <td></td>
                        <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--danger)' }}>₱{fmt(soaTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── 4. LOANS ─────────────────────────────────────────────────── */}
          {activeTab === 'loans' && (
            <>
              <div className="card">
                <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Bank / Institution Loans</h3>
                <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
                  Active loans owed by the company. Est. Paid is derived from months elapsed × monthly payment — not from actual payment records.
                </p>
                {activeLoans.length === 0 ? <div className="empty-state"><p>No active loans.</p></div> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Lender</th><th>Description</th><th className="text-right">Principal</th><th className="text-right">Monthly</th><th className="text-right">Est. Paid</th><th className="text-right">Remaining</th><th className="text-right">Months Left</th></tr></thead>
                      <tbody>
                        {activeLoans.map(l => {
                          const x = loanRemaining(l)
                          return (
                            <tr key={l.id}>
                              <td style={{ fontWeight: 600 }}>{l.lender}</td>
                              <td style={{ fontSize: 12 }}>{l.description || '—'}</td>
                              <td className="text-right mono">₱{fmt(l.principal)}</td>
                              <td className="text-right mono">₱{fmt(l.monthly_payment)}</td>
                              <td className="text-right mono muted">₱{fmt(x.paid)}</td>
                              <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--danger)' }}>₱{fmt(x.remaining)}</td>
                              <td className="text-right mono">{x.monthsLeft ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--accent-light)' }}>
                          <td colSpan={2} style={{ fontWeight: 700 }}>TOTAL</td>
                          <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(loanTotals.principal)}</td>
                          <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(loanTotals.monthly)}</td>
                          <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(loanTotals.paid)}</td>
                          <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--danger)' }}>₱{fmt(loanTotals.remaining)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              <div className="card" style={{ marginTop: 14 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Truck Amortizations (still running)</h3>
                <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>Per-truck monthly amortizations active as of June {year}.</p>
                {activeAmorts.length === 0 ? <div className="empty-state"><p>No active amortizations.</p></div> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Truck</th><th>Description</th><th className="text-right">Monthly Amount</th><th>Start</th><th>End</th><th className="text-right">Months Left</th></tr></thead>
                      <tbody>
                        {activeAmorts.map(a => (
                          <tr key={a.id}>
                            <td style={{ fontWeight: 600 }}>{plateFor(a.truck_id)}</td>
                            <td style={{ fontSize: 12 }}>{a.description}</td>
                            <td className="text-right mono">₱{fmt(a.monthly_amount)}</td>
                            <td className="mono" style={{ fontSize: 12 }}>{a.start_date}</td>
                            <td className="mono" style={{ fontSize: 12 }}>{a.end_date || <span style={{ color: 'var(--muted)' }}>ongoing</span>}</td>
                            <td className="text-right mono">{monthsRemaining(a) ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--accent-light)' }}>
                          <td colSpan={2} style={{ fontWeight: 700 }}>TOTAL MONTHLY</td>
                          <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(amortMonthlyTotal)}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── 5. MONTHLY PAYMENTS ──────────────────────────────────────── */}
          {activeTab === 'monthly-pay' && (
            <div className="card">
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Payments Received — Jan–Jun {year}</h3>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>Grouped by the month payment was credited. Company trucks only; SMC amounts are net of VAT.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Month</th><th className="text-right">SMC</th><th className="text-right">PSACC</th><th className="text-right">Dump Truck</th><th className="text-right">Total</th><th className="text-right">Invoices</th></tr></thead>
                  <tbody>
                    {monthlyPayments.map(m => (
                      <tr key={m.month} style={m.audited ? { background: 'rgba(37,99,235,0.04)' } : undefined}>
                        <td style={{ fontWeight: 600 }}>
                          {m.month}
                          {m.audited && <div style={{ fontSize: 9.5, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)' }}>Audited total (bookkeeper report) — app's credited-date data unreliable for this month</div>}
                          {!m.audited && m.count === 0 && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}> (none)</span>}
                        </td>
                        <td className="text-right mono">{m.audited ? <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 11.5 }}>n/a</span> : `₱${fmt(m.smc)}`}</td>
                        <td className="text-right mono">{m.audited ? <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 11.5 }}>n/a</span> : `₱${fmt(m.psacc)}`}</td>
                        <td className="text-right mono">{m.audited ? <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 11.5 }}>n/a</span> : `₱${fmt(m.dump)}`}</td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(m.total)}</td>
                        <td className="text-right mono muted">{m.audited ? '—' : m.count}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--accent-light)' }}>
                      <td style={{ fontWeight: 700 }}>TOTAL</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(mpTotals.smc)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(mpTotals.psacc)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>₱{fmt(mpTotals.dump)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--success)' }}>₱{fmt(mpTotals.total)}</td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>{mpTotals.count}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── 6. CLIENT PAYMENTS ───────────────────────────────────────── */}
          {activeTab === 'client-pay' && (
            <div className="card">
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Client Payments — Jan–Jun {year}</h3>
              <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>Total collected per client, by date credited. Company trucks only.</p>
              <div style={{ padding: '7px 12px', background: 'rgba(217,119,6,0.06)', border: '1px solid var(--warning)', borderRadius: 7, fontSize: 11.5, color: '#b45309', marginBottom: 12 }}>
                ⚠️ The app's credited-date data for Jan–Mar {year} is confirmed unreliable (real invoices exist and are marked Paid, but the date recorded as "credited" doesn't match when payment actually arrived). Per-client figures for those months are likely understated. No per-client audited figure is available to correct this the way the Monthly Payments tab's totals were — this caveat is the best available warning, not a fix.
              </div>
              {clientPayments.length === 0 ? <div className="empty-state"><p>No payments recorded.</p></div> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Client</th><th className="text-right">Invoices</th><th className="text-right">Amount Paid (Net)</th><th className="text-right">% of Total</th></tr></thead>
                    <tbody>
                      {clientPayments.map(c => (
                        <tr key={c.client}>
                          <td style={{ fontWeight: 600 }}>{c.client}</td>
                          <td className="text-right mono muted">{c.count}</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(c.net)}</td>
                          <td className="text-right mono">{pctOf(c.net, cpTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--accent-light)' }}>
                        <td style={{ fontWeight: 700 }}>TOTAL</td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>{cpCount}</td>
                        <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--success)' }}>₱{fmt(cpTotal)}</td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>100.00%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      )}
      <Toast toast={toast} />
    </div>
  )
}
