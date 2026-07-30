import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY. ' +
    'Set both in your environment (.env locally, Vercel Environment Variables in production) — ' +
    'there is intentionally no fallback here so this never silently connects to the wrong project.'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── PAGINATED FETCH ─────────────────────────────────────────────────────────
// PostgREST caps every response at 1000 rows by default. Tables like trips_dump,
// trips_pm, invoices and expenses exceed that, so an unbounded .select() silently
// returns only the first 1000 — producing wrong totals with no error.
//
// This pages through in chunks until the table is exhausted.
//
// Usage — pass a function that builds the query, NOT a query object:
//   const rows = await fetchAllRows(() =>
//     supabase.from('trips_dump').select('*').is('deleted_at', null))
//
// Returns { data, error } to match the shape of a normal Supabase call.
export const fetchAllRows = async (queryBuilder, pageSize = 1000) => {
  let all = []
  let from = 0
  for (;;) {
    const { data, error } = await queryBuilder().range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break   // last page
    from += pageSize
    if (from > 200000) break            // safety valve — don't loop forever
  }
  return { data: all, error: null }
}

export const ROLES = { ADMIN: 'admin', STAFF: 'staff' }

export const DUMP_TRUCK_ROUTES = [
  'CDO-Davao', 'Davao-CDO',
  'Hustling (within plant)',
  'Lagonglong-Davao', 'Davao-Lagonglong',
  'Legazpi-Darong', 'Darong-Legazpi',
]

export const PM_TRIP_CODES = ['Hustling PSACC', 'Hauling PSACC', 'SMC']
export const ISLAND_ZONES = ['MIN', 'VIS', 'LUZ']
export const ISLAND_DEST_CODES = ['MIN Davao Plant', 'CDO Plant', 'Legazpi Plant', 'Other']
export const CONTAINER_SIZES = ['40ft', '20ft']
export const STATUS_OPTIONS = ['Full', 'Empty']
export const TRANSACTION_TYPES = ['TD', 'TA', 'TC']

export const fmt = (n) =>
  Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Sortable hook for tables
export const sortRows = (rows, key, dir) => {
  if (!key) return rows
  return [...rows].sort((a, b) => {
    let av = a[key], bv = b[key]
    if (av == null) av = ''
    if (bv == null) bv = ''
    // Try numeric comparison first
    const an = parseFloat(String(av).replace(/[^0-9.-]/g, ''))
    const bn = parseFloat(String(bv).replace(/[^0-9.-]/g, ''))
    if (!isNaN(an) && !isNaN(bn)) {
      return dir === 'asc' ? an - bn : bn - an
    }
    // String comparison
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av < bv) return dir === 'asc' ? -1 : 1
    if (av > bv) return dir === 'asc' ? 1 : -1
    return 0
  })
}

export const fmtDate = (d) => {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export const numberToWords = (amount) => {
  if (!amount || isNaN(amount)) return 'ZERO PESOS ONLY'
  // PH check standard: no dashes, centavos as XX/100, ONLY when no centavos
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
    'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  const toWords = (n) => {
    if (n === 0) return ''
    if (n < 20) return ones[n] + ' '
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' '
    if (n < 1000) return ones[Math.floor(n / 100)] + ' HUNDRED ' + toWords(n % 100)
    if (n < 1000000) return toWords(Math.floor(n / 1000)) + 'THOUSAND ' + toWords(n % 1000)
    if (n < 1000000000) return toWords(Math.floor(n / 1000000)) + 'MILLION ' + toWords(n % 1000000)
    return toWords(Math.floor(n / 1000000000)) + 'BILLION ' + toWords(n % 1000000000)
  }
  const num = Math.abs(parseFloat(amount))
  const pesos = Math.floor(num)
  const centavos = Math.round((num - pesos) * 100)
  const pesoWords = toWords(pesos).trim()
  if (centavos > 0) {
    // e.g. SIXTY FOUR THOUSAND THREE HUNDRED TWENTY SIX PESOS AND 09/100
    const cStr = String(centavos).padStart(2, '0')
    return `${pesoWords} PESOS AND ${cStr}/100`
  } else {
    // e.g. FORTY FIVE THOUSAND THREE HUNDRED TWENTY PESOS ONLY
    return `${pesoWords} PESOS ONLY`
  }
}

// ── AUDIT TRAIL HELPER ────────────────────────────────────────────────────
export const logAudit = async (tab, action, module, description, recordId = '', userId = null, userName = '') => {
  try {
    const { data: settings } = await supabase.from('company_settings').select('audit_enabled').eq('id', 1).maybeSingle()
    if (!settings?.audit_enabled) return
    // Use provided userId/userName directly — never call getUser() to avoid auth state disruption
    await supabase.from('audit_logs').insert({
      tab, action, module, description,
      record_id: String(recordId || ''),
      performed_by: userId || null,
      performed_by_name: userName || '',
    })
  } catch (e) {
    console.warn('Audit log failed:', e.message)
  }
}

export const calcQtyDest = (weightTons) => {
  const w = parseFloat(weightTons) || 0
  return w === 0 ? 0 : Math.trunc((w / 50) * 1000)
}
