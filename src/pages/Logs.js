import { useState, useEffect, useCallback } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import * as XLSX from 'xlsx'
import { useToast, Toast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

const TODAY = new Date().toISOString().slice(0, 10)

const fmtDateTime = (ts) => {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
}

const fmtDateLabel = (dateStr) => {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

const prevDay = (d) => { const [y,m,day] = d.split('-').map(Number); const dt = new Date(y, m-1, day-1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` }
const nextDay = (d) => { const [y,m,day] = d.split('-').map(Number); const dt = new Date(y, m-1, day+1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` }

const ACTION_COLORS = {
  Deleted:        { bg: 'rgba(220,38,38,0.12)',  color: '#dc2626', icon: '🗑️' },
  Edited:         { bg: 'rgba(234,179,8,0.12)',  color: '#a16207', icon: '✏️' },
  Updated:        { bg: 'rgba(234,179,8,0.12)',  color: '#a16207', icon: '✏️' },
  Created:        { bg: 'rgba(22,163,74,0.12)',  color: '#15803d', icon: '✅' },
  Generated:      { bg: 'rgba(37,99,235,0.12)',  color: '#1d4ed8', icon: '📄' },
  'Override PIN Used': { bg: 'rgba(239,68,68,0.15)', color: '#b91c1c', icon: '🔑' },
}

export default function Logs() {
  const { toast, showToast } = useToast()
  const { profile, isSuperuser, isAdmin } = useAuth()
  const [tab, setTab] = useState('login')
  const [date, setDate] = useState(TODAY)
  const [loginLogs, setLoginLogs] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [auditSettings, setAuditSettings] = useState({
    audit_enabled: false, audit_retention: '1year', audit_auto_purge: false,
    audit_enabled_since: null, audit_last_purge: null, audit_last_export: null
  })
  const [loading, setLoading] = useState(true)
  const [filterUser, setFilterUser] = useState('')
  const [filterModule, setFilterModule] = useState('')
  const [page, setPage] = useState(1)
  const [purging, setPurging] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const PAGE_SIZE = 50

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const start = date + 'T00:00:00+00:00'
    const end   = date + 'T23:59:59+00:00'
    const [ll, al, as_] = await Promise.all([
      supabase.from('login_logs').select('*').gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false }),
      fetchAllRows(() => supabase.from('audit_logs').select('*').gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false })),
      supabase.from('company_settings').select('audit_enabled,audit_retention,audit_enabled_since,audit_last_purge,audit_last_export,audit_auto_purge').eq('id', 1).maybeSingle(),
    ])
    if (ll.data) setLoginLogs(ll.data)
    if (al.data) setAuditLogs(al.data)
    if (as_.data) setAuditSettings(as_.data)
    setLoading(false)
    setPage(1)
  }, [date])

  useEffect(() => { fetchAll() }, [fetchAll])

  const toggleAudit = async () => {
    const newVal = !auditSettings.audit_enabled
    const update = { audit_enabled: newVal, ...(newVal && { audit_enabled_since: new Date().toISOString() }) }
    const { error } = await supabase.from('company_settings').update(update).eq('id', 1)
    if (error) { showToast('Error saving: ' + error.message, 'error'); return }
    // Re-fetch to confirm DB value
    const { data: confirm } = await supabase.from('company_settings').select('audit_enabled').eq('id', 1).maybeSingle()
    setAuditSettings(s => ({ ...s, ...update, audit_enabled: confirm?.audit_enabled ?? newVal }))
    showToast(`Audit logging ${newVal ? 'enabled ✅' : 'disabled'}.`)
  }

  const handlePurge = async () => {
    const proceedPurge = async () => {
    setPurging(true)
    const retention = auditSettings.audit_retention || '1year'
    const cutoff = new Date()
    if (retention === '30days') cutoff.setDate(cutoff.getDate() - 30)
    else if (retention === '90days') cutoff.setDate(cutoff.getDate() - 90)
    else if (retention === '6months') cutoff.setMonth(cutoff.getMonth() - 6)
    else cutoff.setFullYear(cutoff.getFullYear() - 1)
    const cutoffStr = cutoff.toISOString()

    // Step 1: Fetch logs to be purged
    const [{ data: auditData }, { data: loginData }] = await Promise.all([
      fetchAllRows(() => supabase.from('audit_logs').select('*').lt('created_at', cutoffStr).order('created_at')),
      supabase.from('login_logs').select('*').lt('created_at', cutoffStr).order('created_at'),
    ])

    // Step 2: Auto-export to Excel before deleting
    if ((auditData?.length || 0) + (loginData?.length || 0) > 0) {
      const wb = XLSX.utils.book_new()
      if (auditData?.length) {
        const auditHeaders = ['Date','Action','Module','Description','Record ID','Performed By']
        const auditRows = auditData.map(r => [
          new Date(r.created_at).toLocaleString('en-PH'),
          r.action_type || '', r.module || '', r.description || '',
          r.record_id || '', r.performed_by_name || ''
        ])
        const ws1 = XLSX.utils.aoa_to_sheet([auditHeaders, ...auditRows])
        ws1['!cols'] = auditHeaders.map(() => ({ wch: 20 }))
        XLSX.utils.book_append_sheet(wb, ws1, 'Audit Logs')
      }
      if (loginData?.length) {
        const loginHeaders = ['Date','Email','Role','IP Address','Status']
        const loginRows = loginData.map(r => [
          new Date(r.created_at).toLocaleString('en-PH'),
          r.email || '', r.role || '', r.ip_address || '', r.status || ''
        ])
        const ws2 = XLSX.utils.aoa_to_sheet([loginHeaders, ...loginRows])
        ws2['!cols'] = loginHeaders.map(() => ({ wch: 20 }))
        XLSX.utils.book_append_sheet(wb, ws2, 'Login Logs')
      }
      const dateStr = new Date().toISOString().slice(0,10)
      XLSX.writeFile(wb, `FMS-Logs-Archive-${dateStr}.xlsx`)
    }

    // Step 3: Delete purged logs
    await Promise.all([
      supabase.from('audit_logs').delete().lt('created_at', cutoffStr),
      supabase.from('login_logs').delete().lt('created_at', cutoffStr),
    ])
    await supabase.from('company_settings').update({ audit_last_purge: new Date().toISOString() }).eq('id', 1)
    setAuditSettings(s => ({ ...s, audit_last_purge: new Date().toISOString() }))
    showToast(`Logs exported and purged. ${(auditData?.length||0) + (loginData?.length||0)} records archived.`)
    fetchAll()
    setPurging(false)
    }

    setConfirmState({
      title: 'Purge Old Logs',
      variant: 'warning',
      confirmLabel: 'Export & Purge',
      message: 'This will export then permanently delete all logs older than the retention period.',
      onConfirm: proceedPurge,
    })
  }

  const handleExportLogs = async () => {
    showToast('Exporting…')
    const [ll, dl, gl] = await Promise.all([
      supabase.from('login_logs').select('*').order('created_at'),
      fetchAllRows(() => supabase.from('audit_logs').select('*').eq('tab', 'destructive').order('created_at')),
      fetchAllRows(() => supabase.from('audit_logs').select('*').eq('tab', 'generate').order('created_at')),
    ])
    const companyName = (localStorage.getItem('ds_company_name') || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const makeSheetHtml = (data, label, hdrBg) => {
      if (!data?.length) return `<table><tr><td>No ${label} data</td></tr></table>`
      const keys = Object.keys(data[0])
      let t = `<table>
        <tr><td colspan="${keys.length}" style="background:#1F2937;color:#fff;font-weight:bold;font-size:12pt;text-align:center;padding:6px">${companyName}</td></tr>
        <tr><td colspan="${keys.length}" style="background:${hdrBg};color:#fff;font-weight:bold;font-size:10pt;text-align:center;padding:5px">${label}</td></tr>
        <tr><td colspan="${keys.length}" style="background:#F3F4F6;text-align:center;font-size:8pt;padding:3px">Exported: ${new Date().toLocaleString('en-PH')}</td></tr>
        <tr>${keys.map(k=>`<th style="background:#374151;color:#fff;font-weight:bold;font-size:8pt;padding:4px 6px;border:1px solid #999;text-align:center">${k.replace(/_/g,' ').toUpperCase()}</th>`).join('')}</tr>`
      data.forEach((row,i) => {
        const bg = i%2===0?'#FFFFFF':'#F5F5F5'
        t += `<tr style="background:${bg}">${keys.map(k=>`<td style="font-size:8pt;padding:3px 5px;border:1px solid #ddd">${row[k]==null?'':String(row[k])}</td>`).join('')}</tr>`
      })
      t += '</table>'
      return t
    }
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"><style>body{font-family:Arial;font-size:9pt;}</style></head><body>
    ${makeSheetHtml(ll.data, 'LOGIN TRAIL', '#1D4ED8')}
    ${makeSheetHtml(dl.data, 'DESTRUCTIVE ACTIONS', '#DC2626')}
    ${makeSheetHtml(gl.data, 'GENERATE & CREATE', '#059669')}
    </body></html>`
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `FMS-Logs-${TODAY}.xls`
    a.click(); URL.revokeObjectURL(url)
    await supabase.from('company_settings').update({ audit_last_export: new Date().toISOString() }).eq('id', 1)
    setAuditSettings(s => ({ ...s, audit_last_export: new Date().toISOString() }))
    showToast('Logs exported.')
  }

  const loginFiltered = loginLogs.filter(l => {
    if (filterUser && ![l.email, l.user_name, l.action, l.status, l.browser, l.user_role].some(v => v?.toLowerCase().includes(filterUser.toLowerCase()))) return false
    return true
  })
  const auditFiltered = auditLogs.filter(l => {
    if (filterUser && ![l.description, l.action, l.module, l.user_name, l.performed_by_name].some(v => v?.toLowerCase().includes(filterUser.toLowerCase()))) return false
    if (filterModule && l.module !== filterModule) return false
    if (tab === 'destructive' && l.tab !== 'destructive') return false
    if (tab === 'generate' && l.tab !== 'generate') return false
    return true
  })
  const displayLogs = tab === 'login' ? loginFiltered : auditFiltered
  const totalPages = Math.ceil(displayLogs.length / PAGE_SIZE)
  const paginated = displayLogs.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)
  const modules = [...new Set(auditLogs.map(l=>l.module).filter(Boolean))].sort()

  const loginSuccess = loginLogs.filter(l => l.status === 'success' || l.action === 'login').length
  const loginFail = loginLogs.filter(l => l.status === 'failed' || l.action === 'login_failed' || l.action === 'failed').length

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Audit Logs</h1><p className="page-sub">System activity trail — superuser only</p></div>
        <div style={{ display:'flex', gap:8 }}>
          {isSuperuser && <button className="btn-ghost btn-sm" onClick={handleExportLogs}>📊 Export Excel</button>}
          {isSuperuser && <button className="btn-ghost btn-sm" onClick={fetchAll}>↻ Refresh</button>}
        </div>
      </div>

      {/* Date navigator */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        <button className="btn-ghost btn-sm" onClick={() => setDate(prevDay(date))}>◀</button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} max={TODAY} style={{ width:'auto' }} />
        <span style={{ fontSize:13, fontWeight:500 }}>{fmtDateLabel(date)}</span>
        <button className="btn-ghost btn-sm" onClick={() => setDate(nextDay(date))} disabled={date >= TODAY}>▶</button>
        <button className="btn-ghost btn-sm" onClick={() => setDate(TODAY)}>Today</button>
        {/* Day summary badges */}
        <span style={{ marginLeft:8, fontSize:12, padding:'2px 10px', borderRadius:10, background:'rgba(22,163,74,0.1)', color:'var(--success)' }}>✅ {loginSuccess} login{loginSuccess!==1?'s':''}</span>
        {loginFail > 0 && <span style={{ fontSize:12, padding:'2px 10px', borderRadius:10, background:'rgba(220,38,38,0.1)', color:'var(--danger)' }}>❌ {loginFail} failed</span>}
        <span style={{ fontSize:12, padding:'2px 10px', borderRadius:10, background:'rgba(99,102,241,0.1)', color:'#4338CA' }}>📋 {auditLogs.length} audit events</span>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:16 }}>
        {[
          ['login', `🔐 Login Trail (${loginLogs.length})`],
          ['destructive', `⚠️ Destructive (${auditLogs.filter(l=>l.tab==='destructive').length})`],
          ['generate', `✅ Generate (${auditLogs.filter(l=>l.tab==='generate').length})`],
          ...(isSuperuser ? [['settings', '⚙️ Audit Settings']] : [])
        ].map(([k,l]) => (
          <button key={k} onClick={()=>{setTab(k);setPage(1);setFilterUser('');setFilterModule('')}}
            style={{ padding:'10px 18px', background:'none', border:'none', borderBottom:tab===k?'2px solid var(--accent)':'2px solid transparent', color:tab===k?'var(--accent)':'var(--muted)', fontWeight:tab===k?600:400, cursor:'pointer', fontSize:13 }}>
            {l}
          </button>
        ))}
      </div>

      {/* Audit Settings Tab */}
      {tab === 'settings' && isSuperuser && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h3 style={{ fontSize:14, fontWeight:500, marginBottom:14 }}>Audit Log Settings</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:500 }}>Audit Logging</div>
                <div style={{ fontSize:11, color:'var(--muted)' }}>
                  {auditSettings.audit_enabled
                    ? `Enabled since ${auditSettings.audit_enabled_since ? new Date(auditSettings.audit_enabled_since).toLocaleDateString('en-PH') : '—'}`
                    : 'Currently disabled'}
                </div>
              </div>
              <button className={auditSettings.audit_enabled ? 'btn-danger btn-sm' : 'btn-primary btn-sm'} onClick={toggleAudit}>
                {auditSettings.audit_enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
            <div className="form-group" style={{ margin:0 }}>
              <label className="label">Retention Period</label>
              <select value={auditSettings.audit_retention||'1year'} onChange={async e => {
                const v = e.target.value
                await supabase.from('company_settings').update({ audit_retention: v }).eq('id', 1)
                setAuditSettings(s => ({ ...s, audit_retention: v }))
              }} style={{ width:'auto' }}>
                <option value="30days">30 Days</option>
                <option value="90days">90 Days</option>
                <option value="6months">6 Months</option>
                <option value="1year">1 Year</option>
              </select>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', background:'rgba(220,38,38,0.05)', borderRadius:8, border:'1px solid rgba(220,38,38,0.2)' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:500, color:'var(--danger)' }}>Purge Old Logs</div>
                <div style={{ fontSize:11, color:'var(--muted)' }}>
                  Delete logs older than retention period.
                  {auditSettings.audit_last_purge && ` Last purge: ${new Date(auditSettings.audit_last_purge).toLocaleDateString('en-PH')}`}
                </div>
              </div>
              <button className="btn-danger btn-sm" onClick={handlePurge} disabled={purging}>
                {purging ? 'Purging…' : '🗑️ Purge Now'}
              </button>
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', paddingTop:8, borderTop:'1px solid var(--border)' }}>
              {auditSettings.audit_last_export && `Last export: ${new Date(auditSettings.audit_last_export).toLocaleString('en-PH')}`}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      {tab !== 'settings' && (
        <div className="filter-bar" style={{ marginBottom:12 }}>
          <input placeholder={tab==='login' ? 'Search email, action…' : 'Search user, description…'} value={filterUser} onChange={e=>{setFilterUser(e.target.value);setPage(1)}} style={{ flex:2 }} />
          {tab !== 'login' && (
            <select value={filterModule} onChange={e=>{setFilterModule(e.target.value);setPage(1)}} style={{ width:'auto' }}>
              <option value="">All modules</option>
              {modules.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {(filterUser||filterModule) && <button className="btn-ghost btn-sm" onClick={()=>{setFilterUser('');setFilterModule('');setPage(1)}}>Clear</button>}
        </div>
      )}

      {/* Log entries */}
      {tab !== 'settings' && (
        loading ? <div className="empty-state"><p>Loading…</p></div> :
        paginated.length === 0 ? <div className="empty-state"><p>No {tab === 'login' ? 'login' : 'audit'} logs for {fmtDateLabel(date)}.</p></div> : (
        <>
          {tab === 'login' ? (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {paginated.map(l => {
                // Login.js writes 'status' field: 'success' or 'failed'
                const isSuccess = l.status === 'success' || l.action === 'login'
                const isFail = l.status === 'failed' || l.action === 'login_failed' || l.action === 'failed'
                const displayName = l.user_name || l.email || '—'
                const displayEmail = l.email || ''
                const displayRole = l.user_role || ''
                const displayBrowser = [l.browser, l.device].filter(Boolean).join(' · ')
                return (
                  <div key={l.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:8, background: isSuccess ? 'rgba(22,163,74,0.03)' : isFail ? 'rgba(220,38,38,0.03)' : 'var(--surface)', border: `0.5px solid ${isSuccess ? 'rgba(22,163,74,0.2)' : isFail ? 'rgba(220,38,38,0.2)' : 'var(--border)'}`, flexWrap:'wrap' }}>
                    <span style={{ fontSize:22 }}>{isSuccess ? '✅' : isFail ? '❌' : '🔐'}</span>
                    <div style={{ flex:1, minWidth:160 }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>{displayName}</div>
                      {displayEmail && displayEmail !== displayName && <div style={{ fontSize:11, color:'var(--muted)' }}>{displayEmail}</div>}
                      <div style={{ fontSize:11, color:'var(--muted)', display:'flex', gap:8, flexWrap:'wrap', marginTop:1 }}>
                        {displayRole && <span style={{ background:'var(--bg)', padding:'0 6px', borderRadius:4 }}>{displayRole}</span>}
                        {displayBrowser && <span>{displayBrowser}</span>}
                        {l.ip_address && l.ip_address !== 'Unknown IP' && <span>{l.ip_address}</span>}
                      </div>
                    </div>
                    <span style={{ padding:'3px 12px', borderRadius:10, fontSize:11, fontWeight:600,
                      background: isSuccess ? 'rgba(22,163,74,0.12)' : isFail ? 'rgba(220,38,38,0.12)' : 'var(--bg)',
                      color: isSuccess ? 'var(--success)' : isFail ? 'var(--danger)' : 'var(--muted)' }}>
                      {isSuccess ? '✅ Login Success' : isFail ? '❌ Login Failed' : l.action || l.status || '—'}
                    </span>
                    <span style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--mono)', whiteSpace:'nowrap' }}>{fmtDateTime(l.created_at)}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {paginated.map(l => {
                const ac = ACTION_COLORS[l.action] || { bg: 'var(--bg)', color: 'var(--muted)', icon: '📝' }
                return (
                  <div key={l.id} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'8px 14px', borderRadius:8, background:'var(--surface)', border:'0.5px solid var(--border)', flexWrap:'wrap' }}>
                    <span style={{ fontSize:18, marginTop:2 }}>{ac.icon}</span>
                    <div style={{ flex:1, minWidth:180 }}>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:2 }}>
                        <span style={{ fontSize:12, fontWeight:600 }}>{l.performed_by_name || l.user_name || '—'}</span>
                        <span style={{ padding:'1px 8px', borderRadius:10, fontSize:11, background:ac.bg, color:ac.color, fontWeight:500 }}>{l.action}</span>
                        <span style={{ fontSize:11, color:'var(--muted)', background:'var(--bg)', padding:'1px 6px', borderRadius:6 }}>{l.module}</span>
                      </div>
                      <div style={{ fontSize:12, color:'var(--text)' }}>{l.description || '—'}</div>
                    </div>
                    <span style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--mono)', whiteSpace:'nowrap' }}>{fmtDateTime(l.created_at)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:12, alignItems:'center' }}>
              <button className="btn-ghost btn-sm" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>◀</button>
              <span style={{ fontSize:12, color:'var(--muted)' }}>Page {page} of {totalPages} · {displayLogs.length} records</span>
              <button className="btn-ghost btn-sm" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>▶</button>
            </div>
          )}
        </>
      ))}

      <Toast toast={toast} />
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}
