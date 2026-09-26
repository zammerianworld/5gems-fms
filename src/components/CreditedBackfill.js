import { useState } from 'react'
import { supabase, fmt, fmtDate, logAudit } from '../lib/supabase'

// Backfill for invoices marked Paid without the real amount received.
// Every "collected / credited" figure in the app falls back to an estimate
// when invoices.actual_amount_credited is blank: net × 1.10 for a VAT
// invoice, net × 0.98 (2% WHT) for non-VAT — matching the same is_vat-aware
// formula already used across Billing.js (Aging/Client Balance, bulk Mark
// Paid, the quick-edit auto-fill). Entering the real figure from the bank
// deposit here makes those pages exact, invoice by invoice — nothing
// changes for invoices left blank.
const estimateOf = (inv) => Math.round((inv.total_sales_net || 0) * (inv.is_vat ? 1.10 : 0.98) * 100) / 100

export default function CreditedBackfill({ invoices, onSaved, showToast, profile }) {
  const [sortBy, setSortBy] = useState('oldest') // 'oldest' | 'largest'
  const [year, setYear] = useState('')
  const [client, setClient] = useState('')
  const [amounts, setAmounts] = useState({}) // id -> typed amount
  const [dates, setDates] = useState({})     // id -> corrected date credited
  const [savingId, setSavingId] = useState(null)
  const [savingAll, setSavingAll] = useState(false)
  const [selected, setSelected] = useState(() => new Set()) // invoice ids ticked for bulk actions
  const [bulkDate, setBulkDate] = useState('')

  const paid = invoices.filter(i => i.status === 'Paid')
  const done = paid.filter(i => i.actual_amount_credited != null).length
  const missingAll = paid.filter(i => i.actual_amount_credited == null)
  const years = [...new Set(missingAll.map(i => (i.date_credited || i.invoice_date || '').slice(0, 4)).filter(Boolean))].sort()
  const clients = [...new Set(missingAll.map(i => i.client).filter(Boolean))].sort()

  const rows = missingAll
    .filter(i => !year || (i.date_credited || i.invoice_date || '').startsWith(year))
    .filter(i => !client || i.client === client)
    .sort((a, b) => sortBy === 'largest'
      ? estimateOf(b) - estimateOf(a)
      : (a.date_credited || a.invoice_date || '').localeCompare(b.date_credited || b.invoice_date || ''))

  const pct = paid.length ? Math.round((done / paid.length) * 100) : 100
  const estimatedTotal = missingAll.reduce((s, i) => s + estimateOf(i), 0)

  const saveRow = async (inv, silent = false) => {
    const amt = parseFloat(amounts[inv.id])
    if (!(amt > 0)) { if (!silent) showToast(`Enter the amount received for ${inv.invoice_no}.`, 'error'); return false }
    const payload = { actual_amount_credited: Math.round(amt * 100) / 100 }
    if (dates[inv.id] && dates[inv.id] !== inv.date_credited) payload.date_credited = dates[inv.id]
    const { error } = await supabase.from('invoices').update(payload).eq('id', inv.id)
    if (error) { showToast(`${inv.invoice_no}: ${error.message}`, 'error'); return false }
    logAudit('destructive', 'Updated', 'Invoice',
      `Recorded actual amount credited for invoice ${inv.invoice_no}: ₱${fmt(payload.actual_amount_credited)} (estimate was ₱${fmt(estimateOf(inv))})${payload.date_credited ? `, date credited → ${payload.date_credited}` : ''}`,
      inv.id, profile?.id, profile?.full_name)
    return true
  }

  const handleSaveOne = async (inv) => {
    setSavingId(inv.id)
    if (await saveRow(inv)) { showToast(`Saved ${inv.invoice_no}.`); onSaved() }
    setSavingId(null)
  }

  const entered = rows.filter(i => parseFloat(amounts[i.id]) > 0)
  const handleSaveAll = async () => {
    if (!entered.length) return
    setSavingAll(true)
    let ok = 0
    for (const inv of entered) if (await saveRow(inv, true)) ok++
    showToast(`Saved ${ok} of ${entered.length} invoice${entered.length === 1 ? '' : 's'}.`, ok === entered.length ? 'success' : 'error')
    setSavingAll(false); onSaved()
  }

  // ── Bulk selection (applies to the rows currently shown) ──
  const selectedRows = rows.filter(i => selected.has(i.id))
  const allShownOn = rows.length > 0 && rows.every(i => selected.has(i.id))
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAllShown = (on) => setSelected(prev => {
    const n = new Set(prev)
    rows.forEach(i => on ? n.add(i.id) : n.delete(i.id))
    return n
  })
  const fillSelectedWithEstimate = () => setAmounts(a => {
    const next = { ...a }
    selectedRows.forEach(i => { next[i.id] = estimateOf(i).toFixed(2) })
    return next
  })
  const applyDateToSelected = () => {
    if (!bulkDate) return
    setDates(d => { const next = { ...d }; selectedRows.forEach(i => { next[i.id] = bulkDate }); return next })
  }
  const handleSaveSelected = async () => {
    const missing = selectedRows.filter(i => !(parseFloat(amounts[i.id]) > 0))
    if (missing.length) {
      showToast(`${missing.length} selected invoice${missing.length === 1 ? ' has' : 's have'} no amount yet — type it, or use "Fill = Est." first.`, 'error')
      return
    }
    setSavingAll(true)
    let ok = 0
    for (const inv of selectedRows) if (await saveRow(inv, true)) ok++
    showToast(`Saved ${ok} of ${selectedRows.length} selected invoice${selectedRows.length === 1 ? '' : 's'}.`, ok === selectedRows.length ? 'success' : 'error')
    setSelected(new Set()); setSavingAll(false); onSaved()
  }

  const cell = { padding: '7px 8px', verticalAlign: 'middle', fontSize: 13 }
  return (
    <div className="tab-content">
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Real amounts recorded: {done} of {paid.length} paid invoices ({pct}%)</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{missingAll.length} still estimated · ₱{fmt(estimatedTotal)} in estimates</div>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, marginBottom: 0 }}>
          These invoices were marked Paid without the amount that actually reached the bank, so every collections figure uses
          an estimate for them (net × 1.10 for a VAT invoice, or net − 2% WHT otherwise). Type the real amount from the bank deposit — or click
          <strong> = Est.</strong> if it matched — and save. You can fix the date credited here too. Each save makes Paid Invoices,
          Cashflow, Year-over-Year and subcon credited amounts exact for that invoice.
        </p>
      </div>

      <div className="filter-bar" style={{ marginBottom: 12 }}>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 'auto' }}>
          <option value="oldest">Oldest first</option>
          <option value="largest">Largest first</option>
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={client} onChange={e => setClient(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn-primary btn-sm" onClick={handleSaveAll} disabled={savingAll || !entered.length} style={{ marginLeft: 'auto' }}>
          {savingAll ? 'Saving…' : `Save all entered (${entered.length})`}
        </button>
      </div>

      {selectedRows.length > 0 && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: '10px 12px', border: '1px solid var(--accent)' }}>
          <strong style={{ fontSize: 13 }}>{selectedRows.length} selected</strong>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>· estimate ₱{fmt(selectedRows.reduce((s, i) => s + estimateOf(i), 0))}</span>
          <button className="btn-ghost btn-sm" onClick={fillSelectedWithEstimate} title="Bank deposits matched the estimate">Fill = Est.</button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} style={{ width: 150, fontSize: 12, padding: '3px 6px' }} />
            <button className="btn-ghost btn-sm" onClick={applyDateToSelected} disabled={!bulkDate}>Set date credited</button>
          </span>
          <button className="btn-primary btn-sm" onClick={handleSaveSelected} disabled={savingAll} style={{ marginLeft: 'auto' }}>
            {savingAll ? 'Saving…' : `Save selected (${selectedRows.length})`}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state"><p>{missingAll.length === 0 ? 'Every paid invoice has its real amount recorded.' : 'Nothing matches these filters.'}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" title="Select all shown" checked={allShownOn} onChange={e => toggleAllShown(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                </th>
                <th>Invoice</th><th>Client</th><th>Date Credited</th>
                <th className="text-right">Net</th><th className="text-right">Estimate</th>
                <th className="text-right">Actual Received (₱)</th><th className="text-right">Difference</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(inv => {
                const est = estimateOf(inv)
                const typed = parseFloat(amounts[inv.id])
                const diff = typed > 0 ? Math.round((typed - est) * 100) / 100 : null
                return (
                  <tr key={inv.id} style={selected.has(inv.id) ? { background: 'var(--accent-light)' } : undefined}>
                    <td style={cell}><input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)} style={{ width: 'auto', margin: 0 }} /></td>
                    <td style={cell}><span style={{ fontFamily: 'var(--mono)' }}>{inv.invoice_no}</span><div style={{ fontSize: 11, color: 'var(--muted)' }}>{inv.truck_type === 'Dump Truck' ? 'Dump' : 'PM'} · {fmtDate(inv.invoice_date)}</div></td>
                    <td style={cell}>{inv.client}</td>
                    <td style={cell}>
                      <input type="date" value={dates[inv.id] ?? (inv.date_credited || '')} onChange={e => setDates(d => ({ ...d, [inv.id]: e.target.value }))} style={{ width: 150, fontSize: 12, padding: '3px 6px' }} />
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(inv.total_sales_net || 0)}</td>
                    <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{fmt(est)}</td>
                    <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost btn-sm" title="Bank deposit matched the estimate" onClick={() => setAmounts(a => ({ ...a, [inv.id]: est.toFixed(2) }))} style={{ marginRight: 4 }}>= Est.</button>
                      <input type="number" step="0.01" value={amounts[inv.id] ?? ''} placeholder="from bank" onChange={e => setAmounts(a => ({ ...a, [inv.id]: e.target.value }))} style={{ width: 120, fontSize: 12, padding: '3px 6px', fontFamily: 'var(--mono)', textAlign: 'right' }} />
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)', color: diff == null ? 'var(--muted)' : diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--success)' : 'var(--muted)' }}>
                      {diff == null ? '—' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                    </td>
                    <td style={cell}>
                      <button className="btn-primary btn-sm" disabled={savingId === inv.id || !(typed > 0)} onClick={() => handleSaveOne(inv)}>{savingId === inv.id ? '…' : 'Save'}</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
