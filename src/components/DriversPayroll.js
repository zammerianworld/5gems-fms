import { useState, useEffect, useCallback } from 'react'
import DateInput from './DateInput'
import SignatoryDialog from './SignatoryDialog'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, fmt, fmtDate, logAudit } from '../lib/supabase'
import { buildPayslipDoc } from '../lib/payslipTemplate'

const p = (v) => parseFloat(v) || 0

const EMPTY_DRIVER = {
  driver_name: '', truck_id: '', sss_no: '', philhealth_no: '', hdmf_no: '',
  hire_date: '', pay_type: 'fixed', percentage_rate: '', notes: '', active: true,
}
const EMPTY_RATE = { driver_id: '', truck_type: 'Dump Truck', route: '', trip_code: '', pay_type: 'fixed', rate_per_trip: '', percentage_rate: '', notes: '' }
const EMPTY_LOAN = { driver_id: '', loan_type: 'sss', principal: '', amortization_per_cutoff: '', balance: '', date_issued: '', description: '' }

const todayStr = () => new Date().toISOString().slice(0, 10)
const monthStartStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

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

export default function DriversPayroll({ isAdmin, profile, showToast, settings }) {
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
  const [pendingPrintFn, setPendingPrintFn] = useState(null)
  const [pastPeriods, setPastPeriods] = useState([]) // distinct {period_start, period_end} pairs that already have entries

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
  const [computeDraft, setComputeDraft] = useState(null) // the editable computed entry before saving

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [dr, tr, rt, ln, ca, sb, pb, hb, en] = await Promise.all([
      supabase.from('drivers').select('*').order('driver_name'),
      supabase.from('trucks').select('id,plate,truck_type').order('plate'),
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

  // ── DRIVER ROSTER ─────────────────────────────────────────────────────
  const saveDriver = async () => {
    if (!driverForm.driver_name.trim()) { showToast('Driver name is required.', 'error'); return }
    setSaving(true)
    const payload = {
      driver_name: driverForm.driver_name.trim(),
      truck_id: driverForm.truck_id || null,
      sss_no: driverForm.sss_no, philhealth_no: driverForm.philhealth_no, hdmf_no: driverForm.hdmf_no,
      hire_date: driverForm.hire_date || null,
      pay_type: driverForm.pay_type,
      percentage_rate: p(driverForm.percentage_rate),
      notes: driverForm.notes, active: driverForm.active,
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
    if (!rateForm.driver_id) { showToast('Driver is required.', 'error'); return }
    if (rateForm.pay_type === 'percentage' ? !p(rateForm.percentage_rate) : !p(rateForm.rate_per_trip)) {
      showToast(rateForm.pay_type === 'percentage' ? 'Percentage is required.' : 'Rate per trip is required.', 'error'); return
    }
    setSaving(true)
    const payload = { ...rateForm, rate_per_trip: p(rateForm.rate_per_trip), percentage_rate: p(rateForm.percentage_rate) }
    const { error } = editingRateId
      ? await supabase.from('driver_rates').update(payload).eq('id', editingRateId)
      : await supabase.from('driver_rates').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Rate saved.'); setShowRateForm(false); setEditingRateId(null); setRateForm(EMPTY_RATE); fetchAll() }
    setSaving(false)
  }
  const deleteRate = async (id) => {
    if (!window.confirm('Delete this rate?')) return
    await supabase.from('driver_rates').delete().eq('id', id)
    fetchAll()
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
  useEffect(() => {
    (async () => {
      const [dt, pt] = await Promise.all([
        supabase.from('trips_dump').select('id,trip_date,truck_plate,route,weight_tons,rate_per_ton,driver_id').is('deleted_at', null).not('driver_id', 'is', null),
        supabase.from('trips_pm').select('id,trip_date,truck_plate,trip_code,supplier_amount,stripping_fee,driver_id').is('deleted_at', null).not('driver_id', 'is', null),
      ])
      setAllDumpTrips(dt.data || [])
      setAllPmTrips(pt.data || [])
    })()
  }, [])

  const alreadySweptTripIds = useCallback(() => {
    // Every trip_id that appears in ANY driver_payroll_entries.trip_breakdown,
    // regardless of cutoff — a trip is swept exactly once, ever.
    const ids = new Set()
    entries.forEach(e => (e.trip_breakdown || []).forEach(t => ids.add(t.trip_id)))
    return ids
  }, [entries])

  const [allEntriesEverTripIds, setAllEntriesEverTripIds] = useState(new Set())
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('driver_payroll_entries').select('trip_breakdown')
      const ids = new Set()
      ;(data || []).forEach(e => (e.trip_breakdown || []).forEach(t => ids.add(t.trip_id)))
      setAllEntriesEverTripIds(ids)
    })()
  }, [entries])

  const pendingTripsFor = (driverId) => {
    const swept = allEntriesEverTripIds
    const dRate = rates.filter(r => r.driver_id === driverId)
    const driver = drivers.find(d => d.id === driverId)
    // Prefer an exact route/trip_code match over a blank catch-all row —
    // pay type and rate/percentage both come from whichever rule actually
    // matched, so one driver can be fixed-rate on some routes and
    // percentage-based on others. Falls back to the driver's own default
    // pay_type/percentage_rate only when no rate rule matches at all.
    const matchRate = (truckType, key, val) => {
      const forType = dRate.filter(r => r.truck_type === truckType)
      return forType.find(r => r[key] === val) || forType.find(r => !r[key])
    }
    const resolve = (rateMatch, grossBasis) => {
      const payType = rateMatch?.pay_type || driver?.pay_type
      const pct = rateMatch ? p(rateMatch.percentage_rate) : p(driver?.percentage_rate)
      return payType === 'percentage' ? grossBasis * (pct / 100) : p(rateMatch?.rate_per_trip)
    }
    const dump = allDumpTrips.filter(t => t.driver_id === driverId && !swept.has(t.id)).map(t => {
      const rateMatch = matchRate('Dump Truck', 'route', t.route)
      const amount = resolve(rateMatch, (t.weight_tons || 0) * (t.rate_per_ton || 0))
      return { trip_id: t.id, trip_type: 'dump', trip_date: t.trip_date, label: t.route || t.truck_plate, amount }
    })
    const pm = allPmTrips.filter(t => t.driver_id === driverId && !swept.has(t.id)).map(t => {
      const rateMatch = matchRate('Prime Mover', 'trip_code', t.trip_code)
      const amount = resolve(rateMatch, (t.supplier_amount || 0) + (t.stripping_fee || 0))
      return { trip_id: t.id, trip_type: 'pm', trip_date: t.trip_date, label: t.trip_code || t.truck_plate, amount }
    })
    return [...dump, ...pm].sort((a, b) => (a.trip_date || '').localeCompare(b.trip_date || ''))
  }

  const openCompute = (driver) => {
    const trips = pendingTripsFor(driver.id)
    const gross = trips.reduce((s, t) => s + t.amount, 0)
    const sss = lookupFlatBracket(sssBrackets, gross)
    const phil = lookupRateBracket(philBrackets, gross)
    const hdmf = lookupRateBracket(hdmfBrackets, gross, 'employee_cap')
    const driverLoans = loans.filter(l => l.driver_id === driver.id && l.active && l.balance > 0)
    const loanDeductions = driverLoans.map(l => ({ loan_id: l.id, loan_type: l.loan_type, amount: Math.min(l.amortization_per_cutoff, l.balance) }))
    const driverCa = caRecords.filter(r => r.driver_id === driver.id)
    const caAdvance = driverCa.filter(r => r.type === 'advance').reduce((s, r) => s + p(r.amount), 0)
    const caPaid = driverCa.filter(r => r.type === 'payment').reduce((s, r) => s + p(r.amount), 0)
    const caPaidViaPayroll = entries.filter(e => e.driver_id === driver.id).reduce((s, e) => s + p(e.ca_deduction), 0)
    const caBalance = Math.max(0, caAdvance - caPaid - caPaidViaPayroll)

    setComputeModal(driver)
    setComputeDraft({
      trip_breakdown: trips, gross_trip_earnings: gross,
      sss_employee: sss, philhealth_employee: phil, hdmf_employee: hdmf,
      contribution_override: false,
      loan_deductions: loanDeductions,
      ca_deduction: 0, ca_available: caBalance,
      extra_amount: 0, extra_reason: '',
    })
  }

  const computeNet = (d) => {
    const totalLoan = (d.loan_deductions || []).reduce((s, l) => s + p(l.amount), 0)
    return p(d.gross_trip_earnings) - p(d.sss_employee) - p(d.philhealth_employee) - p(d.hdmf_employee) - totalLoan - p(d.ca_deduction) + p(d.extra_amount)
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
      gross_trip_earnings: computeDraft.gross_trip_earnings,
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
    }
    setSaving(false)
  }

  const lockEntry = async (entry) => {
    if (!window.confirm('Lock this entry? Once locked it can no longer be edited, and the payslip is finalized.')) return
    const { error } = await supabase.from('driver_payroll_entries').update({
      locked: true, locked_at: new Date().toISOString(), locked_by: profile?.id,
    }).eq('id', entry.id)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    // Deduct loan amortizations from balance now that this cutoff is final
    for (const ld of (entry.loan_deductions || [])) {
      const loan = loans.find(l => l.id === ld.loan_id)
      if (loan) await supabase.from('driver_loans').update({ balance: Math.max(0, loan.balance - ld.amount) }).eq('id', loan.id)
    }
    if (p(entry.ca_deduction) > 0) {
      const driver = drivers.find(d => d.id === entry.driver_id)
      await supabase.from('payroll_cash_advances').insert({
        driver_id: entry.driver_id, date: selectedCutoff, amount: entry.ca_deduction, type: 'payment',
        description: `Payroll deduction (${selectedCutoff})`,
      })
      logAudit('destructive', 'Locked', 'Driver Payroll', `${driver?.driver_name} · ${selectedCutoff}`, entry.id, profile?.id, profile?.full_name)
    }
    showToast('Entry locked. Payslip is now final.')
    fetchAll()
  }

  const activeDrivers = drivers.filter(d => d.active)
  const gross = (arr) => arr.reduce((s, e) => s + p(e.net_pay), 0)

  const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()

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
      doc.setFont(undefined, 'normal'); doc.setFontSize(6); doc.setTextColor(255, 30, 0)
      doc.text(s.title || '', slotX, sigY + 15, { align: 'center' })
      doc.setTextColor(0)
    })
  }

  const printRegister = () => {
    setPendingPrintFn(() => (sigs) => doPrintRegister(sigs))
    setSigDialog(true)
  }

  const doPrintRegister = (sigs) => {
    const rows = activeDrivers.map(d => {
      const entry = entries.find(e => e.driver_id === d.id)
      if (!entry) return null
      const breakdown = entry.trip_breakdown || []
      const dumpTrips = breakdown.filter(t => t.trip_type === 'dump')
      const pmTrips = breakdown.filter(t => t.trip_type === 'pm')
      const govLoan = (entry.loan_deductions || []).filter(l => l.loan_type === 'sss' || l.loan_type === 'hdmf').reduce((s, l) => s + p(l.amount), 0)
      const companyLoanAmt = (entry.loan_deductions || []).filter(l => l.loan_type === 'company').reduce((s, l) => s + p(l.amount), 0)
      const dedTotal = p(entry.sss_employee) + p(entry.philhealth_employee) + p(entry.hdmf_employee) + govLoan + companyLoanAmt + p(entry.ca_deduction)
      return {
        name: d.driver_name,
        dumpCount: dumpTrips.length, pmCount: pmTrips.length,
        gross: p(entry.gross_trip_earnings), extra: p(entry.extra_amount),
        earnTotal: p(entry.gross_trip_earnings) + p(entry.extra_amount),
        ca: p(entry.ca_deduction), govLoan, hdmfPrem: p(entry.hdmf_employee),
        philPrem: p(entry.philhealth_employee), sssLoan: companyLoanAmt, sssPrem: p(entry.sss_employee),
        dedTotal, net: p(entry.net_pay),
      }
    }).filter(Boolean)

    if (rows.length === 0) { showToast('No computed entries for this cutoff yet.', 'error'); return }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
    const W = 279.4, L = 10, R = 10

    // Orange header band with company name
    doc.setFillColor(255, 180, 160)
    doc.rect(0, 0, W, 14, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(0)
    doc.text(companyName, L, 10)

    let y = 20
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text('PAYROLL', L, y)
    doc.setFont('helvetica', 'bolditalic')
    doc.text(fmtDate(selectedCutoff), L + 20, y)

    y += 6
    doc.setFont('helvetica', 'normal')
    doc.text('Payroll for', L, y)
    doc.setFont('helvetica', 'bolditalic')
    doc.text(`${fmtDate(periodStart)} – ${fmtDate(periodEnd)}`, L + 20, y)
    doc.setFont('helvetica', 'normal')
    doc.text('for the period covering cut-off (from - to)', L + 65, y)

    y += 6

    const rowsOut = rows.map(r => [
      r.name, String(r.dumpCount || ''), String(r.pmCount || ''), `PHP ${fmt(r.gross)}`, r.extra ? `PHP ${fmt(r.extra)}` : '',
      `PHP ${fmt(r.earnTotal)}`,
      r.ca ? `${fmt(r.ca)}` : '', r.govLoan ? `${fmt(r.govLoan)}` : '', r.hdmfPrem ? `${fmt(r.hdmfPrem)}` : '',
      r.philPrem ? `${fmt(r.philPrem)}` : '', r.sssLoan ? `${fmt(r.sssLoan)}` : '', r.sssPrem ? `${fmt(r.sssPrem)}` : '', '',
      `PHP ${fmt(r.dedTotal)}`, `PHP ${fmt(r.net)}`, '', '',
    ])

    const totals = rows.reduce((s, r) => ({
      dumpCount: s.dumpCount + r.dumpCount, pmCount: s.pmCount + r.pmCount, gross: s.gross + r.gross, extra: s.extra + r.extra,
      earnTotal: s.earnTotal + r.earnTotal, ca: s.ca + r.ca, govLoan: s.govLoan + r.govLoan, hdmfPrem: s.hdmfPrem + r.hdmfPrem,
      philPrem: s.philPrem + r.philPrem, sssLoan: s.sssLoan + r.sssLoan, sssPrem: s.sssPrem + r.sssPrem, dedTotal: s.dedTotal + r.dedTotal, net: s.net + r.net,
    }), { dumpCount: 0, pmCount: 0, gross: 0, extra: 0, earnTotal: 0, ca: 0, govLoan: 0, hdmfPrem: 0, philPrem: 0, sssLoan: 0, sssPrem: 0, dedTotal: 0, net: 0 })

    autoTable(doc, {
      startY: y, margin: { left: L, right: R },
      head: [
        [
          { content: '', colSpan: 1 },
          { content: 'EARNING', colSpan: 5, styles: { halign: 'center', fillColor: [255, 180, 160], textColor: 0 } },
          { content: '', colSpan: 1 },
          { content: 'DEDUCTION', colSpan: 7, styles: { halign: 'center', fillColor: [255, 180, 160], textColor: 0 } },
          { content: '', colSpan: 3 },
        ],
        ['Driver', 'Dump\nTrips', 'PM\nTrips', 'Trip\nEarnings', 'Extra Adj.', 'Earning\nTotal',
          'Cash\nAdvance', 'Pag-ibig\nLoan', 'Pag-ibig\nPremium', 'PHIC\nPremium', 'Personal\nLoan', 'SSS\nPremium', 'SSS\nHelper',
          'Deduction\nTotal', 'Net\nSalary', 'Signature', 'Date'],
      ],
      body: rowsOut,
      foot: [[
        'Grand Total', String(totals.dumpCount), String(totals.pmCount), `PHP ${fmt(totals.gross)}`, totals.extra ? `PHP ${fmt(totals.extra)}` : '',
        `PHP ${fmt(totals.earnTotal)}`,
        totals.ca ? fmt(totals.ca) : '', totals.govLoan ? fmt(totals.govLoan) : '', totals.hdmfPrem ? fmt(totals.hdmfPrem) : '',
        totals.philPrem ? fmt(totals.philPrem) : '', totals.sssLoan ? fmt(totals.sssLoan) : '', totals.sssPrem ? fmt(totals.sssPrem) : '', '',
        `PHP ${fmt(totals.dedTotal)}`, `PHP ${fmt(totals.net)}`, '', '',
      ]],
      styles: { fontSize: 6.5, cellPadding: 1.3, halign: 'center', valign: 'middle' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold', fontSize: 6.5, lineWidth: 0.1, lineColor: [0, 0, 0] },
      footStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold', fontSize: 7, lineWidth: 0.2, lineColor: [0, 0, 0] },
      bodyStyles: { lineWidth: 0.1, lineColor: [180, 180, 180] },
    })

    // ── Signature blocks — matches the reference's spread-out, boxed style ──
    y = doc.lastAutoTable.finalY + 14
    if (sigs && sigs.length > 0) {
      const perCol = (W - L - R) / Math.min(sigs.length, 4)
      sigs.forEach((s, idx) => {
        const col = idx % 4
        const row = Math.floor(idx / 4)
        const x = L + col * perCol
        const rowY = y + row * 22
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0)
        doc.text(s.label + ':', x, rowY)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
        doc.text((s.name || '').toUpperCase(), x, rowY + 10)
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(80)
        doc.text(s.title || '', x, rowY + 15)
        doc.setTextColor(0)
      })
    }

    doc.save(`Driver-Payroll-Register-${selectedCutoff}.pdf`)
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
      no: 1,
      month: periodLabel,
      date: fmtDate(selectedCutoff),
      employeeName: driver.driver_name,
      companyName, companyAddress: '',
      salary: p(entry.gross_trip_earnings),
      overtime: 0,
      // Extra/adjustment is additive to pay for drivers — folded into
      // Allowance so it's reflected in the total rather than dropped.
      allowance: p(entry.extra_amount),
      tripBreakdown: (entry.trip_breakdown || []).map(t => ({ date: fmtDate(t.trip_date), label: t.label, amount: t.amount })),
      deductions: [
        { label: 'SSS Premium', amount: p(entry.sss_employee) },
        { label: 'Philhealth', amount: p(entry.philhealth_employee) },
        { label: 'Pag-ibig Fund', amount: p(entry.hdmf_employee) },
        { label: 'Withholding Tax', amount: 0 },
        { label: 'Pag-ibig/SSS Loan', amount: govLoan },
        { label: 'Personal Loan', amount: companyLoan },
        { label: 'Cash Advance', amount: p(entry.ca_deduction) },
        { label: 'SSS HELPER', amount: 0 },
      ],
    })

    doc._pendingSigY = doc._payslipEndY + 10
    addSigsToDoc(doc, sigs, 215.9)
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
  const deleteBracket = async (table, id) => {
    if (!window.confirm('Delete this bracket row?')) return
    await supabase.from(table).delete().eq('id', id)
    fetchAll()
  }


  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading drivers…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { id: 'payroll', label: '📋 Payroll Register' },
            { id: 'roster', label: '🚛 Roster' },
            { id: 'rates', label: '💰 Rates' },
            { id: 'loans', label: '🏦 Loans' },
            { id: 'brackets', label: '⚙️ Contribution Brackets' },
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
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>From</span>
            <DateInput value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={{ ...INPUT, width: 150 }} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>To</span>
            <DateInput value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={{ ...INPUT, width: 150 }} />
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
                      <td style={TD}>{entry ? (entry.trip_breakdown || []).length : pending.length}</td>
                      <td style={TD} className="mono">₱{fmt(entry ? entry.gross_trip_earnings : pending.reduce((s, t) => s + t.amount, 0))}</td>
                      <td style={TD} className="mono">{entry ? `₱${fmt(entry.net_pay)}` : '—'}</td>
                      <td style={TD}>{entry?.locked
                        ? <span style={{ fontSize: 11, background: '#f0fdf4', color: '#16a34a', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>🔒 Locked</span>
                        : entry
                          ? <span style={{ fontSize: 11, background: '#fffbeb', color: '#d97706', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Draft</span>
                          : <span style={{ fontSize: 11, color: 'var(--muted)' }}>Not computed</span>}
                      </td>
                      <td style={TD}>
                        {entry?.locked ? (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Final</span>
                            <button onClick={() => printPayslip(d, entry)} style={ActionBtn('#334155')}>🖨️ Payslip</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <button onClick={() => openCompute(d)} style={ActionBtn('#3b82f6')}>{entry ? 'Recompute' : 'Compute'}</button>
                            {entry && <button onClick={() => printPayslip(d, entry)} style={ActionBtn('#334155')}>🖨️ Preview</button>}
                            {entry && isAdmin && <button onClick={() => lockEntry(entry)} style={ActionBtn('#16a34a')}>🔒 Lock</button>}
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
          {isAdmin && (
            <button onClick={() => { setEditingDriverId(null); setDriverForm(EMPTY_DRIVER); setShowDriverForm(true) }}
              style={{ marginBottom: 14, padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add Driver</button>
          )}
          <div style={{ display: 'grid', gap: 10 }}>
            {drivers.map(d => (
              <div key={d.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{d.driver_name}</span>
                    {!d.active && <span style={{ fontSize: 10, background: '#fef2f2', color: '#dc2626', padding: '2px 6px', borderRadius: 4 }}>INACTIVE</span>}
                    <span style={{ fontSize: 10, background: 'var(--bg)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 4 }}>Default: {d.pay_type === 'percentage' ? `${d.percentage_rate}% of trip` : 'Fixed rate'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Truck: {trucks.find(t => t.id === d.truck_id)?.plate || '— unassigned —'} {d.hire_date && `· Hired ${fmtDate(d.hire_date)}`}</div>
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
                    <td style={{ ...TD, textAlign: 'left' }}>{drivers.find(d => d.id === r.driver_id)?.driver_name || '—'}</td>
                    <td style={TD}>{r.truck_type}</td>
                    <td style={TD}>{r.route || r.trip_code || 'Any'}</td>
                    <td style={TD}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: r.pay_type === 'percentage' ? '#f5f3ff' : '#eff6ff', color: r.pay_type === 'percentage' ? '#7c3aed' : '#2563eb' }}>
                        {r.pay_type === 'percentage' ? '% Percentage' : 'Fixed'}
                      </span>
                    </td>
                    <td style={TD} className="mono">{r.pay_type === 'percentage' ? `${r.percentage_rate}%` : `₱${fmt(r.rate_per_trip)}`}</td>
                    <td style={TD}>{isAdmin && <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button onClick={() => { setEditingRateId(r.id); setRateForm({ ...r, rate_per_trip: String(r.rate_per_trip), percentage_rate: String(r.percentage_rate || '') }); setShowRateForm(true) }} style={ActionBtn('#3b82f6')}>✏️</button>
                      <button onClick={() => deleteRate(r.id)} style={ActionBtn('#ef4444')}>🗑️</button>
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
                    <td style={{ ...TD, color: l.balance > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }} className="mono">₱{fmt(l.balance)}</td>
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
                          <button onClick={() => deleteBracket(section.table, r.id)} style={ActionBtn('#ef4444')}>🗑️</button>
                        </div></td>}
                      </tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── MODALS ── */}
      {showDriverForm && (
        <Modal title={editingDriverId ? 'Edit Driver' : 'Add Driver'} onClose={() => setShowDriverForm(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <FormRow label="Driver Name *"><input value={driverForm.driver_name} onChange={e => setDriverForm(f => ({ ...f, driver_name: e.target.value }))} style={INPUT} /></FormRow>
            <FormRow label="Assigned Truck">
              <select value={driverForm.truck_id} onChange={e => setDriverForm(f => ({ ...f, truck_id: e.target.value }))} style={INPUT}>
                <option value="">— None —</option>
                {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
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
            <FormRow label="Hire Date"><DateInput value={driverForm.hire_date} onChange={e => setDriverForm(f => ({ ...f, hire_date: e.target.value }))} style={INPUT} /></FormRow>
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
            <FormRow label="Driver *">
              <select value={rateForm.driver_id} onChange={e => setRateForm(f => ({ ...f, driver_id: e.target.value }))} style={INPUT}>
                <option value="">— Select driver —</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.driver_name}</option>)}
              </select>
            </FormRow>
            <FormRow label="Truck Type">
              <select value={rateForm.truck_type} onChange={e => setRateForm(f => ({ ...f, truck_type: e.target.value, route: '', trip_code: '' }))} style={INPUT}>
                <option value="Dump Truck">Dump Truck</option><option value="Prime Mover">Prime Mover</option>
              </select>
            </FormRow>
            {rateForm.truck_type === 'Dump Truck' ? (
              <FormRow label="Route (blank = any route)"><input value={rateForm.route} onChange={e => setRateForm(f => ({ ...f, route: e.target.value }))} placeholder="e.g. CDO-Davao" style={INPUT} /></FormRow>
            ) : (
              <FormRow label="Trip Code (blank = any)"><input value={rateForm.trip_code} onChange={e => setRateForm(f => ({ ...f, trip_code: e.target.value }))} placeholder="e.g. Hustling PSACC" style={INPUT} /></FormRow>
            )}
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
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Trip Earnings ({computeDraft.trip_breakdown.length} trip{computeDraft.trip_breakdown.length !== 1 ? 's' : ''})</div>
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: 'var(--bg)' }}><th style={TH}>Date</th><th style={{ ...TH, textAlign: 'left' }}>Trip</th><th style={TH}>Amount</th></tr></thead>
                  <tbody>{computeDraft.trip_breakdown.length === 0 ? <tr><td colSpan={3} style={{ textAlign: 'center', padding: 16, color: 'var(--muted)' }}>No unpaid trips found for this driver.</td></tr>
                    : computeDraft.trip_breakdown.map(t => <tr key={t.trip_id} style={{ borderBottom: '1px solid var(--border)' }}><td style={TD}>{fmtDate(t.trip_date)}</td><td style={{ ...TD, textAlign: 'left' }}>{t.label}</td><td style={TD} className="mono">₱{fmt(t.amount)}</td></tr>)}</tbody>
                </table>
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700, marginTop: 6, fontSize: 14 }}>Gross: ₱{fmt(computeDraft.gross_trip_earnings)}</div>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Government Contributions <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>(auto-computed — override if needed)</span></div>
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
              <FormRow label="Extra / Adjustment"><input type="number" value={computeDraft.extra_amount} onChange={e => setComputeDraft(d => ({ ...d, extra_amount: e.target.value }))} style={INPUT} /></FormRow>
            </div>
            {p(computeDraft.extra_amount) !== 0 && (
              <FormRow label="Reason for Extra"><input value={computeDraft.extra_reason} onChange={e => setComputeDraft(d => ({ ...d, extra_reason: e.target.value }))} style={INPUT} /></FormRow>
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

      <SignatoryDialog open={sigDialog} onClose={() => setSigDialog(false)}
        onPrint={(sigs) => {
          setSigDialog(false)
          if (pendingPrintFn) { pendingPrintFn(sigs); setPendingPrintFn(null) }
        }} settings={settings} profile={profile} docType="Driver Payroll" />
    </div>
  )
}
