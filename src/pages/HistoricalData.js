import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import * as XLSX from 'xlsx'

const ADMIN_EXPENSE_CATS = ['Office Supplies','Utilities','Salaries','Government Fees','Repairs — Office','Insurance (Admin)','Other Admin']
const OPS_EXPENSE_CATS = ['Fuel','Driver Salary','Lubricants','Tires','Engine Parts','Body Parts','Repairs — Labor','Loading/Unloading','Toll Fees','Other Operation']
const OTHER_CATS = ['Salary (Summary)','Depreciation','Interest Expense','Other']

const EMPTY_EXPENSES = () => {
  const obj = {}
  ;[...ADMIN_EXPENSE_CATS, ...OPS_EXPENSE_CATS, ...OTHER_CATS].forEach(c => { obj[c] = '' })
  return obj
}

const EMPTY = {
  period_year: new Date().getFullYear().toString(),
  period_month: String(new Date().getMonth() + 1).padStart(2,'0'),
  truck_id: '',
  entry_type: 'detailed', // detailed | simple_management | simple_bookkeeper
  sales_dump: '', sales_pm: '',
  total_expenses_simple: '', // for simple entries
  credited_to_bank: '', // for bookkeeper entries
  expenses: EMPTY_EXPENSES(),
  notes: '',
}

