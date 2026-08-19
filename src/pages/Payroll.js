import { useState, useEffect, useCallback, useRef } from 'react'
import DateInput from '../components/DateInput'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, fmt, fmtDate, logAudit } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'
import SignatoryDialog from '../components/SignatoryDialog'

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const EMPTY_EMPLOYEE = {
  full_name: '', position: '', basic_rate_monthly: '', allowance_monthly: '',
  sss_employee: '', sss_employer: '', philhealth_employee: '', philhealth_employer: '',
  hdmf_employee: '', hdmf_employer: '', is_active: true, notes: ''
}

const EMPTY_ENTRY = {
  employee_id: '', cutoff_date: '', basic_days: '13', basic_rate: '',
  overtime_hours: '', overtime_rate: '50', hazard_rate: '',
  basic_salary: '', overtime_pay: '', rest_day_duty: '',
  salary_adjustment: '', allowance: '',
  cash_advance_deduction: '', hdmf_loan: '', hdmf_premium: '',
  philhealth_premium: '', sss_loan: '', sss_premium: '',
  notes: ''
}

const EMPTY_CA = {
  employee_id: '', date: '', amount: '', description: '', type: 'advance'
}

const currentCutoffDate = () => {
  const now = new Date()
  const day = now.getDate()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return day <= 15
    ? `${y}-${m}-15`
    : `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}`
}

const p = (v) => parseFloat(v) || 0

