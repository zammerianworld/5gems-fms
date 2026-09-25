import { useState, useEffect, useCallback } from 'react'
import DatePickerSingle from './DatePickerSingle'
import DatePickerRange from './DatePickerRange'
import SignatoryDialog from './SignatoryDialog'
import ConfirmDialog from './ConfirmDialog'
import { supabase, fmt, fmtDate, logAudit, getAllPmCodes } from '../lib/supabase'
import { buildPayslipDoc } from '../lib/payslipTemplate'
import * as XLSX from 'xlsx'

const p = (v) => parseFloat(v) || 0

const PRINT_STYLE = `
  #driver-payroll-print-area { display: none; }
  @media print {
    body * { visibility: hidden !important; }
    #driver-payroll-print-area { display: block !important; }
    #driver-payroll-print-area, #driver-payroll-print-area * { visibility: visible !important; }
    #driver-payroll-print-area { position: fixed; left: 0; top: 0; width: 100%; }
    #driver-payroll-print-area table { font-size: 13px !important; }
    #driver-payroll-print-area th, #driver-payroll-print-area td { font-size: 13px !important; }
    @page { size: letter landscape; margin: 8mm 8mm; }
  }
`

const EMPTY_DRIVER = {
  driver_name: '', truck_id: '', sss_no: '', philhealth_no: '', hdmf_no: '',
  hire_date: '', termination_date: '', pay_type: 'fixed', percentage_rate: '', notes: '', active: true,
  classification: 'company', employee_no: '', is_reliever: false,
}
const EMPTY_RATE = { driver_id: '', truck_type: 'Dump Truck', route: '', trip_code: '', pay_type: 'fixed', rate_per_trip: '', percentage_rate: '', notes: '', isGeneral: false, container_size: '', van_status: '', destination: '' }
// These 3 PM trip codes price by container size + destination terminal
// (Hustling PSACC also varies by loaded/empty status) rather than a single
// flat rate — structured dropdowns instead of one free-text field, so
// matching is exact value comparison, never fragile text parsing.
const STRUCTURED_PM_CODES = ['Hustling PSACC', 'Hauling PSACC', 'SMC']
const EMPTY_LOAN = { driver_id: '', loan_type: 'sss', principal: '', amortization_per_cutoff: '', balance: '', date_issued: '', description: '' }

const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayStr = () => toYMD(new Date())
const monthStartStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
// Monday-Sunday week, computed from local calendar date getters only —
// never through toISOString(), which converts to UTC and would roll the
// date back a day during PH's early morning hours (PH is UTC+8).
const thisWeekRange = () => {
  const now = new Date()
  const day = now.getDay() // 0=Sun...6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return { start: toYMD(monday), end: toYMD(sunday) }
}
const lastWeekRange = () => {
  const { start } = thisWeekRange()
  const [y, m, d] = start.split('-').map(Number)
  const prevMonday = new Date(y, m - 1, d - 7)
  const prevSunday = new Date(y, m - 1, d - 1)
  return { start: toYMD(prevMonday), end: toYMD(prevSunday) }
}

// Looks up the employee-share deduction for a given monthly gross against a bracket table.
// SSS/HDMF store a flat peso employee_share; PhilHealth/HDMF store a rate — handled per table shape.
const lookupFlatBracket = (brackets, monthlyGross) => {
  const match = brackets.find(b => monthlyGross >= b.min_salary && (b.max_salary == null || monthlyGross <= b.max_salary))
  return match ? p(match.employee_share) : 0
}
const lookupRateBracket = (brackets, monthlyGross, capField) => {
  const match = brackets.find(b => monthlyGross >= b.min_salary && (b.max_salary == null || monthlyGross <= b.max_salary))
  if (!match) return 0
  let amt = monthlyGross * p(match.employee_rate)
  if (capField && match[capField] != null) amt = Math.min(amt, p(match[capField]))
  return amt
}

const TH = { padding: '8px 10px', fontSize: 11, fontWeight: 700, textAlign: 'center', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em' }
const TD = { padding: '8px 10px', fontSize: 13, textAlign: 'center' }
const INPUT = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }
const ActionBtn = (color) => ({ padding: '5px 9px', border: `1px solid ${color}33`, borderRadius: 5, background: `${color}11`, color, cursor: 'pointer', fontSize: 12 })

