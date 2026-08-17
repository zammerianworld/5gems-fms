import { useState, useEffect, useRef, useCallback } from 'react'
import DateInput from '../components/DateInput'
import { supabase, fmt, fmtDate, logAudit, numberToWords, calcQtyDest, DUMP_TRUCK_ROUTES, sortRows, fetchAllRows } from '../lib/supabase'
import { useToast, Toast } from '../components/Toast'
import jsPDF from 'jspdf'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import autoTable from 'jspdf-autotable'
import { useAuth } from '../components/AuthContext'
import SignatoryDialog from '../components/SignatoryDialog'
import { useLocation } from 'react-router-dom'
const TABS = ['Generate', 'Invoice List', 'Manage Trips', 'Aging Report', 'Client Balance']
const STATUS_OPTIONS = ['Invoiced', 'Paid', 'Returned', 'On Hold']
const STATUS_COLORS = {
  Invoiced: { bg: 'rgba(255,30,0,0.12)', color: '#cc1800' },
  Paid: { bg: 'rgba(22,163,74,0.12)', color: '#15803d' },
  Returned: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626' },
  'On Hold': { bg: 'rgba(202,138,4,0.12)', color: '#a16207' },
}
export default function Billing() {
  const { toast, showToast } = useToast()
  const { isAdmin, profile } = useAuth()
  const location = useLocation()
  const printRef = useRef()
  const [tab, setTab] = useState('Generate')
  const [truckType, setTruckType] = useState('Dump Truck')
  const [dumpTrips, setDumpTrips] = useState([])
  const [pmTrips, setPmTrips] = useState([])
  const [allDumpTrips, setAllDumpTrips] = useState([])
  const [allPmTrips, setAllPmTrips] = useState([])
  const [invoicePlatesMap, setInvoicePlatesMap] = useState({})
  const [quickEditTrip, setQuickEditTrip] = useState(null) // { ...trip, _table }
  const [quickEditSaving, setQuickEditSaving] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [settings, setSettings] = useState({})
  const [trucks, setTrucks] = useState([])
  const [clientsList, setClientsList] = useState([])
  const [commodities, setCommodities] = useState([])
  const [savedOriginCodes, setSavedOriginCodes] = useState([])
  const [savedDestCodes, setSavedDestCodes] = useState([])
  const [loading, setLoading] = useState(true)
  // Generate tab
  const [selectedClient, setSelectedClient] = useState('')
  const [filterRoute, setFilterRoute] = useState('')
  const [filterCommodity, setFilterCommodity] = useState('')
  const [filterTruck, setFilterTruck] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [filterSize, setFilterSize] = useState('')
  const [filterTripCode, setFilterTripCode] = useState('')
  const [filterContainerSize, setFilterContainerSize] = useState('')
  const [filterOriginCode, setFilterOriginCode] = useState('')
  const [filterDestCode, setFilterDestCode] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [isVatInvoice, setIsVatInvoice] = useState(false)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [generating, setGenerating] = useState(false)
  const [invoiceDupWarning, setInvoiceDupWarning] = useState(false)
  // Invoice list
  const [editingInvoice, setEditingInvoice] = useState(null)
  const [invoiceTrips, setInvoiceTrips] = useState([])
  const [savingInvoice, setSavingInvoice] = useState(false)
  const [removingTripId, setRemovingTripId] = useState(null)
  const [editingRates, setEditingRates] = useState({})
  const [savingRates, setSavingRates] = useState(false)
  const [recalcingAll, setRecalcingAll] = useState(false)
  const [rateOverrideGranted, setRateOverrideGranted] = useState(false)
  const [rateOverridePinModal, setRateOverridePinModal] = useState(false)
  const [rateOverridePinInput, setRateOverridePinInput] = useState('')
  const [rateOverridePinError, setRateOverridePinError] = useState('')
  const [rateOverridePinChecking, setRateOverridePinChecking] = useState(false)
  const [invFilterMonth, setInvFilterMonth] = useState('')
  const [invFilterYear, setInvFilterYear] = useState('')
  const [invFilterClient, setInvFilterClient] = useState('')
  const [invFilterStatus, setInvFilterStatus] = useState('')
  const [invFilterPlate, setInvFilterPlate] = useState('')
  const [invSearch, setInvSearch] = useState('')
  const [invSortKey, setInvSortKey] = useState('invoice_date')
  const [invSortDir, setInvSortDir] = useState('desc')
  const toggleInvSort = (k) => { setInvSortKey(k); setInvSortDir(d => k === invSortKey ? (d === 'asc' ? 'desc' : 'asc') : 'desc') }
  const [bulkInvoices, setBulkInvoices] = useState([])
  const [bulkDates, setBulkDates] = useState({})
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkOneDate, setBulkOneDate] = useState('')
  const [markPaidModal, setMarkPaidModal] = useState(null)
  const [markPaidDate, setMarkPaidDate] = useState('')
  const [markPaidAmount, setMarkPaidAmount] = useState('')
  const [markPaidSaving, setMarkPaidSaving] = useState(false)
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState(null)
  const [confirmDeleteInvoice, setConfirmDeleteInvoice] = useState(null)
  // Override PIN
  const [overridePinModal, setOverridePinModal] = useState(null)
  const [overridePinInput, setOverridePinInput] = useState('')
  const [overridePinError, setOverridePinError] = useState('')
  const [overridePinChecking, setOverridePinChecking] = useState(false)
  // Add trip to invoice
  const [addTripModal, setAddTripModal] = useState(null)
  const [addTripCandidates, setAddTripCandidates] = useState([])
  const [addTripSelected, setAddTripSelected] = useState([])
  const [addTripSaving, setAddTripSaving] = useState(false)
  // Preview / print
  const [previewModal, setPreviewModal] = useState(null)
  const [printAfterPreview, setPrintAfterPreview] = useState(false)
  const [sigDialog, setSigDialog] = useState(false)
  const [excelSigPending, setExcelSigPending] = useState(null) // { tripsData, invNo, invDate, client, type, isVat } or null = PDF print mode
  const [bulkExportIds, setBulkExportIds] = useState([])
  const [bulkExporting, setBulkExporting] = useState(false)
  const [bulkExportSigPending, setBulkExportSigPending] = useState(false)
  const [agingSigDialog, setAgingSigDialog] = useState(false)
  const [agingSigCallback, setAgingSigCallback] = useState(null)
  const reprintRef = useRef()
  const [reprintInvoice, setReprintInvoice] = useState(null)
  const [reprintTrips, setReprintTrips] = useState([])
  // Manage Trips
  const [manageTab, setManageTab] = useState('Dump Truck')
  const [manageMonth, setManageMonth] = useState('')
  const [manageTruck, setManageTruck] = useState('')
  const [manageSearch, setManageSearch] = useState('')
  const [manageSelected, setManageSelected] = useState([])
  const [manageClient, setManageClient] = useState('')
  const [manageRoute, setManageRoute] = useState('')
  const [manageCommodity, setManageCommodity] = useState('')
  const [manageTripCode, setManageTripCode] = useState('')
  const [manageContainerSize, setManageContainerSize] = useState('')
  const [manageSortKey, setManageSortKey] = useState('trip_date')
  const [manageSortDir, setManageSortDir] = useState('desc')
  const toggleManageSort = (k) => { setManageSortKey(k); setManageSortDir(d => k === manageSortKey ? (d === 'asc' ? 'desc' : 'asc') : 'desc') }
  const [bulkRateEdit, setBulkRateEdit] = useState(false)
  const [bulkRate, setBulkRate] = useState('')
  const [bulkRateSaving, setBulkRateSaving] = useState(false)
  const [deletingManage, setDeletingManage] = useState(false)
  const [manageFilterClient, setManageFilterClient] = useState('')
  // Aging
  const [agingTruckType, setAgingTruckType] = useState('')
  const [agingTripCode, setAgingTripCode] = useState('')
  const [agingClient, setAgingClient] = useState('')
  const [agingBucket, setAgingBucket] = useState('all')
  const [agingShowAll, setAgingShowAll] = useState(false)
  const [agingSortKey, setAgingSortKey] = useState('days')
  const [agingSortDir, setAgingSortDir] = useState('desc')
  const toggleAgingSort = (k) => { setAgingSortKey(k); setAgingSortDir(d => k === agingSortKey ? (d === 'asc' ? 'desc' : 'asc') : 'desc') }
  const [showOverduePrintModal, setShowOverduePrintModal] = useState(false)
  const [overduePrintType, setOverduePrintType] = useState('')
  const [overduePrintClient, setOverduePrintClient] = useState('')
  const [printOrientation, setPrintOrientation] = useState('landscape')
  const [printFormat, setPrintFormat] = useState('pdf')
  // Client Balance
  const [balanceClient, setBalanceClient] = useState('')
  const [balanceStatusFilter, setBalanceStatusFilter] = useState('all') // 'all' | 'paid' | 'unpaid'

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [dt, pt, adt, apt, inv, sett, tk, co, cl] = await Promise.all([
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('invoice_id', null).order('trip_date')),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('invoice_id', null).order('trip_date')),
      fetchAllRows(() => supabase.from('trips_dump').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('trips_pm').select('*').is('deleted_at', null).order('trip_date', { ascending: false })),
      fetchAllRows(() => supabase.from('invoices').select('*').is('deleted_at', null).order('invoice_date', { ascending: false })),
      supabase.from('company_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('trucks').select('id,plate,ownership,truck_type'),
      supabase.from('commodities').select('name').order('name'),
      supabase.from('clients').select('*').order('nickname'),
    ])
    if (dt.data) { setDumpTrips(dt.data); setSavedOriginCodes([...new Set(dt.data.map(t => t.island_origin_code).filter(Boolean))].sort()); setSavedDestCodes([...new Set(dt.data.map(t => t.island_dest_code).filter(Boolean))].sort()) }
    if (pt.data) setPmTrips(pt.data)
    if (adt.data) setAllDumpTrips(adt.data)
    if (apt.data) setAllPmTrips(apt.data)
    // Build invoice_id -> Set of truck plates (for Invoice List plate filter)
    const platesMap = {}
    ;[...(adt.data||[]), ...(apt.data||[])].forEach(t => {
      if (!t.invoice_id || !t.truck_plate) return
      if (!platesMap[t.invoice_id]) platesMap[t.invoice_id] = new Set()
      platesMap[t.invoice_id].add(t.truck_plate)
    })
    setInvoicePlatesMap(platesMap)
    if (inv.data) {
      const wbByInvoice = {}
      const countByInvoice = {}
      ;(adt.data || []).forEach(t => {
        if (t.invoice_id) {
          countByInvoice[t.invoice_id] = (countByInvoice[t.invoice_id] || 0) + 1
          if (t.smcsl_wb) { if (!wbByInvoice[t.invoice_id]) wbByInvoice[t.invoice_id] = []; wbByInvoice[t.invoice_id].push(t.smcsl_wb) }
        }
      })
      ;(apt.data || []).forEach(t => { if (t.invoice_id) countByInvoice[t.invoice_id] = (countByInvoice[t.invoice_id] || 0) + 1 })
      setInvoices(inv.data.map(i => ({ ...i, smcsl_wb_list: wbByInvoice[i.id]?.join(', ') || null, trip_count: countByInvoice[i.id] || 0 })))
    }
    if (sett.data) setSettings(sett.data)
    if (co.data) setCommodities(co.data.map(c => c.name))
    if (tk.data) setTrucks(tk.data)
    if (cl.data) setClientsList(cl.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Auto-load trips when Edit panel opens
  useEffect(() => {
    if (editingInvoice?.id) { loadInvoiceTrips(editingInvoice) }
    else { setInvoiceTrips([]) }
  }, [editingInvoice?.id])

  useEffect(() => {
    fetchAll().then(() => {
      if (location.state?.searchInvoice) {
        setTab('Invoice List'); setInvSearch(location.state.searchInvoice)
        setInvFilterStatus(''); setInvFilterMonth(''); setInvFilterClient(''); setInvFilterYear('')
        window.history.replaceState({}, document.title)
      }
      if (location.state?.tab) { setTab(location.state.tab); window.history.replaceState({}, document.title) }
    })
  }, [fetchAll])

  const getClientDetails = (nickname) => clientsList.find(c => c.nickname === nickname || c.full_name === nickname) || null
  // Checks ALL invoices incl. soft-deleted — the DB unique constraint applies to those too,
  // so a number "freed" by deleting an invoice is still blocked at insert time.
  const checkDuplicate = async (no) => {
    if (!no.trim()) { setInvoiceDupWarning(false); return }
    const { data } = await supabase.from('invoices').select('id,deleted_at').eq('invoice_no', no.trim())
    if (!data || data.length === 0) { setInvoiceDupWarning(false); return }
    setInvoiceDupWarning(data.some(i => !i.deleted_at) ? 'active' : 'deleted')
  }

  const candidateTrips = truckType === 'Dump Truck' ? dumpTrips : pmTrips
  const subconPlatesSet = new Set(trucks.filter(t => t.ownership === 'subcon').map(t => t.plate))
  const truckPlates = [...new Set(candidateTrips.map(t => t.truck_plate).filter(p => p && !subconPlatesSet.has(p)))].sort()
  const tripCodes = [...new Set(pmTrips.map(t => t.trip_code).filter(Boolean))].sort()
  const filteredCandidates = candidateTrips.filter(t => {
    const mC = !selectedClient || t.client === selectedClient
    const mM = !filterMonth || t.trip_date?.startsWith(filterMonth)
    const mR = !filterRoute || t.route === filterRoute
    const mCo = !filterCommodity || t.commodity === filterCommodity
    const mT = !filterTruck || t.truck_plate === filterTruck
    const mTc = !filterTripCode || t.trip_code === filterTripCode
    const mCs = !filterContainerSize || t.container_size === filterContainerSize
    const mO = !filterOriginCode || t.island_origin_code === filterOriginCode
    const mD = !filterDestCode || t.island_dest_code === filterDestCode
    const mS = !filterSearch || [t.truck_plate, t.smcsl_wb, t.supplier_doc_ref, t.route, t.commodity, t.vessel, t.waybill_no, t.smcsl_waybill_no].some(v => v?.toLowerCase().includes(filterSearch.toLowerCase()))
    return mC && mM && mR && mCo && mT && mTc && mO && mD && mS
  })
  const billedTrips = filteredCandidates.filter(t => selectedIds.includes(t.id))
  const isSMCInvoice = truckType === 'Prime Mover' && billedTrips.length > 0 && billedTrips.every(t => t.trip_code === 'SMC')
  const rawTotal = truckType === 'Dump Truck'
    ? billedTrips.reduce((s, t) => s + ((t.weight_tons || 0) * (t.rate_per_ton || 0)), 0)
    : billedTrips.reduce((s, t) => s + ((t.supplier_amount || 0) + (t.stripping_fee || 0)), 0)
  const totalNet = isSMCInvoice ? rawTotal / 1.12 : rawTotal
  const vat12 = isVatInvoice ? totalNet * 0.12 : 0
  const totalVatInc = isVatInvoice ? totalNet * 1.12 : totalNet
  const wht2 = totalNet * 0.02
  const totalDue = totalVatInc - wht2
  const totalTons = billedTrips.reduce((s, t) => s + (parseFloat(t.weight_tons) || 0), 0)

  const toggleTrip = (id, trip) => {
    setSelectedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      if (!selectedClient && trip?.client) setSelectedClient(trip.client)
      return next
    })
  }

  const sortedInvoices = sortRows(invoices, invSortKey, invSortDir)
  const filteredInvoices = sortedInvoices.filter(inv =>
    (!invFilterMonth || inv.invoice_date?.startsWith(invFilterMonth.slice(0, 7))) &&
    (!invFilterYear || inv.invoice_date?.startsWith(invFilterYear)) &&
    (!invFilterClient || inv.client === invFilterClient) &&
    (!invFilterStatus || inv.status === invFilterStatus) &&
    (!invFilterPlate || invoicePlatesMap[inv.id]?.has(invFilterPlate)) &&
    (!invSearch || [String(inv.invoice_no || ''), inv.client || '', inv.remarks || ''].some(v => v.toLowerCase().includes(invSearch.toLowerCase())))
  )
  const allInvPlates = [...new Set(Object.values(invoicePlatesMap).flatMap(s => [...s]))].sort()

  const filteredManaged = (() => {
    const base = (manageTab === 'Dump Truck' ? allDumpTrips : allPmTrips).filter(t => {
      if (manageMonth && !t.trip_date?.startsWith(manageMonth)) return false
      if (manageTruck && t.truck_plate !== manageTruck) return false
      if (manageClient && t.client !== manageClient) return false
      if (manageTab === 'Dump Truck') {
        if (manageRoute && t.route !== manageRoute) return false
        if (manageCommodity && t.commodity !== manageCommodity) return false
      } else {
        if (manageTripCode && t.trip_code !== manageTripCode) return false
        if (manageContainerSize && t.container_size !== manageContainerSize) return false
      }
      if (manageSearch) {
        const q = manageSearch.toLowerCase()
        if (![t.client, t.truck_plate, t.route, t.commodity, t.trip_code, t.smcsl_wb, t.waybill_no, t.smcsl_waybill_no, t.vessel, t.supplier_doc_ref].some(v => v?.toLowerCase().includes(q))) return false
      }
      return true
    })
    return [...base].sort((a, b) => {
      let av = a[manageSortKey] ?? '', bv = b[manageSortKey] ?? ''
      if (manageSortKey === 'amount') {
        av = manageTab === 'Dump Truck' ? (a.weight_tons||0)*(a.rate_per_ton||0) : (a.supplier_amount||0)+(a.stripping_fee||0)
        bv = manageTab === 'Dump Truck' ? (b.weight_tons||0)*(b.rate_per_ton||0) : (b.supplier_amount||0)+(b.stripping_fee||0)
      }
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      return av < bv ? (manageSortDir === 'asc' ? -1 : 1) : av > bv ? (manageSortDir === 'asc' ? 1 : -1) : 0
    })
  })()

  const agingDisplayed = invoices.filter(i => {
    if (i.status === 'Paid' || i.status === 'Returned') return false
    if (agingTruckType && i.truck_type !== agingTruckType) return false
    if (agingTripCode && i.trip_code !== agingTripCode) return false
    if (agingClient && i.client !== agingClient) return false
    if (!agingShowAll && Math.floor((new Date() - new Date(i.invoice_date)) / 86400000) < 30) return false
    return true
  })
  const allInvClients = [...new Set(invoices.map(i => i.client).filter(Boolean))].sort()
  const invoiceMap = Object.fromEntries(invoices.map(i => [i.id, i.invoice_no]))

  // ── HANDLERS ────────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!invoiceNo.trim()) { showToast('Please enter an invoice number.', 'error'); return }
    if (invoiceDupWarning) { showToast('Invoice number already used.', 'error'); return }
    if (!selectedClient) { showToast('Select a client first.', 'error'); return }
    if (billedTrips.length === 0) { showToast('Select at least one trip.', 'error'); return }
    if (truckType === 'Dump Truck') {
      const routes = [...new Set(billedTrips.map(t => t.route).filter(Boolean))]
      const comms = [...new Set(billedTrips.map(t => t.commodity).filter(Boolean))]
      if (routes.length > 1) showToast(`Note: Invoice includes ${routes.length} different routes.`, 'info')
      if (comms.length > 1) showToast(`Note: Invoice includes ${comms.length} different commodities.`, 'info')
    }
    setGenerating(true)
    // Hard pre-check — the unique constraint counts soft-deleted rows, so surface a clear
    // message instead of letting users hit a raw "invoices_invoice_no_key" DB error.
    const { data: existing } = await supabase.from('invoices').select('id,deleted_at,client').eq('invoice_no', invoiceNo.trim())
    if (existing && existing.length > 0) {
      const active = existing.find(i => !i.deleted_at)
      showToast(active
        ? `Invoice number ${invoiceNo.trim()} is already used by an active invoice (${active.client}). Use a different number.`
        : `Invoice number ${invoiceNo.trim()} belongs to a deleted invoice and cannot be reused. Restore it from Trash, or use a different number.`,
        'error')
      setGenerating(false); return
    }
    const { data: inv, error } = await supabase.from('invoices').insert({
      invoice_no: invoiceNo.trim(), invoice_date: invoiceDate,
      truck_type: truckType, trip_code: filterTripCode || '',
      client: selectedClient,
      billing_period_start: billedTrips[0]?.trip_date,
      billing_period_end: billedTrips[billedTrips.length - 1]?.trip_date,
      total_sales_net: totalNet, status: 'Invoiced', is_vat: isVatInvoice,
    }).select().maybeSingle()
    if (error) { showToast('Error: ' + error.message, 'error'); setGenerating(false); return }
    const tbl = truckType === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    await supabase.from(tbl).update({ invoice_id: inv.id }).in('id', billedTrips.map(t => t.id))
    logAudit('generate', 'Generated', 'Invoice', `Generated invoice ${invoiceNo} — ${selectedClient} (${truckType}) — ${billedTrips.length} trips — ₱${fmt(totalNet)} net${isVatInvoice ? ' (VAT)' : ''}`, inv?.id, profile?.id, profile?.full_name)
    showToast(`Invoice ${invoiceNo} generated.`)
    setSelectedIds([]); setInvoiceNo(''); setIsVatInvoice(false)
    fetchAll(); setTab('Invoice List')
    setGenerating(false)
  }

  const loadInvoiceTrips = async (inv) => {
    const tbl = inv.truck_type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    const [tripsRes, invRes] = await Promise.all([
      supabase.from(tbl).select('*').eq('invoice_id', inv.id).order('trip_date'),
      supabase.from('invoices').select('*').is('deleted_at', null).eq('id', inv.id).maybeSingle(),
    ])
    setInvoiceTrips(tripsRes.data || [])
    setEditingInvoice(invRes.data || inv)
  }

  const handleOverridePinCheck = async () => {
    if (!overridePinInput) { setOverridePinError('Enter your override PIN.'); return }
    setOverridePinChecking(true)
    const { data: match, error: pinErr } = await supabase.rpc('verify_override_pin', { p_pin: overridePinInput.toUpperCase() })
    if (pinErr) { setOverridePinError(pinErr.message?.includes('locked') ? pinErr.message : 'Invalid PIN. Access denied.'); setOverridePinChecking(false); return }
    if (!match) { setOverridePinError('Invalid PIN. Access denied.'); setOverridePinChecking(false); return }
    const action = overridePinModal?.action
    const inv = overridePinModal?.inv
    setOverridePinModal(null); setOverridePinInput(''); setOverridePinError(''); setOverridePinChecking(false)
    if (action === 'unlockInvoice') {
      const { error } = await supabase.rpc('lock_invoice', { p_invoice_id: inv.id, p_lock: false, p_pin: overridePinInput.toUpperCase() })
      if (error) showToast('Error: ' + error.message, 'error')
      else { showToast('Invoice unlocked.', 'info'); fetchAll() }
      return
    }
    if (action === 'addTrip') {
      const tbl = inv.truck_type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
      const { data } = await supabase.from(tbl).select('*').eq('client', inv.client).is('invoice_id', null).order('trip_date')
      const sorted = (data || []).sort((a,b) => { const av=(a.smcsl_wb||a.smcsl_waybill_no||a.waybill_no||a.trip_date||''); const bv=(b.smcsl_wb||b.smcsl_waybill_no||b.waybill_no||b.trip_date||''); return av.localeCompare(bv) })
      setAddTripCandidates(sorted); setAddTripSelected([]); setAddTripModal({ inv })
    } else if (action === 'deleteInvoice') {
      handleDeleteInvoice(inv)
    } else if (action === 'editInvoice') {
      setEditingInvoice({...inv})
    }
  }

  const handleAddTripsConfirm = async () => {
    if (!addTripSelected.length) return
    setAddTripSaving(true)
    const inv = addTripModal.inv
    const tbl = inv.truck_type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    await supabase.from(tbl).update({ invoice_id: inv.id }).in('id', addTripSelected)
    const { data: allTrips } = await supabase.from(tbl).select('*').eq('invoice_id', inv.id)
    let newNet = 0
    if (inv.truck_type === 'Dump Truck') { newNet = (allTrips||[]).reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0) }
    else { newNet = (allTrips||[]).reduce((s,t) => s+(t.supplier_amount||0)+(t.stripping_fee||0), 0); if (allTrips?.[0]?.trip_code === 'SMC') newNet = newNet / 1.12 }
    await supabase.from('invoices').update({ total_sales_net: newNet }).eq('id', inv.id)
    logAudit('destructive', 'Added Trips', 'Invoice', `Added ${addTripSelected.length} trip(s) to invoice ${inv.invoice_no} — new net: ₱${fmt(newNet)}`, inv.id, profile?.id, profile?.full_name)
    showToast(`${addTripSelected.length} trip(s) added. Invoice total updated.`)
    setAddTripSaving(false); setAddTripModal(null); setAddTripSelected([])
    const { data: updatedTrips } = await supabase.from(tbl).select('*').eq('invoice_id', inv.id).order('trip_date')
    const { data: updatedInv } = await supabase.from('invoices').select('*').is('deleted_at', null).eq('id', inv.id).maybeSingle()
    fetchAll()
    if (updatedTrips && updatedInv) setPreviewModal({ trips: updatedTrips, invoice: updatedInv })
  }

  const handleRateOverridePinCheck = async () => {
    if (!rateOverridePinInput) { setRateOverridePinError('Enter your override PIN.'); return }
    setRateOverridePinChecking(true)
    const { data: matchRate, error: pinErrRate } = await supabase.rpc('verify_override_pin', { p_pin: rateOverridePinInput.toUpperCase() })
    if (pinErrRate) { setRateOverridePinError(pinErrRate.message?.includes('locked') ? pinErrRate.message : 'Invalid PIN. Access denied.'); setRateOverridePinChecking(false); return }
    if (!matchRate) { setRateOverridePinError('Invalid PIN. Access denied.'); setRateOverridePinChecking(false); return }
    setRateOverrideGranted(true)
    setRateOverridePinModal(false); setRateOverridePinInput(''); setRateOverridePinError(''); setRateOverridePinChecking(false)
    showToast('Rate editing unlocked.', 'info')
  }

  const saveRates = async () => {
    if (!Object.keys(editingRates).length || !editingInvoice) return
    setSavingRates(true)
    const tbl = editingInvoice.truck_type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    const field = editingInvoice.truck_type === 'Dump Truck' ? 'rate_per_ton' : 'supplier_amount'
    await Promise.all(Object.entries(editingRates).map(([tripId, val]) =>
      supabase.from(tbl).update({ [field]: parseFloat(val) }).eq('id', tripId)
    ))
    const { data: updatedTrips } = await supabase.from(tbl).select('*').eq('invoice_id', editingInvoice.id)
    let newNet = 0
    if (editingInvoice.truck_type === 'Dump Truck') { newNet = (updatedTrips||[]).reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0) }
    else { newNet = (updatedTrips||[]).reduce((s,t) => s+(t.supplier_amount||0)+(t.stripping_fee||0), 0); if (updatedTrips?.[0]?.trip_code === 'SMC') newNet = newNet / 1.12 }
    await supabase.from('invoices').update({ total_sales_net: newNet }).eq('id', editingInvoice.id)
    logAudit('destructive', 'Edited Rates', 'Invoice', `Edited rates on ${Object.keys(editingRates).length} trip(s) in invoice ${editingInvoice.invoice_no} — new net: ₱${fmt(newNet)}`, editingInvoice.id, profile?.id, profile?.full_name)
    showToast(`Rates updated. New net: ₱${fmt(newNet)}`)
    setEditingRates({})
    await loadInvoiceTrips(editingInvoice)
    fetchAll(); setSavingRates(false)
  }

  const saveInvoiceUpdate = async () => {
    setSavingInvoice(true)
    if (editingInvoice.invoice_no) {
      const dupCheck = invoices.find(i => i.invoice_no === editingInvoice.invoice_no && i.id !== editingInvoice.id)
      if (dupCheck) { showToast(`Invoice number ${editingInvoice.invoice_no} is already used by another invoice.`, 'error'); setSavingInvoice(false); return }
    }
    const payload = { status: editingInvoice.status, remarks: editingInvoice.remarks || '', remarks_color: editingInvoice.remarks_color || null, invoice_no: editingInvoice.invoice_no, invoice_date: editingInvoice.invoice_date, updated_at: new Date().toISOString() }
    if (editingInvoice.status === 'Paid') { payload.actual_amount_credited = editingInvoice.actual_amount_credited || null; payload.date_credited = editingInvoice.date_credited || null }
    else { payload.actual_amount_credited = null; payload.date_credited = null }
    const { error } = await supabase.from('invoices').update(payload).eq('id', editingInvoice.id)
    if (error) showToast('Error.', 'error')
    else {
      await syncTripsClientPaid(editingInvoice.id, editingInvoice.status === 'Paid', editingInvoice.date_credited)
      logAudit('destructive', 'Updated', 'Invoice', `${editingInvoice.invoice_no} → ${editingInvoice.status} · ${editingInvoice.client}`, editingInvoice.id, profile?.id, profile?.full_name); setEditingInvoice(null); setInvoiceTrips([]); showToast('Invoice updated.'); fetchAll()
    }
    setSavingInvoice(false)
  }

  const handleRemoveTripFromInvoice = async (tripId, invId, type) => {
    setRemovingTripId(tripId)
    const tbl = type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    await supabase.from(tbl).update({ invoice_id: null }).eq('id', tripId)
    const remaining = invoiceTrips.filter(t => t.id !== tripId)
    if (remaining.length === 0) {
      await supabase.from('invoices').delete().eq('id', invId)
      showToast('Last trip removed — invoice deleted.', 'info')
      setEditingInvoice(null); setInvoiceTrips([])
    } else {
      let newNet = type === 'Dump Truck'
        ? remaining.reduce((s, t) => s + ((t.weight_tons || 0) * (t.rate_per_ton || 0)), 0)
        : remaining.reduce((s, t) => s + ((t.supplier_amount || 0) + (t.stripping_fee || 0)), 0)
      if (type !== 'Dump Truck' && remaining[0]?.trip_code === 'SMC') newNet = newNet / 1.12
      await supabase.from('invoices').update({ total_sales_net: newNet }).eq('id', invId)
      setInvoiceTrips(remaining)
      showToast('Trip removed from invoice.')
    }
    setRemovingTripId(null); fetchAll()
  }

  const handleDeleteInvoice = async (inv) => {
    const tbl = inv.truck_type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    await supabase.from(tbl).update({ invoice_id: null }).eq('invoice_id', inv.id)
    const { error } = await supabase.from('invoices').update({ deleted_at: new Date().toISOString() }).eq('id', inv.id)
    if (error) { showToast('Error deleting invoice: ' + error.message, 'error'); return }
    logAudit('destructive', 'Deleted', 'Invoice', `Deleted invoice ${inv.invoice_no} — ${inv.client} (${inv.truck_type}) — ₱${fmt(inv.total_sales_net||0)} net`, inv.id, profile?.id, profile?.full_name)
    showToast('Invoice moved to trash.')
    setDeleteInvoiceTarget(null); setEditingInvoice(null); fetchAll()
  }

  // Keeps trips_dump/trips_pm's own client_paid flag in sync with the invoice
  // they're billed on. Without this, marking an invoice Paid here never
  // touched the trip rows themselves — SubconTrips.js papered over the gap
  // by recomputing "paid" on the fly from invoice status for its own display,
  // but anything reading the trip rows directly (e.g. a viewer account) saw
  // stale/false data. This makes the trip-level column the real source of
  // truth instead of a display-only illusion.
  const syncTripsClientPaid = async (invoiceId, paid, dateCredited) => {
    if (!invoiceId) return
    const payload = paid
      ? { client_paid: true, client_paid_date: dateCredited || new Date().toISOString().slice(0, 10) }
      : { client_paid: false, client_paid_date: null }
    await Promise.all([
      supabase.from('trips_dump').update(payload).eq('invoice_id', invoiceId),
      supabase.from('trips_pm').update(payload).eq('invoice_id', invoiceId),
    ])
  }

  const handleMarkPaidConfirm = async () => {
    if (!markPaidModal) return
    setMarkPaidSaving(true)
    const dateCredited = markPaidDate || new Date().toISOString().slice(0,10)
    const payload = { status: 'Paid', date_credited: dateCredited, ...(markPaidAmount ? { actual_amount_credited: parseFloat(markPaidAmount) } : {}) }
    const { error } = await supabase.from('invoices').update(payload).eq('id', markPaidModal.inv.id)
    if (error) { showToast(error.message, 'error') }
    else { await syncTripsClientPaid(markPaidModal.inv.id, true, dateCredited); showToast('Marked as Paid.'); setMarkPaidModal(null); setMarkPaidDate(''); setMarkPaidAmount(''); fetchAll() }
    setMarkPaidSaving(false)
  }

  const handleBulkPaid = async () => {
    if (!bulkInvoices.length) return
    setBulkSaving(true)
    for (const inv of bulkInvoices) {
      const dateCredited = bulkDates[inv.id] || bulkOneDate || new Date().toISOString().slice(0,10)
      await supabase.from('invoices').update({ status: 'Paid', date_credited: dateCredited }).eq('id', inv.id)
      await syncTripsClientPaid(inv.id, true, dateCredited)
    }
    logAudit('destructive', 'Marked Paid', 'Invoice', `Marked ${bulkInvoices.length} invoice(s) as Paid`, null, profile?.id, profile?.full_name)
    showToast(`${bulkInvoices.length} invoice${bulkInvoices.length > 1 ? 's' : ''} marked as Paid.`)
    setBulkInvoices([]); setBulkDates({}); setBulkOneDate(''); fetchAll(); setBulkSaving(false)
  }

  const recalcInvoiceTotals = async (invoiceId, tbl) => {
    if (!invoiceId) return
    const { data: trips } = await supabase.from(tbl).select('*').is('deleted_at', null).eq('invoice_id', invoiceId)
    if (!trips?.length) return
    let newNet = tbl === 'trips_dump' ? trips.reduce((s,t) => s+(t.weight_tons||0)*(t.rate_per_ton||0), 0) : trips.reduce((s,t) => s+(parseFloat(t.supplier_amount)||0)+(parseFloat(t.stripping_fee)||0), 0)
    if (tbl === 'trips_pm' && trips[0]?.trip_code === 'SMC') newNet = newNet / 1.12
    await supabase.from('invoices').update({ total_sales_net: newNet }).eq('id', invoiceId)
  }

  const handleQuickEditSave = async () => {
    if (!quickEditTrip) return
    setQuickEditSaving(true)
    const tbl = manageTab === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    const { id, ...rest } = quickEditTrip
    // Build payload — only editable fields
    let payload = {}
    if (manageTab === 'Dump Truck') {
      payload = {
        trip_date: rest.trip_date, truck_plate: rest.truck_plate, client: rest.client,
        route: rest.route, commodity: rest.commodity,
        weight_tons: parseFloat(rest.weight_tons) || 0, rate_per_ton: parseFloat(rest.rate_per_ton) || 0,
        remarks: rest.remarks || '',
      }
    } else {
      payload = {
        trip_date: rest.trip_date, truck_plate: rest.truck_plate, client: rest.client,
        trip_code: rest.trip_code, container_size: rest.container_size,
        supplier_amount: parseFloat(rest.supplier_amount) || 0,
        stripping_fee: parseFloat(rest.stripping_fee) || 0,
        remarks: rest.remarks || '',
      }
    }
    const { error } = await supabase.from(tbl).update(payload).eq('id', id)
    if (error) { showToast('Error: ' + error.message, 'error'); setQuickEditSaving(false); return }
    logAudit('destructive', 'Edited', 'Trip', `Quick-edited ${manageTab} trip ${rest.truck_plate} ${rest.trip_date} (via Manage Trips)`, id, profile?.id, profile?.full_name)
    showToast('Trip updated.')
    setQuickEditTrip(null); setQuickEditSaving(false)
    fetchAll()
  }

  const handleBulkRateEdit = async () => {
    if (!bulkRate || !manageSelected.length) return
    setBulkRateSaving(true)
    const tbl = manageTab === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    const field = manageTab === 'Dump Truck' ? 'rate_per_ton' : 'supplier_amount'
    await supabase.from(tbl).update({ [field]: parseFloat(bulkRate) }).in('id', manageSelected)
    const affectedTrips = [...allDumpTrips, ...allPmTrips].filter(t => manageSelected.includes(t.id) && t.invoice_id)
    const affectedInvoiceIds = [...new Set(affectedTrips.map(t => t.invoice_id))]
    await Promise.all(affectedInvoiceIds.map(id => recalcInvoiceTotals(id, tbl)))
    showToast(`Rate updated for ${manageSelected.length} trip(s). Invoice totals recalculated.`)
    setBulkRateEdit(false); setBulkRate(''); setManageSelected([]); fetchAll(); setBulkRateSaving(false)
  }

  const handleDeleteManage = async () => {
    setDeletingManage(true)
    const tbl = manageTab === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
    const { error } = await supabase.rpc('bulk_delete_trips', { p_table: tbl, p_ids: manageSelected })
    if (error) showToast('Delete failed: ' + error.message, 'error')
    else { showToast(`${manageSelected.length} trip(s) deleted.`, 'info'); setManageSelected([]) }
    fetchAll(); setDeletingManage(false)
  }

  const triggerPrintFromPreview = () => setSigDialog(true)

  const doTriggerPrint = (sigs) => {
    setSigDialog(false)
    if (bulkExportSigPending) {
      setBulkExportSigPending(false)
      const invs = invoices.filter(i => bulkExportIds.includes(i.id))
      handleBulkExportExcel(invs, sigs)
      setBulkExportIds([])
      return
    }
    if (excelSigPending) {
      const { tripsData, invNo, invDate, client, type, isVat } = excelSigPending
      setExcelSigPending(null)
      handleSaveSOAExcel(tripsData, invNo, invDate, client, type, sigs, isVat)
      return
    }
    const el = document.getElementById('soa-preview-content')
    if (!el) return
    const styles = Array.from(document.styleSheets).map(ss => { try { return Array.from(ss.cssRules).map(r => r.cssText).join('\n') } catch(e) { return '' } }).join('\n')
    const win = window.open('', '_blank', 'width=1200,height=850')
    let sigHtml = ''
    if (sigs && sigs.length > 0) {
      const sigItems = sigs.map(s => '<div style="text-align:center;flex:1;padding:0 8px;"><div style="font-size:6pt;color:#888;margin-bottom:16px">' + s.label + ':</div><div style="border-top:1px solid #333;padding-top:3px;"><div style="font-weight:bold;font-size:7.5pt">' + s.name + '</div><div style="font-size:6.5pt;color:#FF1E00">' + (s.title||'') + '</div></div></div>').join('')
      sigHtml = '<div style="display:flex;justify-content:space-between;margin-top:24px;padding-top:8px;">' + sigItems + '</div>'
    }
    win.document.write(`<!DOCTYPE html><html><head><title>SOA-${previewModal?.invoice?.invoice_no||''}</title><style>${styles}@media print{@page{size:${printOrientation === 'portrait' ? 'portrait' : 'landscape'};margin:6mm}body{margin:0!important}.modal-overlay,.modal{display:block!important;position:static!important;background:none!important}}</style></head><body>${el.innerHTML}${sigHtml}</body></html>`)
    win.document.close(); win.focus(); setTimeout(() => { win.print() }, 800)
    setPrintAfterPreview(false)
  }

  // ── DUMP TRUCK SOA — ExcelJS worksheet builder (mirrors renderDumpSOA PDF layout) ──
  const buildDumpSOAWorksheet = (wb, tripsData, invNo, invDate, client, sigs = null, sheetName = 'SOA', isVat = false) => {
    const clientDetails = getClientDetails(client)
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const net = tripsData.reduce((s,t)=>s+((t.weight_tons||0)*(t.rate_per_ton||0)),0)
    const vat = isVat ? net * 0.12 : 0; const vatInc = isVat ? net * 1.12 : net
    const tons = tripsData.reduce((s,t)=>s+(parseFloat(t.weight_tons)||0),0)

    const ws = wb.addWorksheet(sheetName.slice(0,31))
    const COLS = 17
    ws.columns = [
      {width:13},{width:12},{width:14},{width:10},{width:11},{width:13},
      {width:9},{width:22},{width:9},{width:24},{width:11},{width:10},
      {width:9},{width:12},{width:11},{width:13},{width:13}
    ]

    const thin = { style:'thin', color:{argb:'FFAAAAAA'} }
    const allBorders = { top:thin, left:thin, bottom:thin, right:thin }
    const mergeRow = (r, text, opts={}) => {
      ws.mergeCells(r,1,r,COLS)
      const cell = ws.getCell(r,1)
      cell.value = text
      cell.alignment = { horizontal: opts.align||'center', vertical:'middle' }
      cell.font = { bold: !!opts.bold, size: opts.size||9, italic: !!opts.italic, color: opts.color?{argb:opts.color}:undefined }
      if (opts.fill) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:opts.fill} }
      if (opts.border) cell.border = opts.border
      ws.getRow(r).height = opts.height || 16
    }

    let r = 1
    mergeRow(r, companyName, { bold:true, size:13 }); r++
    if (settings.vat_tin) { mergeRow(r, `VAT REG.TIN: ${settings.vat_tin}`, { size:8 }); r++ }
    if (settings.address) { mergeRow(r, `ADDRESS: ${settings.address.toUpperCase()}`, { size:8 }); r++ }
    if (settings.contact) { mergeRow(r, `CONTACT INFO: ${settings.contact}${settings.email?' / '+settings.email:''}`, { size:8 }); r++ }
    mergeRow(r, 'STATEMENT OF ACCOUNTS', { bold:true, size:11, border:{ bottom:{style:'medium', color:{argb:'FF000000'}} } }); r++

    // Customer / invoice info block — 3 rows, left = customer, right = TIN/date/inv#
    const custRow1 = r
    ws.mergeCells(r,1,r,8); ws.mergeCells(r,9,r,COLS)
    ws.getCell(r,1).value = "CUSTOMER'S NAME:"
    ws.getCell(r,1).font = { size:7, color:{argb:'FF888888'} }
    ws.getCell(r,9).value = clientDetails?.tin ? `TIN: ${clientDetails.tin}` : ''
    ws.getCell(r,9).alignment = { horizontal:'right' }
    ws.getCell(r,9).font = { size:8 }
    r++
    ws.mergeCells(r,1,r,8); ws.mergeCells(r,9,r,COLS)
    ws.getCell(r,1).value = (clientDetails?.full_name || client || '').toUpperCase()
    ws.getCell(r,1).font = { bold:true, size:11 }
    ws.getCell(r,9).value = `INVOICE DATE: ${fmtDate(invDate).toUpperCase()}`
    ws.getCell(r,9).alignment = { horizontal:'right' }
    ws.getCell(r,9).font = { size:8 }
    r++
    ws.mergeCells(r,1,r,8); ws.mergeCells(r,9,r,COLS)
    if (clientDetails?.address) {
      ws.getCell(r,1).value = `ADDRESS: ${clientDetails.address.toUpperCase()}`
      ws.getCell(r,1).font = { size:8, color:{argb:'FF444444'} }
    }
    ws.getCell(r,9).value = `SALES INV #: ${invNo}`
    ws.getCell(r,9).alignment = { horizontal:'right' }
    ws.getCell(r,9).font = { bold:true, size:11 }
    r++
    r++ // spacer row before table

    // ── Table header (2 rows) ──
    const hdrRow1 = r, hdrRow2 = r+1
    const blackHdr = (cell, text, size=7) => {
      cell.value = text
      cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size }
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF000000'} }
      cell.border = allBorders
    }
    const grayHdr = (cell, text, size=7) => {
      cell.value = text
      cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size }
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF333333'} }
      cell.border = allBorders
    }
    // Row-spanning headers (cols 1,2,3,6,13,14,15,16,17)
    ;[[1,'TRANSACTION DATE'],[2,'SMCSL WB'],[3,'SUPPLIER DOC REFERENCE'],[6,'COMMODITY TYPE'],
      [13,'RATE'],[14,'RMSD/SMFI SAF DR'],[15,'STO NO'],[16,'SVC PO SUPPLIER AMOUNT'],[17,'TOTAL AMOUNT']
    ].forEach(([c,label]) => {
      ws.mergeCells(hdrRow1,c,hdrRow2,c)
      blackHdr(ws.getCell(hdrRow1,c), label)
    })
    // TRUCK DR (cols 4-5)
    ws.mergeCells(hdrRow1,4,hdrRow1,5); blackHdr(ws.getCell(hdrRow1,4), 'TRUCK DR')
    // FROM (cols 7-8)
    ws.mergeCells(hdrRow1,7,hdrRow1,8); blackHdr(ws.getCell(hdrRow1,7), 'FROM')
    // DESTINATION (cols 9-12)
    ws.mergeCells(hdrRow1,9,hdrRow1,12); blackHdr(ws.getCell(hdrRow1,9), 'DESTINATION')
    // Second header row labels
    const row2Labels = { 4:'TRUCK PLATE', 5:'TRUCK', 7:'ISLAND ZONE', 8:'ISLAND ORIGIN CODE', 9:'ISLAND ZONE', 10:'ISLAND DEST. CODE MIN DAVAO PLANT', 11:'QTY DESTINATION', 12:'DEST. WEIGHT IN TONS' }
    Object.entries(row2Labels).forEach(([c,label]) => grayHdr(ws.getCell(hdrRow2, parseInt(c)), label))
    ws.getRow(hdrRow1).height = 28
    ws.getRow(hdrRow2).height = 28
    r = hdrRow2 + 1

    // ── Data rows ──
    const dataStartRow = r
    tripsData.forEach((t, i) => {
      const amt = (t.weight_tons||0)*(t.rate_per_ton||0)
      const qty = calcQtyDest(t.weight_tons)
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2'
      const rowVals = [
        fmtDate(t.trip_date).toUpperCase(), t.smcsl_wb||'', t.supplier_doc_ref||'',
        t.truck_plate, 'DUMP TRUCK', (t.commodity||'').toUpperCase(),
        t.island_zone_origin||'MIN', (t.island_origin_code||'').toUpperCase(),
        t.island_zone_dest||'MIN', (t.island_dest_code||'MIN DAVAO PLANT').toUpperCase(),
        qty, Number(t.weight_tons||0), Number(t.rate_per_ton||0),
        t.rmsd_smfi_saf_dr||'', t.sto_no||'', amt, amt
      ]
      const row = ws.getRow(r)
      rowVals.forEach((v, ci) => {
        const cell = row.getCell(ci+1)
        cell.value = v
        cell.font = { size:9, bold: ci===3 || ci===15 || ci===16 }
        cell.alignment = { horizontal: [10,11,12,15,16].includes(ci) ? 'right' : 'center', vertical:'middle' }
        cell.border = allBorders
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:bg} }
        // Text-force columns to avoid scientific notation (A,B,C,N,O = idx 0,1,2,13,14)
        if ([0,1,2,13,14].includes(ci)) cell.numFmt = '@'
        if (ci===11) cell.numFmt = '0.000' // weight tons
        if (ci===12) cell.numFmt = '#,##0.00' // rate
        if (ci===15 || ci===16) cell.numFmt = '#,##0.00' // amounts
        if (ci===10) cell.numFmt = '#,##0' // qty
      })
      r++
    })
    const dataEndRow = r - 1

    // ── Total tons row ──
    const tonsRow = r
    ws.getCell(tonsRow,12).value = tons
    ws.getCell(tonsRow,12).numFmt = '0.000'
    ws.getCell(tonsRow,12).font = { bold:true, size:9 }
    ws.getCell(tonsRow,12).alignment = { horizontal:'right' }
    ws.getCell(tonsRow,12).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF5F5F5'} }
    ws.getCell(tonsRow,12).border = { top:{style:'thin',color:{argb:'FF888888'}} }
    r++

    // ── Amount in words + GRAND TOTAL / VAT 12% / VAT N ──
    const totalsStartRow = r
    ws.mergeCells(r,1,r+2,9)
    ws.getCell(r,1).value = numberToWords(net).toUpperCase()
    ws.getCell(r,1).font = { bold:true, italic:true, size:9 }
    ws.getCell(r,1).alignment = { horizontal:'left', vertical:'bottom', wrapText:true }

    const totalsLabels = [['GRAND TOTAL', net, true],[isVat ? 'VAT (12%)' : 'VAT (Non-VAT)', vat, false],['TOTAL SALES', vatInc, false]]
    totalsLabels.forEach(([label, val, bold], idx) => {
      const rr = totalsStartRow + idx
      ws.mergeCells(rr,10,rr,14)
      ws.mergeCells(rr,15,rr,17)
      const lc = ws.getCell(rr,10); lc.value = label
      lc.alignment = { horizontal:'right' }; lc.font = { bold, size:9 }
      const vc = ws.getCell(rr,15); vc.value = val; vc.numFmt = '#,##0.00'
      vc.alignment = { horizontal:'right' }; vc.font = { bold, size:9 }
      if (idx===0) {
        lc.border = { top:{style:'thin',color:{argb:'FF000000'}} }
        vc.border = { top:{style:'thin',color:{argb:'FF000000'}} }
      }
    })
    r = totalsStartRow + 3 + 1 // spacer

    // ── Signatures ──
    if (sigs && sigs.length > 0) {
      r++
      const sigCols = Math.floor(COLS / sigs.length)
      const sigRowLabel = r, sigRowGap = r+1, sigRowName = r+2, sigRowTitle = r+3
      sigs.forEach((s, i) => {
        const startCol = i*sigCols + 1
        const endCol = (i === sigs.length-1) ? COLS : startCol + sigCols - 1
        ws.mergeCells(sigRowLabel, startCol, sigRowLabel, endCol)
        const lc = ws.getCell(sigRowLabel, startCol)
        lc.value = `${s.label}:`
        lc.font = { size:7, color:{argb:'FF888888'} }
        lc.alignment = { horizontal:'center' }

        ws.mergeCells(sigRowGap, startCol, sigRowGap, endCol)
        ws.getRow(sigRowGap).height = 22

        ws.mergeCells(sigRowName, startCol, sigRowName, endCol)
        const nc = ws.getCell(sigRowName, startCol)
        nc.value = s.name
        nc.font = { bold:true, size:8.5 }
        nc.alignment = { horizontal:'center' }
        nc.border = { top:{style:'thin', color:{argb:'FF333333'}} }

        if (s.title) {
          ws.mergeCells(sigRowTitle, startCol, sigRowTitle, endCol)
          const tc = ws.getCell(sigRowTitle, startCol)
          tc.value = s.title
          tc.font = { size:7.5, color:{argb:'FFFF1E00'} }
          tc.alignment = { horizontal:'center' }
        }
      })
    }

    ws.views = [{ showGridLines: false }]
    return ws
  }

  // ── PM SOA — ExcelJS worksheet builder (mirrors renderPMSOA PDF layout) ──
  const buildPMSOAWorksheet = (wb, tripsData, invNo, invDate, client, sigs = null, sheetName = 'SOA', isVat = false) => {
    const clientDetails = getClientDetails(client)
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const codes = ['Hustling PSACC', 'Hauling PSACC', 'SMC']
    const tripsByCode = {}
    codes.forEach(c => { tripsByCode[c] = tripsData.filter(t => t.trip_code === c) })
    const grandTotal = tripsData.reduce((s,t) => s + (t.supplier_amount||0) + (t.stripping_fee||0), 0)
    const allSMC = tripsData.length > 0 && tripsData.every(t => t.trip_code === 'SMC')
    const vatable = allSMC ? grandTotal / 1.12 : grandTotal
    const vat12 = isVat ? vatable * 0.12 : 0
    const totalAmt = isVat ? vatable * 1.12 : vatable
    const twas = vatable * 0.02
    const netAmount = totalAmt - twas

    const COLS = 16
    const ws = wb.addWorksheet(sheetName.slice(0,31))
    ws.columns = [
      {width:11},{width:11},{width:10},{width:14},{width:13},{width:13},
      {width:16},{width:16},{width:18},{width:18},{width:11},{width:11},
      {width:13},{width:13},{width:11},{width:11}
    ]

    const thin = { style:'thin', color:{argb:'FFAAAAAA'} }
    const allBorders = { top:thin, left:thin, bottom:thin, right:thin }
    const mergeRow = (r, text, opts={}) => {
      ws.mergeCells(r,1,r,COLS)
      const cell = ws.getCell(r,1)
      cell.value = text
      cell.alignment = { horizontal: opts.align||'center', vertical:'middle' }
      cell.font = { bold: !!opts.bold, size: opts.size||9, italic: !!opts.italic, color: opts.color?{argb:opts.color}:undefined }
      if (opts.border) cell.border = opts.border
      ws.getRow(r).height = opts.height || 16
    }

    let r = 1
    mergeRow(r, companyName, { bold:true, size:13 }); r++
    if (settings.vat_tin) { mergeRow(r, `VAT REG.TIN: ${settings.vat_tin}`, { size:8 }); r++ }
    if (settings.address) { mergeRow(r, `ADDRESS: ${settings.address.toUpperCase()}`, { size:8 }); r++ }
    if (settings.contact) { mergeRow(r, `CONTACT INFO: ${settings.contact}${settings.email?' / '+settings.email:''}`, { size:8 }); r++ }
    mergeRow(r, 'STATEMENT OF ACCOUNTS', { bold:true, size:11, border:{ bottom:{style:'medium', color:{argb:'FF000000'}} } }); r++

    // Customer / invoice info block — 3 rows
    ws.mergeCells(r,1,r,8); ws.mergeCells(r,9,r,COLS)
    ws.getCell(r,1).value = "CUSTOMER'S NAME:"
    ws.getCell(r,1).font = { size:7, color:{argb:'FF888888'} }
    ws.getCell(r,9).value = clientDetails?.tin ? `TIN: ${clientDetails.tin}` : ''
    ws.getCell(r,9).alignment = { horizontal:'right' }
    ws.getCell(r,9).font = { size:8 }
    r++
    ws.mergeCells(r,1,r,8); ws.mergeCells(r,9,r,COLS)
    ws.getCell(r,1).value = (clientDetails?.full_name || client || '').toUpperCase()
    ws.getCell(r,1).font = { bold:true, size:11 }
    ws.getCell(r,9).value = `INVOICE DATE: ${fmtDate(invDate).toUpperCase()}`
    ws.getCell(r,9).alignment = { horizontal:'right' }
    ws.getCell(r,9).font = { size:8 }
    r++
    ws.mergeCells(r,1,r,8); ws.mergeCells(r,9,r,COLS)
    if (clientDetails?.address) {
      ws.getCell(r,1).value = `ADDRESS: ${clientDetails.address.toUpperCase()}`
      ws.getCell(r,1).font = { size:8, color:{argb:'FF444444'} }
    }
    ws.getCell(r,9).value = `SALES INV #: ${invNo}`
    ws.getCell(r,9).alignment = { horizontal:'right' }
    ws.getCell(r,9).font = { bold:true, size:11 }
    r++
    r++ // spacer

    const headerCell = (cell, text, fill='FF000000') => {
      cell.value = text
      cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:7 }
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:fill} }
      cell.border = allBorders
    }
    const dataCell = (cell, val, bg, opts={}) => {
      cell.value = val
      cell.font = { size:8.5, bold: !!opts.bold }
      cell.alignment = { horizontal: opts.align||'center', vertical:'middle', wrapText:true }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:bg} }
      cell.border = allBorders
      if (opts.numFmt) cell.numFmt = opts.numFmt
    }

    const SMC_EXTRA = ['SMCSL WAYBILL NO.','SUPPLIER DOC','TRANSACTION TYPE','PORT OF ORIGIN','PORT OF DESTINATION','SHIPPER ADDRESS','CONSIGNEE ADDRESS','CON VAN NO.','SEAL NO.','COMMODITY','SUPPLIER AMT (VAT INC.)','STRIPPING FEE','TOTAL']
    const HUSTLING_EXTRA = ['WAYBILL','VESSEL','CTS NO.','VOYAGE','FROM-TO','VAN NO.','STATUS','SUPPLIER AMT']
    const HAULING_EXTRA = ['VAN NO.','VESSEL','WAYBILL','VOYAGE','EMR DATE','DATE COMPLETION','CONSIGNEE','EMR NO.','BL NO.','SUPPLIER AMT']

    codes.forEach(code => {
      const codeTrips = tripsByCode[code]
      if (!codeTrips?.length) return
      const isSMC = code === 'SMC', isHustling = code === 'Hustling PSACC', isHauling = code === 'Hauling PSACC'
      const extra = isSMC ? SMC_EXTRA : isHustling ? HUSTLING_EXTRA : HAULING_EXTRA
      const totalUsedCols = 3 + extra.length

      // Section title
      ws.mergeCells(r,1,r,COLS)
      const titleCell = ws.getCell(r,1)
      titleCell.value = code.toUpperCase()
      titleCell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:8.5 }
      titleCell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF333333'} }
      titleCell.alignment = { vertical:'middle' }
      r++

      // Header row
      const headerRow = r
      headerCell(ws.getCell(headerRow,1), 'TRANSACTION DATE')
      headerCell(ws.getCell(headerRow,2), 'TRUCK PLATE')
      headerCell(ws.getCell(headerRow,3), 'CONTAINER SIZE')
      extra.forEach((label,i) => headerCell(ws.getCell(headerRow,4+i), label))
      ws.getRow(headerRow).height = 26
      r++

      // Data rows
      const codeSupTotal = codeTrips.reduce((s,t)=>{const c=t.containers||[];return c.length>0?s+c.reduce((cs,c2)=>cs+(parseFloat(c2.supplier_amount)||0),0):s+(parseFloat(t.supplier_amount)||0)},0)
      const codeStripTotal = isSMC ? codeTrips.reduce((s,t)=>{const c=t.containers||[];return c.length>0?s+c.reduce((cs,c2)=>cs+(parseFloat(c2.stripping_fee)||0),0):s+(parseFloat(t.stripping_fee)||0)},0) : 0
      const codeTotal = codeSupTotal + codeStripTotal

      codeTrips.forEach((t, i) => {
        const containers = t.containers || []
        const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2'

        if (isHustling) {
          if (containers.length > 1) {
            containers.forEach((c, ci) => {
              const isFirst = ci === 0
              const row = ws.getRow(r)
              dataCell(row.getCell(1), isFirst?fmtDate(t.trip_date).toUpperCase():'', bg)
              dataCell(row.getCell(2), isFirst?t.truck_plate:'', bg, {bold:true})
              dataCell(row.getCell(3), t.container_size, bg)
              dataCell(row.getCell(4), isFirst?(t.waybill_no||'—'):'', bg)
              dataCell(row.getCell(5), isFirst?(t.vessel||'—'):'', bg)
              dataCell(row.getCell(6), c.cts_no||'—', bg)
              dataCell(row.getCell(7), c.voyage||'—', bg)
              dataCell(row.getCell(8), c.from_to||'—', bg)
              dataCell(row.getCell(9), c.van_no||'—', bg)
              dataCell(row.getCell(10), c.van_status||t.van_status||'—', bg)
              dataCell(row.getCell(11), parseFloat(c.supplier_amount)||0, bg, {align:'right', numFmt:'#,##0.00'})
              r++
            })
          } else {
            const row = ws.getRow(r)
            const c0 = containers[0]
            dataCell(row.getCell(1), fmtDate(t.trip_date).toUpperCase(), bg)
            dataCell(row.getCell(2), t.truck_plate, bg, {bold:true})
            dataCell(row.getCell(3), t.container_size, bg)
            dataCell(row.getCell(4), t.waybill_no||'—', bg)
            dataCell(row.getCell(5), t.vessel||'—', bg)
            dataCell(row.getCell(6), c0?.cts_no||'—', bg)
            dataCell(row.getCell(7), c0?.voyage||'—', bg)
            dataCell(row.getCell(8), c0?.from_to||'—', bg)
            dataCell(row.getCell(9), c0?.van_no||'—', bg)
            dataCell(row.getCell(10), c0?.van_status||t.van_status||'—', bg)
            dataCell(row.getCell(11), parseFloat(c0?.supplier_amount ?? t.supplier_amount)||0, bg, {align:'right', numFmt:'#,##0.00'})
            r++
          }
        } else if (isHauling) {
          const c0 = containers[0]
          const cSup = parseFloat(c0?.supplier_amount ?? t.supplier_amount)||0
          const row = ws.getRow(r)
          dataCell(row.getCell(1), fmtDate(t.trip_date).toUpperCase(), bg)
          dataCell(row.getCell(2), t.truck_plate, bg, {bold:true})
          dataCell(row.getCell(3), t.container_size, bg)
          dataCell(row.getCell(4), c0?.van_no||'—', bg)
          dataCell(row.getCell(5), t.vessel||'—', bg)
          dataCell(row.getCell(6), t.waybill_no||'—', bg)
          dataCell(row.getCell(7), t.voyage||'—', bg)
          dataCell(row.getCell(8), t.emr_date?fmtDate(t.emr_date):'—', bg)
          dataCell(row.getCell(9), t.date_completion?fmtDate(t.date_completion):'—', bg)
          dataCell(row.getCell(10), t.consignee||'—', bg)
          dataCell(row.getCell(11), c0?.emr_no||'—', bg)
          dataCell(row.getCell(12), c0?.bl_no||'—', bg)
          dataCell(row.getCell(13), cSup, bg, {align:'right', numFmt:'#,##0.00'})
          r++
        } else {
          // SMC
          const is20ftMulti = t.container_size === '20ft' && containers.length > 1
          if (is20ftMulti) {
            containers.forEach((c, ci) => {
              const isFirst = ci === 0
              const cSup = parseFloat(c.supplier_amount)||0
              const cStrip = parseFloat(c.stripping_fee)||0
              const row = ws.getRow(r)
              dataCell(row.getCell(1), isFirst?fmtDate(t.trip_date).toUpperCase():'', bg)
              dataCell(row.getCell(2), isFirst?t.truck_plate:'', bg, {bold:true})
              dataCell(row.getCell(3), t.container_size, bg)
              dataCell(row.getCell(4), isFirst?(t.smcsl_waybill_no||'—'):'', bg, {numFmt:'@'})
              dataCell(row.getCell(5), isFirst?(t.supplier_doc||'—'):'', bg, {numFmt:'@'})
              dataCell(row.getCell(6), isFirst?(t.transaction_type||'—'):'', bg)
              dataCell(row.getCell(7), isFirst?(t.port_origin||'—'):'', bg)
              dataCell(row.getCell(8), isFirst?(t.port_destination||'—'):'', bg)
              dataCell(row.getCell(9), isFirst?(t.shipper_address||'—'):'', bg)
              dataCell(row.getCell(10), isFirst?(t.consignee_address||'—'):'', bg)
              dataCell(row.getCell(11), c.con_van_no||c.van_no||'—', bg)
              dataCell(row.getCell(12), c.seal_no||'—', bg, {numFmt:'@'})
              dataCell(row.getCell(13), c.commodity||t.commodity||'—', bg)
              dataCell(row.getCell(14), cSup, bg, {align:'right', numFmt:'#,##0.00'})
              dataCell(row.getCell(15), cStrip||'—', bg, {align:'right', numFmt: cStrip?'#,##0.00':'@'})
              dataCell(row.getCell(16), cSup+cStrip, bg, {align:'right', numFmt:'#,##0.00', bold:true})
              r++
            })
          } else {
            const c0 = containers[0]
            const cSup = parseFloat(c0?.supplier_amount ?? t.supplier_amount)||0
            const cStrip = parseFloat(c0?.stripping_fee ?? t.stripping_fee)||0
            const row = ws.getRow(r)
            dataCell(row.getCell(1), fmtDate(t.trip_date).toUpperCase(), bg)
            dataCell(row.getCell(2), t.truck_plate, bg, {bold:true})
            dataCell(row.getCell(3), t.container_size, bg)
            dataCell(row.getCell(4), t.smcsl_waybill_no||'—', bg, {numFmt:'@'})
            dataCell(row.getCell(5), t.supplier_doc||'—', bg, {numFmt:'@'})
            dataCell(row.getCell(6), t.transaction_type||'—', bg)
            dataCell(row.getCell(7), t.port_origin||'—', bg)
            dataCell(row.getCell(8), t.port_destination||'—', bg)
            dataCell(row.getCell(9), t.shipper_address||'—', bg)
            dataCell(row.getCell(10), t.consignee_address||'—', bg)
            dataCell(row.getCell(11), c0?.con_van_no||c0?.van_no||'—', bg)
            dataCell(row.getCell(12), c0?.seal_no||'—', bg, {numFmt:'@'})
            dataCell(row.getCell(13), c0?.commodity||t.commodity||'—', bg)
            dataCell(row.getCell(14), cSup, bg, {align:'right', numFmt:'#,##0.00'})
            dataCell(row.getCell(15), cStrip||'—', bg, {align:'right', numFmt: cStrip?'#,##0.00':'@'})
            dataCell(row.getCell(16), cSup+cStrip, bg, {align:'right', numFmt:'#,##0.00', bold:true})
            r++
          }
        }
      })

      // TOTAL row for this section
      const totalRow = r
      const grayFill = 'FFF5F5F5'
      if (isSMC) {
        ws.mergeCells(totalRow,1,totalRow,13)
        const lc = ws.getCell(totalRow,1)
        lc.value = 'TOTAL'; lc.font = { bold:true, size:9 }; lc.alignment = { horizontal:'right' }
        lc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:grayFill} }; lc.border = allBorders
        ;[ [14,codeSupTotal], [15,codeStripTotal], [16,codeTotal] ].forEach(([c,v]) => {
          const cell = ws.getCell(totalRow,c)
          cell.value = v; cell.numFmt = '#,##0.00'; cell.font = { bold:true, size:9 }
          cell.alignment = { horizontal:'right' }
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:grayFill} }; cell.border = allBorders
        })
      } else {
        ws.mergeCells(totalRow,1,totalRow,totalUsedCols-1)
        const lc = ws.getCell(totalRow,1)
        lc.value = 'TOTAL'; lc.font = { bold:true, size:9 }; lc.alignment = { horizontal:'right' }
        lc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:grayFill} }; lc.border = allBorders
        const vc = ws.getCell(totalRow,totalUsedCols)
        vc.value = codeSupTotal; vc.numFmt = '#,##0.00'; vc.font = { bold:true, size:9 }
        vc.alignment = { horizontal:'right' }
        vc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:grayFill} }; vc.border = allBorders
      }
      r++
      r++ // spacer between sections
    })

    // ── Amount in words + GRAND TOTAL / VATABLE / 12% VAT / TOTAL AMOUNT / TWAS / NET AMOUNT ──
    const totalsStartRow = r
    ws.mergeCells(r,1,r+5,9)
    ws.getCell(r,1).value = numberToWords(netAmount).toUpperCase()
    ws.getCell(r,1).font = { bold:true, italic:true, size:9 }
    ws.getCell(r,1).alignment = { horizontal:'left', vertical:'bottom', wrapText:true }

    const totalsRows = [
      ['GRAND TOTAL', grandTotal, true, false],
      ['VATABLE', vatable, false, false],
      [isVat ? 'VAT (12%)' : 'VAT (Non-VAT)', vat12, false, false],
      ['TOTAL AMOUNT', totalAmt, true, false],
      ['TWAS', twas, false, false],
      ['NET AMOUNT', netAmount, true, true],
    ]
    totalsRows.forEach(([label, val, bold, isRed], idx) => {
      const rr = totalsStartRow + idx
      ws.mergeCells(rr,10,rr,13)
      ws.mergeCells(rr,14,rr,16)
      const lc = ws.getCell(rr,10); lc.value = label
      lc.alignment = { horizontal:'right' }
      lc.font = { bold, size:9, color: isRed?{argb:'FFCC0000'}:undefined }
      const vc = ws.getCell(rr,14); vc.value = val; vc.numFmt = '#,##0.00'
      vc.alignment = { horizontal:'right' }
      vc.font = { bold, size:9, color: isRed?{argb:'FFCC0000'}:undefined }
      if (label === 'TOTAL AMOUNT' || label === 'NET AMOUNT') {
        lc.border = { top:{style:'thin',color:{argb:'FF000000'}} }
        vc.border = { top:{style:'thin',color:{argb:'FF000000'}} }
      }
    })
    r = totalsStartRow + 6 + 1 // spacer

    // ── Signatures ──
    if (sigs && sigs.length > 0) {
      r++
      const sigCols = Math.floor(COLS / sigs.length)
      const sigRowLabel = r, sigRowGap = r+1, sigRowName = r+2, sigRowTitle = r+3
      sigs.forEach((s, i) => {
        const startCol = i*sigCols + 1
        const endCol = (i === sigs.length-1) ? COLS : startCol + sigCols - 1
        ws.mergeCells(sigRowLabel, startCol, sigRowLabel, endCol)
        const lc = ws.getCell(sigRowLabel, startCol)
        lc.value = `${s.label}:`
        lc.font = { size:7, color:{argb:'FF888888'} }
        lc.alignment = { horizontal:'center' }

        ws.mergeCells(sigRowGap, startCol, sigRowGap, endCol)
        ws.getRow(sigRowGap).height = 22

        ws.mergeCells(sigRowName, startCol, sigRowName, endCol)
        const nc = ws.getCell(sigRowName, startCol)
        nc.value = s.name
        nc.font = { bold:true, size:8.5 }
        nc.alignment = { horizontal:'center' }
        nc.border = { top:{style:'thin', color:{argb:'FF333333'}} }

        if (s.title) {
          ws.mergeCells(sigRowTitle, startCol, sigRowTitle, endCol)
          const tc = ws.getCell(sigRowTitle, startCol)
          tc.value = s.title
          tc.font = { size:7.5, color:{argb:'FFFF1E00'} }
          tc.alignment = { horizontal:'center' }
        }
      })
    }

    ws.views = [{ showGridLines: false }]
    return ws
  }

  const handleSaveSOAExcel = async (tripsData, invNo, invDate, client, type, sigs = null, isVat = false) => {
    const wb = new ExcelJS.Workbook()
    if (type === 'Dump Truck') {
      buildDumpSOAWorksheet(wb, tripsData, invNo, invDate, client, sigs, `SOA-${invNo}`, isVat)
    } else {
      buildPMSOAWorksheet(wb, tripsData, invNo, invDate, client, sigs, `SOA-${invNo}`, isVat)
    }
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `SOA-${invNo}-${client}.xlsx`; a.click(); URL.revokeObjectURL(url)
    showToast('Excel exported.')
  }

  const handleBulkExportExcel = async (invoicesToExport, sigs = null) => {
    if (!invoicesToExport?.length) return
    setBulkExporting(true)
    const wb = new ExcelJS.Workbook()
    const usedNames = new Set()
    let errors = 0
    const sanitizeName = (raw) => {
      let name = String(raw).replace(/[\\/?*[\]:]/g, '-').slice(0, 31)
      let finalName = name; let n = 2
      while (usedNames.has(finalName)) { finalName = (name.slice(0, 28) + '-' + n).slice(0, 31); n++ }
      usedNames.add(finalName)
      return finalName
    }
    for (const inv of invoicesToExport) {
      const tbl = inv.truck_type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
      const { data: trips, error } = await supabase.from(tbl).select('*').eq('invoice_id', inv.id).order('trip_date')
      if (error || !trips?.length) { errors++; continue }
      try {
        const sheetName = sanitizeName(inv.invoice_no || inv.id)
        if (inv.truck_type === 'Dump Truck') {
          buildDumpSOAWorksheet(wb, trips, inv.invoice_no, inv.invoice_date, inv.client, sigs, sheetName, inv.is_vat)
        } else {
          buildPMSOAWorksheet(wb, trips, inv.invoice_no, inv.invoice_date, inv.client, sigs, sheetName, inv.is_vat)
        }
      } catch (e) { console.error('Sheet build error for', inv.invoice_no, e); errors++ }
    }
    if (wb.worksheets.length === 0) {
      showToast('No data to export.', 'error')
      setBulkExporting(false)
      return
    }
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `FMS-Bulk-SOA-${new Date().toISOString().slice(0,10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    showToast(`Exported ${wb.SheetNames.length} sheet${wb.SheetNames.length!==1?'s':''}.${errors?` (${errors} skipped)`:''}`, errors?'info':'info')
    setBulkExporting(false)
  }

  const handleSaveSOAPDF = (tripsOverride, invNoOverride, invDateOverride, clientOverride, typeOverride) => {
    const trips2 = tripsOverride || billedTrips
    const invNo2 = invNoOverride || invoiceNo
    const invDate2 = invDateOverride || invoiceDate
    const client2 = clientOverride || selectedClient
    const type2 = typeOverride || truckType
    setPrintAfterPreview(true)
    setPreviewModal({ trips: trips2, invoice: { id: 'print', invoice_no: invNo2, invoice_date: invDate2, client: client2, truck_type: type2 } })
  }

  const handleRecalcAll = async () => {
    if (filteredInvoices.length === 0) return
    setRecalcingAll(true)
    let done = 0; let errors = 0
    for (const inv of filteredInvoices) {
      if (inv.status === 'Paid') continue
      const tbl = inv.truck_type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
      const { error } = await supabase.rpc('recalc_invoice_total', { p_invoice_id: inv.id, p_table: tbl })
      if (error) errors++; else done++
    }
    await fetchAll()
    setRecalcingAll(false)
    showToast(errors > 0 ? `Recalculated ${done}, ${errors} errors.` : `${done} invoice${done !== 1 ? 's' : ''} recalculated.`, errors > 0 ? 'error' : 'info')
  }

  const handleARExcel = (client, clientInvoices) => {
    const f2 = n => Number(n||0).toFixed(2)
    const headers = ['Invoice No.', 'Date', 'Type', 'Net Sales', 'VAT', 'Total Sales', 'W/Tax (2%)', 'Total Due', 'Amt Received', 'Date Credited', 'Status', 'Remarks']
    const rowCalcs = clientInvoices.sort((a,b) => new Date(a.invoice_date)-new Date(b.invoice_date)).map(inv => {
      const net = inv.total_sales_net||0
      const vatAmt = inv.is_vat ? net * 0.12 : 0
      const vatInc = inv.is_vat ? net * 1.12 : net
      const wtax = net * 0.02
      const due = vatInc - wtax
      const received = inv.actual_amount_credited || (inv.status==='Paid' ? due : 0)
      return { inv, net, vatAmt, vatInc, wtax, due, received }
    })
    const data = rowCalcs.map(({ inv, net, vatAmt, vatInc, wtax, due, received }) =>
      [inv.invoice_no, inv.invoice_date, inv.truck_type, f2(net), f2(vatAmt), f2(vatInc), f2(wtax), f2(due), received>0?f2(received):'', inv.date_credited||'', inv.status, inv.remarks||'']
    )
    const totalNet = clientInvoices.reduce((s,i)=>s+(i.total_sales_net||0),0)
    const totalVatInc = rowCalcs.reduce((s,r)=>s+r.vatInc,0)
    const totalDue = rowCalcs.reduce((s,r)=>s+r.due,0)
    const totalReceived = clientInvoices.filter(i=>i.status==='Paid').reduce((s,i)=>s+(i.actual_amount_credited||(i.total_sales_net||0)*(i.is_vat?1.10:0.98)),0)
    const outstanding = totalVatInc - totalReceived
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const ws = XLSX.utils.aoa_to_sheet([
      [companyName],
      ['ACCOUNTS RECEIVABLE — STATEMENT OF ACCOUNT'],
      [`Client: ${client}`],
      [`As of: ${new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}`],
      [],
      headers, ...data, [],
      ['','','','TOTALS',f2(totalNet),'',f2(totalVatInc),'',f2(totalDue),'',f2(totalReceived),'','',f2(outstanding)+' OUTSTANDING'],
    ])
    ws['!cols'] = headers.map((_,i) => ({ wch: [14,12,14,14,12,16,12,12,14,14,12,20][i]||12 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'AR Statement')
    XLSX.writeFile(wb, `FMS-AR-${client.replace(/[^a-zA-Z0-9]/g,'-')}.xlsx`)
  }

  const handleARPrint = (client, clientInvoices) => {
    const net = n => Number(n||0)
    const f2 = n => Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
    const pw = doc.internal.pageSize.width
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    doc.setFontSize(13); doc.setFont(undefined,'bold')
    doc.text(companyName, pw/2, 14, { align:'center' })
    doc.setFontSize(11); doc.setFont(undefined,'normal')
    doc.text('ACCOUNTS RECEIVABLE — STATEMENT OF ACCOUNT', pw/2, 21, { align:'center' })
    doc.setFontSize(10)
    doc.text(`Client: ${client}`, 14, 30)
    doc.text(`As of: ${new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}`, pw-14, 30, { align:'right' })
    const sorted = [...clientInvoices].sort((a,b) => new Date(a.invoice_date)-new Date(b.invoice_date))
    const tableData = sorted.map(inv => {
      const n = net(inv.total_sales_net)
      const due = n * (inv.is_vat ? 1.10 : 0.98)
      const received = inv.actual_amount_credited || (inv.status==='Paid' ? due : 0)
      return [inv.invoice_no, inv.invoice_date, inv.truck_type?.replace(' Truck','')?.replace(' Mover','PM')||'', f2(n), f2(due), received>0?f2(received):'—', inv.date_credited||'—', inv.status]
    })
    const totNet = sorted.reduce((s,i)=>s+net(i.total_sales_net),0)
    const totDue = sorted.reduce((s,i)=>s+net(i.total_sales_net)*(i.is_vat?1.10:0.98),0)
    const totReceived = sorted.filter(i=>i.status==='Paid').reduce((s,i)=>s+(i.actual_amount_credited||net(i.total_sales_net)*(i.is_vat?1.10:0.98)),0)
    autoTable(doc, {
      startY: 35,
      head: [['Invoice No.','Date','Type','Total Sales','Total Due','Amt Received','Date Credited','Status']],
      body: tableData,
      foot: [['','','TOTAL', f2(totNet), f2(totDue), f2(totReceived), '', '']],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30,41,59], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [254,243,199], textColor: [0,0,0], fontStyle: 'bold' },
      columnStyles: { 3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'right'} },
    })
    const y = doc.lastAutoTable.finalY + 8
    const outstanding = totNet - totReceived
    const outColor = outstanding > 0 ? [220,38,38] : [22,163,74]
    doc.setFontSize(9); doc.setFont(undefined,'bold')
    doc.setTextColor(...outColor)
    doc.text(`OUTSTANDING BALANCE: PHP ${f2(outstanding)}`, pw/2, y, { align:'center' })
    doc.setTextColor(0,0,0)
    doc.setFont(undefined,'normal'); doc.setFontSize(8)
    doc.text(`${sorted.filter(i=>i.status!=='Paid').length} unpaid invoice(s) — Generated: ${new Date().toLocaleDateString('en-PH')}`, 14, y)
    doc.save(`FMS-AR-${client.replace(/[^a-zA-Z0-9]/g,'-')}.pdf`)
  }

  const handleSaveAgingPDF = async () => {
    await fetchAll()
    const now3 = new Date()
    const getDaysAging = (inv) => Math.floor((now3 - new Date(inv.invoice_date)) / 86400000)
    const f2 = (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [279.4, 215.9] })
    const W = 279.4
    const cols = ['Date', 'Invoice No.', 'Client', 'Type', 'Status', 'Net Sales', 'Total Sales', 'Days', 'Remarks']
    const colStyles = { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'center' } }
    const isSingleBucket = agingBucket !== 'all'
    const bDef = [
      { key: 'b60', label: 'CRITICAL (60d+)', color: [220,38,38], fill: [255,235,235], items: agingDisplayed.filter(i => getDaysAging(i) >= 60).sort((a,b) => getDaysAging(b)-getDaysAging(a)) },
      { key: 'b45', label: 'WARNING (45–59d)', color: [194,65,12], fill: [255,243,224], items: agingDisplayed.filter(i => { const d=getDaysAging(i); return d>=45&&d<=59 }).sort((a,b)=>getDaysAging(b)-getDaysAging(a)) },
      { key: 'b30', label: 'MILD (30–44d)', color: [180,134,11], fill: [255,253,231], items: agingDisplayed.filter(i => { const d=getDaysAging(i); return d>=30&&d<=44 }).sort((a,b)=>getDaysAging(b)-getDaysAging(a)) },
      { key: 'b0', label: 'NOT YET DUE (0d or less)', color: [37,99,235], fill: [239,246,255], items: agingDisplayed.filter(i => getDaysAging(i) <= 0).sort((a,b)=>getDaysAging(a)-getDaysAging(b)) },
      { key: 'b1', label: 'CURRENT (1–29d)', color: [21,128,61], fill: [240,253,244], items: agingDisplayed.filter(i => { const d=getDaysAging(i); return d>=1&&d<=29 }).sort((a,b)=>getDaysAging(b)-getDaysAging(a)) },
    ]
    const selectedBucket = bDef.find(b => b.key === agingBucket)
    const bucketsToRender = isSingleBucket ? [selectedBucket].filter(Boolean) : bDef.filter(b => b.items.length > 0)
    const allItems = bucketsToRender.flatMap(b => b.items)
    doc.setFontSize(12); doc.setFont(undefined, 'bold')
    doc.text((settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase(), W/2, 10, { align: 'center' })
    doc.setFontSize(7.5); doc.setFont(undefined, 'normal')
    const dateStr = now3.toLocaleDateString('en-PH', { month: '2-digit', day: '2-digit', year: '2-digit' })
    const modeLabel = agingShowAll ? 'All Unpaid' : 'Overdue'
    const bucketLabel = isSingleBucket ? (selectedBucket?.label || '') : 'Critical to Current'
    doc.text(`AGING REPORT — ${modeLabel} — ${bucketLabel} — As of ${dateStr} — ${allItems.length} invoice(s)`, W/2, 16, { align: 'center' })
    doc.setDrawColor(200); doc.line(14, 19, W-14, 19)
    let startY = 22
    const grandNet = allItems.reduce((s,i) => s+(i.total_sales_net||0), 0)
    bucketsToRender.forEach(bucket => {
      if (!bucket.items.length) return
      doc.setFontSize(8.5); doc.setFont(undefined, 'bold'); doc.setTextColor(...bucket.color)
      doc.text(`${bucket.label}  (${bucket.items.length} invoice${bucket.items.length>1?'s':''})`, 14, startY); doc.setTextColor(0)
      const rows = bucket.items.map(inv => { const net=inv.total_sales_net||0; const days=getDaysAging(inv); return [fmtDate(inv.invoice_date)||'', inv.invoice_no, inv.client, inv.truck_type==='Dump Truck'?'Dump':'PM', inv.status, f2(net), f2(inv.is_vat ? net*1.12 : net), `${days}d`, inv.remarks||''] })
      const subNet = bucket.items.reduce((s,i) => s+(i.total_sales_net||0), 0)
      const subVatInc = bucket.items.reduce((s,i) => s+(i.total_sales_net||0)*(i.is_vat?1.12:1), 0)
      autoTable(doc, { startY: startY+3, head: [cols], body: rows, foot: [['','','','',`Subtotal (${bucket.items.length})`,f2(subNet),f2(subVatInc),'','']], showFoot:'lastPage', headStyles:{fillColor:bucket.color,fontSize:7,fontStyle:'bold'}, bodyStyles:{fontSize:7,fillColor:bucket.fill}, footStyles:{fillColor:[240,240,240],fontStyle:'bold',fontSize:7.5}, columnStyles:colStyles, didParseCell:(data)=>{ if(data.section==='body'&&data.column.index===7){data.cell.styles.textColor=bucket.color;data.cell.styles.fontStyle='bold'} }, margin:{left:14,right:14,bottom:32} })
      startY = doc.lastAutoTable.finalY + 6
    })
    if (bucketsToRender.length > 0) { doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.setDrawColor(100); doc.line(14,startY,W-14,startY); startY+=5; doc.text(`GRAND TOTAL (${allItems.length} invoices)`,14,startY); doc.text(`Total Sales: ${f2(grandNet)}`,W-14,startY,{align:'right'}) }
    const label = isSingleBucket ? (selectedBucket?.label||'bucket') : 'AllBuckets'
    doc.save(`Aging-${label.replace(/[^a-z0-9]/gi,'-')}-${now3.toISOString().slice(0,10)}.pdf`)
    showToast('Aging report exported.')
  }

  const handlePrintAllOverdue = (sigs = []) => {
    try {
      const now4 = new Date()
      const getDaysO = (inv) => Math.floor((now4 - new Date(inv.invoice_date)) / 86400000)
      const list = agingDisplayed.filter(i => { if (overduePrintType && i.truck_type !== overduePrintType) return false; if (overduePrintClient && i.client !== overduePrintClient) return false; return true }).sort((a,b) => getDaysO(b)-getDaysO(a))
      if (!list.length) { showToast('No overdue invoices found.', 'info'); setShowOverduePrintModal(false); return }
      const isPortrait = printOrientation === 'portrait'
      const pageW = isPortrait ? 215.9 : 279.4
      const f2 = (n) => Number(n||0).toLocaleString('en-PH', {minimumFractionDigits:2})
      const doc = new jsPDF({ orientation: printOrientation, unit: 'mm', format: isPortrait ? 'letter' : [pageW, 215.9] })
      const W = pageW
      const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
      const clientDetails2 = overduePrintClient ? getClientDetails(overduePrintClient) : null
      const clientName = (clientDetails2?.full_name || overduePrintClient || 'ALL CLIENTS').toUpperCase()
      const dateStr = now4.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
      let y = 10
      doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.text(companyName,W/2,y,{align:'center'}); y+=5
      doc.setFontSize(7); doc.setFont(undefined,'normal')
      if (settings.vat_tin) { doc.text(`VAT REG. TIN: ${settings.vat_tin}`,W/2,y,{align:'center'}); y+=4 }
      if (settings.address) { doc.text(settings.address.toUpperCase(),W/2,y,{align:'center'}); y+=4 }
      if (settings.contact) { doc.text(`${settings.contact}${settings.email?' / '+settings.email:''}`,W/2,y,{align:'center'}); y+=4 }
      doc.setDrawColor(180); doc.line(14,y,W-14,y); y+=5
      doc.setFontSize(10); doc.setFont(undefined,'bold'); doc.text('AGING REPORT',W/2,y,{align:'center'}); y+=4
      doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.text(`${agingShowAll?'All Incoming':'Overdue'} — ${overduePrintType||'All Types'}`,W/2,y,{align:'center'}); y+=6
      doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.text(`CLIENT: ${clientName}`,14,y); doc.text(`DATE: ${dateStr}`,W-14,y,{align:'right'}); doc.setFont(undefined,'normal'); y+=2
      doc.setDrawColor(100); doc.line(14,y,W-14,y); y+=4
      let startY = y
      const getBucket = (days) => { if(days>=60)return{label:'CRITICAL (60d+)',color:[220,38,38]}; if(days>=45)return{label:'WARNING (45–59d)',color:[194,65,12]}; if(days>=30)return{label:'MILD (30–44d)',color:[180,134,11]}; return{label:'CURRENT (1–29d)',color:[21,128,61]} }
      const buckets2 = ['CRITICAL (60d+)', 'WARNING (45–59d)', 'MILD (30–44d)', 'CURRENT (1–29d)']
      const grouped = {}
      list.forEach(i => { const b=getBucket(getDaysO(i)).label; if(!grouped[b])grouped[b]=[]; grouped[b].push(i) })
      buckets2.forEach(bucketLabel => {
        const items = grouped[bucketLabel]; if (!items?.length) return
        const bucket = getBucket(getDaysO(items[0]))
        doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.setTextColor(...bucket.color); doc.text(`${bucketLabel}  (${items.length} invoice${items.length>1?'s':''})`,14,startY); doc.setTextColor(0); doc.setFont(undefined,'normal')
        autoTable(doc, { startY:startY+3, head:[['Invoice No.','Client','Date','Type','Days','Net Sales','Total Sales','Remarks']], body:items.map(i=>{const net=i.total_sales_net||0;return[i.invoice_no,i.client,fmtDate(i.invoice_date),i.truck_type==='Dump Truck'?'Dump':'PM',`${getDaysO(i)}d`,f2(net),f2(net),i.remarks||'']}), headStyles:{fillColor:bucket.color,fontSize:7,fontStyle:'bold'}, bodyStyles:{fontSize:7}, alternateRowStyles:{fillColor:[250,250,250]}, columnStyles:{5:{halign:'right'},6:{halign:'right'}}, margin:{left:14,right:14}, didParseCell:(data)=>{if(data.section==='body'&&data.column.index===4)data.cell.styles.textColor=bucket.color} })
        startY = doc.lastAutoTable.finalY+2
        const sub = items.reduce((s,i)=>s+(i.total_sales_net||0),0)
        doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(...bucket.color); doc.text(`Subtotal (${items.length}): ${f2(sub)}`,14,startY+1); doc.setTextColor(0); doc.setFont(undefined,'normal'); startY+=8
      })
      const grandNet = list.reduce((s,i)=>s+(i.total_sales_net||0),0)
      doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.setDrawColor(100); doc.line(14,startY,W-14,startY); startY+=5; doc.text(`GRAND TOTAL (${list.length} invoices)`,14,startY); doc.text(`Total Sales: ${f2(grandNet)}`,W-14,startY,{align:'right'})
      if (sigs && sigs.length > 0) {
        const pH2 = doc.internal.pageSize.getHeight()
        if (startY+28 > pH2-6) { doc.addPage(); startY=10 }
        const sigBaseY2=startY+8; const perSlot2=(W-28)/sigs.length
        sigs.forEach((s,idx)=>{ const slotX=14+idx*perSlot2+perSlot2/2; doc.setFontSize(5.5); doc.setFont(undefined,'normal'); doc.setTextColor(120); doc.text(`${s.label}:`,slotX,sigBaseY2,{align:'center'}); doc.setDrawColor(150); doc.line(slotX-28,sigBaseY2+7,slotX+28,sigBaseY2+7); doc.setFont(undefined,'bold'); doc.setFontSize(7); doc.setTextColor(0); doc.text((s.name||'').toUpperCase(),slotX,sigBaseY2+11,{align:'center'}); doc.setFont(undefined,'normal'); doc.setFontSize(6); doc.setTextColor(255,30,0); doc.text(s.title||'',slotX,sigBaseY2+15,{align:'center'}); doc.setTextColor(0) })
      }
      doc.save(`Aging-AllOverdue-${now4.toISOString().slice(0,10)}.pdf`); showToast('Printed — Critical first.'); setShowOverduePrintModal(false)
    } catch(err) { showToast('Print error: ' + err.message, 'error') }
  }

  const handleAgingExcel = async (sigs = []) => {
    await fetchAll()
    const now4 = new Date()
    const getDaysO = (inv) => Math.floor((now4 - new Date(inv.invoice_date)) / 86400000)
    const list = agingDisplayed.filter(i => { if (overduePrintType && i.truck_type !== overduePrintType) return false; if (overduePrintClient && i.client !== overduePrintClient) return false; return true }).sort((a,b) => getDaysO(b)-getDaysO(a))
    if (!list.length) { showToast('No invoices to export.', 'info'); return }
    const companyName = (settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()
    const clientDetails3 = overduePrintClient ? getClientDetails(overduePrintClient) : null
    const clientName = (clientDetails3?.full_name || overduePrintClient || 'ALL CLIENTS').toUpperCase()
    const dateStr = now4.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
    const bDef2 = [
      { label: 'CRITICAL (60d+)', items: list.filter(i => getDaysO(i) >= 60), color:'FFDC2626', bg:'FFFEE2E2' },
      { label: 'WARNING (45–59d)', items: list.filter(i => { const d=getDaysO(i); return d>=45&&d<=59 }), color:'FFEA580C', bg:'FFFFEDD5' },
      { label: 'MILD (30–44d)', items: list.filter(i => { const d=getDaysO(i); return d>=30&&d<=44 }), color:'FFB45309', bg:'FFFEF9C3' },
      { label: 'CURRENT (1–29d)', items: list.filter(i => getDaysO(i) < 30), color:'FF16A34A', bg:'FFDCFCE7' },
    ].filter(b => b.items.length > 0)

    const COLS = 9
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Aging Report')
    ws.columns = [{width:12},{width:22},{width:12},{width:8},{width:10},{width:13},{width:15},{width:8},{width:24}]
    const thin = { style:'thin', color:{argb:'FFAAAAAA'} }
    const allBorders = { top:thin, left:thin, bottom:thin, right:thin }

    let r = 1
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = companyName
    ws.getCell(r,1).font = { bold:true, size:13 }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    r++
    if (settings.vat_tin) { ws.mergeCells(r,1,r,COLS); ws.getCell(r,1).value=`VAT REG.TIN: ${settings.vat_tin}`; ws.getCell(r,1).font={size:8}; ws.getCell(r,1).alignment={horizontal:'center'}; r++ }
    if (settings.address) { ws.mergeCells(r,1,r,COLS); ws.getCell(r,1).value=`ADDRESS: ${settings.address.toUpperCase()}`; ws.getCell(r,1).font={size:8}; ws.getCell(r,1).alignment={horizontal:'center'}; r++ }
    if (settings.contact) { ws.mergeCells(r,1,r,COLS); ws.getCell(r,1).value=`CONTACT INFO: ${settings.contact}${settings.email?' / '+settings.email:''}`; ws.getCell(r,1).font={size:8}; ws.getCell(r,1).alignment={horizontal:'center'}; r++ }
    ws.mergeCells(r,1,r,COLS)
    ws.getCell(r,1).value = 'AGING REPORT'
    ws.getCell(r,1).font = { bold:true, size:11 }
    ws.getCell(r,1).alignment = { horizontal:'center' }
    ws.getCell(r,1).border = { bottom:{style:'medium', color:{argb:'FF000000'}} }
    r++
    ws.mergeCells(r,1,r,5); ws.mergeCells(r,6,r,COLS)
    ws.getCell(r,1).value = `CLIENT: ${clientName}`
    ws.getCell(r,1).font = { bold:true, size:9 }
    ws.getCell(r,6).value = `DATE: ${dateStr}`
    ws.getCell(r,6).font = { bold:true, size:9 }
    ws.getCell(r,6).alignment = { horizontal:'right' }
    r++
    r++ // spacer

    const headerCell = (cell, text) => {
      cell.value = text
      cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:8 }
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF374151'} }
      cell.border = allBorders
    }

    bDef2.forEach(bucket => {
      // Section header
      ws.mergeCells(r,1,r,COLS)
      const tc = ws.getCell(r,1)
      tc.value = `${bucket.label}  (${bucket.items.length} invoice${bucket.items.length>1?'s':''})`
      tc.font = { bold:true, color:{argb:'FFFFFFFF'}, size:9 }
      tc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:bucket.color} }
      tc.alignment = { vertical:'middle' }
      ws.getRow(r).height = 18
      r++
      // Header row
      const hdr = ['Invoice No.','Client','Invoice Date','Type','Status','Net Sales','Total Sales','Days','Remarks']
      hdr.forEach((h,i) => headerCell(ws.getCell(r,i+1), h))
      r++
      // Data rows
      bucket.items.forEach((inv,i) => {
        const net = inv.total_sales_net || 0
        const bg = i % 2 === 0 ? bucket.bg : 'FFFFFFFF'
        const row = ws.getRow(r)
        const vals = [inv.invoice_no, inv.client, fmtDate(inv.invoice_date)||'', inv.truck_type==='Dump Truck'?'Dump':'PM', inv.status, net, inv.is_vat ? net*1.12 : net, `${getDaysO(inv)}d`, inv.remarks||'']
        vals.forEach((v,ci) => {
          const cell = row.getCell(ci+1)
          cell.value = v
          cell.font = { size:8.5, bold: ci===7, color: ci===7?{argb:bucket.color}:undefined }
          cell.alignment = { horizontal: [5,6].includes(ci) ? 'right' : ci===0 ? 'center' : ci===7 ? 'center' : 'left', vertical:'middle' }
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:bg} }
          cell.border = allBorders
          if (ci===0) cell.numFmt = '@'
          if (ci===5 || ci===6) cell.numFmt = '#,##0.00'
        })
        r++
      })
      // Subtotal row
      const sub = bucket.items.reduce((s,i)=>s+(i.total_sales_net||0),0)
      ws.mergeCells(r,1,r,5)
      const slc = ws.getCell(r,1)
      slc.value = `SUBTOTAL (${bucket.items.length})`
      slc.font = { bold:true, size:9, color:{argb:bucket.color} }
      slc.alignment = { horizontal:'right' }
      slc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF9FAFB'} }
      slc.border = allBorders
      ;[[6,sub],[7,sub]].forEach(([c,v]) => {
        const cell = ws.getCell(r,c)
        cell.value = v; cell.numFmt = '#,##0.00'
        cell.font = { bold:true, size:9, color:{argb:bucket.color} }
        cell.alignment = { horizontal:'right' }
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF9FAFB'} }
        cell.border = allBorders
      })
      ws.mergeCells(r,8,r,9)
      ws.getCell(r,8).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF9FAFB'} }
      ws.getCell(r,8).border = allBorders
      r++
      r++ // spacer
    })

    // Grand total
    const grandNet = list.reduce((s,i)=>s+(i.total_sales_net||0),0)
    ws.mergeCells(r,1,r,5)
    const glc = ws.getCell(r,1)
    glc.value = `GRAND TOTAL (${list.length} invoices)`
    glc.font = { bold:true, size:10, color:{argb:'FF92400E'} }
    glc.alignment = { horizontal:'right' }
    glc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9C3'} }
    glc.border = allBorders
    ;[[6,grandNet],[7,grandNet]].forEach(([c,v]) => {
      const cell = ws.getCell(r,c)
      cell.value = v; cell.numFmt = '#,##0.00'
      cell.font = { bold:true, size:10, color:{argb:'FF92400E'} }
      cell.alignment = { horizontal:'right' }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9C3'} }
      cell.border = allBorders
    })
    ws.mergeCells(r,8,r,9)
    ws.getCell(r,8).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9C3'} }
    ws.getCell(r,8).border = allBorders
    r++
    r++

    // Signatures
    if (sigs && sigs.length > 0) {
      r++
      const sigCols = Math.floor(COLS / sigs.length)
      const sigRowLabel = r, sigRowGap = r+1, sigRowName = r+2, sigRowTitle = r+3
      sigs.forEach((s, i) => {
        const startCol = i*sigCols + 1
        const endCol = (i === sigs.length-1) ? COLS : startCol + sigCols - 1
        ws.mergeCells(sigRowLabel, startCol, sigRowLabel, endCol)
        const lc = ws.getCell(sigRowLabel, startCol)
        lc.value = `${s.label}:`
        lc.font = { size:7, color:{argb:'FF888888'} }
        lc.alignment = { horizontal:'center' }
        ws.mergeCells(sigRowGap, startCol, sigRowGap, endCol)
        ws.getRow(sigRowGap).height = 22
        ws.mergeCells(sigRowName, startCol, sigRowName, endCol)
        const nc = ws.getCell(sigRowName, startCol)
        nc.value = s.name
        nc.font = { bold:true, size:8.5 }
        nc.alignment = { horizontal:'center' }
        nc.border = { top:{style:'thin', color:{argb:'FF333333'}} }
        if (s.title) {
          ws.mergeCells(sigRowTitle, startCol, sigRowTitle, endCol)
          const tc2 = ws.getCell(sigRowTitle, startCol)
          tc2.value = s.title
          tc2.font = { size:7.5, color:{argb:'FFFF1E00'} }
          tc2.alignment = { horizontal:'center' }
        }
      })
    }

    ws.views = [{ showGridLines: false }]
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `Aging-${agingShowAll?'Incoming':'Overdue'}-${clientName.replace(/[^a-z0-9]/gi,'-').slice(0,20)}-${now4.toISOString().slice(0,10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    showToast('Excel exported.'); setShowOverduePrintModal(false)
  }

  // ── DUMP TRUCK SOA RENDERER ─────────────────────────────────────────────────
  const renderDumpSOA = (trips, invNo, invDate, client, isVat = false) => {
    const net = trips.reduce((s, t) => s + ((t.weight_tons || 0) * (t.rate_per_ton || 0)), 0)
    const vat = isVat ? net * 0.12 : 0; const vatInc = isVat ? net * 1.12 : net
    const tons = trips.reduce((s, t) => s + (parseFloat(t.weight_tons) || 0), 0)
    const clientDetails = getClientDetails(client)
    const cols = ['5%','4%','5.5%','4.5%','4%','5%','3%','8%','3%','8%','3.5%','5%','3.5%','6%','4.5%','5.5%','5.5%']
    const td = (extra = {}) => ({ padding: '2px 4px', border: '0.5px solid #aaa', fontSize: '9.5px', textAlign: 'center', verticalAlign: 'middle', wordWrap: 'break-word', lineHeight: 1.3, ...extra })
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '9.5px', color: '#000', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 4, paddingBottom: 4, borderBottom: '1.5px solid #000' }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase' }}>{(settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()}</div>
          {settings.vat_tin && <div style={{ fontSize: 9 }}>VAT REG.TIN: {settings.vat_tin}</div>}
          {settings.address && <div style={{ fontSize: 9 }}>ADDRESS: {settings.address.toUpperCase()}</div>}
          {settings.contact && <div style={{ fontSize: 9 }}>CONTACT INFO: {settings.contact}{settings.email ? ` / ${settings.email}` : ''}</div>}
          <div style={{ fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', marginTop: 3 }}>STATEMENT OF ACCOUNTS</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase' }}>CUSTOMER'S NAME:</div>
            <div style={{ fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase' }}>{clientDetails?.full_name?.toUpperCase() || client?.toUpperCase()}</div>
            {clientDetails?.address && <div style={{ fontSize: 9, color: '#444' }}>ADDRESS: {clientDetails.address.toUpperCase()}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            {clientDetails?.tin && <div style={{ fontSize: 9 }}>TIN: {clientDetails.tin}</div>}
            <div style={{ fontSize: 9 }}>INVOICE DATE: {fmtDate(invDate).toUpperCase()}</div>
            <div style={{ fontSize: 11, fontWeight: 'bold' }}>SALES INV #: {invNo}</div>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>{cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr>
              {[['TRANSACTION DATE',2,1],['SMCSL WB',2,1],['SUPPLIER DOC REFERENCE',2,1]].map(([l,cs,rs])=>(<th key={l} rowSpan={rs===1?2:undefined} colSpan={cs===2?undefined:cs} style={{background:'#000',color:'#fff',padding:'4px',border:'0.5px solid #000',fontSize:'7.2px',textTransform:'uppercase',textAlign:'center',verticalAlign:'middle',lineHeight:1.3}}>{l}</th>))}
              <th colSpan={2} style={{background:'#000',color:'#fff',padding:'4px',border:'0.5px solid #000',fontSize:'7.2px',textTransform:'uppercase',textAlign:'center',lineHeight:1.3}}>TRUCK DR</th>
              <th rowSpan={2} style={{background:'#000',color:'#fff',padding:'4px',border:'0.5px solid #000',fontSize:'7.2px',textTransform:'uppercase',textAlign:'center',verticalAlign:'middle',lineHeight:1.3}}>COMMODITY TYPE</th>
              <th colSpan={2} style={{background:'#000',color:'#fff',padding:'4px',border:'0.5px solid #000',fontSize:'7.2px',textTransform:'uppercase',textAlign:'center',lineHeight:1.3}}>FROM</th>
              <th colSpan={4} style={{background:'#000',color:'#fff',padding:'4px',border:'0.5px solid #000',fontSize:'7.2px',textTransform:'uppercase',textAlign:'center',lineHeight:1.3}}>DESTINATION</th>
              {['RATE','RMSD/SMFI SAF DR','STO NO','SVC PO SUPPLIER AMOUNT','TOTAL AMOUNT'].map(l=>(<th key={l} rowSpan={2} style={{background:'#000',color:'#fff',padding:'4px',border:'0.5px solid #000',fontSize:'7.2px',textTransform:'uppercase',textAlign:'center',verticalAlign:'middle',lineHeight:1.3}}>{l}</th>))}
            </tr>
            <tr>
              {['TRUCK PLATE','TRUCK','ISLAND ZONE','ISLAND ORIGIN CODE','ISLAND ZONE','ISLAND DEST. CODE MIN DAVAO PLANT','QTY DESTINATION','DEST. WEIGHT IN TONS'].map(h=>(
                <th key={h} style={{background:'#333',color:'#fff',padding:'4px',border:'0.5px solid #000',fontSize:'7.2px',textTransform:'uppercase',textAlign:'center',lineHeight:1.3}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trips.map((t, i) => {
              const amt = (t.weight_tons || 0) * (t.rate_per_ton || 0)
              const qty = calcQtyDest(t.weight_tons)
              const bg = i % 2 === 0 ? '#fff' : '#f2f2f2'
              return (
                <tr key={t.id}>
                  <td style={td({background:bg})}>{fmtDate(t.trip_date).toUpperCase()}</td>
                  <td style={td({background:bg})}>{t.smcsl_wb||''}</td>
                  <td style={td({background:bg})}>{t.supplier_doc_ref||''}</td>
                  <td style={td({background:bg,fontWeight:'bold'})}>{t.truck_plate}</td>
                  <td style={td({background:bg})}>DUMP TRUCK</td>
                  <td style={td({background:bg})}>{(t.commodity||'').toUpperCase()}</td>
                  <td style={td({background:bg})}>{t.island_zone_origin||'MIN'}</td>
                  <td style={td({background:bg})}>{(t.island_origin_code||'').toUpperCase()}</td>
                  <td style={td({background:bg})}>{t.island_zone_dest||'MIN'}</td>
                  <td style={td({background:bg})}>{(t.island_dest_code||'MIN DAVAO PLANT').toUpperCase()}</td>
                  <td style={td({background:bg,textAlign:'right'})}>{qty.toLocaleString()}</td>
                  <td style={td({background:bg,textAlign:'right'})}>{Number(t.weight_tons||0).toFixed(3)}</td>
                  <td style={td({background:bg,textAlign:'right'})}>{fmt(t.rate_per_ton)}</td>
                  <td style={td({background:bg})}>{t.rmsd_smfi_saf_dr||''}</td>
                  <td style={td({background:bg})}>{t.sto_no||''}</td>
                  <td style={td({background:bg,textAlign:'right',fontWeight:'bold'})}>{fmt(amt)}</td>
                  <td style={td({background:bg,textAlign:'right',fontWeight:'bold'})}>{fmt(amt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: 2, marginBottom: 2 }}>
          <colgroup>{cols.map((w,i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <tbody>
            <tr>
              <td colSpan={11} style={{ border: 'none' }}></td>
              <td style={{ ...td(), fontWeight: 'bold', textAlign: 'right', background: '#f5f5f5', borderTop: '0.5px solid #aaa' }}>{tons.toFixed(3)}</td>
              <td colSpan={5} style={{ border: 'none' }}></td>
            </tr>
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4, gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '9.5px', fontStyle: 'italic', fontWeight: 'bold', lineHeight: 1.7, textTransform: 'uppercase' }}>{numberToWords(net).toUpperCase()}</div>
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: '10px', minWidth: 200 }}>
            <tbody>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right', fontWeight: 'bold', borderBottom: '0.5px solid #000' }}>GRAND TOTAL</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace', minWidth: 80, fontWeight: 'bold', borderBottom: '0.5px solid #000' }}>{fmt(net)}</td></tr>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right' }}>{isVat ? 'VAT (12%)' : 'VAT (Non-VAT)'}</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(vat)}</td></tr>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right' }}>TOTAL SALES</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(vatInc)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── PM SOA RENDERER ──────────────────────────────────────────────────────────
  const renderPMSOA = (trips, invNo, invDate, client, isVat = false) => {
    const clientDetails = getClientDetails(client)
    const tdS = { padding: '2px 4px', border: '0.5px solid #ccc', fontSize: '8.8px', textAlign: 'center', verticalAlign: 'middle', lineHeight: 1.3 }
    const thS = { background:'#000', color:'#fff', padding:'2px 3px', border:'0.5px solid #000', fontSize:'8px', textTransform:'uppercase', textAlign:'center', wordWrap:'break-word', verticalAlign:'middle', lineHeight:1.25 }
    const codes = ['Hustling PSACC', 'Hauling PSACC', 'SMC']
    const tripsByCode = {}
    codes.forEach(c => { tripsByCode[c] = trips.filter(t => t.trip_code === c) })
    const grandTotal = trips.reduce((s,t) => s + (t.supplier_amount||0) + (t.stripping_fee||0), 0)
    const allSMC = trips.length > 0 && trips.every(t => t.trip_code === 'SMC')
    const vatable = allSMC ? grandTotal / 1.12 : grandTotal
    const vat12 = isVat ? vatable * 0.12 : 0
    const totalAmt = isVat ? vatable * 1.12 : vatable
    const twas = vatable * 0.02
    const netAmount = totalAmt - twas
    const buildRows = (tripList, code) => tripList.flatMap((t, i) => {
      const bg = i % 2 === 0 ? '#fff' : '#f2f2f2'
      const containers = t.containers || []
      const isHustling = code === 'Hustling PSACC'
      const isHauling = code === 'Hauling PSACC'
      if (isHustling) {
        return containers.length > 1
          ? containers.map((c, ci) => { const isFirst=ci===0; const cSup=parseFloat(c.supplier_amount)||0; return (<tr key={`${t.id}-${ci}`}><td style={{...tdS,background:bg}}>{isFirst?fmtDate(t.trip_date).toUpperCase():''}</td><td style={{...tdS,background:bg,fontWeight:'bold'}}>{isFirst?t.truck_plate:''}</td><td style={{...tdS,background:bg}}>{t.container_size}</td><td style={{...tdS,background:bg}}>{isFirst?(t.waybill_no||'—'):''}</td><td style={{...tdS,background:bg}}>{isFirst?(t.vessel||'—'):''}</td><td style={{...tdS,background:bg}}>{c.cts_no||'—'}</td><td style={{...tdS,background:bg}}>{c.voyage||'—'}</td><td style={{...tdS,background:bg}}>{c.from_to||'—'}</td><td style={{...tdS,background:bg}}>{c.van_no||'—'}</td><td style={{...tdS,background:bg}}>{c.van_status||t.van_status||'—'}</td><td style={{...tdS,background:bg,textAlign:'right'}}>{fmt(cSup)}</td></tr>) })
          : [(<tr key={t.id}><td style={{...tdS,background:bg}}>{fmtDate(t.trip_date).toUpperCase()}</td><td style={{...tdS,background:bg,fontWeight:'bold'}}>{t.truck_plate}</td><td style={{...tdS,background:bg}}>{t.container_size}</td><td style={{...tdS,background:bg}}>{t.waybill_no||'—'}</td><td style={{...tdS,background:bg}}>{t.vessel||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.cts_no||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.voyage||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.from_to||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.van_no||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.van_status||t.van_status||'—'}</td><td style={{...tdS,background:bg,textAlign:'right'}}>{fmt(parseFloat(containers[0]?.supplier_amount??t.supplier_amount)||0)}</td></tr>)]
      }
      if (isHauling) {
        const cSup=parseFloat(containers[0]?.supplier_amount??t.supplier_amount)||0
        return [(<tr key={t.id}><td style={{...tdS,background:bg}}>{fmtDate(t.trip_date).toUpperCase()}</td><td style={{...tdS,background:bg,fontWeight:'bold'}}>{t.truck_plate}</td><td style={{...tdS,background:bg}}>{t.container_size}</td><td style={{...tdS,background:bg}}>{containers[0]?.van_no||'—'}</td><td style={{...tdS,background:bg}}>{t.vessel||'—'}</td><td style={{...tdS,background:bg}}>{t.waybill_no||'—'}</td><td style={{...tdS,background:bg}}>{t.voyage||'—'}</td><td style={{...tdS,background:bg}}>{t.emr_date?fmtDate(t.emr_date):'—'}</td><td style={{...tdS,background:bg}}>{t.date_completion?fmtDate(t.date_completion):'—'}</td><td style={{...tdS,background:bg}}>{t.consignee||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.emr_no||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.bl_no||'—'}</td><td style={{...tdS,background:bg,textAlign:'right'}}>{fmt(cSup)}</td></tr>)]
      }
      const is20ft = t.container_size === '20ft' && containers.length > 1
      if (is20ft) {
        return containers.map((c,ci)=>{ const isFirst=ci===0; const cSup=parseFloat(c.supplier_amount)||0; const cStrip=parseFloat(c.stripping_fee)||0; const cTotal=cSup+cStrip; return (<tr key={`${t.id}-${ci}`}><td style={{...tdS,background:bg}}>{isFirst?fmtDate(t.trip_date).toUpperCase():''}</td><td style={{...tdS,background:bg,fontWeight:'bold'}}>{isFirst?t.truck_plate:''}</td><td style={{...tdS,background:bg}}>{t.container_size}</td><td style={{...tdS,background:bg}}>{isFirst?(t.smcsl_waybill_no||'—'):''}</td><td style={{...tdS,background:bg}}>{isFirst?(t.supplier_doc||'—'):''}</td><td style={{...tdS,background:bg}}>{isFirst?(t.transaction_type||'—'):''}</td><td style={{...tdS,background:bg}}>{isFirst?(t.port_origin||'—'):''}</td><td style={{...tdS,background:bg}}>{isFirst?(t.port_destination||'—'):''}</td><td style={{...tdS,background:bg}}>{isFirst?(t.shipper_address||'—'):''}</td><td style={{...tdS,background:bg}}>{isFirst?(t.consignee_address||'—'):''}</td><td style={{...tdS,background:bg}}>{c.con_van_no||c.van_no||'—'}</td><td style={{...tdS,background:bg}}>{c.seal_no||'—'}</td><td style={{...tdS,background:bg}}>{c.commodity||t.commodity||'—'}</td><td style={{...tdS,background:bg,textAlign:'right'}}>{fmt(cSup)}</td><td style={{...tdS,background:bg,textAlign:'right'}}>{cStrip?fmt(cStrip):'—'}</td><td style={{...tdS,background:bg,textAlign:'right',fontWeight:'bold'}}>{fmt(cTotal)}</td></tr>) })
      }
      const cSup=parseFloat(containers[0]?.supplier_amount??t.supplier_amount)||0; const cStrip=parseFloat(containers[0]?.stripping_fee??t.stripping_fee)||0; const cTotal=cSup+cStrip
      return [(<tr key={t.id}><td style={{...tdS,background:bg}}>{fmtDate(t.trip_date).toUpperCase()}</td><td style={{...tdS,background:bg,fontWeight:'bold'}}>{t.truck_plate}</td><td style={{...tdS,background:bg}}>{t.container_size}</td><td style={{...tdS,background:bg}}>{t.smcsl_waybill_no||'—'}</td><td style={{...tdS,background:bg}}>{t.supplier_doc||'—'}</td><td style={{...tdS,background:bg}}>{t.transaction_type||'—'}</td><td style={{...tdS,background:bg}}>{t.port_origin||'—'}</td><td style={{...tdS,background:bg}}>{t.port_destination||'—'}</td><td style={{...tdS,background:bg}}>{t.shipper_address||'—'}</td><td style={{...tdS,background:bg}}>{t.consignee_address||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.con_van_no||containers[0]?.van_no||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.seal_no||'—'}</td><td style={{...tdS,background:bg}}>{containers[0]?.commodity||t.commodity||'—'}</td><td style={{...tdS,background:bg,textAlign:'right'}}>{fmt(cSup)}</td><td style={{...tdS,background:bg,textAlign:'right'}}>{cStrip?fmt(cStrip):'—'}</td><td style={{...tdS,background:bg,textAlign:'right',fontWeight:'bold'}}>{fmt(cTotal)}</td></tr>)]
    })
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '9.5px', color: '#000', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 4, paddingBottom: 4, borderBottom: '1.5px solid #000' }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase' }}>{(settings.company_name || 'FLEET MANAGEMENT SYSTEM').toUpperCase()}</div>
          {settings.vat_tin && <div style={{ fontSize: 9 }}>VAT REG.TIN: {settings.vat_tin}</div>}
          {settings.address && <div style={{ fontSize: 9 }}>ADDRESS: {settings.address.toUpperCase()}</div>}
          {settings.contact && <div style={{ fontSize: 9 }}>CONTACT INFO: {settings.contact}{settings.email ? ` / ${settings.email}` : ''}</div>}
          <div style={{ fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', marginTop: 3 }}>STATEMENT OF ACCOUNTS</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase' }}>CUSTOMER'S NAME:</div>
            <div style={{ fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase' }}>{clientDetails?.full_name?.toUpperCase() || client?.toUpperCase()}</div>
            {clientDetails?.address && <div style={{ fontSize: 9, color: '#444' }}>ADDRESS: {clientDetails.address.toUpperCase()}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            {clientDetails?.tin && <div style={{ fontSize: 9 }}>TIN: {clientDetails.tin}</div>}
            <div style={{ fontSize: 9 }}>INVOICE DATE: {fmtDate(invDate).toUpperCase()}</div>
            <div style={{ fontSize: 11, fontWeight: 'bold' }}>SALES INV #: {invNo}</div>
          </div>
        </div>
        {codes.map(code => {
          const codeTrips = tripsByCode[code]; if (!codeTrips?.length) return null
          const isSMC=code==='SMC'; const isHustlingCode=code==='Hustling PSACC'; const isHaulingCode=code==='Hauling PSACC'
          const codeSupTotal=codeTrips.reduce((s,t)=>{const c=t.containers||[];return c.length>0?s+c.reduce((cs,c2)=>cs+(parseFloat(c2.supplier_amount)||0),0):s+(parseFloat(t.supplier_amount)||0)},0)
          const codeStripTotal=isSMC?codeTrips.reduce((s,t)=>{const c=t.containers||[];return c.length>0?s+c.reduce((cs,c2)=>cs+(parseFloat(c2.stripping_fee)||0),0):s+(parseFloat(t.stripping_fee)||0)},0):0
          const codeTotal=codeSupTotal+codeStripTotal
          return (
            <div key={code} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 8.5, fontWeight: 'bold', background: '#333', color: '#fff', padding: '1px 4px', marginBottom: 2 }}>{code.toUpperCase()}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={thS}>TRANSACTION DATE</th><th style={thS}>TRUCK PLATE</th><th style={thS}>CONTAINER SIZE</th>
                    {isSMC && <><th style={thS}>SMCSL WAYBILL NO.</th><th style={thS}>SUPPLIER DOC</th><th style={thS}>TRANSACTION TYPE</th><th style={thS}>PORT OF ORIGIN</th><th style={thS}>PORT OF DESTINATION</th><th style={thS}>SHIPPER ADDRESS</th><th style={thS}>CONSIGNEE ADDRESS</th><th style={thS}>CON VAN NO.</th><th style={thS}>SEAL NO.</th><th style={thS}>COMMODITY</th><th style={thS}>SUPPLIER AMT (VAT INC.)</th><th style={thS}>STRIPPING FEE</th><th style={thS}>TOTAL</th></>}
                    {isHustlingCode && <><th style={thS}>WAYBILL</th><th style={thS}>VESSEL</th><th style={thS}>CTS NO.</th><th style={thS}>VOYAGE</th><th style={thS}>FROM-TO</th><th style={thS}>VAN NO.</th><th style={thS}>STATUS</th><th style={thS}>SUPPLIER AMT</th></>}
                    {isHaulingCode && <><th style={thS}>VAN NO.</th><th style={thS}>VESSEL</th><th style={thS}>WAYBILL</th><th style={thS}>VOYAGE</th><th style={thS}>EMR DATE</th><th style={thS}>DATE COMPLETION</th><th style={thS}>CONSIGNEE</th><th style={thS}>EMR NO.</th><th style={thS}>BL NO.</th><th style={thS}>SUPPLIER AMT</th></>}
                  </tr>
                </thead>
                <tbody>{buildRows(codeTrips, code)}</tbody>
                <tfoot>
                  <tr>
                    {isSMC && <><td colSpan={13} style={{...tdS,fontWeight:'bold',textAlign:'right',background:'#f5f5f5'}}>TOTAL</td><td style={{...tdS,textAlign:'right',fontWeight:'bold',background:'#f5f5f5'}}>{fmt(codeSupTotal)}</td><td style={{...tdS,textAlign:'right',fontWeight:'bold',background:'#f5f5f5'}}>{fmt(codeStripTotal)}</td><td style={{...tdS,textAlign:'right',fontWeight:'bold',background:'#f5f5f5'}}>{fmt(codeTotal)}</td></>}
                    {isHustlingCode && <><td colSpan={10} style={{...tdS,fontWeight:'bold',textAlign:'right',background:'#f5f5f5'}}>TOTAL</td><td style={{...tdS,textAlign:'right',fontWeight:'bold',background:'#f5f5f5'}}>{fmt(codeSupTotal)}</td></>}
                    {isHaulingCode && <><td colSpan={12} style={{...tdS,fontWeight:'bold',textAlign:'right',background:'#f5f5f5'}}>TOTAL</td><td style={{...tdS,textAlign:'right',fontWeight:'bold',background:'#f5f5f5'}}>{fmt(codeSupTotal)}</td></>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4, gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '9.5px', fontStyle: 'italic', fontWeight: 'bold', lineHeight: 1.7, textTransform: 'uppercase' }}>{numberToWords(netAmount).toUpperCase()}</div>
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: '10px', minWidth: 220 }}>
            <tbody>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right', fontWeight: 'bold' }}>GRAND TOTAL</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace', minWidth: 90, fontWeight: 'bold' }}>{fmt(grandTotal)}</td></tr>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right' }}>VATABLE</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(vatable)}</td></tr>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right' }}>{isVat ? 'VAT (12%)' : 'VAT (Non-VAT)'}</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(vat12)}</td></tr>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right', fontWeight: 'bold', borderTop: '0.5px solid #000' }}>TOTAL AMOUNT</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', borderTop: '0.5px solid #000' }}>{fmt(totalAmt)}</td></tr>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right' }}>TWAS</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(twas)}</td></tr>
              <tr><td style={{ padding: '1px 6px', textAlign: 'right', fontWeight: 'bold', color: '#c00', borderTop: '0.5px solid #000' }}>NET AMOUNT</td><td style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#c00', borderTop: '0.5px solid #000' }}>{fmt(netAmount)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── RETURN JSX ───────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Billing &amp; SOA</h1><p className="page-sub">Generate invoices and statements of account</p></div>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', color: tab === t ? 'var(--accent)' : 'var(--muted)', fontWeight: tab === t ? 600 : 400, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>{t}</button>
        ))}
      </div>

      {/* ── GENERATE TAB ── */}
      {tab === 'Generate' && (
        <div className="card">
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.06em', marginBottom: 14 }}>DOCUMENT SETUP</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {['Dump Truck', 'Prime Mover'].map(tt => (
              <button key={tt} onClick={() => { setTruckType(tt); setSelectedIds([]); setFilterTripCode('') }}
                style={{ padding: '8px 20px', borderRadius: 8, border: `1.5px solid ${truckType === tt ? 'var(--accent)' : 'var(--border)'}`, background: truckType === tt ? 'var(--accent)' : 'var(--surface)', color: truckType === tt ? '#fff' : 'var(--text)', fontWeight: 600, cursor: 'pointer' }}>{tt}</button>
            ))}
          </div>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="label required">Client</label>
              <select value={selectedClient} onChange={e => { setSelectedClient(e.target.value); setSelectedIds([]) }}>
                <option value="">Select client</option>
                {clientsList.map(c => <option key={c.id} value={c.nickname}>{c.nickname} — {c.full_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label required">Invoice / SOA No.</label>
              <input value={invoiceNo} onChange={e => { setInvoiceNo(e.target.value); checkDuplicate(e.target.value) }} placeholder="Enter invoice number (e.g. 1219)" />
              {invoiceDupWarning === 'active' && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>⚠️ Invoice number already exists.</div>}
              {invoiceDupWarning === 'deleted' && <div style={{ color: 'var(--warning)', fontSize: 11, marginTop: 4 }}>⚠️ This number belongs to a deleted invoice and can't be reused. Restore it from Trash, or pick another number.</div>}
              {!invoiceNo && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>Enter invoice number before generating.</div>}
            </div>
            <div className="form-group">
              <label className="label required">Invoice Date</label>
              <DateInput value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </div>
          </div>
          {truckType === 'Prime Mover' && (
            <div className="filter-bar" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>FILTERS</label>
              <input placeholder="Search plate, vessel…" value={filterSearch} onChange={e => setFilterSearch(e.target.value)} style={{ flex: 2 }} />
              <select value={filterTripCode} onChange={e => { setFilterTripCode(e.target.value); setSelectedIds([]) }} style={{ width: 'auto' }}>
                <option value="">All trip codes</option>
                {tripCodes.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterTruck} onChange={e => setFilterTruck(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All trucks</option>
                {trucks.filter(t => t.truck_type === 'Prime Mover').map(t => <option key={t.id} value={t.plate}>{t.plate}</option>)}
              </select>
              <select value={filterSize} onChange={e => setFilterSize(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All sizes</option>
                <option value="20ft">20ft</option>
                <option value="40ft">40ft</option>
              </select>
            </div>
          )}
          {truckType === 'Dump Truck' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>FILTERS</label>
              <input placeholder="Search SMCSL WB, plate, route…" value={filterSearch} onChange={e => setFilterSearch(e.target.value)} style={{ flex: 2, minWidth: 160 }} />
              <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ width: 'auto' }} />
              <select value={filterTruck} onChange={e => setFilterTruck(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All trucks</option>
                {trucks.filter(t => t.truck_type === 'Dump Truck').map(t => <option key={t.id} value={t.plate}>{t.plate}</option>)}
              </select>
              <select value={filterRoute} onChange={e => setFilterRoute(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All routes</option>
                {[...new Set(candidateTrips.map(t => t.route).filter(Boolean))].sort().map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={filterCommodity} onChange={e => setFilterCommodity(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All commodities</option>
                {[...new Set(candidateTrips.map(t => t.commodity).filter(Boolean))].sort().map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterOriginCode} onChange={e => setFilterOriginCode(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All origins</option>
                {[...new Set(candidateTrips.map(t => t.island_origin_code).filter(Boolean))].sort().map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterDestCode} onChange={e => setFilterDestCode(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All destinations</option>
                {[...new Set(candidateTrips.map(t => t.island_dest_code).filter(Boolean))].sort().map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {(filterSearch||filterMonth||filterTruck||filterRoute||filterCommodity||filterOriginCode||filterDestCode) &&
                <button className="btn-ghost btn-sm" onClick={() => { setFilterSearch(''); setFilterMonth(''); setFilterTruck(''); setFilterRoute(''); setFilterCommodity(''); setFilterOriginCode(''); setFilterDestCode('') }}>Clear</button>}
            </div>
          )}
          {selectedClient && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filteredCandidates.length} trips available · {selectedIds.length} selected</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost btn-sm" onClick={() => setSelectedIds(filteredCandidates.map(t => t.id))}>Select All</button>
                  <button className="btn-ghost btn-sm" onClick={() => setSelectedIds([])}>Clear</button>
                </div>
              </div>
              <div style={{ maxHeight: 320, overflow: 'auto', border: '0.5px solid var(--border)', borderRadius: 8 }}>
                {filteredCandidates.length === 0
                  ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No uninvoiced trips found for {selectedClient}.</div>
                  : filteredCandidates.map(t => {
                    const amt = truckType === 'Dump Truck' ? (t.weight_tons||0)*(t.rate_per_ton||0) : (t.supplier_amount||0)+(t.stripping_fee||0)
                    const sel = selectedIds.includes(t.id)
                    return (
                      <div key={t.id} onClick={() => toggleTrip(t.id, t)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '0.5px solid var(--border)', background: sel ? 'var(--accent-light)' : 'transparent', cursor: 'pointer' }}>
                        <input type="checkbox" checked={sel} onChange={() => toggleTrip(t.id, t)} onClick={e => e.stopPropagation()} style={{ width: 'auto' }} />
                        <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 90 }}>{t.trip_date}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, minWidth: 80 }}>{t.truck_plate}</span>
                        <span style={{ fontSize: 12, flex: 1 }}>{truckType === 'Dump Truck' ? `${t.smcsl_wb?t.smcsl_wb+' · ':''}${t.route||''} · ${t.commodity||''}` : `${t.trip_code||''} · ${t.container_size||''} · ${t.vessel||t.waybill_no||''}`}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600 }}>₱{fmt(amt)}</span>
                      </div>
                    )
                  })}
              </div>
              {billedTrips.length > 0 && (<>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Invoice Type:</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[['non-vat', false, 'Non-VAT'], ['vat', true, 'VAT']].map(([key, val, label]) => (
                      <button key={key} type="button" onClick={() => setIsVatInvoice(val)} style={{
                        padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        background: isVatInvoice === val ? 'var(--accent)' : 'var(--surface)',
                        color: isVatInvoice === val ? '#fff' : 'var(--muted)',
                        border: `1.5px solid ${isVatInvoice === val ? 'var(--accent)' : 'var(--border)'}`,
                      }}>{label}</button>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
                  {(isSMCInvoice
                    ? [['VATABLE',totalNet],[isVatInvoice ? 'VAT (12%)' : 'VAT (Non-VAT)',vat12],['Total Amount',totalVatInc],['TWAS 2%',wht2],['Net Amount',totalDue]]
                    : [['Total Sales',totalNet],[isVatInvoice ? 'VAT (12%)' : 'VAT (Non-VAT)',vat12],['Total Amount',totalVatInc],['W/Tax 2%',wht2],['Total Due',totalDue]]
                  ).map(([l,v]) => (<div key={l}><span style={{ color: 'var(--muted)' }}>{l}: </span><strong style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>₱{fmt(v)}</strong></div>))}
                  {truckType === 'Dump Truck' && <div><span style={{ color: 'var(--muted)' }}>Total Tons: </span><strong>{totalTons.toFixed(3)}t</strong></div>}
                </div>
              </>)}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="btn-ghost" onClick={() => setPreviewModal({ trips: billedTrips, invoice: { id: 'preview', invoice_no: invoiceNo, invoice_date: invoiceDate, client: selectedClient, truck_type: truckType, is_vat: isVatInvoice } })} disabled={!selectedIds.length || !invoiceNo}>👁 Preview</button>
                <button className="btn-ghost" onClick={() => { setPrintAfterPreview(true); setPreviewModal({ trips: billedTrips, invoice: { id: 'preview', invoice_no: invoiceNo, invoice_date: invoiceDate, client: selectedClient, truck_type: truckType, is_vat: isVatInvoice } }) }} disabled={!selectedIds.length || !invoiceNo}>📄 Print / Save PDF</button>
                <button className="btn-primary" onClick={handleGenerate} disabled={!selectedIds.length || !invoiceNo || !selectedClient || invoiceDupWarning || generating}>{generating ? 'Generating…' : '✓ Generate Invoice'}</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── INVOICE LIST TAB ── */}
      {tab === 'Invoice List' && (
        <div>
          <div className="filter-bar" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <input placeholder="Search invoice no., client…" value={invSearch} onChange={e => setInvSearch(e.target.value)} style={{ flex: 2, minWidth: 140 }} />
            <input type="month" value={invFilterMonth} onChange={e => setInvFilterMonth(e.target.value)} style={{ width: 'auto' }} />
            <input type="number" value={invFilterYear} onChange={e => setInvFilterYear(e.target.value)} placeholder="Year" style={{ width: 90 }} />
            <div style={{ position:'relative', display:'inline-block' }}>
              <input value={invFilterClient} onChange={e => setInvFilterClient(e.target.value)}
                list="inv-filter-clients" placeholder="All clients"
                style={{ width:160, padding:'6px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13 }} />
              <datalist id="inv-filter-clients">
                {allInvClients.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <select value={invFilterStatus} onChange={e => setInvFilterStatus(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All status</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={invFilterPlate} onChange={e => setInvFilterPlate(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All plates</option>
              {allInvPlates.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {(invSearch||invFilterMonth||invFilterYear||invFilterClient||invFilterStatus||invFilterPlate) &&
              <button className="btn-ghost btn-sm" onClick={() => { setInvSearch(''); setInvFilterMonth(''); setInvFilterYear(''); setInvFilterClient(''); setInvFilterStatus(''); setInvFilterPlate('') }}>Clear</button>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Sort:</span>
            {[['invoice_date','Date'],['invoice_no','Invoice No.'],['client','Client'],['status','Status'],['total_sales_net','Amount']].map(([k,l]) => (
              <button key={k} onClick={() => toggleInvSort(k)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: `1px solid ${invSortKey===k?'var(--accent)':'var(--border)'}`, background: invSortKey===k?'var(--accent-light)':'var(--surface)', cursor: 'pointer', color: invSortKey===k?'var(--accent)':'var(--muted)' }}>
                {l} {invSortKey===k?(invSortDir==='asc'?'▲':'▼'):''}
              </button>
            ))}
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{filteredInvoices.length} invoice{filteredInvoices.length!==1?'s':''}</span>
            {isAdmin && <button onClick={handleRecalcAll} disabled={recalcingAll || filteredInvoices.length === 0}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--muted)' }}
              title="Recalculate totals for all visible invoices">
              {recalcingAll ? '⏳ Recalculating…' : '🔄 Recalc All'}
            </button>}
          </div>
          {bulkExportIds.length > 0 && (
            <div style={{ padding: '10px 14px', background: 'rgba(59,130,246,0.08)', border: '1px solid #3b82f6', borderRadius: 8, marginBottom: 12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{bulkExportIds.length} invoice{bulkExportIds.length>1?'s':''} selected for export</span>
              <button className="btn-primary btn-sm" disabled={bulkExporting} onClick={() => setBulkExportSigPending(true)}>
                {bulkExporting ? '⏳ Exporting…' : '📦 Bulk Export Excel'}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setBulkExportIds([])}>Clear</button>
            </div>
          )}
          {bulkInvoices.length > 0 && (
            <div style={{ padding: '10px 14px', background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{bulkInvoices.length} invoice{bulkInvoices.length>1?'s':''} selected</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 12 }}>Apply one date to all:</label>
                  <DateInput value={bulkOneDate} onChange={e => setBulkOneDate(e.target.value)} style={{ width: 'auto', fontSize: 12, padding: '3px 8px' }} />
                </div>
                <button className="btn-primary btn-sm" onClick={handleBulkPaid} disabled={bulkSaving}>{bulkSaving?'Saving…':'✅ Mark All Paid'}</button>
                <button className="btn-ghost btn-sm" onClick={() => { setBulkInvoices([]); setBulkDates({}); setBulkOneDate('') }}>Clear</button>
              </div>
              {bulkOneDate === '' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {bulkInvoices.map(inv => (
                    <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ fontFamily: 'var(--mono)', minWidth: 80 }}>{inv.invoice_no}</span>
                      <span style={{ color: 'var(--muted)', flex: 1 }}>{inv.client}</span>
                      <DateInput value={bulkDates[inv.id]||''} onChange={e => setBulkDates(d => ({...d,[inv.id]:e.target.value}))} style={{ width: 'auto', fontSize: 11, padding: '2px 6px' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {filteredInvoices.length === 0
            ? <div style={{ textAlign:'center', padding:48, color:'var(--muted)' }}>
                <div style={{ fontSize:40, marginBottom:10 }}>📄</div>
                <div style={{ fontSize:15, fontWeight:500, marginBottom:4 }}>No invoices found</div>
                <div style={{ fontSize:12 }}>Try adjusting filters or generate a new invoice from the Generate tab.</div>
              </div>
            : filteredInvoices.map(inv => {
              const sc = inv.status==='Paid'?{bg:'rgba(22,163,74,0.1)',color:'var(--success)'}:inv.status==='On Hold'?{bg:'#FEF9C3',color:'#92400E'}:inv.status==='Returned'?{bg:'rgba(220,38,38,0.1)',color:'var(--danger)'}:{bg:'rgba(59,130,246,0.1)',color:'#1d4ed8'}
              const net = inv.total_sales_net || 0
              const isEditing = editingInvoice?.id === inv.id
              return (
                <div key={inv.id} className="card" style={{ marginBottom: 10, border: isEditing ? '1.5px solid var(--accent)' : '0.5px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                    {inv.status !== 'Paid' && (
                      <label onClick={e => e.stopPropagation()} title="Select for Mark Paid" style={{ display:'flex', alignItems:'center', gap:3, cursor:'pointer', padding:'2px 6px', borderRadius:5, background: bulkInvoices.some(b=>b.id===inv.id) ? 'rgba(22,163,74,0.12)' : 'var(--bg)', border:'1px solid var(--border)' }}>
                        <input type="checkbox" checked={bulkInvoices.some(b => b.id===inv.id)} onChange={e => { setBulkInvoices(p => e.target.checked?[...p,inv]:p.filter(b=>b.id!==inv.id)) }} style={{ width: 'auto', margin: 0 }} />
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>✅ Paid</span>
                      </label>
                    )}
                    <label onClick={e => e.stopPropagation()} title="Select for Bulk Excel Export" style={{ display:'flex', alignItems:'center', gap:3, cursor:'pointer', padding:'2px 6px', borderRadius:5, background: bulkExportIds.includes(inv.id) ? 'rgba(59,130,246,0.12)' : 'var(--bg)', border:'1px solid var(--border)' }}>
                      <input type="checkbox" checked={bulkExportIds.includes(inv.id)} onChange={e => { setBulkExportIds(p => e.target.checked?[...p,inv.id]:p.filter(id=>id!==inv.id)) }} style={{ width: 'auto', margin: 0 }} />
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>📊 Export</span>
                    </label>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 15 }}>{inv.invoice_no}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(inv.invoice_date)}</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{inv.client}</span>
                    <span className={`badge ${inv.truck_type==='Dump Truck'?'badge-dump':'badge-prime'}`} style={{ fontSize: 12 }}>{inv.truck_type==='Dump Truck'?'Dump':'PM'}</span>
                    {inv.trip_count > 0 && <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--bg)', borderRadius: 8, padding: '1px 7px' }}>{inv.trip_count} trip{inv.trip_count>1?'s':''}</span>}
                    <span style={{ marginLeft: 'auto' }}><span style={{ padding: '2px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: sc.bg, color: sc.color }}>{inv.status}</span></span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span>Total Sales: <strong style={{ fontFamily: 'var(--mono)' }}>₱{fmt(net)}</strong></span>
                    {inv.is_vat && <span>VAT (12%): <strong style={{ fontFamily: 'var(--mono)' }}>₱{fmt(net*0.12)}</strong></span>}
                    <span>W/Tax: <strong style={{ fontFamily: 'var(--mono)' }}>₱{fmt(net*0.02)}</strong></span>
                    <span>Total Due: <strong style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>₱{fmt(inv.is_vat ? (net*1.12-net*0.02) : (net-net*0.02))}</strong></span>
                    {inv.smcsl_wb_list && <span style={{ color: 'var(--muted)' }}>SMCSL WB: {inv.smcsl_wb_list}</span>}
                    {inv.remarks && (
                      <span style={{ color: '#cc0000', fontStyle: 'italic', fontWeight: 600, background: inv.remarks_color || 'rgba(220,38,38,0.08)', padding: '1px 8px', borderRadius: 6, border: `1px solid ${inv.remarks_color || 'rgba(220,38,38,0.2)'}` }}>
                        📝 {inv.remarks}
                      </span>
                    )}
                  </div>
                  {inv.locked_at && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 10, marginBottom: 6, fontWeight: 600 }}>
                      🔒 Locked — unlock to edit
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn-ghost btn-sm" onClick={async e => { e.stopPropagation(); const tbl=inv.truck_type==='Dump Truck'?'trips_dump':'trips_pm'; const {data}=await supabase.from(tbl).select('*').is('deleted_at',null).eq('invoice_id',inv.id).order('trip_date'); if(!data?.length){showToast('No trips found.','error');return}; setPreviewModal({trips:data,invoice:inv}) }}>👁</button>
                    <button className="btn-ghost btn-sm" onClick={async e => { e.stopPropagation(); const tbl=inv.truck_type==='Dump Truck'?'trips_dump':'trips_pm'; const {data}=await supabase.from(tbl).select('*').eq('invoice_id',inv.id).order('trip_date'); if(!data?.length){showToast('No trips found.','error');return}; setPrintAfterPreview(true); setPreviewModal({trips:data,invoice:inv}) }}>📄</button>
                    <button className="btn-ghost btn-sm" onClick={async e => { e.stopPropagation(); const tbl=inv.truck_type==='Dump Truck'?'trips_dump':'trips_pm'; const {data}=await supabase.from(tbl).select('*').eq('invoice_id',inv.id).order('trip_date'); if(!data?.length){showToast('No trips found.','error');return}; setExcelSigPending({ tripsData:data, invNo:inv.invoice_no, invDate:inv.invoice_date, client:inv.client, type:inv.truck_type, isVat:inv.is_vat }); setSigDialog(true) }}>📊</button>
                    {isAdmin
                      ? <button className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); if (inv.locked_at) { showToast('Invoice is locked. Click 🔓 to unlock first.', 'error'); return } setEditingInvoice(isEditing?null:{...inv}); setEditingRates({}); setRateOverrideGranted(false) }}>✏️ Edit</button>
                      : <button className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setOverridePinModal({action:'editInvoice',inv}); setOverridePinInput(''); setOverridePinError('') }}>✏️ Edit</button>
                    }
                    <button className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); if (inv.locked_at) { showToast('Invoice is locked. Unlock first.', 'error'); return } setOverridePinModal({action:'addTrip',inv}); setOverridePinInput(''); setOverridePinError('') }} title="Add trip to invoice">➕ Trip</button>
                    {isAdmin
                      ? <button className="btn-danger btn-sm" onClick={e => { e.stopPropagation(); if (inv.locked_at) { showToast('Invoice is locked. Unlock first.', 'error'); return } setDeleteInvoiceTarget(inv) }}>Del</button>
                      : <button className="btn-danger btn-sm" onClick={e => { e.stopPropagation(); if (inv.locked_at) { showToast('Invoice is locked. Unlock first.', 'error'); return } setOverridePinModal({action:'deleteInvoice',inv}); setOverridePinInput(''); setOverridePinError('') }}>Del</button>
                    }
                    {isAdmin && inv.status !== 'Paid' && !inv.locked_at && <button className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setMarkPaidModal({inv}); setMarkPaidDate(new Date().toISOString().slice(0,10)); setMarkPaidAmount('') }}>✅ Mark Paid</button>}
                    {isAdmin && <button className="btn-ghost btn-sm" onClick={async e => {
                      e.stopPropagation()
                      const tbl = inv.truck_type === 'Dump Truck' ? 'trips_dump' : 'trips_pm'
                      const { error } = await supabase.rpc('recalc_invoice_total', { p_invoice_id: inv.id, p_table: tbl })
                      if (error) showToast('Error: ' + error.message, 'error')
                      else { showToast('Invoice total recalculated.', 'info'); fetchAll() }
                    }} title="Recalculate total from trips">🔄</button>}
                    {isAdmin && <button className="btn-ghost btn-sm" onClick={async e => {
                      e.stopPropagation()
                      if (!inv.locked_at) {
                        // Lock — direct
                        await supabase.rpc('lock_invoice', { p_invoice_id: inv.id, p_lock: true })
                        fetchAll()
                      } else {
                        // Unlock — PIN prompt
                        setOverridePinModal({ action: 'unlockInvoice', inv })
                        setOverridePinInput(''); setOverridePinError('')
                      }
                    }} title={inv.locked_at ? 'Unlock invoice (PIN required)' : 'Lock invoice'}>{inv.locked_at ? '🔓' : '🔒'}</button>}
                  </div>
                  {/* Inline Edit Panel */}
                  {isEditing && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '0.5px solid var(--border)' }}>
                      <div className="form-grid" style={{ marginBottom: 12 }}>
                        <div className="form-group"><label className="label">Invoice No.</label><input value={editingInvoice.invoice_no||''} onChange={e => setEditingInvoice(i => ({...i,invoice_no:e.target.value}))} /></div>
                        <div className="form-group"><label className="label">Invoice Date</label><DateInput value={editingInvoice.invoice_date||''} onChange={e => setEditingInvoice(i => ({...i,invoice_date:e.target.value}))} /></div>
                        <div className="form-group">
                          <label className="label">Status</label>
                          <select value={editingInvoice.status} onChange={e => {
                            const ns=e.target.value; const autoAmt=((editingInvoice.total_sales_net||0)*(editingInvoice.is_vat?1.10:0.98)).toFixed(2); const autoDate=new Date().toISOString().slice(0,10)
                            setEditingInvoice(i => ({...i,status:ns,actual_amount_credited:ns==='Paid'?(i.actual_amount_credited||autoAmt):i.actual_amount_credited,date_credited:ns==='Paid'?(i.date_credited||autoDate):i.date_credited}))
                          }}>
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        {(editingInvoice.status==='Paid'||editingInvoice.actual_amount_credited||editingInvoice.date_credited) && <>
                          <div className="form-group"><label className="label">Actual Amount Credited (₱)</label><input type="number" value={editingInvoice.actual_amount_credited||''} onChange={e => setEditingInvoice(i => ({...i,actual_amount_credited:e.target.value}))} placeholder="0.00" /></div>
                          <div className="form-group"><label className="label">Date Credited to Bank</label><DateInput value={editingInvoice.date_credited||''} onChange={e => setEditingInvoice(i => ({...i,date_credited:e.target.value}))} /></div>
                        </>}
                        <div className="form-group" style={{ gridColumn: 'span 2' }}>
                          <label className="label">Remarks</label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input value={editingInvoice.remarks||''} onChange={e => setEditingInvoice(i => ({...i,remarks:e.target.value}))} style={{ flex: 1 }} />
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Highlight:</span>
                              {[['#FF5800','orange'],['#FF69B4','pink'],['#FFE600','yellow']].map(([hex, label]) => (
                                <button key={hex} onClick={() => setEditingInvoice(i => ({...i, remarks_color: i.remarks_color === hex ? null : hex}))}
                                  title={label}
                                  style={{ width: 22, height: 22, borderRadius: '50%', background: hex, border: editingInvoice.remarks_color === hex ? '2.5px solid #333' : '2px solid transparent', cursor: 'pointer', flexShrink: 0 }} />
                              ))}
                              {editingInvoice.remarks_color && <button onClick={() => setEditingInvoice(i => ({...i,remarks_color:null}))} style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }} title="Clear color">✕</button>}
                            </div>
                          </div>
                        </div>
                      </div>
                      {invoiceTrips.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trips ({invoiceTrips.length})</span>
                            {(isAdmin || rateOverrideGranted) && Object.keys(editingRates).length > 0 && (
                              <button className="btn-primary btn-sm" onClick={saveRates} disabled={savingRates}>
                                {savingRates ? 'Saving…' : `💾 Save ${Object.keys(editingRates).length} Rate Change${Object.keys(editingRates).length!==1?'s':''}`}
                              </button>
                            )}
                          </div>
                          <div style={{ border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                            {invoiceTrips.map((t, i) => {
                              const rateField = editingInvoice.truck_type === 'Dump Truck' ? 'rate_per_ton' : 'supplier_amount'
                              const rateLabel = editingInvoice.truck_type === 'Dump Truck' ? 'Rate/ton' : 'Supplier Amt'
                              const currentRate = editingRates[t.id] !== undefined ? editingRates[t.id] : (t[rateField] ?? '')
                              const displayRate = editingRates[t.id] !== undefined ? parseFloat(editingRates[t.id]) || 0 : (t[rateField] || 0)
                              const amt = editingInvoice.truck_type === 'Dump Truck' ? (t.weight_tons||0)*displayRate : displayRate+(t.stripping_fee||0)
                              const changed = editingRates[t.id] !== undefined
                              return (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: i<invoiceTrips.length-1?'0.5px solid var(--border)':'none', background: changed?'rgba(255,30,0,0.05)':removingTripId===t.id?'rgba(220,38,38,0.06)':'transparent' }}>
                                  <span style={{ minWidth: 82, color: 'var(--muted)', fontSize: 11 }}>{fmtDate(t.trip_date)}</span>
                                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 500, minWidth: 75, fontSize: 12 }}>{t.truck_plate}</span>
                                  <span style={{ flex: 1, fontSize: 11, color: 'var(--muted)' }}>{editingInvoice.truck_type==='Dump Truck'?`${t.route||''} · ${t.commodity||''} · ${t.weight_tons}t`:`${t.trip_code||''} · ${t.container_size||''}`}</span>
                                  {(isAdmin || rateOverrideGranted) ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <label style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{rateLabel}:</label>
                                      <input type="number" step="0.01" value={currentRate} onChange={e => setEditingRates(r => ({...r,[t.id]:e.target.value}))}
                                        style={{ width: 88, padding: '2px 6px', fontSize: 12, fontFamily: 'var(--mono)', border: `1px solid ${changed?'var(--accent)':'var(--border)'}`, borderRadius: 4, background: changed?'var(--accent-light)':'var(--surface)' }} />
                                      {changed && <button onClick={() => setEditingRates(r => { const n={...r}; delete n[t.id]; return n })} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--muted)', fontSize:14, lineHeight:1, padding:'0 2px' }} title="Undo">↩</button>}
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <label style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{rateLabel}:</label>
                                      <span style={{ width: 88, padding: '2px 6px', fontSize: 12, fontFamily: 'var(--mono)', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--muted)', display: 'inline-block', textAlign: 'right' }}>{fmt(t[rateField]??0)}</span>
                                      <button onClick={() => { setRateOverridePinModal(true); setRateOverridePinInput(''); setRateOverridePinError('') }} style={{ background:'none', border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--muted)', fontSize:11, padding:'2px 5px' }} title="Unlock rate editing">🔑</button>
                                    </div>
                                  )}
                                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, minWidth: 80, textAlign: 'right', fontSize: 12, color: changed?'var(--accent)':'var(--text)' }}>₱{fmt(amt)}</span>
                                  <button className="btn-danger btn-sm" disabled={removingTripId===t.id} onClick={() => handleRemoveTripFromInvoice(t.id, editingInvoice.id, editingInvoice.truck_type)}>
                                    {removingTripId===t.id?'…':'Remove'}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                          {invoiceTrips.length === 1 && <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>⚠️ Removing the last trip will delete this invoice.</p>}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn-ghost" onClick={() => { setEditingInvoice(null); setInvoiceTrips([]); setEditingRates({}); setRateOverrideGranted(false) }}>Cancel</button>
                        {isAdmin && <button className="btn-danger" onClick={() => { setDeleteInvoiceTarget(editingInvoice); setEditingInvoice(null) }}>Delete Invoice</button>}
                        <button className="btn-primary" onClick={saveInvoiceUpdate} disabled={savingInvoice}>{savingInvoice?'Saving…':'Save'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {/* ── MANAGE TRIPS TAB ── */}
      {tab === 'Manage Trips' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['Dump Truck', 'Prime Mover'].map(t => (<button key={t} onClick={() => { setManageTab(t); setManageSelected([]); setManageClient(''); setManageRoute(''); setManageCommodity(''); setManageTripCode(''); setManageContainerSize('') }} className={manageTab===t?'btn-primary btn-sm':'btn-ghost btn-sm'}>{t}</button>))}
          </div>
          <div className="filter-bar" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <input placeholder="Search plate, client, WB, vessel…" value={manageSearch} onChange={e => setManageSearch(e.target.value)} style={{ flex: 2, minWidth: 160 }} />
            <input type="month" value={manageMonth} onChange={e => setManageMonth(e.target.value)} style={{ width: 'auto' }} />
            <select value={manageTruck} onChange={e => setManageTruck(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All trucks</option>
              {[...new Set((manageTab==='Dump Truck'?allDumpTrips:allPmTrips).map(t=>t.truck_plate).filter(Boolean))].sort().map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={manageClient} onChange={e => setManageClient(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All clients</option>
              {[...new Set((manageTab==='Dump Truck'?allDumpTrips:allPmTrips).map(t=>t.client).filter(Boolean))].sort().map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {manageTab === 'Dump Truck' && <>
              <select value={manageRoute} onChange={e => setManageRoute(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All routes</option>
                {[...new Set(allDumpTrips.map(t=>t.route).filter(Boolean))].sort().map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={manageCommodity} onChange={e => setManageCommodity(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All commodities</option>
                {[...new Set(allDumpTrips.map(t=>t.commodity).filter(Boolean))].sort().map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </>}
            {manageTab === 'Prime Mover' && <>
              <select value={manageTripCode} onChange={e => setManageTripCode(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All trip codes</option>
                {[...new Set(allPmTrips.map(t=>t.trip_code).filter(Boolean))].sort().map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={manageContainerSize} onChange={e => setManageContainerSize(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All sizes</option>
                <option value="20ft">20ft</option>
                <option value="40ft">40ft</option>
              </select>
            </>}
            {(manageSearch||manageMonth||manageTruck||manageClient||manageRoute||manageCommodity||manageTripCode||manageContainerSize) &&
              <button className="btn-ghost btn-sm" onClick={() => { setManageSearch(''); setManageMonth(''); setManageTruck(''); setManageClient(''); setManageRoute(''); setManageCommodity(''); setManageTripCode(''); setManageContainerSize('') }}>Clear</button>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Sort:</span>
            {(manageTab === 'Dump Truck'
              ? [['trip_date','Date'],['truck_plate','Plate'],['client','Client'],['route','Route'],['commodity','Commodity'],['amount','Amount']]
              : [['trip_date','Date'],['truck_plate','Plate'],['client','Client'],['trip_code','Code'],['container_size','Size'],['amount','Amount']]
            ).map(([k,l]) => (
              <button key={k} onClick={() => toggleManageSort(k)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: `1px solid ${manageSortKey===k?'var(--accent)':'var(--border)'}`, background: manageSortKey===k?'var(--accent-light)':'var(--surface)', cursor: 'pointer', color: manageSortKey===k?'var(--accent)':'var(--muted)' }}>
                {l} {manageSortKey===k?(manageSortDir==='asc'?'▲':'▼'):''}
              </button>
            ))}
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{filteredManaged.length} trip{filteredManaged.length!==1?'s':''}</span>
          </div>
          {manageSelected.length > 0 && (
            <div style={{ padding: '10px 14px', background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: 'var(--danger)', flex: 1 }}>{manageSelected.length} selected</span>
              <button className="btn-ghost btn-sm" onClick={() => setBulkRateEdit(v => !v)}>✏️ Edit Rate</button>
              {bulkRateEdit && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" step="0.01" value={bulkRate} onChange={e => setBulkRate(e.target.value)} placeholder={manageTab==='Dump Truck'?'Rate/ton':'Supplier amount'} style={{ width: 130, padding: '4px 8px', fontSize: 12 }} />
                  <button className="btn-primary btn-sm" onClick={handleBulkRateEdit} disabled={bulkRateSaving||!bulkRate}>{bulkRateSaving?'Saving…':'Apply to All'}</button>
                </div>
              )}
              <button className="btn-ghost btn-sm" onClick={() => { setManageSelected([]); setBulkRateEdit(false); setBulkRate('') }}>Deselect</button>
              <button className="btn-danger btn-sm" onClick={handleDeleteManage} disabled={deletingManage}>{deletingManage?'Deleting…':'Delete Selected'}</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th style={{ width: 36 }}><input type="checkbox" style={{ width: 'auto' }} onChange={e => setManageSelected(e.target.checked?filteredManaged.map(t=>t.id):[])} checked={manageSelected.length===filteredManaged.length&&filteredManaged.length>0} /></th>
                {[['trip_date','Date'],['truck_plate','Plate']].map(([k,l]) => (<th key={k} onClick={() => toggleManageSort(k)} style={{ cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>{l} {manageSortKey===k?(manageSortDir==='asc'?'▲':'▼'):''}</th>))}
                {manageTab === 'Dump Truck' ? <>
                  {[['client','Client'],['route','Route'],['commodity','Commodity']].map(([k,l]) => <th key={k} onClick={() => toggleManageSort(k)} style={{ cursor:'pointer', userSelect:'none' }}>{l} {manageSortKey===k?(manageSortDir==='asc'?'▲':'▼'):''}</th>)}
                  <th className="text-right">Tons</th>
                  <th onClick={() => toggleManageSort('amount')} className="text-right" style={{ cursor:'pointer', userSelect:'none' }}>Amount {manageSortKey==='amount'?(manageSortDir==='asc'?'▲':'▼'):''}</th>
                </> : <>
                  {[['client','Client'],['trip_code','Code'],['container_size','Size']].map(([k,l]) => <th key={k} onClick={() => toggleManageSort(k)} style={{ cursor:'pointer', userSelect:'none' }}>{l} {manageSortKey===k?(manageSortDir==='asc'?'▲':'▼'):''}</th>)}
                  <th onClick={() => toggleManageSort('amount')} className="text-right" style={{ cursor:'pointer', userSelect:'none' }}>Amount {manageSortKey==='amount'?(manageSortDir==='asc'?'▲':'▼'):''}</th>
                </>}
                <th>Invoice</th>
              </tr></thead>
              <tbody>
                {filteredManaged.map(t => {
                  const amt = manageTab==='Dump Truck'?(t.weight_tons||0)*(t.rate_per_ton||0):(t.supplier_amount||0)+(t.stripping_fee||0)
                  return (
                    <tr key={t.id}>
                      <td><input type="checkbox" style={{ width: 'auto' }} checked={manageSelected.includes(t.id)} onChange={e => setManageSelected(p => e.target.checked?[...p,t.id]:p.filter(id=>id!==t.id))} /></td>
                      <td style={{ fontSize: 12 }}>{fmtDate(t.trip_date)}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500 }}>{t.truck_plate}</td>
                      {manageTab === 'Dump Truck' ? <>
                        <td style={{ fontSize: 12 }}>{t.client}</td>
                        <td style={{ fontSize: 12 }}>{t.route}</td>
                        <td style={{ fontSize: 12 }}>{t.commodity}</td>
                        <td className="text-right" style={{ fontSize: 12 }}>{t.weight_tons}</td>
                        <td className="text-right mono" style={{ fontWeight: 600 }}>₱{fmt(amt)}</td>
                      </> : <>
                        <td style={{ fontSize: 12 }}>{t.client}</td>
                        <td style={{ fontSize: 12 }}>{t.trip_code}</td>
                        <td style={{ fontSize: 12 }}>{t.container_size}</td>
                        <td className="text-right mono" style={{ fontWeight: 600 }}>₱{fmt(amt)}</td>
                      </>}
                      <td style={{ display:'flex', gap:6, alignItems:'center', whiteSpace:'nowrap' }}>
                        {t.invoice_id
                          ? <button onClick={() => { setTab('Invoice List'); setInvSearch(invoiceMap[t.invoice_id]||''); setInvFilterMonth(''); setInvFilterClient(''); setInvFilterStatus('') }} style={{ background:'none', border:'none', cursor:'pointer', padding:0 }}>
                              <span className="badge badge-success" style={{ fontSize: 11 }}>✓ {invoiceMap[t.invoice_id]?`Invoiced (${invoiceMap[t.invoice_id]})`:'Invoiced'} →</span>
                            </button>
                          : <span className="badge" style={{ background:'var(--bg)', color:'var(--muted)', fontSize:11 }}>Pending</span>}
                        {!t.invoice_id && <button className="btn-ghost btn-sm" onClick={() => setQuickEditTrip({ ...t })} title="Quick edit">✏️</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── AGING REPORT TAB ── */}
      {tab === 'Aging Report' && (() => {
        const now2 = new Date()
        const getDays = (inv) => Math.floor((now2 - new Date(inv.invoice_date)) / 86400000)
        const buckets = { all:agingDisplayed, b60:agingDisplayed.filter(i=>getDays(i)>=60), b45:agingDisplayed.filter(i=>{const d=getDays(i);return d>=45&&d<=59}), b30:agingDisplayed.filter(i=>{const d=getDays(i);return d>=30&&d<=44}), b1:agingDisplayed.filter(i=>getDays(i)<30) }
        const bucketList = [{ key:'all',label:agingShowAll?'All Incoming':'All Overdue',color:'var(--text)' },{ key:'b60',label:'Critical 60d+',color:'var(--danger)',bg:'#FFEBEE' },{ key:'b45',label:'Warning 45–59d',color:'#CC5500',bg:'#FFF3E0' },{ key:'b30',label:'Mild 30–44d',color:'#B8860B',bg:'#FFFDE7' },...(agingShowAll?[{key:'b1',label:'Current (not yet due)',color:'var(--success)'}]:[])]
        const rawDisplayed = buckets[agingBucket] || buckets.all
        const displayed = [...rawDisplayed].sort((a,b) => {
          if (agingSortKey==='days'||!agingSortKey) return agingSortDir==='asc'?getDays(a)-getDays(b):getDays(b)-getDays(a)
          if (agingSortKey==='total_sales_net') { const d=(a.total_sales_net||0)-(b.total_sales_net||0); return agingSortDir==='asc'?d:-d }
          if (agingSortKey==='invoice_no') { const an=parseFloat(a.invoice_no)||0,bn=parseFloat(b.invoice_no)||0; return agingSortDir==='asc'?an-bn:bn-an }
          let av=a[agingSortKey]||'',bv=b[agingSortKey]||''; if(typeof av==='string')av=av.toLowerCase(); if(typeof bv==='string')bv=bv.toLowerCase()
          return av<bv?(agingSortDir==='asc'?-1:1):av>bv?(agingSortDir==='asc'?1:-1):0
        })
        const grandTotal = displayed.reduce((s,i) => s+(i.total_sales_net||0), 0)
        return (
          <div>
            <div className="filter-bar" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <select value={agingTruckType} onChange={e => setAgingTruckType(e.target.value)} style={{ width: 'auto' }}><option value="">All types</option><option value="Dump Truck">Dump Truck</option><option value="Prime Mover">Prime Mover</option></select>
              <select value={agingClient} onChange={e => setAgingClient(e.target.value)} style={{ width: 'auto' }}><option value="">All clients</option>{allInvClients.map(c => <option key={c} value={c}>{c}</option>)}</select>
              <button className="btn-ghost btn-sm" onClick={() => setAgingShowAll(v => !v)}>{agingShowAll?'📋 Overdue Only (30d+)':'📋 All Incoming (incl. Current)'}</button>
              <button className="btn-primary btn-sm" onClick={() => setShowOverduePrintModal(true)}>🖨️ Print Aging Report</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {bucketList.map(b => (<button key={b.key} onClick={() => setAgingBucket(b.key)} style={{ padding:'5px 14px', borderRadius:20, border:`1.5px solid ${agingBucket===b.key?b.color:'var(--border)'}`, background:agingBucket===b.key?(b.bg||'var(--accent-light)'):'var(--surface)', color:agingBucket===b.key?b.color:'var(--muted)', fontWeight:agingBucket===b.key?600:400, cursor:'pointer', fontSize:12 }}>{b.label} <span style={{ fontFamily:'var(--mono)' }}>({buckets[b.key]?.length||0})</span></button>))}
            </div>
            <div style={{ fontSize: 13, marginBottom: 10, color: 'var(--muted)' }}>{displayed.length} invoice{displayed.length!==1?'s':''} · Total Sales: <strong style={{ color:'var(--danger)', fontFamily:'var(--mono)' }}>₱{fmt(grandTotal)}</strong></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  {[['invoice_no','Invoice No.'],['client','Client'],['invoice_date','Date'],null,['status','Status'],['total_sales_net','Total Sales'],null,['days','Days'],null].map((col,i) => col
                    ? <th key={i} onClick={() => toggleAgingSort(col[0])} style={{ cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>{col[1]} {agingSortKey===col[0]?(agingSortDir==='asc'?'▲':'▼'):''}</th>
                    : <th key={i}>{['Type','Total Sales (Confirmed)','Remarks'][i===3?0:i===6?1:2]}</th>
                  )}
                </tr></thead>
                <tbody>
                  {displayed.map(inv => {
                    const days=getDays(inv); const rowBg=days>=60?'rgba(220,38,38,0.18)':days>=45?'rgba(204,85,0,0.15)':days>=30?'rgba(184,134,11,0.12)':'transparent'; const dayColor=days>=60?'var(--danger)':days>=45?'#CC5500':days>=30?'#B8860B':'var(--muted)'; const net=inv.total_sales_net||0
                    return (<tr key={inv.id} style={{ background:rowBg }}><td style={{ fontFamily:'var(--mono)', fontSize:12 }}>{inv.invoice_no}</td><td style={{ fontSize:12 }}>{inv.client}</td><td style={{ fontSize:12 }}>{fmtDate(inv.invoice_date)}</td><td><span className={`badge ${inv.truck_type==='Dump Truck'?'badge-dump':'badge-prime'}`} style={{ fontSize:10 }}>{inv.truck_type==='Dump Truck'?'Dump':'PM'}</span></td><td><span style={{ padding:'2px 8px', borderRadius:6, fontSize:11, background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>{inv.status}</span></td><td className="text-right mono" style={{ fontSize:12 }}>₱{fmt(net)}</td><td className="text-right mono" style={{ fontSize:12 }}>₱{fmt(inv.is_vat ? net*1.12 : net)}</td><td style={{ fontFamily:'var(--mono)', fontWeight:700, color:dayColor, fontSize:12, textAlign:'center' }}>{days}d</td><td style={{ fontSize:11, color:'var(--muted)' }}>{inv.remarks||''}</td></tr>)
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* ── CLIENT BALANCE TAB ── */}
      {tab === 'Client Balance' && (() => {
        const allClientInvoices = balanceClient ? invoices.filter(i => i.client===balanceClient) : []
        const clientInvoices = allClientInvoices.filter(i =>
          balanceStatusFilter === 'all' ? true :
          balanceStatusFilter === 'paid' ? i.status === 'Paid' :
          i.status !== 'Paid'
        )
        const totalInvoiced = allClientInvoices.reduce((s,i) => s+(i.total_sales_net||0), 0)
        const totalPaid = allClientInvoices.filter(i=>i.status==='Paid').reduce((s,i) => s+(i.actual_amount_credited||(i.total_sales_net||0)*(i.is_vat?1.10:0.98)), 0)
        const outstanding = totalInvoiced - totalPaid
        const clients = [...new Set(invoices.map(i => i.client).filter(Boolean))].sort()
        const nowAR = new Date()
        const getARDays = (inv) => Math.floor((nowAR - new Date(inv.invoice_date)) / 86400000)
        return (
          <div>
            <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap', alignItems:'flex-end' }}>
              <div className="form-group" style={{ maxWidth: 320, margin:0 }}>
                <label className="label">Select Client</label>
                <div>
                  <input value={balanceClient} onChange={e => setBalanceClient(e.target.value)}
                    list="balance-clients" placeholder="Type or pick client"
                    style={{ padding:'7px 10px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:13, width:'100%' }} />
                  <datalist id="balance-clients">
                    {clients.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
              {balanceClient && (
                <div style={{ display:'flex', gap:6 }}>
                  {[['all','All'],['paid','Paid'],['unpaid','Unpaid (with aging)']].map(([key,label]) => (
                    <button key={key} onClick={() => setBalanceStatusFilter(key)}
                      style={{ padding:'7px 14px', borderRadius:6, border:`1px solid ${balanceStatusFilter===key?'var(--accent)':'var(--border)'}`, background:balanceStatusFilter===key?'var(--accent-light)':'var(--surface)', color:balanceStatusFilter===key?'var(--accent)':'var(--muted)', cursor:'pointer', fontSize:13, fontWeight:balanceStatusFilter===key?600:400 }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {balanceClient && (
              <>
                <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                  <button onClick={() => handleARPrint(balanceClient, clientInvoices)}
                    style={{ padding:'7px 14px', background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', fontSize:13 }}>
                    🖨️ Print PDF
                  </button>
                  <button onClick={() => handleARExcel(balanceClient, clientInvoices)}
                    style={{ padding:'7px 14px', background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', fontSize:13 }}>
                    📊 Excel
                  </button>
                </div>
                <div className="stats-grid" style={{ marginBottom: 16 }}>
                  <div className="stat-card"><div className="stat-label">Total Invoiced</div><div className="stat-value sm">₱{fmt(totalInvoiced)}</div><div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{clientInvoices.length} invoices</div></div>
                  <div className="stat-card"><div className="stat-label">Total Paid</div><div className="stat-value sm" style={{ color:'var(--success)' }}>₱{fmt(totalPaid)}</div><div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{clientInvoices.filter(i=>i.status==='Paid').length} invoices</div></div>
                  <div className="stat-card"><div className="stat-label">Outstanding Balance</div><div className="stat-value sm" style={{ color:outstanding>0?'var(--danger)':'var(--success)' }}>₱{fmt(outstanding)}</div><div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{clientInvoices.filter(i=>i.status!=='Paid').length} unpaid</div></div>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Invoice No.</th><th>Date</th><th>Type</th><th className="text-right">Total Sales</th><th className="text-right">Amt Received</th><th>Date Credited</th><th>Status</th>{balanceStatusFilter==='unpaid' && <th className="text-right">Aging</th>}</tr></thead>
                    <tbody>
                      {clientInvoices.sort((a,b) => new Date(b.invoice_date)-new Date(a.invoice_date)).map(inv => {
                        const vatInc=(inv.total_sales_net||0)*(inv.is_vat?1.12:1); const received=inv.actual_amount_credited||(inv.status==='Paid'?(inv.total_sales_net||0)*(inv.is_vat?1.10:0.98):0)
                        const days = getARDays(inv)
                        return (<tr key={inv.id}><td className="mono" style={{ fontWeight:600 }}>{inv.invoice_no}</td><td>{fmtDate(inv.invoice_date)}</td><td style={{ fontSize:11 }}>{inv.truck_type}</td><td className="text-right mono">₱{fmt(vatInc)}</td><td className="text-right mono">{received>0?`₱${fmt(received)}`:'—'}</td><td style={{ fontSize:11 }}>{inv.date_credited?fmtDate(inv.date_credited):'—'}</td><td><span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:inv.status==='Paid'?'rgba(22,163,74,0.1)':'rgba(234,179,8,0.1)', color:inv.status==='Paid'?'var(--success)':'var(--warning)' }}>{inv.status}</span></td>{balanceStatusFilter==='unpaid' && <td className="text-right" style={{ fontSize:12, fontWeight:600, color: days>=60?'var(--danger)':days>=30?'#CC5500':'var(--muted)' }}>{days}d</td>}</tr>)
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {!balanceClient && <div className="empty-state"><p>Select a client to view their balance.</p></div>}
          </div>
        )
      })()}

      {/* ── QUICK EDIT MODAL (Manage Trips) ── */}
      {quickEditTrip && (
        <div className="modal-overlay" onClick={() => setQuickEditTrip(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, width: '92vw' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <h3 style={{ margin:0 }}>Quick Edit — {manageTab}</h3>
              <button className="btn-ghost btn-sm" onClick={() => setQuickEditTrip(null)}>✕</button>
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', marginBottom:14, padding:'6px 10px', background:'var(--bg)', borderRadius:6 }}>
              For deeper edits (containers, island codes, port details), use the full edit form in Trips.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div className="form-group">
                <label className="label">Date</label>
                <DateInput value={quickEditTrip.trip_date||''} onChange={e => setQuickEditTrip(t => ({...t, trip_date: e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="label">Truck Plate</label>
                <select value={quickEditTrip.truck_plate||''} onChange={e => setQuickEditTrip(t => ({...t, truck_plate: e.target.value}))}>
                  <option value="">— Select —</option>
                  {trucks.map(tr => <option key={tr.id} value={tr.plate}>{tr.plate}</option>)}
                </select>
              </div>

              {manageTab === 'Dump Truck' ? (
                <>
                  <div className="form-group">
                    <label className="label">Client</label>
                    <select value={quickEditTrip.client||''} onChange={e => setQuickEditTrip(t => ({...t, client: e.target.value}))}>
                      <option value="">— Select —</option>
                      {clientsList.map(c => <option key={c.id} value={c.nickname}>{c.nickname}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Route</label>
                    <select value={quickEditTrip.route||''} onChange={e => setQuickEditTrip(t => ({...t, route: e.target.value}))}>
                      <option value="">— Select —</option>
                      {DUMP_TRUCK_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Commodity</label>
                    <select value={quickEditTrip.commodity||''} onChange={e => setQuickEditTrip(t => ({...t, commodity: e.target.value}))}>
                      <option value="">— Select —</option>
                      {commodities.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Weight (tons)</label>
                    <input type="number" step="0.001" value={quickEditTrip.weight_tons||''} onChange={e => setQuickEditTrip(t => ({...t, weight_tons: e.target.value}))} />
                  </div>
                  <div className="form-group">
                    <label className="label">Rate / Ton</label>
                    <input type="number" step="0.01" value={quickEditTrip.rate_per_ton||''} onChange={e => setQuickEditTrip(t => ({...t, rate_per_ton: e.target.value}))} />
                  </div>
                  <div className="form-group" style={{ gridColumn:'1 / -1' }}>
                    <div style={{ fontSize:12, color:'var(--muted)' }}>Amount: <strong style={{ color:'var(--accent)' }}>₱{fmt((parseFloat(quickEditTrip.weight_tons)||0) * (parseFloat(quickEditTrip.rate_per_ton)||0))}</strong></div>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label className="label">Client</label>
                    <select value={quickEditTrip.client||''} onChange={e => setQuickEditTrip(t => ({...t, client: e.target.value}))}>
                      <option value="">— Select —</option>
                      {clientsList.map(c => <option key={c.id} value={c.nickname}>{c.nickname}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Trip Code</label>
                    <select value={quickEditTrip.trip_code||''} onChange={e => setQuickEditTrip(t => ({...t, trip_code: e.target.value}))}>
                      {['Hustling PSACC','Hauling PSACC','SMC'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Container Size</label>
                    <select value={quickEditTrip.container_size||''} onChange={e => setQuickEditTrip(t => ({...t, container_size: e.target.value}))}>
                      <option value="20ft">20ft</option>
                      <option value="40ft">40ft</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Supplier Amount</label>
                    <input type="number" step="0.01" value={quickEditTrip.supplier_amount||''} onChange={e => setQuickEditTrip(t => ({...t, supplier_amount: e.target.value}))} />
                  </div>
                  {quickEditTrip.trip_code === 'SMC' && (
                    <div className="form-group">
                      <label className="label">Stripping Fee</label>
                      <input type="number" step="0.01" value={quickEditTrip.stripping_fee||''} onChange={e => setQuickEditTrip(t => ({...t, stripping_fee: e.target.value}))} />
                    </div>
                  )}
                  <div className="form-group" style={{ gridColumn:'1 / -1' }}>
                    <div style={{ fontSize:12, color:'var(--muted)' }}>Amount: <strong style={{ color:'var(--accent)' }}>₱{fmt((parseFloat(quickEditTrip.supplier_amount)||0) + (parseFloat(quickEditTrip.stripping_fee)||0))}</strong></div>
                  </div>
                </>
              )}

              <div className="form-group" style={{ gridColumn:'1 / -1' }}>
                <label className="label">Remarks</label>
                <input value={quickEditTrip.remarks||''} onChange={e => setQuickEditTrip(t => ({...t, remarks: e.target.value}))} placeholder="Optional notes" />
              </div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
              <button className="btn-ghost" onClick={() => setQuickEditTrip(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleQuickEditSave} disabled={quickEditSaving}>{quickEditSaving?'Saving…':'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PREVIEW MODAL ── */}
      {previewModal && (
        <div className="modal-overlay" onClick={() => { setPreviewModal(null); setPrintAfterPreview(false) }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1200, width: '98vw', maxHeight: '95vh', overflow: 'auto', padding: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
              <h3 style={{ margin: 0 }}>SOA Preview — {previewModal.invoice.invoice_no}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: 6, padding: 3 }}>
                  {['landscape','portrait'].map(o => (
                    <button key={o} onClick={() => setPrintOrientation(o)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: 'none', background: printOrientation === o ? 'var(--accent)' : 'transparent', color: printOrientation === o ? '#fff' : 'var(--muted)', cursor: 'pointer' }}>
                      {o === 'landscape' ? '⬛ Landscape' : '▯ Portrait'}
                    </button>
                  ))}
                </div>
                <button className="btn-primary btn-sm" onClick={triggerPrintFromPreview}>🖨️ Print / Save PDF</button>
                <button className="btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setExcelSigPending({ tripsData:previewModal.trips, invNo:previewModal.invoice.invoice_no, invDate:previewModal.invoice.invoice_date, client:previewModal.invoice.client, type:previewModal.invoice.truck_type, isVat:previewModal.invoice.is_vat }); setSigDialog(true) }}>📊 Excel</button>
                <button className="btn-ghost btn-sm" onClick={() => { setPreviewModal(null); setPrintAfterPreview(false) }}>✕ Close</button>
              </div>
            </div>
            <div id="soa-preview-content" style={{ padding: 16, overflow: 'auto', minHeight: 400 }}>
              {previewModal.invoice.truck_type === 'Dump Truck'
                ? renderDumpSOA(previewModal.trips, previewModal.invoice.invoice_no, previewModal.invoice.invoice_date, previewModal.invoice.client, previewModal.invoice.is_vat)
                : renderPMSOA(previewModal.trips, previewModal.invoice.invoice_no, previewModal.invoice.invoice_date, previewModal.invoice.client, previewModal.invoice.is_vat)}
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE INVOICE CONFIRM ── */}
      {deleteInvoiceTarget && (
        <div className="modal-overlay" onClick={() => setDeleteInvoiceTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Delete Invoice {deleteInvoiceTarget.invoice_no}?</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>This will unlink all trips from this invoice. Cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setDeleteInvoiceTarget(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => handleDeleteInvoice(deleteInvoiceTarget)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── OVERRIDE PIN MODAL ── */}
      {overridePinModal && (
        <div className="modal-overlay" onClick={() => { setOverridePinModal(null); setOverridePinInput(''); setOverridePinError('') }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h3 style={{ marginBottom: 8 }}>🔑 Override PIN Required</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{overridePinModal.action==='addTrip'?`Add trip to Invoice ${overridePinModal.inv.invoice_no} — enter admin override PIN to proceed.`:overridePinModal.action==='editInvoice'?`Edit Invoice ${overridePinModal.inv.invoice_no} — enter admin override PIN to proceed.`:`Delete Invoice ${overridePinModal.inv.invoice_no} — enter admin override PIN to confirm.`}</p>
            <div className="form-group">
              <label className="label">Override PIN</label>
              <input value={overridePinInput} onChange={e => { setOverridePinInput(e.target.value.toUpperCase()); setOverridePinError('') }} placeholder="e.g. A12345" maxLength={6} style={{ fontFamily:'var(--mono)', letterSpacing:4, fontSize:18, textAlign:'center' }} onKeyDown={e => e.key==='Enter'&&handleOverridePinCheck()} />
              {overridePinError && <div style={{ color:'var(--danger)', fontSize:11, marginTop:4 }}>{overridePinError}</div>}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => { setOverridePinModal(null); setOverridePinInput(''); setOverridePinError('') }}>Cancel</button>
              <button className={overridePinModal.action==='deleteInvoice'?'btn-danger':'btn-primary'} onClick={handleOverridePinCheck} disabled={overridePinChecking}>{overridePinChecking?'Checking…':overridePinModal.action==='deleteInvoice'?'Delete':overridePinModal.action==='editInvoice'?'Edit':'Proceed'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── RATE OVERRIDE PIN MODAL ── */}
      {rateOverridePinModal && (
        <div className="modal-overlay" onClick={() => { setRateOverridePinModal(false); setRateOverridePinInput(''); setRateOverridePinError('') }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h3 style={{ marginBottom: 8 }}>🔑 Override PIN — Rate Editing</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>Enter an admin override PIN to unlock rate editing for this invoice.</p>
            <div className="form-group">
              <label className="label">Override PIN</label>
              <input value={rateOverridePinInput} onChange={e => { setRateOverridePinInput(e.target.value.toUpperCase()); setRateOverridePinError('') }} placeholder="e.g. A12345" maxLength={6} style={{ fontFamily:'var(--mono)', letterSpacing:4, fontSize:18, textAlign:'center' }} onKeyDown={e => e.key==='Enter'&&handleRateOverridePinCheck()} />
              {rateOverridePinError && <div style={{ color:'var(--danger)', fontSize:11, marginTop:4 }}>{rateOverridePinError}</div>}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => { setRateOverridePinModal(false); setRateOverridePinInput(''); setRateOverridePinError('') }}>Cancel</button>
              <button className="btn-primary" onClick={handleRateOverridePinCheck} disabled={rateOverridePinChecking}>{rateOverridePinChecking?'Checking…':'Unlock'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD TRIP TO INVOICE MODAL ── */}
      {addTripModal && (
        <div className="modal-overlay" onClick={() => setAddTripModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, width: '96vw' }}>
            <h3 style={{ marginBottom: 4 }}>➕ Add Trip to Invoice {addTripModal.inv.invoice_no}</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{addTripModal.inv.client} · {addTripModal.inv.truck_type} · Select uninvoiced trips to add</p>
            {addTripCandidates.length === 0
              ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No uninvoiced {addTripModal.inv.truck_type} trips found for {addTripModal.inv.client}.</p>
              : <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{addTripCandidates.length} available · {addTripSelected.length} selected</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-ghost btn-sm" onClick={() => setAddTripSelected(addTripCandidates.map(t => t.id))}>Select All</button>
                      <button className="btn-ghost btn-sm" onClick={() => setAddTripSelected([])}>Clear</button>
                    </div>
                  </div>
                  <div style={{ maxHeight: 320, overflow: 'auto', border: '0.5px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
                    {addTripCandidates.map(t => {
                      const amt = addTripModal.inv.truck_type==='Dump Truck'?(t.weight_tons||0)*(t.rate_per_ton||0):(t.supplier_amount||0)+(t.stripping_fee||0)
                      const sel = addTripSelected.includes(t.id)
                      return (
                        <div key={t.id} onClick={() => setAddTripSelected(p => sel?p.filter(id=>id!==t.id):[...p,t.id])} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom:'0.5px solid var(--border)', background:sel?'var(--accent-light)':'transparent', cursor:'pointer' }}>
                          <input type="checkbox" checked={sel} onChange={()=>{}} style={{ width:'auto' }} />
                          <span style={{ fontSize:12, color:'var(--muted)', minWidth:90 }}>{t.trip_date}</span>
                          <span style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600, minWidth:80 }}>{t.truck_plate}</span>
                          {addTripModal.inv.truck_type==='Dump Truck'?<span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)', minWidth:100 }}>{t.smcsl_wb||'—'}</span>:<span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)', minWidth:100 }}>{t.smcsl_waybill_no||t.waybill_no||'—'}</span>}
                          <span style={{ fontSize:12, flex:1 }}>{addTripModal.inv.truck_type==='Dump Truck'?`${t.route||''} · ${t.commodity||''}`:`${t.trip_code||''} · ${t.container_size||''} · ${t.vessel||t.waybill_no||''}`}</span>
                          <span style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:600 }}>₱{fmt(amt)}</span>
                        </div>
                      )
                    })}
                  </div>
                </>
            }
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setAddTripModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddTripsConfirm} disabled={addTripSaving||!addTripSelected.length}>{addTripSaving?'Adding…':`Add ${addTripSelected.length} Trip${addTripSelected.length!==1?'s':''}`}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MARK PAID MODAL ── */}
      {markPaidModal && (
        <div className="modal-overlay" onClick={() => setMarkPaidModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 style={{ marginBottom: 4 }}>✅ Mark as Paid</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Invoice <strong>{markPaidModal.inv.invoice_no}</strong> — {markPaidModal.inv.client}<br />Total Sales: <strong>₱{fmt(markPaidModal.inv.total_sales_net||0)}</strong> · Expected (after {markPaidModal.inv.is_vat ? '12% VAT, ' : ''}2% W/Tax): <strong>₱{fmt((markPaidModal.inv.total_sales_net||0)*(markPaidModal.inv.is_vat?1.10:0.98))}</strong></p>
            <div className="form-grid">
              <div className="form-group"><label className="label required">Date Credited</label><DateInput value={markPaidDate} onChange={e => setMarkPaidDate(e.target.value)} max={new Date().toISOString().slice(0,10)} /></div>
              <div className="form-group"><label className="label">Actual Amount Received (₱)</label><input type="number" step="0.01" value={markPaidAmount} onChange={e => setMarkPaidAmount(e.target.value)} placeholder={fmt((markPaidModal.inv.total_sales_net||0)*(markPaidModal.inv.is_vat?1.10:0.98))} /></div>
            </div>
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn-ghost" onClick={() => setMarkPaidModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleMarkPaidConfirm} disabled={markPaidSaving||!markPaidDate}>{markPaidSaving?'Saving…':'Confirm Paid'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINT OVERDUE MODAL ── */}
      {showOverduePrintModal && (
        <div className="modal-overlay" onClick={() => setShowOverduePrintModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 style={{ marginBottom: 16 }}>🖨️ Print Aging Report</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group" style={{ margin:0 }}><label className="label">Truck Type</label><select value={overduePrintType} onChange={e => setOverduePrintType(e.target.value)}><option value="">All Types</option><option value="Dump Truck">Dump Truck</option><option value="Prime Mover">Prime Mover</option></select></div>
              <div className="form-group" style={{ margin:0 }}><label className="label">Client</label><select value={overduePrintClient} onChange={e => setOverduePrintClient(e.target.value)}><option value="">All Clients</option>{[...new Set(agingDisplayed.map(i=>i.client).filter(Boolean))].sort().map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              <div className="form-group" style={{ margin:0 }}><label className="label">Orientation</label><div style={{ display:'flex', gap:8 }}>{['landscape','portrait'].map(o => (<button key={o} onClick={() => setPrintOrientation(o)} className={printOrientation===o?'btn-primary btn-sm':'btn-ghost btn-sm'} style={{ flex:1 }}>{o==='landscape'?'⬜ Landscape':'📄 Portrait'}</button>))}</div></div>
              <div className="form-group" style={{ margin:0 }}><label className="label">Export Format</label><div style={{ display:'flex', gap:8 }}>{['pdf','excel'].map(f => (<button key={f} onClick={() => setPrintFormat(f)} className={printFormat===f?'btn-primary btn-sm':'btn-ghost btn-sm'} style={{ flex:1 }}>{f==='pdf'?'📄 PDF':'📊 Excel'}</button>))}</div></div>
              <div style={{ fontSize:12, color:'var(--muted)', padding:'8px 12px', background:'var(--bg)', borderRadius:8 }}>
                {(() => { const now5=new Date(); const count=agingDisplayed.filter(i=>{if(overduePrintType&&i.truck_type!==overduePrintType)return false;if(overduePrintClient&&i.client!==overduePrintClient)return false;return true}).length; return <span>{count} invoice{count!==1?'s':''} will be printed</span> })()}
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-ghost" onClick={() => setShowOverduePrintModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => { setShowOverduePrintModal(false); setAgingSigCallback(()=>(sigs)=>printFormat==='excel'?handleAgingExcel(sigs):handlePrintAllOverdue(sigs)); setAgingSigDialog(true) }}>{printFormat==='excel'?'📊 Export Excel':'🖨️ Export PDF'}</button>
            </div>
          </div>
        </div>
      )}

      <SignatoryDialog open={agingSigDialog} onClose={() => setAgingSigDialog(false)} onPrint={(sigs) => { setAgingSigDialog(false); agingSigCallback&&agingSigCallback(sigs) }} settings={settings} profile={profile} docType="Aging Report" />
      <SignatoryDialog open={sigDialog || bulkExportSigPending} onClose={() => { setSigDialog(false); setExcelSigPending(null); setBulkExportSigPending(false) }} onPrint={doTriggerPrint} settings={settings} profile={profile} docType={bulkExportSigPending ? `Bulk SOA Excel (${bulkExportIds.length})` : excelSigPending ? "SOA Excel" : "SOA"} />
      <Toast toast={toast} />
    </div>
  )
}
