import { useState, useEffect, useCallback } from 'react'
import { supabase, fmt, fmtDate, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'

const AUTO_PURGE_DAYS = 30

export default function Trash() {
  const { isAdmin, isSuperuser } = useAuth()
  const { toast, showToast } = useToast()
  const [tab, setTab] = useState('Trips')
  const [dumpTrash, setDumpTrash] = useState([])
  const [pmTrash, setPmTrash] = useState([])
  const [invoiceTrash, setInvoiceTrash] = useState([])
  const [expenseTrash, setExpenseTrash] = useState([])
  const [loading, setLoading] = useState(true)
  const [purging, setPurging] = useState(false)
  const [confirmModal, setConfirmModal] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [dt, pt, inv, exp] = await Promise.all([
      fetchAllRows(() => supabase.from('trips_dump').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
      fetchAllRows(() => supabase.from('trips_pm').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
      fetchAllRows(() => supabase.from('invoices').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
      fetchAllRows(() => supabase.from('expenses').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    ])
    if (dt.data) setDumpTrash(dt.data)
    if (pt.data) setPmTrash(pt.data)
    if (inv.data) setInvoiceTrash(inv.data)
    if (exp.data) setExpenseTrash(exp.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const daysLeft = (deletedAt) => {
    const d = Math.ceil((new Date(deletedAt).getTime() + AUTO_PURGE_DAYS * 86400000 - Date.now()) / 86400000)
    return Math.max(0, d)
  }

  const handleRestore = async (table, id) => {
    const { error } = await supabase.from(table).update({ deleted_at: null }).eq('id', id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Restored.'); fetchAll() }
  }

  const handlePermanentDelete = (table, id, label) => {
    setConfirmModal({ table, id, label: label || 'this record' })
  }

  const confirmDelete = async () => {
    const { table, id } = confirmModal
    setConfirmModal(null)

    // Use security definer RPC — bypasses RLS, validates role server-side
    const { data, error } = await supabase.rpc('permanent_delete', {
      p_table: table,
      p_id: id,
    })
    if (error) {
      showToast('Error: ' + error.message, 'error')
    } else if (data === false) {
      showToast('Delete failed — record not found.', 'error')
    } else {
      showToast('Permanently deleted.', 'info')
      fetchAll()
    }
  }

  const handleAutoPurge = async () => {
    setPurging(true)
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - AUTO_PURGE_DAYS)
    const cutoffStr = cutoff.toISOString()
    await Promise.all([
      supabase.from('trips_dump').delete().not('deleted_at', 'is', null).lt('deleted_at', cutoffStr),
      supabase.from('trips_pm').delete().not('deleted_at', 'is', null).lt('deleted_at', cutoffStr),
      supabase.from('invoices').delete().not('deleted_at', 'is', null).lt('deleted_at', cutoffStr),
      supabase.from('expenses').delete().not('deleted_at', 'is', null).lt('deleted_at', cutoffStr),
    ])
    showToast('Auto-purged items older than 30 days.')
    fetchAll()
    setPurging(false)
  }

  const tripCount = dumpTrash.length + pmTrash.length
  const totalCount = tripCount + invoiceTrash.length + expenseTrash.length

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">🗑️ Trash</h1>
          <p className="page-sub">Deleted items — auto-purged after {AUTO_PURGE_DAYS} days</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost btn-sm" onClick={fetchAll}>↻ Refresh</button>
          {(isAdmin || isSuperuser) && (
            <button className="btn-danger btn-sm" onClick={handleAutoPurge} disabled={purging}>
              {purging ? 'Purging…' : '🗑️ Purge Expired'}
            </button>
          )}
        </div>
      </div>

      {totalCount === 0 && !loading && (
        <div className="empty-state"><p>Trash is empty. 🎉</p></div>
      )}

      {totalCount > 0 && (
        <>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
            {[['Trips', tripCount], ['Invoices', invoiceTrash.length], ['Expenses', expenseTrash.length]].map(([t, count]) => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '10px 18px', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', color: tab === t ? 'var(--accent)' : 'var(--muted)', fontWeight: tab === t ? 600 : 400, cursor: 'pointer', fontSize: 13 }}>
                {t} {count > 0 && <span style={{ marginLeft: 4, fontSize: 10, background: 'var(--border)', borderRadius: 10, padding: '1px 6px' }}>{count}</span>}
              </button>
            ))}
          </div>

          {loading ? <div className="empty-state"><p>Loading…</p></div> : (
            <>
              {tab === 'Trips' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[...dumpTrash.map(t => ({ ...t, _type: 'dump' })), ...pmTrash.map(t => ({ ...t, _type: 'pm' }))]
                    .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at))
                    .map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--surface)', borderRadius: 8, border: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, background: t._type === 'dump' ? 'rgba(255,30,0,0.1)' : 'rgba(67,56,202,0.1)', color: t._type === 'dump' ? 'var(--accent)' : '#4338CA', padding: '1px 6px', borderRadius: 4 }}>
                        {t._type === 'dump' ? '🚛 Dump' : '🚜 PM'}
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>{t.truck_plate}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(t.trip_date)}</span>
                      <span style={{ fontSize: 12, flex: 1 }}>{t.route || t.trip_code || '—'} · {t.commodity || t.container_size || '—'}</span>
                      <span style={{ fontSize: 11, color: daysLeft(t.deleted_at) <= 3 ? 'var(--danger)' : 'var(--muted)' }}>⏳ {daysLeft(t.deleted_at)}d left</span>
                      <button className="btn-ghost btn-sm" onClick={() => handleRestore(t._type === 'dump' ? 'trips_dump' : 'trips_pm', t.id)}>↩ Restore</button>
                      {isSuperuser && (
                        <button className="btn-danger btn-sm" onClick={() => handlePermanentDelete(
                          t._type === 'dump' ? 'trips_dump' : 'trips_pm', t.id,
                          `trip ${t.truck_plate} ${fmtDate(t.trip_date)}`
                        )}>✕</button>
                      )}
                    </div>
                  ))}
                  {tripCount === 0 && <div className="empty-state"><p>No deleted trips.</p></div>}
                </div>
              )}

              {tab === 'Invoices' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {invoiceTrash.map(inv => (
                    <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--surface)', borderRadius: 8, border: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>#{inv.invoice_no}</span>
                      <span style={{ fontSize: 12 }}>{inv.client}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(inv.invoice_date)} · {inv.truck_type}</span>
                      <span style={{ fontSize: 13, fontFamily: 'var(--mono)', flex: 1 }}>₱{fmt((inv.total_sales_net || 0) * 1.12)}</span>
                      <span style={{ fontSize: 11, color: daysLeft(inv.deleted_at) <= 3 ? 'var(--danger)' : 'var(--muted)' }}>⏳ {daysLeft(inv.deleted_at)}d left</span>
                      <button className="btn-ghost btn-sm" onClick={() => handleRestore('invoices', inv.id)}>↩ Restore</button>
                      {isSuperuser && (
                        <button className="btn-danger btn-sm" onClick={() => handlePermanentDelete(
                          'invoices', inv.id, `invoice #${inv.invoice_no}`
                        )}>✕</button>
                      )}
                    </div>
                  ))}
                  {invoiceTrash.length === 0 && <div className="empty-state"><p>No deleted invoices.</p></div>}
                </div>
              )}

              {tab === 'Expenses' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {expenseTrash.map(e => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--surface)', borderRadius: 8, border: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{e.category}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(e.expense_date)}</span>
                      <span style={{ fontSize: 13, fontFamily: 'var(--mono)', flex: 1 }}>₱{fmt(e.amount)}</span>
                      <span style={{ fontSize: 11, color: daysLeft(e.deleted_at) <= 3 ? 'var(--danger)' : 'var(--muted)' }}>⏳ {daysLeft(e.deleted_at)}d left</span>
                      <button className="btn-ghost btn-sm" onClick={() => handleRestore('expenses', e.id)}>↩ Restore</button>
                      {isSuperuser && (
                        <button className="btn-danger btn-sm" onClick={() => handlePermanentDelete(
                          'expenses', e.id, `expense ${e.category} ₱${fmt(e.amount)}`
                        )}>✕</button>
                      )}
                    </div>
                  ))}
                  {expenseTrash.length === 0 && <div className="empty-state"><p>No deleted expenses.</p></div>}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Confirm permanent delete modal */}
      {confirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => e.target === e.currentTarget && setConfirmModal(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', width: '100%', maxWidth: 400, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>Permanently Delete?</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
              This will permanently delete <strong>{confirmModal.label}</strong>. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmModal(null)}
                style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={confirmDelete}
                style={{ padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
