import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fetchAllRows } from '../lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useToast, Toast } from '../components/Toast'

const PERIOD_TYPES = ['Monthly', 'Quarterly', 'Annual']
const QUARTERS = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
// SMC trip_code stores supplier_amount + stripping_fee as VAT-inclusive; divide by 1.12 to get net sales.
// Other trip codes (Hustling/Hauling PSACC) already store net amounts.
const pmSaleValue = (t) => {
  const raw = (t.supplier_amount||0)+(t.stripping_fee||0)
  return t.trip_code === 'SMC' ? raw / 1.12 : raw
}

export default function Summary() {
  const { toast, showToast } = useToast()
  const [periodType, setPeriodType] = useState('Monthly')
  const [dataMode, setDataMode] = useState('auto') // auto | live | historical
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth()+1).padStart(2,'0'))
  const [selectedQuarter, setSelectedQuarter] = useState(Math.floor(new Date().getMonth()/3))

  const [trucks, setTrucks] = useState([])
  const [historicalData, setHistoricalData] = useState([])
  const [extraIncomeData, setExtraIncomeData] = useState([])
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [invoices, setInvoices] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [mainTab, setMainTab] = useState('summary') // 'summary' | 'fuel'
  const [fuelSearch, setFuelSearch] = useState('')
  const [fuelMonth, setFuelMonth] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [tr, dt, pt, inv, hist, ei, exp] = await Promise.all([
      supabase.from('trucks').select('*').order('truck_type').order('plate'),
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('deleted_at', null).order('trip_date')),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('deleted_at', null).order('trip_date')),
      fetchAllRows(() => supabase.from('invoices').select('*').is('deleted_at', null)),
      fetchAllRows(() => supabase.from('historical_data').select('*')),
      fetchAllRows(() => supabase.from('extra_income').select('*')),
      fetchAllRows(() => supabase.from('expenses').select('expense_date,truck_id,category,amount').in('category', ['Fuel — PO','Fuel — Cash'])),
    ])
    if (tr.data) setTrucks(tr.data)
    if (dt.data) setDumpTrips(dt.data)
    if (pt.data) setPmTrips(pt.data)
    if (inv.data) setInvoices(inv.data)
    if (hist.data) setHistoricalData(hist.data)
    if (ei.data) setExtraIncomeData(ei.data)
    if (exp.data) setExpenses(exp.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── PERIOD HELPERS ────────────────────────────────────────────────────────
  const getMonths = () => {
    if (periodType === 'Monthly') return [`${selectedYear}-${selectedMonth}`]
    if (periodType === 'Quarterly') {
      const starts = [[1,2,3],[4,5,6],[7,8,9],[10,11,12]][selectedQuarter]
      return starts.map(m => `${selectedYear}-${String(m).padStart(2,'0')}`)
    }
    return Array.from({length:12}, (_,i) => `${selectedYear}-${String(i+1).padStart(2,'0')}`)
  }

  const months = getMonths()
  const inPeriod = (d) => d && months.includes(d.slice(0,7))

  const periodLabel = periodType === 'Monthly'
    ? `${MONTHS[parseInt(selectedMonth)-1]} ${selectedYear}`
    : periodType === 'Quarterly' ? `${QUARTERS[selectedQuarter]} ${selectedYear}`
    : `Year ${selectedYear}`

  const years = Array.from({length:5}, (_,i) => new Date().getFullYear()-i)

  // ── TRUCK SUMMARY DATA ────────────────────────────────────────────────────
  const getTruckSummary = (truck) => {
    const td = dumpTrips.filter(t => t.truck_plate === truck.plate && inPeriod(t.trip_date))
    const tp = pmTrips.filter(t => t.truck_plate === truck.plate && inPeriod(t.trip_date))

    const dumpSales = td.reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0)
    const pmSales = tp.reduce((s,t) => s+pmSaleValue(t), 0)
    const totalSales = dumpSales + pmSales
    const totalTrips = td.length + tp.length
    const totalTons = td.reduce((s,t) => s+parseFloat(t.weight_tons||0), 0)

    // PM vans count (each 20ft = 2 vans, 40ft = 1 van)
    const totalVans = tp.reduce((s,t) => s+(t.container_size==='20ft'?(t.num_20ft||t.containers?.length||1):1), 0)

    // By route (dump)
    const byRoute = {}
    td.forEach(t => {
      const k = t.route || 'Unknown'
      if (!byRoute[k]) byRoute[k] = { trips:0, tons:0, sales:0 }
      byRoute[k].trips++
      byRoute[k].tons += parseFloat(t.weight_tons||0)
      byRoute[k].sales += (t.weight_tons||0)*(t.rate_per_ton||0)
    })

    // By trip code (PM)
    const byCode = {}
    tp.forEach(t => {
      const k = t.trip_code || 'Unknown'
      if (!byCode[k]) byCode[k] = { trips:0, vans:0, sales:0 }
      byCode[k].trips++
      byCode[k].vans += t.container_size==='20ft'?(t.num_20ft||t.containers?.length||1):1
      byCode[k].sales += pmSaleValue(t)
    })

    return { td, tp, dumpSales, pmSales, totalSales, totalTrips, totalTons, totalVans, byRoute, byCode }
  }

  // ── FLEET TOTALS ──────────────────────────────────────────────────────────
  const activeTrucksForFleet = trucks.filter(t => t.active !== false)
  const companyPlateSet = new Set(activeTrucksForFleet.filter(t => t.ownership !== 'subcon' && t.ownership !== 'special_subcon').map(t => t.plate))
  const allDumpInPeriod = dumpTrips.filter(t => inPeriod(t.trip_date) && companyPlateSet.has(t.truck_plate))
  const allPMInPeriod = pmTrips.filter(t => inPeriod(t.trip_date) && companyPlateSet.has(t.truck_plate))
  const liveFleetSales = allDumpInPeriod.reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0) + allPMInPeriod.reduce((s,t) => s+pmSaleValue(t), 0)
  // Blend historical for periods with no live data
  const hasLiveData = liveFleetSales > 0
  const histInPeriod = historicalData.filter(h => {
    const mo = `${h.period_year}-${h.period_month}`
    // For monthly: check exact month; for quarterly/annual: check range
    return inPeriod(`${mo}-01`)
  })
  const histSalesTotal = histInPeriod.reduce((s,h) => s+(parseFloat(h.sales_dump)||0)+(parseFloat(h.sales_pm)||0), 0)
  const extraInPeriod = extraIncomeData.filter(e => inPeriod(e.income_date)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0)
  const hasHistData = histInPeriod.length > 0
  // Per-truck blend: trucks with a historical_data row for this period are
  // excluded from the live sum below, so their sales come from the historical
  // row instead — trucks with no historical entry keep their own live trip
  // data. Previously this was an all-or-nothing switch for the whole period,
  // so one truck's historical entry would silently drop every other truck's
  // live sales for that period.
  const histTruckIdsInPeriod = new Set(histInPeriod.map(h => h.truck_id))
  const histPlatesInPeriod = new Set(trucks.filter(t => histTruckIdsInPeriod.has(t.id)).map(t => t.plate))
  const liveOnlyDumpInPeriod = allDumpInPeriod.filter(t => !histPlatesInPeriod.has(t.truck_plate))
  const liveOnlyPMInPeriod = allPMInPeriod.filter(t => !histPlatesInPeriod.has(t.truck_plate))
  const blendFleetSales = liveOnlyDumpInPeriod.reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0)
    + liveOnlyPMInPeriod.reduce((s,t) => s+pmSaleValue(t), 0)
    + histSalesTotal
  const useHist = dataMode === 'historical'
  const useLive = dataMode === 'live'
  const fleetTrips = allDumpInPeriod.length + allPMInPeriod.length
  const fleetTons = allDumpInPeriod.reduce((s,t) => s+parseFloat(t.weight_tons||0), 0)
  const fleetSales = useLive ? liveFleetSales : useHist ? histSalesTotal : blendFleetSales
  const fleetTripsDisplay = useHist ? null : useLive ? fleetTrips : (hasHistData ? liveOnlyDumpInPeriod.length + liveOnlyPMInPeriod.length : fleetTrips)

  // ── PRINT ─────────────────────────────────────────────────────────────────
  const handleSavePDF = () => {
    const activeTrucks = trucks.filter(t => t.active !== false)
    const companyTrucks = activeTrucks.filter(t => t.ownership !== 'subcon' && t.ownership !== 'special_subcon')
    const f2 = (n) => Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2})
    const companyName = (localStorage.getItem('ds_company_name') || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'letter'})
    let firstPage = true

    companyTrucks.forEach(truck => {
      const r = getTruckSummary(truck)
      if (r.totalTrips === 0) return
      if (!firstPage) doc.addPage()
      firstPage = false

      doc.setFontSize(11); doc.setFont(undefined,'bold')
      doc.text(companyName, 14, 12)
      doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(100)
      doc.text(`Overall Trip Summary — ${periodLabel}`, 14, 17)
      doc.text(`TRUCK: ${truck.plate} — ${truck.truck_type}`, 14, 21)
      doc.setTextColor(0)

      if (Object.keys(r.byRoute).length > 0) {
        doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.text('DUMP TRUCK TRIPS', 14, 27); doc.setFont(undefined,'normal')
        autoTable(doc, {
          startY: 29,
          head: [['Route','Trips','Tons','Sales (PHP)']],
          body: Object.entries(r.byRoute).map(([route,d])=>[route,d.trips,d.tons.toFixed(3),f2(d.sales)]),
          foot: [['Subtotal',r.td.length,r.totalTons.toFixed(3),f2(r.dumpSales)]],
          headStyles:{fillColor:[255,30,0],fontSize:8,fontStyle:'bold'},
          tableLineColor:[100,100,100],tableLineWidth:0.15,
          footStyles:{fillColor:[240,240,240],fontStyle:'bold'},
          bodyStyles:{fontSize:8},
          columnStyles:{1:{halign:'center'},2:{halign:'right'},3:{halign:'right'}},
          margin:{left:14,right:14},
        })
      }

      if (Object.keys(r.byCode).length > 0) {
        const startY = (doc.lastAutoTable?.finalY || 30) + 5
        doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.text('PRIME MOVER TRIPS', 14, startY); doc.setFont(undefined,'normal')
        autoTable(doc, {
          startY: startY + 2,
          head: [['Trip Code','Trips','Vans/Containers','Sales (PHP)']],
          body: Object.entries(r.byCode).map(([code,d])=>[code,d.trips,d.vans,f2(d.sales)]),
          foot: [['Subtotal',r.tp.length,r.totalVans,f2(r.pmSales)]],
          headStyles:{fillColor:[50,50,50],fontSize:8,fontStyle:'bold'},
          tableLineColor:[100,100,100],tableLineWidth:0.15,
          footStyles:{fillColor:[240,240,240],fontStyle:'bold'},
          bodyStyles:{fontSize:8},
          columnStyles:{1:{halign:'center'},2:{halign:'center'},3:{halign:'right'}},
          margin:{left:14,right:14},
        })
      }

      // Truck total
      const totY = (doc.lastAutoTable?.finalY || 30) + 4
      doc.setFillColor(255,30,0); doc.setTextColor(255,255,255)
      doc.rect(14, totY, 183, 8, 'F')
      doc.setFontSize(8); doc.setFont(undefined,'bold')
      doc.text(`TOTAL — ${truck.plate}`, 18, totY+5)
      doc.text(`${r.totalTrips} trips`, 120, totY+5, {align:'right'})
      doc.text(`PHP ${f2(r.totalSales)}`, 197, totY+5, {align:'right'})
      doc.setTextColor(0); doc.setFont(undefined,'normal')
    })

    // Fleet summary page
    if (companyTrucks.some(t => getTruckSummary(t).totalTrips > 0)) {
      doc.addPage()
      doc.setFontSize(11); doc.setFont(undefined,'bold')
      doc.text(companyName, 14, 12)
      doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(0)
      doc.text(`Fleet Summary — ${periodLabel}`, 14, 17); doc.setTextColor(0)

      autoTable(doc, {
        startY: 21,
        head: [['Truck','Type','Dump Trips','PM Trips','Total Trips','Vans','Total Tons','Total Sales (PHP)']],
        body: companyTrucks.map(truck => {
          const r = getTruckSummary(truck)
          return [truck.plate, truck.truck_type, r.td.length, r.tp.length, r.totalTrips, r.totalVans||'—', r.totalTons>0?r.totalTons.toFixed(3):'—', f2(r.totalSales)]
        }),
        foot: [['FLEET TOTAL','', allDumpInPeriod.length, allPMInPeriod.length, fleetTrips, '—', fleetTons.toFixed(3), f2(fleetSales)]],
        headStyles:{fillColor:[255,30,0],fontSize:8,fontStyle:'bold'},
          tableLineColor:[100,100,100],tableLineWidth:0.15,
        footStyles:{fillColor:[30,30,30],textColor:[255,255,255],fontStyle:'bold'},
        bodyStyles:{fontSize:8},
        alternateRowStyles:{fillColor:[250,250,250]},
        tableLineColor:[100,100,100],tableLineWidth:0.15,
        columnStyles:{2:{halign:'center'},3:{halign:'center'},4:{halign:'center'},5:{halign:'center'},6:{halign:'right'},7:{halign:'right'}},
        margin:{left:14,right:14},
      })
    }

    doc.save(`Summary-${periodLabel.replace(/ /g,'-')}.pdf`)
    showToast('Summary saved as PDF.')
  }

  const activeTrucks = trucks.filter(t => t.active !== false)
  const companyTrucks = activeTrucks.filter(t => t.ownership !== 'subcon' && t.ownership !== 'special_subcon')

  // Month-over-month
  const prevMonth = (() => { const d = new Date(selectedYear, selectedMonth - 2, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } })()
  const prevMonthStr = `${prevMonth.y}-${String(prevMonth.m).padStart(2,'0')}`
  const currentMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2,'0')}`
  const momDump = dumpTrips.filter(t => t.trip_date?.startsWith(currentMonthStr)).reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0)
  const momPM = pmTrips.filter(t => t.trip_date?.startsWith(currentMonthStr)).reduce((s,t) => s+pmSaleValue(t), 0)
  const momTotal = momDump + momPM
  const prevDump = dumpTrips.filter(t => t.trip_date?.startsWith(prevMonthStr)).reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0)
  const prevPM = pmTrips.filter(t => t.trip_date?.startsWith(prevMonthStr)).reduce((s,t) => s+pmSaleValue(t), 0)
  const prevTotal = prevDump + prevPM
  const momPct = prevTotal > 0 ? ((momTotal - prevTotal) / prevTotal * 100).toFixed(1) : null
  const prevMonthLabel = new Date(prevMonthStr + '-01').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Overall Summary</h1><p className="page-sub">Trip count, vans, sales, and fuel efficiency per truck</p></div>
        {mainTab === 'summary' && <button className="btn-ghost" onClick={handleSavePDF} disabled={loading}>📄 Save PDF</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[['summary','📊 Trip Summary'],['fuel','⛽ Fuel Analytics']].map(([key,label]) => (
          <button key={key} onClick={() => setMainTab(key)} style={{
            padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
            background: mainTab === key ? 'var(--accent)' : 'var(--surface)',
            color: mainTab === key ? '#fff' : 'var(--muted)',
            border: `1.5px solid ${mainTab === key ? 'var(--accent)' : 'var(--border)'}`,
          }}>{label}</button>
        ))}
      </div>

      {mainTab === 'summary' && <>
      {/* Month-over-Month comparison */}
      {periodType === 'Monthly' && momPct !== null && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>📊 vs {prevMonthLabel}</div>
          <div style={{ fontSize: 12 }}>
            This month: <span style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>₱{fmt(momTotal)}</span>
          </div>
          <div style={{ fontSize: 12 }}>
            Prev month: <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>₱{fmt(prevTotal)}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: parseFloat(momPct) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {parseFloat(momPct) >= 0 ? '▲' : '▼'} {Math.abs(momPct)}%
          </div>
        </div>
      )}

      {/* Period selector */}
      <div className="card" style={{ marginBottom: 24 }}>
        <p className="section-label" style={{ marginTop: 0 }}>Period</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {PERIOD_TYPES.map(p => (
            <button key={p} onClick={() => setPeriodType(p)} style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: periodType === p ? 'var(--accent)' : 'var(--surface)',
              color: periodType === p ? '#fff' : 'var(--muted)',
              border: `1.5px solid ${periodType === p ? 'var(--accent)' : 'var(--border)'}`,
            }}>{p}</button>
          ))}
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="label">Year</label>
            <select value={selectedYear} onChange={e => { setSelectedYear(Number(e.target.value)); setDataMode('auto') }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {hasHistData && hasLiveData && (
              <div style={{ display:'flex', gap:4, marginTop:6 }}>
                {['auto','live','historical'].map(m => (
                  <button key={m} onClick={()=>setDataMode(m)} style={{ fontSize:10, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background: dataMode===m?'var(--accent)':'var(--surface)', color: dataMode===m?'#fff':'var(--muted)', cursor:'pointer' }}>
                    {m==='auto'?'Auto':m==='live'?'🔴 Live':'📅 Hist'}
                  </button>
                ))}
              </div>
            )}
            {hasHistData && !hasLiveData && <div style={{ fontSize:10, color:'var(--accent)', marginTop:4 }}>📅 Using historical data</div>}
          </div>
          {periodType === 'Monthly' && (
            <div className="form-group">
              <label className="label">Month</label>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
                {MONTHS.map((m,i) => <option key={i} value={String(i+1).padStart(2,'0')}>{m}</option>)}
              </select>
            </div>
          )}
          {periodType === 'Quarterly' && (
            <div className="form-group">
              <label className="label">Quarter</label>
              <select value={selectedQuarter} onChange={e => setSelectedQuarter(Number(e.target.value))}>
                {QUARTERS.map((q,i) => <option key={i} value={i}>{q}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {loading ? <div className="empty-state"><p>Loading…</p></div> : (
        <>
          {/* Fleet totals */}
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card"><div className="stat-label">Total Trips</div><div className="stat-value">{fleetTripsDisplay === null ? '—' : fleetTripsDisplay}</div></div>
            <div className="stat-card"><div className="stat-label">Dump Truck Trips</div><div className="stat-value">{fleetTripsDisplay === null ? '—' : allDumpInPeriod.length}</div></div>
            <div className="stat-card"><div className="stat-label">Prime Mover Trips</div><div className="stat-value">{fleetTripsDisplay === null ? '—' : allPMInPeriod.length}</div></div>
            <div className="stat-card"><div className="stat-label">Total Tons</div><div className="stat-value sm">{fleetTons.toFixed(2)}t</div></div>
            <div className="stat-card"><div className="stat-label">Fleet Sales</div><div className="stat-value sm">₱{fmt(fleetSales)}</div></div>
          </div>

          {/* Per truck breakdown */}
          {companyTrucks.map(truck => {
            const r = getTruckSummary(truck)
            if (r.totalTrips === 0) return null
            return (
              <div key={truck.id} className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: '0.5px solid var(--border)' }}>
                  <span className={`badge ${truck.truck_type==='Dump Truck'?'badge-dump':'badge-prime'}`} style={{ fontSize: 12 }}>{truck.plate}</span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{truck.truck_type}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Trips</div>
                      <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--mono)' }}>{r.totalTrips}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Sales</div>
                      <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>₱{fmt(r.totalSales)}</div>
                    </div>
                  </div>
                </div>

                {/* Dump truck breakdown */}
                {r.td.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Dump Truck — by Route</p>
                    <div className="table-wrap">
                      <table className="table">
                        <thead><tr>
                          <th>Route</th>
                          <th className="text-right">Trips</th>
                          <th className="text-right">Tons</th>
                          <th className="text-right">Sales (₱)</th>
                        </tr></thead>
                        <tbody>
                          {Object.entries(r.byRoute).map(([route, d]) => (
                            <tr key={route}>
                              <td>{route}</td>
                              <td className="text-right mono" style={{ fontWeight: 500 }}>{d.trips}</td>
                              <td className="text-right mono muted">{d.tons.toFixed(3)}</td>
                              <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(d.sales)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot><tr>
                          <td style={{ fontWeight: 500 }}>Subtotal</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>{r.td.length}</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>{r.totalTons.toFixed(3)}</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(r.dumpSales)}</td>
                        </tr></tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* PM breakdown */}
                {r.tp.length > 0 && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Prime Mover — by Trip Code</p>
                    <div className="table-wrap">
                      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                        <colgroup>
                          <col style={{ width: '50%' }} />
                          <col style={{ width: '15%' }} />
                          <col style={{ width: '15%' }} />
                          <col style={{ width: '20%' }} />
                        </colgroup>
                        <thead><tr>
                          <th>Trip Code</th>
                          <th className="text-right">Trips</th>
                          <th className="text-right">Vans / Containers</th>
                          <th className="text-right">Sales (₱)</th>
                        </tr></thead>
                        <tbody>
                          {Object.entries(r.byCode).map(([code, d]) => (
                            <tr key={code}>
                              <td><span className="badge badge-prime" style={{ fontSize: 10 }}>{code}</span></td>
                              <td className="text-right mono" style={{ fontWeight: 500 }}>{d.trips}</td>
                              <td className="text-right mono muted">{d.vans}</td>
                              <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(d.sales)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot><tr>
                          <td style={{ fontWeight: 500 }}>Subtotal</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>{r.tp.length}</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>{r.totalVans}</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(r.pmSales)}</td>
                        </tr></tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* Truck total footer */}
                <div style={{ marginTop: 12, padding: '10px 16px', background: 'var(--accent)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>TOTAL — {truck.plate}</span>
                  <div style={{ display: 'flex', gap: 20, color: '#fff' }}>
                    <span style={{ fontSize: 13 }}>{r.totalTrips} trips</span>
                    {r.totalTons > 0 && <span style={{ fontSize: 13 }}>{r.totalTons.toFixed(3)} tons</span>}
                    <span style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--mono)' }}>₱{fmt(r.totalSales)}</span>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Fleet summary table */}
          {companyTrucks.length > 0 && (
            <div className="card">
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Fleet Summary — {periodLabel}</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>All trucks side by side</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr>
                    <th>Truck</th><th>Type</th>
                    <th className="text-right">Dump Trips</th>
                    <th className="text-right">PM Trips</th>
                    <th className="text-right">Total Trips</th>
                    <th className="text-right">Vans/Containers</th>
                    <th className="text-right">Total Tons</th>
                    <th className="text-right">Total Sales (₱)</th>
                  </tr></thead>
                  <tbody>
                    {companyTrucks.map(truck => {
                      const r = getTruckSummary(truck)
                      return (
                        <tr key={truck.id}>
                          <td style={{ fontWeight: 500, fontFamily: 'var(--mono)' }}>{truck.plate}</td>
                          <td><span className={`badge ${truck.truck_type==='Dump Truck'?'badge-dump':'badge-prime'}`} style={{ fontSize: 10 }}>{truck.truck_type}</span></td>
                          <td className="text-right mono">{r.td.length}</td>
                          <td className="text-right mono">{r.tp.length}</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>{r.totalTrips}</td>
                          <td className="text-right mono muted">{r.totalVans > 0 ? r.totalVans : '—'}</td>
                          <td className="text-right mono muted">{r.totalTons > 0 ? r.totalTons.toFixed(3) : '—'}</td>
                          <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(r.totalSales)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={2} style={{ fontWeight: 500, padding: '10px 14px', borderTop: '2px solid var(--border-md)' }}>Fleet Total</td>
                    <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>{allDumpInPeriod.length}</td>
                    <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>{allPMInPeriod.length}</td>
                    <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>{fleetTrips}</td>
                    <td className="text-right mono" style={{ borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>—</td>
                    <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>{fleetTons.toFixed(3)}</td>
                    <td className="text-right mono" style={{ fontWeight: 500, fontSize: 14, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>₱{fmt(fleetSales)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      </>}

      {mainTab === 'fuel' && (
        <FuelAnalyticsTab
          trucks={trucks}
          dumpTrips={dumpTrips}
          pmTrips={pmTrips}
          expenses={expenses}
          loading={loading}
          fuelSearch={fuelSearch}
          setFuelSearch={setFuelSearch}
          fuelMonth={fuelMonth}
          setFuelMonth={setFuelMonth}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}

// ── FUEL ANALYTICS TAB ─────────────────────────────────────────────────────
function FuelAnalyticsTab({ trucks, dumpTrips, pmTrips, expenses, loading, fuelSearch, setFuelSearch, fuelMonth, setFuelMonth }) {
  if (loading) return <div className="empty-state"><p>Loading…</p></div>

  // Available months from fuel expense data
  const availableMonths = [...new Set(expenses.map(e => (e.expense_date || '').slice(0, 7)).filter(Boolean))].sort().reverse()

  const inMonth = (d) => !fuelMonth || (d || '').startsWith(fuelMonth)

  const rows = trucks
    .filter(t => t.ownership !== 'subcon' && t.ownership !== 'special_subcon')
    .filter(t => !fuelSearch || t.plate.toLowerCase().includes(fuelSearch.toLowerCase()) || (t.truck_type || '').toLowerCase().includes(fuelSearch.toLowerCase()))
    .map(truck => {
      const fuelCost = expenses
        .filter(e => e.truck_id === truck.id && inMonth(e.expense_date))
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)

      const td = dumpTrips.filter(t => t.truck_plate === truck.plate && inMonth(t.trip_date))
      const tp = pmTrips.filter(t => t.truck_plate === truck.plate && inMonth(t.trip_date))
      const tons = td.reduce((s, t) => s + (parseFloat(t.weight_tons) || 0), 0)
      const trips = td.length + tp.length

      const costPerTon = tons > 0 ? fuelCost / tons : null
      const costPerTrip = trips > 0 ? fuelCost / trips : null

      return { truck, fuelCost, tons, trips, costPerTon, costPerTrip }
    })
    .filter(r => r.fuelCost > 0 || r.trips > 0)
    .sort((a, b) => b.fuelCost - a.fuelCost)

  const fleetFuel = rows.reduce((s, r) => s + r.fuelCost, 0)
  const fleetTons = rows.reduce((s, r) => s + r.tons, 0)
  const fleetTrips = rows.reduce((s, r) => s + r.trips, 0)

  return (
    <>
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card"><div className="stat-label">Total Fuel Cost{fuelMonth ? ` (${fuelMonth})` : ' (All Time)'}</div><div className="stat-value sm">₱{fmt(fleetFuel)}</div></div>
        <div className="stat-card"><div className="stat-label">Fleet ₱/Ton</div><div className="stat-value sm">{fleetTons > 0 ? `₱${fmt(fleetFuel / fleetTons)}` : '—'}</div></div>
        <div className="stat-card"><div className="stat-label">Fleet ₱/Trip</div><div className="stat-value sm">{fleetTrips > 0 ? `₱${fmt(fleetFuel / fleetTrips)}` : '—'}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <p className="section-label" style={{ marginTop: 0 }}>Filters</p>
        <div className="form-grid">
          <div className="form-group">
            <label className="label">Search truck plate / type</label>
            <input value={fuelSearch} onChange={e => setFuelSearch(e.target.value)} placeholder="e.g. NKA 3172 or Dump Truck" />
          </div>
          <div className="form-group">
            <label className="label">Month</label>
            <select value={fuelMonth} onChange={e => setFuelMonth(e.target.value)}>
              <option value="">All time</option>
              {availableMonths.map(m => {
                const [y, mo] = m.split('-')
                const label = new Date(`${m}-01`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
                return <option key={m} value={m}>{label}</option>
              })}
            </select>
          </div>
          {(fuelSearch || fuelMonth) && (
            <div className="form-group" style={{ alignSelf: 'flex-end' }}>
              <button className="btn-ghost btn-sm" onClick={() => { setFuelSearch(''); setFuelMonth('') }}>Clear filters</button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Fuel Efficiency by Truck{fuelMonth ? ` — ${new Date(`${fuelMonth}-01`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}` : ' — All Time'}</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Fuel cost pulled from Expenses (categories: Fuel — PO, Fuel — Cash). Tons hauled from Dump Truck trips only; trip count includes both Dump and Prime Mover.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Plate</th>
                <th>Type</th>
                <th className="text-right">Fuel Cost</th>
                <th className="text-right">Tons Hauled</th>
                <th className="text-right">Trips</th>
                <th className="text-right">₱ / Ton</th>
                <th className="text-right">₱ / Trip</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No fuel or trip data found for this filter.</td></tr>
              )}
              {rows.map(r => (
                <tr key={r.truck.id}>
                  <td style={{ fontWeight: 500 }}>{r.truck.plate}</td>
                  <td><span className={`badge ${r.truck.truck_type === 'Dump Truck' ? 'badge-dump' : 'badge-prime'}`} style={{ fontSize: 10 }}>{r.truck.truck_type}</span></td>
                  <td className="text-right mono">₱{fmt(r.fuelCost)}</td>
                  <td className="text-right mono muted">{r.tons > 0 ? r.tons.toFixed(3) : '—'}</td>
                  <td className="text-right mono muted">{r.trips || '—'}</td>
                  <td className="text-right mono" style={{ fontWeight: 500 }}>{r.costPerTon !== null ? `₱${fmt(r.costPerTon)}` : '—'}</td>
                  <td className="text-right mono" style={{ fontWeight: 500 }}>{r.costPerTrip !== null ? `₱${fmt(r.costPerTrip)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ fontWeight: 500, padding: '10px 14px', borderTop: '2px solid var(--border-md)' }}>Fleet Total</td>
                  <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>₱{fmt(fleetFuel)}</td>
                  <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>{fleetTons.toFixed(3)}</td>
                  <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>{fleetTrips}</td>
                  <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>{fleetTons > 0 ? `₱${fmt(fleetFuel / fleetTons)}` : '—'}</td>
                  <td className="text-right mono" style={{ fontWeight: 500, borderTop: '2px solid var(--border-md)', padding: '10px 14px' }}>{fleetTrips > 0 ? `₱${fmt(fleetFuel / fleetTrips)}` : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  )
}
