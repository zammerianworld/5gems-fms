import { useState, useEffect, useCallback } from 'react'
import { supabase, fmtDate } from '../lib/supabase'
import { useToast, Toast } from '../components/Toast'

const MODULE_META = {
  'Trip':         { icon: '🚛', color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)' },
  'Billing':      { icon: '🧾', color: '#ff1e00', bg: 'rgba(255,30,0,0.08)' },
  'Invoices':     { icon: '🧾', color: '#ff1e00', bg: 'rgba(255,30,0,0.08)' },
  'CheckVouchers':{ icon: '💳', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
  'CashVouchers': { icon: '💵', color: '#10b981', bg: 'rgba(16,185,129,0.08)' },
  'Expenses':     { icon: '📊', color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
  'Payroll':      { icon: '👥', color: '#6366f1', bg: 'rgba(99,102,241,0.08)' },
  'Payslip':      { icon: '🧾', color: '#6366f1', bg: 'rgba(99,102,241,0.08)' },
  'ORCR':         { icon: '🚗', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  'Loans':        { icon: '🏦', color: '#14b8a6', bg: 'rgba(20,184,166,0.08)' },
  'SubconTrips':  { icon: '🤝', color: '#84cc16', bg: 'rgba(132,204,22,0.08)' },
  'default':      { icon: '📝', color: 'var(--muted)', bg: 'var(--bg)' },
}

const ACTION_COLORS = {
  'destructive': { color: '#dc2626', label: 'Deleted / Updated' },
  'generate':    { color: '#ff1e00', label: 'Generated' },
  'default':     { color: 'var(--muted)', label: 'Action' },
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })
const fmtDateFull = (ts) => new Date(ts).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

export default function Activity() {
  const { toast, showToast } = useToast()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [filterModule, setFilterModule] = useState('')
  const [filterUser, setFilterUser] = useState('')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const start = selectedDate + 'T00:00:00.000Z'
    const end = selectedDate + 'T23:59:59.999Z'
    // Convert PH time offset (+8) to UTC
    const startLocal = new Date(selectedDate + 'T00:00:00+08:00').toISOString()
    const endLocal = new Date(selectedDate + 'T23:59:59+08:00').toISOString()
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .gte('created_at', startLocal)
      .lte('created_at', endLocal)
      .order('created_at', { ascending: false })
    if (error) { showToast('Error loading activity', 'error'); setLoading(false); return }
    setLogs(data || [])
    setLoading(false)
  }, [selectedDate])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const modules = [...new Set(logs.map(l => l.module).filter(Boolean))].sort()
  const users = [...new Set(logs.map(l => l.performed_by_name).filter(Boolean))].sort()

  const filtered = logs.filter(l => {
    if (filterModule && l.module !== filterModule) return false
    if (filterUser && l.performed_by_name !== filterUser) return false
    return true
  })

  // Group by hour
  const byHour = {}
  filtered.forEach(l => {
    const hour = new Date(l.created_at).toLocaleString('en-PH', { hour: '2-digit', hour12: true })
    if (!byHour[hour]) byHour[hour] = []
    byHour[hour].push(l)
  })

  const isToday = selectedDate === new Date().toISOString().slice(0, 10)

  const navDay = (offset) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + offset)
    setSelectedDate(d.toISOString().slice(0, 10))
  }

  return (
    <div className="page">
      <Toast toast={toast} />

      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Activity Feed</h1>
          <p className="page-sub">What happened today — trips, invoices, vouchers, expenses</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={fetchLogs}>🔄 Refresh</button>
      </div>

      {/* Date nav */}
      <div className="card" style={{ marginBottom: 20, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn-ghost btn-sm" onClick={() => navDay(-1)}>← Prev</button>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            style={{ width: 'auto', padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }} />
          <button className="btn-ghost btn-sm" onClick={() => navDay(1)} disabled={isToday}>Next →</button>
          {!isToday && <button className="btn-ghost btn-sm" onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}>Today</button>}
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{fmtDateFull(selectedDate + 'T12:00:00')}</span>
        </div>
      </div>

      {/* Filters */}
      {(modules.length > 0 || users.length > 0) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={filterModule} onChange={e => setFilterModule(e.target.value)} style={{ width: 'auto', fontSize: 13 }}>
            <option value="">All modules</option>
            {modules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ width: 'auto', fontSize: 13 }}>
            <option value="">All staff</option>
            {users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          {(filterModule || filterUser) && (
            <button className="btn-ghost btn-sm" onClick={() => { setFilterModule(''); setFilterUser('') }}>Clear</button>
          )}
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 4 }}>
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      )}

      {/* Activity list */}
      {loading ? (
        <div className="empty-state"><p>Loading activity…</p></div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>
            {isToday ? 'No activity yet today' : 'No activity on this day'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {isToday ? 'Activity will appear here as your team works.' : 'Try a different date.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((log, i) => {
            const meta = MODULE_META[log.module] || MODULE_META['default']
            const actionMeta = ACTION_COLORS[log.tab] || ACTION_COLORS['default']
            const isFirst = i === 0 || filtered[i-1]?.performed_by_name !== log.performed_by_name ||
              new Date(filtered[i-1]?.created_at).getHours() !== new Date(log.created_at).getHours()

            return (
              <div key={log.id} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '10px 14px', borderRadius: 10,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
              }}>
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  background: meta.bg, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 16, marginTop: 1,
                }}>
                  {meta.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', lineHeight: 1.4 }}>
                      {log.description || `${log.action || 'Action'} on ${log.module}`}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }}>
                      {fmtTime(log.created_at)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, background: meta.bg, padding: '1px 7px', borderRadius: 5 }}>
                      {log.module || 'System'}
                    </span>
                    {log.action && (
                      <span style={{ fontSize: 11, color: actionMeta.color }}>
                        {log.action}
                      </span>
                    )}
                    {log.performed_by_name && (
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        by {log.performed_by_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Summary bar */}
      {filtered.length > 0 && (
        <div style={{ marginTop: 20, padding: '10px 16px', background: 'var(--bg)', borderRadius: 10, fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {Object.entries(
            filtered.reduce((acc, l) => { const m = l.module || 'Other'; acc[m] = (acc[m]||0)+1; return acc }, {})
          ).sort((a,b)=>b[1]-a[1]).map(([mod, count]) => (
            <span key={mod}>{MODULE_META[mod]?.icon || '📝'} <strong>{count}</strong> {mod}</span>
          ))}
        </div>
      )}
    </div>
  )
}
