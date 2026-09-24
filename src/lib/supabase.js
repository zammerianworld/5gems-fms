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

// ── Trip codes: built-in + configurable (Settings → Trip Codes) ────────────
// The 3 built-in codes above keep their hardcoded behavior everywhere. Extra
// codes live in the `trip_codes` table (item 6 migration) and are cached here
// once per session (loaded by ProtectedRoute before any page renders), so
// every page — including plain calculation functions — can read them
// synchronously.
//
// VAT rule: built-in codes are FIXED here in code (SMC = VAT-inclusive,
// everything else built-in = VAT-exclusive), regardless of what the table
// says, so no database edit can ever change existing SMC/PSACC math. Only
// non-built-in codes read `vat_inclusive` from the table. If the table
// can't load, the cache is empty and behavior is exactly the old
// `trip_code === 'SMC'` rule.
let tripCodeCache = []
let tripCodesPromise = null
let tripCodesLoaded = false
const isBuiltinCode = (code) => PM_TRIP_CODES.includes(code)
export const setTripCodeCache = (rows) => { tripCodeCache = Array.isArray(rows) ? rows : [] }
export const areTripCodesLoaded = () => tripCodesLoaded
// Config rows for non-built-in codes only (built-in rows are just markers).
// Also skip rows flagged is_builtin, so a seeded built-in this app doesn't
// have (5 Gems has no Side Trip) can never show up as a configurable code.
export const getCustomPmCodeDefs = () => tripCodeCache.filter(c => !c.is_builtin && !isBuiltinCode(c.code))
export const getCustomPmCodeDef = (code) => (isBuiltinCode(code) ? null : tripCodeCache.find(c => c.code === code && !c.is_builtin) || null)
// All codes that may appear on existing trips (for reports / SOA / filters).
export const getAllPmCodes = () => [...PM_TRIP_CODES, ...getCustomPmCodeDefs().map(c => c.code)]
// Codes offered when entering a new trip (inactive custom codes hidden).
export const getActivePmCodes = () => [...PM_TRIP_CODES, ...getCustomPmCodeDefs().filter(c => c.active !== false).map(c => c.code)]
// THE single VAT rule for PM trips. Replaces every `trip_code === 'SMC'` VAT check.
export const isVatInclusiveCode = (code) => code === 'SMC' || !!getCustomPmCodeDef(code)?.vat_inclusive
// Net-of-VAT sales for one PM trip (supplier amount + stripping fee).
export const pmTripNet = (t) => {
  const raw = (t.supplier_amount || 0) + (t.stripping_fee || 0)
  return isVatInclusiveCode(t.trip_code) ? raw / 1.12 : raw
}
// Standard inputs a configured trip code can switch on. These are real
// trips_pm columns ('trip' level) or keys inside each container object
// ('container' level) — the same storage the built-in codes already use, so
// search, SOA and duplicate checks understand them without special-casing.
// A configured code's `fields` list mixes these with its own custom inputs:
//   { kind: 'std', key: 'waybill_no', required, show_on_soa }
//   { kind: 'custom', key: 'f_ab12', label, type, options, required, show_on_soa }
export const PM_STD_FIELDS = [
  { key: 'waybill_no', label: 'Waybill No.', level: 'trip', type: 'text' },
  { key: 'vessel', label: 'Vessel', level: 'trip', type: 'text' },
  { key: 'voyage', label: 'Voyage', level: 'trip', type: 'text' },
  { key: 'consignee', label: 'Consignee', level: 'trip', type: 'text' },
  { key: 'consignee_address', label: 'Delivery Address', level: 'trip', type: 'text' },
  { key: 'shipper_address', label: 'Shipper Address', level: 'trip', type: 'text' },
  { key: 'port_origin', label: 'Port of Origin', level: 'trip', type: 'text' },
  { key: 'port_destination', label: 'Port of Destination', level: 'trip', type: 'text' },
  { key: 'emr_date', label: 'EMR Date', level: 'trip', type: 'date' },
  { key: 'date_completion', label: 'Date of Completion', level: 'trip', type: 'date' },
  { key: 'van_no', label: 'Van No.', level: 'container', type: 'text' },
  { key: 'seal_no', label: 'Seal No.', level: 'container', type: 'text' },
  { key: 'commodity', label: 'Commodity', level: 'container', type: 'text' },
  { key: 'bl_no', label: 'BL No.', level: 'container', type: 'text' },
  { key: 'emr_no', label: 'EMR No.', level: 'container', type: 'text' },
  { key: 'cts_no', label: 'CTS No.', level: 'container', type: 'text' },
  { key: 'from_to', label: 'From–To', level: 'container', type: 'text' },
  { key: 'stripping_fee', label: 'Stripping Fee', level: 'container', type: 'money' },
]
export const getStdField = (key) => PM_STD_FIELDS.find(f => f.key === key) || null
// Resolves a configured code's inputs into display-ready descriptors:
// { key, label, type, options, level ('trip' | 'container'), kind, required, show_on_soa }
// Custom inputs are always trip-level and stored in trips_pm.custom_data.
export const resolveCodeFields = (def) => (def?.fields || []).map(f => {
  if (f.kind === 'std') {
    const s = getStdField(f.key)
    return s ? { ...s, kind: 'std', required: !!f.required, show_on_soa: !!f.show_on_soa } : null
  }
  return { key: f.key, label: f.label, type: f.type || 'text', options: f.options || [], level: 'trip', kind: 'custom', required: !!f.required, show_on_soa: !!f.show_on_soa }
}).filter(Boolean)
// Reads a resolved field's value from a trip (or one of its containers).
export const codeFieldValue = (field, trip, container) => {
  if (field.kind === 'custom') return trip?.custom_data?.[field.key]
  return field.level === 'container' ? container?.[field.key] : trip?.[field.key]
}

export async function reloadTripCodes() {
  const { data, error } = await supabase.from('trip_codes').select('*').order('code')
  if (!error && data) setTripCodeCache(data)
  tripCodesLoaded = true
  return !error
}
export function ensureTripCodesLoaded() {
  if (!tripCodesPromise) tripCodesPromise = reloadTripCodes().catch(() => { tripCodesLoaded = true; return false })
  return tripCodesPromise
}
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
