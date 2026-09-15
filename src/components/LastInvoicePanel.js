// LastInvoicePanel — floating reference panel shown during invoice
// creation (Billing → Generate), suggesting the next invoice number based
// on the real "series" the current invoice actually belongs to.
//
// Dump Truck: series = the truck's Invoice Group (set in Settings →
// Trucks). A group can span multiple clients (one physical pad, several
// clients billed off it), so the true series boundary is the group
// itself — the suggestion is based on the highest number across ALL
// clients in that group, never scoped to just one client.
//
// Prime Mover: series = the CLIENT itself, not trip code. Confirmed
// directly — invoices for the same client on different trip codes share
// one sequential number pool. The client IS the series boundary here —
// the suggestion must be scoped to that one client, never mixed across
// clients (client A's PM numbering has nothing to do with client B's).
//
// This is purely a reference display — nothing here writes to the form
// except the explicit "Use" button, which the caller wires to actually
// set the invoice number.
import { useState } from 'react'

function suggestNext(lastNo) {
  const m = String(lastNo || '').match(/^(\D*)(\d+)(\D*)$/)
  if (!m) return null // no digits to increment — nothing sensible to suggest
  const [, prefix, digits, suffix] = m
  const next = String(Number(digits) + 1).padStart(digits.length, '0')
  return `${prefix}${next}${suffix}`
}

// "Last used" means highest invoice NUMBER, not most recent date — invoices
// can genuinely be entered out of date order (a late-dated entry doesn't
// mean it got the highest number), so sorting by date would pick the wrong
// one. Extracts the numeric portion for comparison; falls back to date
// only if a number truly can't be parsed at all.
function numericValue(invoiceNo) {
  const m = String(invoiceNo || '').match(/(\d+)/)
  return m ? Number(m[1]) : null
}
function pickHighest(matches) {
  return matches.slice().sort((a, b) => {
    const na = numericValue(a.invoice_no), nb = numericValue(b.invoice_no)
    if (na !== null && nb !== null) return nb - na
    return (b.invoice_date || '').localeCompare(a.invoice_date || '')
  })[0] || null
}

