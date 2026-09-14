// DatePickerRange — single button trigger showing "Jan 1 - Jan 15, 2026",
// opens a Calendar in range mode. Works with plain 'YYYY-MM-DD' strings
// for from/to so it drops in wherever a pair of date inputs is used today.
import { useState } from 'react'
import Calendar from './Calendar'
import Popover from './Popover'

function toISO(d) {
  if (!d) return ''
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}
function fromISO(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m-1, d)
}
function formatShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatRange(from, to) {
  if (from && to) return `${formatShort(from)} – ${formatShort(to)}`
  if (from) return formatShort(from)
  return 'Pick a date range'
}

export default function DatePickerRange({ from, to, onChange, style }) {
  const [open, setOpen] = useState(false)
  const fromDate = fromISO(from), toDate = fromISO(to)
  const [visibleMonth, setVisibleMonth] = useState(fromDate || new Date())
  const [pendingFrom, setPendingFrom] = useState(null)

  const handleOpen = () => { setPendingFrom(null); setOpen(o => !o) }

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button type="button" onClick={handleOpen}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            width: style?.width || 220, padding: '8px 12px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer',
            fontSize: 13, color: (fromDate || toDate) ? 'var(--text)' : 'var(--muted)',
          }}>
          <span>{formatRange(fromDate, toDate)}</span>
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>▾</span>
        </button>
      }
    >
      <Calendar
        mode="range"
        selected={pendingFrom ? { from: pendingFrom, to: null } : { from: fromDate, to: toDate }}
        month={visibleMonth}
        onMonthChange={setVisibleMonth}
        onSelect={(range) => {
          if (range.from && range.to) {
            onChange({ from: toISO(range.from), to: toISO(range.to) })
            setOpen(false)
          } else if (range.from) {
            setVisibleMonth(range.from)
            setPendingFrom(range.from)
          }
        }}
      />
    </Popover>
  )
}
