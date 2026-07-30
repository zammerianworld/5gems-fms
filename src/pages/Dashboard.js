import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../components/AuthContext'
import { supabase, fmt, fmtDate, fetchAllRows } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import GlobalSearch from '../components/GlobalSearch'

export default function Dashboard() {
  const { profile, isAdmin, user } = useAuth()
  const navigate = useNavigate()

  const [graphMonth, setGraphMonth] = useState(new Date().toISOString().slice(0, 7))
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [invoices, setInvoices] = useState([])
  const [expenses, setExpenses] = useState([])
  const [trucks, setTrucks] = useState([])
  const [insurances, setInsurances] = useState([])
  const [amortizations, setAmortizations] = useState([])
  const [logoUrl, setLogoUrl] = useState(() => localStorage.getItem('ds_logo') || '')
  const [loading, setLoading] = useState(true)
  const [orcrRecords, setOrcrRecords] = useState([])
  const [pdcDue, setPdcDue] = useState([])
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [dt, pt, inv, exp, tr, ins, am, sett, orcr] = await Promise.all([
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('invoices').select('*').is('deleted_at', null).order('invoice_date', { ascending: false })),
      fetchAllRows(() => supabase.from('expenses').select('*').is('deleted_at', null)),
      supabase.from('trucks').select('*').order('plate'),
      supabase.from('insurances').select('*'),
      supabase.from('amortizations').select('*'),
      supabase.from('company_settings').select('logo_url,company_name').eq('id', 1).maybeSingle(),
      supabase.from('orcr_records').select('*'),
      supabase.from('pdc_records').select('*').gte('check_date', today).lte('check_date', new Date(Date.now() + 7*86400000).toISOString().slice(0,10)),
    ])
    if (dt.data) setDumpTrips(dt.data)
    if (pt.data) setPmTrips(pt.data)
    if (inv.data) setInvoices(inv.data)
    if (exp.data) setExpenses(exp.data)
    if (tr.data) setTrucks(tr.data)
    if (ins.data) setInsurances(ins.data)
    if (am.data) setAmortizations(am.data)
    if (orcr.data) setOrcrRecords(orcr.data)
    const pdcRes = await supabase.from('pdc_records').select('*').gte('check_date', today).lte('check_date', new Date(Date.now() + 7*86400000).toISOString().slice(0,10))
    if (pdcRes.data) setPdcDue(pdcRes.data)
    if (sett.data?.logo_url) {
      setLogoUrl(sett.data.logo_url)
      localStorage.setItem('ds_logo', sett.data.logo_url)
    }
    setLastRefreshed(new Date())
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      if (e.key === 'n' || e.key === 'N') navigate('/trips')
      if (e.key === 'e' || e.key === 'E') navigate('/expenses')
      if (e.key === 'b' || e.key === 'B') navigate('/billing')
      if (e.key === 'r' || e.key === 'R') fetchAll()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, fetchAll])

  const dumpAmt = (arr) => arr.reduce((s, t) => s + (t.weight_tons || 0) * (t.rate_per_ton || 0), 0)
  const pmAmt = (arr) => arr.reduce((s, t) => s + (t.supplier_amount || 0) + (t.stripping_fee || 0), 0)

  // Today stats (always today)
  const todayDump = dumpTrips.filter(t => t.trip_date === today)
  const todayPM = pmTrips.filter(t => t.trip_date === today)
  const todayVans = todayPM.reduce((s, t) => s + (t.container_size === '20ft' ? (t.num_20ft || t.containers?.length || 1) : 1), 0)

  // Graph month stats — driven by graphMonth selector
  const monthDump = dumpTrips.filter(t => t.trip_date?.startsWith(graphMonth))
  const monthPM = pmTrips.filter(t => t.trip_date?.startsWith(graphMonth))
  const monthVans = monthPM.reduce((s, t) => s + (t.container_size === '20ft' ? (t.num_20ft || t.containers?.length || 1) : 1), 0)

  // Unpaid invoices
  const unpaidInvoices = invoices.filter(i => i.status === 'Invoiced' || i.status === 'On Hold')
  const overdueCount = unpaidInvoices.filter(i => Math.floor((now - new Date(i.invoice_date)) / 86400000) >= 30).length
  // OR/CR expiry alerts
  const now2 = new Date()
  const orcrAlerts = orcrRecords.map(r => {
    const orDays = r.or_expiry ? Math.ceil((new Date(r.or_expiry + 'T00:00:00') - now2) / 86400000) : null
    // CR is typically permanent — only show CR alert if it has a date AND is expiring soon (not expired long ago)
    const crDays = r.cr_expiry ? Math.ceil((new Date(r.cr_expiry + 'T00:00:00') - now2) / 86400000) : null
    return { ...r, orDays, crDays }
  }).filter(r =>
    // OR: expired OR expiring within 60 days
    (r.orDays !== null && r.orDays <= 60) ||
    // CR: only flag if genuinely expiring soon (within 60 days), never flag old/permanent CR dates
    (r.crDays !== null && r.crDays >= 0 && r.crDays <= 60)
  ).sort((a, b) => (Math.min(a.orDays ?? 999, a.crDays ?? 999)) - (Math.min(b.orDays ?? 999, b.crDays ?? 999)))

  const overdueInvoices = unpaidInvoices.filter(i => {
    const days = Math.floor((now - new Date(i.invoice_date)) / 86400000)
    return days >= 30
  }).map(i => ({ ...i, daysOverdue: Math.floor((now - new Date(i.invoice_date)) / 86400000) }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  // Insurance expiry — within 14 days
  const expiringInsurance = insurances.filter(ins => {
    const end = new Date(ins.start_date)
    end.setMonth(end.getMonth() + 12)
    const daysLeft = Math.floor((end - now) / 86400000)
    return daysLeft >= 0 && daysLeft <= 14
  })

  // Per-truck chart data — ALL driven by graphMonth
  const activeTrucks = trucks.filter(t => t.active !== false)
  const companyTrucks = activeTrucks.filter(t => t.ownership !== 'subcon' && t.ownership !== 'special_subcon')
  // Admin/shared-expense divisor: special_subcon shares in general overhead
  // even though its trips are excluded from the performance charts below.
  const expenseShareTrucks = activeTrucks.filter(t => t.ownership !== 'subcon')
  const truckCount = expenseShareTrucks.length || 1

  const getTruckData = (truck) => {
    const td = dumpTrips.filter(t => t.truck_plate === truck.plate && t.trip_date?.startsWith(graphMonth))
    const tp = pmTrips.filter(t => t.truck_plate === truck.plate && t.trip_date?.startsWith(graphMonth))
    const sales = dumpAmt(td) + pmAmt(tp)
    const tripCount = td.length + tp.length

    // Direct operation expenses for this truck this month
    const directExp = expenses
      .filter(e => e.scope === 'individual' && e.truck_id === truck.id && e.expense_date?.startsWith(graphMonth))
      .reduce((s, e) => s + (e.amount || 0), 0)

    // Shared expenses (all trucks) this month
    const sharedExp = expenses
      .filter(e => e.scope === 'all' && e.expense_date?.startsWith(graphMonth))
      .reduce((s, e) => s + (e.amount || 0) / truckCount, 0)

    // Amortization — active in graphMonth
    const amort = amortizations
      .filter(a => a.truck_id === truck.id && a.start_date <= graphMonth && (!a.end_date || a.end_date >= graphMonth))
      .reduce((s, a) => s + (a.monthly_amount || 0), 0)

    // Insurance — active in graphMonth
    const insShare = insurances
      .filter(ins => {
        if (!ins.truck_ids?.includes(truck.id)) return false
        const start = new Date(ins.start_date)
        const end = new Date(start); end.setMonth(end.getMonth() + 12)
        const check = new Date(graphMonth + '-01')
        return check >= start && check < end
      })
      .reduce((s, ins) => s + (ins.annual_amount || 0) / (ins.truck_ids?.length || 1) / 12, 0)

    const totalExp = directExp + sharedExp + amort + insShare
    const netIncome = sales - totalExp
    return { sales, totalExp, netIncome, tripCount }
  }

  const truckData = companyTrucks.map(t => ({ truck: t, ...getTruckData(t) }))

  // Expense category breakdown for current graph month
  const monthExpenses = expenses.filter(e => e.expense_date?.startsWith(graphMonth))
  const expByCategory = {}
  monthExpenses.forEach(e => {
    let cat = 'Other'
    if (e.maintenance_category) cat = e.maintenance_category
    else if (e.expense_type === 'admin') cat = 'Admin'
    else if (e.category) cat = e.category
    expByCategory[cat] = (expByCategory[cat] || 0) + (e.amount || 0)
  })
  const expCategories = Object.entries(expByCategory).sort((a, b) => b[1] - a[1])
  const totalMonthExp = expCategories.reduce((s, [, v]) => s + v, 0)
  const catColors = ['#f17200','#2563eb','#16a34a','#dc2626','#7c3aed','#0891b2','#d97706','#be185d']
  const maxVal = Math.max(...truckData.map(d => Math.max(d.sales, d.totalExp)), 1)

  const prevMonth = () => {
    const [y, m] = graphMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setGraphMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }
  const nextMonth = () => {
    const [y, m] = graphMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    setGraphMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }

  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const graphMonthLabel = new Date(graphMonth + '-01').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

  if (loading) return (
    <div className="page">
      {[...Array(3)].map((_,i) => (
        <div key={i} style={{ height: 80, background: 'var(--surface)', borderRadius: 10, marginBottom: 12, overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', animation: 'shimmer 1.5s infinite', backgroundSize: '200% 100%' }} />
        </div>
      ))}
      <style>{`@keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }`}</style>
    </div>
  )

  return (
    <div className="page">
      {/* Greeting */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        {logoUrl && (
          <img src={logoUrl} alt="Logo" style={{ maxHeight: 52, maxWidth: 140, objectFit: 'contain', borderRadius: 6, flexShrink: 0, transition: 'opacity 0.3s' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>
            {greeting}, {profile?.full_name?.split(' ')[0] || 'there'} 👋
          </h1>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            {now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <button className="btn-ghost btn-sm" onClick={() => fetchAll()} disabled={loading} style={{ fontSize: 12 }}>🔄 Refresh</button>
          {lastRefreshed && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Updated {lastRefreshed.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
      </div>

      {/* Quick search */}
      <button onClick={() => setSearchOpen(true)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '12px 16px', color: 'var(--muted)',
        fontSize: 14, cursor: 'pointer', textAlign: 'left', marginBottom: 18,
      }}>
        <span style={{ fontSize: 18 }}>🔍</span>
        <span style={{ flex: 1 }}>Search invoices, trips, waybills, clients…</span>
        <kbd style={{ fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>/</kbd>
      </button>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* How-To Guide banner */}
      <div onClick={() => navigate('/how-to')}
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: 'linear-gradient(135deg, #f17200 0%, #e65c00 100%)', borderRadius: 10, marginBottom: 14, cursor: 'pointer', boxShadow: '0 2px 8px rgba(241,114,0,0.25)', transition: 'opacity .15s' }}
        onMouseEnter={e => e.currentTarget.style.opacity = '.9'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
        <span style={{ fontSize: 28, flexShrink: 0 }}>📖</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>How-To Guide</div>
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 }}>Step-by-step instructions for every module — tap to open</div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18 }}>›</span>
      </div>

      {/* Insurance expiry */}
      {expiringInsurance.length > 0 && (
        <div style={{ padding: '10px 14px', background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 10, marginBottom: 12, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#E65100' }}>⚠️ Insurance expiring soon</div>
            {expiringInsurance.map(ins => {
              const end = new Date(ins.start_date); end.setMonth(end.getMonth() + 12)
              const days = Math.floor((end - now) / 86400000)
              return <div key={ins.id} style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{ins.insurance_type} — {ins.description} ({days}d left)</div>
            })}
          </div>
          <button className="btn-ghost btn-sm" onClick={() => navigate('/expenses')}>View →</button>
        </div>
      )}

      {/* OR/CR expiry */}
      {orcrAlerts.length > 0 && (
        <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 10, marginBottom: 12, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--danger)' }}>🚨 OR/CR Expiry Alert ({orcrAlerts.length} vehicle{orcrAlerts.length > 1 ? 's' : ''})</div>
            {orcrAlerts.slice(0, 4).map(r => {
              const orStatus = r.orDays !== null ? (r.orDays < 0 ? `OR EXPIRED ${Math.abs(r.orDays)}d ago` : `OR exp. in ${r.orDays}d`) : null
              // CR: only show if genuinely expiring soon — never show old/stale CR dates as expired
              const crStatus = (r.crDays !== null && r.crDays >= 0 && r.crDays <= 60) ? `CR exp. in ${r.crDays}d` : null
              return (
                <div key={r.id} style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  <strong>{r.plate_no}</strong> — {[orStatus, crStatus].filter(Boolean).join(' · ')}
                </div>
              )
            })}
            {orcrAlerts.length > 4 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>+{orcrAlerts.length - 4} more</div>}
          </div>
          <button className="btn-ghost btn-sm" onClick={() => navigate('/orcr')}>View →</button>
        </div>
      )}

      {/* Unpaid alert */}
      {unpaidInvoices.length > 0 && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, marginBottom: 12,
          background: overdueCount > 0 ? 'var(--danger-light)' : 'var(--warning-light)',
          border: `1px solid ${overdueCount > 0 ? '#e0a09a' : '#f0c070'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: overdueCount > 0 ? 'var(--danger)' : 'var(--warning)' }}>
              {overdueCount > 0 ? `⚠️ ${overdueCount} overdue` : '📋 Unpaid invoices'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {unpaidInvoices.length} invoice{unpaidInvoices.length > 1 ? 's' : ''} · ₱{fmt(unpaidInvoices.reduce((s, i) => s + (i.total_sales_net || 0) * 1.12, 0))}
            </div>
          </div>
          <button className="btn-ghost btn-sm" onClick={() => navigate('/billing', { state: { tab: 'Aging Report' } })}>View Aging →</button>
        </div>
      )}

      {/* PDC due this week */}
      {pdcDue.length > 0 && (
        <div style={{ padding:'10px 14px', background:'#EDE9FE', border:'1px solid #C4B5FD', borderRadius:10, marginBottom:12, display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:13, fontWeight:500, color:'#7C3AED' }}>📅 {pdcDue.length} PDC due this week</div>
            {pdcDue.slice(0,3).map(p => (
              <div key={p.id} style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                <strong>{p.payee||'—'}</strong> · ₱{fmt(p.amount||0)} · {fmtDate(p.check_date)}
              </div>
            ))}
            {pdcDue.length > 3 && <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>+{pdcDue.length-3} more</div>}
          </div>
          <button className="btn-ghost btn-sm" onClick={() => navigate('/check-vouchers')}>View →</button>
        </div>
      )}

      {/* 60+ day overdue action card */}
      {overdueInvoices.filter(i => i.daysOverdue >= 60).length > 0 && (
        <div style={{ padding:'10px 14px', background:'#FEE2E2', border:'2px solid #DC2626', borderRadius:10, marginBottom:12, display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#DC2626' }}>🚨 {overdueInvoices.filter(i=>i.daysOverdue>=60).length} invoice(s) 60+ days overdue — urgent collection needed</div>
            {overdueInvoices.filter(i=>i.daysOverdue>=60).slice(0,3).map(inv => (
              <div key={inv.id} style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                <strong>INV #{inv.invoice_no}</strong> · {inv.client} · ₱{fmt((inv.total_sales_net||0)*1.12)} · <span style={{ color:'#DC2626', fontWeight:600 }}>{inv.daysOverdue}d overdue</span>
              </div>
            ))}
          </div>
          <button className="btn-ghost btn-sm" onClick={() => navigate('/billing', { state: { tab: 'Aging Report' } })}>View Aging →</button>
        </div>
      )}

      {/* Today */}
      <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--hint)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Today</p>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label">Dump Trips</div><div className="stat-value">{todayDump.length}</div></div>
        <div className="stat-card">
          <div className="stat-label">PM Trips</div>
          <div className="stat-value">{todayPM.length}</div>
          {todayVans > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{todayVans} vans</div>}
        </div>
        <div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value sm">₱{fmt(dumpAmt(todayDump) + pmAmt(todayPM))}</div></div>
        <div className="stat-card"><div className="stat-label">Total Trips</div><div className="stat-value">{todayDump.length + todayPM.length}</div></div>
      </div>

      {/* Month stats — driven by graphMonth */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--hint)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>{graphMonthLabel}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={prevMonth} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 14, color: 'var(--muted)' }}>‹</button>
          <span style={{ fontSize: 12, fontWeight: 500, minWidth: 100, textAlign: 'center', color: 'var(--text)' }}>{graphMonthLabel}</span>
          <button onClick={nextMonth} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 14, color: 'var(--muted)' }}>›</button>
        </div>
      </div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label">Dump Trips</div><div className="stat-value">{monthDump.length}</div></div>
        <div className="stat-card">
          <div className="stat-label">PM Trips</div>
          <div className="stat-value">{monthPM.length}</div>
          {monthVans > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{monthVans} vans</div>}
        </div>
        <div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value sm">₱{fmt(dumpAmt(monthDump) + pmAmt(monthPM))}</div></div>
        <div className="stat-card"><div className="stat-label">Total Trips</div><div className="stat-value">{monthDump.length + monthPM.length}</div></div>
      </div>

      {/* Per-truck chart */}
      {isAdmin && truckData.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Per Truck — {graphMonthLabel}</h2>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                <span style={{ display: 'inline-block', width: 10, height: 6, background: 'var(--accent)', borderRadius: 2, marginRight: 4 }} />Sales
                <span style={{ display: 'inline-block', width: 10, height: 6, background: '#aaa', borderRadius: 2, margin: '0 4px 0 10px' }} />Expenses
              </p>
            </div>
          </div>

          {truckData.every(d => d.sales === 0 && d.totalExp === 0)
            ? <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 16 }}>No data for {graphMonthLabel}</p>
            : <>
              {truckData.map(({ truck, sales, totalExp, netIncome, tripCount }) => (
                <div key={truck.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, overflow: 'hidden' }}>
                    <span className={`badge ${truck.truck_type === 'Dump Truck' ? 'badge-dump' : 'badge-prime'}`} style={{ minWidth: 72, justifyContent: 'center', fontSize: 11 }}>{truck.plate}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 56 }}>{tripCount} trip{tripCount !== 1 ? 's' : ''}</span>
                    <div style={{ flex: 1, minWidth: 80, position: 'relative', height: 26, background: 'var(--bg)', borderRadius: 5, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, height: '50%', width: `${Math.min((sales / maxVal) * 100, 100)}%`, background: 'var(--accent)', transition: 'width 0.4s', borderRadius: '4px 0 0 0' }} />
                      <div style={{ position: 'absolute', bottom: 0, left: 0, height: '50%', width: `${Math.min((totalExp / maxVal) * 100, 100)}%`, background: totalExp > sales ? 'var(--danger)' : '#9ca3af', transition: 'width 0.4s', borderRadius: '0 0 0 4px' }} />
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 100 }}>
                      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)', fontWeight: 500 }}>₱{fmt(sales)}</div>
                      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>₱{fmt(totalExp)}</div>
                    </div>
                    <div style={{ minWidth: 80, textAlign: 'right' }}>
                      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 500, color: netIncome >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {netIncome >= 0 ? '+' : ''}₱{fmt(netIncome)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--hint)' }}>net</div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Fleet totals */}
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'Fleet Sales', value: truckData.reduce((s, d) => s + d.sales, 0), color: 'var(--accent)' },
                  { label: 'Fleet Expenses', value: truckData.reduce((s, d) => s + d.totalExp, 0), color: 'var(--text)' },
                  { label: 'Net Income', value: truckData.reduce((s, d) => s + d.netIncome, 0), color: truckData.reduce((s, d) => s + d.netIncome, 0) >= 0 ? 'var(--success)' : 'var(--danger)' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--mono)', color }}>₱{fmt(value)}</div>
                  </div>
                ))}
              </div>
            </>
          }
        </div>
      )}

      {/* Bottom row — responsive grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Recent trips */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Recent Trips</h2>
            <button className="btn-ghost btn-sm" onClick={() => navigate('/trips')}>View All</button>
          </div>
          {[...dumpTrips.slice(0, 6).map(t => ({ ...t, _type: 'dump' })), ...pmTrips.slice(0, 6).map(t => ({ ...t, _type: 'pm' }))]
            .sort((a, b) => new Date(b.trip_date) - new Date(a.trip_date)).slice(0, 6)
            .map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
                <span className={`badge ${t._type === 'dump' ? 'badge-dump' : 'badge-prime'}`} style={{ fontSize: 10, minWidth: 58, justifyContent: 'center' }}>{t.truck_plate}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t._type === 'dump' ? `${t.route}` : `${t.trip_code} · ${t.container_size}`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(t.trip_date)}</div>
                </div>
                <span style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--accent)', flexShrink: 0 }}>
                  ₱{fmt(t._type === 'dump' ? (t.weight_tons || 0) * (t.rate_per_ton || 0) : (t.supplier_amount || 0) + (t.stripping_fee || 0))}
                </span>
              </div>
            ))}
        </div>

        {/* Expense Category Breakdown */}
      {expCategories.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Expense Breakdown — {graphMonthLabel}</h2>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Total: ₱{fmt(totalMonthExp)}</span>
          </div>
          {expCategories.map(([cat, amt], i) => {
            const pct = totalMonthExp > 0 ? (amt / totalMonthExp) * 100 : 0
            return (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: catColors[i % catColors.length], display: 'inline-block', flexShrink: 0 }} />
                    {cat}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>₱{fmt(amt)} <span style={{ color: 'var(--hint)' }}>({pct.toFixed(1)}%)</span></span>
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: catColors[i % catColors.length], borderRadius: 3, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Unpaid invoices */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Unpaid Invoices</h2>
            <button className="btn-ghost btn-sm" onClick={() => navigate('/billing')}>View All</button>
          </div>
          {unpaidInvoices.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>All invoices paid! ✓</p>
            : unpaidInvoices.slice(0, 5).map(inv => {
              const days = Math.floor((now - new Date(inv.invoice_date)) / 86400000)
              return (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>SALES INV: {inv.invoice_no}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{inv.client}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 500 }}>₱{fmt((inv.total_sales_net || 0) * 1.12)}</div>
                    <div style={{ fontSize: 11, color: days >= 60 ? 'var(--danger)' : days >= 30 ? '#CC5500' : 'var(--muted)' }}>{days}d</div>
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-primary" onClick={() => navigate('/trips')}>+ New Trip</button>
          <button className="btn-ghost" onClick={() => navigate('/billing')}>Generate SOA</button>
          <button className="btn-ghost" onClick={() => navigate('/expenses')}>Add Expense</button>
          {isAdmin && <button className="btn-ghost" onClick={() => navigate('/summary')}>Summary</button>}
          <button className="btn-ghost" onClick={() => navigate('/how-to')}>📖 How-To Guide</button>
          <span style={{ fontSize:10, color:'var(--hint)', marginLeft:4 }}>Shortcuts: <kbd style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:3, padding:'1px 4px', fontSize:10 }}>N</kbd> New Trip &nbsp;<kbd style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:3, padding:'1px 4px', fontSize:10 }}>E</kbd> Expense &nbsp;<kbd style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:3, padding:'1px 4px', fontSize:10 }}>B</kbd> Billing &nbsp;<kbd style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:3, padding:'1px 4px', fontSize:10 }}>R</kbd> Refresh</span>
        </div>
      </div>
    </div>
  )
}
