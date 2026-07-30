import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'
import * as XLSX from 'xlsx'

const TABLES = [
  // Trips & Billing
  { key: 'trips_dump', label: 'Dump Truck Trips' },
  { key: 'trips_pm', label: 'Prime Mover Trips' },
  { key: 'invoices', label: 'Invoices' },
  // Expenses
  { key: 'expenses', label: 'Expenses' },
  { key: 'amortizations', label: 'Amortizations' },
  { key: 'insurances', label: 'Insurances' },
  // Finance
  { key: 'vouchers', label: 'Check Vouchers' },
  { key: 'cash_vouchers', label: 'Cash Vouchers' },
  { key: 'loans', label: 'Loans' },
  { key: 'extra_income', label: 'Extra Income' },
  { key: 'finances', label: 'Finances' },
  { key: 'historical_data', label: 'Historical Data' },
  // Payroll
  { key: 'payroll_employees', label: 'Payroll Employees' },
  { key: 'payroll_entries', label: 'Payroll Entries' },
  { key: 'payroll_cash_advances', label: 'Payroll Cash Advances' },
  // Settings & Reference
  { key: 'trucks', label: 'Trucks' },
  { key: 'clients', label: 'Clients' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'commodities', label: 'Commodities' },
  { key: 'signatories', label: 'Signatories' },
  { key: 'saved_routes', label: 'Saved Routes' },
  { key: 'saved_rates', label: 'Saved Rates' },
  { key: 'print_templates', label: 'Print Templates' },
  { key: 'orcr_records', label: 'OR/CR Records' },
  { key: 'company_settings', label: 'Company Settings' },
  { key: 'profiles', label: 'Users' },
  // Logs (superuser only)
  { key: 'login_logs', label: 'Login Logs', superuserOnly: true },
  { key: 'audit_logs', label: 'Audit Logs', superuserOnly: true },
]

