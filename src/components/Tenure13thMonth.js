import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fmtDate } from '../lib/supabase'

const p = (v) => parseFloat(v) || 0

const TH = { padding: '8px 10px', fontSize: 11, fontWeight: 700, textAlign: 'center', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em' }
const TD = { padding: '8px 10px', fontSize: 13, textAlign: 'center' }
const INPUT = { width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }

// Tenure in whole months, as of Dec 31 of the given year (or today, if that's
// still in the future for the current year).
const tenureMonths = (hireDate, year) => {
  if (!hireDate) return 0
  const hire = new Date(hireDate + 'T00:00:00')
  const asOf = new Date(year, 11, 31)
  const today = new Date()
  const cutoff = asOf > today ? today : asOf
  if (hire > cutoff) return 0
  let months = (cutoff.getFullYear() - hire.getFullYear()) * 12 + (cutoff.getMonth() - hire.getMonth())
  if (cutoff.getDate() < hire.getDate()) months -= 1
  return Math.max(0, months)
}

const tierFor = (months, tiers) => tiers.find(t => months >= t.min_months && (t.max_months == null || months <= t.max_months))

export default function Tenure13thMonth({ isAdmin, profile, showToast, settings }) {
  const [year, setYear] = useState(new Date().getFullYear())
  const [drivers, setDrivers] = useState([])
  const [supportStaff, setSupportStaff] = useState([])
  const [tiers, setTiers] = useState([])
  const [records, setRecords] = useState([]) // tenure_13th_month rows for this year
  const [baseInputs, setBaseInputs] = useState({}) // personKey -> typed base amount, before saving
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [dr, emp, tr, rec] = await Promise.all([
      supabase.from('drivers').select('id,driver_name,hire_date').eq('active', true).order('driver_name'),
      supabase.from('payroll_employees').select('id,full_name,basic_rate_monthly').eq('category', 'support').eq('is_active', true).order('full_name'),
      supabase.from('tenure_13th_tiers').select('*').order('sort_order'),
      supabase.from('tenure_13th_month').select('*').eq('year', year),
    ])
    setDrivers(dr.data || [])
    setSupportStaff(emp.data || [])
    setTiers(tr.data || [])
    setRecords(rec.data || [])
    setLoading(false)
  }, [year])

  useEffect(() => { fetchAll() }, [fetchAll])

  const people = [
    ...drivers.map(d => ({ key: `driver:${d.id}`, id: d.id, kind: 'driver', name: d.driver_name, hire_date: d.hire_date, suggestedBase: null })),
    ...supportStaff.map(e => ({ key: `emp:${e.id}`, id: e.id, kind: 'emp', name: e.full_name, hire_date: null, suggestedBase: e.basic_rate_monthly })),
  ]

  const getAmount = (person) => {
    if (baseInputs[person.key] !== undefined) return baseInputs[person.key]
    const existing = records.find(r => person.kind === 'driver' ? r.driver_id === person.id : r.employee_id === person.id)
    return existing ? String(existing.final_amount) : ''
  }

  const saveOne = async (person) => {
    const amount = p(getAmount(person))
    if (!amount) { showToast('Enter the amount upper management decided on.', 'error'); return }
    const months = tenureMonths(person.hire_date, year)
    const tier = tierFor(months, tiers)
    setSaving(true)
    const payload = {
      driver_id: person.kind === 'driver' ? person.id : null,
      employee_id: person.kind === 'emp' ? person.id : null,
      year,
      tier: tier?.tier_key || null, // reference only — shown alongside the decision, never drives it
      base_amount: amount, final_amount: amount,
    }
    const existing = records.find(r => person.kind === 'driver' ? r.driver_id === person.id : r.employee_id === person.id)
    const { error } = existing
      ? await supabase.from('tenure_13th_month').update(payload).eq('id', existing.id)
      : await supabase.from('tenure_13th_month').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast(`Saved for ${person.name}.`); fetchAll() }
    setSaving(false)
  }

  const markPaid = async (person) => {
    const existing = records.find(r => person.kind === 'driver' ? r.driver_id === person.id : r.employee_id === person.id)
    if (!existing) { showToast('Compute and save first.', 'error'); return }
    const { error } = await supabase.from('tenure_13th_month').update({ paid: true, paid_date: new Date().toISOString().slice(0, 10) }).eq('id', existing.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Marked as paid.'); fetchAll() }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Year</label>
          <select value={year} onChange={e => { setYear(parseInt(e.target.value)); setBaseInputs({}) }} style={{ ...INPUT, width: 120 }}>
            {[2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', maxWidth: 480 }}>
          Tenure and tier are shown for reference only — the amount itself is upper management's call, entered directly per person.
        </div>
      </div>

      <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', minWidth: 800, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
            <th style={{ ...TH, textAlign: 'left' }}>Name</th>
            <th style={TH}>Type</th>
            <th style={TH}>Tenure</th>
            <th style={TH}>Tier <span style={{ fontWeight: 400, textTransform: 'none' }}>(reference)</span></th>
            <th style={TH}>13th Month Amount</th>
            <th style={TH}>Status</th>
            <th style={TH}>Actions</th>
          </tr></thead>
          <tbody>
            {people.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No active drivers or support staff found.</td></tr>
            ) : people.map(person => {
              const months = tenureMonths(person.hire_date, year)
              const tier = tierFor(months, tiers)
              const existing = records.find(r => person.kind === 'driver' ? r.driver_id === person.id : r.employee_id === person.id)
              const amount = getAmount(person)
              return (
                <tr key={person.key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...TD, textAlign: 'left', fontWeight: 600 }}>{person.name}</td>
                  <td style={TD}>{person.kind === 'driver' ? '🚛 Driver' : '👤 Support'}</td>
                  <td style={TD}>{person.hire_date ? `${months} mo. (since ${fmtDate(person.hire_date)})` : <span style={{ color: 'var(--muted)' }}>No hire date on file</span>}</td>
                  <td style={TD}>{tier ? tier.tier_label : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td style={TD}>
                    <input type="number" value={amount} onChange={e => setBaseInputs(b => ({ ...b, [person.key]: e.target.value }))}
                      placeholder={person.suggestedBase ? `e.g. monthly rate ₱${fmt(person.suggestedBase)}` : '0.00'} style={{ ...INPUT, width: 130, textAlign: 'right' }} />
                  </td>
                  <td style={TD}>{existing?.paid
                    ? <span style={{ fontSize: 11, background: '#f0fdf4', color: '#16a34a', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>✅ Paid {existing.paid_date ? fmtDate(existing.paid_date) : ''}</span>
                    : existing
                      ? <span style={{ fontSize: 11, background: '#fffbeb', color: '#d97706', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Saved</span>
                      : <span style={{ fontSize: 11, color: 'var(--muted)' }}>Not computed</span>}
                  </td>
                  <td style={TD}>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button onClick={() => saveOne(person)} disabled={saving} style={{ padding: '5px 9px', border: '1px solid #3b82f633', borderRadius: 5, background: '#3b82f611', color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>{existing ? 'Update' : 'Save'}</button>
                        {existing && !existing.paid && <button onClick={() => markPaid(person)} style={{ padding: '5px 9px', border: '1px solid #16a34a33', borderRadius: 5, background: '#16a34a11', color: '#16a34a', cursor: 'pointer', fontSize: 12 }}>Mark Paid</button>}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
