import { useState, useEffect, useCallback } from 'react'
import DateInput from '../components/DateInput'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase, DUMP_TRUCK_ROUTES, PM_TRIP_CODES, ISLAND_ZONES,
  CONTAINER_SIZES, fmt, fmtDate, calcQtyDest, logAudit, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

const EMPTY_DUMP = {
  trip_date: new Date().toISOString().slice(0, 10),
  truck_plate: '', route: '', client: 'SMC', commodity: '',
  smcsl_wb: '', supplier_doc_ref: '',
  island_zone_origin: 'MIN', island_origin_code: '',
  island_zone_dest: 'MIN', island_dest_code: '',
  weight_tons: '', rmsd_smfi_saf_dr: '', sto_no: '',
  rate_per_ton: '', remarks: '',
}

// Container defaults per trip code
const makeContainer = (tripCode) => {
  if (tripCode === 'Hustling PSACC') return { van_no: '', cts_no: '', voyage: '', from_to: '', van_status: 'Full', supplier_amount: '' }
  if (tripCode === 'Hauling PSACC') return { van_no: '', emr_no: '', bl_no: '', supplier_amount: '' }
  if (tripCode === 'SMC') return { van_no: '', seal_no: '', con_van_no: '', commodity: '', supplier_amount: '', stripping_fee: '' }
  return { van_no: '', supplier_amount: '' }
}

const EMPTY_PM = {
  trip_date: new Date().toISOString().slice(0, 10),
  truck_plate: '', trip_code: '', client: '', container_size: '40ft',
  num_20ft: 1,
  // Shared — Hustling PSACC
  waybill_no: '', vessel: '',
  // Shared — Hauling PSACC (adds:)
  voyage: '', emr_date: '', date_completion: '', consignee: '',
  // Shared — SMC (adds:)
  smcsl_waybill_no: '', supplier_doc: '', transaction_type: 'TD',
  port_origin: '', port_destination: '', shipper_address: '',
  consignee_address: '',
  // Amounts now stored per container
  // Per-container array — 1 for 40ft, 2 for 20ft
  containers: [],
  remarks: '',
}

const today = () => new Date().toISOString().slice(0, 10)

// Shows a trip's billing state: not invoiced → invoiced (unpaid) → paid.
// `inv` is the full invoice record from invoiceInfo, or undefined if not invoiced.
function InvoiceBadge({ inv, onClick }) {
  if (!inv) return null
  const paid = inv.status === 'Paid'
  const label = paid ? '💰 Paid' : '📄 Invoiced'
  const cls = paid ? 'badge-success' : 'badge-warning'
  const title = paid && inv.date_credited
    ? `Invoice ${inv.invoice_no} — paid ${inv.date_credited}`
    : `Invoice ${inv.invoice_no} — ${inv.status || 'Invoiced'}, not yet paid`
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} title={title}>
      <span className={`badge ${cls}`} style={{ fontSize: 10 }}>
        {label} ({inv.invoice_no}) →
      </span>
    </button>
  )
}
function SF({ label, value, onChange, req, type = 'text', placeholder }) {
  return (
    <div className="form-group">
      <label className={`label ${req ? 'required' : ''}`}>{label}</label>
      {type === 'date'
        ? <DateInput value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'MM/DD/YYYY'} />
        : <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} />
      }
    </div>
  )
}
function SS({ label, value, onChange, req, options, placeholder }) {
  return (
    <div className="form-group">
      <label className={`label ${req ? 'required' : ''}`}>{label}</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder || `Select ${label}`}</option>
        {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
      </select>
    </div>
  )
}
function DL({ label, value, onChange, req, list, listId, placeholder, type = 'text' }) {
  return (
    <div className="form-group">
      <label className={`label ${req ? 'required' : ''}`}>{label}</label>
      <input list={listId} type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} />
      <datalist id={listId}>{list.map((v, i) => <option key={i} value={v} />)}</datalist>
    </div>
  )
}

