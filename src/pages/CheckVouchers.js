import { useState, useEffect, useCallback } from 'react'
import DateInput from '../components/DateInput'
import { supabase, fmt, fmtDate, numberToWords, logAudit } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import jsPDF from 'jspdf'
import SignatoryDialog from '../components/SignatoryDialog'
import autoTable from 'jspdf-autotable'

const STATUS_OPTIONS = ['Pending', 'Approved', 'Released', 'Cancelled']
const STATUS_COLORS = {
  Pending: { bg: 'var(--warning-light)', color: 'var(--warning)' },
  Approved: { bg: 'var(--accent-light)', color: 'var(--accent)' },
  Released: { bg: 'var(--success-light)', color: 'var(--success)' },
  Cancelled: { bg: 'var(--danger-light)', color: 'var(--danger)' },
}

const TABS = ['Vouchers', 'Issued by Month', 'PDC Tracker', 'Bank Templates']

const EMPTY_CHECK_ROW = { check_date: '', check_no: '', description: '', amount: '' }

// Safe formatter — avoids ± sign from en-PH locale with negative numbers
const fmtAmt = (n) => {
  const num = Math.abs(parseFloat(String(n).replace(/[^0-9.-]/g, '')) || 0)
  const parts = num.toFixed(2).split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}
// PDF-safe amount formatter — no ₱ symbol, use P prefix
const pdfAmt = (n) => `P${fmtAmt(n)}`

// Generate next CV number
const genCVNo = (existing) => {
  const year = new Date().getFullYear()
  // Find highest number for current year
  const thisYearNums = existing
    .map(v => {
      const m = v.voucher_no?.match(new RegExp(`CV-${year}-(\\d+)`))
      return m ? parseInt(m[1]) : 0
    })
    .filter(n => n > 0)
  const next = (Math.max(0, ...thisYearNums) + 1).toString().padStart(3, '0')
  return `CV-${year}-${next}`
}