function FormRow({ label, children }) {
  return <div><label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--muted)' }}>{label}</label>{children}</div>
}
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, width: '100%', maxWidth: wide ? 700 : 460, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export default function DriversPayroll({ isAdmin, isSuperuser, profile, showToast, settings }) {
  const [subTab, setSubTab] = useState('payroll') // 'payroll' | 'roster' | 'rates' | 'loans' | 'brackets'
  const [drivers, setDrivers] = useState([])
  const [trucks, setTrucks] = useState([])
  const [rates, setRates] = useState([])
  const [loans, setLoans] = useState([])
  const [caRecords, setCaRecords] = useState([])
  const [sssBrackets, setSssBrackets] = useState([])
  const [philBrackets, setPhilBrackets] = useState([])
  const [hdmfBrackets, setHdmfBrackets] = useState([])
  const [entries, setEntries] = useState([]) // driver_payroll_entries for the selected cutoff
  const [loading, setLoading] = useState(true)
  const [periodStart, setPeriodStart] = useState(monthStartStr)
  const [periodEnd, setPeriodEnd] = useState(todayStr)
  const selectedCutoff = periodEnd // the DB's cutoff_date/unique-key column — always the end of the picked range
  const [saving, setSaving] = useState(false)
  const [sigDialog, setSigDialog] = useState(false)
  const [activeSigs, setActiveSigs] = useState([])
  const [confirmState, setConfirmState] = useState(null)
  const [includedOverrides, setIncludedOverrides] = useState(new Set()) // subcon driver IDs explicitly included for this session — not persisted, resets on reload
  const [driverSort, setDriverSort] = useState('name') // 'name' | 'hire_date' | 'employee_no'
  const [pendingPrintFn, setPendingPrintFn] = useState(null)
  const [pastPeriods, setPastPeriods] = useState([]) // distinct {period_start, period_end} pairs that already have entries
  const [allHistory, setAllHistory] = useState([]) // every driver_payroll_entries row ever, across all drivers/periods

  const [showDriverForm, setShowDriverForm] = useState(false)
  const [editingDriverId, setEditingDriverId] = useState(null)
  const [driverForm, setDriverForm] = useState(EMPTY_DRIVER)

  const [showRateForm, setShowRateForm] = useState(false)
  const [editingRateId, setEditingRateId] = useState(null)
  const [rateForm, setRateForm] = useState(EMPTY_RATE)

  const [showLoanForm, setShowLoanForm] = useState(false)
  const [editingLoanId, setEditingLoanId] = useState(null)
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN)

  const [computeModal, setComputeModal] = useState(null) // driver being computed for this cutoff

  // ── TRIP PAYROLL TAB ──
  const [tripLogSearch, setTripLogSearch] = useState('')
  const [tripLogDriver, setTripLogDriver] = useState('')
  const [tripLogStatus, setTripLogStatus] = useState('')
  const [tripLogFrom, setTripLogFrom] = useState('')
  const [tripLogTo, setTripLogTo] = useState('')
  const [tripLogShowNoDriver, setTripLogShowNoDriver] = useState(false)
  const [tripLogSelected, setTripLogSelected] = useState([]) // [{id, _type}] — only 'unpaid' rows are ever selectable
  // Clicking a Paid/Pending status needs to switch the Payroll Register to
  // that entry's own cutoff, then open it — but setPeriodStart/setPeriodEnd
  // are async (React state), and the code that opens an entry closes over
  // `selectedCutoff`, which is derived from that same state. Calling both
  // in the same tick would use the OLD cutoff — this holds the intent
  // until a render has actually landed with the new period, confirmed by
  // watching selectedCutoff itself change to match, not just assumed.
  const [pendingNav, setPendingNav] = useState(null) // { driverId, cutoff }
  const [computeDraft, setComputeDraft] = useState(null) // the editable computed entry before saving

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [dr, tr, rt, ln, ca, sb, pb, hb, en] = await Promise.all([
      supabase.from('drivers').select('*').order('driver_name'),
      supabase.from('trucks').select('id,plate,truck_type,ownership').order('plate'),
      supabase.from('driver_rates').select('*'),
      supabase.from('driver_loans').select('*').order('date_issued', { ascending: false }),
      supabase.from('payroll_cash_advances').select('*').not('driver_id', 'is', null),
      supabase.from('sss_brackets').select('*').order('min_salary'),
      supabase.from('philhealth_brackets').select('*').order('min_salary'),
      supabase.from('hdmf_brackets').select('*').order('min_salary'),
      supabase.from('driver_payroll_entries').select('*').eq('cutoff_date', selectedCutoff),
    ])
    setDrivers(dr.data || [])
    setTrucks(tr.data || [])
    setRates(rt.data || [])
    setLoans(ln.data || [])
    setCaRecords(ca.data || [])
    setSssBrackets(sb.data || [])
    setPhilBrackets(pb.data || [])
    setHdmfBrackets(hb.data || [])
    setEntries(en.data || [])
    setLoading(false)
    return { drivers: dr.data || [], rates: rt.data || [], loans: ln.data || [], entries: en.data || [] }
  }, [selectedCutoff])

  useEffect(() => { fetchAll() }, [fetchAll])

  const fetchPastPeriods = useCallback(async () => {
    const { data } = await supabase.from('driver_payroll_entries').select('period_start, period_end').order('period_end', { ascending: false })
    const seen = new Set()
    const unique = []
    ;(data || []).forEach(r => {
      const key = `${r.period_start}_${r.period_end}`
      if (!seen.has(key)) { seen.add(key); unique.push(r) }
    })
    setPastPeriods(unique.slice(0, 24)) // most recent 24 distinct periods is plenty for a quick-select list
  }, [])
  useEffect(() => { fetchPastPeriods() }, [fetchPastPeriods])

  const fetchAllHistory = useCallback(async () => {
    const { data } = await supabase.from('driver_payroll_entries').select('*').order('cutoff_date', { ascending: false })
    setAllHistory(data || [])
  }, [])
  useEffect(() => { fetchAllHistory() }, [fetchAllHistory])

  // ── DRIVER ROSTER ─────────────────────────────────────────────────────
  const saveDriver = async () => {
    if (!driverForm.driver_name.trim()) { showToast('Driver name is required.', 'error'); return }
    setSaving(true)
    const payload = {
      driver_name: driverForm.driver_name.trim(),
      truck_id: driverForm.truck_id || null,
      sss_no: driverForm.sss_no, philhealth_no: driverForm.philhealth_no, hdmf_no: driverForm.hdmf_no,
      hire_date: driverForm.hire_date || null,
      termination_date: driverForm.termination_date || null,
      pay_type: driverForm.pay_type,
      percentage_rate: p(driverForm.percentage_rate),
      notes: driverForm.notes, active: driverForm.active,
      classification: driverForm.classification || 'company',
      employee_no: driverForm.employee_no || null,
      is_reliever: !!driverForm.is_reliever,
    }
    const { error } = editingDriverId
      ? await supabase.from('drivers').update(payload).eq('id', editingDriverId)
      : await supabase.from('drivers').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      showToast(editingDriverId ? 'Driver updated.' : 'Driver added.')
      setShowDriverForm(false); setEditingDriverId(null); setDriverForm(EMPTY_DRIVER)
      fetchAll()
    }
    setSaving(false)
  }

  // ── RATE CONFIG ───────────────────────────────────────────────────────
  const saveRate = async () => {
    if (rateForm.pay_type === 'percentage' ? !p(rateForm.percentage_rate) : !p(rateForm.rate_per_trip)) {
      showToast(rateForm.pay_type === 'percentage' ? 'Percentage is required.' : 'Rate per trip is required.', 'error'); return
    }
    setSaving(true)
    const { isGeneral, ...rateFormForDb } = rateForm
    const payload = {
      ...rateFormForDb, driver_id: rateFormForDb.driver_id || null,
      rate_per_trip: p(rateForm.rate_per_trip), percentage_rate: p(rateForm.percentage_rate),
      container_size: rateForm.container_size || null,
      van_status: rateForm.van_status || null,
      destination: rateForm.destination || null,
    }
    const { error } = editingRateId
      ? await supabase.from('driver_rates').update(payload).eq('id', editingRateId)
      : await supabase.from('driver_rates').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Rate saved.'); setShowRateForm(false); setEditingRateId(null); setRateForm(EMPTY_RATE); fetchAll() }
    setSaving(false)
  }
  const deleteRate = (id) => {
    setConfirmState({
      title: 'Delete Rate', variant: 'danger', confirmLabel: 'Delete',
      message: 'Delete this rate? This can\'t be undone.',
      onConfirm: async () => {
        await supabase.from('driver_rates').delete().eq('id', id)
        fetchAll()
      },
    })
  }

  // ── LOANS ─────────────────────────────────────────────────────────────
  const saveLoan = async () => {
    if (!loanForm.driver_id || !p(loanForm.principal)) { showToast('Driver and principal amount are required.', 'error'); return }
    setSaving(true)
    const payload = {
      ...loanForm, principal: p(loanForm.principal),
      amortization_per_cutoff: p(loanForm.amortization_per_cutoff),
      balance: editingLoanId ? p(loanForm.balance) : p(loanForm.principal),
      date_issued: loanForm.date_issued || new Date().toISOString().slice(0, 10),
    }
    const { error } = editingLoanId
      ? await supabase.from('driver_loans').update(payload).eq('id', editingLoanId)
      : await supabase.from('driver_loans').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Loan saved.'); setShowLoanForm(false); setEditingLoanId(null); setLoanForm(EMPTY_LOAN); fetchAll() }
    setSaving(false)
  }

  // ── PAYROLL REGISTER — the actual trip-sweep + computation engine ─────
  // Sweeps every trip for this driver that hasn't yet been attached to ANY
  // driver_payroll_entries.trip_breakdown, regardless of the trip's own
  // date — this is what lets a late-encoded trip from a prior period land
  // in whichever cutoff is currently open, instead of getting lost or
  // requiring a closed period to be reopened.
  const [allDumpTrips, setAllDumpTrips] = useState([])
  const [allPmTrips, setAllPmTrips] = useState([])
  const fetchTrips = useCallback(async () => {
    const [dt, pt] = await Promise.all([
      supabase.from('trips_dump').select('id,trip_date,truck_plate,route,weight_tons,rate_per_ton,driver_id,supplier_doc_ref').is('deleted_at', null).not('driver_id', 'is', null),
      supabase.from('trips_pm').select('id,trip_date,truck_plate,trip_code,supplier_amount,stripping_fee,driver_id,smcsl_waybill_no,waybill_no,supplier_doc,container_size,containers,destination').is('deleted_at', null).not('driver_id', 'is', null),
    ])
    const dumpTrips = dt.data || [], pmTrips = pt.data || []
    setAllDumpTrips(dumpTrips)
    setAllPmTrips(pmTrips)
    return { dumpTrips, pmTrips }
  }, [])
  useEffect(() => { fetchTrips() }, [fetchTrips])

  // Trip Payroll needs every trip regardless of whether it has a driver —
  // fetchTrips above deliberately excludes driverless trips (they're not
  // relevant to the actual payroll sweep), but Trip Payroll's whole point
  // is surfacing exactly those as "No Driver" so they don't go unnoticed.
  const [tripLogDump, setTripLogDump] = useState([])
  const [tripLogPm, setTripLogPm] = useState([])
  const fetchTripLog = useCallback(async () => {
    const [dt, pt] = await Promise.all([
      supabase.from('trips_dump').select('id,trip_date,truck_plate,route,weight_tons,rate_per_ton,driver_id,payroll_settled_external').is('deleted_at', null),
      supabase.from('trips_pm').select('id,trip_date,truck_plate,trip_code,supplier_amount,stripping_fee,driver_id,payroll_settled_external').is('deleted_at', null),
    ])
    setTripLogDump(dt.data || [])
    setTripLogPm(pt.data || [])
  }, [])
  useEffect(() => { if (subTab === 'triplog') fetchTripLog() }, [subTab, fetchTripLog])

  const alreadySweptTripIds = useCallback(() => {
    // Every trip_id that appears in ANY driver_payroll_entries.trip_breakdown,
    // regardless of cutoff — a trip is swept exactly once, ever.
    const ids = new Set()
    entries.forEach(e => (e.trip_breakdown || []).forEach(t => ids.add(t.trip_id)))
    return ids
  }, [entries])

  const [allEntriesEverTripIds, setAllEntriesEverTripIds] = useState(new Set())
  // Richer than allEntriesEverTripIds above — maps each swept trip to which
  // entry it landed in and whether that entry is locked, so Trip Payroll
  // can show Paid vs Pending (not just "swept or not") and jump straight
  // to the right entry.
  const [tripEntryMap, setTripEntryMap] = useState({}) // { [trip_id]: { entryId, driverId, cutoffDate, locked } }
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('driver_payroll_entries').select('id,driver_id,cutoff_date,locked,trip_breakdown')
      const ids = new Set()
      const map = {}
      ;(data || []).forEach(e => (e.trip_breakdown || []).forEach(t => {
        // An unchecked trip (included: false) was never actually claimed by
        // this entry — it must stay eligible for another driver's payroll,
        // not get wrongly locked out here forever.
        if (t.included === false) return
        ids.add(t.trip_id)
        map[t.trip_id] = { entryId: e.id, driverId: e.driver_id, cutoffDate: e.cutoff_date, locked: e.locked }
      }))
      setAllEntriesEverTripIds(ids)
      setTripEntryMap(map)
    })()
  }, [entries])

  const pendingTripsFor = (driverId, dumpTripsOverride, pmTripsOverride) => {
    const dumpSource = dumpTripsOverride || allDumpTrips
    const pmSource = pmTripsOverride || allPmTrips
    const swept = allEntriesEverTripIds
    const dRate = rates.filter(r => r.driver_id === driverId)
    const fleetRate = rates.filter(r => !r.driver_id)
    const driver = drivers.find(d => d.id === driverId)
    // Priority, most specific first: this driver's rate for this exact
    // route/trip code -> this driver's own general/catch-all rate ->
    // a fleet-wide rate for this exact route/trip code (shared across every
    // driver, e.g. "Hustling DVO" paying the same regardless of who drives
    // it) -> a fleet-wide general/catch-all rate -> finally the driver's own
    // roster-level default pay_type/percentage_rate if nothing above matched
    // at all.
    const matchRate = (truckType, matcher) => {
      const dForType = dRate.filter(r => r.truck_type === truckType)
      const fForType = fleetRate.filter(r => r.truck_type === truckType)
      const isGeneralRow = r => !r.route && !r.trip_code
      return dForType.find(matcher)
        || dForType.find(isGeneralRow)
        || fForType.find(matcher)
        || fForType.find(isGeneralRow)
    }
    const resolve = (rateMatch, grossBasis) => {
      const payType = rateMatch?.pay_type || driver?.pay_type
      const pct = rateMatch ? p(rateMatch.percentage_rate) : p(driver?.percentage_rate)
      return payType === 'percentage' ? grossBasis * (pct / 100) : p(rateMatch?.rate_per_trip)
    }
    const dump = dumpSource.filter(t => t.driver_id === driverId && !swept.has(t.id)).map(t => {
      const rateMatch = matchRate('Dump Truck', r => r.route === t.route)
      const grossBasis = (t.weight_tons || 0) * (t.rate_per_ton || 0)
      const amount = resolve(rateMatch, grossBasis)
      return { trip_id: t.id, trip_type: 'dump', trip_date: t.trip_date, label: t.route || t.truck_plate, docRef: t.supplier_doc_ref || '', amount, included: true, grossBasis, truckPlate: t.truck_plate, route: t.route || '' }
    })
    const pm = pmSource.filter(t => t.driver_id === driverId && !swept.has(t.id)).map(t => {
      const isStructured = STRUCTURED_PM_CODES.includes(t.trip_code)
      const pendingDestination = isStructured && !t.destination
      const grossBasis = (t.supplier_amount || 0) + (t.stripping_fee || 0)
      let rateMatch, amount
      if (pendingDestination) {
        // No sensible fallback exists for a trip with no destination set yet —
        // computing something from the driver's generic default would look
        // like a valid rate when it isn't. Force ₱0 and flag it clearly
        // instead, so it's obvious this needs the destination set, not a bug.
        rateMatch = null
        amount = 0
      } else if (isStructured) {
        rateMatch = matchRate('Prime Mover', r =>
          r.trip_code === t.trip_code &&
          r.container_size === t.container_size &&
          r.destination === t.destination &&
          (t.trip_code !== 'Hustling PSACC' || r.van_status === (t.containers?.[0]?.van_status || 'Full'))
        )
        amount = resolve(rateMatch, grossBasis)
      } else {
        rateMatch = matchRate('Prime Mover', r => r.trip_code === t.trip_code)
        amount = resolve(rateMatch, grossBasis)
      }
      return { trip_id: t.id, trip_type: 'pm', trip_date: t.trip_date, label: t.trip_code || t.truck_plate, docRef: t.smcsl_waybill_no || t.waybill_no || t.supplier_doc || '', amount, included: true, grossBasis, truckPlate: t.truck_plate, route: t.from_to || '', pendingDestination }
    })
    return [...dump, ...pm].sort((a, b) => (a.trip_date || '').localeCompare(b.trip_date || ''))
  }

  // Resolves the pending cross-tab navigation set up above — only fires
  // once selectedCutoff has actually caught up to the target, confirming
  // the period-change render has genuinely landed rather than assuming a
  // fixed delay would be enough.
  useEffect(() => {
    if (!pendingNav) return
    if (selectedCutoff !== pendingNav.cutoff) return
    const driver = drivers.find(d => d.id === pendingNav.driverId)
    setPendingNav(null)
    if (driver) { setSubTab('payroll'); openCompute(driver) }
  }, [pendingNav, selectedCutoff, drivers])

  const openCompute = async (driver) => {
    // Use fetchAll's own fresh return value, not the `entries` closure —
    // that closure can still hold data for whatever cutoff was selected
    // when this function was defined, not the current one, if the period
    // just changed in the same tick (e.g. cross-tab navigation from Trip
    // Payroll). Reading fetchAll's return directly sidesteps that entirely.
    const fresh = await fetchAll()
    const { dumpTrips, pmTrips } = await fetchTrips()
    const existing = fresh.entries.find(e => e.driver_id === driver.id)
    const freshPending = pendingTripsFor(driver.id, dumpTrips, pmTrips).map(t => ({ ...t, isNew: true }))

    let trips
    if (existing) {
      // Editing a saved entry: start from what was actually saved (so any
      // manual include/exclude or rate edits aren't silently discarded),
      // then append any trip that's newly appeared since — a late-encoded
      // trip should still surface here, not require starting over.
      const savedIds = new Set((existing.trip_breakdown || []).map(t => t.trip_id))
      trips = [
        ...(existing.trip_breakdown || []).map(t => ({ ...t, included: t.included !== false })),
        ...freshPending.filter(t => !savedIds.has(t.trip_id)),
      ]
    } else {
      trips = freshPending
    }

    const gross = trips.filter(t => t.included !== false).reduce((s, t) => s + p(t.amount), 0)
    const driverLoans = fresh.loans.filter(l => l.driver_id === driver.id && l.active && l.balance > 0)
    const driverCa = caRecords.filter(r => r.driver_id === driver.id)
    const caAdvance = driverCa.filter(r => r.type === 'advance').reduce((s, r) => s + p(r.amount), 0)
    const caPaid = driverCa.filter(r => r.type === 'payment').reduce((s, r) => s + p(r.amount), 0)
    // If we're editing an entry that already deducted CA, don't double-count
    // that deduction as "already paid" while also showing it as this entry's
    // own ca_deduction below.
    const caPaidViaOtherPayroll = fresh.entries.filter(e => e.driver_id === driver.id && e.id !== existing?.id).reduce((s, e) => s + p(e.ca_deduction), 0)
    const caBalance = Math.max(0, caAdvance - caPaid - caPaidViaOtherPayroll)

    setComputeModal(driver)
    if (existing) {
      setComputeDraft({
        editingId: existing.id,
        trip_breakdown: trips, gross_trip_earnings: gross,
        sss_employee: existing.sss_employee, philhealth_employee: existing.philhealth_employee, hdmf_employee: existing.hdmf_employee,
        contribution_override: existing.contribution_override,
        loan_deductions: existing.loan_deductions || [],
        ca_deduction: existing.ca_deduction || 0, ca_available: caBalance + p(existing.ca_deduction),
        extra_amount: existing.extra_amount || 0, extra_reason: existing.extra_reason || '',
      })
      return
    }

    const sss = lookupFlatBracket(sssBrackets, gross)
    const phil = lookupRateBracket(philBrackets, gross)
    const hdmf = lookupRateBracket(hdmfBrackets, gross, 'employee_cap')
    const loanDeductions = driverLoans.map(l => ({ loan_id: l.id, loan_type: l.loan_type, amount: Math.min(l.amortization_per_cutoff, l.balance) }))

    setComputeDraft({
      editingId: null,
      trip_breakdown: trips, gross_trip_earnings: gross,
      sss_employee: sss, philhealth_employee: phil, hdmf_employee: hdmf,
      contribution_override: false,
      loan_deductions: loanDeductions,
      ca_deduction: 0, ca_available: caBalance,
      extra_amount: 0, extra_reason: '',
    })
  }

  const liveGross = (d) => (d.trip_breakdown || []).filter(t => t.included !== false).reduce((s, t) => s + p(t.amount), 0)

  const computeNet = (d) => {
    const totalLoan = (d.loan_deductions || []).reduce((s, l) => s + p(l.amount), 0)
    return liveGross(d) - p(d.sss_employee) - p(d.philhealth_employee) - p(d.hdmf_employee) - totalLoan - p(d.ca_deduction) + p(d.extra_amount)
  }

  const saveComputedEntry = async () => {
    if (!computeModal || !computeDraft) return
    setSaving(true)
    const start = periodStart, end = periodEnd
    const netPay = computeNet(computeDraft)
    const payload = {
      driver_id: computeModal.id,
      cutoff_date: selectedCutoff,
      period_start: start, period_end: end,
      trip_breakdown: computeDraft.trip_breakdown,
      gross_trip_earnings: liveGross(computeDraft),
      sss_employee: computeDraft.sss_employee,
      philhealth_employee: computeDraft.philhealth_employee,
      hdmf_employee: computeDraft.hdmf_employee,
      contribution_override: computeDraft.contribution_override,
      loan_deductions: computeDraft.loan_deductions,
      ca_deduction: computeDraft.ca_deduction,
      extra_amount: computeDraft.extra_amount,
      extra_reason: computeDraft.extra_reason,
      net_pay: netPay,
    }
    const { error } = await supabase.from('driver_payroll_entries').upsert(payload, { onConflict: 'driver_id,cutoff_date' })
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      showToast('Entry saved.')
      setComputeModal(null); setComputeDraft(null)
      fetchAll()
      fetchPastPeriods()
      fetchAllHistory()
    }
    setSaving(false)
  }

  // Shared by lockEntry and the "Regen. Expenses" feature — one record per
  // truck AND per trip month, since relief/rotation coverage means a
  // driver can appear on more than one truck in the same period, and a
  // cutoff can span a month boundary (e.g. Aug 31–Sep 6). Splitting by trip
  // month, not just truck, means each expense lands dated within the
  // month it actually covers instead of one lump sum dated by the
  // cutoff's end — Reports/Midyear Report need no changes themselves,
  // they already total by category/truck/date, this just gets the
  // underlying dates right. Uses gross trip earnings, not net pay —
  // deductions (SSS, cash advance, etc.) are personal to the driver, not
  // an added cost to the truck. Returns the new expense record IDs.
  const postTruckMonthExpenses = async (entry, driver) => {
    const includedTrips = (entry.trip_breakdown || []).filter(t => t.included !== false)
    const byTruckMonth = {} // `${plate}::${YYYY-MM}` -> { plate, amount, lastTripDate }
    includedTrips.forEach(t => {
      const plate = t.truckPlate || '— unknown truck —'
      const month = (t.trip_date || entry.cutoff_date).slice(0, 7)
      const key = `${plate}::${month}`
      if (!byTruckMonth[key]) byTruckMonth[key] = { plate, amount: 0, lastTripDate: t.trip_date }
      byTruckMonth[key].amount += p(t.amount)
      if (t.trip_date > byTruckMonth[key].lastTripDate) byTruckMonth[key].lastTripDate = t.trip_date
    })
    const expenseIds = []
    for (const { plate, amount, lastTripDate } of Object.values(byTruckMonth)) {
      if (amount <= 0) continue
      const truck = trucks.find(tr => tr.plate === plate)
      const { data: expRow } = await supabase.from('expenses').insert({
        expense_date: lastTripDate || entry.cutoff_date, expense_type: 'operation', category: 'Driver Salary',
        description: `${driver?.driver_name || 'Driver'} — ${fmtDate(entry.period_start || periodStart)} to ${fmtDate(entry.period_end || periodEnd)}`,
        amount, scope: 'individual', truck_id: truck?.id || null, created_by: profile?.id,
      }).select().single()
      if (expRow?.id) expenseIds.push(expRow.id)
    }
    return expenseIds
  }

  // Superuser-only. Deletes whatever expense record IDs are currently
  // attached to a locked entry (cleanup, in case any still exist), then
  // recreates them fresh using the same per-truck-per-month splitting as
  // a normal lock. For backfilling entries locked before that split
  // existed, or where the original records were manually deleted.
  const regenExpenses = (entry) => {
    setConfirmState({
      title: 'Regenerate Expense Records', variant: 'warning', confirmLabel: 'Regenerate',
      message: 'Delete this entry\'s currently attached expense records (if any) and recreate them fresh from its trip data, split by truck and month? Use this to backfill an entry locked before that split existed, or if the original records were manually deleted.',
      onConfirm: async () => {
        if (entry.expense_record_ids && entry.expense_record_ids.length > 0) {
          await supabase.from('expenses').delete().in('id', entry.expense_record_ids)
        }
        const driver = drivers.find(d => d.id === entry.driver_id)
        const expenseIds = await postTruckMonthExpenses(entry, driver)
        const { data, error } = await supabase.from('driver_payroll_entries').update({ expense_record_ids: expenseIds }).eq('id', entry.id).select()
        if (error) { showToast('Error: ' + error.message, 'error'); return }
        if (!data || data.length === 0) { showToast('Regenerate did not apply — you may not have permission.', 'error'); return }
        showToast(`Regenerated ${expenseIds.length} expense record(s).`)
        fetchAll(); fetchAllHistory()
      },
    })
  }

  const lockEntry = (entry) => {
    setConfirmState({
      title: 'Lock Entry', variant: 'warning', confirmLabel: 'Lock',
      message: 'Lock this entry? Once locked it can no longer be edited, and the payslip is finalized. This also posts the driver\'s trip earnings as a per-truck expense.',
      onConfirm: async () => {
        // Deduct loan amortizations from balance now that this cutoff is final
        for (const ld of (entry.loan_deductions || [])) {
          const loan = loans.find(l => l.id === ld.loan_id)
          if (loan) await supabase.from('driver_loans').update({ balance: Math.max(0, loan.balance - ld.amount) }).eq('id', loan.id)
        }
        let caRecordId = null
        const driver = drivers.find(d => d.id === entry.driver_id)
        if (p(entry.ca_deduction) > 0) {
          const { data: caRow } = await supabase.from('payroll_cash_advances').insert({
            driver_id: entry.driver_id, date: selectedCutoff, amount: entry.ca_deduction, type: 'payment',
            description: `Payroll deduction (${selectedCutoff})`,
          }).select().single()
          caRecordId = caRow?.id || null
          logAudit('destructive', 'Locked', 'Driver Payroll', `${driver?.driver_name} · ${selectedCutoff}`, entry.id, profile?.id, profile?.full_name)
        }

        const expenseIds = await postTruckMonthExpenses({ ...entry, cutoff_date: selectedCutoff, period_start: periodStart, period_end: periodEnd }, driver)

        const { error } = await supabase.from('driver_payroll_entries').update({
          locked: true, locked_at: new Date().toISOString(), locked_by: profile?.id, ca_payment_record_id: caRecordId,
          expense_record_ids: expenseIds,
        }).eq('id', entry.id)
        if (error) { showToast('Error: ' + error.message, 'error'); return }
        showToast('Entry locked. Payslip is now final.')
        fetchAll()
        fetchAllHistory()
      },
    })
  }

  const reverseLockSideEffects = async (entry) => {
    for (const ld of (entry.loan_deductions || [])) {
      const loan = loans.find(l => l.id === ld.loan_id)
      if (loan) await supabase.from('driver_loans').update({ balance: loan.balance + p(ld.amount) }).eq('id', loan.id)
    }
    if (entry.ca_payment_record_id) {
      await supabase.from('payroll_cash_advances').delete().eq('id', entry.ca_payment_record_id)
    }
    if (entry.expense_record_ids && entry.expense_record_ids.length > 0) {
      await supabase.from('expenses').delete().in('id', entry.expense_record_ids)
    }
  }

  const unlockEntry = (entry) => {
    setConfirmState({
      title: 'Unlock Entry', variant: 'warning', confirmLabel: 'Unlock',
      message: 'Unlock this entry? This reverses the loan deductions, cash advance payment, and per-truck expense records posted when it was locked, so they can be corrected — the entry will need to be locked again once you\'re done editing.',
      onConfirm: async () => {
        await reverseLockSideEffects(entry)
        const { data, error } = await supabase.from('driver_payroll_entries').update({
          locked: false, locked_at: null, locked_by: null, ca_payment_record_id: null,
        }).eq('id', entry.id).select()
        if (error) { showToast('Error: ' + error.message, 'error'); return }
        if (!data || data.length === 0) { showToast('Unlock did not apply — you may not have permission to unlock this entry.', 'error'); return }
        showToast('Entry unlocked.')
        fetchAll()
        fetchAllHistory()
      },
    })
  }

  const deleteEntry = (entry) => {
    const driverName = drivers.find(d => d.id === entry.driver_id)?.driver_name || 'this driver'
    const lockedWarning = entry.locked ? '\n\nThis entry is LOCKED — deleting it will also reverse its loan and cash advance deductions.' : ''
    setConfirmState({
      title: 'Delete Payroll Entry', variant: 'danger', confirmLabel: 'Delete',
      message: `Delete this payroll entry for ${driverName} (${entry.cutoff_date})? This can't be undone — the trips it covered become available to include again.${lockedWarning}`,
      onConfirm: async () => {
        if (entry.locked) await reverseLockSideEffects(entry)
        const { data, error } = await supabase.from('driver_payroll_entries').delete().eq('id', entry.id).select()
        if (error) { showToast('Error: ' + error.message, 'error'); return }
        if (!data || data.length === 0) { showToast('Delete did not apply — you may not have permission to delete this entry.', 'error'); return }
        showToast('Entry deleted.')
        fetchAll()
        fetchPastPeriods()
        fetchAllHistory()
      },
    })
  }

  const activeDrivers = drivers.filter(d => d.active && (d.classification === 'company' || includedOverrides.has(d.id)))
  const excludedDrivers = drivers.filter(d => d.active && d.classification !== 'company' && !includedOverrides.has(d.id))
  const gross = (arr) => arr.reduce((s, e) => s + p(e.net_pay), 0)

  const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()

  const addSigsToDoc = (doc, sigs, W, leftX = 14) => {
    if (!sigs || sigs.length === 0) return
    const pageH = doc.internal.pageSize.getHeight()
    let sigY = doc._pendingSigY || (pageH - 30)
    if (sigY + 17 > pageH - 6) { doc.addPage(); sigY = 14 }
    const perSlot = (W - 8) / sigs.length
    sigs.forEach((s, idx) => {
      const slotX = leftX + idx * perSlot + perSlot / 2
      doc.setFontSize(5); doc.setFont(undefined, 'normal'); doc.setTextColor(120)
      doc.text(`${s.label}:`, slotX, sigY, { align: 'center' })
      doc.setDrawColor(150); doc.line(slotX - perSlot / 2 + 3, sigY + 6, slotX + perSlot / 2 - 3, sigY + 6)
      doc.setFont(undefined, 'bold'); doc.setFontSize(6); doc.setTextColor(0)
      doc.text((s.name || '').toUpperCase(), slotX, sigY + 9.5, { align: 'center' })
      doc.setFont(undefined, 'normal'); doc.setFontSize(5.5); doc.setTextColor(255, 30, 0)
      doc.text(s.title || '', slotX, sigY + 13, { align: 'center' })
      doc.setTextColor(0)
    })
  }

  const printRegister = () => {
    setPendingPrintFn(() => (sigs) => handleBrowserPrintRegister(sigs))
    setSigDialog(true)
  }

  const handleBrowserPrintRegister = (sigs) => {
    setActiveSigs(sigs)
    setTimeout(() => {
      const style = document.createElement('style')
      style.innerHTML = PRINT_STYLE
      document.head.appendChild(style)
      window.print()
      setTimeout(() => document.head.removeChild(style), 1000)
    }, 80)
  }

  const printPayslip = (driver, entry) => {
    setPendingPrintFn(() => (sigs) => doPrintPayslip(driver, entry, sigs))
    setSigDialog(true)
  }

  const doPrintPayslip = (driver, entry, sigs) => {
    const totalLoan = (entry.loan_deductions || []).reduce((s, l) => s + p(l.amount), 0)
    const govLoan = (entry.loan_deductions || []).filter(l => l.loan_type === 'sss' || l.loan_type === 'hdmf').reduce((s, l) => s + p(l.amount), 0)
    const companyLoan = (entry.loan_deductions || []).filter(l => l.loan_type === 'company').reduce((s, l) => s + p(l.amount), 0)
    const periodLabel = `${fmtDate(entry.period_start)} – ${fmtDate(entry.period_end)}`

    const doc = buildPayslipDoc({
      employeeNo: driver.employee_no || '',
      month: periodLabel,
      date: fmtDate(selectedCutoff),
      employeeName: driver.driver_name,
      companyName, companyAddress: '',
      salary: p(entry.gross_trip_earnings),
      overtime: 0,
      // Extra/adjustment is additive to pay for drivers — folded into
      // Allowance so it's reflected in the total rather than dropped.
      allowance: p(entry.extra_amount),
      tripBreakdown: (entry.trip_breakdown || []).filter(t => t.included !== false).map(t => ({ date: fmtDate(t.trip_date), docRef: t.docRef || '', label: t.label, amount: t.amount })),
      deductions: [
        { label: 'SSS Premium', amount: p(entry.sss_employee) },
        { label: 'Philhealth', amount: p(entry.philhealth_employee) },
        { label: 'Pag-ibig Fund', amount: p(entry.hdmf_employee) },
        { label: 'Withholding Tax', amount: 0 },
        { label: 'Pag-ibig/SSS Loan', amount: govLoan },
        { label: 'Personal Loan', amount: companyLoan },
        { label: 'Cash Advance', amount: p(entry.ca_deduction) },
      ],
    })

    doc._pendingSigY = doc._payslipEndY + 3
    addSigsToDoc(doc, sigs, doc._payslipRightW, doc._payslipRightX)
    doc.save(`Payslip-${driver.driver_name.replace(/\s+/g, '-')}-${selectedCutoff}.pdf`)
  }

      const [showBracketForm, setShowBracketForm] = useState(null) // { table, cols, editing } or null
  const [bracketForm, setBracketForm] = useState({})

  const openBracketForm = (table, cols, editing) => {
    setShowBracketForm({ table, cols, editing })
    const base = { min_salary: '', max_salary: '', employee_share: '', employer_share: '', employee_rate: '', employer_rate: '', employee_cap: '' }
    if (editing) {
      const filled = {}
      Object.keys(base).forEach(k => { filled[k] = editing[k] != null ? (k.includes('rate') ? String(editing[k] * 100) : String(editing[k])) : '' })
      setBracketForm(filled)
    } else setBracketForm(base)
  }
  const saveBracket = async () => {
    if (!showBracketForm) return
    const { table, editing } = showBracketForm
    setSaving(true)
    const payload = {
      min_salary: p(bracketForm.min_salary),
      max_salary: bracketForm.max_salary === '' ? null : p(bracketForm.max_salary),
      ...(table === 'sss_brackets' ? { employee_share: p(bracketForm.employee_share), employer_share: p(bracketForm.employer_share) } : {}),
      ...(table !== 'sss_brackets' ? { employee_rate: p(bracketForm.employee_rate) / 100, employer_rate: p(bracketForm.employer_rate) / 100 } : {}),
      ...(table === 'hdmf_brackets' ? { employee_cap: bracketForm.employee_cap === '' ? null : p(bracketForm.employee_cap) } : {}),
    }
    const { error } = editing
      ? await supabase.from(table).update(payload).eq('id', editing.id)
      : await supabase.from(table).insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Bracket saved.'); setShowBracketForm(null); fetchAll() }
    setSaving(false)
  }
  const deleteBracket = (table, id) => {
    setConfirmState({
      title: 'Delete Bracket Row', variant: 'danger', confirmLabel: 'Delete',
      message: 'Delete this bracket row? This can\'t be undone.',
      onConfirm: async () => {
        await supabase.from(table).delete().eq('id', id)
        fetchAll()
      },
    })
  }


  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading drivers…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { id: 'payroll', label: '📋 Payroll Register' },
            { id: 'triplog', label: '🧾 Trip Payroll' },
            { id: 'roster', label: '🚛 Roster' },
            { id: 'rates', label: '💰 Rates' },
            { id: 'loans', label: '🏦 Loans' },
            { id: 'brackets', label: '⚙️ Contribution Brackets' },
            { id: 'history', label: '📜 All History' },
          ].map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)} style={{
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: 'none',
              background: subTab === t.id ? 'var(--accent)' : 'var(--bg)',
              color: subTab === t.id ? '#fff' : 'var(--muted)',
            }}>{t.label}</button>
          ))}
        </div>
        {subTab === 'payroll' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {pastPeriods.length > 0 && (
              <select value="" onChange={e => {
                if (!e.target.value) return
                const [s, en] = e.target.value.split('|')
                setPeriodStart(s); setPeriodEnd(en)
              }} style={{ ...INPUT, width: 190 }}>
                <option value="">📅 Previously used coverage…</option>
                {pastPeriods.map(pp => (
                  <option key={`${pp.period_start}|${pp.period_end}`} value={`${pp.period_start}|${pp.period_end}`}>
                    {fmtDate(pp.period_start)} – {fmtDate(pp.period_end)}
                  </option>
                ))}
              </select>
            )}
            <button onClick={() => { const { start, end } = thisWeekRange(); setPeriodStart(start); setPeriodEnd(end) }}
              style={{ padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>This Week</button>
            <button onClick={() => { const { start, end } = lastWeekRange(); setPeriodStart(start); setPeriodEnd(end) }}
              style={{ padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Last Week</button>
            <DatePickerRange from={periodStart} to={periodEnd} onChange={({ from, to }) => { setPeriodStart(from); setPeriodEnd(to) }} />
            <button onClick={printRegister} style={{ padding: '7px 14px', background: '#334155', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>🖨️ Print Register</button>
          </div>
        )}
      </div>

      {/* ── PAYROLL REGISTER ── */}
      {subTab === 'payroll' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Period: {fmtDate(periodStart)} – {fmtDate(periodEnd)}</span>
          </div>
          {excludedDrivers.length > 0 && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                {excludedDrivers.length} subcon driver{excludedDrivers.length !== 1 ? 's' : ''} not shown below — subcon/special subcon drivers are excluded from payroll by default. Check to include for this payroll only:
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {excludedDrivers.map(d => (
                  <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" onChange={e => {
                      setIncludedOverrides(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(d.id); else next.delete(d.id)
                        return next
                      })
                    }} />
                    {d.driver_name} <span style={{ color: 'var(--muted)' }}>({d.classification === 'special_subcon' ? 'Special Subcon' : 'Subcon'})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                <th style={{ ...TH, textAlign: 'left' }}>Driver</th>
                <th style={TH}>Pending Trips</th>
                <th style={TH}>Gross (this cutoff)</th>
                <th style={TH}>Net Pay</th>
                <th style={TH}>Status</th>
                <th style={TH}>Actions</th>
              </tr></thead>
              <tbody>
                {activeDrivers.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No active drivers yet — add one in the Roster tab.</td></tr>
                ) : activeDrivers.map(d => {
                  const entry = entries.find(e => e.driver_id === d.id)
                  const pending = pendingTripsFor(d.id)
                  return (
                    <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ ...TD, textAlign: 'left', fontWeight: 600 }}>{d.driver_name}</td>
                      <td style={TD}>{entry ? (entry.trip_breakdown || []).filter(t => t.included !== false).length : pending.length}</td>
                      <td style={TD} className="mono">₱{fmt(entry ? entry.gross_trip_earnings : pending.reduce((s, t) => s + t.amount, 0))}</td>
                      <td style={TD} className="mono">{entry ? `₱${fmt(entry.net_pay)}` : '—'}</td>
                      <td style={TD}>{entry?.locked
                        ? <span style={{ fontSize: 11, background: 'var(--success-light)', color: 'var(--success)', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>🔒 Locked</span>
                        : entry
                          ? <span style={{ fontSize: 11, background: 'var(--warning-light)', color: 'var(--warning)', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Draft</span>
                          : <span style={{ fontSize: 11, color: 'var(--muted)' }}>Not computed</span>}
                      </td>
                      <td style={TD}>
                        {entry?.locked ? (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                            <button onClick={() => printPayslip(d, entry)} style={ActionBtn('#334155')}>🖨️ Payslip</button>
                            {isSuperuser && <button onClick={() => unlockEntry(entry)} style={ActionBtn('var(--danger)')}>🔓 Unlock</button>}
                            {isSuperuser && <button onClick={() => regenExpenses(entry)} style={ActionBtn('#7c3aed')}>🔄 Regen. Expenses</button>}
                            {isAdmin && !isSuperuser && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Superuser only</span>}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <button onClick={() => openCompute(d)} style={ActionBtn('#3b82f6')}>{entry ? 'Edit' : 'Compute'}</button>
                            {entry && <button onClick={() => printPayslip(d, entry)} style={ActionBtn('#334155')}>🖨️ Preview</button>}
                            {entry && isAdmin && <button onClick={() => lockEntry(entry)} style={ActionBtn('var(--success)')}>🔒 Lock</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {entries.length > 0 && (
                <tfoot><tr style={{ background: 'var(--bg)', fontWeight: 700 }}>
                  <td style={{ ...TD, textAlign: 'left' }}>Total</td><td style={TD}></td><td style={TD}></td>
                  <td style={TD} className="mono">₱{fmt(gross(entries))}</td><td style={TD}></td><td style={TD}></td>
                </tr></tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {/* ── ROSTER ── */}
      {subTab === 'roster' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            {isAdmin && (
              <button onClick={() => { setEditingDriverId(null); setDriverForm(EMPTY_DRIVER); setShowDriverForm(true) }}
                style={{ padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add Driver</button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>Sort by</span>
              <select value={driverSort} onChange={e => setDriverSort(e.target.value)} style={{ ...INPUT, width: 150 }}>
                <option value="name">Name</option>
                <option value="hire_date">Year Hired</option>
                <option value="employee_no">Employee No.</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[...drivers].sort((a, b) => {
              if (driverSort === 'hire_date') return (b.hire_date || '').localeCompare(a.hire_date || '') // most recently hired first
              if (driverSort === 'employee_no') return (a.employee_no || '').localeCompare(b.employee_no || '')
              return (a.driver_name || '').localeCompare(b.driver_name || '')
            }).map(d => (
              <div key={d.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{d.driver_name}</span>
                    {d.employee_no && <span style={{ fontSize: 10, color: 'var(--muted)' }}>#{d.employee_no}</span>}
                    {!d.active && <span style={{ fontSize: 10, background: 'var(--danger-light)', color: 'var(--danger)', padding: '2px 6px', borderRadius: 4 }}>INACTIVE</span>}
                    {d.classification && d.classification !== 'company' && (
                      <span style={{ fontSize: 10, background: '#fff7ed', color: '#c2410c', padding: '2px 6px', borderRadius: 4 }}>{d.classification === 'special_subcon' ? 'SPECIAL SUBCON' : 'SUBCON'}</span>
                    )}
                    <span style={{ fontSize: 10, background: 'var(--bg)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 4 }}>Default: {d.pay_type === 'percentage' ? `${d.percentage_rate}% of trip` : 'Fixed rate'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Truck: {d.is_reliever ? '🔄 Reliever (no fixed truck)' : (trucks.find(t => t.id === d.truck_id)?.plate || '— unassigned —')} {d.hire_date && `· Hired ${fmtDate(d.hire_date)}`} {d.termination_date && `· Terminated ${fmtDate(d.termination_date)}`}</div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                    <span>SSS: {d.sss_no || '—'}</span><span>PhilHealth: {d.philhealth_no || '—'}</span><span>HDMF: {d.hdmf_no || '—'}</span>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={() => { setEditingDriverId(d.id); setDriverForm({ ...EMPTY_DRIVER, ...d, truck_id: d.truck_id || '', percentage_rate: String(d.percentage_rate || '') }); setShowDriverForm(true) }} style={ActionBtn('#3b82f6')}>✏️ Edit</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── RATES ── */}
      {subTab === 'rates' && (
        <div>
          {isAdmin && (
            <button onClick={() => { setEditingRateId(null); setRateForm(EMPTY_RATE); setShowRateForm(true) }}
              style={{ marginBottom: 14, padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add Rate</button>
          )}
          <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                <th style={{ ...TH, textAlign: 'left' }}>Driver</th><th style={TH}>Truck Type</th><th style={TH}>Route / Trip Code</th><th style={TH}>Pay Type</th><th style={TH}>Rate</th><th style={TH}>Actions</th>
              </tr></thead>
              <tbody>
                {rates.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>No rate rules configured yet.</td></tr> : rates.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...TD, textAlign: 'left' }}>{r.driver_id ? (drivers.find(d => d.id === r.driver_id)?.driver_name || '—') : <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>All Drivers</span>}</td>
                    <td style={TD}>{r.truck_type}</td>
                    <td style={TD}>
                      {r.trip_code && STRUCTURED_PM_CODES.includes(r.trip_code)
                        ? <>{r.trip_code} — {r.container_size || '?'}{r.van_status ? ` ${r.van_status}` : ''} — {r.destination || '(no destination)'}</>
                        : (r.route || r.trip_code || 'General')}
                    </td>
                    <td style={TD}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: r.pay_type === 'percentage' ? '#f5f3ff' : '#eff6ff', color: r.pay_type === 'percentage' ? '#7c3aed' : '#2563eb' }}>
                        {r.pay_type === 'percentage' ? '% Percentage' : 'Fixed'}
                      </span>
                    </td>
                    <td style={TD} className="mono">{r.pay_type === 'percentage' ? `${r.percentage_rate}%` : `₱${fmt(r.rate_per_trip)}`}</td>
                    <td style={TD}>{isAdmin && <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button onClick={() => { setEditingRateId(r.id); setRateForm({ ...r, rate_per_trip: String(r.rate_per_trip), percentage_rate: String(r.percentage_rate || ''), isGeneral: !r.route && !r.trip_code }); setShowRateForm(true) }} style={ActionBtn('#3b82f6')}>✏️</button>
                      <button onClick={() => deleteRate(r.id)} style={ActionBtn('var(--danger)')}>🗑️</button>
                    </div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LOANS ── */}
      {subTab === 'loans' && (
        <div>
          {isAdmin && (
            <button onClick={() => { setEditingLoanId(null); setLoanForm(EMPTY_LOAN); setShowLoanForm(true) }}
              style={{ marginBottom: 14, padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add Loan</button>
          )}
          <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                <th style={{ ...TH, textAlign: 'left' }}>Driver</th><th style={TH}>Type</th><th style={TH}>Principal</th><th style={TH}>Per Cutoff</th><th style={TH}>Balance</th><th style={TH}>Actions</th>
              </tr></thead>
              <tbody>
                {loans.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>No loans on file.</td></tr> : loans.map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...TD, textAlign: 'left' }}>{drivers.find(d => d.id === l.driver_id)?.driver_name || '—'}</td>
                    <td style={TD}>{l.loan_type.toUpperCase()}</td>
                    <td style={TD} className="mono">₱{fmt(l.principal)}</td>
                    <td style={TD} className="mono">₱{fmt(l.amortization_per_cutoff)}</td>
                    <td style={{ ...TD, color: l.balance > 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }} className="mono">₱{fmt(l.balance)}</td>
                    <td style={TD}>{isAdmin && <button onClick={() => { setEditingLoanId(l.id); setLoanForm({ ...l, principal: String(l.principal), amortization_per_cutoff: String(l.amortization_per_cutoff), balance: String(l.balance) }); setShowLoanForm(true) }} style={ActionBtn('#3b82f6')}>✏️</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

  {/* ── CONTRIBUTION BRACKETS ── */}
      {subTab === 'brackets' && (
        <div style={{ display: 'grid', gap: 20 }}>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>These tables drive the auto-computed SSS/PhilHealth/HDMF deductions in the Payroll Register. Edit them here whenever the agencies revise their rates — nothing is hardcoded in the app.</p>
          {[
            { title: 'SSS (flat employee share)', rows: sssBrackets, table: 'sss_brackets', cols: ['min_salary', 'max_salary', 'employee_share'] },
            { title: 'PhilHealth (rate)', rows: philBrackets, table: 'philhealth_brackets', cols: ['min_salary', 'max_salary', 'employee_rate'] },
            { title: 'HDMF / Pag-IBIG (rate + cap)', rows: hdmfBrackets, table: 'hdmf_brackets', cols: ['min_salary', 'max_salary', 'employee_rate', 'employee_cap'] },
          ].map(section => (
            <div key={section.table}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{section.title}</div>
                {isAdmin && <button onClick={() => openBracketForm(section.table, section.cols, null)} style={{ padding: '4px 10px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ Add Row</button>}
              </div>
              <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: 'var(--bg)' }}>{section.cols.map(c => <th key={c} style={TH}>{c.replace(/_/g, ' ')}</th>)}{isAdmin && <th style={TH}>Actions</th>}</tr></thead>
                  <tbody>
                    {section.rows.length === 0 ? <tr><td colSpan={section.cols.length + 1} style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No brackets set yet — click "+ Add Row" above.</td></tr>
                    : section.rows.map(r => <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        {section.cols.map(c => <td key={c} style={TD}>{c.includes('rate') ? `${(r[c] * 100).toFixed(2)}%` : (r[c] != null ? `₱${fmt(r[c])}` : '—')}</td>)}
                        {isAdmin && <td style={TD}><div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          <button onClick={() => openBracketForm(section.table, section.cols, r)} style={ActionBtn('#3b82f6')}>✏️</button>
                          <button onClick={() => deleteBracket(section.table, r.id)} style={ActionBtn('var(--danger)')}>🗑️</button>
                        </div></td>}
                      </tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ALL HISTORY ── */}
      {subTab === 'history' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Every driver payroll entry ever computed, across all coverage periods — mainly useful while testing, to see or clean up everything in one place rather than switching periods one at a time.</p>
          <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                <th style={{ ...TH, textAlign: 'left' }}>Driver</th>
                <th style={TH}>Period</th>
                <th style={TH}>Cutoff</th>
                <th style={TH}>Gross</th>
                <th style={TH}>Net Pay</th>
                <th style={TH}>Status</th>
                <th style={TH}>Actions</th>
              </tr></thead>
              <tbody>
                {allHistory.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No payroll entries computed yet.</td></tr>
                ) : allHistory.map(h => {
                  const driver = drivers.find(d => d.id === h.driver_id)
                  return (
                    <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ ...TD, textAlign: 'left', fontWeight: 600 }}>{driver?.driver_name || '— deleted driver —'}</td>
                      <td style={TD}>{fmtDate(h.period_start)} – {fmtDate(h.period_end)}</td>
                      <td style={TD}>{fmtDate(h.cutoff_date)}</td>
                      <td style={TD} className="mono">₱{fmt(h.gross_trip_earnings)}</td>
                      <td style={{ ...TD, color: h.net_pay < 0 ? 'var(--danger)' : undefined }} className="mono">₱{fmt(h.net_pay)}</td>
                      <td style={TD}>{h.locked
                        ? <span style={{ fontSize: 11, background: 'var(--success-light)', color: 'var(--success)', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>🔒 Locked</span>
                        : <span style={{ fontSize: 11, background: 'var(--warning-light)', color: 'var(--warning)', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Draft</span>}
                      </td>
                      <td style={TD}>
                        {(h.locked ? isSuperuser : isAdmin) && (
                          <button onClick={() => deleteEntry(h)} style={ActionBtn('var(--danger)')}>🗑️ Delete</button>
                        )}
                        {h.locked && isSuperuser && (
                          <button onClick={() => regenExpenses(h)} style={ActionBtn('#7c3aed')}>🔄 Regen. Expenses</button>
                        )}
                        {h.locked && isAdmin && !isSuperuser && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Superuser only</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'triplog' && (() => {
        const getStatus = (t) => {
          const info = tripEntryMap[t.id]
          if (info) return { status: info.locked ? 'paid' : 'pending', entryInfo: info }
          if (t.payroll_settled_external) return { status: 'settled', entryInfo: null }
          if (!t.driver_id) return { status: 'no_driver', entryInfo: null }
          return { status: 'unpaid', entryInfo: null }
        }
        const STATUS_LABEL = {
          paid: ['✅ Paid', 'var(--success)', 'var(--success-light)'], pending: ['🟡 Pending', 'var(--warning)', 'var(--warning-light)'],
          unpaid: ['⏳ Unpaid', '#6b7280', '#f3f4f6'], settled: ['📦 Settled (pre-system)', '#7c3aed', '#f5f3ff'],
          no_driver: ['❔ No Driver', '#9ca3af', '#f9fafb'],
        }
        const rows = [
          ...tripLogDump.map(t => ({ ...t, _type: 'dump', _amount: (t.weight_tons || 0) * (t.rate_per_ton || 0), _label: t.route || '—' })),
          ...tripLogPm.map(t => ({ ...t, _type: 'pm', _amount: (t.supplier_amount || 0) + (t.stripping_fee || 0), _label: t.trip_code || '—' })),
        ].map(t => ({ ...t, ...getStatus(t) }))
        const filtered = rows.filter(t => {
          if (!tripLogShowNoDriver && t.status === 'no_driver') return false
          if (tripLogStatus && t.status !== tripLogStatus) return false
          if (tripLogDriver && t.driver_id !== tripLogDriver) return false
          if (tripLogFrom && t.trip_date < tripLogFrom) return false
          if (tripLogTo && t.trip_date > tripLogTo) return false
          if (tripLogSearch && ![t.truck_plate, t._label].some(v => v?.toLowerCase().includes(tripLogSearch.toLowerCase()))) return false
          return true
        }).sort((a, b) => (b.trip_date || '').localeCompare(a.trip_date || ''))
        const eligibleForSettle = tripLogSelected.filter(s => rows.find(r => r.id === s.id && r._type === s._type)?.status === 'unpaid')

        const exportExcel = () => {
          const aoa = [['Date', 'Plate', 'Driver', 'Type', 'Route / Trip Code', 'Amount', 'Status']]
          filtered.forEach(t => aoa.push([fmtDate(t.trip_date), t.truck_plate, drivers.find(d => d.id === t.driver_id)?.driver_name || '—', t._type === 'dump' ? 'Dump' : 'PM', t._label, Number(t._amount || 0), STATUS_LABEL[t.status][0]]))
          const ws = XLSX.utils.aoa_to_sheet(aoa)
          const wb = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb, ws, 'Trip Payroll')
          XLSX.writeFile(wb, `Trip-Payroll-${new Date().toISOString().slice(0, 10)}.xlsx`)
        }
        const printLog = () => {
          const win = window.open('', '_blank')
          const body = filtered.map(t => `<tr><td>${fmtDate(t.trip_date)}</td><td>${t.truck_plate}</td><td>${drivers.find(d => d.id === t.driver_id)?.driver_name || '—'}</td><td>${t._type === 'dump' ? 'Dump' : 'PM'}</td><td>${t._label}</td><td style="text-align:right">₱${fmt(t._amount)}</td><td>${STATUS_LABEL[t.status][0]}</td></tr>`).join('')
          win.document.write(`<html><head><title>Trip Payroll</title><style>
            body{font-family:Arial,sans-serif;font-size:11px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:4px 8px;text-align:left} th{background:#f0f0f0}
            @page{size:letter landscape;margin:10mm}
          </style></head><body><h3>Trip Payroll — ${new Date().toLocaleDateString('en-PH')}</h3>
          <table><thead><tr><th>Date</th><th>Plate</th><th>Driver</th><th>Type</th><th>Route/Code</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>${body}</tbody></table></body></html>`)
          win.document.close(); win.print()
        }
        const markSettledBulk = async () => {
          const dumpIds = eligibleForSettle.filter(s => s._type === 'dump').map(s => s.id)
          const pmIds = eligibleForSettle.filter(s => s._type === 'pm').map(s => s.id)
          if (dumpIds.length) await supabase.from('trips_dump').update({ payroll_settled_external: true }).in('id', dumpIds)
          if (pmIds.length) await supabase.from('trips_pm').update({ payroll_settled_external: true }).in('id', pmIds)
          showToast(`Marked ${eligibleForSettle.length} trip(s) settled.`)
          setTripLogSelected([]); fetchTripLog()
        }

        return (
          <div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Who drove this trip, and were they paid — starting from the trip itself, not from payroll entries. "No Driver" trips are hidden by default.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
              <input placeholder="Search plate / route / code…" value={tripLogSearch} onChange={e => setTripLogSearch(e.target.value)} style={{ ...INPUT, width: 200 }} />
              <select value={tripLogDriver} onChange={e => setTripLogDriver(e.target.value)} style={{ ...INPUT, width: 160 }}>
                <option value="">All drivers</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.driver_name}</option>)}
              </select>
              <select value={tripLogStatus} onChange={e => setTripLogStatus(e.target.value)} style={{ ...INPUT, width: 160 }}>
                <option value="">All statuses</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="unpaid">Unpaid</option>
                <option value="settled">Settled (pre-system)</option>
                {tripLogShowNoDriver && <option value="no_driver">No Driver</option>}
              </select>
              <DatePickerRange from={tripLogFrom} to={tripLogTo} onChange={({ from, to }) => { setTripLogFrom(from); setTripLogTo(to) }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={tripLogShowNoDriver} onChange={e => setTripLogShowNoDriver(e.target.checked)} />
                Show No Driver
              </label>
              <div style={{ flex: 1 }} />
              {eligibleForSettle.length > 0 && (
                <button onClick={markSettledBulk} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  📦 Mark Settled ({eligibleForSettle.length})
                </button>
              )}
              <button onClick={exportExcel} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer' }}>📊 Excel</button>
              <button onClick={printLog} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer' }}>🖨️ Print</button>
            </div>
            <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', minWidth: 800, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                  <th style={TH}></th>
                  <th style={{ ...TH, textAlign: 'left' }}>Date</th>
                  <th style={TH}>Plate</th>
                  <th style={TH}>Driver</th>
                  <th style={TH}>Type</th>
                  <th style={TH}>Route / Trip Code</th>
                  <th style={TH}>Amount</th>
                  <th style={TH}>Status</th>
                </tr></thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No trips match these filters.</td></tr>
                  ) : filtered.map(t => {
                    const [label, color, bg] = STATUS_LABEL[t.status]
                    const clickable = t.status === 'paid' || t.status === 'pending'
                    const checked = tripLogSelected.some(s => s.id === t.id && s._type === t._type)
                    return (
                      <tr key={t._type + t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={TD}>
                          {t.status === 'unpaid' && (
                            <input type="checkbox" checked={checked} onChange={e => setTripLogSelected(p => e.target.checked ? [...p, { id: t.id, _type: t._type }] : p.filter(s => !(s.id === t.id && s._type === t._type)))} />
                          )}
                        </td>
                        <td style={{ ...TD, textAlign: 'left' }} className="mono">{fmtDate(t.trip_date)}</td>
                        <td style={TD} className="mono">{t.truck_plate}</td>
                        <td style={TD}>{drivers.find(d => d.id === t.driver_id)?.driver_name || '—'}</td>
                        <td style={TD}>{t._type === 'dump' ? 'Dump' : 'PM'}</td>
                        <td style={TD}>{t._label}</td>
                        <td style={TD} className="mono">₱{fmt(t._amount)}</td>
                        <td style={TD}>
                          <span
                            onClick={clickable ? () => { setPeriodEnd(t.entryInfo.cutoffDate); setPendingNav({ driverId: t.entryInfo.driverId, cutoff: t.entryInfo.cutoffDate }) } : undefined}
                            style={{ fontSize: 11, background: bg, color, padding: '2px 8px', borderRadius: 10, fontWeight: 600, cursor: clickable ? 'pointer' : 'default' }}
                          >{label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* ── MODALS ── */}
      {showDriverForm && (
        <Modal title={editingDriverId ? 'Edit Driver' : 'Add Driver'} onClose={() => setShowDriverForm(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <FormRow label="Driver Name *"><input value={driverForm.driver_name} onChange={e => setDriverForm(f => ({ ...f, driver_name: e.target.value }))} style={INPUT} /></FormRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormRow label="Employee No."><input value={driverForm.employee_no} onChange={e => setDriverForm(f => ({ ...f, employee_no: e.target.value }))} placeholder="e.g. 23-001" style={INPUT} /></FormRow>
              <FormRow label="Classification">
                <select value={driverForm.classification} onChange={e => setDriverForm(f => ({ ...f, classification: e.target.value }))} style={INPUT}>
                  <option value="company">Company</option>
                  <option value="subcon">Subcon</option>
                  <option value="special_subcon">Special Subcon</option>
                </select>
              </FormRow>
            </div>
            <FormRow label="Assigned Truck">
              <select value={driverForm.is_reliever ? '__RELIEVER__' : driverForm.truck_id} onChange={e => {
                if (e.target.value === '__RELIEVER__') { setDriverForm(f => ({ ...f, truck_id: '', is_reliever: true })); return }
                const truck = trucks.find(t => t.id === e.target.value)
                // Auto-suggest classification to match the truck's ownership —
                // easy to end up with a mismatched "Company" driver on a
                // Subcon truck otherwise, since these were previously two
                // fully independent fields with nothing linking them.
                setDriverForm(f => ({
                  ...f, truck_id: e.target.value, is_reliever: false,
                  classification: truck?.ownership === 'subcon' ? 'subcon' : truck?.ownership === 'special_subcon' ? 'special_subcon' : f.classification,
                }))
              }} style={INPUT}>
                <option value="">— None —</option>
                <option value="__RELIEVER__">🔄 Reliever (no fixed truck)</option>
                {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}{t.ownership === 'subcon' ? ' (Subcon)' : t.ownership === 'special_subcon' ? ' (Special Subcon)' : ''}</option>)}
              </select>
            </FormRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormRow label="Pay Type">
                <select value={driverForm.pay_type} onChange={e => setDriverForm(f => ({ ...f, pay_type: e.target.value }))} style={INPUT}>
                  <option value="fixed">Fixed rate (per route/trip type)</option>
                  <option value="percentage">Percentage of trip billed amount</option>
                </select>
              </FormRow>
              {driverForm.pay_type === 'percentage' && (
                <FormRow label="Percentage (%)"><input type="number" value={driverForm.percentage_rate} onChange={e => setDriverForm(f => ({ ...f, percentage_rate: e.target.value }))} style={INPUT} /></FormRow>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormRow label="Hire Date"><DatePickerSingle value={driverForm.hire_date} onChange={e => setDriverForm(f => ({ ...f, hire_date: e.target.value }))} style={INPUT} /></FormRow>
              <FormRow label="Termination Date"><DatePickerSingle value={driverForm.termination_date} onChange={e => setDriverForm(f => ({ ...f, termination_date: e.target.value }))} style={INPUT} /></FormRow>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <FormRow label="SSS No."><input value={driverForm.sss_no} onChange={e => setDriverForm(f => ({ ...f, sss_no: e.target.value }))} style={INPUT} /></FormRow>
              <FormRow label="PhilHealth No."><input value={driverForm.philhealth_no} onChange={e => setDriverForm(f => ({ ...f, philhealth_no: e.target.value }))} style={INPUT} /></FormRow>
              <FormRow label="HDMF No."><input value={driverForm.hdmf_no} onChange={e => setDriverForm(f => ({ ...f, hdmf_no: e.target.value }))} style={INPUT} /></FormRow>
            </div>
            <FormRow label="Notes"><input value={driverForm.notes} onChange={e => setDriverForm(f => ({ ...f, notes: e.target.value }))} style={INPUT} /></FormRow>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={driverForm.active} onChange={e => setDriverForm(f => ({ ...f, active: e.target.checked }))} /> Active</label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowDriverForm(false)} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={saveDriver} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showRateForm && (
        <Modal title={editingRateId ? 'Edit Rate' : 'Add Rate'} onClose={() => setShowRateForm(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <FormRow label="Driver">
              <select value={rateForm.driver_id} onChange={e => setRateForm(f => ({ ...f, driver_id: e.target.value }))} style={INPUT}>
                <option value="">— All Drivers (shared/fleet-wide rate) —</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.driver_name}</option>)}
              </select>
            </FormRow>
            <FormRow label="Truck Type">
              <select value={rateForm.truck_type} onChange={e => setRateForm(f => ({ ...f, truck_type: e.target.value, route: '', trip_code: '' }))} style={INPUT}>
                <option value="Dump Truck">Dump Truck</option><option value="Prime Mover">Prime Mover</option>
              </select>
            </FormRow>
            <FormRow label="">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!rateForm.isGeneral}
                  onChange={e => setRateForm(f => ({ ...f, isGeneral: e.target.checked, route: e.target.checked ? '' : f.route, trip_code: e.target.checked ? '' : f.trip_code }))} />
                <span><strong>General rate</strong> — applies to any route/trip code {rateForm.driver_id ? 'this driver runs' : 'any driver runs'}, unless a more specific rate matches</span>
              </label>
            </FormRow>
            {!rateForm.isGeneral && (rateForm.truck_type === 'Dump Truck' ? (
              <FormRow label="Route"><input value={rateForm.route} onChange={e => setRateForm(f => ({ ...f, route: e.target.value }))} placeholder="e.g. CDO-Davao" style={INPUT} /></FormRow>
            ) : (
              <>
                <FormRow label="Trip Code">
                  <select value={rateForm.trip_code} onChange={e => setRateForm(f => ({ ...f, trip_code: e.target.value, container_size: '', van_status: '', destination: '' }))} style={INPUT}>
                    <option value="">— Select trip code —</option>
                    {getAllPmCodes().map(code => <option key={code} value={code}>{code}</option>)}
                  </select>
                </FormRow>
                {rateForm.trip_code && (
                  <>
                    <FormRow label="Container Size">
                      <select value={rateForm.container_size} onChange={e => setRateForm(f => ({ ...f, container_size: e.target.value }))} style={INPUT}>
                        <option value="">— Select size —</option>
                        <option value="20ft">20ft</option>
                        <option value="40ft">40ft</option>
                      </select>
                    </FormRow>
                    {rateForm.trip_code === 'Hustling PSACC' && (
                      <FormRow label="Status">
                        <select value={rateForm.van_status} onChange={e => setRateForm(f => ({ ...f, van_status: e.target.value }))} style={INPUT}>
                          <option value="">— Select status —</option>
                          <option value="Full">Full</option>
                          <option value="Empty">Empty</option>
                        </select>
                      </FormRow>
                    )}
                    <FormRow label="Destination">
                      <input list="pm-destination-suggestions" value={rateForm.destination}
                        onChange={e => setRateForm(f => ({ ...f, destination: e.target.value }))}
                        placeholder="Type new, or pick an existing one below" style={INPUT} />
                      <datalist id="pm-destination-suggestions">
                        {[...new Set(rates.filter(r => r.trip_code === rateForm.trip_code && r.destination).map(r => r.destination))].sort().map(d => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                    </FormRow>
                  </>
                )}
              </>
            ))}
            <FormRow label="Pay Type for this Rule">
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', padding: 3, borderRadius: 6, width: 'fit-content' }}>
                {[{ key: 'fixed', label: 'Fixed Rate' }, { key: 'percentage', label: 'Percentage' }].map(o => (
                  <button key={o.key} type="button" onClick={() => setRateForm(f => ({ ...f, pay_type: o.key }))} style={{
                    padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: 'none',
                    background: rateForm.pay_type === o.key ? 'var(--surface)' : 'transparent',
                    color: rateForm.pay_type === o.key ? 'var(--text)' : 'var(--muted)',
                  }}>{o.label}</button>
                ))}
              </div>
            </FormRow>
            {rateForm.pay_type === 'percentage' ? (
              <FormRow label="Percentage of Trip Billed Amount (%) *"><input type="number" step="0.01" value={rateForm.percentage_rate} onChange={e => setRateForm(f => ({ ...f, percentage_rate: e.target.value }))} style={INPUT} /></FormRow>
            ) : (
              <FormRow label="Rate per Trip *"><input type="number" value={rateForm.rate_per_trip} onChange={e => setRateForm(f => ({ ...f, rate_per_trip: e.target.value }))} style={INPUT} /></FormRow>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowRateForm(false)} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={saveRate} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showLoanForm && (
        <Modal title={editingLoanId ? 'Edit Loan' : 'Add Loan'} onClose={() => setShowLoanForm(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <FormRow label="Driver *">
              <select value={loanForm.driver_id} onChange={e => setLoanForm(f => ({ ...f, driver_id: e.target.value }))} style={INPUT}>
                <option value="">— Select driver —</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.driver_name}</option>)}
              </select>
            </FormRow>
            <FormRow label="Loan Type">
              <select value={loanForm.loan_type} onChange={e => setLoanForm(f => ({ ...f, loan_type: e.target.value }))} style={INPUT}>
                <option value="sss">SSS Loan</option><option value="hdmf">Pag-IBIG (HDMF) Loan</option><option value="company">Company Loan</option>
              </select>
            </FormRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormRow label="Principal *"><input type="number" value={loanForm.principal} onChange={e => setLoanForm(f => ({ ...f, principal: e.target.value }))} style={INPUT} /></FormRow>
              <FormRow label="Amortization / Cutoff"><input type="number" value={loanForm.amortization_per_cutoff} onChange={e => setLoanForm(f => ({ ...f, amortization_per_cutoff: e.target.value }))} style={INPUT} /></FormRow>
            </div>
            {editingLoanId && <FormRow label="Current Balance"><input type="number" value={loanForm.balance} onChange={e => setLoanForm(f => ({ ...f, balance: e.target.value }))} style={INPUT} /></FormRow>}
            <FormRow label="Description"><input value={loanForm.description} onChange={e => setLoanForm(f => ({ ...f, description: e.target.value }))} style={INPUT} /></FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowLoanForm(false)} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={saveLoan} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {computeModal && computeDraft && (
        <Modal title={`Compute — ${computeModal.driver_name} (${fmtDate(periodStart)} – ${fmtDate(periodEnd)})`} onClose={() => { setComputeModal(null); setComputeDraft(null) }} wide>
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  Trip Earnings ({computeDraft.trip_breakdown.filter(t => t.included !== false).length} of {computeDraft.trip_breakdown.length} included)
                  <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>Uncheck to leave a trip out this cutoff — it stays available to include later. Rate is editable per trip.</span>
                </div>
                {computeDraft.trip_breakdown.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setComputeDraft(d => ({ ...d, trip_breakdown: d.trip_breakdown.map(t => ({ ...t, included: true })) }))}
                      style={{ padding: '3px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>Select All</button>
                    <button onClick={() => setComputeDraft(d => ({ ...d, trip_breakdown: d.trip_breakdown.map(t => ({ ...t, included: false })) }))}
                      style={{ padding: '3px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>Deselect All</button>
                  </div>
                )}
              </div>
              {computeDraft.trip_breakdown.some(t => t.trip_date < periodStart || t.trip_date > periodEnd) && (
                <div style={{ background: 'var(--warning-light)', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px', marginBottom: 8, fontSize: 12, color: 'var(--warning)' }}>
                  ⚠️ One or more included trips fall outside the selected coverage period ({fmtDate(periodStart)} – {fmtDate(periodEnd)}) — highlighted below. This can happen when computing a late cutoff (e.g. processing last month's payroll a few days into this one) and forgetting to adjust the period dates first. This won't block saving, but double-check the dates are what you intend before locking.
                </div>
              )}
              <div style={{ maxHeight: 220, overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid var(--border)', borderRadius: 6 }}>
                <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: 'var(--bg)' }}><th style={TH}></th><th style={TH}>Date</th><th style={{ ...TH, textAlign: 'left' }}>Doc Ref</th><th style={{ ...TH, textAlign: 'left' }}>Route</th><th style={{ ...TH, textAlign: 'left' }}>Trip</th><th style={TH}>Rate</th></tr></thead>
                  <tbody>{computeDraft.trip_breakdown.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, color: 'var(--muted)' }}>No unpaid trips found for this driver.</td></tr>
                    : computeDraft.trip_breakdown.map((t, idx) => {
                      const outOfPeriod = t.trip_date < periodStart || t.trip_date > periodEnd
                      return (
                      <tr key={`${t.trip_id}-${idx}`} style={{ borderBottom: '1px solid var(--border)', opacity: t.included === false ? 0.5 : 1, background: outOfPeriod ? 'var(--warning-light)' : undefined }}>
                        <td style={TD}>
                          <input type="checkbox" checked={t.included !== false} onChange={e => {
                            const checked = e.target.checked
                            setComputeDraft(d => {
                              const next = [...d.trip_breakdown]
                              next[idx] = { ...next[idx], included: checked }
                              return { ...d, trip_breakdown: next }
                            })
                          }} />
                        </td>
                        <td style={{ ...TD, ...(outOfPeriod ? { color: '#b45309', fontWeight: 700 } : {}) }} title={outOfPeriod ? 'Outside the selected coverage period' : undefined}>{outOfPeriod && '⚠️ '}{fmtDate(t.trip_date)}</td>
                        <td style={{ ...TD, textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>{t.docRef || '—'}</td>
                        <td style={{ ...TD, textAlign: 'left', fontSize: 11 }}>{t.route || '—'}</td>
                        <td style={{ ...TD, textAlign: 'left' }}>{t.label}</td>
                        <td style={TD}>
                          <div style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}>
                            {t.pendingDestination ? (
                              <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, background: 'var(--danger-light)', padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                                ⚑ Destination pending — set it in Trips, then add a rate
                              </span>
                            ) : (() => {
                              const truckType = t.trip_type === 'dump' ? 'Dump Truck' : 'Prime Mover'
                              const specificPresets = rates.filter(r => r.driver_id === computeModal.id && r.truck_type === truckType)
                              const sharedPresets = rates.filter(r => !r.driver_id && r.truck_type === truckType)
                              const basis = t.grossBasis != null ? t.grossBasis : p(t.amount)
                              const valueFor = (payType, pctRate, fixedRate) =>
                                Math.round((payType === 'percentage' ? basis * (p(pctRate) / 100) : p(fixedRate)) * 100) / 100
                              const currentAmount = Math.round(p(t.amount) * 100) / 100
                              const applyValue = (payType, pctRate, fixedRate) => {
                                setComputeDraft(d => {
                                  const next = [...d.trip_breakdown]
                                  next[idx] = { ...next[idx], amount: valueFor(payType, pctRate, fixedRate) }
                                  return { ...d, trip_breakdown: next }
                                })
                              }
                              // Reflect whichever preset currently matches the trip's amount, so the
                              // dropdown shows what's actually applied instead of always resetting to a
                              // blank placeholder — but only while it still matches; once the amount is
                              // hand-edited away from every preset, it correctly falls back to blank.
                              let selectedValue = ''
                              const matchedSpecific = specificPresets.find(r => valueFor(r.pay_type, r.percentage_rate, r.rate_per_trip) === currentAmount)
                              const matchedShared = !matchedSpecific && sharedPresets.find(r => valueFor(r.pay_type, r.percentage_rate, r.rate_per_trip) === currentAmount)
                              if (matchedSpecific) selectedValue = matchedSpecific.id
                              else if (matchedShared) selectedValue = matchedShared.id
                              else if (valueFor(computeModal.pay_type, computeModal.percentage_rate, 0) === currentAmount) selectedValue = '__general__'
                              return (
                                <select value={selectedValue} onChange={e => {
                                  if (!e.target.value) return
                                  if (e.target.value === '__general__') {
                                    applyValue(computeModal.pay_type, computeModal.percentage_rate, 0)
                                    return
                                  }
                                  const preset = specificPresets.find(r => r.id === e.target.value) || sharedPresets.find(r => r.id === e.target.value)
                                  if (!preset) return
                                  applyValue(preset.pay_type, preset.percentage_rate, preset.rate_per_trip)
                                }} style={{ fontSize: 12, padding: '4px 5px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', width: 130 }}>
                                  <option value="">Preset…</option>
                                  <option value="__general__">General ({computeModal.pay_type === 'percentage' ? `${computeModal.percentage_rate}%` : 'driver default'})</option>
                                  {specificPresets.map(r => <option key={r.id} value={r.id}>{r.route || r.trip_code || 'Catch-all'} ({r.pay_type === 'percentage' ? `${r.percentage_rate}%` : `₱${fmt(r.rate_per_trip)}`})</option>)}
                                  {sharedPresets.map(r => <option key={r.id} value={r.id}>🌐 {r.route || r.trip_code || 'Catch-all'} ({r.pay_type === 'percentage' ? `${r.percentage_rate}%` : `₱${fmt(r.rate_per_trip)}`})</option>)}
                                </select>
                              )
                            })()}
                            <input type="number" value={t.amount} disabled={t.included === false} onChange={e => {
                              const val = e.target.value
                              setComputeDraft(d => {
                                const next = [...d.trip_breakdown]
                                next[idx] = { ...next[idx], amount: val }
                                return { ...d, trip_breakdown: next }
                              })
                            }} style={{ ...INPUT, width: 75, textAlign: 'right' }} />
                          </div>
                        </td>
                      </tr>
                    )})}</tbody>
                </table>
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700, marginTop: 6, fontSize: 14 }}>Gross: ₱{fmt(liveGross(computeDraft))}</div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Government Contributions <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>(kept as saved when editing — recalculate if trips changed)</span></div>
                <button onClick={() => {
                  const gross = liveGross(computeDraft)
                  setComputeDraft(d => ({ ...d,
                    sss_employee: lookupFlatBracket(sssBrackets, gross),
                    philhealth_employee: lookupRateBracket(philBrackets, gross),
                    hdmf_employee: lookupRateBracket(hdmfBrackets, gross, 'employee_cap'),
                    contribution_override: false,
                  }))
                }} style={{ padding: '4px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>↻ Recalculate from Gross</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <FormRow label="SSS"><input type="number" value={computeDraft.sss_employee} onChange={e => setComputeDraft(d => ({ ...d, sss_employee: e.target.value, contribution_override: true }))} style={INPUT} /></FormRow>
                <FormRow label="PhilHealth"><input type="number" value={computeDraft.philhealth_employee} onChange={e => setComputeDraft(d => ({ ...d, philhealth_employee: e.target.value, contribution_override: true }))} style={INPUT} /></FormRow>
                <FormRow label="HDMF"><input type="number" value={computeDraft.hdmf_employee} onChange={e => setComputeDraft(d => ({ ...d, hdmf_employee: e.target.value, contribution_override: true }))} style={INPUT} /></FormRow>
              </div>
            </div>

            {computeDraft.loan_deductions.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Loan Deductions</div>
                {computeDraft.loan_deductions.map((ld, i) => (
                  <div key={ld.loan_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                    <span>{ld.loan_type.toUpperCase()} Loan</span><span className="mono">₱{fmt(ld.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormRow label={`Cash Advance Deduction (balance: ₱${fmt(computeDraft.ca_available)})`}>
                <input type="number" value={computeDraft.ca_deduction} onChange={e => setComputeDraft(d => ({ ...d, ca_deduction: e.target.value }))} style={INPUT} />
              </FormRow>
              <FormRow label="Allowance-advance"><input type="number" value={computeDraft.extra_amount} onChange={e => setComputeDraft(d => ({ ...d, extra_amount: e.target.value }))} style={INPUT} /></FormRow>
            </div>
            {p(computeDraft.extra_amount) !== 0 && (
              <FormRow label="Reason"><input value={computeDraft.extra_reason} onChange={e => setComputeDraft(d => ({ ...d, extra_reason: e.target.value }))} style={INPUT} /></FormRow>
            )}

            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14, textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Net Pay</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>₱{fmt(computeNet(computeDraft))}</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setComputeModal(null); setComputeDraft(null) }} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={saveComputedEntry} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save Draft'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showBracketForm && (
        <Modal title={showBracketForm.editing ? 'Edit Bracket Row' : 'Add Bracket Row'} onClose={() => setShowBracketForm(null)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormRow label="Min Salary *"><input type="number" value={bracketForm.min_salary} onChange={e => setBracketForm(f => ({ ...f, min_salary: e.target.value }))} style={INPUT} /></FormRow>
              <FormRow label="Max Salary (blank = no upper bound)"><input type="number" value={bracketForm.max_salary} onChange={e => setBracketForm(f => ({ ...f, max_salary: e.target.value }))} style={INPUT} /></FormRow>
            </div>
            {showBracketForm.table === 'sss_brackets' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormRow label="Employee Share (₱)"><input type="number" value={bracketForm.employee_share} onChange={e => setBracketForm(f => ({ ...f, employee_share: e.target.value }))} style={INPUT} /></FormRow>
                <FormRow label="Employer Share (₱)"><input type="number" value={bracketForm.employer_share} onChange={e => setBracketForm(f => ({ ...f, employer_share: e.target.value }))} style={INPUT} /></FormRow>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: showBracketForm.table === 'hdmf_brackets' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 12 }}>
                <FormRow label="Employee Rate (%)"><input type="number" step="0.01" value={bracketForm.employee_rate} onChange={e => setBracketForm(f => ({ ...f, employee_rate: e.target.value }))} style={INPUT} /></FormRow>
                <FormRow label="Employer Rate (%)"><input type="number" step="0.01" value={bracketForm.employer_rate} onChange={e => setBracketForm(f => ({ ...f, employer_rate: e.target.value }))} style={INPUT} /></FormRow>
                {showBracketForm.table === 'hdmf_brackets' && (
                  <FormRow label="Employee Cap (₱, optional)"><input type="number" value={bracketForm.employee_cap} onChange={e => setBracketForm(f => ({ ...f, employee_cap: e.target.value }))} style={INPUT} /></FormRow>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowBracketForm(null)} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={saveBracket} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      <div id="driver-payroll-print-area">
        <PrintDriverPayroll drivers={activeDrivers} entries={entries} sigs={activeSigs} selectedCutoff={selectedCutoff}
          periodStart={periodStart} periodEnd={periodEnd} settings={settings} caRecords={caRecords} allHistory={allHistory} />
      </div>
      <style>{PRINT_STYLE}</style>

      <SignatoryDialog open={sigDialog} onClose={() => setSigDialog(false)}
        onPrint={(sigs) => {
          setSigDialog(false)
          if (pendingPrintFn) { pendingPrintFn(sigs); setPendingPrintFn(null) }
        }} settings={settings} profile={profile} docType="Driver Payroll" />
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}

// ── PRINT: DRIVER PAYROLL REGISTER (browser-print, matches Admin's layout) ──
function PrintDriverPayroll({ drivers, entries, sigs = [], selectedCutoff, periodStart, periodEnd, settings = {}, caRecords = [], allHistory = [] }) {
  const generatedAt = new Date().toLocaleString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })

  const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
  const address = settings.address || ''
  const contact = settings.contact || ''
  const email = settings.email || ''
  const vatTin = settings.vat_tin || ''

  // CA balance mirrors Admin's exact convention: advances - CA ledger
  // payments - payroll deductions from every entry up to & including this
  // cutoff, so the printed balance matches what the CA ledger itself shows.
  const getCaBalance = (driverId) => {
    const recs = caRecords.filter(r => r.driver_id === driverId)
    const totalAdvance = recs.filter(r => r.type === 'advance').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const totalCaLedgerPayments = recs.filter(r => r.type === 'payment').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const totalPayrollDeductions = allHistory
      .filter(e => e.driver_id === driverId && e.cutoff_date <= selectedCutoff)
      .reduce((s, e) => s + (parseFloat(e.ca_deduction) || 0), 0)
    return Math.max(0, totalAdvance - totalCaLedgerPayments - totalPayrollDeductions)
  }

  const pfmt = (v) => (parseFloat(v) || 0) > 0
    ? (parseFloat(v)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : ''
  const nfmt = (v) => (parseFloat(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const S = {
    page: { fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#000', padding: '10px 14px', background: '#fff' },
    companyName: { textAlign: 'center', fontWeight: 'bold', fontSize: 16, textTransform: 'uppercase', marginBottom: 2 },
    companyInfo: { textAlign: 'center', fontSize: 11, marginBottom: 1 },
    docTitle: { textAlign: 'center', fontWeight: 'bold', fontSize: 14, marginTop: 6, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.15em' },
    period: { textAlign: 'center', fontSize: 11, marginBottom: 8 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { border: '1px solid #555', padding: '2px 2px', textAlign: 'center', fontWeight: 'bold', fontSize: 13, background: '#e8e8e8', whiteSpace: 'nowrap' },
    thGreen: { border: '1px solid #555', padding: '2px 2px', textAlign: 'center', fontWeight: 'bold', fontSize: 13, background: '#c6efce', whiteSpace: 'nowrap' },
    thRed: { border: '1px solid #555', padding: '2px 2px', textAlign: 'center', fontWeight: 'bold', fontSize: 13, background: '#ffc7ce', whiteSpace: 'nowrap' },
    thBlue: { border: '1px solid #555', padding: '2px 2px', textAlign: 'center', fontWeight: 'bold', fontSize: 13, background: '#9dc3e6', whiteSpace: 'nowrap' },
    td: { border: '1px solid #888', padding: '2px 2px', textAlign: 'center', fontSize: 13, whiteSpace: 'nowrap' },
    tdL: { border: '1px solid #888', padding: '2px 4px', textAlign: 'left', fontSize: 13, fontWeight: '600', minWidth: 120, maxWidth: 160, wordBreak: 'break-word', whiteSpace: 'normal' },
    tdGreen: { border: '1px solid #888', padding: '2px 2px', textAlign: 'center', fontSize: 13, fontWeight: 'bold', background: '#e2efda', whiteSpace: 'nowrap' },
    tdRed: { border: '1px solid #888', padding: '2px 2px', textAlign: 'center', fontSize: 13, fontWeight: 'bold', background: '#fce4d6', whiteSpace: 'nowrap' },
    tdBlue: { border: '1px solid #888', padding: '2px 2px', textAlign: 'center', fontSize: 13, fontWeight: 'bold', background: '#dce6f1', whiteSpace: 'nowrap' },
    tdCA: { border: '1px solid #888', padding: '2px 2px', textAlign: 'center', fontSize: 13, color: '#c00000', whiteSpace: 'nowrap' },
  }

  const rows = drivers.map(d => {
    const entry = entries.find(e => e.driver_id === d.id)
    if (!entry) return null
    const breakdown = (entry.trip_breakdown || []).filter(t => t.included !== false)
    const dumpCount = breakdown.filter(t => t.trip_type === 'dump').length
    const pmCount = breakdown.filter(t => t.trip_type === 'pm').length
    const govLoan = (entry.loan_deductions || []).filter(l => l.loan_type === 'sss' || l.loan_type === 'hdmf').reduce((s, l) => s + p(l.amount), 0)
    const companyLoanAmt = (entry.loan_deductions || []).filter(l => l.loan_type === 'company').reduce((s, l) => s + p(l.amount), 0)
    const earn = p(entry.gross_trip_earnings) + p(entry.extra_amount)
    const ded = p(entry.sss_employee) + p(entry.philhealth_employee) + p(entry.hdmf_employee) + govLoan + companyLoanAmt + p(entry.ca_deduction)
    return { driver: d, entry, dumpCount, pmCount, earn, ded, net: earn - ded, govLoan, companyLoanAmt }
  }).filter(Boolean)

  const grandEarnings = rows.reduce((s, r) => s + r.earn, 0)
  const grandDeductions = rows.reduce((s, r) => s + r.ded, 0)
  const grandNet = rows.reduce((s, r) => s + r.net, 0)

  return (
    <div style={S.page}>
      <div style={S.companyName}>{companyName}</div>
      {address && <div style={S.companyInfo}>{address}</div>}
      {(contact || email) && <div style={S.companyInfo}>{[contact, email].filter(Boolean).join(' | ')}</div>}
      {vatTin && <div style={S.companyInfo}>TIN: {vatTin}</div>}

      <div style={S.docTitle}>DRIVER PAYROLL</div>
      <div style={S.period}>For the period: <strong>{fmtDate(periodStart)} – {fmtDate(periodEnd)}</strong> (cutoff {fmtDate(selectedCutoff)})</div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th} rowSpan={2}>#</th>
            <th style={{ ...S.th, textAlign: 'left', minWidth: 120, whiteSpace: 'nowrap' }} rowSpan={2}>DRIVER</th>
            <th style={S.th} colSpan={4}>EARNINGS</th>
            <th style={S.thGreen} rowSpan={2}>EARNING<br/>TOTAL</th>
            <th style={S.th} colSpan={6}>DEDUCTIONS</th>
            <th style={S.thRed} rowSpan={2}>DEDUCTION<br/>TOTAL</th>
            <th style={S.thBlue} rowSpan={2}>NET<br/>SALARY</th>
            <th style={S.th} rowSpan={2}>SIGNATURE<br/>&amp; DATE</th>
            <th style={{ ...S.th, color: '#c00000' }} rowSpan={2}>CA<br/>BALANCE</th>
          </tr>
          <tr>
            <th style={S.th}>DUMP<br/>TRIPS</th>
            <th style={S.th}>PM<br/>TRIPS</th>
            <th style={S.th}>TRIP<br/>EARNINGS</th>
            <th style={S.th}>ALLOW-<br/>ANCE</th>
            <th style={S.th}>CASH<br/>ADV</th>
            <th style={S.th}>PAG-IBIG<br/>LOAN</th>
            <th style={S.th}>PAG-IBIG<br/>PREM</th>
            <th style={S.th}>PHIC<br/>PREM</th>
            <th style={S.th}>PERSONAL<br/>LOAN</th>
            <th style={S.th}>SSS<br/>PREM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const caBalance = getCaBalance(r.driver.id)
            return (
              <tr key={r.driver.id}>
                <td style={S.td}>{i + 1}</td>
                <td style={S.tdL}>{r.driver.driver_name}</td>
                <td style={S.td}>{r.dumpCount || ''}</td>
                <td style={S.td}>{r.pmCount || ''}</td>
                <td style={S.td}>{pfmt(r.entry.gross_trip_earnings)}</td>
                <td style={S.td}>{pfmt(r.entry.extra_amount)}</td>
                <td style={S.tdGreen}>{nfmt(r.earn)}</td>
                <td style={S.td}>{pfmt(r.entry.ca_deduction)}</td>
                <td style={S.td}>{pfmt(r.govLoan)}</td>
                <td style={S.td}>{pfmt(r.entry.hdmf_employee)}</td>
                <td style={S.td}>{pfmt(r.entry.philhealth_employee)}</td>
                <td style={S.td}>{pfmt(r.companyLoanAmt)}</td>
                <td style={S.td}>{pfmt(r.entry.sss_employee)}</td>
                <td style={S.tdRed}>{nfmt(r.ded)}</td>
                <td style={S.tdBlue}>{nfmt(r.net)}</td>
                <td style={{ ...S.td, minWidth: 60 }}></td>
                <td style={S.tdCA}>{caBalance > 0 ? nfmt(caBalance) : '—'}</td>
              </tr>
            )
          })}
          <tr style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
            <td style={{ ...S.td, fontWeight: 'bold' }} colSpan={2}>GRAND TOTAL</td>
            <td style={S.td}>{rows.reduce((s, r) => s + r.dumpCount, 0)}</td>
            <td style={S.td}>{rows.reduce((s, r) => s + r.pmCount, 0)}</td>
            <td style={S.td}>{nfmt(rows.reduce((s, r) => s + p(r.entry.gross_trip_earnings), 0))}</td>
            <td style={S.td}>{nfmt(rows.reduce((s, r) => s + p(r.entry.extra_amount), 0))}</td>
            <td style={{ ...S.tdGreen, fontWeight: 'bold' }}>{nfmt(grandEarnings)}</td>
            <td style={S.td}>{nfmt(rows.reduce((s, r) => s + p(r.entry.ca_deduction), 0))}</td>
            <td style={S.td}>{nfmt(rows.reduce((s, r) => s + r.govLoan, 0))}</td>
            <td style={S.td}>{nfmt(rows.reduce((s, r) => s + p(r.entry.hdmf_employee), 0))}</td>
            <td style={S.td}>{nfmt(rows.reduce((s, r) => s + p(r.entry.philhealth_employee), 0))}</td>
            <td style={S.td}>{nfmt(rows.reduce((s, r) => s + r.companyLoanAmt, 0))}</td>
            <td style={S.td}>{nfmt(rows.reduce((s, r) => s + p(r.entry.sss_employee), 0))}</td>
            <td style={{ ...S.tdRed, fontWeight: 'bold' }}>{nfmt(grandDeductions)}</td>
            <td style={{ ...S.tdBlue, fontWeight: 'bold' }}>{nfmt(grandNet)}</td>
            <td style={S.td} colSpan={2}></td>
          </tr>
        </tbody>
      </table>

      {sigs.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, fontSize: 15 }}>
          {sigs.map((sig, i) => (
            <div key={i} style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontWeight: 'bold', fontSize: 15 }}>{sig.label}:</div>
              <div style={{ marginTop: 28, borderTop: '1px solid #000', paddingTop: 4, fontWeight: 'bold', textTransform: 'uppercase', fontSize: 15 }}>{sig.name}</div>
              <div style={{ fontSize: 13 }}>{sig.title}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 10, color: '#888', textAlign: 'right', borderTop: '0.5px solid #ccc', paddingTop: 4 }}>
        System-generated document · Printed: {generatedAt}
      </div>
    </div>
  )
}
