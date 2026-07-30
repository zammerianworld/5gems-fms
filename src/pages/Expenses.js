import { useState, useEffect, useCallback } from 'react'
import DateInput from '../components/DateInput'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, fmt, fmtDate, sortRows, logAudit, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'

const ADMIN_CATEGORIES = [
  'Office Supplies', 'Utilities', 'Internet / Phone', 'Rent',
  'Salaries — Admin', 'Government Fees', 'Insurance — Company',
  'Representation', 'Miscellaneous Admin', 'Others',
]
const OPERATION_CATEGORIES = [
  'Fuel — PO', 'Fuel — Cash',
  'Oil / Lubricants', 'Tire',
  'Maintenance — Parts', 'Maintenance — Labor',
  'Driver Salary', 'Driver Allowance',
  'Royalty', 'SOP',
  'Toll Fees', 'Parking',
  'LTO Registration', 'Others',
]

// ── ADMIN IMPORT: Category keyword detection ─────────────────────────────────
const ADMIN_CATEGORY_KEYWORDS = {
  'Office Supplies': ['office supply', 'office supplies', 'paper', 'ink', 'toner', 'printer', 'stationery', 'ballpen', 'folder', 'envelope', 'supplies'],
  'Utilities': ['electric', 'electricity', 'meralco', 'water', 'davao light', 'power bill', 'utility', 'utilities', 'light bill'],
  'Internet / Phone': ['internet', 'phone', 'mobile', 'load', 'globe', 'smart', 'pldt', 'telco', 'wifi', 'data plan', 'broadband'],
  'Rent': ['rent', 'rental', 'lease', 'space rent'],
  'Salaries — Admin': ['salary', 'salaries', 'payroll', 'wage', 'allowance', 'bonus', '13th month', 'compensation', 'overtime pay'],
  'Government Fees': ['bir', 'lto', 'ltfrb', 'philhealth', 'sss', 'pagibig', 'hdmf', 'government', 'permit', 'license', 'registration fee', 'tax', 'municipal', 'barangay', 'fees'],
  'Insurance — Company': ['insurance', 'insur', 'premium', 'coverage'],
  'Representation': ['representation', 'entertainment', 'meals', 'food', 'dining', 'meeting', 'client visit', 'snack', 'lunch', 'dinner'],
  'Miscellaneous Admin': ['miscellaneous', 'misc', 'other admin'],
}