// ── PRINT STYLES ───────────────────────────────────────────────────────────
const PRINT_STYLE = `
  #payroll-print-area { display: none; }
  @media print {
    body * { visibility: hidden !important; }
    #payroll-print-area { display: block !important; }
    #payroll-print-area, #payroll-print-area * { visibility: visible !important; }
    #payroll-print-area { position: fixed; left: 0; top: 0; width: 100%; }
    #payroll-print-area table { font-size: 13px !important; }
    #payroll-print-area th, #payroll-print-area td { font-size: 13px !important; }
    @page { size: letter landscape; margin: 8mm 8mm; }
  }
`

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function Payroll() {
  const { isAdmin, profile } = useAuth()
  const { toast, showToast } = useToast()

  // ── DATA STATE ──────────────────────────────────────────────────────────
  const [employees, setEmployees] = useState([])
  const [entries, setEntries] = useState([])       // payroll_entries for selected cutoff
  const [allPayrollEntries, setAllPayrollEntries] = useState([]) // all cutoffs, for CA balance calc
  const [caRecords, setCaRecords] = useState([])   // all cash_advance_records
  const [settings, setSettings] = useState({})
  const [sigDialog, setSigDialog] = useState(false)
  const [activeSigs, setActiveSigs] = useState([])

  // ── UI STATE ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [entriesLoading, setEntriesLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [cutoffLocked, setCutoffLocked] = useState(false)
  const [pinUnlockModal, setPinUnlockModal] = useState(null)
  const [pinUnlockInput, setPinUnlockInput] = useState('')
  const [pinUnlockError, setPinUnlockError] = useState('')
  const [pinUnlocking, setPinUnlocking] = useState(false)
  const [activeTab, setActiveTab] = useState('payroll')  // 'payroll' | 'employees' | 'cash-advance' | '13th-month' | 'payslip'
  const EMPTY_CUTOFF = { period_from:'', period_to:'', pay_date:'', basic_salary:'', allowance:'', overtime_pay:'', rest_day:'', holiday_pay:'', salary_adjustment:'', other_earnings:'' }
  const EMPTY_PAYSLIP = {
    employee_name: '', position: '',
    cutoffs: Array(6).fill(null).map(() => ({...EMPTY_CUTOFF})),
    sss: '', philhealth: '', hdmf: '', sss_loan: '', hdmf_loan: '', ca_deduction: '', other_deductions: '',
  }
  const [payslipForm, setPayslipForm] = useState(EMPTY_PAYSLIP)
  const [payslipDrafts, setPayslipDrafts] = useState([])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [currentDraftId, setCurrentDraftId] = useState(null)
  const updateCutoff = (idx, key, val) => setPayslipForm(f => {
    const cutoffs = f.cutoffs.map((c,i) => i===idx ? {...c, [key]: val} : c)
    return {...f, cutoffs}
  })
  const [thirteenthYear, setThirteenthYear] = useState(new Date().getFullYear())
  const [thirteenthManual, setThirteenthManual] = useState({})
  const [thirteenthEmps, setThirteenthEmps] = useState([])
  const [savingManual, setSavingManual] = useState(false)
  const [thirteenthLoading, setThirteenthLoading] = useState(false)
  const [thirteenthEntries, setThirteenthEntries] = useState([])
  const [selectedCutoff, setSelectedCutoff] = useState(currentCutoffDate)
  const [confirmModal, setConfirmModal] = useState(null)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  // Employee management
  const [showEmpForm, setShowEmpForm] = useState(false)
  const [editingEmpId, setEditingEmpId] = useState(null)
  const [empForm, setEmpForm] = useState(EMPTY_EMPLOYEE)

  // Payroll entry form
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState(null)
  const editingEntryIdRef = useRef(null)
  const [entryForm, setEntryForm] = useState(EMPTY_ENTRY)
  const [entryAutoCalc, setEntryAutoCalc] = useState(true)

  // Cash advance
  const [showCaForm, setShowCaForm] = useState(false)
  const [editingCaId, setEditingCaId] = useState(null)
  const [caForm, setCaForm] = useState(EMPTY_CA)
  const [caFilterEmp, setCaFilterEmp] = useState('all')

  const printRef = useRef(null)

  // ── FETCH ───────────────────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    try {
      const { data } = await supabase.from('payroll_employees').select('*').order('full_name')
      setEmployees(data || [])
    } catch (e) { console.warn('fetchEmployees:', e.message) }
  }, [])

  const fetchEntries = useCallback(async (cutoff) => {
    setEntriesLoading(true)
    try {
      const { data } = await supabase
        .from('payroll_entries')
        .select('*, payroll_employees(full_name, position)')
        .eq('cutoff_date', cutoff)
        .order('created_at')
      setEntries(data || [])
      return data || []
    } catch (e) { console.warn('fetchEntries:', e.message); return [] }
    finally { setEntriesLoading(false) }
  }, [])

  const fetchAllPayrollEntries = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('payroll_entries')
        .select('employee_id, cutoff_date, cash_advance_deduction')
      setAllPayrollEntries(data || [])
    } catch (e) { console.warn('fetchAllPayrollEntries:', e.message) }
  }, [])

  const fetchCaRecords = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('payroll_cash_advances')
        .select('*, payroll_employees(full_name)')
        .order('date', { ascending: false })
      setCaRecords(data || [])
    } catch (e) { console.warn('fetchCaRecords:', e.message) }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await supabase.from('company_settings').select('*').eq('id', 1).maybeSingle()
      if (data) setSettings(data)
    } catch (e) { console.warn('fetchSettings:', e.message) }
  }, [])

  // On mount: fetch everything including entries for initial cutoff in parallel
  useEffect(() => {
    setLoading(true)
    setEntriesLoading(true)
    Promise.all([
      fetchEmployees(),
      fetchCaRecords(),
      fetchSettings(),
      fetchAllPayrollEntries(),
      fetchEntries(selectedCutoff),
    ]).finally(() => setLoading(false))
  }, [])

  const fetch13thData = useCallback(async (year) => {
    setThirteenthLoading(true)
    try {
      const [entriesRes, manualRes, empsRes] = await Promise.all([
        supabase.from('payroll_entries').select('employee_id, cutoff_date, basic_rate, basic_days').order('cutoff_date'),
        supabase.from('payroll_13th_manual').select('*').eq('year', year).then(r => r.error ? { data: [] } : r),
        supabase.from('payroll_employees').select('id, full_name, position').order('full_name')
      ])
      setThirteenthEntries(entriesRes.data || [])
      setThirteenthEmps(empsRes.data || [])
      const manualMap = {}
      ;(manualRes.data || []).forEach(r => {
        const k = String(r.employee_id)
        if (!manualMap[k]) manualMap[k] = {}
        manualMap[k][r.month] = String(r.amount)
      })
      // Merge DB values with any locally typed values not yet saved
      setThirteenthManual(prev => {
        const merged = { ...manualMap }
        Object.entries(prev).forEach(([empId, months]) => {
          if (!merged[empId]) merged[empId] = {}
          Object.entries(months).forEach(([mo, val]) => {
            if (!merged[empId][mo] && parseFloat(val) > 0) merged[empId][mo] = val
          })
        })
        return merged
      })
    } catch(e) {
      console.error('fetch13thData error:', e)
      showToast('Error loading 13th month data.', 'error')
    }
    setThirteenthLoading(false)
  }, [showToast])

  const saveManualEntry = async (empId, month, value, year) => {
    const amount = parseFloat(value) || 0
    await supabase.from('payroll_13th_manual').delete().eq('employee_id', empId).eq('year', year).eq('month', month)
    if (amount > 0) await supabase.from('payroll_13th_manual').insert({ employee_id: empId, year: parseInt(year), month, amount })
  }

  const saveAllManual = async () => {
    setSavingManual(true)
    const totalEntries = Object.values(thirteenthManual).reduce((s, mo) =>
      s + Object.values(mo).filter(v => parseFloat(String(v).replace(/,/g,'')) > 0).length, 0)
    if (totalEntries === 0) {
      showToast('No values entered. Type amounts in the white input cells first.', 'error')
      setSavingManual(false); return
    }
    let saved = 0; let errors = 0
    const { data: validEmps } = await supabase.from('payroll_employees').select('id')
    const validIds = new Set((validEmps||[]).map(e => String(e.id)))
    for (const [empId, moData] of Object.entries(thirteenthManual)) {
      if (!validIds.has(empId)) { console.warn('Employee ID not found:', empId); errors++; continue }
      for (const [month, val] of Object.entries(moData)) {
        const amount = parseFloat(String(val).replace(/,/g,'')) || 0
        try {
          await supabase.from('payroll_13th_manual').delete()
            .eq('employee_id', empId).eq('year', parseInt(thirteenthYear)).eq('month', month)
          if (amount > 0) {
            const { error } = await supabase.from('payroll_13th_manual').insert({
              employee_id: empId, year: parseInt(thirteenthYear), month, amount
            })
            if (error) { console.error('Insert error:', error.message, 'empId:', empId, 'month:', month); errors++ }
            else saved++
          } else saved++
        } catch(e) { console.error('Save error:', e); errors++ }
      }
    }
    if (errors > 0) showToast('Saved ' + saved + ', ' + errors + ' failed. Check browser console.', 'error')
    else if (saved > 0) showToast(saved + ' manual entr' + (saved===1?'y':'ies') + ' saved.')
    else showToast('No entries to save.')
    await fetch13thData(thirteenthYear)
    setSavingManual(false)
  }

  const handle13thExportExcel = () => {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const empMap = {}
    thirteenthEmps.forEach(e => { empMap[String(e.id)] = { name: e.full_name, position: e.position, earned: {} } })
    thirteenthEntries.filter(en => (en.cutoff_date||'').slice(0,4) === String(thirteenthYear)).forEach(en => {
      const k = String(en.employee_id); if (!empMap[k]) return
      const mo = months[parseInt((en.cutoff_date||'').slice(5,7),10)-1]
      const earned = (parseFloat(String(en.basic_rate||'0').replace(/,/g,''))||0) * (parseFloat(String(en.basic_days||'0').replace(/,/g,''))||0)
      if (!empMap[k].earned[mo]) empMap[k].earned[mo] = 0
      empMap[k].earned[mo] += earned
    })
    const rows = Object.values(empMap)
    const header = ['Employee', 'Position', ...monthNames, 'Total Earned', '13th Month Pay']
    const data = rows.map(emp => {
      const manual = thirteenthManual[Object.keys(empMap).find(k => empMap[k] === emp)] || {}
      let total = 0
      const cells = months.map(mo => {
        const sys = emp.earned[mo] || 0
        const man = parseFloat(String(manual[mo]||'0').replace(/,/g,'')) || 0
        const val = sys > 0 ? sys : man
        total += val
        return Math.round(val * 100) / 100
      })
      return [emp.name, emp.position, ...cells, Math.round(total * 100) / 100, Math.round(total / 12 * 100) / 100]
    })
    const totals = ['TOTAL', '', ...months.map((_,i) => data.reduce((s,r) => s + (r[i+2]||0), 0))]
    const totalEarned = data.reduce((s,r) => s + r[r.length-2], 0)
    const total13th = data.reduce((s,r) => s + r[r.length-1], 0)
    totals.push(Math.round(totalEarned * 100) / 100, Math.round(total13th * 100) / 100)
    const ws = XLSX.utils.aoa_to_sheet([
      [(settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()],
      [`13th Month Pay — ${thirteenthYear}`],
      ['Computed per PD 851: Total Basic Salary Earned ÷ 12'],
      [],
      header,
      ...data,
      [],
      totals
    ])
    ws['!cols'] = [{ wch: 28 }, { wch: 18 }, ...monthNames.map(() => ({ wch: 10 })), { wch: 14 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '13th Month Pay')
    XLSX.writeFile(wb, `FMS-13thMonth-${thirteenthYear}.xlsx`)
  }

  const handle13thPrint = () => {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const empMap = {}
    thirteenthEmps.forEach(e => { empMap[String(e.id)] = { id: String(e.id), name: e.full_name, position: e.position, earned: {} } })
    thirteenthEntries.filter(en => (en.cutoff_date||'').slice(0,4) === String(thirteenthYear)).forEach(en => {
      const k = String(en.employee_id); if (!empMap[k]) return
      const mo = months[parseInt((en.cutoff_date||'').slice(5,7),10)-1]
      const earned = (parseFloat(String(en.basic_rate||'0').replace(/,/g,''))||0) * (parseFloat(String(en.basic_days||'0').replace(/,/g,''))||0)
      if (!empMap[k].earned[mo]) empMap[k].earned[mo] = 0
      empMap[k].earned[mo] += earned
    })
    const rows = Object.values(empMap)
    const f2 = n => Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
    doc.setFontSize(13); doc.setFont(undefined,'bold')
    doc.text((settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase(), doc.internal.pageSize.width/2, 15, { align:'center' })
    doc.setFontSize(11); doc.setFont(undefined,'normal')
    doc.text(`13th Month Pay — ${thirteenthYear}`, doc.internal.pageSize.width/2, 22, { align:'center' })
    doc.setFontSize(8)
    doc.text('Computed per PD 851: Total Basic Salary Earned ÷ 12', doc.internal.pageSize.width/2, 28, { align:'center' })
    const tableData = rows.map(emp => {
      const manual = thirteenthManual[emp.id] || {}
      let total = 0
      const cells = months.map(mo => {
        const sys = emp.earned[mo] || 0
        const man = parseFloat(String(manual[mo]||'0').replace(/,/g,'')) || 0
        const val = sys > 0 ? sys : man
        total += val
        return val > 0 ? f2(val) : '—'
      })
      return [emp.name, emp.position, ...cells, f2(total), f2(total/12)]
    })
    autoTable(doc, {
      startY: 32,
      head: [['Employee', 'Position', ...monthNames, 'Total Earned', '13th Month']],
      body: tableData,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30,41,59], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 22 } },
      didParseCell: d => { if (d.column.index >= 2) d.cell.styles.halign = 'right' }
    })
    const finalY = doc.lastAutoTable.finalY + 6
    doc.setFontSize(8); doc.setFont(undefined,'italic')
    doc.text('Note: Green = from payroll system. White = manually entered.', 14, finalY)
    doc.save(`FMS-13thMonth-${thirteenthYear}.pdf`)
  }

  useEffect(() => { if (activeTab === '13th-month') fetch13thData(thirteenthYear) }, [activeTab, thirteenthYear, fetch13thData])

  // Re-fetch entries when cutoff changes (skip mount — handled above)
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    fetchEntries(selectedCutoff)
  }, [selectedCutoff])

  // Check lock status when entries load
  useEffect(() => {
    if (entries.length > 0) {
      setCutoffLocked(entries.some(e => e.locked_at !== null))
    } else {
      setCutoffLocked(false)
    }
  }, [entries])

  // ── EMPLOYEE CA BALANCE ─────────────────────────────────────────────────
  // advances - CA ledger payments - all payroll deductions across all cutoffs
  const getCaBalance = useCallback((employeeId) => {
    const recs = caRecords.filter(r => r.employee_id === employeeId)
    const totalAdvance = recs.filter(r => r.type === 'advance').reduce((s, r) => s + p(r.amount), 0)
    const totalCaLedgerPayments = recs.filter(r => r.type === 'payment').reduce((s, r) => s + p(r.amount), 0)
    const totalPayrollDeductions = allPayrollEntries
      .filter(pe => pe.employee_id === employeeId)
      .reduce((s, pe) => s + p(pe.cash_advance_deduction), 0)
    return Math.max(0, totalAdvance - totalCaLedgerPayments - totalPayrollDeductions)
  }, [caRecords, allPayrollEntries])

  // ── AUTO-CALC ENTRY ─────────────────────────────────────────────────────
  const autoCalcEntry = useCallback((form) => {
    if (!form.employee_id) return form
    const emp = employees.find(e => e.id === form.employee_id)
    if (!emp) return form
    // Basic salary: days * (monthly_rate / 26)
    const dailyRate = p(emp.basic_rate_monthly) / 26
    const basicSalary = p(form.basic_days) * dailyRate
    const overtimePay = p(form.overtime_hours) * p(form.overtime_rate)
    // Default premium deductions from employee record
    return {
      ...form,
      basic_rate: dailyRate.toFixed(2),
      basic_salary: basicSalary.toFixed(2),
      overtime_pay: overtimePay.toFixed(2),
      allowance: (p(emp.allowance_monthly) / 2).toFixed(2),
      sss_premium: (p(emp.sss_employee) / 2).toFixed(2),
      philhealth_premium: (p(emp.philhealth_employee) / 2).toFixed(2),
      hdmf_premium: (p(emp.hdmf_employee) / 2).toFixed(2),
    }
  }, [employees])

  // ── DERIVED TOTALS ──────────────────────────────────────────────────────
  const calcEarnings = (e) => {
    return p(e.basic_salary) + p(e.overtime_pay) + p(e.rest_day_duty) + p(e.salary_adjustment) + p(e.allowance)
  }
  const calcDeductions = (e) => {
    return p(e.cash_advance_deduction) + p(e.hdmf_loan) + p(e.hdmf_premium) + p(e.philhealth_premium) + p(e.sss_loan) + p(e.sss_premium)
  }
  const calcNet = (e) => calcEarnings(e) - calcDeductions(e)

  const grandEarnings = entries.reduce((s, e) => s + calcEarnings(e), 0)
  const grandDeductions = entries.reduce((s, e) => s + calcDeductions(e), 0)
  const grandNet = grandEarnings - grandDeductions

  // ── SAVE EMPLOYEE ───────────────────────────────────────────────────────
  const handleSaveEmployee = async () => {
    if (!empForm.full_name.trim()) { showToast('Employee name is required.', 'error'); return }
    setSaving(true)
    const payload = {
      full_name: empForm.full_name.trim().toUpperCase(),
      position: empForm.position.trim(),
      basic_rate_monthly: p(empForm.basic_rate_monthly),
      allowance_monthly: p(empForm.allowance_monthly),
      sss_employee: p(empForm.sss_employee),
      sss_employer: p(empForm.sss_employer),
      philhealth_employee: p(empForm.philhealth_employee),
      philhealth_employer: p(empForm.philhealth_employer),
      hdmf_employee: p(empForm.hdmf_employee),
      hdmf_employer: p(empForm.hdmf_employer),
      is_active: empForm.is_active,
      notes: empForm.notes,
    }
    const { error } = editingEmpId
      ? await supabase.from('payroll_employees').update(payload).eq('id', editingEmpId)
      : await supabase.from('payroll_employees').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      showToast(editingEmpId ? 'Employee updated.' : 'Employee added.')
      setShowEmpForm(false); setEditingEmpId(null); setEmpForm(EMPTY_EMPLOYEE)
      fetchEmployees()
    }
    setSaving(false)
  }

  // ── SAVE ENTRY ──────────────────────────────────────────────────────────
  const handleSaveEntry = async () => {
    if (!entryForm.employee_id) { showToast('Select an employee.', 'error'); return }
    if (!entryForm.cutoff_date) { showToast('Cutoff date is required.', 'error'); return }
    // Check duplicate (same employee + cutoff), excluding current edit
    const dup = entries.find(e => e.employee_id === entryForm.employee_id && e.cutoff_date === entryForm.cutoff_date && e.id !== editingEntryId)
    if (dup) { showToast('Entry already exists for this employee and cutoff.', 'error'); return }
    setSaving(true)
    const calc = entryAutoCalc ? autoCalcEntry(entryForm) : entryForm
    const payload = {
      employee_id: calc.employee_id,
      cutoff_date: calc.cutoff_date,
      basic_days: p(calc.basic_days),
      basic_rate: p(calc.basic_rate),
      overtime_hours: p(calc.overtime_hours),
      overtime_rate: p(calc.overtime_rate),
      hazard_rate: p(calc.hazard_rate),
      basic_salary: p(calc.basic_salary),
      overtime_pay: p(calc.overtime_pay),
      rest_day_duty: p(calc.rest_day_duty),
      salary_adjustment: p(calc.salary_adjustment),
      allowance: p(calc.allowance),
      cash_advance_deduction: p(calc.cash_advance_deduction),
      hdmf_loan: p(calc.hdmf_loan),
      hdmf_premium: p(calc.hdmf_premium),
      philhealth_premium: p(calc.philhealth_premium),
      sss_loan: p(calc.sss_loan),
      sss_premium: p(calc.sss_premium),
      notes: calc.notes,
    }
    const currentEditId = editingEntryIdRef.current
    const { error } = currentEditId
      ? await supabase.from('payroll_entries').update(payload).eq('id', currentEditId)
      : await supabase.from('payroll_entries').insert(payload)
    if (!error) logAudit(currentEditId?'destructive':'generate', currentEditId?'Updated':'Added', 'Payroll', `${currentEditId?'Updated':'Added'} payroll entry: ${payload.employee_name||''} ${payload.cutoff_date||''}`, currentEditId||'', profile?.id, profile?.full_name)
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      showToast(currentEditId ? 'Entry updated.' : 'Entry added.')
      setShowEntryForm(false); setEditingEntryId(null); editingEntryIdRef.current = null; setEntryForm(EMPTY_ENTRY)
      fetchEntries(selectedCutoff); fetchAllPayrollEntries()
    }
    setSaving(false)
  }

  // ── SAVE CA ─────────────────────────────────────────────────────────────
  const handleSaveCa = async () => {
    if (!caForm.employee_id || !caForm.date || !caForm.amount) {
      showToast('Employee, date, and amount are required.', 'error'); return
    }
    setSaving(true)
    const payload = {
      employee_id: caForm.employee_id,
      date: caForm.date,
      amount: p(caForm.amount),
      type: caForm.type,
      description: caForm.description,
    }
    const { error } = editingCaId
      ? await supabase.from('payroll_cash_advances').update(payload).eq('id', editingCaId)
      : await supabase.from('payroll_cash_advances').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      showToast(editingCaId ? 'Record updated.' : 'Record added.')
      setShowCaForm(false); setEditingCaId(null); setCaForm(EMPTY_CA)
      fetchCaRecords()
    }
    setSaving(false)
  }

  // ── DELETE HELPERS ──────────────────────────────────────────────────────
  const handleDeleteEntry = (id, empName) => {
    setConfirmModal({
      message: `Delete payroll entry for "${empName}"?`,
      onConfirm: async () => {
        await supabase.from('payroll_entries').delete().eq('id', id)
        logAudit('destructive', 'Deleted', 'Payroll', `Deleted payroll entry id: ${id}`, id, profile?.id, profile?.full_name)
        showToast('Entry deleted.', 'info'); fetchEntries(selectedCutoff); fetchAllPayrollEntries()
      }
    })
  }

  const handleDeleteCa = (id, empName, amount) => {
    setConfirmModal({
      message: `Delete CA record for "${empName}" (₱${fmt(amount)})?`,
      onConfirm: async () => {
        await supabase.from('payroll_cash_advances').delete().eq('id', id)
        showToast('Record deleted.', 'info'); fetchCaRecords()
      }
    })
  }

  // ── PRINT ───────────────────────────────────────────────────────────────
  // ── PAYSLIP DRAFTS ───────────────────────────────────────────────────────
  const fetchPayslipDrafts = useCallback(async () => {
    setDraftsLoading(true)
    const { data } = await supabase.from('payslip_drafts').select('*').order('updated_at', { ascending: false })
    if (data) setPayslipDrafts(data)
    setDraftsLoading(false)
  }, [])

  useEffect(() => { if (activeTab === 'payslip') fetchPayslipDrafts() }, [activeTab, fetchPayslipDrafts])

  const handleSavePayslipDraft = async () => {
    const payload = {
      employee_name: payslipForm.employee_name,
      position: payslipForm.position,
      cutoffs: payslipForm.cutoffs,
      deductions: {
        sss: payslipForm.sss, philhealth: payslipForm.philhealth, hdmf: payslipForm.hdmf,
        sss_loan: payslipForm.sss_loan, hdmf_loan: payslipForm.hdmf_loan,
        ca_deduction: payslipForm.ca_deduction, other_deductions: payslipForm.other_deductions,
      },
      updated_at: new Date().toISOString(),
      created_by: profile?.id,
    }
    let error
    if (currentDraftId) {
      ({ error } = await supabase.from('payslip_drafts').update(payload).eq('id', currentDraftId))
    } else {
      const { data, error: e } = await supabase.from('payslip_drafts').insert(payload).select().single()
      error = e
      if (data) setCurrentDraftId(data.id)
    }
    if (error) { showToast('Error saving: ' + error.message, 'error'); return }
    showToast('Payslip draft saved.')
    fetchPayslipDrafts()
  }

  const handleLoadPayslipDraft = (draft) => {
    setPayslipForm({
      employee_name: draft.employee_name || '',
      position: draft.position || '',
      cutoffs: draft.cutoffs?.length ? draft.cutoffs : EMPTY_PAYSLIP.cutoffs,
      ...draft.deductions,
    })
    setCurrentDraftId(draft.id)
    showToast(`Loaded: ${draft.employee_name}`)
  }

  const handleDeletePayslipDraft = async (id) => {
    await supabase.from('payslip_drafts').delete().eq('id', id)
    if (currentDraftId === id) { setCurrentDraftId(null); setPayslipForm(EMPTY_PAYSLIP) }
    fetchPayslipDrafts()
    showToast('Draft deleted.', 'info')
  }

  // ── PAYSLIP PRINT (multi-cutoff) ─────────────────────────────────────────
  const handlePrintPayslip = () => {
    const p2 = v => parseFloat(String(v||'0').replace(/,/g,''))||0
    const f2 = n => Number(n||0).toLocaleString('en-PH', { minimumFractionDigits:2 })
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const logo = settings.logo_url || localStorage.getItem('ds_logo') || ''
    const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month:'long', day:'numeric', year:'numeric' }) : '—'

    const activeCutoffs = payslipForm.cutoffs.filter(c => c.period_from || c.basic_salary)
    if (!activeCutoffs.length) { showToast('Fill in at least one cutoff period.', 'error'); return }

    const deductionRows = [
      ['SSS Premium', payslipForm.sss],
      ['PhilHealth Premium', payslipForm.philhealth],
      ['HDMF (Pag-IBIG) Premium', payslipForm.hdmf],
      ['SSS Loan', payslipForm.sss_loan],
      ['HDMF Loan', payslipForm.hdmf_loan],
      ['Cash Advance', payslipForm.ca_deduction],
      ['Other Deductions', payslipForm.other_deductions],
    ].filter(([,v]) => p2(v) > 0)
    const totalDeductions = deductionRows.reduce((s,[,v]) => s+p2(v), 0)

    const css = `* { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:Arial,sans-serif; font-size:9pt; color:#111; }
      .pair { width:100%; height:100vh; display:flex; flex-direction:column; page-break-after:always; }
      .pair:last-child { page-break-after:auto; }
      .sheet { flex:1; display:flex; flex-direction:column; overflow:hidden; padding:10px 14px; }
      .sheet:first-child { border-bottom:1px dashed #aaa; }
      .header { display:flex; align-items:center; gap:10px; border-bottom:1.5px solid #111; padding-bottom:6px; margin-bottom:6px; }
      .logo { height:36px; width:auto; }
      .company-name { font-size:10.5pt; font-weight:bold; line-height:1.2; }
      .company-sub { font-size:7pt; color:#444; }
      .payslip-title { text-align:center; font-size:10pt; font-weight:bold; letter-spacing:.05em; background:#1F2937; color:#fff; padding:4px; margin-bottom:7px; }
      .emp-block { display:flex; justify-content:space-between; margin-bottom:7px; font-size:8.5pt; line-height:1.6; }
      .tables { display:flex; gap:10px; margin-bottom:7px; flex:1; }
      .table-half { flex:1; }
      table { width:100%; border-collapse:collapse; font-size:8pt; }
      th { background:#374151; color:#fff; padding:3px 6px; text-align:left; font-size:7.5pt; }
      th.amt { text-align:right; }
      td { padding:2px 6px; border-bottom:1px solid #eee; }
      td.amt { text-align:right; }
      .totals { display:flex; gap:10px; margin-bottom:5px; }
      .total-row { flex:1; display:flex; justify-content:space-between; padding:4px 6px; font-weight:bold; font-size:8.5pt; background:#F3F4F6; }
      .net-row { border:1.5px solid #1F2937; display:flex; justify-content:space-between; padding:5px 10px; font-size:10pt; font-weight:bold; margin-bottom:0; }
      .sig-block { display:flex; justify-content:space-between; margin-top:auto; padding-top:4px; }
      .sig-col { text-align:center; width:45%; }
      .sig-space { height:38px; }
      .sig-line { border-top:1px solid #333; margin-bottom:3px; }
      .sig-label { font-size:7pt; color:#555; }
      .sig-name { font-size:8.5pt; font-weight:bold; }
      @media print {
        @page { size:letter portrait; margin:6mm; }
        html, body { height:100%; }
        .pair { height:100vh; page-break-after:always; page-break-inside:avoid; }
        .pair:last-child { page-break-after:auto; }
      }`

    const headerHtml = `
      <div class="header">
        ${logo ? `<img src="${logo}" class="logo" alt="logo" />` : ''}
        <div>
          <div class="company-name">${companyName}</div>
          ${settings.vat_tin ? `<div class="company-sub">TIN: ${settings.vat_tin}</div>` : ''}
          ${settings.address ? `<div class="company-sub">${settings.address.toUpperCase()}</div>` : ''}
          ${settings.contact ? `<div class="company-sub">${settings.contact}${settings.email ? ' / ' + settings.email : ''}</div>` : ''}
        </div>
      </div>`

    // Group cutoffs into pairs — 2 per physical page
    const buildSheet = (c) => {
      const earningsRows = [
        ['Basic Salary (Semi-monthly)', c.basic_salary],
        ['Allowance', c.allowance],
        ['Overtime Pay', c.overtime_pay],
        ['Rest Day Duty Pay', c.rest_day],
        ['Holiday Pay', c.holiday_pay],
        ['Salary Adjustment', c.salary_adjustment],
        ['Other Earnings', c.other_earnings],
      ].filter(([,v]) => p2(v) > 0)
      const totalEarnings = earningsRows.reduce((s,[,v]) => s+p2(v), 0)
      const netPay = totalEarnings - totalDeductions
      return `<div class="sheet">
        ${headerHtml}
        <div class="payslip-title">PAYSLIP</div>
        <div class="emp-block">
          <div>
            <div><strong>Employee:</strong> ${payslipForm.employee_name || '—'}</div>
            <div><strong>Position:</strong> ${payslipForm.position || '—'}</div>
          </div>
          <div style="text-align:right">
            <div><strong>Period:</strong> ${fmtD(c.period_from)} – ${fmtD(c.period_to)}</div>
            <div><strong>Pay Date:</strong> ${fmtD(c.pay_date)}</div>
          </div>
        </div>
        <div class="tables">
          <div class="table-half">
            <table>
              <thead><tr><th>Earnings</th><th class="amt">Amount (PHP)</th></tr></thead>
              <tbody>${earningsRows.map(([l,v]) => `<tr><td>${l}</td><td class="amt">${f2(p2(v))}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="table-half">
            <table>
              <thead><tr><th>Deductions</th><th class="amt">Amount (PHP)</th></tr></thead>
              <tbody>${deductionRows.map(([l,v]) => `<tr><td>${l}</td><td class="amt">${f2(p2(v))}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
        <div class="totals">
          <div class="total-row"><span>TOTAL EARNINGS</span><span>PHP ${f2(totalEarnings)}</span></div>
          <div class="total-row"><span>TOTAL DEDUCTIONS</span><span>PHP ${f2(totalDeductions)}</span></div>
        </div>
        <div class="net-row"><span>NET PAY</span><span>PHP ${f2(netPay)}</span></div>
        <div class="sig-block">
          <div class="sig-col">
            <div class="sig-space"></div>
            <div class="sig-line"></div>
            <div class="sig-name">&nbsp;</div>
            <div class="sig-label">Authorized Signatory</div>
          </div>
          <div class="sig-col">
            <div class="sig-space"></div>
            <div class="sig-line"></div>
            <div class="sig-name">${payslipForm.employee_name || '&nbsp;'}</div>
            <div class="sig-label">Received by (Signature over Printed Name)</div>
          </div>
        </div>
      </div>`
    }

    const pairs = []
    for (let i = 0; i < activeCutoffs.length; i += 2) {
      const a = buildSheet(activeCutoffs[i])
      const b = i+1 < activeCutoffs.length ? buildSheet(activeCutoffs[i+1]) : '<div class="sheet"></div>'
      pairs.push(`<div class="pair">${a}${b}</div>`)
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body style="margin:0;padding:0">${pairs.join('')}</body></html>`
    const win = window.open('', '_blank', 'width=720,height=900')
    win.document.write(html)
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 400)
    logAudit('generate', 'Printed', 'Payslip', `Payslip for ${payslipForm.employee_name} (${activeCutoffs.length} cutoff${activeCutoffs.length>1?'s':''})`, '', profile?.id, profile?.full_name)
  }


  const handlePrint = (sigs) => {
    setActiveSigs(sigs)
    setSigDialog(false)
    setTimeout(() => {
      const style = document.createElement('style')
      style.innerHTML = PRINT_STYLE
      document.head.appendChild(style)
      window.print()
      setTimeout(() => document.head.removeChild(style), 1000)
    }, 80)
  }

  // ── CUTOFF SELECTOR ─────────────────────────────────────────────────────
  const buildCutoffOptions = () => {
    const now = new Date()
    const day = now.getDate()
    const allOpts = []

    // Current month: show active cutoff first
    const curY = now.getFullYear()
    const curM = String(now.getMonth() + 1).padStart(2, '0')
    const curLastDay = new Date(curY, now.getMonth() + 1, 0).getDate()
    const curLabel = now.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })
    if (day > 15) {
      // Second half is current — show it first
      allOpts.push({ value: `${curY}-${curM}-${curLastDay}`, label: `${curLabel} (16–${curLastDay})` })
      allOpts.push({ value: `${curY}-${curM}-15`, label: `${curLabel} (1–15)` })
    } else {
      // First half is current — show it first
      allOpts.push({ value: `${curY}-${curM}-15`, label: `${curLabel} (1–15)` })
      allOpts.push({ value: `${curY}-${curM}-${curLastDay}`, label: `${curLabel} (16–${curLastDay})` })
    }

    // Past months: newest first, each month 16–last then 1–15
    for (let i = 1; i < 12; i++) {
      const d = new Date(curY, now.getMonth() - i, 1)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const lastDay = new Date(y, d.getMonth() + 1, 0).getDate()
      const lbl = d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })
      allOpts.push({ value: `${y}-${m}-${curLastDay <= lastDay ? lastDay : lastDay}`, label: `${lbl} (16–${lastDay})` })
      allOpts.push({ value: `${y}-${m}-15`, label: `${lbl} (1–15)` })
    }

    // Future: 3 months, nearest first, 1–15 then 16–last per month
    for (let i = 1; i <= 3; i++) {
      const d = new Date(curY, now.getMonth() + i, 1)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const lastDay = new Date(y, d.getMonth() + 1, 0).getDate()
      const lbl = d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })
      allOpts.push({ value: `${y}-${m}-15`, label: `${lbl} (1–15) 🔜` })
      allOpts.push({ value: `${y}-${m}-${lastDay}`, label: `${lbl} (16–${lastDay}) 🔜` })
    }

    return allOpts
  }

  // ── NEXT CUTOFF CALCULATOR ──────────────────────────────────────────────
  const getNextCutoff = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    const day = d.getDate()
    const y = d.getFullYear()
    const m = d.getMonth()
    if (day === 15) {
      // 16-last → same month
      const lastDay = new Date(y, m + 1, 0).getDate()
      return `${y}-${String(m + 1).padStart(2, '0')}-${lastDay}`
    } else {
      // 1-15 → next month
      const nd = new Date(y, m + 1, 15)
      return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-15`
    }
  }

  const getNextCutoffLabel = (dateStr) => {
    const next = getNextCutoff(dateStr)
    const d = new Date(next + 'T00:00:00')
    const day = d.getDate()
    const mo = d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })
    return day === 15 ? `${mo} (1–15)` : `${mo} (16–${day})`
  }

  // ── COPY TO NEXT CUTOFF ──────────────────────────────────────────────────
  const handleCopyToNextCutoff = async () => {
    const nextCutoff = getNextCutoff(selectedCutoff)
    const nextLabel = getNextCutoffLabel(selectedCutoff)

    // Check if next cutoff already has entries
    const { data: existing } = await supabase
      .from('payroll_entries')
      .select('id')
      .eq('cutoff_date', nextCutoff)
      .limit(1)

    if (existing && existing.length > 0) {
      setConfirmModal({
        message: `${nextLabel} already has entries. Overwrite and replace them with copies from the current cutoff?`,
        onConfirm: () => doCopy(nextCutoff, nextLabel, true)
      })
      return
    }
    doCopy(nextCutoff, nextLabel, false)
  }

  const doCopy = async (nextCutoff, nextLabel, deleteFirst) => {
    setCopying(true)
    try {
      if (deleteFirst) {
        await supabase.from('payroll_entries').delete().eq('cutoff_date', nextCutoff)
      }
      // Copy entries — keep standard fields, zero out one-time items
      const newEntries = entries.map(e => ({
        employee_id: e.employee_id,
        cutoff_date: nextCutoff,
        basic_days: e.basic_days,
        basic_rate: e.basic_rate,
        overtime_hours: 0,
        overtime_rate: e.overtime_rate,
        hazard_rate: 0,
        basic_salary: e.basic_salary,
        overtime_pay: 0,
        rest_day_duty: 0,
        salary_adjustment: 0,
        allowance: e.allowance,
        cash_advance_deduction: 0,
        hdmf_loan: e.hdmf_loan,
        hdmf_premium: e.hdmf_premium,
        philhealth_premium: e.philhealth_premium,
        sss_loan: e.sss_loan,
        sss_premium: e.sss_premium,
        notes: '',
      }))
      const { error } = await supabase.from('payroll_entries').insert(newEntries)
      if (error) { showToast('Error: ' + error.message, 'error'); return }
      showToast(`Copied ${newEntries.length} entries to ${nextLabel}.`)
      setSelectedCutoff(nextCutoff)
    } finally {
      setCopying(false)
    }
  }

  // ── LOCK / UNLOCK CUTOFF ────────────────────────────────────────────────────
  const handleToggleLock = async () => {
    if (!cutoffLocked) {
      // Locking — just confirm and lock
      setConfirmModal({
        message: 'Lock all entries for this cutoff? Entries will be read-only until unlocked.',
        onConfirm: async () => {
          const { error } = await supabase.rpc('lock_payroll_cutoff', { p_cutoff_date: selectedCutoff, p_lock: true })
          if (error) showToast('Error: ' + error.message, 'error')
          else { showToast('Cutoff locked.', 'info'); fetchEntries(selectedCutoff) }
        }
      })
    } else {
      // Unlocking — show PIN prompt
      setPinUnlockInput(''); setPinUnlockError('')
      setPinUnlockModal({ type: 'payroll', cutoff: selectedCutoff })
    }
  }

  const handlePinUnlockSubmit = async () => {
    if (!pinUnlockInput.trim()) { setPinUnlockError('Enter override PIN.'); return }
    setPinUnlocking(true)
    const { data, error } = await supabase.rpc('lock_payroll_cutoff', {
      p_cutoff_date: pinUnlockModal.cutoff,
      p_lock: false,
      p_pin: pinUnlockInput.toUpperCase(),
    })
    setPinUnlocking(false)
    if (error) {
      setPinUnlockError(error.message.includes('Invalid') ? 'Invalid PIN. Try again.' : error.message)
    } else {
      setPinUnlockModal(null); setPinUnlockInput(''); setPinUnlockError('')
      showToast('Cutoff unlocked.', 'info'); fetchEntries(selectedCutoff)
    }
  }

  // ── FILTERED CA ─────────────────────────────────────────────────────────
  const filteredCa = caFilterEmp === 'all' ? caRecords : caRecords.filter(r => r.employee_id === caFilterEmp)

  // ── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '16px 12px' }}>
      <Toast toast={toast} />

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Payroll</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Semi-monthly payroll management</div>
        </div>
        {activeTab === 'payroll' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={selectedCutoff} onChange={e => setSelectedCutoff(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}>
              {buildCutoffOptions().map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {isAdmin && !cutoffLocked && (
              <button onClick={() => { setEditingEntryId(null); editingEntryIdRef.current = null; setEntryForm({ ...EMPTY_ENTRY, cutoff_date: selectedCutoff }); setShowEntryForm(true) }}
                style={{ padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                + Add Entry
              </button>
            )}
            {entries.length > 0 && (
              <>
                <button onClick={handleCopyToNextCutoff} disabled={copying || cutoffLocked}
                  style={{ padding: '7px 14px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, opacity: cutoffLocked ? 0.5 : 1 }}>
                  {copying ? 'Copying…' : `📋 Copy → ${getNextCutoffLabel(selectedCutoff)}`}
                </button>
                <button onClick={() => setSigDialog(true)}
                  style={{ padding: '7px 14px', background: '#334155', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                  🖨️ Print
                </button>
                {isAdmin && (
                  <button onClick={handleToggleLock}
                    style={{ padding: '7px 14px', background: cutoffLocked ? '#16a34a' : '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                    {cutoffLocked ? '🔓 Unlock' : '🔒 Lock'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {activeTab === 'employees' && isAdmin && (
          <button onClick={() => { setEditingEmpId(null); setEmpForm(EMPTY_EMPLOYEE); setShowEmpForm(true) }}
            style={{ padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            + Add Employee
          </button>
        )}
        {activeTab === 'cash-advance' && isAdmin && (
          <button onClick={() => { setEditingCaId(null); setCaForm(EMPTY_CA); setShowCaForm(true) }}
            style={{ padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            + Add Record
          </button>
        )}
      </div>

      {/* ── TABS ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'payroll', label: '📋 Payroll Register' },
          { id: 'employees', label: '👤 Employees' },
          { id: 'cash-advance', label: '💵 Cash Advances' },
          { id: '13th-month', label: '🎁 13th Month' },
          { id: 'payslip', label: '🧾 Payslip' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══ TAB: PAYROLL REGISTER ══ */}
      {activeTab === 'payroll' && (
        <>
          {entriesLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontSize: 13 }}>Loading entries…</div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No entries for this cutoff</div>
              <div style={{ fontSize: 13 }}>Click "+ Add Entry" to create payroll entries for this period.</div>
            </div>
          ) : (
            <>
              {/* Lock status banner */}
              {cutoffLocked && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#dc2626' }}>
                  🔒 <strong>This cutoff is locked.</strong> Entries cannot be edited. Only superuser can unlock.
                </div>
              )}

              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Total Earnings', value: fmt(grandEarnings), color: '#16a34a' },
                  { label: 'Total Deductions', value: fmt(grandDeductions), color: '#dc2626' },
                  { label: 'Total Net Pay', value: fmt(grandNet), color: 'var(--accent)' },
                  { label: 'Employees', value: entries.length, color: 'var(--text)' },
                ].map(c => (
                  <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{c.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: c.color, marginTop: 4 }}>
                      {typeof c.value === 'number' ? c.value : `₱${c.value}`}
                    </div>
                  </div>
                ))}
              </div>

              {/* Mobile: cards */}
              {isMobile ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {entries.map((e, i) => {
                    const earn = calcEarnings(e)
                    const ded = calcDeductions(e)
                    const net = earn - ded
                    const empName = e.payroll_employees?.full_name || '—'
                    return (
                      <div key={e.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{i + 1}. {empName}</div>
                            {e.payroll_employees?.position && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.payroll_employees.position}</div>}
                          </div>
                          {isAdmin && !cutoffLocked && (
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                              <button onClick={() => {
                                setEditingEntryId(e.id); editingEntryIdRef.current = e.id
                                setEntryForm({
                                  employee_id: e.employee_id, cutoff_date: e.cutoff_date,
                                  basic_days: String(e.basic_days), basic_rate: String(e.basic_rate),
                                  overtime_hours: String(e.overtime_hours || ''), overtime_rate: String(e.overtime_rate || '50'),
                                  hazard_rate: String(e.hazard_rate || ''), basic_salary: String(e.basic_salary),
                                  overtime_pay: String(e.overtime_pay || ''), rest_day_duty: String(e.rest_day_duty || ''),
                                  salary_adjustment: String(e.salary_adjustment || ''), allowance: String(e.allowance || ''),
                                  cash_advance_deduction: String(e.cash_advance_deduction || ''),
                                  hdmf_loan: String(e.hdmf_loan || ''), hdmf_premium: String(e.hdmf_premium || ''),
                                  philhealth_premium: String(e.philhealth_premium || ''),
                                  sss_loan: String(e.sss_loan || ''), sss_premium: String(e.sss_premium || ''),
                                  notes: e.notes || '',
                                })
                                setEntryAutoCalc(false); setShowEntryForm(true)
                              }} style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>✏️ Edit</button>
                              <button onClick={() => handleDeleteEntry(e.id, empName)} style={{ padding: '6px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>🗑️</button>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 12 }}>
                          <div><span style={{ color: 'var(--muted)' }}>Days: </span><strong>{e.basic_days}</strong></div>
                          <div><span style={{ color: 'var(--muted)' }}>Basic: </span><strong>₱{fmt(e.basic_salary)}</strong></div>
                          {p(e.overtime_pay) > 0 && <div><span style={{ color: 'var(--muted)' }}>OT: </span><strong>₱{fmt(e.overtime_pay)}</strong></div>}
                          {p(e.allowance) > 0 && <div><span style={{ color: 'var(--muted)' }}>Allowance: </span><strong>₱{fmt(e.allowance)}</strong></div>}
                          {p(e.cash_advance_deduction) > 0 && <div><span style={{ color: 'var(--muted)' }}>CA Ded.: </span><strong style={{ color: '#dc2626' }}>₱{fmt(e.cash_advance_deduction)}</strong></div>}
                          {p(e.sss_premium) > 0 && <div><span style={{ color: 'var(--muted)' }}>SSS: </span><strong style={{ color: '#dc2626' }}>₱{fmt(e.sss_premium)}</strong></div>}
                          {p(e.philhealth_premium) > 0 && <div><span style={{ color: 'var(--muted)' }}>PhilHealth: </span><strong style={{ color: '#dc2626' }}>₱{fmt(e.philhealth_premium)}</strong></div>}
                          {p(e.hdmf_premium) > 0 && <div><span style={{ color: 'var(--muted)' }}>HDMF: </span><strong style={{ color: '#dc2626' }}>₱{fmt(e.hdmf_premium)}</strong></div>}
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, flexWrap: 'wrap' }}>
                          <span>Earnings: <strong style={{ color: '#16a34a' }}>₱{fmt(earn)}</strong></span>
                          <span>Deductions: <strong style={{ color: '#dc2626' }}>₱{fmt(ded)}</strong></span>
                          <span style={{ marginLeft: 'auto' }}>Net Pay: <strong style={{ color: '#2563eb', fontSize: 15 }}>₱{fmt(net)}</strong></span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* Desktop: full table */
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                        <th style={TH}>#</th>
                        <th style={{ ...TH, textAlign: 'left', minWidth: 160 }}>Employee</th>
                        <th style={TH}>Days</th>
                        <th style={TH}>Basic Salary</th>
                        <th style={TH}>OT Pay</th>
                        <th style={TH}>Rest Day</th>
                        <th style={TH}>Adj.</th>
                        <th style={TH}>Allowance</th>
                        <th style={{ ...TH, background: '#f0fdf4', color: '#16a34a' }}>Earnings</th>
                        <th style={TH}>Cash Adv.</th>
                        <th style={TH}>HDMF Loan</th>
                        <th style={TH}>HDMF Prem.</th>
                        <th style={TH}>PhilHealth</th>
                        <th style={TH}>SSS Loan</th>
                        <th style={TH}>SSS Prem.</th>
                        <th style={{ ...TH, background: '#fef2f2', color: '#dc2626' }}>Deductions</th>
                        <th style={{ ...TH, background: '#eff6ff', color: '#2563eb', fontWeight: 700 }}>Net Pay</th>
                        {isAdmin && !cutoffLocked && <th style={TH}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e, i) => {
                        const earn = calcEarnings(e)
                        const ded = calcDeductions(e)
                        const net = earn - ded
                        const empName = e.payroll_employees?.full_name || '—'
                        return (
                          <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={TD}>{i + 1}</td>
                            <td style={{ ...TD, textAlign: 'left' }}>
                              <div style={{ fontWeight: 600 }}>{empName}</div>
                              {e.payroll_employees?.position && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{e.payroll_employees.position}</div>}
                            </td>
                            <td style={TD}>{e.basic_days}</td>
                            <td style={TD}>₱{fmt(e.basic_salary)}</td>
                            <td style={TD}>{p(e.overtime_pay) > 0 ? `₱${fmt(e.overtime_pay)}` : '—'}</td>
                            <td style={TD}>{p(e.rest_day_duty) > 0 ? `₱${fmt(e.rest_day_duty)}` : '—'}</td>
                            <td style={TD}>{p(e.salary_adjustment) !== 0 ? `₱${fmt(e.salary_adjustment)}` : '—'}</td>
                            <td style={TD}>{p(e.allowance) > 0 ? `₱${fmt(e.allowance)}` : '—'}</td>
                            <td style={{ ...TD, background: '#f0fdf4', fontWeight: 600, color: '#16a34a' }}>₱{fmt(earn)}</td>
                            <td style={TD}>{p(e.cash_advance_deduction) > 0 ? `₱${fmt(e.cash_advance_deduction)}` : '—'}</td>
                            <td style={TD}>{p(e.hdmf_loan) > 0 ? `₱${fmt(e.hdmf_loan)}` : '—'}</td>
                            <td style={TD}>{p(e.hdmf_premium) > 0 ? `₱${fmt(e.hdmf_premium)}` : '—'}</td>
                            <td style={TD}>{p(e.philhealth_premium) > 0 ? `₱${fmt(e.philhealth_premium)}` : '—'}</td>
                            <td style={TD}>{p(e.sss_loan) > 0 ? `₱${fmt(e.sss_loan)}` : '—'}</td>
                            <td style={TD}>{p(e.sss_premium) > 0 ? `₱${fmt(e.sss_premium)}` : '—'}</td>
                            <td style={{ ...TD, background: '#fef2f2', color: '#dc2626' }}>₱{fmt(ded)}</td>
                            <td style={{ ...TD, background: '#eff6ff', color: '#2563eb', fontWeight: 700 }}>₱{fmt(net)}</td>
                            {isAdmin && !cutoffLocked && (
                              <td style={TD}>
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                  <button onClick={() => {
                                    setEditingEntryId(e.id); editingEntryIdRef.current = e.id
                                    setEntryForm({
                                      employee_id: e.employee_id, cutoff_date: e.cutoff_date,
                                      basic_days: String(e.basic_days), basic_rate: String(e.basic_rate),
                                      overtime_hours: String(e.overtime_hours || ''), overtime_rate: String(e.overtime_rate || '50'),
                                      hazard_rate: String(e.hazard_rate || ''), basic_salary: String(e.basic_salary),
                                      overtime_pay: String(e.overtime_pay || ''), rest_day_duty: String(e.rest_day_duty || ''),
                                      salary_adjustment: String(e.salary_adjustment || ''), allowance: String(e.allowance || ''),
                                      cash_advance_deduction: String(e.cash_advance_deduction || ''),
                                      hdmf_loan: String(e.hdmf_loan || ''), hdmf_premium: String(e.hdmf_premium || ''),
                                      philhealth_premium: String(e.philhealth_premium || ''),
                                      sss_loan: String(e.sss_loan || ''), sss_premium: String(e.sss_premium || ''),
                                      notes: e.notes || '',
                                    })
                                    setEntryAutoCalc(false); setShowEntryForm(true)
                                  }} style={ActionBtn('#3b82f6')}>✏️</button>
                                  <button onClick={() => handleDeleteEntry(e.id, empName)} style={ActionBtn('#ef4444')}>🗑️</button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700, background: 'var(--bg)' }}>
                        <td colSpan={3} style={{ ...TD, textAlign: 'right', paddingRight: 8 }}>Grand Total</td>
                        <td style={TD} colSpan={5}></td>
                        <td style={{ ...TD, background: '#dcfce7', color: '#15803d' }}>₱{fmt(grandEarnings)}</td>
                        <td style={TD} colSpan={6}></td>
                        <td style={{ ...TD, background: '#fee2e2', color: '#b91c1c' }}>₱{fmt(grandDeductions)}</td>
                        <td style={{ ...TD, background: '#dbeafe', color: '#1d4ed8' }}>₱{fmt(grandNet)}</td>
                        {isAdmin && !cutoffLocked && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Print area */}
          <div id="payroll-print-area" ref={printRef}>
            <PrintPayroll entries={entries} sigs={activeSigs} selectedCutoff={selectedCutoff}
              calcEarnings={calcEarnings} calcDeductions={calcDeductions} calcNet={calcNet}
              grandEarnings={grandEarnings} grandDeductions={grandDeductions} grandNet={grandNet}
              settings={settings} caRecords={caRecords} allPayrollEntries={allPayrollEntries} />
          </div>
          <style>{PRINT_STYLE}</style>
        </>
      )}

      {/* ══ TAB: EMPLOYEES ══ */}
      {activeTab === 'employees' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {employees.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>No employees yet. Add one above.</div>
          ) : employees.map(emp => (
            <div key={emp.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{emp.full_name}</span>
                  {!emp.is_active && <span style={{ fontSize: 10, background: '#fef2f2', color: '#dc2626', padding: '2px 6px', borderRadius: 4 }}>INACTIVE</span>}
                </div>
                {emp.position && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{emp.position}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8, fontSize: 12 }}>
                  <span>Basic: <strong>₱{fmt(emp.basic_rate_monthly)}/mo</strong></span>
                  <span>Allowance: <strong>₱{fmt(emp.allowance_monthly)}/mo</strong></span>
                  <span>SSS: <strong>₱{fmt(emp.sss_employee)}</strong></span>
                  <span>PhilHealth: <strong>₱{fmt(emp.philhealth_employee)}</strong></span>
                  <span>HDMF: <strong>₱{fmt(emp.hdmf_employee)}</strong></span>
                  <span style={{ color: getCaBalance(emp.id) > 0 ? '#dc2626' : 'var(--muted)' }}>
                    CA Balance: <strong>₱{fmt(getCaBalance(emp.id))}</strong>
                  </span>
                </div>
              </div>
              {isAdmin && (
                <button onClick={() => {
                  setEditingEmpId(emp.id)
                  setEmpForm({ ...emp, basic_rate_monthly: String(emp.basic_rate_monthly), allowance_monthly: String(emp.allowance_monthly), sss_employee: String(emp.sss_employee), sss_employer: String(emp.sss_employer), philhealth_employee: String(emp.philhealth_employee), philhealth_employer: String(emp.philhealth_employer), hdmf_employee: String(emp.hdmf_employee), hdmf_employer: String(emp.hdmf_employer) })
                  setShowEmpForm(true)
                }} style={ActionBtn('#3b82f6')}>✏️ Edit</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ══ TAB: CASH ADVANCES ══ */}
      {activeTab === 'cash-advance' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={caFilterEmp} onChange={e => setCaFilterEmp(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}>
              <option value="all">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          {/* Per-employee balance summary cards */}
          {(caFilterEmp === 'all' ? employees : employees.filter(e => e.id === caFilterEmp)).map(emp => {
            const recs = caRecords.filter(r => r.employee_id === emp.id)
            const totalAdv = recs.filter(r => r.type === 'advance').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
            const totalLedgerPay = recs.filter(r => r.type === 'payment').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
            const totalPayrollDed = allPayrollEntries.filter(pe => pe.employee_id === emp.id).reduce((s, pe) => s + (parseFloat(pe.cash_advance_deduction) || 0), 0)
            const balance = Math.max(0, totalAdv - totalLedgerPay - totalPayrollDed)
            if (totalAdv === 0 && balance === 0) return null
            return (
              <div key={emp.id} style={{ background: 'var(--surface)', border: `1px solid ${balance > 0 ? '#fca5a5' : 'var(--border)'}`, borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{emp.full_name}</div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Total Advances</div>
                    <div style={{ fontWeight: 700, color: '#dc2626', fontSize: 15 }}>₱{fmt(totalAdv)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Ledger Payments</div>
                    <div style={{ fontWeight: 700, color: '#16a34a', fontSize: 15 }}>₱{fmt(totalLedgerPay)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Payroll Deductions</div>
                    <div style={{ fontWeight: 700, color: '#16a34a', fontSize: 15 }}>₱{fmt(totalPayrollDed)}</div>
                  </div>
                  <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 24 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Outstanding Balance</div>
                    <div style={{ fontWeight: 700, color: balance > 0 ? '#dc2626' : '#16a34a', fontSize: 18 }}>₱{fmt(balance)}</div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Ledger table */}
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ ...TH, textAlign: 'left' }}>Employee</th>
                  <th style={TH}>Date</th>
                  <th style={TH}>Type</th>
                  <th style={TH}>Amount</th>
                  <th style={{ ...TH, color: '#dc2626' }}>Running Balance</th>
                  <th style={{ ...TH, textAlign: 'left' }}>Description</th>
                  {isAdmin && <th style={TH}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredCa.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No records found.</td></tr>
                ) : (() => {
                  const empIds = new Set(filteredCa.map(r => r.employee_id))
                  const payrollRows = allPayrollEntries
                    .filter(pe => empIds.has(pe.employee_id) && (parseFloat(pe.cash_advance_deduction) || 0) > 0)
                    .map(pe => {
                      const emp = employees.find(e => e.id === pe.employee_id)
                      return { key: 'pr_' + pe.employee_id + '_' + pe.cutoff_date, employee_id: pe.employee_id, empName: emp?.full_name || '—', date: pe.cutoff_date, type: 'payment', amount: parseFloat(pe.cash_advance_deduction) || 0, description: 'Payroll deduction (' + pe.cutoff_date + ')', source: 'payroll', originalRow: null }
                    })
                  const ledgerRows = filteredCa.map(r => ({ key: 'ca_' + r.id, employee_id: r.employee_id, empName: r.payroll_employees?.full_name || '—', date: r.date, type: r.type, amount: parseFloat(r.amount) || 0, description: r.description || '', source: 'ledger', originalRow: r }))
                  const allRows = [...ledgerRows, ...payrollRows].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
                  const runningMap = {}
                  return allRows.map(r => {
                    if (runningMap[r.employee_id] === undefined) runningMap[r.employee_id] = 0
                    if (r.type === 'advance') runningMap[r.employee_id] += r.amount
                    else runningMap[r.employee_id] -= r.amount
                    const runBal = Math.max(0, runningMap[r.employee_id])
                    const isPayroll = r.source === 'payroll'
                    return (
                      <tr key={r.key} style={{ borderBottom: '1px solid var(--border)', background: isPayroll ? 'var(--bg)' : 'transparent' }}>
                        <td style={{ ...TD, textAlign: 'left' }}>{r.empName}</td>
                        <td style={TD}>{fmtDate(r.date)}</td>
                        <td style={TD}>
                          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: r.type === 'advance' ? '#fef2f2' : isPayroll ? '#f0f9ff' : '#f0fdf4', color: r.type === 'advance' ? '#dc2626' : isPayroll ? '#0369a1' : '#16a34a' }}>
                            {r.type === 'advance' ? '↑ ADVANCE' : isPayroll ? '⊖ PAYROLL DED.' : '↓ PAYMENT'}
                          </span>
                        </td>
                        <td style={{ ...TD, color: r.type === 'advance' ? '#dc2626' : isPayroll ? '#0369a1' : '#16a34a', fontWeight: 600 }}>
                          {r.type === 'advance' ? '+' : '-'}₱{fmt(r.amount)}
                        </td>
                        <td style={{ ...TD, fontWeight: 700, color: runBal > 0 ? '#dc2626' : '#16a34a' }}>₱{fmt(runBal)}</td>
                        <td style={{ ...TD, textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>{r.description || '—'}</td>
                        {isAdmin && (
                          <td style={TD}>
                            {!isPayroll ? (
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                <button onClick={() => { setEditingCaId(r.originalRow.id); setCaForm({ employee_id: r.originalRow.employee_id, date: r.originalRow.date, amount: String(r.originalRow.amount), type: r.originalRow.type, description: r.originalRow.description || '' }); setShowCaForm(true) }} style={ActionBtn('#3b82f6')}>✏️</button>
                                <button onClick={() => handleDeleteCa(r.originalRow.id, r.empName, r.originalRow.amount)} style={ActionBtn('#ef4444')}>🗑️</button>
                              </div>
                            ) : (
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>payroll</span>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ══ MODALS ══ */}

      {/* Employee Form */}
      {showEmpForm && (
        <Modal title={editingEmpId ? 'Edit Employee' : 'Add Employee'} onClose={() => { setShowEmpForm(false); setEditingEmpId(null); setEmpForm(EMPTY_EMPLOYEE) }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <FormRow label="Full Name *">
              <input value={empForm.full_name} onChange={e => setEmpForm(f => ({ ...f, full_name: e.target.value }))} placeholder="MA. JUAN DELA CRUZ" style={INPUT} />
            </FormRow>
            <FormRow label="Position">
              <input value={empForm.position} onChange={e => setEmpForm(f => ({ ...f, position: e.target.value }))} placeholder="e.g. Admin Officer" style={INPUT} />
            </FormRow>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Monthly Rates</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <FormRow label="Basic Rate (Monthly)">
                  <input type="number" value={empForm.basic_rate_monthly} onChange={e => setEmpForm(f => ({ ...f, basic_rate_monthly: e.target.value }))} placeholder="15000" style={INPUT} />
                </FormRow>
                <FormRow label="Allowance (Monthly)">
                  <input type="number" value={empForm.allowance_monthly} onChange={e => setEmpForm(f => ({ ...f, allowance_monthly: e.target.value }))} placeholder="1000" style={INPUT} />
                </FormRow>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Monthly Deductions (Employee Share)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                <FormRow label="SSS"><input type="number" value={empForm.sss_employee} onChange={e => setEmpForm(f => ({ ...f, sss_employee: e.target.value }))} placeholder="0" style={INPUT} /></FormRow>
                <FormRow label="PhilHealth"><input type="number" value={empForm.philhealth_employee} onChange={e => setEmpForm(f => ({ ...f, philhealth_employee: e.target.value }))} placeholder="0" style={INPUT} /></FormRow>
                <FormRow label="HDMF / Pag-IBIG"><input type="number" value={empForm.hdmf_employee} onChange={e => setEmpForm(f => ({ ...f, hdmf_employee: e.target.value }))} placeholder="0" style={INPUT} /></FormRow>
              </div>
            </div>
            <FormRow label="Active">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={empForm.is_active} onChange={e => setEmpForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13 }}>Employee is currently active</span>
              </label>
            </FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button onClick={() => { setShowEmpForm(false); setEditingEmpId(null); setEmpForm(EMPTY_EMPLOYEE) }} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleSaveEmployee} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save Employee'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Entry Form */}
      {showEntryForm && (
        <Modal title={editingEntryId ? 'Edit Payroll Entry' : 'Add Payroll Entry'} onClose={() => { setShowEntryForm(false); setEditingEntryId(null); editingEntryIdRef.current = null; setEntryForm(EMPTY_ENTRY) }} wide>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <FormRow label="Employee *">
                <select value={entryForm.employee_id} onChange={e => {
                  const newForm = { ...entryForm, employee_id: e.target.value, allowance: '', sss_premium: '', philhealth_premium: '', hdmf_premium: '' }
                  setEntryForm(entryAutoCalc ? autoCalcEntry(newForm) : newForm)
                }} style={INPUT}>
                  <option value="">— Select employee —</option>
                  {employees.filter(e => e.is_active).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </FormRow>
              <FormRow label="Cutoff Date *">
                <DateInput value={entryForm.cutoff_date} onChange={e => setEntryForm(f => ({ ...f, cutoff_date: e.target.value }))} style={INPUT} />
              </FormRow>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={entryAutoCalc} onChange={e => setEntryAutoCalc(e.target.checked)} />
              Auto-calculate from employee rates
            </label>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Earnings</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <FormRow label="Basic Days"><input type="number" value={entryForm.basic_days} onChange={e => { const f = { ...entryForm, basic_days: e.target.value }; setEntryForm(entryAutoCalc ? autoCalcEntry(f) : f) }} style={INPUT} /></FormRow>
                <FormRow label="Basic Salary"><input type="number" value={entryForm.basic_salary} onChange={e => setEntryForm(f => ({ ...f, basic_salary: e.target.value }))} style={INPUT} /></FormRow>
                <FormRow label="Allowance"><input type="number" value={entryForm.allowance} onChange={e => setEntryForm(f => ({ ...f, allowance: e.target.value }))} style={INPUT} /></FormRow>
                <FormRow label="OT Hours"><input type="number" value={entryForm.overtime_hours} onChange={e => {
                  const f = { ...entryForm, overtime_hours: e.target.value }
                  const otPay = (parseFloat(e.target.value)||0) * (parseFloat(f.overtime_rate)||0)
                  setEntryForm(entryAutoCalc ? autoCalcEntry(f) : { ...f, overtime_pay: otPay.toFixed(2) })
                }} style={INPUT} /></FormRow>
                <FormRow label="OT Rate (per hr)"><input type="number" value={entryForm.overtime_rate} onChange={e => {
                  const f = { ...entryForm, overtime_rate: e.target.value }
                  const otPay = (parseFloat(entryForm.overtime_hours)||0) * (parseFloat(e.target.value)||0)
                  setEntryForm(entryAutoCalc ? autoCalcEntry(f) : { ...f, overtime_pay: otPay.toFixed(2) })
                }} style={INPUT} /></FormRow>
                <FormRow label="OT Pay"><input type="number" value={entryForm.overtime_pay} onChange={e => setEntryForm(f => ({ ...f, overtime_pay: e.target.value }))} style={INPUT} /></FormRow>
                <FormRow label="Rest Day Duty"><input type="number" value={entryForm.rest_day_duty} onChange={e => setEntryForm(f => ({ ...f, rest_day_duty: e.target.value }))} placeholder="0" style={INPUT} /></FormRow>
                <FormRow label="Salary Adjustment"><input type="number" value={entryForm.salary_adjustment} onChange={e => setEntryForm(f => ({ ...f, salary_adjustment: e.target.value }))} placeholder="0" style={INPUT} /></FormRow>
                <FormRow label="Hazard Rate"><input type="number" value={entryForm.hazard_rate} onChange={e => setEntryForm(f => ({ ...f, hazard_rate: e.target.value }))} placeholder="0" style={INPUT} /></FormRow>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Deductions</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <FormRow label="Cash Advance Deduction">
                  <input type="number" value={entryForm.cash_advance_deduction} onChange={e => setEntryForm(f => ({ ...f, cash_advance_deduction: e.target.value }))} placeholder="0" style={INPUT} />
                  {entryForm.employee_id && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>CA Balance: ₱{fmt(getCaBalance(entryForm.employee_id))}</div>}
                </FormRow>
                <FormRow label="HDMF Loan"><input type="number" value={entryForm.hdmf_loan} onChange={e => setEntryForm(f => ({ ...f, hdmf_loan: e.target.value }))} placeholder="0" style={INPUT} /></FormRow>
                <FormRow label="HDMF Premium"><input type="number" value={entryForm.hdmf_premium} onChange={e => setEntryForm(f => ({ ...f, hdmf_premium: e.target.value }))} style={INPUT} /></FormRow>
                <FormRow label="PhilHealth Premium"><input type="number" value={entryForm.philhealth_premium} onChange={e => setEntryForm(f => ({ ...f, philhealth_premium: e.target.value }))} style={INPUT} /></FormRow>
                <FormRow label="SSS Loan"><input type="number" value={entryForm.sss_loan} onChange={e => setEntryForm(f => ({ ...f, sss_loan: e.target.value }))} placeholder="0" style={INPUT} /></FormRow>
                <FormRow label="SSS Premium"><input type="number" value={entryForm.sss_premium} onChange={e => setEntryForm(f => ({ ...f, sss_premium: e.target.value }))} style={INPUT} /></FormRow>
              </div>
            </div>
            {entryForm.employee_id && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', display: 'flex', gap: 20, fontSize: 13 }}>
                <span>Earnings: <strong style={{ color: '#16a34a' }}>₱{fmt(calcEarnings(entryForm))}</strong></span>
                <span>Deductions: <strong style={{ color: '#dc2626' }}>₱{fmt(calcDeductions(entryForm))}</strong></span>
                <span>Net Pay: <strong style={{ color: 'var(--accent)' }}>₱{fmt(calcNet(entryForm))}</strong></span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button onClick={() => { setShowEntryForm(false); setEditingEntryId(null); editingEntryIdRef.current = null; setEntryForm(EMPTY_ENTRY) }} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleSaveEntry} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save Entry'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* CA Form */}
      {showCaForm && (
        <Modal title={editingCaId ? 'Edit CA Record' : 'Add CA Record'} onClose={() => { setShowCaForm(false); setEditingCaId(null); setCaForm(EMPTY_CA) }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <FormRow label="Employee *">
              <select value={caForm.employee_id} onChange={e => setCaForm(f => ({ ...f, employee_id: e.target.value }))} style={INPUT}>
                <option value="">— Select employee —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </FormRow>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <FormRow label="Date *"><DateInput value={caForm.date} onChange={e => setCaForm(f => ({ ...f, date: e.target.value }))} style={INPUT} /></FormRow>
              <FormRow label="Type">
                <select value={caForm.type} onChange={e => setCaForm(f => ({ ...f, type: e.target.value }))} style={INPUT}>
                  <option value="advance">Cash Advance (↑ Balance)</option>
                  <option value="payment">Payment / Deduction (↓ Balance)</option>
                </select>
              </FormRow>
            </div>
            <FormRow label="Amount *"><input type="number" value={caForm.amount} onChange={e => setCaForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" style={INPUT} /></FormRow>
            <FormRow label="Description"><input value={caForm.description} onChange={e => setCaForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes" style={INPUT} /></FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setShowCaForm(false); setEditingCaId(null); setCaForm(EMPTY_CA) }} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleSaveCa} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* PIN Unlock Modal */}
      {pinUnlockModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => e.target === e.currentTarget && setPinUnlockModal(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', width: '100%', maxWidth: 360, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>🔓 Unlock Cutoff</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
              Enter an admin override PIN to unlock this payroll period.
            </p>
            <input
              value={pinUnlockInput}
              onChange={e => { setPinUnlockInput(e.target.value.toUpperCase()); setPinUnlockError('') }}
              onKeyDown={e => e.key === 'Enter' && handlePinUnlockSubmit()}
              placeholder="Override PIN (e.g. A12345)"
              maxLength={6}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: `1px solid ${pinUnlockError ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--text)', fontSize: 14, fontFamily: 'monospace', letterSpacing: '0.15em', boxSizing: 'border-box', marginBottom: 6 }}
              autoFocus
            />
            {pinUnlockError && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{pinUnlockError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setPinUnlockModal(null)} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handlePinUnlockSubmit} disabled={pinUnlocking} style={{ padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                {pinUnlocking ? 'Checking…' : 'Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signatory Dialog */}
      <SignatoryDialog open={sigDialog} onClose={() => setSigDialog(false)} onPrint={handlePrint} settings={settings} profile={profile} docType="Payroll" />

      {/* Confirm Modal */}
      {confirmModal && (
        <Modal title="Confirm" onClose={() => setConfirmModal(null)}>
          <p style={{ margin: '0 0 20px', fontSize: 14 }}>{confirmModal.message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => setConfirmModal(null)} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null) }} style={{ padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Confirm</button>
          </div>
        </Modal>
      )}

      {/* ── 13TH MONTH TAB ── */}
      {activeTab === '13th-month' && (
        <div>
          <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:16, flexWrap:'wrap' }}>
            <div>
              <label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Year</label>
              <select value={thirteenthYear} onChange={e=>{ setThirteenthYear(parseInt(e.target.value)); setThirteenthManual({}) }}
                style={{ padding:'7px 12px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', fontSize:13 }}>
                {[2024,2025,2026,2027,2028].map(y=><option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ fontSize:12, color:'var(--muted)', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6, padding:'8px 12px' }}>
              💡 <strong>PD 851:</strong> 13th Month = Total Basic Salary Earned ÷ 12. Green cells = from payroll system. White cells = enter manually.
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={() => fetch13thData(thirteenthYear)}
                style={{ padding:'8px 14px', background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', fontSize:13 }}>
                🔄 Refresh
              </button>
              <button onClick={handle13thPrint}
                style={{ padding:'8px 14px', background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', fontSize:13 }}>
                🖨️ Print PDF
              </button>
              <button onClick={handle13thExportExcel}
                style={{ padding:'8px 14px', background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', fontSize:13 }}>
                📊 Excel
              </button>
              <button onClick={saveAllManual} disabled={savingManual}
                style={{ padding:'8px 18px', background:'var(--accent)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:600 }}>
                {savingManual ? '⏳ Saving…' : '💾 Save Manual Entries'}
              </button>
            </div>
          </div>

          {thirteenthLoading ? <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Computing…</div> : (() => {
            const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            const empMap = {}
            thirteenthEmps.forEach(e => { empMap[String(e.id)] = { id:String(e.id), name:e.full_name, position:e.position, earned:{} } })
            thirteenthEntries.filter(entry => {
              const yr = (entry.cutoff_date||'').slice(0,4)
              return yr === String(thirteenthYear)
            }).forEach(entry => {
              const empId = String(entry.employee_id)
              if (!empMap[empId]) return
              // Use YYYY-MM string prefix to avoid timezone/date parsing issues
              const moIndex = parseInt((entry.cutoff_date || '').slice(5, 7), 10) - 1 // 0-based
              if (moIndex < 0 || moIndex > 11) return
              const moKey = months[moIndex]
              const cleanRate = String(entry.basic_rate||'0').replace(/,/g,'')
              const cleanDays = String(entry.basic_days||'0').replace(/,/g,'')
              const earned = (parseFloat(cleanRate)||0) * (parseFloat(cleanDays)||0)
              if (!empMap[empId].earned[moKey]) { empMap[empId].earned[moKey] = 0; empMap[empId].count = empMap[empId].count || {} }
              empMap[empId].earned[moKey] += earned
              empMap[empId].count[moKey] = (empMap[empId].count[moKey]||0) + 1
            })
            const rows = Object.values(empMap)
            if (!rows.length) return <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>No employees found.</div>
            return (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'var(--bg)', borderBottom:'2px solid var(--border)' }}>
                      <th style={{ padding:'8px 10px', textAlign:'left', color:'var(--muted)', fontWeight:600, fontSize:11, textTransform:'uppercase', position:'sticky', left:0, background:'var(--bg)', minWidth:140 }}>Employee</th>
                      {monthNames.map(m => <th key={m} style={{ padding:'8px 6px', textAlign:'right', color:'var(--muted)', fontWeight:600, fontSize:11, textTransform:'uppercase', minWidth:72 }}>{m}</th>)}
                      <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--accent)', fontWeight:700, fontSize:11, textTransform:'uppercase', minWidth:110 }}>Total Earned</th>
                      <th style={{ padding:'8px 10px', textAlign:'right', color:'#16a34a', fontWeight:700, fontSize:11, textTransform:'uppercase', minWidth:110 }}>13th Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(emp => {
                      const manual = thirteenthManual[emp.id] || {}
                      let totalEarned = 0
                      const cells = months.map(mo => {
                        const sys = emp.earned[mo] || 0
                        const man = parseFloat(manual[mo] || 0) || 0
                        const val = sys > 0 ? sys : man
                        totalEarned += val
                        return { mo, sys, man, val }
                      })
                      const thirteenth = totalEarned / 12
                      return (
                        <tr key={emp.id} style={{ borderBottom:'1px solid var(--border)' }}>
                          <td style={{ padding:'8px 10px', position:'sticky', left:0, background:'var(--surface)' }}>
                            <div style={{ fontWeight:600, fontSize:12 }}>{emp.name}</div>
                            <div style={{ fontSize:10, color:'var(--muted)' }}>{emp.position}</div>
                          </td>
                          {cells.map(({ mo, sys, man }) => (
                            <td key={mo} style={{ padding:'4px 3px', textAlign:'right' }}>
                              {sys > 0 ? (
                                <div style={{ fontSize:11, padding:'3px 5px', background:'rgba(22,163,74,0.08)', borderRadius:4, color:'var(--text)' }}
                                  title={(emp.count?.[mo]||0) + ' entr' + ((emp.count?.[mo]||0)===1?'y':'ies') + ' found'}>
                                  {Math.round(sys).toLocaleString('en-PH')}
                                </div>
                              ) : (
                                <input type="number" value={man||''} placeholder="0"
                                  onChange={e => setThirteenthManual(m => ({ ...m, [emp.id]: { ...(m[emp.id]||{}), [mo]: e.target.value } }))}

                                  style={{ width:68, padding:'3px 4px', borderRadius:4, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:11, textAlign:'right', boxSizing:'border-box' }} />
                              )}
                            </td>
                          ))}
                          <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:600, color:'var(--accent)', fontSize:12 }}>₱{Number(totalEarned).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                          <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, color:'#16a34a', fontSize:13 }}>₱{Number(thirteenth).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg)', fontWeight:700 }}>
                      <td style={{ padding:'8px 10px', fontSize:12 }}>TOTAL</td>
                      {months.map(mo => <td key={mo} />)}
                      <td style={{ padding:'8px 10px', textAlign:'right', color:'var(--accent)' }}>
                        ₱{Number(rows.reduce((s,emp) => { const manual=thirteenthManual[emp.id]||{}; return s+months.reduce((ms,mo)=>ms+(emp.earned[mo]||0)+(emp.earned[mo]>0?0:parseFloat(manual[mo]||0)||0),0) },0)).toLocaleString('en-PH',{minimumFractionDigits:2})}
                      </td>
                      <td style={{ padding:'8px 10px', textAlign:'right', color:'#16a34a' }}>
                        ₱{Number(rows.reduce((s,emp) => { const manual=thirteenthManual[emp.id]||{}; const t=months.reduce((ms,mo)=>ms+(emp.earned[mo]||0)+(emp.earned[mo]>0?0:parseFloat(manual[mo]||0)||0),0); return s+t/12 },0)).toLocaleString('en-PH',{minimumFractionDigits:2})}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}

      {/* ══ TAB: PAYSLIP GENERATOR ══ */}
      {activeTab === 'payslip' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 }}>
            <div>
              <h2 style={{ margin:0, fontSize:16, fontWeight:600 }}>Payslip Generator</h2>
              <p style={{ margin:'2px 0 0', fontSize:12, color:'var(--muted)' }}>Fill up to 6 cutoffs — prints one payslip per page. Deductions shared across all cutoffs.</p>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button className="btn-ghost" onClick={() => { setPayslipForm(EMPTY_PAYSLIP); setCurrentDraftId(null) }}>🗑️ Clear</button>
              <button className="btn-ghost" onClick={handleSavePayslipDraft}>
                💾 {currentDraftId ? 'Update Draft' : 'Save Draft'}
              </button>
              <button className="btn-primary" onClick={() => handlePrintPayslip()}>🖨️ Print Payslip(s)</button>
            </div>
          </div>

          {/* Saved Drafts */}
          {payslipDrafts.length > 0 && (
            <div className="card" style={{ marginBottom:16 }}>
              <p className="section-label" style={{ marginTop:0 }}>Saved Drafts</p>
              {draftsLoading ? <div style={{ color:'var(--muted)', fontSize:12 }}>Loading…</div> : (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {payslipDrafts.map(d => (
                    <div key={d.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8, background: currentDraftId===d.id?'var(--accent-light)':'var(--bg)', border:`1px solid ${currentDraftId===d.id?'var(--accent)':'var(--border)'}` }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:13 }}>{d.employee_name}</div>
                        <div style={{ fontSize:11, color:'var(--muted)' }}>{d.position} · Saved {new Date(d.updated_at).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</div>
                      </div>
                      <button className="btn-ghost btn-sm" onClick={() => handleLoadPayslipDraft(d)}>📂 Load</button>
                      <button className="btn-ghost btn-sm" style={{ color:'var(--danger)' }} onClick={() => handleDeletePayslipDraft(d.id)}>🗑️</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Employee Info */}
          <div className="card" style={{ marginBottom:16 }}>
            <p className="section-label" style={{ marginTop:0 }}>Employee Information</p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="form-group">
                <label className="label required">Employee Name</label>
                <input list="payslip-emp-list" value={payslipForm.employee_name} onChange={e => {
                  const emp = employees.find(em => em.full_name === e.target.value)
                  if (emp) {
                    const basicSemi = ((parseFloat(emp.basic_rate_monthly||0)/26)*13).toFixed(2)
                    const allowSemi = (parseFloat(emp.allowance_monthly||0)/2).toFixed(2)
                    setPayslipForm(f => ({
                      ...f,
                      employee_name: emp.full_name,
                      position: emp.position||'',
                      cutoffs: f.cutoffs.map(c => ({ ...c, basic_salary: basicSemi, allowance: allowSemi })),
                      sss: (parseFloat(emp.sss_employee||0)/2).toFixed(2),
                      philhealth: (parseFloat(emp.philhealth_employee||0)/2).toFixed(2),
                      hdmf: (parseFloat(emp.hdmf_premium||emp.hdmf||0)/2).toFixed(2),
                    }))
                  } else {
                    setPayslipForm(f => ({ ...f, employee_name: e.target.value }))
                  }
                }} placeholder="Type or select employee" />
                <datalist id="payslip-emp-list">
                  {employees.map(e => <option key={e.id} value={e.full_name} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label className="label">Position / Designation</label>
                <input value={payslipForm.position} onChange={e => setPayslipForm(f => ({...f, position: e.target.value}))} placeholder="e.g. Driver, Billing Staff" />
              </div>
            </div>
          </div>

          {/* Cutoff rows */}
          <div className="card" style={{ marginBottom:16 }}>
            <p className="section-label" style={{ marginTop:0 }}>Cutoff Periods & Earnings <span style={{ fontWeight:400, color:'var(--muted)', fontSize:11 }}>(fill only the cutoffs needed — blank rows are skipped on print)</span></p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:12 }}>
              {payslipForm.cutoffs.map((c, idx) => {
                const p2 = v => parseFloat(String(v||'0').replace(/,/g,''))||0
                const totalDed = ['sss','philhealth','hdmf','sss_loan','hdmf_loan','ca_deduction','other_deductions'].reduce((s,k) => s+p2(payslipForm[k]), 0)
                const totalEarn = ['basic_salary','allowance','overtime_pay','rest_day','holiday_pay','salary_adjustment','other_earnings'].reduce((s,k) => s+p2(c[k]), 0)
                const net = totalEarn - totalDed
                const hasData = c.period_from || c.basic_salary
                const numInp = (key, label) => (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:4 }}>
                    <label style={{ fontSize:12, color:'var(--muted)', whiteSpace:'nowrap', minWidth:130 }}>{label}</label>
                    <input type="number" step="0.01" value={c[key]} onChange={e => updateCutoff(idx, key, e.target.value)}
                      style={{ width:110, padding:'4px 8px', borderRadius:5, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:12, textAlign:'right' }} placeholder="0.00" />
                  </div>
                )
                return (
                  <div key={idx} style={{
                    border: `1.5px solid ${hasData ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius:10, padding:12,
                    background: hasData ? 'var(--accent-light)' : 'var(--surface)',
                    opacity: hasData ? 1 : 0.65,
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                      <span style={{ fontWeight:700, fontSize:13, color: hasData?'var(--accent)':'var(--muted)' }}>Cutoff {idx+1}</span>
                      {hasData && <span style={{ fontSize:12, fontWeight:600, color: net>=0?'var(--success)':'var(--danger)' }}>Net: ₱{Number(net).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>}
                    </div>

                    {/* Period pickers */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
                      <div className="form-group" style={{ margin:0 }}>
                        <label className="label" style={{ fontSize:10 }}>Period From</label>
                        <DateInput value={c.period_from} onChange={e => updateCutoff(idx, 'period_from', e.target.value)} style={{ fontSize:12 }} />
                      </div>
                      <div className="form-group" style={{ margin:0 }}>
                        <label className="label" style={{ fontSize:10 }}>Period To</label>
                        <DateInput value={c.period_to} onChange={e => updateCutoff(idx, 'period_to', e.target.value)} style={{ fontSize:12 }} />
                      </div>
                      <div className="form-group" style={{ margin:0, gridColumn:'1 / -1' }}>
                        <label className="label" style={{ fontSize:10 }}>Pay Date</label>
                        <DateInput value={c.pay_date} onChange={e => updateCutoff(idx, 'pay_date', e.target.value)} style={{ fontSize:12 }} />
                      </div>
                    </div>

                    {/* Earnings */}
                    <div style={{ borderTop:'1px solid var(--border)', paddingTop:8 }}>
                      {numInp('basic_salary', 'Basic Salary')}
                      {numInp('allowance', 'Allowance')}
                      {numInp('overtime_pay', 'Overtime Pay')}
                      {numInp('rest_day', 'Rest Day Duty')}
                      {numInp('holiday_pay', 'Holiday Pay')}
                      {numInp('salary_adjustment', 'Adjustment')}
                      {numInp('other_earnings', 'Other Earnings')}
                    </div>

                    {hasData && (
                      <div style={{ marginTop:8, borderTop:'1px solid var(--border)', paddingTop:6, display:'flex', justifyContent:'space-between', fontSize:11 }}>
                        <span style={{ color:'var(--muted)' }}>Earnings</span>
                        <span style={{ fontWeight:600 }}>₱{Number(totalEarn).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {/* Shared Deductions */}
          <div className="card">
            <p className="section-label" style={{ marginTop:0, color:'var(--danger)' }}>➖ Deductions <span style={{ fontWeight:400, fontSize:11, color:'var(--muted)' }}>(per cutoff / semi-monthly — same amount applied to each printed payslip)</span></p>
            <div style={{ fontSize:12, color:'var(--muted)', marginBottom:10, padding:'6px 10px', background:'var(--bg)', borderRadius:6 }}>
              💡 Enter the <strong>semi-monthly</strong> amount (monthly ÷ 2) for each deduction. Auto-filled from the employee record when you select an employee.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[
                ['sss','SSS Premium'],['philhealth','PhilHealth Premium'],['hdmf','HDMF (Pag-IBIG) Premium'],
                ['sss_loan','SSS Loan'],['hdmf_loan','HDMF Loan'],['ca_deduction','Cash Advance'],['other_deductions','Other Deductions'],
              ].map(([key,label]) => (
                <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
                  <label style={{ fontSize:13, flex:1, color:'var(--text)' }}>{label}</label>
                  <input type="number" step="0.01" value={payslipForm[key]} onChange={e => setPayslipForm(f => ({...f, [key]: e.target.value}))}
                    style={{ width:130, padding:'5px 8px', textAlign:'right', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13 }} placeholder="0.00" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PRINT COMPONENT ────────────────────────────────────────────────────────
function PrintPayroll({ entries, sigs = [], selectedCutoff, calcEarnings, calcDeductions, calcNet, grandEarnings, grandDeductions, grandNet, settings = {}, caRecords = [], allPayrollEntries = [] }) {
  const d = new Date(selectedCutoff + 'T00:00:00')
  const day = d.getDate()
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const periodLabel = day === 15
    ? `${d.toLocaleDateString('en-PH', { month: 'long' })} 1-15, ${d.getFullYear()}`
    : `${d.toLocaleDateString('en-PH', { month: 'long' })} 16-${lastDay}, ${d.getFullYear()}`

  const generatedAt = new Date().toLocaleString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })

  const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
  const address = settings.address || ''
  const contact = settings.contact || ''
  const email = settings.email || ''
  const vatTin = settings.vat_tin || ''

  // CA balance = total advances from CA ledger
  //             - total payments from CA ledger
  //             - total cash_advance_deductions from all payroll entries up to & including this cutoff
  const getCaBalance = (employeeId) => {
    const recs = caRecords.filter(r => r.employee_id === employeeId)
    const totalAdvance = recs.filter(r => r.type === 'advance').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const totalCaLedgerPayments = recs.filter(r => r.type === 'payment').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    // Sum all payroll deductions for this employee on cutoffs <= current cutoff
    const totalPayrollDeductions = allPayrollEntries
      .filter(pe => pe.employee_id === employeeId && pe.cutoff_date <= selectedCutoff)
      .reduce((s, pe) => s + (parseFloat(pe.cash_advance_deduction) || 0), 0)
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

  return (
    <div style={S.page}>
      {/* Company Header */}
      <div style={S.companyName}>{companyName}</div>
      {address && <div style={S.companyInfo}>{address}</div>}
      {(contact || email) && <div style={S.companyInfo}>{[contact, email].filter(Boolean).join(' | ')}</div>}
      {vatTin && <div style={S.companyInfo}>TIN: {vatTin}</div>}

      <div style={S.docTitle}>PAYROLL</div>
      <div style={S.period}>For the period: <strong>{periodLabel}</strong></div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th} rowSpan={2}>#</th>
            <th style={{ ...S.th, textAlign: 'left', minWidth: 120, whiteSpace: 'nowrap' }} rowSpan={2}>EMPLOYEE</th>
            <th style={S.th} colSpan={6}>EARNINGS</th>
            <th style={S.thGreen} rowSpan={2}>EARNING<br/>TOTAL</th>
            <th style={S.th} colSpan={6}>DEDUCTIONS</th>
            <th style={S.thRed} rowSpan={2}>DEDUCTION<br/>TOTAL</th>
            <th style={S.thBlue} rowSpan={2}>NET<br/>SALARY</th>
            <th style={S.th} rowSpan={2}>SIGNATURE<br/>&amp; DATE</th>
            <th style={{ ...S.th, color: '#c00000' }} rowSpan={2}>CA<br/>BALANCE</th>
          </tr>
          <tr>
            <th style={S.th}>BASIC<br/>DAYS</th>
            <th style={S.th}>BASIC<br/>SALARY</th>
            <th style={S.th}>OVER<br/>TIME</th>
            <th style={S.th}>REST<br/>DAY</th>
            <th style={S.th}>SAL.<br/>ADJ.</th>
            <th style={S.th}>ALLOW-<br/>ANCE</th>
            <th style={S.th}>CASH<br/>ADV</th>
            <th style={S.th}>HDMF<br/>LOAN</th>
            <th style={S.th}>HDMF<br/>PREM</th>
            <th style={S.th}>PHIC<br/>PREM</th>
            <th style={S.th}>SSS<br/>LOAN</th>
            <th style={S.th}>SSS<br/>PREM</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const earn = calcEarnings(e)
            const ded = calcDeductions(e)
            const net = earn - ded
            const caBalance = getCaBalance(e.employee_id)
            return (
              <tr key={e.id}>
                <td style={S.td}>{i + 1}</td>
                <td style={S.tdL}>{e.payroll_employees?.full_name || ''}</td>
                <td style={S.td}>{e.basic_days}</td>
                <td style={S.td}>{pfmt(e.basic_salary)}</td>
                <td style={S.td}>{pfmt(e.overtime_pay)}</td>
                <td style={S.td}>{pfmt(e.rest_day_duty)}</td>
                <td style={S.td}>{pfmt(e.salary_adjustment)}</td>
                <td style={S.td}>{pfmt(e.allowance)}</td>
                <td style={S.tdGreen}>{nfmt(earn)}</td>
                <td style={S.td}>{pfmt(e.cash_advance_deduction)}</td>
                <td style={S.td}>{pfmt(e.hdmf_loan)}</td>
                <td style={S.td}>{pfmt(e.hdmf_premium)}</td>
                <td style={S.td}>{pfmt(e.philhealth_premium)}</td>
                <td style={S.td}>{pfmt(e.sss_loan)}</td>
                <td style={S.td}>{pfmt(e.sss_premium)}</td>
                <td style={S.tdRed}>{nfmt(ded)}</td>
                <td style={S.tdBlue}>{nfmt(net)}</td>
                <td style={{ ...S.td, minWidth: 60 }}></td>
                <td style={{ ...S.tdCA }}>{caBalance > 0 ? nfmt(caBalance) : '—'}</td>
              </tr>
            )
          })}
          {/* Grand Total */}
          <tr style={{ fontWeight: 'bold', background: '#f0f0f0' }}>
            <td style={{ ...S.td, fontWeight: 'bold' }} colSpan={2}>GRAND TOTAL</td>
            <td style={S.td}></td>
            <td style={S.td}>{nfmt(entries.reduce((s,e)=>s+(parseFloat(e.basic_salary)||0),0))}</td>
            <td style={S.td}>{nfmt(entries.reduce((s,e)=>s+(parseFloat(e.overtime_pay)||0),0))}</td>
            <td style={S.td}></td>
            <td style={S.td}></td>
            <td style={S.td}>{nfmt(entries.reduce((s,e)=>s+(parseFloat(e.allowance)||0),0))}</td>
            <td style={{ ...S.tdGreen, fontWeight: 'bold' }}>{nfmt(grandEarnings)}</td>
            <td style={S.td}>{nfmt(entries.reduce((s,e)=>s+(parseFloat(e.cash_advance_deduction)||0),0))}</td>
            <td style={S.td}></td>
            <td style={S.td}>{nfmt(entries.reduce((s,e)=>s+(parseFloat(e.hdmf_premium)||0),0))}</td>
            <td style={S.td}>{nfmt(entries.reduce((s,e)=>s+(parseFloat(e.philhealth_premium)||0),0))}</td>
            <td style={S.td}></td>
            <td style={S.td}>{nfmt(entries.reduce((s,e)=>s+(parseFloat(e.sss_premium)||0),0))}</td>
            <td style={{ ...S.tdRed, fontWeight: 'bold' }}>{nfmt(grandDeductions)}</td>
            <td style={{ ...S.tdBlue, fontWeight: 'bold' }}>{nfmt(grandNet)}</td>
            <td style={S.td} colSpan={2}></td>
          </tr>
        </tbody>
      </table>

      {/* Signatories */}
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

      {/* Generated timestamp */}
      <div style={{ marginTop: 16, fontSize: 10, color: '#888', textAlign: 'right', borderTop: '0.5px solid #ccc', paddingTop: 4 }}>
        System-generated document · Printed: {generatedAt}
      </div>
    </div>
  )
}

// ── SUB-COMPONENTS ──────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px 10px', overflowY: 'auto', backdropFilter: 'none' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', width: '100%', maxWidth: wide ? 780 : 480, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', isolation: 'isolate', opacity: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '18px' }}>{children}</div>
      </div>
    </div>
  )
}

function FormRow({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

// ── SHARED STYLES ───────────────────────────────────────────────────────────
const TH = { padding: '8px 6px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const TD = { padding: '8px 6px', textAlign: 'center', fontSize: 12, whiteSpace: 'nowrap' }
const INPUT = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }
const ActionBtn = (bg) => ({ padding: '4px 8px', background: bg, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 })
