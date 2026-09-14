// DatePickerSingle — text input showing a formatted date ("January 01,
// 2026") with a calendar-icon trigger that opens a custom Calendar popover.
// Matches the old native-date-input's API (value = 'YYYY-MM-DD' string,
// onChange receives an event-like object with target.value) so it drops
// in wherever a date input is used today.
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
function formatLong(d) {
  if (!d) return ''
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function DatePickerSingle({ value, onChange, style, placeholder, min, max, required }) {
  const [open, setOpen] = useState(false)
  const selectedDate = fromISO(value)
  const [visibleMonth, setVisibleMonth] = useState(selectedDate || new Date())
  const minDate = fromISO(min), maxDate = fromISO(max)

  const emit = (iso) => onChange({ target: { value: iso } })

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <div style={ style?.width === 'auto' ? { position: 'relative', display: 'inline-block' } : { position: 'relative', width: style?.width || '100%' } }>
          <input
            readOnly
            required={required}
            value={formatLong(selectedDate)}
            placeholder={placeholder || 'Pick a date'}
            onClick={() => setOpen(o => !o)}
            style={{ width: '100%', cursor: 'pointer', color: 'var(--text)', ...style, paddingRight: 34 }}
          />
          <button type="button" onClick={() => setOpen(o => !o)} aria-label="Pick a date"
            style={{
              position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
              width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)', fontSize: 14,
            }}>📅</button>
        </div>
      }
    >
      <Calendar
        mode="single"
        selected={selectedDate}
        month={visibleMonth}
        minDate={minDate}
        maxDate={maxDate}
        onMonthChange={setVisibleMonth}
        onSelect={(date) => { emit(toISO(date)); setVisibleMonth(date); setOpen(false) }}
      />
    </Popover>
  )
}