const detectAdminCategory = (particulars) => {
  if (!particulars) return 'Others'
  const lower = particulars.toLowerCase()
  for (const [category, keywords] of Object.entries(ADMIN_CATEGORY_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return category
  }
  return 'Others'
}

const parseExpenseDate = (raw) => {
  if (!raw) return null
  if (typeof raw === 'number') {
    const date = new Date((raw - 25569) * 86400 * 1000)
    return date.toISOString().split('T')[0]
  }
  const str = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`
  const dmy = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  const d = new Date(str)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  return null
}


// ── MONTH PICKER HELPER ──────────────────────────────────────────────────────
const MONTHS = [
  {val:'01',label:'January'},{val:'02',label:'February'},{val:'03',label:'March'},
  {val:'04',label:'April'},{val:'05',label:'May'},{val:'06',label:'June'},
  {val:'07',label:'July'},{val:'08',label:'August'},{val:'09',label:'September'},
  {val:'10',label:'October'},{val:'11',label:'November'},{val:'12',label:'December'},
]
const YEARS = [2024, 2025, 2026, 2027]
const MonthPicker = ({ value, onChange, style = {} }) => {
  const yr = value ? value.slice(0,4) : ''
  const mo = value ? value.slice(5,7) : ''
  return (
    <div style={{ display:'flex', gap:4, ...style }}>
      <select value={yr} onChange={e => { const y = e.target.value; onChange(y && mo ? `${y}-${mo}` : '') }} style={{ width:74 }}>
        <option value="">Year</option>
        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select value={mo} onChange={e => { const m = e.target.value; const y = yr || new Date().getFullYear(); onChange(m && y ? `${y}-${m}` : '') }} style={{ width:108 }}>
        <option value="">Month</option>
        {MONTHS.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
      </select>
    </div>
  )
}

const ALL_TABS = ['All Expenses', 'Per Truck View', 'Amortization', 'Insurance', 'Stocks']
const STAFF_TABS = ['All Expenses', 'Per Truck View', 'Stocks']
const EMPTY = {
  expense_date: new Date().toISOString().slice(0, 10),
  expense_type: 'operation',
  category: '', description: '', amount: '',
  scope: 'all', truck_id: '', reference_no: '', remarks: '',
  is_recurring: false, payment_method: 'cash',
}
const EMPTY_AMORT = {
  truck_id: '', description: '', monthly_amount: '',
  start_date: new Date().toISOString().slice(0, 7),
  end_date: '', remarks: '',
}
const EMPTY_INS = {
  insurance_type: 'Cargo Insurance',
  policy_no: '',
  description: '', annual_amount: '',
  start_date: new Date().toISOString().slice(0, 10),
  truck_ids: [], remarks: '',
}

export default function Expenses() {
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()
  const [expenses, setExpenses] = useState([])
  const [trucks, setTrucks] = useState([])
  const [amortizations, setAmortizations] = useState([])
  const [insurances, setInsurances] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [amortForm, setAmortForm] = useState(EMPTY_AMORT)
  const [insForm, setInsForm] = useState(EMPTY_INS)
  const [editId, setEditId] = useState(null)
  const [editAmortId, setEditAmortId] = useState(null)
  const [editInsId, setEditInsId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [showAmortForm, setShowAmortForm] = useState(false)
  const [showInsForm, setShowInsForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState('expense_date')
  const [sortDir, setSortDir] = useState('desc')
  const toggleSort = (k) => { setSortKey(k); setSortDir(d => k === sortKey ? (d === 'asc' ? 'desc' : 'asc') : 'desc') }
  const [customAdminCats, setCustomAdminCats] = useState([])
  const [customOpCats, setCustomOpCats] = useState([])
  const [showCatManager, setShowCatManager] = useState(false)
  const [newAdminCat, setNewAdminCat] = useState('')
  const [newOpCat, setNewOpCat] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [tab, setTab] = useState('All Expenses')
  // ── IMPORT STATE ──
  const [importData, setImportData] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  // Filters
  const [filterMonth, setFilterMonth] = useState('')
  const [filterScope, setFilterScope] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterTruck, setFilterTruck] = useState('')
  const [stocks, setStocks] = useState([])
  const [stocksLoading, setStocksLoading] = useState(false)
  const [showStockForm, setShowStockForm] = useState(false)
  const [editingStockId, setEditingStockId] = useState(null)
  const [stockForm, setStockForm] = useState({ purchase_date: new Date().toISOString().slice(0,10), category:'', description:'', quantity:1, unit:'', unit_cost:'', reference_no:'', notes:'' })
  const [stockFilterCat, setStockFilterCat] = useState('')
  const [stockSearch, setStockSearch] = useState('')
  const [allocateModal, setAllocateModal] = useState(null)
  const [filterCat, setFilterCat] = useState('')
  const [filterPayment, setFilterPayment] = useState('')
  const [ptTruck, setPtTruck] = useState('')
  const [amortFilterTruck, setAmortFilterTruck] = useState('')
  const [amortFilterStatus, setAmortFilterStatus] = useState('')
  const [insFilterType, setInsFilterType] = useState('')
  const [insFilterTruck, setInsFilterTruck] = useState('')
  const [insSearch, setInsSearch] = useState('')
  const [ptMonth, setPtMonth] = useState('')
  const [ptType, setPtType] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('ds_custom_cats')
    if (saved) {
      const parsed = JSON.parse(saved)
      setCustomAdminCats(parsed.admin || [])
      setCustomOpCats(parsed.op || [])
    }
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [exp, tr, am, ins] = await Promise.all([
      fetchAllRows(() => supabase.from('expenses').select('*').is('deleted_at', null).order('expense_date', { ascending: false })),
      supabase.from('trucks').select('*').order('truck_type').order('plate'),
      supabase.from('amortizations').select('*').order('start_date', { ascending: false }),
      supabase.from('insurances').select('*').order('start_date', { ascending: false }),
    ])
    if (exp.data) setExpenses(exp.data)
    if (tr.data) setTrucks(tr.data)
    if (am.data) setAmortizations(am.data)
    if (ins.data) setInsurances(ins.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const fetchStocks = useCallback(async () => {
    setStocksLoading(true)
    const { data } = await supabase.from('expense_stocks').select('*').order('purchase_date', { ascending: false })
    setStocks(data || [])
    setStocksLoading(false)
  }, [])

  useEffect(() => { if (tab === 'Stocks') fetchStocks() }, [tab, fetchStocks])

  const handleSaveStock = async () => {
    if (!stockForm.category || !stockForm.description || !stockForm.unit_cost) {
      showToast('Category, description, and unit cost are required.', 'error'); return
    }
    const qty = parseInt(stockForm.quantity)||1
    const unitCost = parseFloat(stockForm.unit_cost)||0
    const totalCost = qty * unitCost
    const stockPayload = { ...stockForm, quantity: qty, quantity_remaining: qty, unit_cost: unitCost, total_cost: totalCost, created_by: profile?.id }
    if (editingStockId) {
      const { error } = await supabase.from('expense_stocks').update(stockPayload).eq('id', editingStockId)
      if (error) { showToast('Error: ' + error.message, 'error'); return }
      showToast('Updated.')
    } else {
      const expPayload = { expense_date: stockForm.purchase_date, expense_type: 'operation', category: stockForm.category, description: '[STOCK] ' + stockForm.description, amount: totalCost, scope: 'all', truck_id: null, reference_no: stockForm.reference_no||null, is_from_stock: false, created_by: profile?.id }
      const { data: expData, error: expErr } = await supabase.from('expenses').insert(expPayload).select().single()
      if (expErr) { showToast('Error creating expense: ' + expErr.message, 'error'); return }
      const { error: stockErr } = await supabase.from('expense_stocks').insert({ ...stockPayload, expense_id: expData.id })
      if (stockErr) { showToast('Error: ' + stockErr.message, 'error'); return }
      logAudit('generate', 'Added', 'Expenses', 'Added stock: ' + stockPayload.description + ' ₱' + fmt(totalCost), '', profile?.id, profile?.full_name)
      showToast('Stock added — expense recorded in cash flow.')
      fetchAll()
    }
    setShowStockForm(false); setEditingStockId(null)
    setStockForm({ purchase_date: new Date().toISOString().slice(0,10), category:'', description:'', quantity:1, unit:'', unit_cost:'', reference_no:'', notes:'' })
    fetchStocks()
  }

  const handleAllocateStock = (stock) => {
    setAllocateModal({ stock, qty: 1, truck_id: '', alloc_date: new Date().toISOString().slice(0,10) })
  }

  const confirmAllocate = async () => {
    const { stock, qty, truck_id, alloc_date } = allocateModal
    if (!truck_id) { showToast('Select a truck.', 'error'); return }
    const allocQty = parseInt(qty)||1
    if (allocQty < 1 || allocQty > stock.quantity_remaining) { showToast('Invalid quantity.', 'error'); return }
    const allocAmount = stock.unit_cost * allocQty
    const expPayload = { expense_date: alloc_date, expense_type: 'operation', category: stock.category, description: stock.description + (allocQty > 1 ? ' (' + allocQty + ' ' + (stock.unit||'pcs') + ')' : ''), amount: allocAmount, scope: 'individual', truck_id, reference_no: stock.reference_no||null, is_from_stock: true, stock_id: stock.id, created_by: profile?.id }
    const { error: expErr } = await supabase.from('expenses').insert(expPayload)
    if (expErr) { showToast('Error: ' + expErr.message, 'error'); return }
    const newQty = stock.quantity_remaining - allocQty
    await supabase.from('expense_stocks').update({ quantity_remaining: newQty }).eq('id', stock.id)
    logAudit('generate', 'Allocated', 'Expenses', 'Allocated ' + allocQty + ' ' + stock.description + ' to truck', stock.id, profile?.id, profile?.full_name)
    showToast('Allocated — truck expense added (no cash out).')
    setAllocateModal(null)
    fetchStocks(); fetchAll()
  }

  const handleDeleteStock = async (id) => {
    const { error } = await supabase.from('expense_stocks').delete().eq('id', id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Deleted.', 'info'); fetchStocks() }
  }

  // ── ADMIN IMPORT HANDLERS ─────────────────────────────────────────────────
  const handleAdminImportFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        // Find header row
        let headerIdx = 0
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          const rowStr = rows[i].join('|').toLowerCase()
          if (rowStr.includes('date') && rowStr.includes('amount')) { headerIdx = i; break }
        }
        const headers = rows[headerIdx].map(h => String(h).toLowerCase().trim())
        const dateCol = headers.findIndex(h => h.includes('date'))
        const descCol = headers.findIndex(h => h.includes('particular') || h.includes('description') || h.includes('remark'))
        const amtCol = headers.findIndex(h => h.includes('amount') || h.includes('amt'))

        if (dateCol === -1 || amtCol === -1) {
          setImportErrors(['Could not find required columns. Make sure your Excel has: Date, Particulars, Amount'])
          return
        }

        const parsed = []
        const errors = []
        rows.slice(headerIdx + 1).forEach((row, i) => {
          if (!row[dateCol] && !row[amtCol]) return
          const lineNo = i + headerIdx + 2
          const date = parseExpenseDate(row[dateCol])
          if (!date) { errors.push(`Row ${lineNo}: Invalid date "${row[dateCol]}"`); return }
          const amount = parseFloat(String(row[amtCol]).replace(/,/g, ''))
          if (!amount || amount <= 0) { errors.push(`Row ${lineNo}: Invalid amount "${row[amtCol]}"`); return }
          const description = descCol >= 0 ? String(row[descCol] || '').trim() : ''
          const category = detectAdminCategory(description)
          parsed.push({ expense_date: date, description, amount, category, expense_type: 'admin', scope: 'all', truck_id: null, payment_method: 'cash' })
        })
        setImportData(parsed)
        setImportErrors(errors)
      } catch (err) {
        setImportErrors(['Failed to read file: ' + err.message])
      }
    }
    reader.readAsBinaryString(file)
    e.target.value = ''
  }

  const handleAdminImportSave = async () => {
    if (!importData.length) return
    setImporting(true)
    let saved = 0, failed = 0
    for (let i = 0; i < importData.length; i += 20) {
      const batch = importData.slice(i, i + 20)
      const { error } = await supabase.from('expenses').insert(batch)
      if (error) failed += batch.length
      else saved += batch.length
    }
    setImporting(false)
    setImportData([])
    setImportErrors([])
    setShowImport(false)
    fetchAll()
    showToast(`Imported ${saved} expense entries.${failed ? ` ${failed} failed.` : ''}`, failed ? 'error' : 'success')
  }

  // ── PRINT FUNCTIONS ────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    const companyName = (localStorage.getItem('ds_company_name') || 'DRAGON SPEED TRUCKING CORPORATION').toUpperCase()
    const today2 = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
    const total = filtered.reduce((s,e) => s+(parseFloat(e.amount)||0), 0)
    const byCategory = {}
    filtered.forEach(e => { const k=e.category||'Uncategorized'; if(!byCategory[k])byCategory[k]=0; byCategory[k]+=parseFloat(e.amount)||0 })

    const wb = new ExcelJS.Workbook()
    const COLS = 8
    const ws = wb.addWorksheet('Expenses')
    ws.columns = [{width:12},{width:11},{width:14},{width:16},{width:16},{width:32},{width:13},{width:14}]
    const thin = { style:'thin', color:{argb:'FFAAAAAA'} }
    const allBorders = { top:thin, left:thin, bottom:thin, right:thin }

    let r = 1
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = companyName
    ws.getCell(r,1).font = { bold:true, size:13 }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    r++
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = 'EXPENSES REPORT'
    ws.getCell(r,1).font = { bold:true, size:11 }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    ws.getCell(r,1).border = { bottom:{style:'medium', color:{argb:'FF000000'}} }
    r++
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = `As of ${today2}`
    ws.getCell(r,1).font = { italic:true, size:9, color:{argb:'FF666666'} }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    r++
    r++ // spacer

    // Header row
    const headerRow = r
    const headers = ['Date','Type','Scope / Truck','Category','Sub-category','Description','Ref #','Amount']
    headers.forEach((h,i) => {
      const cell = ws.getCell(headerRow, i+1)
      cell.value = h
      cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:8.5 }
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF000000'} }
      cell.border = allBorders
    })
    r++

    // Data rows
    filtered.forEach((e,i) => {
      const truck = trucks.find(t => t.id === e.truck_id)?.plate || (e.scope === 'all' ? 'Fleet-wide' : '—')
      const isAdm = e.expense_type === 'admin'
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF5F5F5'
      const vals = [e.expense_date||'', isAdm?'Admin':'Operation', truck, e.category||'', e.maintenance_category||'', e.description||'', e.reference_no||'', parseFloat(e.amount)||0]
      vals.forEach((v,ci) => {
        const cell = ws.getCell(r, ci+1)
        cell.value = v
        cell.font = { size:8.5, bold: ci===1 || ci===7, color: ci===1?{argb: isAdm?'FF4338CA':'FF059669'}:undefined }
        cell.alignment = { horizontal: ci===7?'right':ci<=2?'center':'left', vertical:'middle' }
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:bg} }
        cell.border = allBorders
        if (ci===0 || ci===6) cell.numFmt = '@'
        if (ci===7) cell.numFmt = '#,##0.00'
      })
      r++
    })

    // Total row
    ws.mergeCells(r,1,r,6)
    const tlc = ws.getCell(r,1)
    tlc.value = `TOTAL (${filtered.length} entries)`
    tlc.font = { bold:true, size:9, color:{argb:'FF92400E'} }
    tlc.alignment = { horizontal:'right' }
    tlc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9C3'} }
    tlc.border = allBorders
    ws.mergeCells(r,7,r,8)
    const tvc = ws.getCell(r,7)
    tvc.value = total; tvc.numFmt = '#,##0.00'
    tvc.font = { bold:true, size:9, color:{argb:'FF92400E'} }
    tvc.alignment = { horizontal:'right' }
    tvc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9C3'} }
    tvc.border = allBorders
    r++
    r++ // spacer

    // Summary by category
    ws.mergeCells(r,1,r,COLS)
    const sc = ws.getCell(r,1)
    sc.value = 'SUMMARY BY CATEGORY'
    sc.font = { bold:true, color:{argb:'FFFFFFFF'}, size:10 }
    sc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1F2937'} }
    sc.alignment = { vertical:'middle' }
    ws.getRow(r).height = 20
    r++
    ws.mergeCells(r,1,r,7); ws.mergeCells(r,8,r,8)
    const ch = ws.getCell(r,1); ch.value = 'Category'; ch.alignment={horizontal:'left'}
    const ah = ws.getCell(r,8); ah.value = 'Total Amount'
    ;[ch,ah].forEach(cell => {
      cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:8.5 }
      cell.alignment = { ...cell.alignment, vertical:'middle' }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF000000'} }
      cell.border = allBorders
    })
    r++
    Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).forEach(([cat,amt],i) => {
      const bg = i%2===0?'FFFFFFFF':'FFF5F5F5'
      ws.mergeCells(r,1,r,7); ws.mergeCells(r,8,r,8)
      const c1 = ws.getCell(r,1); c1.value = cat; c1.alignment={horizontal:'left',vertical:'middle'}
      const c2 = ws.getCell(r,8); c2.value = amt; c2.numFmt='#,##0.00'; c2.alignment={horizontal:'right',vertical:'middle'}
      ;[c1,c2].forEach(cell => { cell.font={size:8.5}; cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:bg}}; cell.border=allBorders })
      r++
    })
    ws.mergeCells(r,1,r,7); ws.mergeCells(r,8,r,8)
    const fc1 = ws.getCell(r,1); fc1.value='TOTAL'; fc1.alignment={horizontal:'left',vertical:'middle'}
    const fc2 = ws.getCell(r,8); fc2.value=total; fc2.numFmt='#,##0.00'; fc2.alignment={horizontal:'right',vertical:'middle'}
    ;[fc1,fc2].forEach(cell => { cell.font={bold:true,size:9,color:{argb:'FF92400E'}}; cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFEF9C3'}}; cell.border=allBorders })

    ws.views = [{ showGridLines: false }]
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `Expenses-${new Date().toISOString().slice(0,10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    showToast('Exported to Excel')
  }

  const handlePrintDetail = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
    const total = filtered.reduce((s, e) => s + (e.amount || 0), 0)
    const dateStr = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    doc.setFontSize(13); doc.setFont(undefined, 'bold')
    doc.text('DRAGON SPEED TRUCKING CORPORATION', 14, 14)
    doc.setFontSize(9); doc.setFont(undefined, 'normal')
    doc.setTextColor(100); doc.text('Expenses — Detail Report    ' + dateStr, 14, 20); doc.setTextColor(0)
    const rows = filtered.map(e => {
      const truck = trucks.find(t => t.id === e.truck_id)?.plate || (e.scope === 'all' ? 'Fleet-wide' : '—')
      return [e.expense_date||'', e.expense_type==='admin'?'Admin':'Operation', truck, e.category||'', e.maintenance_category||'', e.description||'', e.reference_no||'', Number(e.amount||0).toLocaleString('en-PH',{minimumFractionDigits:2})]
    })
    autoTable(doc, { startY:24, head:[['Date','Type','Truck/Scope','Category','Classify','Description','Ref #','Amount (PHP)']], body:rows, foot:[['','','','','','','TOTAL',Number(total).toLocaleString('en-PH',{minimumFractionDigits:2})]], headStyles:{fillColor:[255,30,0],fontSize:8,fontStyle:'bold'}, footStyles:{fillColor:[240,240,240],fontStyle:'bold',fontSize:9}, bodyStyles:{fontSize:8}, alternateRowStyles:{fillColor:[250,250,250]}, columnStyles:{7:{halign:'right'}}, margin:{left:14,right:14} })
    doc.save(`Expenses-Detail-${new Date().toISOString().slice(0,10)}.pdf`)
    showToast('PDF saved.')
  }

  const handlePrintSummary = () => {
    const byCategory = {}
    filtered.forEach(e => { const k=e.category||'Uncategorized'; if(!byCategory[k])byCategory[k]={admin:0,operation:0,total:0}; byCategory[k][e.expense_type==='admin'?'admin':'operation']+=e.amount||0; byCategory[k].total+=e.amount||0 })
    const total = filtered.reduce((s,e)=>s+(e.amount||0),0)
    const dateStr = new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})
    const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'letter'})
    doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.text('DRAGON SPEED TRUCKING CORPORATION',14,14)
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(100); doc.text('Expenses — Summary by Category    '+dateStr,14,20); doc.setTextColor(0)
    const rows = Object.entries(byCategory).sort((a,b)=>b[1].total-a[1].total).map(([cat,d])=>[cat,d.admin>0?Number(d.admin).toLocaleString('en-PH',{minimumFractionDigits:2}):'—',d.operation>0?Number(d.operation).toLocaleString('en-PH',{minimumFractionDigits:2}):'—',Number(d.total).toLocaleString('en-PH',{minimumFractionDigits:2})])
    autoTable(doc,{startY:24,head:[['Category','Admin (PHP)','Operation (PHP)','Total (PHP)']],body:rows,foot:[['TOTAL','','',Number(total).toLocaleString('en-PH',{minimumFractionDigits:2})]],headStyles:{fillColor:[255,30,0],fontSize:9,fontStyle:'bold'},footStyles:{fillColor:[240,240,240],fontStyle:'bold',fontSize:10},bodyStyles:{fontSize:9},alternateRowStyles:{fillColor:[250,250,250]},columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'}},margin:{left:14,right:14}})
    doc.save(`Expenses-Summary-${new Date().toISOString().slice(0,10)}.pdf`)
    showToast('PDF saved.')
  }

  // ── EXPENSE CRUD ──────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const required = ['expense_date', 'category', 'description', 'amount']
    if (required.some(k => !form[k])) { showToast('Please fill all required fields.', 'error'); return }
    if (form.expense_type === 'operation' && form.scope === 'individual' && !form.truck_id) { showToast('Please select a truck.', 'error'); return }
    setSaving(true)
    // eslint-disable-next-line no-unused-vars
    const { truck_ids: _truck_ids, ...formData } = form

    // Selected scope — insert one expense per truck with split amount
    if (form.expense_type === 'operation' && form.scope === 'selected') {
      if (!form.truck_ids || form.truck_ids.length === 0) { showToast('Select at least one truck.', 'error'); setSaving(false); return }
      // If editing an existing expense, delete the old record first
      if (editId) { await supabase.from('expenses').delete().eq('id', editId) }
      const splitAmount = (parseFloat(form.amount)||0) / form.truck_ids.length
      // Strip id from payload — always inserting fresh rows when splitting
      const { id: _id, truck_ids: _truck_ids2, ...baseData } = formData
      const rows = form.truck_ids.map(tid => ({ ...baseData, amount: splitAmount, scope: 'individual', truck_id: tid, created_by: profile?.id }))
      const { error } = await supabase.from('expenses').insert(rows)
      if (error) showToast('Error: ' + error.message, 'error')
      else { logAudit('generate', editId?'Updated':'Added', 'Expenses', (editId?'Updated':'Added') + ' expense split across ' + form.truck_ids.length + ' trucks: ' + form.description, editId||'', profile?.id, profile?.full_name); showToast('Saved — split across ' + form.truck_ids.length + ' trucks.'); setForm(EMPTY); setEditId(null); setShowForm(false); fetchAll() }
      setSaving(false); return
    }

    const payload = { ...formData, amount: parseFloat(form.amount)||0, scope: form.expense_type==='admin'?'all':form.scope, truck_id: form.expense_type==='admin'?null:(form.scope==='all'?null:form.truck_id), created_by: profile?.id }
    let error
    if (editId) ({ error } = await supabase.from('expenses').update(payload).eq('id', editId))
    else ({ error } = await supabase.from('expenses').insert(payload))
    if (error) showToast('Error: '+error.message, 'error')
    else { logAudit(editId?'destructive':'generate', editId?'Updated':'Added', 'Expenses', `${editId?'Updated':'Added'} expense: ${payload.description} ₱${payload.amount}`, editId||'', profile?.id, profile?.full_name); showToast(editId?'Updated.':'Saved.'); setForm(EMPTY); setEditId(null); setShowForm(false); fetchAll() }
    setSaving(false)
  }

  const handleEdit = (exp) => { setForm({...exp, amount:String(exp.amount)}); setEditId(exp.id); setShowForm(true); window.scrollTo({top:0,behavior:'smooth'}) }

  const handleAmortSubmit = async () => {
    if (!amortForm.truck_id||!amortForm.monthly_amount||!amortForm.start_date) { showToast('Please fill all required fields.','error'); return }
    setSaving(true)
    const payload = {...amortForm, monthly_amount:parseFloat(amortForm.monthly_amount)||0, created_by:profile?.id}
    let error
    if (editAmortId) ({ error } = await supabase.from('amortizations').update(payload).eq('id',editAmortId))
    else ({ error } = await supabase.from('amortizations').insert(payload))
    if (error) showToast('Error: '+error.message,'error')
    else { logAudit(editAmortId?'destructive':'generate', editAmortId?'Updated':'Added', 'Expenses', `${editAmortId?'Updated':'Added'} amortization: ₱${payload.monthly_amount}/mo`, editAmortId||'', profile?.id, profile?.full_name); showToast(editAmortId?'Updated.':'Amortization saved.'); setAmortForm(EMPTY_AMORT); setEditAmortId(null); setShowAmortForm(false); fetchAll() }
    setSaving(false)
  }

  const handleInsSubmit = async () => {
    if (!insForm.annual_amount||!insForm.start_date||insForm.truck_ids.length===0) { showToast('Please fill all fields and select at least one truck.','error'); return }
    setSaving(true)
    const payload = {...insForm, annual_amount:parseFloat(insForm.annual_amount)||0, truck_ids:insForm.truck_ids, created_by:profile?.id}
    let error
    if (editInsId) ({ error } = await supabase.from('insurances').update(payload).eq('id',editInsId))
    else ({ error } = await supabase.from('insurances').insert(payload))
    if (error) showToast('Error: '+error.message,'error')
    else { logAudit(editInsId?'destructive':'generate', editInsId?'Updated':'Added', 'Expenses', `${editInsId?'Updated':'Added'} insurance: ₱${payload.annual_amount}/yr`, editInsId||'', profile?.id, profile?.full_name); showToast(editInsId?'Updated.':'Insurance saved.'); setInsForm(EMPTY_INS); setEditInsId(null); setShowInsForm(false); fetchAll() }
    setSaving(false)
  }

  const handleDelete = async () => {
    const { table, id } = deleteTarget
    let error
    if (table === 'expenses') {
      ({ error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id))
    } else {
      ({ error } = await supabase.from(table).delete().eq('id', id))
    }
    if (error) showToast('Error: '+error.message,'error')
    else { logAudit('destructive', table==='expenses'?'Deleted':'Deleted', 'Expenses', `Deleted from ${table} id:${id}`, id, profile?.id, profile?.full_name); showToast(table==='expenses'?'Moved to trash.':'Deleted.','info'); fetchAll() }
    setDeleteTarget(null)
  }

  const toggleInsTruck = (id) => { setInsForm(f => ({...f, truck_ids: f.truck_ids.includes(id)?f.truck_ids.filter(x=>x!==id):[...f.truck_ids,id]})) }
  const insMonthlyPerTruck = (ins) => (ins.annual_amount||0)/(ins.truck_ids?.length||1)/12
  const insActiveInMonth = (ins, ym) => { const start=new Date(ins.start_date); const end=new Date(start); end.setMonth(end.getMonth()+12); const check=new Date(ym+'-01'); return check>=start&&check<end }

  const filtered = expenses.filter(e => {
    const mM = !filterMonth||e.expense_date?.startsWith(filterMonth)
    const mS = !filterScope||e.scope===filterScope
    const mTy = !filterType||e.expense_type===filterType
    const mT = !filterTruck||e.truck_id===filterTruck
    const mC = !filterCat||e.category===filterCat
    return mM&&mS&&mTy&&mT&&mC
  })

  const totalAll = filtered.reduce((s,e)=>s+(e.amount||0),0)
  const totalAdmin = filtered.filter(e=>e.expense_type==='admin').reduce((s,e)=>s+(e.amount||0),0)
  const totalOps = filtered.filter(e=>e.expense_type==='operation').reduce((s,e)=>s+(e.amount||0),0)
  const activeTrucks = trucks.filter(t=>t.active!==false)
  const companyTrucks = activeTrucks.filter(t=>t.ownership!=='subcon' && t.ownership!=='special_subcon')
  // Admin/shared-expense divisor: special_subcon shares in general overhead
  // even though it's excluded from revenue reporting — different scope than
  // companyTrucks above (which stays revenue-only, e.g. for the truck picker).
  const expenseShareTrucks = activeTrucks.filter(t=>t.ownership!=='subcon')
  const now = new Date()
  const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  const lastMonthDate = new Date(now.getFullYear(),now.getMonth()-1,1)
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth()+1).padStart(2,'0')}`
  const curMonthExp = expenses.filter(e=>e.expense_date?.startsWith(curMonth))
  const lastMonthExp = expenses.filter(e=>e.expense_date?.startsWith(lastMonth))
  const curMonthTotal = curMonthExp.reduce((s,e)=>s+(parseFloat(e.amount)||0),0)
  const lastMonthTotal = lastMonthExp.reduce((s,e)=>s+(parseFloat(e.amount)||0),0)
  const monthDiff = curMonthTotal-lastMonthTotal
  const monthDiffPct = lastMonthTotal>0?((monthDiff/lastMonthTotal)*100).toFixed(1):null
  const truckCount = expenseShareTrucks.length||1
  const getActiveTruckCount = (expenseDate) => {
    const d = expenseDate || new Date().toISOString().slice(0, 10)
    const count = expenseShareTrucks.filter(t => {
      const start = t.start_date || '2024-01-01'
      const end = t.end_date || '9999-12-31'
      return d >= start && d <= end
    }).length
    return count || 1
  }
  const expNow = new Date()
  const trendMonths = Array.from({length:6},(_,i)=>{const d=new Date(expNow.getFullYear(),expNow.getMonth()-(5-i),1);return d.toISOString().slice(0,7)})
  const trendData = trendMonths.map(mo=>({month:mo,label:new Date(mo+'-01').toLocaleDateString('en-PH',{month:'short',year:'2-digit'}),total:expenses.filter(e=>e.expense_date?.startsWith(mo)).reduce((s,e)=>s+(e.amount||0),0)}))
  const maxTrend = Math.max(...trendData.map(d=>d.total),1)
  const ptExpenses = expenses.filter(e => {
    if (!ptTruck) return false
    const expMonth = e.expense_date?e.expense_date.slice(0,7):''
    const mM = !ptMonth||expMonth===ptMonth
    const mTy = !ptType||e.expense_type===ptType
    if (!mM||!mTy) return false
    if (e.scope==='individual'&&e.truck_id===ptTruck) return true
    if (e.scope==='all') return true
    return false
  })
  const ptTotal = ptExpenses.reduce((s,e)=>s+(e.scope==='all'?(e.amount||0)/getActiveTruckCount(e.expense_date):(e.amount||0)),0)
  const ptAmorts = ptTruck?amortizations.filter(a=>{if(a.truck_id!==ptTruck)return false;if(!ptMonth)return true;const start=a.start_date?a.start_date.slice(0,7):'';const end=a.end_date?a.end_date.slice(0,7):'';return(!start||ptMonth>=start)&&(!end||ptMonth<=end)}):[]
  const ptAmortTotal = ptAmorts.reduce((s,a)=>s+(a.monthly_amount||0),0)
  const ptInsurances = ptTruck?insurances.filter(ins=>{if(!ins.truck_ids?.includes(ptTruck))return false;if(!ptMonth)return true;const start=new Date(ins.start_date);const end=new Date(start);end.setMonth(end.getMonth()+12);return new Date(ptMonth+'-01')>=start&&new Date(ptMonth+'-01')<end}):[]
  const ptInsTotal = ptInsurances.reduce((s,ins)=>s+(ins.annual_amount||0)/(ins.truck_ids?.length||1)/12,0)
  const ptGrandTotal = ptTotal+ptAmortTotal+ptInsTotal
  const allCategories = [...new Set(expenses.map(e=>e.category).filter(Boolean))].sort()
  const typeBadge = (type) => type==='admin'?<span className="badge" style={{background:'#E8F0FE',color:'#1A56DB',fontSize:10}}>Admin</span>:<span className="badge badge-dump" style={{fontSize:10}}>Operation</span>
  const scopeBadge = (exp) => exp.scope==='all'?<span className="badge badge-success" style={{fontSize:10}}>Fleet-wide</span>:<span className="badge badge-dump" style={{fontSize:10}}>{trucks.find(t=>t.id===exp.truck_id)?.plate||exp.truck_id}</span>

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Expenses</h1><p className="page-sub">Admin, operation, amortization &amp; insurance</p></div>
        {tab === 'All Expenses' && (
          <button className="btn-primary" onClick={() => { setForm(EMPTY); setEditId(null); setShowForm(!showForm) }}>
            {showForm ? '✕ Cancel' : '+ Add Expense'}
          </button>
        )}
        {tab === 'Amortization' && (
          <button className="btn-primary" onClick={() => { setAmortForm(EMPTY_AMORT); setEditAmortId(null); setShowAmortForm(!showAmortForm) }}>
            {showAmortForm ? '✕ Cancel' : '+ Add Amortization'}
          </button>
        )}
        {tab === 'Insurance' && (
          <button className="btn-primary" onClick={() => { setInsForm(EMPTY_INS); setEditInsId(null); setShowInsForm(!showInsForm) }}>
            {showInsForm ? '✕ Cancel' : '+ Add Insurance'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, marginBottom:20, borderBottom:'0.5px solid var(--border)' }}>
        {(isAdmin ? ALL_TABS : STAFF_TABS).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background:'none', border:'none', padding:'7px 16px', fontSize:13, fontWeight:tab===t?500:400, cursor:'pointer', color:tab===t?'var(--text)':'var(--muted)', borderBottom:`2px solid ${tab===t?'var(--accent)':'transparent'}`, marginBottom:-1 }}>{t}</button>
        ))}
      </div>

      {/* ── ALL EXPENSES ── */}
      {tab === 'All Expenses' && (
        <>
          {/* Expense Trend Chart */}
          {trendData.some(d => d.total > 0) && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize:14, fontWeight:500, marginBottom:14 }}>Monthly Expense Trend</h2>
              <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:100 }}>
                {trendData.map((d) => (
                  <div key={d.month} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                    <div style={{ fontSize:9, color:'var(--muted)', fontFamily:'var(--mono)' }}>{d.total>0?`₱${(d.total/1000).toFixed(0)}K`:''}</div>
                    <div style={{ width:'100%', borderRadius:'4px 4px 0 0', height:`${Math.max((d.total/maxTrend)*80,d.total>0?4:0)}px`, background:d.month===trendMonths[5]?'var(--accent)':'var(--accent-light)', transition:'height 0.3s ease' }} />
                    <div style={{ fontSize:9, color:'var(--muted)', textAlign:'center' }}>{d.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recurring auto-fill */}
          {isAdmin && (() => {
            const recurringExpenses = expenses.filter(e => e.is_recurring)
            const currentMonth = new Date().toISOString().slice(0, 7)
            const alreadyCopied = expenses.some(e => e.expense_date?.startsWith(currentMonth) && e.is_recurring)
            if (recurringExpenses.length === 0 || alreadyCopied) return null
            return (
              <div style={{ padding:'10px 14px', background:'var(--accent-light)', borderRadius:8, marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13, flexWrap:'wrap', gap:8 }}>
                <span style={{ color:'var(--accent-dark)' }}>🔄 {recurringExpenses.length} recurring expense{recurringExpenses.length>1?'s':''} — auto-fill for {new Date().toLocaleDateString('en-PH',{month:'long',year:'numeric'})}?</span>
                <button className="btn-primary btn-sm" onClick={async () => {
                  const copies = recurringExpenses.map(e => ({ expense_date:currentMonth+'-01', expense_type:e.expense_type, category:e.category, description:e.description, amount:e.amount, scope:e.scope, truck_id:e.truck_id, reference_no:'', remarks:e.remarks, is_recurring:true, maintenance_category:e.maintenance_category }))
                  const { error } = await supabase.from('expenses').insert(copies)
                  if (error) showToast('Error: '+error.message,'error')
                  else { showToast(`${copies.length} expenses copied to ${new Date().toLocaleDateString('en-PH',{month:'long'})}.`); fetchAll() }
                }}>Auto-fill Now</button>
              </div>
            )
          })()}

          {showForm && (
            <div className="card" style={{ marginBottom:24 }}>
              <h2 style={{ fontSize:15, fontWeight:500, marginBottom:16 }}>{editId?'Edit Expense':'New Expense'}</h2>
              <p className="section-label" style={{ marginTop:0 }}>Expense Type</p>
              <div style={{ display:'flex', gap:10, marginBottom:16 }}>
                {(isAdmin ? [
                  { val:'admin', label:'🏢 Admin Expense', desc:'Office, utilities, salaries — divided across all trucks' },
                  { val:'operation', label:'🚛 Operation Expense', desc:'Fuel, maintenance, salary — fleet-wide or per truck' },
                ] : [
                  { val:'operation', label:'🚛 Operation Expense', desc:'Fuel, maintenance, salary — fleet-wide or per truck' },
                ]).map(opt => (
                  <label key={opt.val} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'12px 16px', border:`1.5px solid ${form.expense_type===opt.val?'var(--accent)':'var(--border)'}`, borderRadius:8, cursor:'pointer', flex:1, background:form.expense_type===opt.val?'var(--accent-light)':'var(--surface)' }}>
                    <input type="radio" name="expense_type" value={opt.val} checked={form.expense_type===opt.val} onChange={() => setForm(f=>({...f,expense_type:opt.val,category:'',scope:opt.val==='admin'?'all':f.scope}))} style={{ width:'auto', marginTop:2 }} />
                    <div><div style={{ fontWeight:500, marginBottom:2, fontSize:13 }}>{opt.label}</div><div style={{ fontSize:12, color:'var(--muted)' }}>{opt.desc}</div></div>
                  </label>
                ))}
              </div>
              {form.expense_type === 'operation' && (
                <>
                  <p className="section-label">Scope</p>
                  <div style={{ display:'flex', gap:10, marginBottom:16 }}>
                    {[{val:'all',label:'🚛 All Trucks'},{val:'selected',label:'☑️ Select Trucks'},{val:'individual',label:'🔧 Individual Truck'}].map(opt => (
                      <label key={opt.val} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', border:`1.5px solid ${form.scope===opt.val?'var(--accent)':'var(--border)'}`, borderRadius:8, cursor:'pointer', fontSize:13, background:form.scope===opt.val?'var(--accent-light)':'var(--surface)', fontWeight:form.scope===opt.val?500:400, color:form.scope===opt.val?'var(--accent)':'var(--text)' }}>
                        <input type="radio" name="scope" value={opt.val} checked={form.scope===opt.val} onChange={e=>setForm(f=>({...f,scope:e.target.value,truck_id:'',truck_ids:[]}))} style={{ width:'auto', margin:0 }} />{opt.label}
                      </label>
                    ))}
                  </div>
                  {form.scope === 'individual' && (
                    <div className="form-group" style={{ marginBottom:16 }}>
                      <label className="label required">Select Truck</label>
                      <select value={form.truck_id} onChange={e=>setForm(f=>({...f,truck_id:e.target.value}))}>
                        <option value="">Select truck</option>
                        {companyTrucks.map(t=><option key={t.id} value={t.id}>{t.plate} ({t.truck_type})</option>)}
                      </select>
                    </div>
                  )}
                  {form.scope === 'selected' && (
                    <div className="form-group" style={{ marginBottom:16 }}>
                      <label className="label required">Select Trucks ({(form.truck_ids||[]).length} selected)</label>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:6, padding:8, background:'var(--bg)', borderRadius:6, border:'1px solid var(--border)', maxHeight:180, overflowY:'auto' }}>
                        {companyTrucks.map(t => (
                          <label key={t.id} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px', borderRadius:4, cursor:'pointer', background:(form.truck_ids||[]).includes(t.id)?'rgba(255,30,0,0.1)':'transparent', border:(form.truck_ids||[]).includes(t.id)?'1px solid var(--accent)':'1px solid transparent' }}>
                            <input type="checkbox" checked={(form.truck_ids||[]).includes(t.id)}
                              onChange={e=>setForm(f=>({...f,truck_ids:e.target.checked?[...(f.truck_ids||[]),t.id]:(f.truck_ids||[]).filter(id=>id!==t.id)}))}
                              style={{ width:'auto',margin:0 }} />
                            <span style={{ fontSize:12 }}>{t.plate}</span>
                          </label>
                        ))}
                      </div>
                      {(form.truck_ids||[]).length > 0 && (
                        <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>
                          Split equally: ₱{fmt((parseFloat(form.amount)||0)/((form.truck_ids||[]).length||1))} per truck
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {form.expense_type === 'admin' && (
                <div style={{ padding:'8px 14px', background:'var(--accent-light)', borderRadius:6, fontSize:12, color:'var(--accent)', marginBottom:16 }}>
                  ℹ️ Admin expenses are divided equally across all {companyTrucks.length} active trucks in per-truck reports.
                </div>
              )}
              <p className="section-label">Details</p>
              <div className="form-grid" style={{ marginBottom:16 }}>
                <div className="form-group"><label className="label required">Date</label><DateInput value={form.expense_date} onChange={e=>setForm(f=>({...f,expense_date:e.target.value}))} max={new Date().toISOString().slice(0,10)} /></div>
                <div className="form-group"><label className="label required">Category</label>
                  <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                    <option value="">Select category</option>
                    {(form.expense_type==='admin'?[...ADMIN_CATEGORIES,...customAdminCats]:[...OPERATION_CATEGORIES,...customOpCats]).map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="label required">Amount (₱)</label><input type="number" step="0.01" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" /></div>
                <div className="form-group"><label className="label">Reference No.</label><input value={form.reference_no} onChange={e=>setForm(f=>({...f,reference_no:e.target.value}))} placeholder="OR, receipt #" /></div>
                <div className="form-group"><label className="label">Payment Method</label>
                  <div style={{ display:'flex', gap:8 }}>
                    {[['cash','💵 Cash'],['check','🖊️ Check'],['transfer','🏦 Transfer']].map(([val,label])=>(
                      <button type="button" key={val} onClick={()=>setForm(f=>({...f,payment_method:val}))} style={{ flex:1, padding:'7px 4px', borderRadius:8, border:`1.5px solid ${form.payment_method===val?'var(--accent)':'var(--border)'}`, background:form.payment_method===val?'var(--accent-light)':'var(--surface)', color:form.payment_method===val?'var(--accent)':'var(--muted)', fontWeight:form.payment_method===val?600:400, cursor:'pointer', fontSize:12 }}>{label}</button>
                    ))}
                  </div>
                </div>
                {(form.category==='Maintenance — Parts'||form.category==='Maintenance — Labor') && (
                  <div className="form-group"><label className="label">Classify As</label>
                    <select value={form.maintenance_category||''} onChange={e=>setForm(f=>({...f,maintenance_category:e.target.value}))}>
                      <option value="">General</option>
                      {form.category==='Maintenance — Parts'&&<><option value="Tires">Tires / Vulcanize</option><option value="Engine Parts">Engine Parts</option><option value="Body Parts">Body Parts</option><option value="Electrical">Electrical</option><option value="Brakes">Brakes</option><option value="Suspension">Suspension</option><option value="Filters">Filters</option><option value="Other Parts">Other Parts</option></>}
                      {form.category==='Maintenance — Labor'&&<><option value="Vulcanizing">Vulcanizing</option><option value="Welding">Welding</option><option value="PMS Labor">PMS Labor</option><option value="Body Work">Body Work</option><option value="Electrical Labor">Electrical Labor</option><option value="Other Labor">Other Labor</option></>}
                    </select>
                  </div>
                )}
                <div className="form-group span-2"><label className="label required">Description</label><input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Vulcanize front right tire" /></div>
                <div className="form-group span-2"><label className="label">Remarks</label><textarea rows={2} value={form.remarks} onChange={e=>setForm(f=>({...f,remarks:e.target.value}))} style={{ resize:'vertical' }} /></div>
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button className="btn-ghost" onClick={()=>{setShowForm(false);setForm(EMPTY);setEditId(null)}}>Cancel</button>
                <button className="btn-primary" onClick={handleSubmit} disabled={saving}>{saving?'Saving…':editId?'Update':'Save Expense'}</button>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginBottom:12, flexWrap:'wrap' }}>
            {isAdmin && <button className="btn-ghost btn-sm" onClick={()=>setShowCatManager(v=>!v)}>⚙️ Categories</button>}
            {isAdmin && <button className="btn-ghost btn-sm" onClick={()=>{ setShowImport(v=>!v); setImportData([]); setImportErrors([]) }}>📥 Import Admin</button>}
            <button className="btn-ghost btn-sm" onClick={handleExportExcel}>📊 Export Excel</button>
            <button className="btn-ghost btn-sm" onClick={handlePrintSummary}>📄 PDF Summary</button>
            <button className="btn-ghost btn-sm" onClick={handlePrintDetail}>📄 PDF Detail</button>
          </div>

          {/* ── ADMIN IMPORT PANEL ── */}
          {showImport && isAdmin && (
            <div className="card" style={{ marginBottom:16, border:'1.5px solid var(--accent)' }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>📥 Import Admin Expenses from Excel</div>
              <p style={{ fontSize:12, color:'var(--muted)', marginBottom:12 }}>
                Upload your Excel file with columns: <strong>Date</strong>, <strong>Particulars</strong>, <strong>Amount</strong>.
                Categories are auto-detected from Particulars text.
              </p>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleAdminImportFile} style={{ marginBottom:12 }} />

              {importErrors.length > 0 && (
                <div style={{ background:'rgba(220,38,38,0.08)', border:'1px solid rgba(220,38,38,0.2)', borderRadius:8, padding:10, marginBottom:12 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--danger)', marginBottom:4 }}>{importErrors.length} issue(s) — these rows will be skipped:</div>
                  {importErrors.slice(0,5).map((e,i)=><div key={i} style={{ fontSize:11, color:'var(--danger)' }}>• {e}</div>)}
                  {importErrors.length>5&&<div style={{ fontSize:11, color:'var(--muted)' }}>...and {importErrors.length-5} more</div>}
                </div>
              )}

              {importData.length > 0 && (
                <>
                  <div style={{ fontSize:12, color:'var(--muted)', marginBottom:8 }}>
                    Preview — <strong>{importData.length}</strong> entries ready · Total: <strong>₱{importData.reduce((s,r)=>s+r.amount,0).toLocaleString('en-PH',{minimumFractionDigits:2})}</strong>
                  </div>
                  <div style={{ maxHeight:280, overflowY:'auto', marginBottom:12, border:'0.5px solid var(--border)', borderRadius:8 }}>
                    <table className="table" style={{ fontSize:11 }}>
                      <thead><tr><th>Date</th><th>Particulars</th><th>Category (Auto-detected)</th><th className="text-right">Amount</th></tr></thead>
                      <tbody>
                        {importData.map((row,i)=>(
                          <tr key={i}>
                            <td className="mono">{row.expense_date}</td>
                            <td>{row.description||'—'}</td>
                            <td><span style={{ fontSize:10, background:'rgba(255,30,0,0.1)', color:'var(--accent)', padding:'1px 6px', borderRadius:4 }}>{row.category}</span></td>
                            <td className="text-right mono">₱{row.amount.toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3} style={{ fontWeight:600, textAlign:'right', padding:'8px 10px' }}>TOTAL</td>
                          <td className="text-right mono" style={{ fontWeight:600, padding:'8px 10px' }}>₱{importData.reduce((s,r)=>s+r.amount,0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="btn-primary" onClick={handleAdminImportSave} disabled={importing}>
                      {importing?'Importing…':`✅ Import ${importData.length} Entries`}
                    </button>
                    <button className="btn-ghost" onClick={()=>{setImportData([]);setImportErrors([])}}>Clear</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Category Manager */}
          {showCatManager && isAdmin && (
            <div className="card" style={{ marginBottom:16, border:'1.5px solid var(--accent)' }}>
              <h3 style={{ fontSize:14, fontWeight:500, marginBottom:12 }}>⚙️ Manage Expense Categories</h3>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
                {[
                  { label:'Admin Categories', base:ADMIN_CATEGORIES, custom:customAdminCats, setCustom:setCustomAdminCats, newVal:newAdminCat, setNew:setNewAdminCat, key:'admin' },
                  { label:'Operation Categories', base:OPERATION_CATEGORIES, custom:customOpCats, setCustom:setCustomOpCats, newVal:newOpCat, setNew:setNewOpCat, key:'op' },
                ].map(({ label, base, custom, setCustom, newVal, setNew, key }) => (
                  <div key={key}>
                    <p style={{ fontSize:12, fontWeight:500, marginBottom:8 }}>{label}</p>
                    <div style={{ maxHeight:200, overflowY:'auto', marginBottom:8, border:'0.5px solid var(--border)', borderRadius:6 }}>
                      {[...base,...custom].map(c=>(
                        <div key={c} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 10px', borderBottom:'0.5px solid var(--border)', fontSize:12 }}>
                          <span>{c}</span>
                          {custom.includes(c)&&<button onClick={()=>{const n=custom.filter(x=>x!==c);setCustom(n);const saved=JSON.parse(localStorage.getItem('ds_custom_cats')||'{}');saved[key]=n;localStorage.setItem('ds_custom_cats',JSON.stringify(saved))}} style={{ background:'none', border:'none', color:'var(--danger)', cursor:'pointer', fontSize:16, lineHeight:1 }}>×</button>}
                          {!custom.includes(c)&&<span style={{ fontSize:10, color:'var(--hint)' }}>built-in</span>}
                        </div>
                      ))}
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <input value={newVal} onChange={e=>setNew(e.target.value)} placeholder="Add new category…" style={{ flex:1, fontSize:12 }}
                        onKeyDown={e=>{if(e.key==='Enter'&&newVal.trim()){const n=[...custom,newVal.trim()];setCustom(n);setNew('');const saved=JSON.parse(localStorage.getItem('ds_custom_cats')||'{}');saved[key]=n;localStorage.setItem('ds_custom_cats',JSON.stringify(saved))}}} />
                      <button className="btn-ghost btn-sm" onClick={()=>{if(newVal.trim()){const n=[...custom,newVal.trim()];setCustom(n);setNew('');const saved=JSON.parse(localStorage.getItem('ds_custom_cats')||'{}');saved[key]=n;localStorage.setItem('ds_custom_cats',JSON.stringify(saved))}}}>Add</button>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize:11, color:'var(--muted)', marginTop:10 }}>Custom categories saved to this browser. Built-in categories cannot be removed.</p>
            </div>
          )}

          <div className="stats-grid">
            <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value sm">₱{fmt(totalAll)}</div></div>
            <div className="stat-card"><div className="stat-label">Admin</div><div className="stat-value sm">₱{fmt(totalAdmin)}</div></div>
            <div className="stat-card"><div className="stat-label">Operation</div><div className="stat-value sm">₱{fmt(totalOps)}</div></div>
            <div className="stat-card"><div className="stat-label">Entries</div><div className="stat-value">{filtered.length}</div></div>
          </div>

          <div className="filter-bar">
            <MonthPicker value={filterMonth} onChange={setFilterMonth} />
            <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={{ width:'auto' }}><option value="">All types</option><option value="admin">Admin</option><option value="operation">Operation</option></select>
            <select value={filterScope} onChange={e=>setFilterScope(e.target.value)} style={{ width:'auto' }}><option value="">All scope</option><option value="all">Fleet-wide</option><option value="individual">Per truck</option></select>
            <select value={filterPayment} onChange={e=>setFilterPayment(e.target.value)} style={{ width:'auto' }}><option value="">All methods</option><option value="cash">💵 Cash</option><option value="check">🖊️ Check</option><option value="transfer">🏦 Transfer</option></select>
            <select value={filterTruck} onChange={e=>setFilterTruck(e.target.value)} style={{ width:'auto' }}><option value="">All trucks</option>{companyTrucks.map(t=><option key={t.id} value={t.id}>{t.plate}</option>)}</select>
            <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{ width:'auto' }}><option value="">All categories</option>{allCategories.map(c=><option key={c} value={c}>{c}</option>)}</select>
            {(filterMonth||filterType||filterScope||filterTruck||filterCat)&&<button className="btn-ghost btn-sm" onClick={()=>{setFilterMonth('');setFilterType('');setFilterScope('');setFilterTruck('');setFilterCat('')}}>Clear</button>}
          </div>

          {loading ? <div className="empty-state"><p>Loading…</p></div> :
            filtered.length === 0 ? <div className="empty-state"><p>{expenses.length===0?'No expenses yet.':'No results.'}</p></div> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Type</th><th>Scope</th><th>Category</th><th>Description</th><th>Ref #</th><th className="text-right">Amount (₱)</th><th></th></tr></thead>
                  <tbody>
                    {filtered.map(e => (
                      <tr key={e.id}>
                        <td className="mono" style={{ fontSize:12 }}>{fmtDate(e.expense_date)}</td>
                        <td>{typeBadge(e.expense_type)}</td>
                        <td>{scopeBadge(e)}</td>
                        <td>{e.category}{e.maintenance_category?<span style={{fontSize:10,color:'var(--muted)',marginLeft:4}}>({e.maintenance_category})</span>:''}</td>
                        <td>
                          {e.description}
                          {e.is_recurring&&(()=>{const d=new Date(e.expense_date+'T00:00:00');d.setMonth(d.getMonth()+1);const daysUntil=Math.ceil((d-new Date())/86400000);return <span style={{fontSize:9,background:'rgba(99,102,241,0.1)',color:'#4338ca',padding:'1px 5px',borderRadius:4,marginLeft:5}}>🔄 Next: {d.toISOString().slice(0,10)} {daysUntil>=0?`(${daysUntil}d)`:'(overdue)'}</span>})()}
                          <span style={{fontSize:9,padding:'1px 5px',borderRadius:4,marginLeft:4,background:e.payment_method==='check'?'rgba(100,100,100,0.1)':e.payment_method==='transfer'?'rgba(22,163,74,0.1)':'rgba(59,130,246,0.1)',color:e.payment_method==='check'?'var(--muted)':e.payment_method==='transfer'?'var(--success)':'#3B82F6'}}>{e.payment_method==='check'?'🖊️ Check':e.payment_method==='transfer'?'🏦 Transfer':'💵 Cash'}</span>
                        </td>
                        <td className="mono muted" style={{ fontSize:12 }}>{e.reference_no||'—'}</td>
                        <td className="text-right mono" style={{ fontWeight:500 }}>{fmt(e.amount)}</td>
                        <td><div style={{ display:'flex', gap:4 }}><button className="btn-ghost btn-sm" onClick={()=>handleEdit(e)}>Edit</button><button className="btn-danger btn-sm" onClick={()=>setDeleteTarget({table:'expenses',id:e.id})}>Delete</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={6} style={{ padding:'10px 14px', fontWeight:500, borderTop:'1px solid var(--border-md)' }}>Total</td><td className="text-right mono" style={{ padding:'10px 14px', fontWeight:500, borderTop:'1px solid var(--border-md)' }}>₱{fmt(totalAll)}</td><td style={{ borderTop:'1px solid var(--border-md)' }}></td></tr></tfoot>
                </table>
              </div>
            )}
        </>
      )}

      {/* ── PER TRUCK VIEW ── */}
      {tab === 'Per Truck View' && (
        <>
          <div className="card" style={{ marginBottom:20 }}>
            <p className="section-label" style={{ marginTop:0 }}>Select Truck &amp; Filters</p>
            <div className="form-grid">
              <div className="form-group"><label className="label required">Truck</label><select value={ptTruck} onChange={e=>setPtTruck(e.target.value)}><option value="">Select a truck</option>{companyTrucks.map(t=><option key={t.id} value={t.id}>{t.plate} — {t.truck_type}</option>)}</select></div>
              <div className="form-group"><label className="label">Month</label><MonthPicker value={ptMonth} onChange={setPtMonth} /></div>
              <div className="form-group"><label className="label">Type</label><select value={ptType} onChange={e=>setPtType(e.target.value)}><option value="">All types</option><option value="admin">Admin (shared)</option><option value="operation">Operation</option></select></div>
            </div>
          </div>
          {!ptTruck ? <div className="empty-state"><p>Select a truck above.</p></div> : (
            <>
              <div className="stats-grid" style={{ marginBottom:20 }}>
                <div className="stat-card"><div className="stat-label">Grand Total</div><div className="stat-value sm" style={{ color:'var(--accent)' }}>₱{fmt(ptGrandTotal)}</div></div>
                <div className="stat-card"><div className="stat-label">Expenses</div><div className="stat-value sm">₱{fmt(ptTotal)}</div></div>
                <div className="stat-card"><div className="stat-label">Amortization</div><div className="stat-value sm">₱{fmt(ptAmortTotal)}</div></div>
                <div className="stat-card"><div className="stat-label">Insurance</div><div className="stat-value sm">₱{fmt(ptInsTotal)}</div></div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Scope</th><th className="text-right">Full Amt</th><th className="text-right">This Truck</th></tr></thead>
                  <tbody>
                    {ptExpenses.length===0?<tr><td colSpan={7} style={{ textAlign:'center', padding:24, color:'var(--muted)' }}>No expenses found.</td></tr>:ptExpenses.map(e=>{const share=e.scope==='all'?(e.amount||0)/truckCount:(e.amount||0);return(<tr key={e.id}><td className="mono" style={{ fontSize:12 }}>{fmtDate(e.expense_date)}</td><td>{typeBadge(e.expense_type)}</td><td>{e.category}</td><td>{e.description}</td><td style={{ fontSize:11, color:'var(--muted)' }}>{e.scope==='all'?`Fleet ÷ ${truckCount}`:'Direct'}</td><td className="text-right mono muted" style={{ fontSize:12 }}>{fmt(e.amount)}</td><td className="text-right mono" style={{ fontWeight:500 }}>₱{fmt(share)}</td></tr>)})}
                  </tbody>
                  {ptExpenses.length>0&&<tfoot><tr><td colSpan={6} style={{ padding:'10px 14px', fontWeight:500, borderTop:'1px solid var(--border-md)' }}>Total</td><td className="text-right mono" style={{ padding:'10px 14px', fontWeight:500, borderTop:'1px solid var(--border-md)' }}>₱{fmt(ptTotal)}</td></tr></tfoot>}
                </table>
              </div>
              {ptAmorts.length>0&&<div className="table-wrap" style={{ marginTop:16 }}><div style={{ padding:'8px 14px', background:'var(--bg)', borderBottom:'0.5px solid var(--border)', fontSize:11, fontWeight:500, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Amortization</div><table className="table"><thead><tr><th>Description</th><th>Start Month</th><th>End Month</th><th className="text-right">Monthly Amount</th></tr></thead><tbody>{ptAmorts.map(a=><tr key={a.id}><td style={{ fontWeight:500 }}>{a.description}</td><td className="mono" style={{ fontSize:12 }}>{a.start_date}</td><td className="mono" style={{ fontSize:12 }}>{a.end_date||<span className="badge badge-success" style={{ fontSize:10 }}>Ongoing</span>}</td><td className="text-right mono" style={{ fontWeight:500 }}>₱{fmt(a.monthly_amount)}</td></tr>)}</tbody><tfoot><tr><td colSpan={3} style={{ padding:'10px 14px', fontWeight:500, borderTop:'1px solid var(--border-md)' }}>Total Amortization</td><td className="text-right mono" style={{ padding:'10px 14px', fontWeight:500, borderTop:'1px solid var(--border-md)' }}>₱{fmt(ptAmortTotal)}</td></tr></tfoot></table></div>}
              {ptInsurances.length>0&&<div className="table-wrap" style={{ marginTop:16 }}><div style={{ padding:'8px 14px', background:'var(--bg)', borderBottom:'0.5px solid var(--border)', fontSize:11, fontWeight:500, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Insurance</div><table className="table"><thead><tr><th>Type</th><th>Description</th><th>Policy No.</th><th className="text-right">Annual</th><th className="text-right">Monthly Share</th></tr></thead><tbody>{ptInsurances.map(ins=>{const share=(ins.annual_amount||0)/(ins.truck_ids?.length||1)/12;return(<tr key={ins.id}><td><span className="badge" style={{ fontSize:10, background:'#FFF0F0', color:'#8B0000' }}>{ins.insurance_type}</span></td><td>{ins.description}</td><td className="mono" style={{ fontSize:12 }}>{ins.policy_no||'—'}</td><td className="text-right mono muted" style={{ fontSize:12 }}>{fmt(ins.annual_amount)}</td><td className="text-right mono" style={{ fontWeight:500 }}>₱{fmt(share)}</td></tr>)})}</tbody><tfoot><tr><td colSpan={4} style={{ padding:'10px 14px', fontWeight:500, borderTop:'1px solid var(--border-md)' }}>Total Insurance (monthly share)</td><td className="text-right mono" style={{ padding:'10px 14px', fontWeight:500, borderTop:'1px solid var(--border-md)' }}>₱{fmt(ptInsTotal)}</td></tr></tfoot></table></div>}
              {(ptAmorts.length>0||ptInsurances.length>0)&&<div style={{ marginTop:12, padding:'12px 16px', background:'var(--accent)', borderRadius:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}><span style={{ fontSize:13, fontWeight:500, color:'#fff' }}>GRAND TOTAL — {trucks.find(t=>t.id===ptTruck)?.plate}</span><span style={{ fontSize:16, fontWeight:500, fontFamily:'var(--mono)', color:'#fff' }}>₱{fmt(ptGrandTotal)}</span></div>}
              <p style={{ fontSize:11, color:'var(--muted)', marginTop:8 }}>* Fleet-wide and admin expenses divided across {truckCount} active trucks. Insurance monthly share = annual ÷ 12 ÷ covered trucks.</p>
            </>
          )}
        </>
      )}

      {/* ── AMORTIZATION ── */}
      {tab === 'Amortization' && (
        <>
          {showAmortForm && (
            <div className="card" style={{ marginBottom:24 }}>
              <h2 style={{ fontSize:15, fontWeight:500, marginBottom:16 }}>{editAmortId?'Edit':'New'} Amortization</h2>
              <div className="form-grid" style={{ marginBottom:16 }}>
                <div className="form-group"><label className="label required">Truck</label><select value={amortForm.truck_id} onChange={e=>setAmortForm(f=>({...f,truck_id:e.target.value}))}><option value="">Select truck</option>{companyTrucks.map(t=><option key={t.id} value={t.id}>{t.plate} ({t.truck_type})</option>)}</select></div>
                <div className="form-group"><label className="label required">Monthly Amount (₱)</label><input type="number" step="0.01" value={amortForm.monthly_amount} onChange={e=>setAmortForm(f=>({...f,monthly_amount:e.target.value}))} placeholder="0.00" /></div>
                <div className="form-group"><label className="label required">Start Month</label><input type="month" value={amortForm.start_date} onChange={e=>setAmortForm(f=>({...f,start_date:e.target.value}))} style={{ colorScheme:'light' }} />{amortForm.start_date&&<span style={{ fontSize:11, color:'var(--accent)', marginTop:3, display:'block' }}>Starts: {new Date(amortForm.start_date+'-01').toLocaleDateString('en-PH',{month:'long',year:'numeric'})}</span>}</div>
                <div className="form-group"><label className="label">End Month <span style={{ fontWeight:400, color:'var(--hint)', textTransform:'none', letterSpacing:0 }}>(blank = ongoing)</span></label><input type="month" value={amortForm.end_date} onChange={e=>setAmortForm(f=>({...f,end_date:e.target.value}))} style={{ colorScheme:'light' }} />{amortForm.end_date?<span style={{ fontSize:11, color:'var(--muted)', marginTop:3, display:'block' }}>Ends: {new Date(amortForm.end_date+'-01').toLocaleDateString('en-PH',{month:'long',year:'numeric'})}</span>:<span style={{ fontSize:11, color:'var(--success)', marginTop:3, display:'block' }}>Ongoing (no end date)</span>}</div>
                <div className="form-group span-2"><label className="label required">Description</label><input value={amortForm.description} onChange={e=>setAmortForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Isuzu Giga loan — BDO" /></div>
                <div className="form-group span-2"><label className="label">Remarks</label><textarea rows={2} value={amortForm.remarks} onChange={e=>setAmortForm(f=>({...f,remarks:e.target.value}))} style={{ resize:'vertical' }} /></div>
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}><button className="btn-ghost" onClick={()=>{setShowAmortForm(false);setAmortForm(EMPTY_AMORT);setEditAmortId(null)}}>Cancel</button><button className="btn-primary" onClick={handleAmortSubmit} disabled={saving}>{saving?'Saving…':editAmortId?'Update':'Save'}</button></div>
            </div>
          )}
          <div className="filter-bar" style={{ marginBottom:12 }}>
            <select value={amortFilterTruck} onChange={e=>setAmortFilterTruck(e.target.value)} style={{ width:'auto' }}><option value="">All trucks</option>{companyTrucks.map(t=><option key={t.id} value={t.id}>{t.plate}</option>)}</select>
            <select value={amortFilterStatus} onChange={e=>setAmortFilterStatus(e.target.value)} style={{ width:'auto' }}><option value="">All status</option><option value="active">Active only</option><option value="ended">Ended only</option></select>
            {(amortFilterTruck||amortFilterStatus)&&<button className="btn-ghost btn-sm" onClick={()=>{setAmortFilterTruck('');setAmortFilterStatus('')}}>Clear</button>}
          </div>
          {amortizations.length===0&&!showAmortForm?<div className="empty-state"><p>No amortizations yet. Click + Add Amortization to start.</p></div>:(
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Truck</th><th>Description</th><th>Start</th><th>End</th><th className="text-right">Monthly (₱)</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {amortizations.filter(a=>{const now2=new Date().toISOString().slice(0,7);const active=a.start_date<=now2&&(!a.end_date||a.end_date>=now2);if(amortFilterTruck&&a.truck_id!==amortFilterTruck)return false;if(amortFilterStatus==='active'&&!active)return false;if(amortFilterStatus==='ended'&&active)return false;return true}).map(a=>{const truck=trucks.find(t=>t.id===a.truck_id);const nowStr=new Date().toISOString().slice(0,7);const active=a.start_date<=nowStr&&(!a.end_date||a.end_date>=nowStr);return(<tr key={a.id}><td style={{ fontWeight:500 }}>{truck?.plate||a.truck_id}</td><td>{a.description}</td><td className="mono" style={{ fontSize:12 }}>{a.start_date}</td><td className="mono muted" style={{ fontSize:12 }}>{a.end_date||'Ongoing'}</td><td className="text-right mono" style={{ fontWeight:500 }}>₱{fmt(a.monthly_amount)}</td><td><span className={`badge ${active?'badge-success':''}`} style={!active?{background:'var(--bg)',color:'var(--muted)',fontSize:10}:{fontSize:10}}>{active?'Active':'Ended'}</span></td><td><div style={{ display:'flex', gap:4 }}><button className="btn-ghost btn-sm" onClick={()=>{setAmortForm({...a});setEditAmortId(a.id);setShowAmortForm(true)}}>Edit</button><button className="btn-danger btn-sm" onClick={()=>setDeleteTarget({table:'amortizations',id:a.id})}>Delete</button></div></td></tr>)})}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── INSURANCE ── */}
      {tab === 'Insurance' && (
        <>
          {showInsForm && (
            <div className="card" style={{ marginBottom:24 }}>
              <h2 style={{ fontSize:15, fontWeight:500, marginBottom:16 }}>{editInsId?'Edit':'New'} Insurance</h2>
              <div className="form-grid" style={{ marginBottom:16 }}>
                <div className="form-group"><label className="label required">Insurance Type</label><select value={insForm.insurance_type} onChange={e=>setInsForm(f=>({...f,insurance_type:e.target.value}))}><option value="Cargo Insurance">Cargo Insurance</option><option value="Own Damage Insurance">Own Damage Insurance</option></select></div>
                <div className="form-group"><label className="label">Policy Number</label><input value={insForm.policy_no||''} onChange={e=>setInsForm(f=>({...f,policy_no:e.target.value}))} placeholder="e.g. POL-2025-0001" /></div>
                <div className="form-group"><label className="label required">Annual Amount (₱)</label><input type="number" step="0.01" value={insForm.annual_amount} onChange={e=>setInsForm(f=>({...f,annual_amount:e.target.value}))} placeholder="0.00" /></div>
                <div className="form-group"><label className="label required">Start Date</label><DateInput value={insForm.start_date} onChange={e=>setInsForm(f=>({...f,start_date:e.target.value}))} /></div>
                <div className="form-group span-2"><label className="label required">Description</label><input value={insForm.description} onChange={e=>setInsForm(f=>({...f,description:e.target.value}))} placeholder="e.g. OONA Insurance 2025" /></div>
              </div>
              <p className="section-label">Select Covered Trucks</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:16 }}>
                {companyTrucks.map(t=>(
                  <label key={t.id} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', border:`1.5px solid ${insForm.truck_ids.includes(t.id)?'var(--accent)':'var(--border)'}`, borderRadius:20, cursor:'pointer', fontSize:13, background:insForm.truck_ids.includes(t.id)?'var(--accent-light)':'var(--surface)', fontWeight:insForm.truck_ids.includes(t.id)?500:400 }}>
                    <input type="checkbox" checked={insForm.truck_ids.includes(t.id)} onChange={()=>toggleInsTruck(t.id)} style={{ width:'auto', margin:0 }} />{t.plate} <span style={{ fontSize:11, color:'var(--muted)', marginLeft:2 }}>({t.truck_type})</span>
                  </label>
                ))}
              </div>
              {insForm.truck_ids.length>0&&insForm.annual_amount&&<div style={{ padding:'10px 14px', background:'var(--accent-light)', borderRadius:8, fontSize:12, color:'var(--accent)', marginBottom:16 }}>₱{fmt(insForm.annual_amount)} ÷ {insForm.truck_ids.length} truck{insForm.truck_ids.length>1?'s':''} ÷ 12 months = <strong>₱{fmt(parseFloat(insForm.annual_amount)/insForm.truck_ids.length/12)} / truck / month</strong></div>}
              <div className="form-group" style={{ marginBottom:16 }}><label className="label">Remarks</label><textarea rows={2} value={insForm.remarks} onChange={e=>setInsForm(f=>({...f,remarks:e.target.value}))} style={{ resize:'vertical' }} /></div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}><button className="btn-ghost" onClick={()=>{setShowInsForm(false);setInsForm(EMPTY_INS);setEditInsId(null)}}>Cancel</button><button className="btn-primary" onClick={handleInsSubmit} disabled={saving}>{saving?'Saving…':editInsId?'Update':'Save'}</button></div>
            </div>
          )}
          <div className="filter-bar" style={{ marginBottom:12 }}>
            <input placeholder="Search policy no. or name…" value={insSearch} onChange={e=>setInsSearch(e.target.value)} style={{ flex:2 }} />
            <select value={insFilterType} onChange={e=>setInsFilterType(e.target.value)} style={{ width:'auto' }}><option value="">All types</option><option value="Cargo Insurance">Cargo Insurance</option><option value="Own Damage Insurance">Own Damage Insurance</option></select>
            <select value={insFilterTruck} onChange={e=>setInsFilterTruck(e.target.value)} style={{ width:'auto' }}><option value="">All trucks</option>{companyTrucks.map(t=><option key={t.id} value={t.id}>{t.plate}</option>)}</select>
            {(insFilterType||insFilterTruck||insSearch)&&<button className="btn-ghost btn-sm" onClick={()=>{setInsFilterType('');setInsFilterTruck('');setInsSearch('')}}>Clear</button>}
          </div>
          {insurances.length===0&&!showInsForm?<div className="empty-state"><p>No insurance entries yet.</p></div>:(
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type</th><th>Policy No.</th><th>Description</th><th>Trucks Covered</th><th>Start</th><th>Ends</th><th className="text-right">Annual (₱)</th><th className="text-right">Monthly/Truck (₱)</th><th></th></tr></thead>
                <tbody>
                  {insurances.filter(ins=>{if(insFilterType&&ins.insurance_type!==insFilterType)return false;if(insFilterTruck&&!ins.truck_ids?.includes(insFilterTruck))return false;if(insSearch&&!ins.description?.toLowerCase().includes(insSearch.toLowerCase())&&!ins.policy_no?.toLowerCase().includes(insSearch.toLowerCase()))return false;return true}).map(ins=>{const coveredTrucks=trucks.filter(t=>ins.truck_ids?.includes(t.id));const endDate=new Date(ins.start_date);endDate.setMonth(endDate.getMonth()+12);return(<tr key={ins.id}><td><span className="badge" style={{ background:'#FFF0F0', color:'#8B0000', fontSize:10 }}>{ins.insurance_type}</span></td><td className="mono muted" style={{ fontSize:12 }}>{ins.policy_no||'—'}</td><td>{ins.description}</td><td style={{ fontSize:12 }}>{coveredTrucks.map(t=>t.plate).join(', ')||'—'}</td><td className="mono" style={{ fontSize:12 }}>{fmtDate(ins.start_date)}</td><td className="mono" style={{ fontSize:12 }}>{fmtDate(endDate.toISOString().slice(0,10))}</td><td className="text-right mono" style={{ fontWeight:500 }}>₱{fmt(ins.annual_amount)}</td><td className="text-right mono">₱{fmt(insMonthlyPerTruck(ins))}</td><td><div style={{ display:'flex', gap:4 }}><button className="btn-ghost btn-sm" onClick={()=>{setInsForm({...ins,truck_ids:ins.truck_ids||[]});setEditInsId(ins.id);setShowInsForm(true)}}>Edit</button><button className="btn-danger btn-sm" onClick={()=>setDeleteTarget({table:'insurances',id:ins.id})}>Delete</button></div></td></tr>)})}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── STOCKS TAB ── */}
      {tab === 'Stocks' && (
        <div>
          <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16, flexWrap:'wrap' }}>
            <input value={stockSearch} onChange={e=>setStockSearch(e.target.value)} placeholder="Search stocks…"
              style={{ flex:1, minWidth:160, padding:'7px 12px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', fontSize:13 }} />
            <select value={stockFilterCat} onChange={e=>setStockFilterCat(e.target.value)}
              style={{ padding:'7px 12px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', fontSize:13 }}>
              <option value="">All Categories</option>
              {[...new Set(stocks.map(s=>s.category).filter(Boolean))].sort().map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
              {isAdmin && <button className="btn-primary" onClick={()=>{setEditingStockId(null);setStockForm({purchase_date:new Date().toISOString().slice(0,10),category:'',description:'',quantity:1,unit:'',unit_cost:'',reference_no:'',notes:''});setShowStockForm(true)}}>+ Add Stock</button>}
            </div>
          </div>

          {/* Summary */}
          {(() => {
            const unallocated = stocks.filter(s=>s.quantity_remaining>0)
            const totalValue = unallocated.reduce((s,i)=>s+(i.total_cost||0),0)
            return (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:16 }}>
                {[
                  { label:'Items In Stock', value: unallocated.length, color:'#d97706', icon:'📦' },
                  { label:'Stock Value Remaining', value:`₱${fmt(totalValue)}`, color:'var(--accent)', icon:'💰' },
                  { label:'Fully Allocated', value: stocks.filter(s=>s.quantity_remaining<=0).length, color:'#16a34a', icon:'✅' },
                ].map(c=>(
                  <div key={c.label} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px', position:'relative', overflow:'hidden' }}>
                    <div style={{ position:'absolute', top:8, right:10, fontSize:20, opacity:.15 }}>{c.icon}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{c.label}</div>
                    <div style={{ fontSize:18, fontWeight:800, color:c.color }}>{c.value}</div>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Stock list */}
          {stocksLoading ? <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Loading…</div> : (
            <div style={{ overflowX:'auto', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'var(--bg)', borderBottom:'2px solid var(--border)' }}>
                    {['Date','Category','Description','Qty','Unit','Unit Cost','Total','Ref #','Status',''].map((h,i)=>(
                      <th key={i} style={{ padding:'8px 12px', textAlign: i>=5&&i<=6?'right':'left', fontWeight:600, color:'var(--muted)', fontSize:11, textTransform:'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stocks.filter(s=>{
                    if (stockFilterCat && s.category !== stockFilterCat) return false
                    if (stockSearch && ![s.description,s.category,s.reference_no].some(v=>(v||'').toLowerCase().includes(stockSearch.toLowerCase()))) return false
                    return true
                  }).length === 0 ? (
                    <tr><td colSpan={10} style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>No stocks found.</td></tr>
                  ) : stocks.filter(s=>{
                    if (stockFilterCat && s.category !== stockFilterCat) return false
                    if (stockSearch && ![s.description,s.category,s.reference_no].some(v=>(v||'').toLowerCase().includes(stockSearch.toLowerCase()))) return false
                    return true
                  }).map(s=>(
                    <tr key={s.id} style={{ borderBottom:'1px solid var(--border)', opacity: s.quantity_remaining <= 0 ? 0.5 : 1 }}>
                      <td style={{ padding:'8px 12px', color:'var(--muted)' }}>{fmtDate(s.purchase_date)}</td>
                      <td style={{ padding:'8px 12px' }}>{s.category}</td>
                      <td style={{ padding:'8px 12px', fontWeight:500 }}>{s.description}</td>
                      <td style={{ padding:'8px 12px', textAlign:'center' }}>{s.quantity}</td>
                      <td style={{ padding:'8px 12px', color:'var(--muted)' }}>{s.unit||'—'}</td>
                      <td style={{ padding:'8px 12px', textAlign:'right' }}>₱{fmt(s.unit_cost)}</td>
                      <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:600 }}>₱{fmt(s.total_cost)}</td>
                      <td style={{ padding:'8px 12px', color:'var(--muted)', fontSize:12 }}>{s.reference_no||'—'}</td>
                      <td style={{ padding:'8px 12px' }}>
                        {s.quantity_remaining <= 0
                          ? <span style={{ fontSize:11, background:'#f0fdf4', color:'#16a34a', padding:'1px 7px', borderRadius:10, fontWeight:600 }}>✅ Fully Allocated</span>
                          : s.quantity_remaining < s.quantity
                            ? <span style={{ fontSize:11, background:'rgba(255,30,0,0.1)', color:'var(--accent)', padding:'1px 7px', borderRadius:10, fontWeight:600 }}>⚡ Partial ({s.quantity_remaining}/{s.quantity} left)</span>
                            : <span style={{ fontSize:11, background:'#fffbeb', color:'#d97706', padding:'1px 7px', borderRadius:10, fontWeight:600 }}>📦 In Stock ({s.quantity_remaining})</span>
                        }
                      </td>
                      <td style={{ padding:'8px 12px' }}>
                        {isAdmin && s.quantity_remaining > 0 && (
                          <div style={{ display:'flex', gap:4 }}>
                            <button onClick={()=>handleAllocateStock(s)} style={{ padding:'3px 8px', background:'var(--accent)', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontSize:11, fontWeight:600 }}>Allocate</button>
                            <button onClick={()=>{setEditingStockId(s.id);setStockForm({purchase_date:s.purchase_date,category:s.category,description:s.description,quantity:s.quantity,unit:s.unit||'',unit_cost:String(s.unit_cost),reference_no:s.reference_no||'',notes:s.notes||''});setShowStockForm(true)}} style={{ padding:'3px 7px', background:'#3b82f6', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontSize:11 }}>✏️</button>
                            <button onClick={()=>handleDeleteStock(s.id)} style={{ padding:'3px 7px', background:'#ef4444', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontSize:11 }}>🗑️</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:'2px solid var(--border)', background:'var(--bg)', fontWeight:700 }}>
                    <td colSpan={6} style={{ padding:'8px 12px', textAlign:'right', fontSize:13 }}>Total Unallocated Value:</td>
                    <td style={{ padding:'8px 12px', textAlign:'right', color:'var(--accent)', fontSize:14 }}>₱{fmt(stocks.filter(s=>s.quantity_remaining>0).reduce((s,i)=>s+((i.quantity_remaining||0)*(i.unit_cost||0)),0))}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Add/Edit Stock Modal */}
          {showStockForm && (
            <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'20px 16px', overflowY:'auto' }}
              onClick={e=>e.target===e.currentTarget&&setShowStockForm(false)}>
              <div style={{ background:'var(--surface)', borderRadius:10, border:'1px solid var(--border)', width:'100%', maxWidth:500, padding:24, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
                <h3 style={{ margin:'0 0 16px', fontSize:16, fontWeight:700 }}>{editingStockId?'Edit Stock':'+ Add Stock Item'}</h3>
                <div style={{ display:'grid', gap:12 }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Purchase Date</label>
                      <DateInput value={stockForm.purchase_date} onChange={e=>setStockForm(f=>({...f,purchase_date:e.target.value}))} style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Category *</label>
                      <input value={stockForm.category} onChange={e=>setStockForm(f=>({...f,category:e.target.value}))} list="stock-cats" placeholder="e.g. Engine Parts, Tires" style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} />
                      <datalist id="stock-cats"><option value="Engine Parts"/><option value="Tires"/><option value="Body Parts"/><option value="Electrical"/><option value="Brakes"/><option value="Suspension"/><option value="Filters"/><option value="Lubricants"/><option value="Other Parts"/></datalist></div>
                  </div>
                  <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Description *</label>
                    <input value={stockForm.description} onChange={e=>setStockForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Air filter Honda CRV" style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Quantity</label>
                      <input type="number" min="1" value={stockForm.quantity} onChange={e=>setStockForm(f=>({...f,quantity:e.target.value}))} style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Unit</label>
                      <input value={stockForm.unit} onChange={e=>setStockForm(f=>({...f,unit:e.target.value}))} placeholder="pcs, sets, liters" style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                    <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Unit Cost *</label>
                      <input type="number" value={stockForm.unit_cost} onChange={e=>setStockForm(f=>({...f,unit_cost:e.target.value}))} placeholder="0.00" style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                  </div>
                  {stockForm.quantity && stockForm.unit_cost && (
                    <div style={{ padding:'6px 12px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6, fontSize:12, color:'var(--muted)' }}>
                      Total: <strong style={{ color:'var(--text)' }}>₱{fmt((parseInt(stockForm.quantity)||0)*(parseFloat(stockForm.unit_cost)||0))}</strong>
                    </div>
                  )}
                  <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Reference / Receipt No.</label>
                    <input value={stockForm.reference_no} onChange={e=>setStockForm(f=>({...f,reference_no:e.target.value}))} placeholder="OR, PO number" style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                  <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:4 }}>
                    <button onClick={()=>{setShowStockForm(false);setEditingStockId(null)}} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:6, background:'transparent', cursor:'pointer', fontSize:13 }}>Cancel</button>
                    <button onClick={handleSaveStock} style={{ padding:'8px 20px', background:'var(--accent)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:600 }}>Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Allocate Stock Modal */}
      {allocateModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e=>e.target===e.currentTarget&&setAllocateModal(null)}>
          <div style={{ background:'var(--surface)', borderRadius:10, border:'1px solid var(--border)', width:'100%', maxWidth:420, padding:24, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin:'0 0 6px', fontSize:16, fontWeight:700 }}>🔧 Allocate to Truck</h3>
            <p style={{ margin:'0 0 16px', fontSize:13, color:'var(--muted)' }}>{allocateModal.stock.description} — {allocateModal.stock.quantity_remaining} {allocateModal.stock.unit||'pcs'} available</p>
            <div style={{ display:'grid', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Quantity</label>
                  <input type="number" min="1" max={allocateModal.stock.quantity_remaining} value={allocateModal.qty}
                    onChange={e=>setAllocateModal(m=>({...m,qty:parseInt(e.target.value)||1}))}
                    style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
                <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Allocation Date</label>
                  <DateInput value={allocateModal.alloc_date}
                    onChange={e=>setAllocateModal(m=>({...m,alloc_date:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, boxSizing:'border-box' }} /></div>
              </div>
              <div><label style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', display:'block', marginBottom:4 }}>Truck *</label>
                <select value={allocateModal.truck_id} onChange={e=>setAllocateModal(m=>({...m,truck_id:e.target.value}))}
                  style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13 }}>
                  <option value="">Select truck</option>
                  {companyTrucks.map(t=><option key={t.id} value={t.id}>{t.plate} ({t.truck_type})</option>)}
                </select></div>
              <div style={{ padding:'8px 12px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6, fontSize:12, color:'var(--muted)' }}>
                Expense amount: <strong style={{ color:'var(--text)' }}>₱{fmt((allocateModal.qty||0)*(allocateModal.stock.unit_cost||0))}</strong>
                <span style={{ marginLeft:8, color:'#16a34a', fontSize:11 }}>— no new cash out</span>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button onClick={()=>setAllocateModal(null)} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:6, background:'transparent', cursor:'pointer', fontSize:13 }}>Cancel</button>
                <button onClick={confirmAllocate} style={{ padding:'8px 20px', background:'var(--accent)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:600 }}>Allocate</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={()=>setDeleteTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Delete this entry?</h3>
            <p>This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>setDeleteTarget(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  )
}
