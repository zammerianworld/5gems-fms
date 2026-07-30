// DateInput — keeps the native <input type="date"> calendar picker fully
// functional (icon, click-to-open, keyboard nav) while displaying the
// value as MM/DD/YYYY regardless of browser/OS locale.
//
// How it works: the real date input sits on top with transparent text/background
// (so its calendar icon still shows and all clicks/typing go to it natively).
// A read-only overlay behind it displays the value pre-formatted as MM/DD/YYYY.

function toDisplay(isoVal) {
  if (!isoVal) return ''
  const [y, m, d] = isoVal.split('-')
  if (!y || !m || !d) return ''
  return `${m}/${d}/${y}`
}

export default function DateInput({ value, onChange, style, max, min, required, placeholder, className }) {
  const display = toDisplay(value)
  const fontSize = style?.fontSize || 14

  return (
    <div style={{ position: 'relative', display: 'block', width: style?.width || '100%' }}>
      {/* Formatted overlay — purely visual, sits behind the native input */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 10,
          paddingRight: 28,
          fontSize,
          color: display ? 'var(--text)' : 'var(--muted)',
          fontFamily: 'inherit',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {display || placeholder || 'MM/DD/YYYY'}
      </div>
      {/* Native date input — fully functional, text hidden so overlay shows through */}
      <input
        type="date"
        value={value || ''}
        onChange={onChange}
        max={max}
        min={min}
        required={required}
        className={className}
        style={{
          ...style,
          width: '100%',
          color: 'transparent',
          background: 'transparent',
          position: 'relative',
        }}
      />
    </div>
  )
}
