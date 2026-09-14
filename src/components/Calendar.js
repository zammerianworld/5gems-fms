// Calendar — a from-scratch month-grid date picker supporting single-date
// and range selection. No external date library; built with plain
// Date math so it drops cleanly into this app's existing stack.
//
// Props:
//   mode: 'single' | 'range'
//   selected: Date (single mode) | { from: Date, to: Date } (range mode)
//   month: Date — which month is currently displayed
//   onMonthChange(date) — called when the user navigates months
//   onSelect(dateOrRange) — called on day click
//   minDate, maxDate — optional Date bounds; out-of-range days are disabled
import { useState } from 'react'

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const sameDay = (a, b) => a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate()
const isToday = (d) => sameDay(d, new Date())
const inRange = (d, from, to) => from && to && d > from && d < to

function buildGrid(monthDate) {
  const year = monthDate.getFullYear(), month = monthDate.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const startOffset = firstOfMonth.getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const cells = []
  for (let i = startOffset - 1; i >= 0; i--) cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), outside: true })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), outside: false })
  while (cells.length % 7 !== 0 || cells.length < 42) cells.push({ date: new Date(year, month + 1, cells.length - startOffset - daysInMonth + 1), outside: true })
  return cells
}

export default function Calendar({ mode = 'single', selected, month, onMonthChange, onSelect, minDate, maxDate }) {
  const [internalMonth, setInternalMonth] = useState(month || new Date())
  const displayMonth = month || internalMonth
  const setMonth = (d) => { setInternalMonth(d); onMonthChange && onMonthChange(d) }
  const [pickerView, setPickerView] = useState('days') // 'days' | 'months' | 'years'

  const from = mode === 'range' ? selected?.from : null
  const to = mode === 'range' ? selected?.to : null
  const cells = buildGrid(displayMonth)

  const handleClick = (date, disabled) => {
    if (disabled) return
    if (mode === 'single') { onSelect && onSelect(date); return }
    if (!from || (from && to)) { onSelect && onSelect({ from: date, to: null }); return }
    if (date < from) { onSelect && onSelect({ from: date, to: from }); return }
    onSelect && onSelect({ from, to: date })
  }

  const jumpYearStart = Math.floor(displayMonth.getFullYear() / 12) * 12

  return (
    <div style={{ padding: 12, width: 280, fontFamily: 'var(--font)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button type="button" onClick={() => {
          if (pickerView === 'days') setMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1))
          else if (pickerView === 'months') setMonth(new Date(displayMonth.getFullYear() - 1, displayMonth.getMonth(), 1))
          else setMonth(new Date(displayMonth.getFullYear() - 12, displayMonth.getMonth(), 1))
        }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--muted)', padding: 4, borderRadius: 6 }}>‹</button>
        <button type="button" onClick={() => setPickerView(v => v === 'days' ? 'months' : v === 'months' ? 'years' : 'days')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--text)', padding: '2px 8px', borderRadius: 6 }}>
          {pickerView === 'days' && `${MONTH_LABELS[displayMonth.getMonth()]} ${displayMonth.getFullYear()}`}
          {pickerView === 'months' && displayMonth.getFullYear()}
          {pickerView === 'years' && `${jumpYearStart} – ${jumpYearStart + 11}`}
        </button>
        <button type="button" onClick={() => {
          if (pickerView === 'days') setMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1))
          else if (pickerView === 'months') setMonth(new Date(displayMonth.getFullYear() + 1, displayMonth.getMonth(), 1))
          else setMonth(new Date(displayMonth.getFullYear() + 12, displayMonth.getMonth(), 1))
        }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--muted)', padding: 4, borderRadius: 6 }}>›</button>
      </div>

      {pickerView === 'years' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {Array.from({ length: 12 }, (_, i) => jumpYearStart + i).map(y => (
            <button key={y} type="button" onClick={() => { setMonth(new Date(y, displayMonth.getMonth(), 1)); setPickerView('months') }}
              style={{
                padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
                background: y === displayMonth.getFullYear() ? 'var(--accent)' : 'transparent',
                color: y === displayMonth.getFullYear() ? '#fff' : 'var(--text)', fontWeight: y === displayMonth.getFullYear() ? 600 : 400,
              }}>{y}</button>
          ))}
        </div>
      )}

      {pickerView === 'months' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {MONTH_LABELS.map((m, i) => (
            <button key={m} type="button" onClick={() => { setMonth(new Date(displayMonth.getFullYear(), i, 1)); setPickerView('days') }}
              style={{
                padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
                background: i === displayMonth.getMonth() ? 'var(--accent)' : 'transparent',
                color: i === displayMonth.getMonth() ? '#fff' : 'var(--text)', fontWeight: i === displayMonth.getMonth() ? 600 : 400,
              }}>{m.slice(0,3)}</button>
          ))}
        </div>
      )}

      {pickerView === 'days' && (<>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
        {DAY_LABELS.map(l => <div key={l} style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', padding: '4px 0' }}>{l}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
        {cells.map((cell, i) => {
          const { date, outside } = cell
          const isSelectedSingle = mode === 'single' && sameDay(date, selected)
          const isStart = mode === 'range' && sameDay(date, from)
          const isEnd = mode === 'range' && sameDay(date, to)
          const isMid = mode === 'range' && inRange(date, from, to)
          const today = isToday(date)
          const disabled = (minDate && date < minDate) || (maxDate && date > maxDate)
          let bg = 'transparent', color = outside ? 'var(--hint)' : 'var(--text)', radius = '50%'
          if (isMid) { bg = 'var(--accent-light)'; radius = '0'; color = 'var(--text)' }
          if (isStart || isEnd) { bg = 'var(--accent)'; color = '#fff'; radius = isStart && isEnd ? '50%' : isStart ? '50% 0 0 50%' : '0 50% 50% 0' }
          if (isSelectedSingle) { bg = 'var(--accent)'; color = '#fff' }
          if (today && !isStart && !isEnd && !isSelectedSingle) { bg = 'var(--bg)' }
          if (disabled) { color = 'var(--hint)'; bg = 'transparent' }
          return (
            <button key={i} type="button" onClick={() => handleClick(date, disabled)} disabled={disabled}
              style={{
                width: '100%', height: 32, border: 'none', cursor: disabled ? 'default' : 'pointer',
                background: bg, color, borderRadius: isMid ? 0 : radius, opacity: disabled ? 0.4 : 1,
                fontSize: 12, fontWeight: (isStart||isEnd||isSelectedSingle) ? 600 : 400,
              }}>{date.getDate()}</button>
          )
        })}
      </div>
      </>)}
    </div>
  )
}