export default function CheckVouchers() {
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [tab, setTab] = useState('Vouchers')
  const [vouchers, setVouchers] = useState([])
  const [templates, setTemplates] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [sigDialog, setSigDialog] = useState(false)
  const [sigPrintVoucher, setSigPrintVoucher] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [editingVoucher, setEditingVoucher] = useState(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [mode, setMode] = useState('single') // 'single' or 'multiple'
  const [voucher_no, setVoucherNo] = useState('')
  const [voucher_date, setVoucherDate] = useState(new Date().toISOString().slice(0, 10))
  const [payee, setPayee] = useState('')
  const [bank_template_id, setBankTemplateId] = useState('')
  const [status, setStatus] = useState('Pending')
  const [approved_by, setApprovedBy] = useState('')
  const [remarks, setRemarks] = useState('')

  // Single check fields
  const [check_no, setCheckNo] = useState('')
  const [check_date, setCheckDate] = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')

  // Multiple checks
  const [checkRows, setCheckRows] = useState([{ ...EMPTY_CHECK_ROW }])

  // Template form
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [tmplForm, setTmplForm] = useState({
    bank_name: '', account_name: '', account_number: '', branch: '',
    check_width_mm: 215.9, check_height_mm: 88.9,
    date_x: 150, date_y: 12, payee_x: 25, payee_y: 28,
    amount_figures_x: 160, amount_figures_y: 28,
    amount_words_x: 15, amount_words_y: 38,
    amount_words_x2: 15, amount_words_y2: 45,
    signature_x: 140, signature_y: 68,
    font_size_date: 9, font_size_payee: 10,
    font_size_amount: 10, font_size_words: 9,
    check_bg_image: '', is_default: false,
  })

  const [filterStatus, setFilterStatus] = useState('')
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7))

  // PDC Tracker state
  const [pdcChecks, setPdcChecks] = useState([])
  const [pdcLoading, setPdcLoading] = useState(false)
  const [collapsedMonths, setCollapsedMonths] = useState(new Set())
  const [collapsedInit, setCollapsedInit] = useState(false)
  const [showPdcForm, setShowPdcForm] = useState(false)
  const [editingPdc, setEditingPdc] = useState(null)
  const [pdcFilterStatus, setPdcFilterStatus] = useState('Pending')
  const [pdcGroupMode, setPdcGroupMode] = useState(false)
  const [pdcForm, setPdcForm] = useState({
    payee: '', purpose: '', bank: '', check_no: '', check_date: '',
    amount: '', status: 'Pending', group_label: '', notes: ''
  })
  const [pdcSeriesCount, setPdcSeriesCount] = useState(3)
  const [pdcSeriesStartDate, setPdcSeriesStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [pdcSeriesStartNo, setPdcSeriesStartNo] = useState('')
  const [pdcSeriesAmount, setPdcSeriesAmount] = useState('')
  const [confirmModal, setConfirmModal] = useState(null)
  const [search, setSearch] = useState('')
  const [previewVoucher, setPreviewVoucher] = useState(null)
  const [checkPreview, setCheckPreview] = useState(null)
  const [pdfOrientation, setPdfOrientation] = useState('portrait')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [v, t, s] = await Promise.all([
      supabase.from('check_vouchers').select('*').order('created_at', { ascending: false }),
      supabase.from('bank_templates').select('*').order('bank_name'),
      supabase.from('company_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    if (v.data) setVouchers(v.data)
    if (t.data) setTemplates(t.data)
    if (s.data) setSettings(s.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const fetchPdc = useCallback(async () => {
    setPdcLoading(true)
    const [pdcRes, voucherRes] = await Promise.all([
      supabase.from('pdc_checks').select('*').order('check_date'),
      supabase.from('check_vouchers').select('id,voucher_no,payee,bank_template_id,check_no,check_date,amount,status,check_rows,mode').order('voucher_date'),
    ])

    // Standalone PDC entries
    const standalone = (pdcRes.data || []).map(c => ({ ...c, _source: 'pdc' }))

    // Voucher-sourced checks — expand check_rows for multiple mode
    const voucherChecks = []
    for (const v of (voucherRes.data || [])) {
      if (v.mode === 'multiple' && Array.isArray(v.check_rows)) {
        v.check_rows.forEach((row, idx) => {
          if (row.check_date) {
            voucherChecks.push({
              id: v.id + '_' + idx,
              _source: 'voucher',
              _voucher_id: v.id,
              _row_idx: idx,
              payee: v.payee,
              bank: null,
              check_no: row.check_no || '—',
              check_date: row.check_date,
              amount: parseFloat(row.amount) || 0,
              purpose: row.description || ('Voucher #' + v.voucher_no),
              group_label: 'Voucher #' + v.voucher_no,
              status: row.pdc_status || (v.status === 'Released' ? 'Cleared' : 'Pending'),
              notes: null,
            })
          }
        })
      } else if (v.mode === 'single' && v.check_date) {
        voucherChecks.push({
          id: v.id + '_single',
          _source: 'voucher',
          _voucher_id: v.id,
          _row_idx: null,
          payee: v.payee,
          bank: null,
          check_no: v.check_no || '—',
          check_date: v.check_date,
          amount: parseFloat(v.amount) || 0,
          purpose: 'Voucher #' + v.voucher_no,
          group_label: 'Voucher #' + v.voucher_no,
          status: v.status === 'Released' ? 'Cleared' : 'Pending',
          notes: null,
        })
      }
    }

    // Merge and sort by check_date
    const all = [...standalone, ...voucherChecks].sort((a, b) =>
      a.check_date < b.check_date ? -1 : a.check_date > b.check_date ? 1 : 0
    )
    setPdcChecks(all)
    setPdcLoading(false)
  }, [])

  useEffect(() => { if (tab === 'PDC Tracker') fetchPdc() }, [tab, fetchPdc])

  const handleSavePdc = async () => {
    if (!pdcForm.payee || !pdcForm.check_no || !pdcForm.check_date || !pdcForm.amount) {
      showToast('Payee, check no., date, and amount are required.', 'error'); return
    }
    setSaving(true)
    const payload = {
      payee: pdcForm.payee.trim(),
      purpose: pdcForm.purpose,
      bank: pdcForm.bank,
      check_no: pdcForm.check_no.trim(),
      check_date: pdcForm.check_date,
      amount: parseFloat(pdcForm.amount) || 0,
      status: pdcForm.status,
      group_label: pdcForm.group_label || null,
      notes: pdcForm.notes || null,
    }
    const { error } = editingPdc
      ? await supabase.from('pdc_checks').update(payload).eq('id', editingPdc.id)
      : await supabase.from('pdc_checks').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      showToast(editingPdc ? 'Updated.' : 'PDC check added.')
      setShowPdcForm(false); setEditingPdc(null)
      setPdcForm({ payee: '', purpose: '', bank: '', check_no: '', check_date: '', amount: '', status: 'Pending', group_label: '', notes: '' })
      fetchPdc()
    }
    setSaving(false)
  }

  const handleSavePdcSeries = async () => {
    if (!pdcForm.payee || !pdcSeriesStartNo || !pdcSeriesStartDate || !pdcSeriesAmount) {
      showToast('Fill in all series fields.', 'error'); return
    }
    setSaving(true)
    const groupId = crypto.randomUUID()
    const rows = Array.from({ length: pdcSeriesCount }, (_, i) => {
      const d = new Date(pdcSeriesStartDate + 'T00:00:00')
      d.setMonth(d.getMonth() + i)
      const checkNoBase = pdcSeriesStartNo.replace(/\d+$/, '')
      const checkNoNum = parseInt(pdcSeriesStartNo.match(/\d+$/)?.[0] || '0') + i
      return {
        payee: pdcForm.payee.trim(),
        purpose: pdcForm.purpose,
        bank: pdcForm.bank,
        check_no: checkNoBase + String(checkNoNum).padStart(6, '0'),
        check_date: d.toISOString().slice(0, 10),
        amount: parseFloat(pdcSeriesAmount) || 0,
        status: 'Pending',
        group_id: groupId,
        group_label: pdcForm.group_label || pdcForm.payee,
        notes: pdcForm.notes || null,
      }
    })
    const { error } = await supabase.from('pdc_checks').insert(rows)
    if (error) showToast('Error: ' + error.message, 'error')
    else {
      showToast(`${pdcSeriesCount} PDC checks added.`)
      setShowPdcForm(false)
      setPdcForm({ payee: '', purpose: '', bank: '', check_no: '', check_date: '', amount: '', status: 'Pending', group_label: '', notes: '' })
      fetchPdc()
    }
    setSaving(false)
  }

  const handleUpdatePdcStatus = async (c, newStatus) => {
    if (c._source === 'voucher') {
      // Update pdc_status inside check_rows JSON for multiple mode
      if (c._row_idx !== null) {
        const { data: vData } = await supabase.from('check_vouchers').select('check_rows').eq('id', c._voucher_id).maybeSingle()
        if (vData?.check_rows) {
          const rows = [...vData.check_rows]
          rows[c._row_idx] = { ...rows[c._row_idx], pdc_status: newStatus }
          await supabase.from('check_vouchers').update({ check_rows: rows }).eq('id', c._voucher_id)
        }
      } else {
        // Single mode — update voucher status
        const vStatus = newStatus === 'Cleared' ? 'Released' : newStatus === 'Cancelled' ? 'Cancelled' : 'Pending'
        await supabase.from('check_vouchers').update({ status: vStatus }).eq('id', c._voucher_id)
      }
    } else {
      await supabase.from('pdc_checks').update({ status: newStatus }).eq('id', c.id)
    }
    fetchPdc()
  }

  const handleDeletePdc = async (c) => {
    if (c._source === 'voucher') {
      showToast('Voucher-linked checks cannot be deleted here. Delete the voucher instead.', 'error')
      return
    }
    await supabase.rpc('permanent_delete', { p_table: 'pdc_checks', p_id: c.id })
    fetchPdc()
  }

  const resetForm = () => {
    setMode('single'); setVoucherNo(''); setVoucherDate(new Date().toISOString().slice(0, 10))
    setPayee(''); setBankTemplateId(''); setStatus('Pending')
    setApprovedBy(settings.soa_noted_by_name || ''); setRemarks('')
    setCheckNo(''); setCheckDate(new Date().toISOString().slice(0, 10))
    setDescription(''); setAmount('')
    setCheckRows([{ ...EMPTY_CHECK_ROW }])
    setEditingVoucher(null)
  }

  const openNew = () => {
    resetForm()
    setVoucherNo(genCVNo(vouchers))
    const defTemplate = templates.find(t => t.is_default)
    if (defTemplate) setBankTemplateId(defTemplate.id)
    setApprovedBy(settings.soa_noted_by_name || '')
    setShowForm(true)
  }

  const openEdit = (v) => {
    setEditingVoucher(v)
    setMode(v.mode || 'single')
    setVoucherNo(v.voucher_no); setVoucherDate(v.voucher_date)
    setPayee(v.payee); setBankTemplateId(v.bank_template_id || '')
    setStatus(v.status); setApprovedBy(v.approved_by || ''); setRemarks(v.remarks || '')
    setCheckNo(v.check_no || ''); setCheckDate(v.check_date || '')
    setDescription(v.description || ''); setAmount(v.amount || '')
    setCheckRows(v.check_rows || [{ ...EMPTY_CHECK_ROW }])
    setShowForm(true)
  }

  // Recurring payees — distinct names from past vouchers, most-used first
  const recurringPayees = (() => {
    const counts = {}
    vouchers.forEach(v => { if (v.payee) counts[v.payee] = (counts[v.payee] || 0) + 1 })
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  })()

  // Total amount
  const totalAmount = mode === 'single'
    ? parseFloat(amount) || 0
    : checkRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)

  const handleSave = async () => {
    if (!payee || !voucher_date) { showToast('Payee and date required.', 'error'); return }
    if (totalAmount <= 0) { showToast('Amount must be greater than zero.', 'error'); return }
    setSaving(true)

    const payload = {
      voucher_no, voucher_date, payee, bank_template_id: bank_template_id || null,
      status, approved_by, remarks, mode,
      amount: Math.abs(totalAmount),
      // Single check fields
      check_no: mode === 'single' ? check_no : null,
      check_date: mode === 'single' ? check_date : null,
      description: mode === 'single' ? description : null,
      // Multiple checks stored as JSON
      check_rows: mode === 'multiple' ? checkRows : null,
      created_by: profile?.id,
    }

    let error
    if (editingVoucher) {
      ({ error } = await supabase.from('check_vouchers').update(payload).eq('id', editingVoucher.id))
    } else {
      ({ error } = await supabase.from('check_vouchers').insert(payload))
    }

    if (error) showToast('Error: ' + error.message, 'error')
    else {
      logAudit(editingVoucher?'destructive':'generate', editingVoucher?'Updated':'Created', 'CheckVouchers', `${editingVoucher?'Updated':'Created'} voucher: ${payee} ₱${totalAmount}`, editingVoucher?.id||'', profile?.id, profile?.full_name)
      showToast(editingVoucher ? 'Voucher updated.' : 'Voucher created.')
      setShowForm(false); resetForm(); fetchAll()
    }
    setSaving(false)
  }

  const handleDelete = async (id, voucher_no) => {
    setConfirmModal({ title: 'Delete Voucher', variant: 'danger', confirmLabel: 'Delete', message: `Delete voucher ${voucher_no}? This cannot be undone.`, onConfirm: async () => {
      await supabase.rpc('permanent_delete', { p_table: 'check_vouchers', p_id: id })
      logAudit('destructive', 'Deleted', 'CheckVouchers', 'Deleted check voucher', '', profile?.id, profile?.full_name)
      showToast('Deleted.', 'info'); fetchAll()
    }})
  }

  const handleQuickStatusChange = async (v, newStatus) => {
    if (newStatus === v.status) return
    const applyChange = async () => {
      const { error } = await supabase.from('check_vouchers').update({ status: newStatus }).eq('id', v.id)
      if (error) { showToast('Error: ' + error.message, 'error'); return }
      logAudit('destructive', 'Updated', 'CheckVouchers', `Changed voucher ${v.voucher_no} status: ${v.status} → ${newStatus}`, v.id, profile?.id, profile?.full_name)
      showToast(`Status updated to ${newStatus}.`)
      fetchAll()
    }
    if (newStatus === 'Released') {
      setConfirmModal({ title: 'Confirm Release', variant: 'warning', confirmLabel: 'Mark as Released', message: `Mark voucher ${v.voucher_no} as Released? This means checks have been issued.`, onConfirm: applyChange })
    } else {
      await applyChange()
    }
  }

  // ── PRINT VOUCHER PDF — matches the established print format ───────────────
  const handlePrintVoucher = (v) => { setSigPrintVoucher(v); setSigDialog(true) }
  const doPrint = async (sigs) => {
    setSigDialog(false)
    const v = sigPrintVoucher
    if (!v) return
    await doPrintVoucherInternal(v, sigs)
  }
  const doPrintVoucherInternal = async (v, sigs = []) => {
    const doc = new jsPDF({ orientation: pdfOrientation || 'portrait', unit: 'mm', format: 'letter' })
    doc.setFont('helvetica', 'normal') // consistent font throughout
    const W = (pdfOrientation === 'landscape') ? 279.4 : 215.9
    const co = settings.company_name || '[Company Name Not Set]'
    const isMultiple = v.mode === 'multiple'
    const rows = isMultiple ? (v.check_rows || []) : []
    const total = Math.abs(isMultiple
      ? rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
      : parseFloat(v.amount) || 0)

    // ── HEADER — full width, natural proportions ────────────────────────────────
    let headerH = 32
    try {
      const headerImg = await new Promise((resolve, reject) => {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = '/header-logo.png'
      })
      const ratio = headerImg.naturalHeight / headerImg.naturalWidth
      const imgH = W * ratio  // natural height at full width
      doc.addImage(headerImg, 'PNG', 0, 0, W, imgH, undefined, 'FAST')
      headerH = imgH + 4
    } catch (e) {
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(241, 114, 0)
      doc.text('DRAGON SPEED TRUCKING CORPORATION', W / 2, 14, { align: 'center' })
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
      if (settings.address) doc.text(settings.address, W / 2, 20, { align: 'center' })
      headerH = 26
    }

    // Thin divider line
    doc.setDrawColor(180); doc.setLineWidth(0.3)
    doc.line(14, headerH, W - 14, headerH)

    // "Check Voucher" title
    const titleY = headerH + 9
    doc.setFontSize(20); doc.setFont(undefined, 'normal'); doc.setTextColor(0)
    doc.text('Check Voucher', W / 2, titleY, { align: 'center' })

    // CV number — top right
    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(130)
    doc.text(v.voucher_no, W - 14, titleY, { align: 'right' })

    // Calculate starting Y for content
    const contentStartY = titleY + 8

    // ── HEADER FIELDS ─────────────────────────────────────────────────────────
    doc.setFontSize(9); doc.setTextColor(0)
    let headerY = contentStartY

    if (!isMultiple) {
      // Single: Check Number, Date, Check Date
      doc.setFont(undefined, 'bold'); doc.text('Check Number: ', 14, headerY)
      doc.setFont(undefined, 'normal')
      const cnW = doc.getTextWidth('Check Number: ')
      doc.setTextColor(0, 0, 200); doc.setFont(undefined, 'bold')
      doc.text(v.check_no || '', 14 + cnW, headerY)
      doc.setTextColor(0); doc.setFont(undefined, 'normal'); headerY += 6
      doc.text(`Date: ${fmtDate(v.voucher_date)}`, 14, headerY); headerY += 6
      doc.text(`Check Date: ${fmtDate(v.check_date)}`, 14, headerY); headerY += 8
    } else {
      // Multiple: just Date
      doc.text(`Date: ${fmtDate(v.voucher_date)}`, 14, headerY); headerY += 8
    }

    // Pay To
    doc.setFontSize(10); doc.setFont(undefined, 'bold')
    doc.text('Pay To: ', 14, headerY)
    const ptW = doc.getTextWidth('Pay To: ')
    doc.text((v.payee || '').toUpperCase(), 14 + ptW, headerY)
    // Underline payee
    const payeeW = doc.getTextWidth((v.payee || '').toUpperCase())
    doc.setDrawColor(0); doc.line(14 + ptW, headerY + 1, 14 + ptW + payeeW, headerY + 1)
    doc.setFont(undefined, 'normal'); headerY += 8

    // ── TABLE ─────────────────────────────────────────────────────────────────
    if (!isMultiple) {
      // Single check — 2 columns: Description | Amount
      autoTable(doc, {
        startY: headerY,
        head: [['Description', 'Amount']],
        body: [
          [v.description || '', { content: pdfAmt(v.amount), styles: { halign: 'right' } }],
          [{ content: '~~Nothing Follows~~', colSpan: 2, styles: { halign: 'center', textColor: [150, 150, 150], fontSize: 8 } }],
        ],
        headStyles: { fillColor: [50, 50, 50], fontSize: 9, fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { cellWidth: 126 },
          1: { cellWidth: 55, halign: 'right', font: 'helvetica' },
        },
        bodyStyles: { fontSize: 9, font: 'helvetica' },
        margin: { left: 14, right: 14 },
        tableWidth: 183,
        didParseCell: (data) => {
          // Prevent autotable from treating amount strings as numbers
          if (typeof data.cell.raw === 'string') data.cell.text = [data.cell.raw]
        },
      })
    } else {
      // Multiple checks — 4 columns: Check Date | Check No. | Description | Amount
      const tableRows = rows.map(r => [
        fmtDate(r.check_date),
        r.check_no || '',
        r.description || '',
        { content: pdfAmt(r.amount || 0), styles: { halign: 'right' } },
      ])
      tableRows.push([
        { content: '', styles: {} },
        { content: '', styles: {} },
        { content: 'TOTAL', styles: { halign: 'right', fontStyle: 'bold' } },
        { content: pdfAmt(total), styles: { halign: 'right', fontStyle: 'bold' } },
      ])
      tableRows.push([
        { content: '', styles: {} },
        { content: '~~Nothing Follows~~', colSpan: 3, styles: { halign: 'center', textColor: [150, 150, 150], fontSize: 8 } },
      ])

      autoTable(doc, {
        startY: headerY,
        head: [['Check Date', 'Check No.', 'Description', 'Amount']],
        body: tableRows,
        headStyles: { fillColor: [50, 50, 50], fontSize: 9, fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { cellWidth: 30, halign: 'center' },
          1: { cellWidth: 28, halign: 'center' },
          2: { cellWidth: 70 },
          3: { cellWidth: 55, halign: 'right', font: 'helvetica' },
        },
        bodyStyles: { fontSize: 9, font: 'helvetica' },
        margin: { left: 14, right: 14 },
        tableWidth: 183,
        didParseCell: (data) => {
          if (typeof data.cell.raw === 'string') data.cell.text = [data.cell.raw]
        },
      })
    }

    // ── SUM OF ────────────────────────────────────────────────────────────────
    const afterTable = doc.lastAutoTable.finalY + 6
    doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(0)
    doc.text('The sum of ', 14, afterTable)
    const sumLabelW = doc.getTextWidth('The sum of ')
    doc.setFont(undefined, 'bold')
    const sumStr = `P ${fmtAmt(total)}`
    doc.text(sumStr, 14 + sumLabelW, afterTable)
    // Underline the amount
    const sumW = doc.getTextWidth(sumStr)
    doc.line(14 + sumLabelW, afterTable + 0.5, 14 + sumLabelW + sumW, afterTable + 0.5)

    // ── SIGNATORIES ───────────────────────────────────────────────────────────
    const sigY = Math.min(Math.max(afterTable + 30, 220), 248)
    // Left — Payment Received By (blank line)
    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(0)
    doc.setDrawColor(0); doc.line(14, sigY, 90, sigY)
    doc.text('Payment Received BY', 14, sigY + 5)

    // Right — Payment Approved By (with name)
    const approver = (v.approved_by || '').toUpperCase()
    doc.setFont(undefined, 'bold')
    doc.text(approver, W - 14, sigY - 3, { align: 'right' })
    // Underline name
    if (approver) {
      const approverW = doc.getTextWidth(approver)
      doc.line(W - 14 - approverW, sigY - 2, W - 14, sigY - 2)
    }
    doc.setFont(undefined, 'normal')
    doc.line(W - 100, sigY, W - 14, sigY)
    doc.text('Payment Approved By', W - 14, sigY + 5, { align: 'right' })

    // ── ORANGE FOOTER — fixed at page bottom ─────────────────────────────────
    const pageH = doc.internal.pageSize.getHeight()
    const footY = pageH - 14
    doc.setFillColor(241, 114, 0)
    doc.rect(0, footY, W + 10, 20, 'F')
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
    doc.text('YOUR BUSINESS. OUR PASSION.', W / 2, footY + 9, { align: 'center' })

    // Cancelled watermark
    if (v.status === 'Cancelled') {
      doc.setTextColor(220, 50, 50, 0.3); doc.setFontSize(48); doc.setFont(undefined, 'bold')
      doc.text('CANCELLED', W / 2, 160, { align: 'center', angle: 35 })
    }

    
    if (sigs && sigs.length > 0) {
      const sigY = 145
      sigs.forEach((s, i) => {
        const x = i === 0 ? 30 : i === sigs.length-1 ? 185 : 110
        const align = i === 0 ? 'left' : i === sigs.length-1 ? 'right' : 'center'
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(120)
        doc.text(s.label + ':', x, sigY, { align })
        doc.setDrawColor(100)
        if (align==='left') doc.line(x, sigY+18, x+70, sigY+18)
        else if (align==='right') doc.line(x-70, sigY+18, x, sigY+18)
        else doc.line(x-35, sigY+18, x+35, sigY+18)
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(0)
        doc.text(s.name.toUpperCase(), x, sigY+23, { align })
        doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(241,114,0)
        doc.text(s.title||'', x, sigY+27, { align })
        doc.setTextColor(0)
      })
    }
    doc.save(`${v.voucher_no}-${v.payee}.pdf`)
    showToast('Voucher PDF saved.')
  }

  // ── CHECK OVERLAY PDF ─────────────────────────────────────────────────────
  const handlePrintCheck = (v) => { setSigPrintVoucher(v); setSigDialog(true) }

  const filtered = vouchers.filter(v => {
    if (filterStatus && v.status !== filterStatus) return false
    if (search && !v.payee?.toLowerCase().includes(search.toLowerCase()) &&
        !v.voucher_no?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Check Vouchers</h1><p className="page-sub">Single and post-dated check vouchers</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Orientation toggle */}
        {tab === 'Vouchers' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: 'var(--muted)' }}>
            <span>PDF Orientation:</span>
            {['portrait', 'landscape'].map(o => (
              <button key={o} onClick={() => setPdfOrientation(o)} style={{
                padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                background: pdfOrientation === o ? 'var(--accent)' : 'var(--surface)',
                color: pdfOrientation === o ? '#fff' : 'var(--muted)',
                border: `1px solid ${pdfOrientation === o ? 'var(--accent)' : 'var(--border)'}`,
              }}>{o.charAt(0).toUpperCase() + o.slice(1)}</button>
            ))}
          </div>
        )}
        {tab === 'Vouchers' && (
            <button className="btn-primary" onClick={() => { if (showForm) { setShowForm(false); resetForm() } else openNew() }}>
              {showForm ? '✕ Cancel' : '+ New Voucher'}
            </button>
          )}
          {tab === 'Bank Templates' && isAdmin && (
            <button className="btn-primary" onClick={() => setShowTemplateForm(!showTemplateForm)}>
              {showTemplateForm ? '✕ Cancel' : '+ New Template'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '0.5px solid var(--border)' }}>
        {(isAdmin ? TABS : ['Vouchers']).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: tab === t ? 500 : 400,
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      {/* ── VOUCHERS TAB ── */}
      {tab === 'Vouchers' && (
        <>
          {showForm && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>
                {editingVoucher ? `Edit — ${voucher_no}` : 'New Check Voucher'}
              </h2>

              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {[{ val: 'single', label: '🗒️ Single Check' }, { val: 'multiple', label: '📋 Multiple Checks (PDC)' }].map(opt => (
                  <button key={opt.val} onClick={() => setMode(opt.val)} style={{
                    padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
                    background: mode === opt.val ? 'var(--accent)' : 'var(--surface)',
                    color: mode === opt.val ? '#fff' : 'var(--muted)',
                    border: `1.5px solid ${mode === opt.val ? 'var(--accent)' : 'var(--border)'}`,
                  }}>{opt.label}</button>
                ))}
              </div>

              <div className="form-grid" style={{ marginBottom: 16 }}>
                <div className="form-group">
                  <label className="label required">Voucher No.</label>
                  <input value={voucher_no} onChange={e => setVoucherNo(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="label required">Date</label>
                  <DateInput value={voucher_date} onChange={e => setVoucherDate(e.target.value)} />
                </div>
                <div className="form-group span-2">
                  <label className="label required">Pay To</label>
                  <input autoFocus value={payee} onChange={e => setPayee(e.target.value)} placeholder="Payee name" list="payee-suggestions" />
                  <datalist id="payee-suggestions">
                    {recurringPayees.map(p => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <div className="form-group">
                  <label className="label">Bank Template</label>
                  <select value={bank_template_id} onChange={e => setBankTemplateId(e.target.value)}>
                    <option value="">Select bank (for check print)</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.bank_name} — {t.account_number}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Status</label>
                  <select value={status} onChange={e => {
                    const newVal = e.target.value
                    if (newVal === 'Released' && status !== 'Released') {
                      setConfirmModal({
                        title: 'Confirm Release',
                        variant: 'warning',
                        confirmLabel: 'Mark as Released',
                        message: 'Mark this voucher as Released? This means checks have been issued.',
                        onConfirm: () => setStatus(newVal),
                      })
                      return
                    }
                    setStatus(newVal)
                  }}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group span-2">
                  <label className="label">Payment Approved By</label>
                  <select value={approved_by} onChange={e => setApprovedBy(e.target.value)}>
                    <option value="">Select approver</option>
                    {settings.noted_by_name && <option value={settings.noted_by_name}>{settings.noted_by_name} — {settings.noted_by_title || 'President'}</option>}
                    {settings.prepared_by_name && <option value={settings.prepared_by_name}>{settings.prepared_by_name} — {settings.prepared_by_title || 'VP-Finance'}</option>}
                    {settings.soa_noted_by_name && settings.soa_noted_by_name !== settings.noted_by_name && <option value={settings.soa_noted_by_name}>{settings.soa_noted_by_name}</option>}
                  </select>
                </div>
              </div>

              {/* Single check fields */}
              {mode === 'single' && (
                <div className="form-grid" style={{ marginBottom: 16 }}>
                  <div className="form-group">
                    <label className="label">Check Number</label>
                    <input value={check_no} onChange={e => setCheckNo(e.target.value)} placeholder="e.g. 0000211650" />
                  </div>
                  <div className="form-group">
                    <label className="label">Check Date</label>
                    <DateInput value={check_date} onChange={e => setCheckDate(e.target.value)} />
                  </div>
                  <div className="form-group span-2">
                    <label className="label">Description</label>
                    <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. POF-000012" />
                  </div>
                  <div className="form-group">
                    <label className="label required">Amount (₱)</label>
                    <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                    {amount > 0 && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3, fontStyle: 'italic' }}>{numberToWords(amount)}</div>}
                  </div>
                </div>
              )}

              {/* Multiple checks rows */}
              {mode === 'multiple' && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <p style={{ fontSize: 13, fontWeight: 500 }}>Check Details</p>
                    <button className="btn-ghost btn-sm" onClick={() => setCheckRows(r => [...r, { ...EMPTY_CHECK_ROW }])}>+ Add Row</button>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr>
                        <th>Check Date</th><th>Check No.</th><th>Description</th><th className="text-right">Amount (₱)</th><th></th>
                      </tr></thead>
                      <tbody>
                        {checkRows.map((row, i) => (
                          <tr key={i}>
                            <td><DateInput value={row.check_date} onChange={e => setCheckRows(rows => rows.map((r,j) => j===i ? {...r, check_date: e.target.value} : r))} style={{ padding: '4px 8px', fontSize: 12 }} /></td>
                            <td><input value={row.check_no} onChange={e => setCheckRows(rows => rows.map((r,j) => j===i ? {...r, check_no: e.target.value} : r))} placeholder="Check no." style={{ padding: '4px 8px', fontSize: 12 }} /></td>
                            <td><input value={row.description} onChange={e => setCheckRows(rows => rows.map((r,j) => j===i ? {...r, description: e.target.value} : r))} placeholder="Description" style={{ padding: '4px 8px', fontSize: 12 }} /></td>
                            <td><input type="number" step="0.01" value={row.amount} onChange={e => setCheckRows(rows => rows.map((r,j) => j===i ? {...r, amount: e.target.value} : r))} placeholder="0.00" style={{ padding: '4px 8px', fontSize: 12, textAlign: 'right' }} /></td>
                            <td><button onClick={() => setCheckRows(rows => rows.filter((_,j) => j!==i))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>×</button></td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--bg)' }}>
                          <td colSpan={3} style={{ textAlign: 'right', fontWeight: 500, fontSize: 13 }}>TOTAL</td>
                          <td className="text-right mono" style={{ fontWeight: 500, fontSize: 13 }}>₱{fmt(totalAmount)}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {totalAmount > 0 && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 6, fontStyle: 'italic' }}>{numberToWords(totalAmount)}</div>}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="label">Remarks</label>
                <input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional remarks" />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn-ghost" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Voucher'}</button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="filter-bar" style={{ marginBottom: 12 }}>
            <input placeholder="Search payee or voucher no…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 2 }} />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All status</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {(search || filterStatus) && <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterStatus('') }}>Clear</button>}
          </div>

          {/* Stats */}
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            {STATUS_OPTIONS.map(s => (
              <div key={s} className="stat-card">
                <div className="stat-label">{s}</div>
                <div className="stat-value sm" style={{ color: STATUS_COLORS[s]?.color }}>{vouchers.filter(v => v.status === s).length}</div>
              </div>
            ))}
            <div className="stat-card">
              <div className="stat-label">Total Released</div>
              <div className="stat-value sm" style={{ color: 'var(--success)' }}>₱{fmt(vouchers.filter(v => v.status === 'Released').reduce((s, v) => s + (v.amount || 0), 0))}</div>
            </div>
          </div>

          {loading ? <div className="empty-state"><p>Loading…</p></div> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>Voucher No.</th><th>Date</th><th>Pay To</th>
                  <th>Type</th><th className="text-right">Amount (₱)</th>
                  <th>Status</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.length === 0
                    ? <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No vouchers found.</td></tr>
                    : filtered.map(v => (
                      <tr key={v.id}>
                        <td className="mono" style={{ fontWeight: 500 }}>{v.voucher_no}</td>
                        <td style={{ fontSize: 12 }}>{fmtDate(v.voucher_date)}</td>
                        <td style={{ fontWeight: 500 }}>{v.payee}</td>
                        <td><span className="badge" style={{ fontSize: 10, background: v.mode === 'multiple' ? 'var(--accent-light)' : 'var(--bg)', color: v.mode === 'multiple' ? 'var(--accent)' : 'var(--muted)' }}>
                          {v.mode === 'multiple' ? 'PDC' : 'Single'}
                        </span></td>
                        <td className="text-right mono" style={{ fontWeight: 500 }}>₱{fmt(v.amount)}</td>
                        <td>
                          <select value={v.status} onChange={e => handleQuickStatusChange(v, e.target.value)}
                            className="badge" style={{ fontSize: 10, fontWeight: 600, border: 'none', cursor: 'pointer', ...STATUS_COLORS[v.status] }}>
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn-ghost btn-sm" onClick={() => openEdit(v)}>Edit</button>
                            <button className="btn-ghost btn-sm" onClick={() => handlePrintVoucher(v)}>📄 Voucher</button>
                            {v.bank_template_id && <button className="btn-ghost btn-sm" onClick={() => handlePrintCheck(v)}>🖨️ Check</button>}
                            {isAdmin && <button className="btn-danger btn-sm" onClick={() => handleDelete(v.id, v.voucher_no)}>✕</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── BANK TEMPLATES TAB ── */}
      {tab === 'Bank Templates' && isAdmin && (
        <>
          {(showTemplateForm || editingTemplate) && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>{editingTemplate ? `Edit: ${editingTemplate.bank_name}` : 'New Bank Template'}</h2>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Configure field positions in mm from top-left of check for the print overlay.</p>
              <div className="form-grid" style={{ marginBottom: 16 }}>
                {[
                  { label: 'Bank Name', key: 'bank_name', placeholder: 'e.g. Security Bank Corp' },
                  { label: 'Account Name', key: 'account_name', placeholder: 'Registered name' },
                  { label: 'Account Number', key: 'account_number', placeholder: 'e.g. 1234-5678-90' },
                  { label: 'Branch', key: 'branch', placeholder: 'Branch name' },
                ].map(f => (
                  <div key={f.key} className="form-group">
                    <label className="label">{f.label}</label>
                    <input value={tmplForm[f.key] || ''} onChange={e => setTmplForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                  </div>
                ))}
              </div>
              <p className="section-label">Check Size (mm)</p>
              <div className="form-grid" style={{ marginBottom: 16 }}>
                {[
                  { label: 'Check Width', key: 'check_width_mm', hint: 'e.g. 203.2 (8 inches)' },
                  { label: 'Check Height', key: 'check_height_mm', hint: 'e.g. 76.2 (3 inches)' },
                ].map(f => (
                  <div key={f.key} className="form-group">
                    <label className="label">{f.label}</label>
                    <input type="number" step="0.1" value={tmplForm[f.key] || ''} onChange={e => setTmplForm(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))} placeholder={f.hint} />
                    <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 2 }}>{f.hint}</div>
                  </div>
                ))}
              </div>
              <p className="section-label">Print Field Positions (mm from top-left of check)</p>
              <div style={{ padding: '8px 12px', background: 'var(--accent-light)', borderRadius: 6, fontSize: 12, color: 'var(--accent-dark)', marginBottom: 12 }}>
                💡 X = distance from left edge. Y = distance from top edge. Upload a check scan below to help calibrate.
              </div>
              <div className="form-grid" style={{ marginBottom: 16 }}>
                {[
                  { label: 'Date — X', key: 'date_x' }, { label: 'Date — Y', key: 'date_y' },
                  { label: 'Payee Name — X', key: 'payee_x' }, { label: 'Payee Name — Y', key: 'payee_y' },
                  { label: 'Amount (₱ figures) — X', key: 'amount_figures_x' }, { label: 'Amount (₱ figures) — Y', key: 'amount_figures_y' },
                  { label: 'Amount in Words Line 1 — X', key: 'amount_words_x' }, { label: 'Amount in Words Line 1 — Y', key: 'amount_words_y' },
                  { label: 'Amount in Words Line 2 — X', key: 'amount_words_x2' }, { label: 'Amount in Words Line 2 — Y', key: 'amount_words_y2' },
                ].map(f => (
                  <div key={f.key} className="form-group">
                    <label className="label">{f.label}</label>
                    <input type="number" step="0.5" value={tmplForm[f.key] || ''} onChange={e => setTmplForm(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))} />
                  </div>
                ))}
              </div>
              <p className="section-label">Font Sizes (pt)</p>
              <div className="form-grid" style={{ marginBottom: 16 }}>
                {[
                  { label: 'Date', key: 'font_size_date' }, { label: 'Payee Name', key: 'font_size_payee' },
                  { label: 'Amount Figures', key: 'font_size_amount' }, { label: 'Amount Words', key: 'font_size_words' },
                ].map(f => (
                  <div key={f.key} className="form-group">
                    <label className="label">{f.label}</label>
                    <input type="number" step="0.5" value={tmplForm[f.key] || ''} onChange={e => setTmplForm(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))} />
                  </div>
                ))}
              </div>
              <p className="section-label">Check Background (voided check scan)</p>
              <input type="file" accept="image/*" onChange={e => {
                const file = e.target.files[0]; if (!file) return
                const reader = new FileReader()
                reader.onloadend = () => setTmplForm(p => ({ ...p, check_bg_image: reader.result }))
                reader.readAsDataURL(file)
              }} style={{ marginBottom: 8 }} />
              {tmplForm.check_bg_image && (
                <div style={{ marginBottom: 12 }}>
                  <img src={tmplForm.check_bg_image} alt="Check preview" style={{ maxWidth: '100%', maxHeight: 100, objectFit: 'contain', border: '0.5px solid var(--border)', borderRadius: 6 }} />
                  <button className="btn-ghost btn-sm" style={{ marginTop: 6, display: 'block' }} onClick={() => setTmplForm(p => ({ ...p, check_bg_image: '' }))}>Remove</button>
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 16 }}>
                <input type="checkbox" checked={tmplForm.is_default} onChange={e => setTmplForm(p => ({ ...p, is_default: e.target.checked }))} />
                Set as default bank
              </label>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn-ghost" onClick={() => { setShowTemplateForm(false); setEditingTemplate(null) }}>Cancel</button>
                <button className="btn-primary" onClick={async () => {
                  if (!tmplForm.bank_name) { showToast('Bank name required.', 'error'); return }
                  setSaving(true)
                  const { error } = editingTemplate
                    ? await supabase.from('bank_templates').update(tmplForm).eq('id', editingTemplate.id)
                    : await supabase.from('bank_templates').insert(tmplForm)
                  if (error) showToast('Error: ' + error.message, 'error')
                  else { showToast('Template saved.'); setShowTemplateForm(false); setEditingTemplate(null); fetchAll() }
                  setSaving(false)
                }} disabled={saving}>{saving ? 'Saving…' : 'Save Template'}</button>
              </div>
            </div>
          )}

          {templates.length === 0 && !showTemplateForm
            ? <div className="empty-state"><p>No bank templates yet. Add one to enable check printing.</p></div>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {templates.map(t => (
                  <div key={t.id} className="card" style={{ border: t.is_default ? '1.5px solid var(--accent)' : undefined }}>
                    {t.is_default && <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 500, marginBottom: 6 }}>⭐ Default</div>}
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{t.bank_name}</h3>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.account_name}</div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--mono)', marginBottom: 6 }}>{t.account_number}</div>
                    {t.branch && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{t.branch} Branch</div>}
                    {t.check_bg_image && <img src={t.check_bg_image} alt="Check" style={{ width: '100%', maxHeight: 70, objectFit: 'contain', borderRadius: 4, marginBottom: 8, border: '0.5px solid var(--border)' }} />}
                    <div style={{ fontSize: 11, color: 'var(--hint)', marginBottom: 10 }}>{t.check_width_mm} × {t.check_height_mm} mm</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-ghost btn-sm" onClick={() => { setEditingTemplate(t); setTmplForm(t); setShowTemplateForm(false) }}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={async () => {
                        setConfirmModal({ title: 'Delete Template', variant: 'danger', confirmLabel: 'Delete', message: `Delete template "${t.bank_name}"? This cannot be undone.`, onConfirm: async () => {
                          await supabase.rpc('permanent_delete', { p_table: 'bank_templates', p_id: t.id })
                          showToast('Deleted.', 'info'); fetchAll()
                        }})
                      }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </>
      )}
      {/* Check Overlay Preview Modal */}
      {checkPreview && (() => {
        const template = templates.find(t => t.id === checkPreview.bank_template_id)
        const total = Math.abs(checkPreview.mode === 'multiple'
          ? (checkPreview.check_rows || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
          : parseFloat(checkPreview.amount) || 0)
        const d = checkPreview.check_date ? new Date(checkPreview.check_date + 'T00:00:00') : new Date()
        const dateStr = `${String(d.getMonth()+1).padStart(2,'0')}  ${String(d.getDate()).padStart(2,'0')}  ${d.getFullYear()}`
        const W = template?.check_width_mm || 203.2
        const H = template?.check_height_mm || 76.2
        const scale = 3 // px per mm for preview
        return (
          <div className="modal-overlay" onClick={() => setCheckPreview(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, width: '95vw' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Check Preview — {checkPreview.voucher_no}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary btn-sm" onClick={() => { handlePrintCheck(checkPreview); setCheckPreview(null) }}>🖨️ Print Check</button>
                  <button className="btn-ghost btn-sm" onClick={() => setCheckPreview(null)}>✕ Close</button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                This is an approximate preview. Actual print positions depend on your bank template measurements.
              </p>
              {/* Check preview canvas */}
              <div style={{ position: 'relative', width: W * scale, height: H * scale, maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: '#f0f4f8', margin: '0 auto' }}>
                {template?.check_bg_image && (
                  <img src={template.check_bg_image} alt="Check" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'fill' }} />
                )}
                {/* Date */}
                <div style={{ position: 'absolute', left: (template?.date_x || 145) * scale, top: (template?.date_y || 18) * scale - 10, fontSize: (template?.font_size_date || 9) * scale / 3, fontFamily: 'monospace', whiteSpace: 'nowrap', color: '#000' }}>
                  {dateStr}
                </div>
                {/* Payee */}
                <div style={{ position: 'absolute', left: (template?.payee_x || 28) * scale, top: (template?.payee_y || 35) * scale - 10, fontSize: (template?.font_size_payee || 9) * scale / 3, fontFamily: 'Arial', fontWeight: 'bold', whiteSpace: 'nowrap', color: '#000' }}>
                  {(checkPreview.payee || '').toUpperCase()}
                </div>
                {/* Amount figures */}
                <div style={{ position: 'absolute', left: (template?.amount_figures_x || 155) * scale, top: (template?.amount_figures_y || 35) * scale - 10, fontSize: (template?.font_size_amount || 9) * scale / 3, fontFamily: 'monospace', whiteSpace: 'nowrap', color: '#000' }}>
                  ₱ {fmtAmt(total)}
                </div>
                {/* Amount in words */}
                <div style={{ position: 'absolute', left: (template?.amount_words_x || 12) * scale, top: (template?.amount_words_y || 48) * scale - 10, fontSize: (template?.font_size_words || 8) * scale / 3, fontFamily: 'Arial', whiteSpace: 'nowrap', color: '#1a6bbd', maxWidth: (W - (template?.amount_words_x || 12) - 10) * scale }}>
                  {numberToWords(total).toUpperCase()}
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--hint)', marginTop: 8, textAlign: 'center' }}>
                {template ? `Template: ${template.bank_name} — ${template.check_width_mm}×${template.check_height_mm}mm` : 'No template selected'}
              </p>
            </div>
          </div>
        )
      })()}

      {/* Preview Modal */}
      {previewVoucher && (
        <div className="modal-overlay" onClick={() => setPreviewVoucher(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, width: '95vw', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Preview — {previewVoucher.voucher_no}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary btn-sm" onClick={() => { handlePrintVoucher(previewVoucher); setPreviewVoucher(null) }}>📄 Save PDF</button>
                <button className="btn-ghost btn-sm" onClick={() => setPreviewVoucher(null)}>✕ Close</button>
              </div>
            </div>
            {/* Preview content */}
            <div style={{ background: '#fff', padding: 24, borderRadius: 8, border: '1px solid var(--border)', color: '#000', fontFamily: 'Arial, sans-serif' }}>
              {/* Header image */}
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <img src="/header-logo.png" alt="Company header" style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain' }}
                  onError={e => { e.target.style.display='none' }} />
              </div>
              <hr style={{ borderColor: '#ccc', margin: '8px 0 12px' }} />
              <div style={{ textAlign: 'center', fontSize: 22, marginBottom: 4 }}>Check Voucher</div>
              <div style={{ textAlign: 'right', fontSize: 11, color: '#888', marginBottom: 12 }}>{previewVoucher.voucher_no}</div>

              {previewVoucher.mode !== 'multiple' && <>
                <div style={{ fontSize: 13, marginBottom: 4 }}><b>Check Number:</b> <span style={{ color: '#00c', textDecoration: 'underline' }}>{previewVoucher.check_no}</span></div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>Date: {fmtDate(previewVoucher.voucher_date)}</div>
                <div style={{ fontSize: 13, marginBottom: 12 }}>Check Date: {fmtDate(previewVoucher.check_date)}</div>
              </>}
              {previewVoucher.mode === 'multiple' && (
                <div style={{ fontSize: 13, marginBottom: 12 }}>Date: {fmtDate(previewVoucher.voucher_date)}</div>
              )}

              <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 16 }}>
                Pay To: <span style={{ textDecoration: 'underline' }}>{(previewVoucher.payee || '').toUpperCase()}</span>
              </div>

              {/* Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                <thead>
                  <tr style={{ background: '#333', color: '#fff' }}>
                    {previewVoucher.mode === 'multiple'
                      ? <><th style={{ padding: '6px 8px', textAlign: 'left' }}>Check Date</th><th style={{ padding: '6px 8px', textAlign: 'left' }}>Check No.</th><th style={{ padding: '6px 8px', textAlign: 'left' }}>Description</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th></>
                      : <><th style={{ padding: '6px 8px', textAlign: 'left' }}>Description</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th></>
                    }
                  </tr>
                </thead>
                <tbody>
                  {previewVoucher.mode === 'multiple'
                    ? (previewVoucher.check_rows || []).map((r, i) => (
                      <tr key={i} style={{ background: i%2===0?'#fff':'#f5f5f5' }}>
                        <td style={{ padding: '5px 8px', border: '0.5px solid #ddd', fontSize: 12 }}>{fmtDate(r.check_date)}</td>
                        <td style={{ padding: '5px 8px', border: '0.5px solid #ddd', fontSize: 12 }}>{r.check_no}</td>
                        <td style={{ padding: '5px 8px', border: '0.5px solid #ddd', fontSize: 12 }}>{r.description}</td>
                        <td style={{ padding: '5px 8px', border: '0.5px solid #ddd', fontSize: 12, textAlign: 'right' }}>₱ {fmtAmt(r.amount||0)}</td>
                      </tr>
                    ))
                    : <tr>
                        <td style={{ padding: '5px 8px', border: '0.5px solid #ddd', fontSize: 12 }}>{previewVoucher.description}</td>
                        <td style={{ padding: '5px 8px', border: '0.5px solid #ddd', fontSize: 12, textAlign: 'right' }}>₱ {fmtAmt(previewVoucher.amount||0)}</td>
                      </tr>
                  }
                  <tr><td colSpan={previewVoucher.mode==='multiple'?4:2} style={{ padding: '5px 8px', textAlign: 'center', color: '#aaa', fontSize: 11, border: '0.5px solid #ddd' }}>~~Nothing Follows~~</td></tr>
                </tbody>
              </table>

              {/* Total */}
              {previewVoucher.mode === 'multiple' && (
                <div style={{ textAlign: 'right', fontWeight: 'bold', marginBottom: 4, fontSize: 13 }}>
                  TOTAL: ₱ {(previewVoucher.check_rows||[]).reduce((s,r)=>s+(Number(r.amount)||0),0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
              <div style={{ fontSize: 13, marginBottom: 24 }}>
                The sum of <b style={{ textDecoration: 'underline' }}>₱ {fmtAmt(previewVoucher.amount||0)}</b>
              </div>

              {/* Signatories */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
                <div style={{ textAlign: 'center', minWidth: 180 }}>
                  <div style={{ borderTop: '1px solid #000', marginBottom: 4, paddingTop: 4, fontSize: 12 }}>Payment Received BY</div>
                </div>
                <div style={{ textAlign: 'center', minWidth: 180 }}>
                  <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4, textDecoration: 'underline' }}>{(previewVoucher.approved_by||'').toUpperCase()}</div>
                  <div style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 12 }}>Payment Approved By</div>
                </div>
              </div>

              {/* Orange footer */}
              <div style={{ background: '#f17200', marginTop: 24, padding: '8px 0', textAlign: 'center', color: '#fff', fontWeight: 'bold', fontSize: 12, borderRadius: 4 }}>
                YOUR BUSINESS. OUR PASSION.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ISSUED BY MONTH TAB ── */}
      {tab === 'Issued by Month' && (
        <div>
          {/* Month picker */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <button onClick={() => {
                const d = new Date(filterMonth + '-01'); d.setMonth(d.getMonth() - 1)
                setFilterMonth(d.toISOString().slice(0, 7))
              }} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>‹</button>
            <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, width: 'auto' }} />
            <button onClick={() => {
                const d = new Date(filterMonth + '-01'); d.setMonth(d.getMonth() + 1)
                setFilterMonth(d.toISOString().slice(0, 7))
              }} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>›</button>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              {vouchers.filter(v => (v.voucher_date || v.created_at || '').slice(0,7) === filterMonth).length} voucher(s) for this month
            </span>
          </div>

          {(() => {
            const monthVouchers = vouchers
              .filter(v => (v.voucher_date || v.created_at || '').slice(0, 7) === filterMonth)
              .sort((a, b) => new Date(b.voucher_date || b.created_at) - new Date(a.voucher_date || a.created_at))

            if (monthVouchers.length === 0) return (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🗂️</div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>No vouchers for this month</div>
                <div style={{ fontSize: 13 }}>Try selecting a different month.</div>
              </div>
            )

            const totalAmount = monthVouchers.reduce((s, v) => {
              if (v.mode === 'multiple') {
                const rows = v.check_rows || []
                return s + rows.reduce((rs, r) => rs + (parseFloat(r.amount) || 0), 0)
              }
              return s + (parseFloat(v.amount) || 0)
            }, 0)

            return (
              <>
                {/* Month summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
                  {[
                    { label: 'Total Issued', value: monthVouchers.length, color: 'var(--text)' },
                    { label: 'Total Amount', value: `₱${fmt(totalAmount)}`, color: 'var(--accent)' },
                    { label: 'Pending', value: monthVouchers.filter(v => v.status === 'Pending').length, color: '#d97706' },
                    { label: 'Released', value: monthVouchers.filter(v => v.status === 'Released').length, color: '#16a34a' },
                  ].map(c => (
                    <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{c.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: c.color, marginTop: 4 }}>{c.value}</div>
                    </div>
                  ))}
                </div>

                {/* Voucher list */}
                <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Voucher No.</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Date</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Payee</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Description</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthVouchers.map((v, i) => {
                        const rows = v.check_rows || []
                        const total = v.mode === 'multiple'
                          ? rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
                          : (parseFloat(v.amount) || 0)
                        const desc = v.mode === 'multiple'
                          ? (rows.map(r => r.description).filter(Boolean).join(', ') || '—')
                          : (v.description || '—')
                        const statusColor = v.status === 'Released' ? '#16a34a' : v.status === 'Cancelled' ? '#dc2626' : '#d97706'
                        const statusBg = v.status === 'Released' ? '#f0fdf4' : v.status === 'Cancelled' ? '#fef2f2' : '#fffbeb'
                        return (
                          <tr key={v.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>{v.voucher_no || '—'}</td>
                            <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--muted)' }}>{fmtDate(v.voucher_date)}</td>
                            <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500 }}>{v.payee || '—'}</td>
                            <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: statusBg, color: statusColor }}>{v.status}</span>
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>₱{fmt(total)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg)', fontWeight: 700 }}>
                        <td colSpan={5} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13 }}>Total for {new Date(filterMonth + '-01').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}:</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--accent)', fontSize: 14 }}>₱{fmt(totalAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ── PDC TRACKER TAB ── */}
      {tab === 'PDC Tracker' && (
        <div>
          {/* Header row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={() => { setPdcGroupMode(false); setEditingPdc(null); setPdcForm({ payee: '', purpose: '', bank: '', check_no: '', check_date: new Date().toISOString().slice(0,10), amount: '', status: 'Pending', group_label: '', notes: '' }); setShowPdcForm(true) }}
                style={{ padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                + Single Check
              </button>
              <button onClick={() => { setPdcGroupMode(true); setEditingPdc(null); setPdcForm({ payee: '', purpose: '', bank: '', check_no: '', check_date: new Date().toISOString().slice(0,10), amount: '', status: 'Pending', group_label: '', notes: '' }); setShowPdcForm(true) }}
                style={{ padding: '7px 14px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                + PDC Series
              </button>
            </div>
          </div>

          {pdcLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading…</div>
          ) : (() => {
            const today = new Date(); today.setHours(0,0,0,0)

            // Auto-derive effective status by date
            const enriched = pdcChecks.map(c => {
              const checkDate = new Date(c.check_date + 'T00:00:00')
              let effectiveStatus = c.status
              // Only auto-derive if still Pending
              if (c.status === 'Pending') {
                if (checkDate < today) effectiveStatus = 'Due'       // past due — needs attention
                else if (checkDate.getTime() === today.getTime()) effectiveStatus = 'Due Today'
                else effectiveStatus = 'Upcoming'
              }
              return { ...c, effectiveStatus, checkDate }
            })

            // Group by month
            const monthMap = {}
            enriched.forEach(c => {
              const key = c.check_date.slice(0, 7)
              if (!monthMap[key]) monthMap[key] = []
              monthMap[key].push(c)
            })
            const months = Object.keys(monthMap).sort()

            // On first load, auto-collapse months that are fully cleared/cancelled and in the past
            if (!collapsedInit && months.length > 0) {
              const toCollapse = new Set()
              months.forEach(monthKey => {
                const checks = monthMap[monthKey]
                const allDone = checks.every(c => c.status === 'Cleared' || c.status === 'Cancelled')
                const isPast = monthKey < today.toISOString().slice(0,7)
                if (allDone && isPast) toCollapse.add(monthKey)
              })
              setCollapsedInit(true)
              if (toCollapse.size > 0) setCollapsedMonths(toCollapse)
            }

            const toggleMonth = (key) => setCollapsedMonths(prev => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key); else next.add(key)
              return next
            })
            const collapsedCount = months.filter(m => collapsedMonths.has(m)).length

            // Summary
            const totalChecks = enriched.length
            const upcoming = enriched.filter(c => c.effectiveStatus === 'Upcoming' || c.effectiveStatus === 'Due Today' || c.effectiveStatus === 'Due')
            const cleared = enriched.filter(c => c.status === 'Cleared')
            const totalUpcoming = upcoming.reduce((s,c) => s + (c.amount||0), 0)
            const monthsLeft = new Set(upcoming.map(c => c.check_date.slice(0,7))).size

            return (
              <>
                {/* Summary bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
                  {[
                    { label: 'Total Checks', value: totalChecks, sub: 'issued', icon: '🧾', color: 'var(--text)', accent: 'var(--border)' },
                    { label: 'Remaining', value: upcoming.length, sub: 'checks pending', icon: '⏳', color: '#d97706', accent: '#fef3c7' },
                    { label: 'Months Left', value: monthsLeft, sub: 'months to go', icon: '📅', color: '#7c3aed', accent: '#ede9fe' },
                    { label: 'Total Remaining', value: `₱${fmt(totalUpcoming)}`, sub: 'outstanding', icon: '💰', color: 'var(--accent)', accent: 'rgba(241,114,0,0.1)' },
                    { label: 'Cleared', value: cleared.length, sub: 'completed', icon: '✅', color: '#16a34a', accent: '#dcfce7' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 22, opacity: 0.18 }}>{s.icon}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{s.sub}</div>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: s.accent, borderRadius: '0 0 10px 10px' }} />
                    </div>
                  ))}
                </div>

                {/* Monthly timeline */}
                {months.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <button onClick={() => collapsedCount === months.length ? setCollapsedMonths(new Set()) : setCollapsedMonths(new Set(months))}
                      style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                      {collapsedCount === months.length ? '▾ Expand all' : '▸ Collapse all'}
                    </button>
                  </div>
                )}
                {months.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                    <div style={{ fontWeight: 600 }}>No PDC checks yet</div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>Add a single check or a PDC series above.</div>
                  </div>
                ) : months.map(monthKey => {
                  const checks = monthMap[monthKey]
                  const d = new Date(monthKey + '-01T00:00:00')
                  const monthLabel = d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
                  const monthTotal = checks.reduce((s,c) => s + (c.amount||0), 0)
                  const allCleared = checks.every(c => c.status === 'Cleared' || c.status === 'Cancelled')
                  const hasOverdue = checks.some(c => c.effectiveStatus === 'Due')
                  const hasDueToday = checks.some(c => c.effectiveStatus === 'Due Today')
                  const isCurrentMonth = monthKey === today.toISOString().slice(0,7)

                  const monthBorderColor = hasOverdue ? '#dc2626' : hasDueToday ? '#d97706' : allCleared ? '#16a34a' : isCurrentMonth ? 'var(--accent)' : 'var(--border)'
                  const monthBg = hasOverdue ? '#fff5f5' : hasDueToday ? '#fffbeb' : allCleared ? '#f0fdf4' : isCurrentMonth ? 'rgba(241,114,0,0.04)' : 'var(--surface)'

                  const isCollapsed = collapsedMonths.has(monthKey)
                  return (
                    <div key={monthKey} style={{ border: `1px solid ${monthBorderColor}`, borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
                      {/* Month header */}
                      <div onClick={() => toggleMonth(monthKey)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: monthBg, borderBottom: isCollapsed ? 'none' : `1px solid ${monthBorderColor}`, cursor: 'pointer', userSelect: 'none' }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▾</span>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{monthLabel}</div>
                        {isCurrentMonth && <span style={{ fontSize: 11, background: 'var(--accent)', color: '#fff', padding: '1px 8px', borderRadius: 10, fontWeight: 600 }}>THIS MONTH</span>}
                        {hasOverdue && <span style={{ fontSize: 11, background: '#fef2f2', color: '#dc2626', padding: '1px 8px', borderRadius: 10, fontWeight: 600 }}>⚠️ OVERDUE</span>}
                        {hasDueToday && <span style={{ fontSize: 11, background: '#fffbeb', color: '#d97706', padding: '1px 8px', borderRadius: 10, fontWeight: 600 }}>📅 DUE TODAY</span>}
                        {allCleared && <span style={{ fontSize: 11, background: '#f0fdf4', color: '#16a34a', padding: '1px 8px', borderRadius: 10, fontWeight: 600 }}>✅ ALL CLEARED</span>}
                        <div style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>{checks.length} check{checks.length > 1 ? 's' : ''} · ₱{fmt(monthTotal)}</div>
                      </div>

                      {/* Checks in this month */}
                      {!isCollapsed && <div style={{ background: 'var(--surface)' }}>
                        {checks.map((c, i) => {
                          const statusStyles = {
                            'Due':       { bg: '#fef2f2', color: '#dc2626', label: '⚠️ Overdue' },
                            'Due Today': { bg: '#fffbeb', color: '#d97706', label: '📅 Due Today' },
                            'Upcoming':  { bg: '#eff6ff', color: '#2563eb', label: '🔜 Upcoming' },
                            'Cleared':   { bg: '#f0fdf4', color: '#16a34a', label: '✅ Cleared' },
                            'Bounced':   { bg: '#fef2f2', color: '#dc2626', label: '❌ Bounced' },
                            'Cancelled': { bg: 'var(--bg)', color: 'var(--muted)', label: '— Cancelled' },
                          }
                          const ss = statusStyles[c.effectiveStatus] || statusStyles['Upcoming']
                          return (
                            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', flexWrap: 'wrap' }}>
                              <div style={{ fontSize: 12, color: 'var(--muted)', minWidth: 70 }}>{fmtDate(c.check_date)}</div>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, minWidth: 80 }}>
                                {c.check_no}
                                {c._source === 'voucher' && <span style={{ marginLeft: 5, fontSize: 9, background: 'rgba(59,130,246,0.1)', color: '#2563eb', padding: '1px 5px', borderRadius: 4 }}>Voucher</span>}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{c.payee}</div>
                              {c.bank && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.bank}</div>}
                              {(c.purpose || c.group_label) && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.purpose || c.group_label}</div>}
                              <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>₱{fmt(c.amount)}</div>
                              {isAdmin ? (
                                <select value={c.status} onChange={e => handleUpdatePdcStatus(c, e.target.value)}
                                  style={{ padding: '2px 6px', borderRadius: 6, border: `1px solid ${ss.color}`, background: ss.bg, color: ss.color, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                  <option value="Pending">Pending</option>
                                  <option value="Cleared">Cleared</option>
                                  <option value="Bounced">Bounced</option>
                                  <option value="Cancelled">Cancelled</option>
                                </select>
                              ) : (
                                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: ss.bg, color: ss.color }}>{ss.label}</span>
                              )}
                              {isAdmin && c._source !== 'voucher' && (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button onClick={() => { setEditingPdc(c); setPdcGroupMode(false); setPdcForm({ payee: c.payee, purpose: c.purpose||'', bank: c.bank||'', check_no: c.check_no, check_date: c.check_date, amount: String(c.amount), status: c.status, group_label: c.group_label||'', notes: c.notes||'' }); setShowPdcForm(true) }}
                                    style={{ padding: '3px 7px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>✏️</button>
                                  <button onClick={() => handleDeletePdc(c)}
                                    style={{ padding: '3px 7px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>🗑️</button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>}
                    </div>
                  )
                })}
              </>
            )
          })()}

          {/* Add/Edit PDC Modal */}
          {showPdcForm && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px 16px', overflowY: 'auto' }}
              onClick={e => e.target === e.currentTarget && setShowPdcForm(false)}>
              <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', width: '100%', maxWidth: 520, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>
                  {editingPdc ? 'Edit PDC Check' : pdcGroupMode ? '📋 Add PDC Series' : '+ Add PDC Check'}
                </h3>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Payee *</label>
                      <input value={pdcForm.payee} onChange={e => setPdcForm(f=>({...f,payee:e.target.value}))} style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                    <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Bank</label>
                      <input value={pdcForm.bank} onChange={e => setPdcForm(f=>({...f,bank:e.target.value}))} placeholder="BDO, BPI, etc." style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                  </div>
                  <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Purpose / Series Label</label>
                    <input value={pdcForm.purpose} onChange={e => setPdcForm(f=>({...f,purpose:e.target.value}))} placeholder="e.g. Loan payment Jan-Dec 2026" style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>

                  {pdcGroupMode && !editingPdc ? (
                    <>
                      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: 'var(--muted)' }}>
                        Series mode — generates consecutive monthly checks auto-incremented
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>No. of Checks</label>
                          <input type="number" min="1" max="60" value={pdcSeriesCount} onChange={e => setPdcSeriesCount(parseInt(e.target.value)||1)} style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                        <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>First Check Date</label>
                          <DateInput value={pdcSeriesStartDate} onChange={e => setPdcSeriesStartDate(e.target.value)} style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                        <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Amount Each</label>
                          <input type="number" value={pdcSeriesAmount} onChange={e => setPdcSeriesAmount(e.target.value)} placeholder="0.00" style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                      </div>
                      <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Starting Check No.</label>
                        <input value={pdcSeriesStartNo} onChange={e => setPdcSeriesStartNo(e.target.value)} placeholder="e.g. 000123" style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                    </>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Check No. *</label>
                        <input value={pdcForm.check_no} onChange={e => setPdcForm(f=>({...f,check_no:e.target.value}))} style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                      <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Check Date *</label>
                        <DateInput value={pdcForm.check_date} onChange={e => setPdcForm(f=>({...f,check_date:e.target.value}))} style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                      <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Amount *</label>
                        <input type="number" value={pdcForm.amount} onChange={e => setPdcForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>
                    </div>
                  )}

                  {!pdcGroupMode && (
                    <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Status</label>
                      <select value={pdcForm.status} onChange={e => setPdcForm(f=>({...f,status:e.target.value}))} style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13 }}>
                        <option value="Pending">Pending</option>
                        <option value="Cleared">Cleared</option>
                        <option value="Bounced">Bounced</option>
                        <option value="Cancelled">Cancelled</option>
                      </select></div>
                  )}

                  <div><label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Notes</label>
                    <input value={pdcForm.notes} onChange={e => setPdcForm(f=>({...f,notes:e.target.value}))} placeholder="Optional" style={{ width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontSize:13,boxSizing:'border-box' }} /></div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                    <button onClick={() => { setShowPdcForm(false); setEditingPdc(null) }}
                      style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                    <button onClick={pdcGroupMode && !editingPdc ? handleSavePdcSeries : handleSavePdc} disabled={saving}
                      style={{ padding: '8px 20px', background: pdcGroupMode && !editingPdc ? '#7c3aed' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                      {saving ? 'Saving…' : pdcGroupMode && !editingPdc ? `Generate ${pdcSeriesCount} Checks` : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog state={confirmModal} onClose={() => setConfirmModal(null)} />
      <SignatoryDialog open={sigDialog} onClose={()=>setSigDialog(false)} onPrint={doPrint} settings={settings} profile={profile} docType="Check Voucher" />
      <Toast toast={toast} />
    </div>
  )
}