export default function LastInvoicePanel({ truckType, selectedClient, trucks, invoices, allDumpTrips, relevantTrips, onUse }) {
  const [open, setOpen] = useState(true)
  const [scope, setScope] = useState('client') // 'client' | 'global' — Dump only; PM's series is always client-scoped

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 900,
      background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '50%',
      width: 44, height: 44, fontSize: 18, cursor: 'pointer', boxShadow: 'var(--shadow-accent)',
    }} title="Show last invoice numbers">🧾</button>
  )

  const isDump = truckType === 'Dump Truck'

  // "Already used" is checked globally — a suggestion that collides with
  // any existing invoice number, anywhere, is a bad suggestion regardless
  // of which series it technically belongs to.
  const allInvoiceNos = new Set(invoices.map(i => (i.invoice_no || '').trim()).filter(Boolean))

  // For a colliding number, identify which series it actually belongs to
  // — so the warning can say where it was really used instead of just
  // "already used somewhere," saving a manual hunt through the records.
  const describeInvoiceSeries = (invoiceNo) => {
    const inv = invoices.find(i => (i.invoice_no || '').trim() === invoiceNo)
    if (!inv) return null
    if (inv.truck_type === 'Prime Mover') return `Prime Mover — ${inv.client}`
    if (inv.truck_type === 'Dump Truck') {
      const plates = [...new Set(allDumpTrips.filter(t => t.invoice_id === inv.id).map(t => t.truck_plate).filter(Boolean))]
      const groupNames = [...new Set(plates.map(p => trucks.find(t => t.plate === p)?.invoice_group).filter(Boolean))]
      if (groupNames.length) return `Dump — ${groupNames.join(', ')} (client: ${inv.client})`
      return `Dump Truck — no Invoice Group set (client: ${inv.client})`
    }
    return `client: ${inv.client}`
  }

  let rows = []

  if (isDump) {
    const matchesScope = (inv) => scope === 'global' || inv.client === selectedClient
    const plates = [...new Set((relevantTrips || []).map(t => t.truck_plate).filter(Boolean))]
    const groups = [...new Set(plates.map(p => trucks.find(t => t.plate === p)?.invoice_group).filter(Boolean))]

    rows = groups.map(group => {
      const groupPlates = trucks.filter(t => t.invoice_group === group).map(t => t.plate)
      const invoiceIds = new Set(allDumpTrips.filter(t => groupPlates.includes(t.truck_plate) && t.invoice_id).map(t => t.invoice_id))
      const allForGroup = invoices.filter(inv => invoiceIds.has(inv.id))
      const scoped = allForGroup.filter(matchesScope)
      return { label: `Dump — ${group}`, displayLast: pickHighest(scoped), globalLast: pickHighest(allForGroup) }
    }).filter(r => r.displayLast)
  } else {
    // PM series = the client, full stop — not trip code. All Prime Mover
    // invoices for this one client, regardless of which trip code they're
    // on, share one number pool.
    if (selectedClient) {
      const allForClient = invoices.filter(inv => inv.truck_type === 'Prime Mover' && inv.client === selectedClient)
      const last = pickHighest(allForClient)
      if (last) rows = [{ label: `Prime Mover — ${selectedClient}`, displayLast: last, globalLast: last }]
    }
  }

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 900, width: 300,
      background: 'var(--surface)', borderRadius: 14, boxShadow: 'var(--shadow), 0 8px 24px rgba(0,0,0,0.15)',
      border: '1px solid var(--border)', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', background: 'var(--accent)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 500 }}>
        <span>🧾 Last Invoice Numbers</span>
        <span onClick={() => setOpen(false)} style={{ opacity: 0.85, cursor: 'pointer' }}>✕</span>
      </div>
      {isDump && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[['client', 'This Client'], ['global', 'Global']].map(([v, l]) => (
            <div key={v} onClick={() => setScope(v)} style={{
              flex: 1, textAlign: 'center', padding: '7px 0', fontSize: 12, cursor: 'pointer',
              fontWeight: scope === v ? 600 : 400, color: scope === v ? 'var(--accent)' : 'var(--muted)',
              borderBottom: scope === v ? '2px solid var(--accent)' : 'none',
            }}>{l}</div>
          ))}
        </div>
      )}
      <div style={{ padding: '10px 14px', maxHeight: 280, overflowY: 'auto' }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '10px 0' }}>
            {!selectedClient ? 'Select a client to see relevant history.' : 'No matching invoice history yet.'}
          </div>
        )}
        {rows.map(({ label, displayLast, globalLast }) => {
          const suggested = suggestNext(globalLast.invoice_no)
          const suggestedTaken = suggested && allInvoiceNos.has(suggested)
          // Checked against the actual NUMBER VALUE, not a count of
          // invoice records — a series can have gaps (voided invoices,
          // skipped numbers), so a record-count check will rarely line up
          // with the number itself. "Last: 750" should flag as a pad
          // boundary regardless of how many actual records exist behind
          // it.
          const lastNum = numericValue(globalLast.invoice_no)
          const padJustCompleted = lastNum !== null && lastNum > 0 && lastNum % 50 === 0
          return (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{label}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Last: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{displayLast.invoice_no}</span></span>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>{displayLast.invoice_date}</span>
              </div>
              {padJustCompleted && (
                <div style={{ fontSize: 11, color: 'var(--danger)', background: 'var(--danger-light)', borderRadius: 6, padding: '5px 8px', marginBottom: 6 }}>
                  ⚠ This series just hit {lastNum} — a round 50, likely the end of a pad. Consider starting a new series/pad.
                </div>
              )}
              {suggested && suggestedTaken && (
                <div style={{ fontSize: 11, color: 'var(--danger)', background: 'var(--danger-light)', borderRadius: 6, padding: '5px 8px' }}>
                  ⚠ Bad suggestion — <strong style={{ fontFamily: 'var(--mono)' }}>{suggested}</strong> is already used{describeInvoiceSeries(suggested) ? <> by <strong>{describeInvoiceSeries(suggested)}</strong></> : ''}. Put it on that series instead, or check manually before entering a number.
                </div>
              )}
              {suggested && !suggestedTaken && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--accent-light)', borderRadius: 6, padding: '5px 8px' }}>
                  <span style={{ fontSize: 12, color: 'var(--accent-dark)' }}>Suggested next: <strong style={{ fontFamily: 'var(--mono)' }}>{suggested}</strong></span>
                  <button onClick={() => onUse(suggested)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>Use</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