export default function Backup() {
  const { isSuperuser } = useAuth()

  const fetchAutoBackups = async () => {
    setLoadingBackups(true)
    const { data } = await supabase.storage.from('backups').list('auto', { sortBy: { column: 'created_at', order: 'desc' }, limit: 12 })
    setAutoBackups(data || [])
    setLoadingBackups(false)
  }

  const runAutoBackup = async () => {
    setRunningAutoBackup(true)
    try {
      const wb = XLSX.utils.book_new()
      for (const t of TABLES) {
        const { data } = await supabase.from(t.key).select('*').limit(50000)
        if (data?.length) { const ws = XLSX.utils.json_to_sheet(data); XLSX.utils.book_append_sheet(wb, ws, t.label.slice(0,31)) }
      }
      const dateStr = new Date().toISOString().slice(0,10)
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const { error } = await supabase.storage.from('backups').upload('auto/FMS-Backup-' + dateStr + '.xlsx', blob, { upsert: true })
      if (error) { showToast('Backup failed: ' + error.message, 'error'); setRunningAutoBackup(false); return }
      const { data: allFiles } = await supabase.storage.from('backups').list('auto', { sortBy: { column: 'created_at', order: 'desc' } })
      if (allFiles && allFiles.length > 8) await supabase.storage.from('backups').remove(allFiles.slice(8).map(f => 'auto/' + f.name))
      showToast('Backup saved to Supabase Storage.'); fetchAutoBackups()
    } catch(e) { showToast('Error: ' + e.message, 'error') }
    setRunningAutoBackup(false)
  }

  const downloadAutoBackup = async (fname) => {
    const { data } = await supabase.storage.from('backups').download('auto/' + fname)
    if (!data) { showToast('Download failed.', 'error'); return }
    const url = URL.createObjectURL(data)
    const a = document.createElement('a'); a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url)
  }
  const { toast, showToast } = useToast()
  const visibleTables = TABLES.filter(t => !t.superuserOnly || isSuperuser)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [counts, setCounts] = useState({})
  const [importing, setImporting] = useState(false)
  const [lastBackup, setLastBackup] = useState(() => localStorage.getItem('ds_last_backup') || null)
  const [importProgress, setImportProgress] = useState('')
  const [importResults, setImportResults] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [autoBackups, setAutoBackups] = useState([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [runningAutoBackup, setRunningAutoBackup] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    setProgress('Starting backup…')
    try {
      const companyName = (localStorage.getItem('ds_company_name') || 'DRAGON SPEED TRUCKING CORPORATION').toUpperCase()
      const exportDate = new Date().toLocaleString('en-PH')
      const newCounts = {}
      const sheetBlocks = []

      for (const table of visibleTables) {
        setProgress(`Exporting ${table.label}…`)
        const { data, error } = await supabase.from(table.key).select('*').order('created_at', { ascending: true })
        if (error) { showToast(`Error exporting ${table.label}: ${error.message}`, 'error'); continue }
        const rows = data || []
        newCounts[table.key] = rows.length
        const flat = rows.map(row => {
          const r = { ...row }
          Object.keys(r).forEach(k => { if (typeof r[k] === 'object' && r[k] !== null) r[k] = JSON.stringify(r[k]) })
          return r
        })

        if (flat.length === 0) {
          sheetBlocks.push(`<table><tr><td colspan="2" style="background:#F17200;color:#fff;font-weight:bold;font-size:11pt;text-align:center;padding:5px">${table.label}</td></tr><tr><td>No data</td></tr></table>`)
          continue
        }

        const keys = Object.keys(flat[0])
        let tbl = `<table>
          <tr><td colspan="${keys.length}" style="background:#F17200;color:#fff;font-weight:bold;font-size:12pt;text-align:center;padding:6px">${companyName}</td></tr>
          <tr><td colspan="${keys.length}" style="background:#1F2937;color:#fff;font-weight:bold;font-size:10pt;text-align:center;padding:5px">${table.label.toUpperCase()}</td></tr>
          <tr><td colspan="${keys.length}" style="background:#FFF3E0;color:#374151;text-align:center;font-size:8pt;padding:3px">Exported: ${exportDate} — ${flat.length} records</td></tr>
          <tr>${keys.map(k => `<th style="background:#374151;color:#fff;font-weight:bold;font-size:8pt;padding:4px 6px;border:1px solid #999;text-align:center">${k.replace(/_/g,' ').toUpperCase()}</th>`).join('')}</tr>`
        flat.forEach((row, i) => {
          const bg = i % 2 === 0 ? '#FFFFFF' : '#F5F5F5'
          tbl += `<tr style="background:${bg}">${keys.map(k => `<td style="font-size:8pt;padding:3px 5px;border:1px solid #ddd">${row[k] == null ? '' : String(row[k])}</td>`).join('')}</tr>`
        })
        tbl += '</table>'
        sheetBlocks.push(tbl)
      }

      // Summary block
      const summaryTbl = `<table>
        <tr><td colspan="3" style="background:#F17200;color:#fff;font-weight:bold;font-size:12pt;text-align:center;padding:6px">${companyName}</td></tr>
        <tr><td colspan="3" style="background:#1F2937;color:#fff;font-weight:bold;font-size:10pt;text-align:center;padding:5px">BACKUP SUMMARY</td></tr>
        <tr><td colspan="3" style="background:#FFF3E0;text-align:center;font-size:8pt;padding:3px">${exportDate}</td></tr>
        <tr>
          <th style="background:#374151;color:#fff;padding:4px 8px;border:1px solid #999">Table</th>
          <th style="background:#374151;color:#fff;padding:4px 8px;border:1px solid #999;text-align:center">Records</th>
        </tr>
        ${visibleTables.map((t, i) => `<tr style="background:${i%2===0?'#FFFFFF':'#F5F5F5'}"><td style="padding:3px 8px;border:1px solid #ddd">${t.label}</td><td style="text-align:center;padding:3px 8px;border:1px solid #ddd;font-weight:bold">${newCounts[t.key]||0}</td></tr>`).join('')}
      </table>`

      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"><style>body{font-family:Calibri,Arial;font-size:9pt;}table{border-collapse:collapse;width:100%;page-break-after:always;}</style></head>
        <body>${summaryTbl}${sheetBlocks.join('')}</body></html>`

      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `FMS-Backup-${new Date().toISOString().slice(0,10)}.xls`
      a.click(); URL.revokeObjectURL(url)

      const backupTime = new Date().toLocaleString('en-PH')
      localStorage.setItem('ds_last_backup', backupTime)
      setLastBackup(backupTime)
      setCounts(newCounts)
      setProgress('')
      showToast('Backup exported successfully!')
    } catch (err) {
      showToast('Error: ' + err.message, 'error')
    }
    setLoading(false)
  }

  // Step 1: Parse file and show preview
  const handleImportPreview = async (file) => {
    if (!file) return
    setImporting(true)
    setImportResults(null)
    setImportPreview(null)
    try {
      const { read, utils } = await import('xlsx')
      const data = await file.arrayBuffer()
      const wb = read(data)
      const preview = {}
      let valid = true
      for (const table of visibleTables) {
        const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes(table.label.toLowerCase().slice(0, 8)))
        if (!sheetName) { preview[table.key] = { label: table.label, rows: 0, error: 'Sheet not found' }; continue }
        const rows = utils.sheet_to_json(wb.Sheets[sheetName])
        preview[table.key] = { label: table.label, rows: rows.length, sample: rows[0] }
      }
      const totalRows = Object.values(preview).reduce((s, t) => s + (t.rows || 0), 0)
      if (totalRows === 0) { showToast('No data found in file.', 'error'); valid = false }
      if (valid) setImportPreview({ preview, wb, utils })
    } catch (err) {
      showToast('Error reading file: ' + err.message, 'error')
    }
    setImporting(false)
  }

  // Step 2: Confirm and actually import
  const handleImportConfirm = async () => {
    if (!importPreview) return
    const { wb, utils } = importPreview
    setImporting(true)
    setImportResults(null)
    const results = {}
    try {
      for (const table of visibleTables) {
        const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes(table.label.toLowerCase().slice(0, 8)))
        if (!sheetName) { results[table.key] = { skipped: 0, inserted: 0, error: 'Sheet not found', label: table.label }; continue }
        setImportProgress(`Importing ${table.label}…`)
        const rows = utils.sheet_to_json(wb.Sheets[sheetName])
        if (!rows.length) { results[table.key] = { skipped: 0, inserted: 0, error: 'Empty sheet', label: table.label }; continue }
        let inserted = 0, skipped = 0, errors = 0
        const batches = []
        for (let i = 0; i < rows.length; i += 50) batches.push(rows.slice(i, i + 50))
        for (const batch of batches) {
          const parsed = batch.map(row => {
            const r = { ...row }
            Object.keys(r).forEach(k => {
              if (typeof r[k] === 'string' && (r[k].startsWith('{') || r[k].startsWith('['))) { try { r[k] = JSON.parse(r[k]) } catch (e) {} }
              if (r[k] === '' || r[k] === undefined) delete r[k]
            })
            return r
          })
          const ids = parsed.map(r => r.id).filter(Boolean)
          let existingIds = new Set()
          if (ids.length > 0) {
            const { data: existing } = await supabase.from(table.key).select('id').in('id', ids)
            existingIds = new Set((existing || []).map(r => r.id))
          }
          const toInsert = parsed.filter(r => !r.id || !existingIds.has(r.id))
          skipped += parsed.filter(r => r.id && existingIds.has(r.id)).length
          if (toInsert.length > 0) {
            const { error, data: ins } = await supabase.from(table.key).insert(toInsert).select()
            if (error) { errors += toInsert.length } else inserted += (ins?.length || toInsert.length)
          }
        }
        results[table.key] = { inserted, skipped, errors, label: table.label }
      }
      setImportResults(results)
      setImportPreview(null)
      showToast('Import complete!')
    } catch (err) {
      showToast('Import error: ' + err.message, 'error')
    }
    setImportProgress('')
    setImporting(false)
  }

  const totalRows = Object.values(counts).reduce((s, v) => s + v, 0)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Database Backup</h1>
          <p className="page-sub">Export all data to Excel for safekeeping</p>
        </div>
        <button className="btn-primary" onClick={handleExport} disabled={loading}>
          {loading ? `⏳ ${progress}` : '⬇ Export All to Excel'}
        </button>
      </div>

      {lastBackup && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          ✅ Last backup: <strong>{lastBackup}</strong>
        </div>
      )}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>What gets exported</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {visibleTables.map(t => (
            <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
              <span style={{ fontSize: 13 }}>{t.label}</span>
              {counts[t.key] !== undefined && (
                <span className="badge badge-success" style={{ fontSize: 10 }}>{counts[t.key]} rows</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {totalRows > 0 && (
        <div style={{ padding: '12px 16px', background: 'var(--success-light)', borderRadius: 8, fontSize: 13, color: 'var(--success)' }}>
          ✅ Last export: <strong>{totalRows} total rows</strong> across {visibleTables.length} tables. Saved as Excel file.
        </div>
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Notes</h2>
        <ul style={{ fontSize: 13, color: 'var(--muted)', paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Each table is exported as a separate sheet in the Excel file</li>
          <li>JSON fields (like container details) are exported as text strings</li>
          <li>Passwords and sensitive auth data are <strong>not</strong> exported</li>
          <li>Save the Excel file to a safe location (USB drive, NAS, Google Drive)</li>
          <li>Recommended: export at least once a week</li>
        </ul>
      </div>

      {/* Import Section — superuser only */}
      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 500 }}>📥 Import / Restore from Backup</h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Superuser only · Skips existing records (no overwrites)</p>
          </div>
          {isSuperuser && <button className="btn-ghost btn-sm" onClick={() => setShowImport(s => !s)}>{showImport ? 'Hide' : 'Show'}</button>}
        </div>
        {showImport && (
          <div>
            <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 8, marginBottom: 14, fontSize: 12, color: 'var(--danger)' }}>
              ⚠️ Import will ADD records from the backup. Existing records (same ID) are SKIPPED — no data will be deleted or overwritten. Always backup current data first before importing.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {importing ? `⏳ ${importProgress}` : '📂 Select Backup Excel File'}
                <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={importing}
                  onChange={e => { if (e.target.files[0]) handleImportPreview(e.target.files[0]); e.target.value = '' }} />
              </label>
            </div>
            {importPreview && (
          <div style={{ marginTop: 12, padding: '12px 14px', background: '#FFF3E0', border: '1px solid #F17200', borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#C05300' }}>📋 Preview — Review before importing</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              {Object.values(importPreview.preview).map(t => (
                <div key={t.label} style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <span style={{ minWidth: 140, fontWeight: 500 }}>{t.label}</span>
                  {t.error
                    ? <span style={{ color: 'var(--danger)' }}>⚠️ {t.error}</span>
                    : <span style={{ color: t.rows > 0 ? 'var(--success)' : 'var(--muted)' }}>{t.rows} rows</span>
                  }
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
              Existing records (same ID) will be skipped. New records will be added.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost btn-sm" onClick={() => setImportPreview(null)}>Cancel</button>
              <button className="btn-primary btn-sm" onClick={handleImportConfirm} disabled={importing}>
                {importing ? `⏳ ${importProgress}` : '✅ Confirm Import'}
              </button>
            </div>
          </div>
        )}
        {importResults && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Import Results:</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                  {Object.values(importResults).map(r => (
                    <div key={r.label} style={{ padding: '8px 12px', background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)', fontSize: 12 }}>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>{r.label}</div>
                      {r.error ? <span style={{ color: 'var(--muted)' }}>{r.error}</span> : <>
                        <span style={{ color: 'var(--success)' }}>+{r.inserted} inserted</span>
                        {r.skipped > 0 && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{r.skipped} skipped</span>}
                        {r.errors > 0 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>{r.errors} errors</span>}
                      </>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop:32, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
          <div>
            <h3 style={{ margin:'0 0 4px', fontSize:15, fontWeight:700 }}>☁️ Supabase Storage Backups</h3>
            <p style={{ margin:0, fontSize:12, color:'var(--muted)' }}>Saves to Supabase Storage. Keeps last 8 backups. Download anytime.</p>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={fetchAutoBackups} className="btn-ghost" style={{ fontSize:12 }}>🔄 Refresh</button>
            <button onClick={runAutoBackup} disabled={runningAutoBackup} className="btn-primary" style={{ fontSize:12 }}>
              {runningAutoBackup ? '⏳ Saving…' : '💾 Save Backup Now'}
            </button>
          </div>
        </div>
        {loadingBackups ? <div style={{ textAlign:'center', padding:20, color:'var(--muted)', fontSize:13 }}>Loading…</div>
        : autoBackups.length === 0 ? (
          <div style={{ textAlign:'center', padding:24, color:'var(--muted)', fontSize:13 }}>
            <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
            <div>No backups yet. Click "Save Backup Now" to create the first one.</div>
            <div style={{ marginTop:8, fontSize:11, color:'#d97706' }}>⚠️ First: create a "backups" bucket in Supabase Storage (Storage → New bucket → name: backups → public: off).</div>
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead><tr style={{ background:'var(--bg)', borderBottom:'1px solid var(--border)' }}>
              <th style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, color:'var(--muted)', fontSize:11, textTransform:'uppercase' }}>File</th>
              <th style={{ padding:'8px 12px', textAlign:'right', fontWeight:600, color:'var(--muted)', fontSize:11, textTransform:'uppercase' }}>Size</th>
              <th style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, color:'var(--muted)', fontSize:11, textTransform:'uppercase' }}>Saved</th>
              <th style={{ padding:'8px 12px', textAlign:'center', fontWeight:600, color:'var(--muted)', fontSize:11, textTransform:'uppercase' }}>Download</th>
            </tr></thead>
            <tbody>
              {autoBackups.map((f, i) => (
                <tr key={f.name} style={{ borderBottom:'1px solid var(--border)', background:i===0?'rgba(22,163,74,0.04)':'transparent' }}>
                  <td style={{ padding:'8px 12px' }}>
                    {i===0 && <span style={{ fontSize:10, background:'#dcfce7', color:'#16a34a', padding:'1px 6px', borderRadius:10, fontWeight:600, marginRight:6 }}>Latest</span>}
                    {f.name}
                  </td>
                  <td style={{ padding:'8px 12px', textAlign:'right', color:'var(--muted)' }}>{f.metadata?.size ? (f.metadata.size/1024/1024).toFixed(2)+' MB' : '—'}</td>
                  <td style={{ padding:'8px 12px', color:'var(--muted)' }}>{f.created_at ? new Date(f.created_at).toLocaleString('en-PH') : '—'}</td>
                  <td style={{ padding:'8px 12px', textAlign:'center' }}>
                    <button onClick={()=>downloadAutoBackup(f.name)} style={{ padding:'4px 12px', background:'var(--accent)', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12 }}>⬇ Download</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  )
}