export default function HistoricalData() {
  const { isAdmin } = useAuth()
  const { toast, showToast } = useToast()
  const [records, setRecords] = useState([])
  const [trucks, setTrucks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [filterYear, setFilterYear] = useState('')
  const [filterTruck, setFilterTruck] = useState('')
  const [viewMode, setViewMode] = useState('Management') // Management | Bookkeeper
  const [expandedId, setExpandedId] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const [importFile, setImportFile] = useState(null)

  const [liveMonths, setLiveMonths] = useState(new Set())

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [rec, tr, dt, pt] = await Promise.all([
      fetchAllRows(() => supabase.from('historical_data').select('*').order('period_year',{ascending:false}).order('period_month',{ascending:false})),
      supabase.from('trucks').select('id,plate,truck_type').eq('ownership','company').order('plate'),
      fetchAllRows(() => supabase.from('trips_dump').select('trip_date,truck_plate').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('trips_pm').select('trip_date,truck_plate').is('deleted_at', null)),
    ])
    if (rec.data) setRecords(rec.data)
    if (tr.data) setTrucks(tr.data)
    // Build set of months that have live trip data
    const allTrips = [...(dt.data||[]), ...(pt.data||[])]
    const months = new Set(allTrips.map(t => t.trip_date?.slice(0,7)).filter(Boolean))
    setLiveMonths(months)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const setExpense = (cat, val) => setForm(f => ({ ...f, expenses: { ...f.expenses, [cat]: val } }))

  const totalExpenses = (expObj) => Object.values(expObj||{}).reduce((s,v) => s+(parseFloat(v)||0), 0)
  const totalSales = (r) => {
    if (r.entry_type === 'simple_bookkeeper') return parseFloat(r.credited_to_bank)||0
    return (parseFloat(r.sales_dump)||0) + (parseFloat(r.sales_pm)||0)
  }

  const filtered = records.filter(r => {
    if (filterYear && String(r.period_year) !== String(filterYear)) return false
    if (filterTruck && r.truck_id !== filterTruck) return false
    return true
  })

  const getTruckName = (id) => id ? (trucks.find(t=>t.id===id)?.plate||'—') : 'Fleet-wide'

  const years = [...new Set(records.map(r=>String(r.period_year)))].sort((a,b)=>b-a)

  const handleSave = async () => {
    if (!form.period_year || !form.period_month) { showToast('Year and month are required.','error'); return }
    // Check for duplicate
    const dup = records.find(r => r.period_year === form.period_year && r.period_month === form.period_month && (r.truck_id||null) === (form.truck_id||null) && r.entry_type === (form.entry_type||'detailed') && r.id !== editId)
    if (dup) { showToast(`A ${form.entry_type||'detailed'} entry already exists for ${monthLabel(form.period_month)} ${form.period_year}${form.truck_id?' ('+trucks.find(t=>t.id===form.truck_id)?.plate+')':''}. Edit that entry instead.`, 'error'); return }
    setSaving(true)
    const payload = {
      period_year: form.period_year,
      period_month: form.period_month,
      truck_id: form.truck_id||null,
      sales_dump: parseFloat(form.sales_dump)||0,
      sales_pm: parseFloat(form.sales_pm)||0,
      expenses: form.expenses,
      notes: form.notes||'',
      is_historical: true,
    }
    let error
    if (editId) ({ error } = await supabase.from('historical_data').update(payload).eq('id',editId))
    else ({ error } = await supabase.from('historical_data').insert(payload))
    if (error) showToast('Error: '+error.message, 'error')
    else { showToast(editId?'Updated.':'Saved.'); setForm(EMPTY); setEditId(null); setShowForm(false); fetchAll() }
    setSaving(false)
  }

  const handleDelete = async () => {
    const { error: delErr } = await supabase.from('historical_data').delete().eq('id',deleteTarget)
    if (delErr) { showToast('Error: ' + delErr.message, 'error'); return }
    setDeleteTarget(null); showToast('Deleted.','info'); fetchAll()
  }

  const monthLabel = (m) => new Date(2000, parseInt(m)-1, 1).toLocaleDateString('en-PH',{month:'long'})

  // Summary totals for filtered
  const summaryTotalSales = filtered.reduce((s,r) => s+totalSales(r), 0)
  const summaryTotalExp = filtered.reduce((s,r) => s+totalExpenses(r.expenses), 0)
  const summaryNetIncome = summaryTotalSales - summaryTotalExp

  const ALL_EXPENSE_CATS = [...ADMIN_EXPENSE_CATS, ...OPS_EXPENSE_CATS, ...OTHER_CATS]

  const handleDownloadTemplate = (templateType = 'detailed') => {
    let headers, example, filename
    if (templateType === 'simple_management') {
      headers = ['Year','Month (1-12)','Truck Plate (blank=fleet-wide)','Total Sales','Total Expenses','Notes']
      example = [2024, 1, 'ABC 1234', 230000, 85000, 'Example row']
      filename = 'HistoricalData-Simple-Management.xlsx'
    } else if (templateType === 'simple_bookkeeper') {
      headers = ['Year','Month (1-12)','Total Credited to Bank','Total Expenses','Notes']
      example = [2024, 1, 195000, 85000, 'Example — fleet-wide only']
      filename = 'HistoricalData-Bookkeeper.xlsx'
    } else {
      headers = ['Year','Month (1-12)','Truck Plate (blank=fleet-wide)','Sales Dump','Sales PM',...ALL_EXPENSE_CATS,'Notes']
      example = [2024, 1, 'ABC 1234', 150000, 80000, ...ALL_EXPENSE_CATS.map(()=>''), 'Example entry']
      filename = 'HistoricalData-Detailed-Template.xlsx'
    }
    const XLSX2 = XLSX
    const ws = XLSX2.utils.aoa_to_sheet([headers, example])
    // Style header row (basic column widths)
    ws['!cols'] = headers.map(() => ({ wch: 20 }))
    const wb2 = XLSX2.utils.book_new()
    XLSX2.utils.book_append_sheet(wb2, ws, 'Historical Data')
    XLSX2.writeFile(wb2, filename)
    showToast('Template downloaded — fill in the data and upload back.')
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportFile(file)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        // Find header row (contains 'Year') — also handles Excel-formatted files
        let hdrIdx = raw.findIndex(row => String(row[0]).trim().toLowerCase() === 'year')
        // Fallback: if no 'Year' header found, check if first row looks like a header with month-like second col
        if (hdrIdx < 0) {
          hdrIdx = raw.findIndex(row => 
            String(row[0]).trim().toLowerCase().includes('year') ||
            (row.some(c => String(c).toLowerCase().includes('month')) && row.some(c => String(c).toLowerCase().includes('sales')))
          )
        }
        if (hdrIdx < 0) { showToast('Could not find header row. Make sure the first column header is "Year".', 'error'); return }
        const headers = raw[hdrIdx].map(h => String(h).trim())
        const dataRows = raw.slice(hdrIdx + 1).filter(r => r[0] && r[1])
        const ALL_CATS = [...ADMIN_EXPENSE_CATS, ...OPS_EXPENSE_CATS, ...OTHER_CATS]
        // Detect template type from headers
        const isBookkeeper = headers.includes('Total Credited to Bank')
        const isSimpleManagement = headers.includes('Total Sales') && !isBookkeeper
        const errors = []
        const parsed = dataRows.map((row, i) => {
          const get = (col) => { const idx = headers.indexOf(col); return idx >= 0 ? String(row[idx]||'').trim() : '' }
          const year = get('Year')
          const month = String(parseInt(get('Month (1-12)')||get('Month'))||0).padStart(2,'0')
          const notes = get('Notes')
          if (!year || year==='0') { errors.push(`Row ${i+1}: Missing year`); return null }
          if (month==='00') { errors.push(`Row ${i+1}: Invalid month`); return null }

          if (isBookkeeper) {
            const creditedToBank = parseFloat(get('Total Credited to Bank'))||0
            const totalExp = parseFloat(get('Total Expenses'))||0
            return { period_year: year, period_month: month, plate: '', entry_type: 'simple_bookkeeper',
              sales_dump: 0, sales_pm: 0, credited_to_bank: creditedToBank,
              expenses: { 'Total Expenses (Summary)': totalExp }, notes, is_historical: true }
          } else if (isSimpleManagement) {
            const plate = get('Truck Plate (blank=fleet-wide)') || get('Truck Plate') || ''
            const salesNet = parseFloat(get('Total Sales'))||0
            const totalExp = parseFloat(get('Total Expenses'))||0
            return { period_year: year, period_month: month, plate, entry_type: 'simple_management',
              sales_dump: salesNet, sales_pm: 0,
              expenses: { 'Total Expenses (Summary)': totalExp }, notes, is_historical: true }
          } else {
            const plate = get('Truck Plate (blank=fleet-wide)') || get('Truck Plate') || ''
            const salesDump = parseFloat(get('Sales Dump'))||0
            const salesPM = parseFloat(get('Sales PM'))||0
            const expenses = {}
            ALL_CATS.forEach(cat => { const v = parseFloat(get(cat)); if (v>0) expenses[cat] = v })
            return { period_year: year, period_month: month, plate, entry_type: 'detailed',
              sales_dump: salesDump, sales_pm: salesPM, expenses, notes, is_historical: true }
          }
        }).filter(Boolean)
        setImportErrors(errors)
        setImportRows(parsed)
        if (parsed.length === 0) showToast('No valid rows found.', 'error')
        else showToast(`${parsed.length} row(s) ready to import.`)
      } catch(err) { showToast('Error reading file: '+err.message, 'error') }
    }
    reader.readAsBinaryString(file)
  }

  const handleBulkImport = async () => {
    if (!importRows.length) return

    const proceedImport = async () => {
      setImporting(true)
      try {
        // Resolve all truck plates in one query
        const plates = [...new Set(importRows.map(r => r.plate).filter(Boolean))]
        let plateToId = {}
        if (plates.length > 0) {
          const { data: trucks } = await supabase.from('trucks').select('id,plate').in('plate', plates)
          trucks?.forEach(t => { plateToId[t.plate] = t.id })
        }
        // Build payload — skip rows with unresolved plates
        let failed = 0
        const payload = importRows.map(row => {
          const truck_id = row.plate ? (plateToId[row.plate] || null) : null
          if (row.plate && !truck_id) { failed++; return null }
          return {
            period_year: row.period_year, period_month: row.period_month,
            truck_id, sales_dump: row.sales_dump, sales_pm: row.sales_pm,
            credited_to_bank: row.credited_to_bank||0,
            entry_type: row.entry_type||'detailed',
            expenses: row.expenses, notes: row.notes, is_historical: true,
          }
        }).filter(Boolean)
        // Batch insert in chunks of 50
        let success = 0
        for (let i = 0; i < payload.length; i += 50) {
          const chunk = payload.slice(i, i + 50)
          const { error } = await supabase.from('historical_data').insert(chunk)
          if (error) { showToast('Insert error: ' + error.message, 'error'); setImporting(false); return }
          success += chunk.length
        }
        showToast(`Imported ${success} records.${failed > 0 ? ' ' + failed + ' skipped (truck plate not found).' : ''}`)
      } catch (err) {
        showToast('Import failed: ' + err.message, 'error')
      }
    setImporting(false); setShowImport(false); setImportRows([]); setImportFile(null); fetchAll()
    }

    // Check for existing records that would be duplicated
    const { data: existing } = await supabase.from('historical_data').select('period_year,period_month,truck_id,entry_type')
    if (existing?.length > 0) {
      const dupes = importRows.filter(row => existing.some(e =>
        String(e.period_year) === String(row.period_year) &&
        String(e.period_month) === String(row.period_month) &&
        String(e.entry_type||'detailed') === String(row.entry_type||'detailed')
      ))
      if (dupes.length > 0) {
        setConfirmState({
          title: 'Possible Duplicates',
          variant: 'warning',
          confirmLabel: 'Import Anyway',
          message: `${dupes.length} record(s) already exist for the same period/type. This will create duplicates.`,
          onConfirm: proceedImport,
        })
        return
      }
    }
    proceedImport()
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Historical Data <span style={{ fontSize:12, background:'rgba(255,30,0,0.1)', color:'var(--accent)', borderRadius:6, padding:'2px 8px', marginLeft:8, fontWeight:400 }}>📅 Historical</span></h1>
          <p className="page-sub">Monthly sales &amp; expense entries for past years — no individual trips required</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn-ghost" onClick={handleDownloadTemplate}>📥 Template</button>
          <button className="btn-ghost" onClick={()=>setShowImport(v=>!v)}>{showImport?'✕ Close Import':'📤 Bulk Import'}</button>
          {isAdmin && <button className="btn-primary" onClick={()=>{setShowForm(!showForm);setEditId(null);setForm(EMPTY)}}>{showForm?'✕ Cancel':'+ Add Entry'}</button>}
        </div>
      </div>

      {/* Summary cards */}
      <div className="stats-grid" style={{ marginBottom:16 }}>
        <div className="stat-card"><div className="stat-label">Total Sales {filterYear}</div><div className="stat-value sm" style={{ color:'var(--accent)' }}>₱{fmt(summaryTotalSales)}</div></div>
        <div className="stat-card"><div className="stat-label">Total Expenses</div><div className="stat-value sm" style={{ color:'var(--danger)' }}>₱{fmt(summaryTotalExp)}</div></div>
        <div className="stat-card"><div className="stat-label">Net Income</div><div className="stat-value sm" style={{ color:summaryNetIncome>=0?'var(--success)':'var(--danger)' }}>₱{fmt(summaryNetIncome)}</div></div>
        <div className="stat-card"><div className="stat-label">Entries</div><div className="stat-value">{filtered.length}</div></div>
      </div>

      {/* Bulk Import Panel */}
      {showImport && (
        <div className="card" style={{ marginBottom:16 }}>
          <h3 style={{ fontSize:14, fontWeight:500, marginBottom:12 }}>📤 Bulk Import from Excel</h3>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:12 }}>
            1. Download the template · 2. Fill in your data · 3. Upload the file · 4. Review and confirm
          </div>
          <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <span style={{ fontSize:11, color:'var(--muted)', alignSelf:'center' }}>Templates:</span>
              <button className="btn-ghost btn-sm" onClick={()=>handleDownloadTemplate('detailed')}>📊 Detailed</button>
              <button className="btn-ghost btn-sm" onClick={()=>handleDownloadTemplate('simple_management')}>📋 Simple (Mgmt)</button>
              <button className="btn-ghost btn-sm" onClick={()=>handleDownloadTemplate('simple_bookkeeper')}>🏦 Bookkeeper</button>
            </div>
            <label style={{ padding:'6px 14px', borderRadius:8, border:'1.5px dashed var(--accent)', color:'var(--accent)', cursor:'pointer', fontSize:12, fontWeight:500 }}>
              📂 Choose Excel File
              <input type="file" accept=".xlsx,.csv" onChange={handleFileChange} style={{ display:'none' }} />
            </label>
            {importFile && <span style={{ fontSize:12, color:'var(--muted)' }}>📄 {importFile.name}</span>}
          </div>

          {importErrors.length > 0 && (
            <div style={{ marginBottom:10, padding:'8px 12px', background:'rgba(220,38,38,0.07)', borderRadius:8, fontSize:11, color:'var(--danger)' }}>
              ⚠️ {importErrors.length} error(s): {importErrors.slice(0,3).join(' · ')}{importErrors.length>3?` (+${importErrors.length-3} more)`:''}
            </div>
          )}

          {importRows.length > 0 && (
            <>
              <div style={{ fontSize:12, marginBottom:8, fontWeight:500, color:'var(--success)' }}>✅ {importRows.length} rows ready</div>
              <div className="table-wrap" style={{ maxHeight:220, overflow:'auto', marginBottom:12 }}>
                <table className="table" style={{ fontSize:11 }}>
                  <thead><tr><th>Year</th><th>Month</th><th>Truck</th><th className="text-right">Sales</th><th className="text-right">Total Expenses</th><th>Type</th><th>Notes</th></tr></thead>
                  <tbody>
                    {importRows.map((r,i) => (
                      <tr key={i}>
                        <td>{r.period_year}</td>
                        <td>{new Date(2000,parseInt(r.period_month)-1,1).toLocaleDateString('en-PH',{month:'short'})}</td>
                        <td>{r.plate||'Fleet-wide'}</td>
                        <td className="text-right">
                          {r.entry_type === 'detailed'
                            ? <span>D: ₱{fmt(r.sales_dump)} / PM: ₱{fmt(r.sales_pm)}</span>
                            : <span>₱{fmt((parseFloat(r.sales_dump)||0)+(parseFloat(r.sales_pm)||0)+(parseFloat(r.credited_to_bank)||0))}</span>
                          }
                        </td>
                        <td className="text-right">₱{fmt(Object.values(r.expenses).reduce((s,v)=>s+(parseFloat(v)||0),0))}</td>
                        <td><span style={{ fontSize:10, background:'var(--bg)', borderRadius:4, padding:'1px 4px' }}>{r.entry_type==='simple_bookkeeper'?'🏦 Bookkeeper':r.entry_type==='simple_management'?'📋 Simple':'📊 Detailed'}</span></td>
                        <td>{r.notes||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn-ghost btn-sm" onClick={()=>{setImportRows([]);setImportFile(null);setImportErrors([])}}>Clear</button>
                <button className="btn-primary" onClick={handleBulkImport} disabled={importing}>{importing?'Importing…':`Import ${importRows.length} Records`}</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="card" style={{ marginBottom:16 }}>
          <h3 style={{ fontSize:14, fontWeight:500, marginBottom:14 }}>{editId?'Edit Entry':'New Historical Entry'}</h3>
          <div className="form-grid">
            <div className="form-group">
              <label className="label required">Year</label>
              <input type="number" value={form.period_year} onChange={e=>setForm(f=>({...f,period_year:e.target.value}))} placeholder="2023" min="2000" max="2099" />
            </div>
            <div className="form-group">
              <label className="label required">Month</label>
              <select value={form.period_month} onChange={e=>setForm(f=>({...f,period_month:e.target.value}))}>
                {Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Truck <span style={{ fontWeight:400,color:'var(--muted)' }}>(blank = fleet-wide)</span></label>
              <select value={form.truck_id} onChange={e=>setForm(f=>({...f,truck_id:e.target.value}))}>
                <option value="">Fleet-wide</option>
                {trucks.map(t=><option key={t.id} value={t.id}>{t.plate} ({t.truck_type})</option>)}
              </select>
            </div>
          </div>

          {/* Sales */}
          <div style={{ marginTop:14, marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--accent)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.06em' }}>Sales</div>
            <div className="form-grid">
              <div className="form-group"><label className="label">Dump Truck Sales (₱)</label><input type="number" step="0.01" value={form.sales_dump} onChange={e=>setForm(f=>({...f,sales_dump:e.target.value}))} placeholder="0.00" /></div>
              <div className="form-group"><label className="label">Prime Mover Sales (₱)</label><input type="number" step="0.01" value={form.sales_pm} onChange={e=>setForm(f=>({...f,sales_pm:e.target.value}))} placeholder="0.00" /></div>
              <div className="form-group">
                <label className="label">Total Sales</label>
                <div style={{ padding:'8px 12px', background:'var(--accent-light)', borderRadius:8, fontFamily:'var(--mono)', fontWeight:600, color:'var(--accent)' }}>
                  ₱{fmt((parseFloat(form.sales_dump)||0)+(parseFloat(form.sales_pm)||0))}
                </div>
              </div>
            </div>
          </div>

          {/* Admin Expenses */}
          <div style={{ marginTop:14, marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#4338CA', marginBottom:8, textTransform:'uppercase', letterSpacing:'.06em' }}>Admin Expenses</div>
            <div className="form-grid">
              {ADMIN_EXPENSE_CATS.map(cat => (
                <div key={cat} className="form-group">
                  <label className="label">{cat} (₱)</label>
                  <input type="number" step="0.01" value={form.expenses[cat]||''} onChange={e=>setExpense(cat,e.target.value)} placeholder="0.00" />
                </div>
              ))}
            </div>
          </div>

          {/* Operation Expenses */}
          <div style={{ marginTop:14, marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--danger)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.06em' }}>Operation Expenses</div>
            <div className="form-grid">
              {OPS_EXPENSE_CATS.map(cat => (
                <div key={cat} className="form-group">
                  <label className="label">{cat} (₱)</label>
                  <input type="number" step="0.01" value={form.expenses[cat]||''} onChange={e=>setExpense(cat,e.target.value)} placeholder="0.00" />
                </div>
              ))}
            </div>
          </div>

          {/* Other */}
          <div style={{ marginTop:14, marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--muted)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.06em' }}>Other</div>
            <div className="form-grid">
              {OTHER_CATS.map(cat => (
                <div key={cat} className="form-group">
                  <label className="label">{cat} (₱)</label>
                  <input type="number" step="0.01" value={form.expenses[cat]||''} onChange={e=>setExpense(cat,e.target.value)} placeholder="0.00" />
                </div>
              ))}
            </div>
          </div>

          {/* Expense totals preview */}
          <div style={{ padding:'10px 14px', background:'var(--bg)', borderRadius:8, marginTop:8, display:'flex', gap:20, fontSize:12, flexWrap:'wrap' }}>
            <span>Admin: <strong style={{ color:'#4338CA' }}>₱{fmt(ADMIN_EXPENSE_CATS.reduce((s,c)=>s+(parseFloat(form.expenses[c])||0),0))}</strong></span>
            <span>Operation: <strong style={{ color:'var(--danger)' }}>₱{fmt(OPS_EXPENSE_CATS.reduce((s,c)=>s+(parseFloat(form.expenses[c])||0),0))}</strong></span>
            <span>Other: <strong>₱{fmt(OTHER_CATS.reduce((s,c)=>s+(parseFloat(form.expenses[c])||0),0))}</strong></span>
            <span style={{ fontWeight:600 }}>Total Expenses: <strong style={{ color:'var(--danger)' }}>₱{fmt(totalExpenses(form.expenses))}</strong></span>
            <span style={{ fontWeight:700 }}>Net Income: <strong style={{ color:(totalSales(form)-totalExpenses(form.expenses))>=0?'var(--success)':'var(--danger)' }}>₱{fmt(totalSales(form)-totalExpenses(form.expenses))}</strong></span>
          </div>

          <div className="form-group" style={{ marginTop:14 }}>
            <label className="label">Notes</label>
            <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes for this entry" />
          </div>

          <div style={{ display:'flex', gap:8, marginTop:14 }}>
            <button className="btn-ghost" onClick={()=>{setShowForm(false);setEditId(null);setForm(EMPTY)}}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':'Save Entry'}</button>
          </div>
        </div>
      )}

      {/* View mode + Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ display:'flex', gap:6 }}>
          {['Management','Bookkeeper'].map(m => (
            <button key={m} onClick={()=>setViewMode(m)} className={viewMode===m?'btn-primary btn-sm':'btn-ghost btn-sm'}>{m}</button>
          ))}
        </div>
        <select value={filterYear} onChange={e=>setFilterYear(e.target.value)} style={{ width:'auto' }}>
          <option value="">All years</option>
          {years.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterTruck} onChange={e=>setFilterTruck(e.target.value)} style={{ width:'auto' }}>
          <option value="">All trucks</option>
          {trucks.map(t=><option key={t.id} value={t.id}>{t.plate}</option>)}
        </select>
        {(filterTruck) && <button className="btn-ghost btn-sm" onClick={()=>setFilterTruck('')}>Clear</button>}
      </div>

      {/* Records */}
      {loading ? <div className="empty-state"><p>Loading…</p></div> :
        filtered.length === 0 ? <div className="empty-state"><p>No historical entries found.</p></div> : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(r => {
            const tSales = totalSales(r)
            const tExp = totalExpenses(r.expenses)
            const netInc = tSales - tExp
            const adminExp = ADMIN_EXPENSE_CATS.reduce((s,c)=>s+(parseFloat(r.expenses?.[c])||0),0)
            const opsExp = OPS_EXPENSE_CATS.reduce((s,c)=>s+(parseFloat(r.expenses?.[c])||0),0)
            const otherExp = OTHER_CATS.reduce((s,c)=>s+(parseFloat(r.expenses?.[c])||0),0)
            const isExpanded = expandedId === r.id
            return (
              <div key={r.id} style={{ border:'0.5px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                {/* Header row */}
                <div onClick={()=>setExpandedId(isExpanded?null:r.id)} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--surface)', cursor:'pointer', flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>{monthLabel(r.period_month)} {r.period_year}</span>
                  <span style={{ fontSize:12, fontFamily:'var(--mono)', color:'var(--muted)' }}>{getTruckName(r.truck_id)}</span>
                  <span style={{ fontSize:10, background:'rgba(255,30,0,0.1)', color:'var(--accent)', borderRadius:10, padding:'1px 8px' }}>📅 Historical</span>
                  {liveMonths.has(`${r.period_year}-${r.period_month}`) && (
                    <span title="Live trip data exists for this month — check for potential overlap" style={{ fontSize:10, background:'rgba(220,38,38,0.1)', color:'var(--danger)', borderRadius:10, padding:'1px 8px', cursor:'help' }}>⚠️ Live data exists</span>
                  )}
                  <span style={{ fontSize:10, background:'var(--bg)', color:'var(--muted)', borderRadius:10, padding:'1px 8px' }}>{r.entry_type==='simple_bookkeeper'?'🏦 Bookkeeper':r.entry_type==='simple_management'?'📋 Simple':'📊 Detailed'}</span>
                  <span style={{ marginLeft:'auto', fontSize:12, fontFamily:'var(--mono)', color:'var(--accent)', fontWeight:600 }}>Sales: ₱{fmt(tSales)}</span>
                  <span style={{ fontSize:12, fontFamily:'var(--mono)', color:'var(--danger)' }}>Exp: ₱{fmt(tExp)}</span>
                  <span style={{ fontSize:12, fontFamily:'var(--mono)', fontWeight:700, color:netInc>=0?'var(--success)':'var(--danger)' }}>Net: ₱{fmt(netInc)}</span>
                  <span style={{ fontSize:12 }}>{isExpanded?'▲':'▼'}</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ padding:'12px 14px', borderTop:'0.5px solid var(--border)', background:'var(--bg)' }}>
                    <div style={{ display:'flex', gap:20, flexWrap:'wrap', marginBottom:12 }}>
                      <div><div style={{ fontSize:11, color:'var(--muted)' }}>Dump Sales</div><div style={{ fontFamily:'var(--mono)', fontWeight:600 }}>₱{fmt(r.sales_dump||0)}</div></div>
                      <div><div style={{ fontSize:11, color:'var(--muted)' }}>PM Sales</div><div style={{ fontFamily:'var(--mono)', fontWeight:600 }}>₱{fmt(r.sales_pm||0)}</div></div>
                    </div>

                    {viewMode === 'Management' && (
                      <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
                        <div><div style={{ fontSize:11, color:'#4338CA', fontWeight:600, marginBottom:4 }}>Admin Expenses</div>
                          {ADMIN_EXPENSE_CATS.filter(c=>parseFloat(r.expenses?.[c])>0).map(c=>(
                            <div key={c} style={{ fontSize:11, display:'flex', justifyContent:'space-between', gap:16 }}><span>{c}</span><span style={{ fontFamily:'var(--mono)' }}>₱{fmt(r.expenses[c])}</span></div>
                          ))}
                          <div style={{ fontSize:11, fontWeight:600, color:'#4338CA', marginTop:4 }}>Total: ₱{fmt(adminExp)}</div>
                        </div>
                        <div><div style={{ fontSize:11, color:'var(--danger)', fontWeight:600, marginBottom:4 }}>Operation Expenses</div>
                          {OPS_EXPENSE_CATS.filter(c=>parseFloat(r.expenses?.[c])>0).map(c=>(
                            <div key={c} style={{ fontSize:11, display:'flex', justifyContent:'space-between', gap:16 }}><span>{c}</span><span style={{ fontFamily:'var(--mono)' }}>₱{fmt(r.expenses[c])}</span></div>
                          ))}
                          <div style={{ fontSize:11, fontWeight:600, color:'var(--danger)', marginTop:4 }}>Total: ₱{fmt(opsExp)}</div>
                        </div>
                        {otherExp > 0 && <div><div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:4 }}>Other</div>
                          {OTHER_CATS.filter(c=>parseFloat(r.expenses?.[c])>0).map(c=>(
                            <div key={c} style={{ fontSize:11, display:'flex', justifyContent:'space-between', gap:16 }}><span>{c}</span><span style={{ fontFamily:'var(--mono)' }}>₱{fmt(r.expenses[c])}</span></div>
                          ))}
                          <div style={{ fontSize:11, fontWeight:600, marginTop:4 }}>Total: ₱{fmt(otherExp)}</div>
                        </div>}
                      </div>
                    )}

                    {viewMode === 'Bookkeeper' && (
                      <div>
                        <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>All expense categories:</div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:4 }}>
                          {[...ADMIN_EXPENSE_CATS,...OPS_EXPENSE_CATS,...OTHER_CATS].filter(c=>parseFloat(r.expenses?.[c])>0).map(c=>(
                            <div key={c} style={{ fontSize:11, display:'flex', justifyContent:'space-between', padding:'2px 6px', background:'var(--surface)', borderRadius:4 }}>
                              <span>{c}</span><span style={{ fontFamily:'var(--mono)' }}>₱{fmt(r.expenses[c])}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop:8, fontSize:12, fontWeight:600 }}>
                          Total Sales: ₱{fmt(tSales)} · WHT 2%: ₱{fmt(tSales*0.02)} · Net Receivable: ₱{fmt(tSales*0.98)}
                        </div>
                      </div>
                    )}

                    {r.notes && <div style={{ marginTop:8, fontSize:11, color:'var(--muted)', fontStyle:'italic' }}>Note: {r.notes}</div>}

                    {isAdmin && <div style={{ display:'flex', gap:8, marginTop:12 }}>
                      <button className="btn-ghost btn-sm" onClick={()=>{setEditId(r.id);setForm({...r,expenses:{...EMPTY_EXPENSES(),...(r.expenses||{})},truck_id:r.truck_id||''});setShowForm(true);setExpandedId(null)}}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={()=>setDeleteTarget(r.id)}>Delete</button>
                    </div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={()=>setDeleteTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Delete this historical entry?</h3><p>This action cannot be undone.</p>
            <div className="modal-actions"><button className="btn-ghost" onClick={()=>setDeleteTarget(null)}>Cancel</button><button className="btn-danger" onClick={handleDelete}>Delete</button></div>
          </div>
        </div>
      )}
      <Toast toast={toast} />
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}