export default function Trips() {
  const { profile } = useAuth()
  const { toast, showToast } = useToast()
  const navigate = useNavigate()

  const [truckType, setTruckType] = useState(null)
  const [step, setStep] = useState('type')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)

  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [trucks, setTrucks] = useState([])
  const [clients, setClients] = useState([])
  const [commodities, setCommodities] = useState([])
  // savedRates state removed — rates now derived live from trip history
  const [savedOriginCodes, setSavedOriginCodes] = useState([])
  const [savedDestCodes, setSavedDestCodes] = useState([])

  const [dumpForm, setDumpForm] = useState(EMPTY_DUMP)
  const [pmForm, setPmForm] = useState(EMPTY_PM)

  const [activeTab, setActiveTab] = useState('Dump Truck')
  const now = new Date()
  const [summaryMonth, setSummaryMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`)
  const [summaryTruck, setSummaryTruck] = useState('')
  const [filterRoute, setFilterRoute] = useState('')
  const [savedRoutes, setSavedRoutes] = useState([])
  const [filterCommodity, setFilterCommodity] = useState('')
  const [filterTruck, setFilterTruck] = useState('')
  const [filterPayStatus, setFilterPayStatus] = useState('') // '' | 'unbilled' | 'invoiced' | 'paid'
  const [filterPMCode, setFilterPMCode] = useState('')
  const [filterPMClient, setFilterPMClient] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [invoiceMap, setInvoiceMap] = useState({})
  const [invoiceInfo, setInvoiceInfo] = useState({})
  const [overrideModal, setOverrideModal] = useState(null) // { trip, type }
  const [overridePin, setOverridePin] = useState('')
  const [overridePinError, setOverridePinError] = useState('')
  const [overridePinChecking, setOverridePinChecking] = useState(false)
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0,7)) // default current month
  const [saving, setSaving] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const [afterSaveModal, setAfterSaveModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [templates, setTemplates] = useState([])
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [importData, setImportData] = useState([])
  const [importing, setImporting] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [dt, pt, tr, cl, co, inv, rts] = await Promise.all([
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      supabase.from('trucks').select('*').order('truck_type').order('plate'),
      supabase.from('clients').select('*').order('nickname'),
      supabase.from('commodities').select('name,for_type').order('name'),
      fetchAllRows(() => supabase.from('invoices').select('id,invoice_no,status,date_credited').is('deleted_at', null)),
      supabase.from('saved_routes').select('label').order('label'),
    ])
    if (dt.data) {
      setDumpTrips(dt.data)
      setSavedOriginCodes([...new Set(dt.data.map(t => t.island_origin_code).filter(Boolean))].sort())
      setSavedDestCodes([...new Set(dt.data.map(t => t.island_dest_code).filter(Boolean))].sort())
    }
    if (pt.data) setPmTrips(pt.data)
    if (tr.data) setTrucks(tr.data)

    if (cl.data) setClients(cl.data)
    if (co.data) setCommodities(co.data)
    // savedRates removed — rates now derived from trip history
    if (rts.data) setSavedRoutes(rts.data.map(r => r.label))
    if (inv.data) {
      setInvoiceMap(Object.fromEntries(inv.data.map(i => [i.id, i.invoice_no])))
      setInvoiceInfo(Object.fromEntries(inv.data.map(i => [i.id, i])))
    }
    setLoading(false)
  }, [])

  const location = useLocation()
  useEffect(() => {
    fetchAll().then(() => {
      if (location.state?.activeTab) setActiveTab(location.state.activeTab)
      if (location.state?.search) setSearch(location.state.search)
      if (location.state?.activeTab || location.state?.search) window.history.replaceState({}, document.title)
    })
  }, [fetchAll])

  const trucksOfType = (type) => trucks.filter(t => t.truck_type === type && t.active !== false)
  const isSubconTruck = (plate) => trucks.find(t => t.plate === plate)?.ownership === 'subcon'
  // saveRate removed — rates derived from trip history instead
  const saveIslandCodes = (origin, dest) => {
    if (origin && !savedOriginCodes.includes(origin)) setSavedOriginCodes(p => [...p, origin].sort())
    if (dest && !savedDestCodes.includes(dest)) setSavedDestCodes(p => [...p, dest].sort())
  }

  // When trip code or container size changes, rebuild containers array
  const rebuildContainers = (tripCode, containerSize, existing = [], explicitCount = null) => {
    const count = explicitCount !== null ? explicitCount : (containerSize === '20ft' ? (pmForm.num_20ft || 1) : 1)
    return Array.from({ length: count }, (_, i) => ({
      ...makeContainer(tripCode),
      ...(existing[i] || {}),
    }))
  }

  const handleSelectType = (type) => {
    setTruckType(type)
    if (type === 'Dump Truck') setDumpForm({ ...EMPTY_DUMP, trip_date: today() })
    else setPmForm({ ...EMPTY_PM, trip_date: today(), containers: [] })
    setEditId(null); setStep('form'); setShowForm(true)
  }

  const PM_CLIENT_MAP = {
    'Hustling PSACC': 'PSACC',
    'Hauling PSACC': 'PSACC',
    'SMC': 'SMC',
  }

  const handlePMTripCodeChange = (code) => {
    const count = pmForm.container_size === '20ft' ? (pmForm.num_20ft || 1) : 1
    const containers = rebuildContainers(code, pmForm.container_size, [], count)
    const autoClient = PM_CLIENT_MAP[code] || ''
    setPmForm(f => ({ ...f, trip_code: code, containers, client: autoClient || f.client }))
  }

  const handlePMContainerSizeChange = (size) => {
    const count = size === '20ft' ? (pmForm.num_20ft || 1) : 1
    const containers = rebuildContainers(pmForm.trip_code, size, pmForm.containers, count)
    setPmForm(f => ({ ...f, container_size: size, containers }))
  }

  const handleNum20ftChange = (num) => {
    const containers = rebuildContainers(pmForm.trip_code, '20ft', pmForm.containers, num)
    setPmForm(f => ({ ...f, num_20ft: num, containers }))
  }

  const updateContainer = (idx, field, value) => {
    setPmForm(f => {
      const c = [...f.containers]
      c[idx] = { ...c[idx], [field]: value }
      return { ...f, containers: c }
    })
  }

  const submitDump = async () => {
    const f = dumpForm
    const req = ['trip_date', 'truck_plate', 'route', 'client', 'commodity', 'weight_tons', 'rate_per_ton']
    if (req.some(k => !f[k])) { showToast('Please fill all required fields.', 'error'); return }
    if (parseFloat(f.rate_per_ton) <= 0) { showToast('Rate per ton must be greater than ₱0.', 'error'); return }
    if (parseFloat(f.weight_tons) <= 0) { showToast('Weight must be greater than 0 tons.', 'error'); return }

    const proceedSaveDump = async () => {
      setSaving(true)
      const payload = { ...f, weight_tons: parseFloat(f.weight_tons) || 0, rate_per_ton: parseFloat(f.rate_per_ton) || 0, created_by: profile?.id }
      let error
      if (editId) ({ error } = await supabase.from('trips_dump').update(payload).eq('id', editId))
      else ({ error } = await supabase.from('trips_dump').insert(payload))
      if (error) { showToast('Error: ' + error.message, 'error'); setSaving(false); return }
      // If editing an invoiced trip, recalc invoice total
      if (editId) {
        const origTrip = dumpTrips.find(t => t.id === editId)
        if (origTrip?.invoice_id) {
          const { data: invTrips } = await supabase.from('trips_dump').select('weight_tons,rate_per_ton').is('deleted_at', null).eq('invoice_id', origTrip.invoice_id)
          if (invTrips) {
            const newNet = invTrips.reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0)
            await supabase.from('invoices').update({ total_sales_net: newNet }).eq('id', origTrip.invoice_id)
          }
        }
      }
      saveIslandCodes(f.island_origin_code, f.island_dest_code)
      logAudit(editId ? 'destructive' : 'generate', editId ? 'Edited' : 'Created', 'Trip',
        `Dump · ${f.truck_plate} · ${f.client} · ${f.route} · ${f.weight_tons}t · ${f.trip_date}`,
        editId || '', profile?.id, profile?.full_name)
      showToast(editId ? 'Trip updated.' : 'Trip saved.')
      resetForm(); fetchAll(); setSaving(false)
    }

    // Duplicate detection — SMCSL WB and Supplier Doc Ref (new and edit)
    if (f.smcsl_wb) {
      let q = supabase.from('trips_dump').select('id,trip_date,truck_plate').is('deleted_at', null).eq('smcsl_wb', f.smcsl_wb.trim())
      if (editId) q = q.neq('id', editId)
      const { data: wbDup } = await q.limit(1)
      if (wbDup?.length) {
        const d = wbDup[0]
        setConfirmState({
          title: 'Possible Duplicate',
          variant: 'warning',
          confirmLabel: 'Save Anyway',
          message: `SMCSL WB "${f.smcsl_wb}" already exists on record:\n\nPlate: ${d.truck_plate}\nDate: ${d.trip_date}\n\nThis may be hidden by your current filters (try clearing month/truck filter to find it).`,
          onConfirm: () => checkDumpDocRef(f, editId, proceedSaveDump),
        })
        return
      }
    }
    checkDumpDocRef(f, editId, proceedSaveDump)
  }

  const checkDumpDocRef = async (f, editId, proceedSaveDump) => {
    if (f.supplier_doc_ref) {
      let q = supabase.from('trips_dump').select('id,trip_date,truck_plate').is('deleted_at', null).eq('supplier_doc_ref', f.supplier_doc_ref.trim())
      if (editId) q = q.neq('id', editId)
      const { data: drDup } = await q.limit(1)
      if (drDup?.length) {
        const d = drDup[0]
        setConfirmState({
          title: 'Possible Duplicate',
          variant: 'warning',
          confirmLabel: 'Save Anyway',
          message: `Supplier Doc Ref "${f.supplier_doc_ref}" already exists on record:\n\nPlate: ${d.truck_plate}\nDate: ${d.trip_date}\n\nThis may be hidden by your current filters (try clearing month/truck filter to find it).`,
          onConfirm: proceedSaveDump,
        })
        return
      }
    }
    proceedSaveDump()
  }

  const submitPM = async () => {
    const f = pmForm
    if (!f.trip_date || !f.truck_plate || !f.trip_code || !f.client) {
      showToast('Please fill all required fields including client.', 'error'); return
    }
    const hasAmounts = (f.containers || []).every(c => parseFloat(c.supplier_amount) > 0)
    if (!hasAmounts) { showToast('All containers must have a supplier amount greater than ₱0.', 'error'); return }

    const proceedSavePM = async () => {
      setSaving(true)
      const payload = {
        ...f,
        supplier_amount: (f.containers || []).reduce((s, c) => s + (parseFloat(c.supplier_amount) || 0), 0),
        stripping_fee: (f.containers || []).reduce((s, c) => s + (parseFloat(c.stripping_fee) || 0), 0),
        emr_date: f.emr_date || null,
        date_completion: f.date_completion || null,
        created_by: profile?.id,
      }
      let error
      if (editId) ({ error } = await supabase.from('trips_pm').update(payload).eq('id', editId))
      else ({ error } = await supabase.from('trips_pm').insert(payload))
      if (error) { showToast('Error: ' + error.message, 'error'); setSaving(false); return }
      // If editing an invoiced PM trip, recalc invoice total
      if (editId) {
        const origTrip = pmTrips.find(t => t.id === editId)
        if (origTrip?.invoice_id) {
          const { data: invTrips } = await supabase.from('trips_pm').select('supplier_amount,stripping_fee,trip_code').is('deleted_at', null).eq('invoice_id', origTrip.invoice_id)
          if (invTrips) {
            const rawNet = invTrips.reduce((s,t) => s+(parseFloat(t.supplier_amount)||0)+(parseFloat(t.stripping_fee)||0), 0)
            const newNet = invTrips.length > 0 && invTrips.every(t => t.trip_code === 'SMC') ? rawNet / 1.12 : rawNet
            await supabase.from('invoices').update({ total_sales_net: newNet }).eq('id', origTrip.invoice_id)
          }
        }
      }
      logAudit(editId ? 'destructive' : 'generate', editId ? 'Edited' : 'Created', 'Trip',
        `PM · ${f.trip_code} · ${f.truck_plate} · ${f.client} · ${f.container_size} · ${f.trip_date}`,
        editId || '', profile?.id, profile?.full_name)
      showToast(editId ? 'Trip updated.' : 'Trip saved.')
      resetForm(); fetchAll(); setSaving(false)
    }

    const isSMC = f.trip_code === 'SMC'
    const isPSACC = ['Hustling PSACC','Hauling PSACC'].includes(f.trip_code)

    const checkWaybill = async () => {
      if (isPSACC && f.waybill_no) {
        let q = supabase.from('trips_pm').select('id,trip_date,truck_plate').is('deleted_at', null).eq('waybill_no', f.waybill_no.trim())
        if (editId) q = q.neq('id', editId)
        const { data: wbDup } = await q.limit(1)
        if (wbDup?.length) {
          const d = wbDup[0]
          setConfirmState({
            title: 'Possible Duplicate', variant: 'warning', confirmLabel: 'Save Anyway',
            message: `Waybill No. "${f.waybill_no}" already exists on record:\n\nPlate: ${d.truck_plate}\nDate: ${d.trip_date}\n\nThis may be hidden by your current filters.`,
            onConfirm: proceedSavePM,
          })
          return
        }
      }
      proceedSavePM()
    }

    const checkSupplierDoc = async () => {
      if (isSMC && f.supplier_doc) {
        let q = supabase.from('trips_pm').select('id,trip_date,truck_plate').is('deleted_at', null).eq('supplier_doc', f.supplier_doc.trim())
        if (editId) q = q.neq('id', editId)
        const { data: drDup } = await q.limit(1)
        if (drDup?.length) {
          const d = drDup[0]
          setConfirmState({
            title: 'Possible Duplicate', variant: 'warning', confirmLabel: 'Save Anyway',
            message: `Supplier Doc "${f.supplier_doc}" already exists on record:\n\nPlate: ${d.truck_plate}\nDate: ${d.trip_date}\n\nThis may be hidden by your current filters.`,
            onConfirm: checkWaybill,
          })
          return
        }
      }
      checkWaybill()
    }

    if (isSMC && f.smcsl_waybill_no) {
      let q = supabase.from('trips_pm').select('id,trip_date,truck_plate').is('deleted_at', null).eq('smcsl_waybill_no', f.smcsl_waybill_no.trim())
      if (editId) q = q.neq('id', editId)
      const { data: wbDup } = await q.limit(1)
      if (wbDup?.length) {
        const d = wbDup[0]
        setConfirmState({
          title: 'Possible Duplicate', variant: 'warning', confirmLabel: 'Save Anyway',
          message: `SMCSL WB "${f.smcsl_waybill_no}" already exists on record:\n\nPlate: ${d.truck_plate}\nDate: ${d.trip_date}\n\nThis may be hidden by your current filters.`,
          onConfirm: checkSupplierDoc,
        })
        return
      }
    }
    checkSupplierDoc()
  }

  const resetForm = () => {
    setShowForm(false); setStep('type'); setTruckType(null); setEditId(null)
    setDumpForm({ ...EMPTY_DUMP, trip_date: today() })
    setPmForm({ ...EMPTY_PM, trip_date: today(), containers: [] })
  }

  const handleEditDump = (t) => {
    // Ensure the trip's own codes are in the datalist options
    if (t.island_origin_code && !savedOriginCodes.includes(t.island_origin_code))
      setSavedOriginCodes(p => [...p, t.island_origin_code].sort())
    if (t.island_dest_code && !savedDestCodes.includes(t.island_dest_code))
      setSavedDestCodes(p => [...p, t.island_dest_code].sort())
    setDumpForm({
      ...t,
      weight_tons: String(t.weight_tons || ''),
      rate_per_ton: String(t.rate_per_ton || ''),
      island_zone_origin: t.island_zone_origin || 'MIN',
      island_zone_dest: t.island_zone_dest || 'MIN',
      island_origin_code: t.island_origin_code || '',
      island_dest_code: t.island_dest_code || '',
    })
    setEditId(t.id); setTruckType('Dump Truck'); setStep('form'); setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleEditPM = (t) => {
    const numVans = t.num_20ft || (t.containers?.length >= 2 && t.container_size === '20ft' ? 2 : 1)
    setPmForm({
      ...t,
      supplier_amount: String(t.supplier_amount || ''),
      stripping_fee: String(t.stripping_fee || ''),
      emr_date: t.emr_date || '',
      date_completion: t.date_completion || '',
      num_20ft: numVans,
      containers: t.containers?.length ? t.containers : rebuildContainers(t.trip_code, t.container_size, [], numVans),
    })
    setEditId(t.id); setTruckType('Prime Mover'); setStep('form'); setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const saveTemplate = () => {
    if (!templateName.trim()) return
    const f = truckType === 'Dump Truck' ? dumpForm : pmForm
    const tmpl = { id: Date.now(), name: templateName.trim(), type: truckType, data: f }
    const updated = [...templates, tmpl]
    setTemplates(updated)
    localStorage.setItem('ds_trip_templates', JSON.stringify(updated))
    setTemplateName('')
    setShowTemplateModal(false)
    showToast(`Template "${tmpl.name}" saved.`)
  }

  const loadTemplate = (tmpl) => {
    if (tmpl.type === 'Dump Truck') setDumpForm(f => ({ ...f, ...tmpl.data, trip_date: today() }))
    else setPmForm(f => ({ ...f, ...tmpl.data, trip_date: today() }))
    showToast(`Template "${tmpl.name}" loaded.`)
  }

  const deleteTemplate = (id) => {
    const updated = templates.filter(t => t.id !== id)
    setTemplates(updated)
    localStorage.setItem('ds_trip_templates', JSON.stringify(updated))
    showToast('Template deleted.', 'info')
  }

  const handleDelete = async () => {
    const tbl = deleteTarget.type === 'dump' ? 'trips_dump' : 'trips_pm'
    const tripsList = deleteTarget.type === 'dump' ? dumpTrips : pmTrips
    const delT = tripsList.find(t => t.id === deleteTarget.id)
    const { error } = await supabase.from(tbl).update({ deleted_at: new Date().toISOString() }).eq('id', deleteTarget.id)
    if (error) showToast('Error deleting.', 'error')
    else {
      logAudit('destructive', 'Deleted', 'Trip',
        deleteTarget.type === 'dump'
          ? `Dump · ${delT?.truck_plate} · ${delT?.client} · ${delT?.trip_date}`
          : `PM · ${delT?.trip_code} · ${delT?.truck_plate} · ${delT?.trip_date}`,
        deleteTarget.id, profile?.id, profile?.full_name)
      showToast('Trip moved to trash.', 'info'); fetchAll()
    }
    setDeleteTarget(null)
  }

  // Payment-state matcher — '' = all, unbilled = no invoice, invoiced = billed but unpaid, paid = collected
  const matchPayStatus = (t) => {
    if (!filterPayStatus) return true
    const inv = invoiceInfo[t.invoice_id]
    if (filterPayStatus === 'unbilled') return !t.invoice_id
    if (filterPayStatus === 'paid') return inv?.status === 'Paid'
    if (filterPayStatus === 'invoiced') return !!t.invoice_id && inv?.status !== 'Paid'
    return true
  }
  const filteredDump = dumpTrips.filter(t =>
    matchPayStatus(t) &&
    (!filterRoute || t.route === filterRoute) &&
    (!filterCommodity || t.commodity === filterCommodity) &&
    (!filterTruck || t.truck_plate === filterTruck) &&
    (!filterMonth || t.trip_date?.startsWith(filterMonth)) &&
    (!search || [t.client, t.truck_plate, t.route, t.commodity, t.smcsl_wb].some(v => v?.toLowerCase().includes(search.toLowerCase())))
  )
  const filteredPM = pmTrips.filter(t =>
    matchPayStatus(t) &&
    (!filterTruck || t.truck_plate === filterTruck) &&
    (!filterMonth || t.trip_date?.startsWith(filterMonth)) &&
    (!filterPMCode || t.trip_code === filterPMCode) &&
    (!filterPMClient || t.client === filterPMClient) &&
    (!search || [t.truck_plate, t.trip_code, t.vessel, t.waybill_no, t.client].some(v => v?.toLowerCase().includes(search.toLowerCase())))
  )

  // Duplicate detection sets for badges
  const wbCounts = {}; filteredDump.forEach(t => { if (t.smcsl_wb) wbCounts[t.smcsl_wb] = (wbCounts[t.smcsl_wb]||0)+1 })
  const dupDumpWBs = new Set(Object.keys(wbCounts).filter(k => wbCounts[k] > 1))
  const dumpTotal = filteredDump.reduce((s, t) => s + ((t.weight_tons || 0) * (t.rate_per_ton || 0)), 0)
  const pmTotal = filteredPM.reduce((s, t) => s + ((t.supplier_amount || 0) + (t.stripping_fee || 0)), 0)
  // Rates derived from actual trip history — most-used first, no stale typo rates
  // Available months from all trips for the month filter dropdown
  const allTripMonths = [...new Set([
    ...dumpTrips.map(t => t.trip_date?.slice(0,7)),
    ...pmTrips.map(t => t.trip_date?.slice(0,7)),
  ].filter(Boolean))].sort().reverse()

  const dumpRateCounts = {}
  dumpTrips.forEach(t => { const r = t.rate_per_ton; if (r && r > 0) dumpRateCounts[r] = (dumpRateCounts[r]||0)+1 })
  const dumpRates = Object.keys(dumpRateCounts).sort((a,b) => dumpRateCounts[b]-dumpRateCounts[a])

  const pmRateCounts = {}
  pmTrips.forEach(t => { const r = t.supplier_amount; if (r && r > 0) pmRateCounts[r] = (pmRateCounts[r]||0)+1 })
  const pmRates = Object.keys(pmRateCounts).sort((a,b) => pmRateCounts[b]-pmRateCounts[a])
  const dumpTrucks = trucksOfType('Dump Truck')
  const pmTrucks = trucksOfType('Prime Mover')

  // Container fields per trip code
  const renderContainerFields = (idx) => {
    const c = pmForm.containers[idx] || {}
    const code = pmForm.trip_code
    const label = pmForm.container_size === '20ft' ? `Container #${idx + 1} — 20ft` : `Container — ${pmForm.container_size}`
    return (
      <div key={idx} style={{ background: 'var(--bg)', borderRadius: 8, padding: '14px', marginBottom: 10, border: '0.5px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 10 }}>{label}</div>
        <div className="form-grid" style={code === 'SMC' ? { gridTemplateColumns: 'repeat(3, 1fr)' } : {}}>
          <div className="form-group">
            <label className="label">{code === 'SMC' ? 'Con Van No.' : 'Van No.'}</label>
            <input value={c.van_no || ''} onChange={e => updateContainer(idx, 'van_no', e.target.value)} placeholder={code === 'SMC' ? 'Container Van No.' : 'Van number'} />
          </div>
          {code === 'Hustling PSACC' && <>
            <div className="form-group">
              <label className="label">CTS No.</label>
              <input value={c.cts_no || ''} onChange={e => updateContainer(idx, 'cts_no', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">Voyage</label>
              <input value={c.voyage || ''} onChange={e => updateContainer(idx, 'voyage', e.target.value)} placeholder="Voyage no." />
            </div>
            <div className="form-group">
              <label className="label">From — To</label>
              <input value={c.from_to || ''} onChange={e => updateContainer(idx, 'from_to', e.target.value)} placeholder="e.g. Cebu — Davao" />
            </div>
            <div className="form-group">
              <label className="label">Status</label>
              <select value={c.van_status || 'Full'} onChange={e => updateContainer(idx, 'van_status', e.target.value)}>
                <option value="Full">Full</option>
                <option value="Empty">Empty</option>
              </select>
            </div>
          </>}
          {code === 'Hauling PSACC' && <>
            <div className="form-group">
              <label className="label">EMR No.</label>
              <input value={c.emr_no || ''} onChange={e => updateContainer(idx, 'emr_no', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">BL No.</label>
              <input value={c.bl_no || ''} onChange={e => updateContainer(idx, 'bl_no', e.target.value)} />
            </div>
          </>}
          {code === 'SMC' && <>
            <div className="form-group">
              <label className="label">Seal No.</label>
              <input value={c.seal_no || ''} onChange={e => updateContainer(idx, 'seal_no', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">Commodity</label>
              <select value={c.commodity || ''} onChange={e => updateContainer(idx, 'commodity', e.target.value)}>
                <option value="">Select commodity</option>
                {commodities.filter(c => (c.for_type||'dump') === 'pm').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <input placeholder="Add new + Enter…" style={{ marginTop: 4, fontSize: 11, padding: '3px 8px', width: '100%' }}
                onInput={e => { e.target.value = e.target.value.toUpperCase() }}
                onKeyDown={async e => {
                  if (e.key !== 'Enter') return
                  const name = e.target.value.trim().toUpperCase()
                  if (!name) return
                  const { error } = await supabase.from('commodities').insert({ name, for_type: 'pm' })
                  if (!error) {
                    setCommodities(prev => [...prev, { name, for_type: 'pm' }].sort((a,b)=>a.name.localeCompare(b.name)))
                    updateContainer(idx, 'commodity', name)
                    e.target.value = ''
                    showToast(`"${name}" added to commodities.`)
                  } else showToast('Error adding commodity: ' + (error.message||''), 'error')
                }} />
            </div>
          </>}
        </div>
        {/* Per-container amounts — separate row */}
        <div className="form-grid" style={{ marginTop: 10 }}>
          <div className="form-group">
            <label className="label required">
              Supplier Amount (₱)
              {code === 'SMC' && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(241,114,0,0.12)', color: 'var(--accent)', padding: '1px 5px', borderRadius: 4, fontWeight: 400 }}>VAT Inclusive (SMC)</span>}
            </label>
            <input type="number" step="0.01" value={c.supplier_amount || ''} onChange={e => updateContainer(idx, 'supplier_amount', e.target.value)} placeholder="0.00" />
            {code === 'SMC' && c.supplier_amount > 0 && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                VATABLE: ₱{((parseFloat(c.supplier_amount)||0)/1.12).toLocaleString('en-PH',{minimumFractionDigits:2})} · VAT 12%: ₱{((parseFloat(c.supplier_amount)||0)/1.12*0.12).toLocaleString('en-PH',{minimumFractionDigits:2})}
              </div>
            )}
          </div>
          {code === 'SMC' && (
            <div className="form-group">
              <label className="label">Stripping Fee (₱)</label>
              <input type="number" step="0.01" value={c.stripping_fee || ''} onChange={e => updateContainer(idx, 'stripping_fee', e.target.value)} placeholder="0.00" />
            </div>
          )}
          {/* Container total */}
          <div style={{ background: 'var(--accent-light)', borderRadius: 8, padding: '10px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignSelf: 'end' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>Container Total</div>
            <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
              ₱{fmt((parseFloat(c.supplier_amount) || 0) + (parseFloat(c.stripping_fee) || 0))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handleOverridePinCheck = async () => {
    if (!overridePin) { setOverridePinError('Enter your override PIN.'); return }
    setOverridePinChecking(true)
    // Check against all admin profiles
    const { data: match, error: pinErr } = await supabase.rpc('verify_override_pin', { p_pin: overridePin.toUpperCase() })
    if (pinErr || !match) {
      setOverridePinError('Invalid PIN. Access denied.')
      setOverridePinChecking(false)
      return
    }
    // Log the override
    logAudit('destructive', 'Override PIN Used', 'Trip',
      `Override by ${match.full_name} on trip ${overrideModal.trip?.id}`,
      overrideModal.trip?.id, profile?.id, profile?.full_name)
    // Open the trip for editing
    const trip = overrideModal.trip
    const type = overrideModal._type
    setOverrideModal(null); setOverridePin(''); setOverridePinError(''); setOverridePinChecking(false)
    if (type === 'dump') {
      setDumpForm({ ...EMPTY_DUMP, ...trip, trip_date: trip.trip_date || today() })
      setEditId(trip.id); setTruckType('Dump Truck'); setStep('form'); setShowForm(true)
    } else {
      const numVans = trip.containers?.length || 1
      setPmForm({ ...EMPTY_PM, ...trip, trip_date: trip.trip_date || today(), containers: trip.containers?.length ? trip.containers : rebuildContainers(trip.trip_code, trip.container_size, [], numVans) })
      setEditId(trip.id); setTruckType('Prime Mover'); setStep('form'); setShowForm(true)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Trip Entry</h1><p className="page-sub">Log dump truck and prime mover trips</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!showForm
            ? <button className="btn-primary" onClick={() => { setStep('type'); setShowForm(true) }}>+ New Trip</button>
            : <button className="btn-ghost" onClick={resetForm}>✕ Cancel</button>}
        </div>
      </div>

      {/* Step 1 — Pick type */}
      {showForm && step === 'type' && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>What type of truck for this trip?</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Select to load the correct form and defaults.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 480 }}>
            {[
              { type: 'Dump Truck', icon: '🚛', desc: 'SMC hauling — CDO, Legazpi, Hustling', note: 'Default client: SMC' },
              { type: 'Prime Mover', icon: '🚚', desc: 'PSACC Hustling, PSACC Hauling, SMC', note: 'Client selected per trip' },
            ].map(opt => (
              <button key={opt.type} onClick={() => handleSelectType(opt.type)} style={{
                background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 10,
                padding: '22px 20px', cursor: 'pointer', textAlign: 'left',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)' }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>{opt.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{opt.type}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{opt.desc}</div>
                <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>{opt.note}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* DUMP TRUCK FORM */}
      {showForm && step === 'form' && truckType === 'Dump Truck' && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            {!editId && <button onClick={() => setStep('type')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: 0 }}>← Back</button>}
            <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{editId ? 'Edit' : 'New'} Dump Truck Trip</h2>
            <span className="badge badge-dump">🚛 Dump Truck</span>
          </div>

          <p className="section-label">Trip Info</p>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <SF label="Transaction / Trip Date" value={dumpForm.trip_date} onChange={v => setDumpForm(f => ({ ...f, trip_date: v }))} req type="date" />
            <SS label="Truck Plate" value={dumpForm.truck_plate} onChange={v => setDumpForm(f => ({ ...f, truck_plate: v }))} req
              options={dumpTrucks.map(t => ({ value: t.plate, label: t.plate + (t.truck_code ? ' (' + t.truck_code + ')' : '') }))}
              placeholder={dumpTrucks.length === 0 ? 'Add trucks in Settings first' : 'Select truck plate'} />
            {(() => {
              const allRoutes = [...new Set([...DUMP_TRUCK_ROUTES, ...savedRoutes])].sort()
              return <SS label="Route" value={dumpForm.route} onChange={v => setDumpForm(f => ({ ...f, route: v }))} req options={allRoutes} placeholder="Select route" />
            })()}
            <DL label="Client" value={dumpForm.client} onChange={v => setDumpForm(f => ({ ...f, client: v }))} req
              list={clients.map(c => c.nickname)}
              listId="dump-clients"
              placeholder="Type or pick client" />
            <div className="form-group">
              <label className="label required">Commodity</label>
              <select value={dumpForm.commodity} onChange={e => setDumpForm(f => ({ ...f, commodity: e.target.value }))}>
                <option value="">Select commodity</option>
                {commodities.filter(c => (c.for_type||'dump') === 'dump').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input id="qc-dump" placeholder="Type new commodity + Enter…" style={{ flex: 1, fontSize: 11, padding: '3px 8px' }}
                  onInput={e => { e.target.value = e.target.value.toUpperCase() }}
                  onKeyDown={async e => {
                    if (e.key !== 'Enter') return
                    const name = e.target.value.trim().toUpperCase()
                    if (!name) return
                    const { error } = await supabase.from('commodities').insert({ name, for_type: 'dump' })
                    if (!error) {
                      setCommodities(prev => [...prev, { name, for_type: 'dump' }].sort((a,b)=>a.name.localeCompare(b.name)))
                      setDumpForm(f => ({ ...f, commodity: name }))
                      e.target.value = ''
                      showToast(`"${name}" added to commodities.`)
                    } else showToast('Error adding commodity: ' + (error.message||''), 'error')
                  }} />
              </div>
            </div>
          </div>

          <p className="section-label">SMC / Document Fields</p>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <SF label="SMCSL WB" value={dumpForm.smcsl_wb} onChange={v => setDumpForm(f => ({ ...f, smcsl_wb: v.trim() }))} />
            <SF label="Supplier Doc Ref" value={dumpForm.supplier_doc_ref} onChange={v => setDumpForm(f => ({ ...f, supplier_doc_ref: v.trim() }))} />
            <SF label="RMSD / SMFI SAF DR" value={dumpForm.rmsd_smfi_saf_dr} onChange={v => setDumpForm(f => ({ ...f, rmsd_smfi_saf_dr: v }))} />
            <SF label="STO No." value={dumpForm.sto_no} onChange={v => setDumpForm(f => ({ ...f, sto_no: v }))} />
          </div>

          <p className="section-label">Island Zone & Codes</p>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <SS label="Island Zone (Origin)" value={dumpForm.island_zone_origin || 'MIN'} onChange={v => setDumpForm(f => ({ ...f, island_zone_origin: v }))} options={ISLAND_ZONES} placeholder="Select zone" />
            <DL label="Island Origin Code" value={dumpForm.island_origin_code} onChange={v => setDumpForm(f => ({ ...f, island_origin_code: v }))}
              list={savedOriginCodes} listId="origin-codes" placeholder="e.g. DAVAO EXTERNAL VINASHIP (GOLD)" />
            <SS label="Island Zone (Destination)" value={dumpForm.island_zone_dest || 'MIN'} onChange={v => setDumpForm(f => ({ ...f, island_zone_dest: v }))} options={ISLAND_ZONES} placeholder="Select zone" />
            <DL label="Island Destination Code" value={dumpForm.island_dest_code} onChange={v => setDumpForm(f => ({ ...f, island_dest_code: v }))}
              list={savedDestCodes} listId="dest-codes" placeholder="e.g. BMEG DAVAO FEED PLANT" />
          </div>

          <p className="section-label">Weight & Rate</p>
          <div className="form-grid" style={{ marginBottom: 8 }}>
            <SF label="Weight (tons)" value={dumpForm.weight_tons} onChange={v => setDumpForm(f => ({ ...f, weight_tons: v }))} req type="number" placeholder="0.000" />
            <DL label="Rate per Ton (₱)" value={dumpForm.rate_per_ton} onChange={v => setDumpForm(f => ({ ...f, rate_per_ton: v }))}
              req listId="dump-rates" list={dumpRates} placeholder="0.00" type="number" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'QTY Destination', value: calcQtyDest(dumpForm.weight_tons).toLocaleString() },
              { label: 'Supplier Amount', value: '₱' + fmt((parseFloat(dumpForm.weight_tons) || 0) * (parseFloat(dumpForm.rate_per_ton) || 0)) },
              { label: 'Total Amount', value: '₱' + fmt((parseFloat(dumpForm.weight_tons) || 0) * (parseFloat(dumpForm.rate_per_ton) || 0)) },
            ].map(c => (
              <div key={c.label} style={{ background: 'var(--accent-light)', border: '1px solid #b8d0e8', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{c.label}</div>
                <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{c.value}</div>
              </div>
            ))}
          </div>

          <p className="section-label">Remarks</p>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <textarea rows={2} value={dumpForm.remarks} onChange={e => setDumpForm(f => ({ ...f, remarks: e.target.value }))}
              placeholder="Optional notes…" style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={resetForm}>Cancel</button>
            <button className="btn-primary" onClick={submitDump} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update' : 'Save Trip'}</button>
          </div>
        </div>
      )}

      {/* PRIME MOVER FORM */}
      {showForm && step === 'form' && truckType === 'Prime Mover' && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            {!editId && <button onClick={() => setStep('type')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: 0 }}>← Back</button>}
            <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{editId ? 'Edit' : 'New'} Prime Mover Trip</h2>
            <span className="badge badge-prime">🚚 Prime Mover</span>
          </div>

          <p className="section-label">Trip Info</p>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <SF label="Transaction / Trip Date" value={pmForm.trip_date} onChange={v => setPmForm(f => ({ ...f, trip_date: v }))} req type="date" />
            <SS label="Truck Plate" value={pmForm.truck_plate} onChange={v => setPmForm(f => ({ ...f, truck_plate: v }))} req
              options={pmTrucks.map(t => ({ value: t.plate, label: t.plate + (t.truck_code ? ' (' + t.truck_code + ')' : '') }))}
              placeholder={pmTrucks.length === 0 ? 'Add trucks in Settings first' : 'Select truck plate'} />
            <SS label="Trip Code" value={pmForm.trip_code} onChange={handlePMTripCodeChange} req options={PM_TRIP_CODES} placeholder="Select trip code" />
            <div className="form-group">
              <label className="label required">Client
                {pmForm.trip_code && ['Hustling PSACC','Hauling PSACC','SMC'].includes(pmForm.trip_code) && (
                  <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>
                    auto-set from trip code
                  </span>
                )}
              </label>
              <select value={pmForm.client} onChange={e => setPmForm(f => ({ ...f, client: e.target.value }))}>
                <option value="">Select client</option>
                {clients.map(c => <option key={c.nickname} value={c.nickname}>{c.nickname} — {c.full_name}</option>)}
              </select>
            </div>
            <SS label="Container Size" value={pmForm.container_size} onChange={handlePMContainerSizeChange} req options={CONTAINER_SIZES} />
            {pmForm.container_size === '20ft' && (
              <div className="form-group">
                <label className="label required">Number of 20ft Vans</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  {[1, 2].map(n => (
                    <button key={n} type="button" onClick={() => handleNum20ftChange(n)} style={{
                      flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                      background: (pmForm.num_20ft || 1) === n ? 'var(--accent)' : 'var(--surface)',
                      color: (pmForm.num_20ft || 1) === n ? '#fff' : 'var(--muted)',
                      border: `1.5px solid ${(pmForm.num_20ft || 1) === n ? 'var(--accent)' : 'var(--border)'}`,
                    }}>{n} Van{n > 1 ? 's' : ''}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Shared trip-level fields — Hustling PSACC */}
          {pmForm.trip_code === 'Hustling PSACC' && (<>
            <p className="section-label">Hustling PSACC — Shared Details</p>
            <div className="form-grid" style={{ marginBottom: 16 }}>
              <SF label="Waybill No. (our doc)" value={pmForm.waybill_no} onChange={v => setPmForm(f => ({ ...f, waybill_no: v.trim() }))} />
              <SF label="Vessel" value={pmForm.vessel} onChange={v => setPmForm(f => ({ ...f, vessel: v }))} />
            </div>
          </>)}

          {/* Shared trip-level fields — Hauling PSACC */}
          {pmForm.trip_code === 'Hauling PSACC' && (<>
            <p className="section-label">Hauling PSACC — Shared Details</p>
            <div className="form-grid" style={{ marginBottom: 16 }}>
              <SF label="Waybill No. (our doc)" value={pmForm.waybill_no} onChange={v => setPmForm(f => ({ ...f, waybill_no: v.trim() }))} />
              <SF label="Vessel" value={pmForm.vessel} onChange={v => setPmForm(f => ({ ...f, vessel: v }))} />
              <SF label="Voyage" value={pmForm.voyage} onChange={v => setPmForm(f => ({ ...f, voyage: v }))} />
              <SF label="EMR Date" value={pmForm.emr_date} onChange={v => setPmForm(f => ({ ...f, emr_date: v }))} type="date" />
              <SF label="Date of Completion" value={pmForm.date_completion} onChange={v => setPmForm(f => ({ ...f, date_completion: v }))} type="date" />
              <div className="form-group">
                <label className="label">Consignee</label>
                <input 
                  list="consignee-list"
                  value={pmForm.consignee} 
                  onChange={e => setPmForm(f => ({ ...f, consignee: e.target.value }))}
                  placeholder="Type or select consignee"
                />
                <datalist id="consignee-list">
                  {[...new Set(pmTrips.map(t => t.consignee).filter(Boolean))].sort().map(c => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
          </>)}

          {/* Shared trip-level fields — SMC */}
          {pmForm.trip_code === 'SMC' && (<>
            <p className="section-label">SMC — Shared Details</p>
            <div className="form-grid" style={{ marginBottom: 16 }}>
              <SF label="SMCSL Waybill No. (SMC's doc)" value={pmForm.smcsl_waybill_no} onChange={v => setPmForm(f => ({ ...f, smcsl_waybill_no: v.trim() }))} />
              <SF label="Supplier Doc (our doc)" value={pmForm.supplier_doc} onChange={v => setPmForm(f => ({ ...f, supplier_doc: v.trim() }))} />
              <SS label="Transaction Type" value={pmForm.transaction_type} onChange={v => setPmForm(f => ({ ...f, transaction_type: v }))} options={['TD', 'TA', 'TC']} />
              <SF label="Port of Origin" value={pmForm.port_origin} onChange={v => setPmForm(f => ({ ...f, port_origin: v }))} />
              <SF label="Port of Destination" value={pmForm.port_destination} onChange={v => setPmForm(f => ({ ...f, port_destination: v }))} />
              <SF label="Shipper Address" value={pmForm.shipper_address} onChange={v => setPmForm(f => ({ ...f, shipper_address: v }))} />
              <SF label="Consignee Address" value={pmForm.consignee_address} onChange={v => setPmForm(f => ({ ...f, consignee_address: v }))} />
            </div>
          </>)}

          {/* Per-container fields */}
          {pmForm.trip_code && pmForm.containers.length > 0 && (<>
            <p className="section-label">
              Container Details
              <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                — {pmForm.container_size === '20ft' ? `${pmForm.num_20ft || 1} van${(pmForm.num_20ft||1)>1?'s':''} (separate fields per van)` : '1 container'}
              </span>
            </p>
            {pmForm.containers.map((_, idx) => renderContainerFields(idx))}
          </>)}

          {/* Grand total across all containers */}
          {pmForm.trip_code && pmForm.containers?.length > 0 && (
            <div style={{ background: 'var(--accent)', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>GRAND TOTAL</span>
              <span style={{ fontSize: 17, fontWeight: 500, fontFamily: 'var(--mono)', color: '#fff' }}>
                ₱{fmt(pmForm.containers.reduce((s, c) => s + (parseFloat(c.supplier_amount) || 0) + (parseFloat(c.stripping_fee) || 0), 0))}
              </span>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="label">Remarks</label>
            <textarea rows={2} value={pmForm.remarks} onChange={e => setPmForm(f => ({ ...f, remarks: e.target.value }))}
              placeholder="Optional…" style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={resetForm}>Cancel</button>
            <button className="btn-primary" onClick={submitPM} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update' : 'Save Trip'}</button>
          </div>
        </div>
      )}

      {/* Trip Log Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '0.5px solid var(--border)' }}>
        {['Dump Truck', 'Prime Mover', 'Summary', 'Import'].map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            background: 'none', border: 'none', padding: '7px 16px', fontSize: 13,
            fontWeight: activeTab === t ? 500 : 400, cursor: 'pointer',
            color: activeTab === t ? 'var(--text)' : 'var(--muted)',
            borderBottom: `2px solid ${activeTab === t ? 'var(--accent)' : 'transparent'}`, marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Trips Shown</div><div className="stat-value">{activeTab === 'Dump Truck' ? filteredDump.length : filteredPM.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Amount</div><div className="stat-value sm">₱{fmt(activeTab === 'Dump Truck' ? dumpTotal : pmTotal)}</div></div>
        {activeTab === 'Dump Truck' && <div className="stat-card"><div className="stat-label">Total Tons</div><div className="stat-value sm">{filteredDump.reduce((s, t) => s + (parseFloat(t.weight_tons) || 0), 0).toFixed(3)}t</div></div>}
      </div>

      {/* Filters — only for Dump Truck and Prime Mover tabs */}
      {(activeTab === 'Dump Truck' || activeTab === 'Prime Mover') && <div className="filter-bar">
        <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 2 }} />
        {activeTab === 'Dump Truck' && <>
          <select value={filterRoute} onChange={e => setFilterRoute(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All routes</option>
            {[...new Set([...DUMP_TRUCK_ROUTES, ...savedRoutes])].sort().map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterCommodity} onChange={e => setFilterCommodity(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All commodities</option>
            {commodities.map(c => <option key={c.name||c} value={c.name||c}>{c.name||c}</option>)}
          </select>
        </>}
        <select value={filterTruck} onChange={e => setFilterTruck(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All trucks</option>
          {trucksOfType(activeTab).map(t => <option key={t.plate} value={t.plate}>{t.plate}</option>)}
        </select>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ width: 'auto' }}>
          <option value="">📅 All months</option>
          {allTripMonths.map(m => {
            const label = new Date(m + '-01').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
            return <option key={m} value={m}>{label}</option>
          })}
        </select>
        <select value={filterPayStatus} onChange={e => setFilterPayStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">💵 All payment status</option>
          <option value="unbilled">◻️ Not yet invoiced</option>
          <option value="invoiced">📄 Invoiced — not yet paid</option>
          <option value="paid">💰 Paid</option>
        </select>
        <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterRoute(''); setFilterCommodity(''); setFilterTruck(''); setFilterPayStatus(''); setFilterMonth(new Date().toISOString().slice(0,7)) }}>This month</button>
        {filterMonth && <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterRoute(''); setFilterCommodity(''); setFilterTruck(''); setFilterPayStatus(''); setFilterMonth('') }}>Show all</button>}
        {(search || filterRoute || filterCommodity || filterTruck || filterPayStatus) && <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterRoute(''); setFilterCommodity(''); setFilterTruck(''); setFilterPayStatus('') }}>Clear filters</button>}
      </div>}

      {/* Dump Truck Table */}
      {activeTab === 'Dump Truck' && (
        loading ? <div className="empty-state"><p>Loading…</p></div> :
        filteredDump.length === 0 ? <div className="empty-state"><p>{dumpTrips.length === 0 ? 'No dump truck trips yet.' : 'No results.'}</p></div> : (
          <>
          {dupDumpWBs.size > 0 && (
            <div style={{ marginBottom: 10, padding: '10px 14px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', marginBottom: 2 }}>
                  {dupDumpWBs.size} duplicate SMCSL WB{dupDumpWBs.size > 1 ? 's' : ''} found in current view
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{[...dupDumpWBs].join(' · ')}</div>
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Date</th><th>Plate</th><th>Route</th><th>Client</th>
                <th>Commodity</th><th>SMCSL WB</th>
                <th className="text-right">Weight (t)</th><th className="text-right">Rate</th><th className="text-right">Amount (₱)</th><th></th>
              </tr></thead>
              <tbody>
                {filteredDump.length === 0
                  ? <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'var(--muted)' }}>
                      No dump trips{filterMonth ? ' for ' + new Date(filterMonth+'-01').toLocaleDateString('en-PH',{month:'long',year:'numeric'}) : ''}.
                      {filterMonth ? <> Try a different month or <button className="btn-ghost btn-sm" style={{padding:'2px 8px'}} onClick={() => setFilterMonth('')}>show all</button>.</> : null}
                    </td></tr>
                  : filteredDump.map(t => (
                  <tr key={t.id} style={{ opacity: t.invoice_id ? 0.65 : 1 }}>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(t.trip_date)}</td>
                    <td style={{ fontWeight: 500, fontFamily: 'var(--mono)' }}>
                      {t.truck_plate}
                      {isSubconTruck(t.truck_plate) && <span className="badge" style={{ fontSize: 9, background: 'rgba(139,92,246,0.12)', color: '#6d28d9', marginLeft: 4 }}>🤝</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {t.route}
                      {t.remarks && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1, fontStyle: 'italic' }}>{t.remarks}</div>}
                    </td>
                    <td>{t.client}</td>
                    <td>{t.commodity}</td>
                    <td className="mono muted" style={{ fontSize: 12 }}>{t.smcsl_wb || '—'}{dupDumpWBs.has(t.smcsl_wb) && t.smcsl_wb ? <span style={{ display:'inline-block', marginLeft:6, background:'rgba(220,38,38,0.12)', color:'var(--danger)', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, border:'1px solid rgba(220,38,38,0.3)' }}>⚠ DUPE</span> : null}</td>
                    <td className="text-right mono">{Number(t.weight_tons || 0).toFixed(3)}</td>
                    <td className="text-right mono muted" style={{ fontSize: 12 }}>₱{fmt(t.rate_per_ton)}</td>
                    <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt((t.weight_tons || 0) * (t.rate_per_ton || 0))}</td>
                    <td>
                      {t.invoice_id
                        ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <InvoiceBadge inv={invoiceInfo[t.invoice_id]} onClick={() => navigate('/billing', { state: { searchInvoice: invoiceMap[t.invoice_id] } })} />
                            <button className="btn-ghost btn-sm" onClick={() => { setOverrideModal({ trip: t, _type: 'dump' }); setOverridePin(''); setOverridePinError('') }} title="Edit with admin override">🔑</button>
                          </div>
                        : <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-ghost btn-sm" onClick={() => handleEditDump(t)}>Edit</button>
                          <button className="btn-danger btn-sm" onClick={() => setDeleteTarget({ id: t.id, type: 'dump' })}>Delete</button>
                        </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={8} style={{ padding: '10px 14px', fontWeight: 500, borderTop: '1px solid var(--border-md)' }}>Total</td>
                <td className="text-right mono" style={{ padding: '10px 14px', fontWeight: 500, borderTop: '1px solid var(--border-md)' }}>₱{fmt(dumpTotal)}</td>
                <td style={{ borderTop: '1px solid var(--border-md)' }}></td>
              </tr></tfoot>
            </table>
          </div>
          </>
        )
      )}

      {/* Prime Mover Table */}
      {activeTab === 'Prime Mover' && (
        loading ? <div className="empty-state"><p>Loading…</p></div> :
        filteredPM.length === 0 ? <div className="empty-state"><p>{pmTrips.length === 0 ? 'No prime mover trips yet.' : 'No results.'}</p></div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Date</th><th>Plate</th><th>Trip Code</th><th>Client</th>
                <th>Container</th><th>Con Van No.</th>
                <th className="text-right">Amount (₱)</th><th></th>
              </tr></thead>
              <tbody>
                {filteredPM.length === 0
                  ? <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'var(--muted)' }}>
                      No PM trips{filterMonth ? ' for ' + new Date(filterMonth+'-01').toLocaleDateString('en-PH',{month:'long',year:'numeric'}) : ''}.
                      {filterMonth ? <> Try a different month or <button className="btn-ghost btn-sm" style={{padding:'2px 8px'}} onClick={() => setFilterMonth('')}>show all</button>.</> : null}
                    </td></tr>
                  : filteredPM.map(t => (
                  <tr key={t.id} style={{ opacity: t.invoice_id ? 0.65 : 1 }}>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(t.trip_date)}</td>
                    <td style={{ fontWeight: 500, fontFamily: 'var(--mono)' }}>{t.truck_plate}</td>
                    <td><span className="badge badge-prime" style={{ fontSize: 11 }}>{t.trip_code}</span></td>
                    <td style={{ fontWeight: 500 }}>{t.client || '—'}</td>
                    <td style={{ fontSize: 12 }}>{t.container_size}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {(t.containers || []).map(c => c.con_van_no || c.van_no).filter(Boolean).join(', ') || t.vessel || t.waybill_no || '—'}
                    </td>
                    <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt((t.supplier_amount || 0) + (t.stripping_fee || 0))}</td>
                    <td>
                      {t.invoice_id
                        ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <InvoiceBadge inv={invoiceInfo[t.invoice_id]} onClick={() => navigate('/billing', { state: { searchInvoice: invoiceMap[t.invoice_id] } })} />
                            <button className="btn-ghost btn-sm" onClick={() => { setOverrideModal({ trip: t, _type: 'pm' }); setOverridePin(''); setOverridePinError('') }} title="Edit with admin override">🔑</button>
                          </div>
                        : <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-ghost btn-sm" onClick={() => handleEditPM(t)}>Edit</button>
                          <button className="btn-danger btn-sm" onClick={() => setDeleteTarget({ id: t.id, type: 'pm' })}>Delete</button>
                        </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={6} style={{ padding: '10px 14px', fontWeight: 500, borderTop: '1px solid var(--border-md)' }}>Total</td>
                <td className="text-right mono" style={{ padding: '10px 14px', fontWeight: 500, borderTop: '1px solid var(--border-md)' }}>₱{fmt(pmTotal)}</td>
                <td style={{ borderTop: '1px solid var(--border-md)' }}></td>
              </tr></tfoot>
            </table>
          </div>
        )
      )}


      {/* ── SUMMARY TAB ── */}
      {activeTab === 'Summary' && (
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Monthly Trip Summary per Truck</h2>
          {(() => {
            const allTrucks = [...new Set([...dumpTrips.map(t=>t.truck_plate), ...pmTrips.map(t=>t.truck_plate)].filter(Boolean))].sort()
            const filteredTrucks = summaryTruck ? [summaryTruck] : allTrucks
            return (<>
              {/* Filters */}
              <div className="filter-bar" style={{ marginBottom: 16 }}>
                <input type="month" value={summaryMonth} onChange={e => setSummaryMonth(e.target.value)} style={{ width: 'auto' }} />
                <select value={summaryTruck} onChange={e => setSummaryTruck(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">All trucks</option>
                  {allTrucks.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                {(summaryTruck) && <button className="btn-ghost btn-sm" onClick={() => setSummaryTruck('')}>Clear</button>}
              </div>
            {filteredTrucks.length === 0 ? <div className="empty-state"><p>No trips logged yet.</p></div>
            : filteredTrucks.map(plate => {
              const currentMonth = summaryMonth
              const td = dumpTrips.filter(t => t.truck_plate === plate && t.trip_date?.startsWith(currentMonth))
              const tp = pmTrips.filter(t => t.truck_plate === plate && t.trip_date?.startsWith(currentMonth))
              const totalAmt = td.reduce((s,t)=>s+(t.weight_tons||0)*(t.rate_per_ton||0),0) + tp.reduce((s,t)=>s+(t.trip_code==='SMC'?((t.supplier_amount||0)+(t.stripping_fee||0))/1.12:(t.supplier_amount||0)+(t.stripping_fee||0)),0)
              const truck = trucks.find(t => t.plate === plate)
              if (td.length === 0 && tp.length === 0) return null
              return (
                <div key={plate} className="card" style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span className={`badge ${truck?.truck_type === 'Dump Truck' ? 'badge-dump' : 'badge-prime'}`}>{plate}</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{truck?.truck_type}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
                      {new Date(currentMonth+'-01').toLocaleDateString('en-PH',{month:'long',year:'numeric'})}
                    </span>
                  </div>
                  <div className="stats-grid">
                    <div className="stat-card"><div className="stat-label">Dump Truck Trips</div><div className="stat-value">{td.length}</div></div>
                    <div className="stat-card"><div className="stat-label">Prime Mover Trips</div><div className="stat-value">{tp.length}</div></div>
                    <div className="stat-card"><div className="stat-label">Total Trips</div><div className="stat-value">{td.length+tp.length}</div></div>
                    <div className="stat-card"><div className="stat-label">Total Amount</div><div className="stat-value sm">₱{fmt(totalAmt)}</div></div>
                  </div>
                  {td.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Dump Truck — by route:</p>
                      {Object.entries(td.reduce((acc, t) => {
                        const k = t.route || 'Unknown'
                        if (!acc[k]) acc[k] = { trips: 0, tons: 0, amount: 0 }
                        acc[k].trips++; acc[k].tons += parseFloat(t.weight_tons)||0; acc[k].amount += (t.weight_tons||0)*(t.rate_per_ton||0)
                        return acc
                      }, {})).map(([route, d]) => (
                        <div key={route} style={{ display: 'flex', gap: 12, fontSize: 12, padding: '4px 0', borderBottom: '0.5px solid var(--border)' }}>
                          <span style={{ flex: 1 }}>{route}</span>
                          <span className="muted">{d.trips} trip{d.trips>1?'s':''}</span>
                          <span className="muted">{d.tons.toFixed(3)}t</span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>₱{fmt(d.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {tp.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Prime Mover — by trip code:</p>
                      {Object.entries(tp.reduce((acc, t) => {
                        const k = t.trip_code || 'Unknown'
                        if (!acc[k]) acc[k] = { trips: 0, amount: 0 }
                        acc[k].trips++; acc[k].amount += t.trip_code==='SMC'?((t.supplier_amount||0)+(t.stripping_fee||0))/1.12:(t.supplier_amount||0)+(t.stripping_fee||0)
                        return acc
                      }, {})).map(([code, d]) => (
                        <div key={code} style={{ display: 'flex', gap: 12, fontSize: 12, padding: '4px 0', borderBottom: '0.5px solid var(--border)' }}>
                          <span style={{ flex: 1 }}>{code}</span>
                          <span className="muted">{d.trips} trip{d.trips>1?'s':''}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>₱{fmt(d.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            }).filter(Boolean)}
            </>)
          })()}
        </div>
      )}

      {/* ── IMPORT TAB ── */}
      {activeTab === 'Import' && (
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Import Trips from Excel / CSV</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
            Download the template, fill it in Excel, then upload here to bulk import dump truck trips.
          </p>

          {/* Download template */}
          <div style={{ marginBottom: 20 }}>
            <button className="btn-ghost" onClick={() => {
              const headers = 'trip_date,truck_plate,route,client,commodity,smcsl_wb,supplier_doc_ref,island_zone_origin,island_origin_code,island_zone_dest,island_dest_code,weight_tons,rate_per_ton,rmsd_smfi_saf_dr,sto_no,remarks'
              const sample = '2026-01-15,ABC-1234,CDO-Davao,SMC,Wheat Bran Pellet,1234567,SUP-001,MIN,DAVAO EXTERNAL VINASHIP,MIN,BMEG DAVAO FEED PLANT,29.270,474.00,7223930719,6116495551,'
              const csv = headers + '\n' + sample
              const blob = new Blob([csv], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url; a.download = 'dump-truck-trips-template.csv'; a.click()
              URL.revokeObjectURL(url)
            }}>
              📥 Download CSV Template
            </button>
          </div>

          {/* Upload */}
          <div style={{ marginBottom: 16 }}>
            <label className="label">Upload CSV File</label>
            <input type="file" accept=".csv" onChange={async (e) => {
              const file = e.target.files[0]
              if (!file) return
              const text = await file.text()
              const lines = text.trim().split('\n')
              const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,''))
              const rows = lines.slice(1).map(line => {
                const vals = line.split(',').map(v => v.trim().replace(/"/g,''))
                const obj = {}
                headers.forEach((h, i) => obj[h] = vals[i] || '')
                return obj
              }).filter(r => r.trip_date && r.truck_plate)
              setImportData(rows)
            }} style={{ marginTop: 6 }} />
          </div>

          {/* Preview */}
          {importData.length > 0 && (
            <>
              <div style={{ padding: '10px 14px', background: 'var(--accent-light)', borderRadius: 8, marginBottom: 14, fontSize: 13, color: 'var(--accent)' }}>
                ✓ {importData.length} trips ready to import. Review below then click Import.
              </div>
              <div className="table-wrap" style={{ marginBottom: 16, maxHeight: 300, overflowY: 'auto' }}>
                <table className="table">
                  <thead><tr>
                    <th>Date</th><th>Plate</th><th>Route</th><th>Client</th>
                    <th>Commodity</th><th className="text-right">Weight</th><th className="text-right">Rate</th>
                  </tr></thead>
                  <tbody>
                    {importData.map((r, i) => (
                      <tr key={i}>
                        <td className="mono" style={{fontSize:12}}>{r.trip_date}</td>
                        <td style={{fontWeight:500,fontFamily:'var(--mono)'}}>{r.truck_plate}</td>
                        <td style={{fontSize:12}}>{r.route}</td>
                        <td>{r.client}</td>
                        <td>{r.commodity}</td>
                        <td className="text-right mono" style={{fontSize:12}}>{r.weight_tons}</td>
                        <td className="text-right mono" style={{fontSize:12}}>{r.rate_per_ton}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn-ghost" onClick={() => setImportData([])}>Clear</button>
                <button className="btn-primary" disabled={importing} onClick={async () => {
                  setImporting(true)
                  const parseDate = (d) => {
                    if (!d) return ''
                    // Handle YYYY-MM-DD already correct
                    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
                    // Handle MM/DD/YYYY (US Excel default)
                    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) {
                      const [m,day,y] = d.split('/')
                      return `${y}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`
                    }
                    // Handle DD/MM/YYYY
                    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(d)) {
                      const [day,m,y] = d.split('-')
                      return `${y}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`
                    }
                    return d
                  }
                  const rows = importData.map(r => ({
                    trip_date: parseDate(r.trip_date),
                    truck_plate: r.truck_plate,
                    route: r.route,
                    client: r.client || 'SMC',
                    commodity: r.commodity,
                    smcsl_wb: r.smcsl_wb || '',
                    supplier_doc_ref: r.supplier_doc_ref || '',
                    island_zone_origin: r.island_zone_origin || 'MIN',
                    island_origin_code: r.island_origin_code || '',
                    island_zone_dest: r.island_zone_dest || 'MIN',
                    island_dest_code: r.island_dest_code || 'MIN Davao Plant',
                    weight_tons: parseFloat(r.weight_tons) || 0,
                    rate_per_ton: parseFloat(r.rate_per_ton) || 0,
                    rmsd_smfi_saf_dr: r.rmsd_smfi_saf_dr || '',
                    sto_no: r.sto_no || '',
                    remarks: r.remarks || '',
                    created_by: profile?.id,
                  }))
                  const { error } = await supabase.from('trips_dump').insert(rows)
                  if (error) { showToast('Import error: ' + error.message, 'error') }
                  else { showToast(`${rows.length} trips imported successfully!`); setImportData([]); fetchAll() }
                  setImporting(false)
                }}>{importing ? 'Importing…' : `Import ${importData.length} Trips`}</button>
              </div>
            </>
          )}
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Delete this trip?</h3>
            <p>This will permanently remove the trip and cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {/* Save Template Modal */}
      {showTemplateModal && (
        <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h3>Save as Template</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
              Saves current form fields as a quick-fill template.
            </p>
            <input value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="Template name (e.g. SMC Regular Route)" autoFocus
              onKeyDown={e => e.key === 'Enter' && saveTemplate()} />
            {templates.filter(t => t.type === truckType).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Existing templates:</div>
                {templates.filter(t => t.type === truckType).map(tmpl => (
                  <div key={tmpl.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                    <span>{tmpl.name}</span>
                    <button className="btn-danger btn-sm" style={{ fontSize: 10 }} onClick={() => deleteTemplate(tmpl.id)}>Del</button>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-ghost" onClick={() => setShowTemplateModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveTemplate} disabled={!templateName.trim()}>Save Template</button>
            </div>
          </div>
        </div>
      )}

      {/* Override PIN Modal */}
      {overrideModal && (
        <div className="modal-overlay" onClick={() => setOverrideModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <h3 style={{ marginBottom: 8 }}>🔑 Admin Override Required</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              This trip is included in invoice <strong>{invoiceMap[overrideModal.trip?.invoice_id] || '—'}</strong>. Enter an admin override PIN to edit.
            </p>
            <div style={{ padding: '8px 12px', background: 'rgba(220,38,38,0.07)', borderRadius: 8, fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>
              ⚠️ <strong>Note:</strong> Editing this trip will NOT automatically update the already-generated SOA. You may need to reprint the invoice after editing.
            </div>
            <div className="form-group" style={{ margin: 0, marginBottom: 12 }}>
              <label className="label">Admin Override PIN</label>
              <input value={overridePin} onChange={e => { setOverridePin(e.target.value.toUpperCase()); setOverridePinError('') }}
                placeholder="e.g. A12345" maxLength={6}
                style={{ fontFamily: 'var(--mono)', letterSpacing: 4, fontSize: 18, textAlign: 'center' }}
                onKeyDown={e => e.key === 'Enter' && handleOverridePinCheck()} autoFocus />
              {overridePinError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{overridePinError}</div>}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => { setOverrideModal(null); setOverridePin(''); setOverridePinError('') }}>Cancel</button>
              <button className="btn-primary" onClick={handleOverridePinCheck} disabled={overridePinChecking}>
                {overridePinChecking ? 'Checking…' : 'Unlock Edit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {afterSaveModal && (
        <div className="modal-overlay" onClick={() => setAfterSaveModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <h3 style={{ marginBottom: 8 }}>Trip Saved!</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>What would you like to do next?</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn-primary" onClick={() => { setAfterSaveModal(false) }}>
                ➕ Add Another Trip
              </button>
              <button className="btn-ghost" onClick={() => { setAfterSaveModal(false) }}>
                ✅ Done
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} />
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}
