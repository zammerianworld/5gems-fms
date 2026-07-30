import { useState, useEffect } from 'react'
import { supabase, logAudit } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

const APP_SECRET = process.env.REACT_APP_APP_SECRET

async function callEdgeFunction(body) {
  // Add secret key to body — no JWT needed
  const payload = { ...body, secret: APP_SECRET }
  
  let res
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (fetchErr) {
    throw new Error('Network error: ' + fetchErr.message)
  }

  let result = {}
  try { result = await res.json() } catch (e) { result = { error: `HTTP ${res.status}` } }
  if (!res.ok || result.error) throw new Error(result.error || `HTTP ${res.status}`)
  return result
}

const ALL_MODULES = [
  { key: 'dashboard',     label: 'Dashboard',        icon: '🏠', minRole: 'staff' },
  { key: 'trips',         label: 'Trip Entry',        icon: '🚛', minRole: 'staff' },
  { key: 'expenses',      label: 'Expenses',          icon: '💸', minRole: 'staff' },
  { key: 'subcon',        label: 'Sub-con Trips',     icon: '🤝', minRole: 'staff' },
  { key: 'how_to',        label: 'How-To Guide',      icon: '📖', minRole: 'staff' },
  { key: 'billing',       label: 'Billing & SOA',     icon: '🧾', minRole: 'staff' },
  { key: 'paid_invoices', label: 'Paid Invoices',     icon: '✅', minRole: 'staff' },
  { key: 'orcr',          label: 'OR/CR Tracking',    icon: '🚗', minRole: 'admin' },
  { key: 'reports',       label: 'Reports',           icon: '📊', minRole: 'admin' },
  { key: 'summary',       label: 'Overall Summary',   icon: '📋', minRole: 'admin' },
  { key: 'yoy',           label: 'Year-over-Year',    icon: '📈', minRole: 'admin' },
  { key: 'cashflow',      label: 'Cashflow',          icon: '💰', minRole: 'admin' },
  { key: 'vouchers',      label: 'Check Vouchers',    icon: '🖨️', minRole: 'admin' },
  { key: 'cash_vouchers', label: 'Cash Vouchers',     icon: '💵', minRole: 'admin' },
  { key: 'payroll',       label: 'Payroll',           icon: '💼', minRole: 'admin' },
  { key: 'loans',         label: 'Loans',             icon: '🏦', minRole: 'admin' },
  { key: 'extra_income',  label: 'Extra Income',      icon: '💹', minRole: 'admin' },
  { key: 'historical',    label: 'Historical Data',   icon: '📅', minRole: 'admin' },
  { key: 'settings',      label: 'Settings',          icon: '⚙️', minRole: 'admin' },
  { key: 'trash',         label: 'Trash',             icon: '🗑️', minRole: 'admin' },
  { key: 'backup',        label: 'DB Backup',         icon: '💾', minRole: 'admin' },
]
const STAFF_DEFAULTS = ['dashboard','trips','expenses','subcon','how_to','billing','paid_invoices']
const ADMIN_DEFAULTS = ALL_MODULES.map(m => m.key)

export default function Users() {
  const { toast, showToast } = useToast()
  const { isSuperuser } = useAuth()
  const [users, setUsers] = useState([])
  const [trucks, setTrucks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'staff', use_email: true, viewer_plates: [] })
  const [editForm, setEditForm] = useState({ full_name: '', role: 'staff', new_password: '', override_pin: '', viewer_plates: [] })
  const [editPerms, setEditPerms] = useState(null)
  const [pinError, setPinError] = useState('')
  const [confirmModal, setConfirmModal] = useState(null)

  const fetchUsers = async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*,override_pin').order('created_at')
    setUsers(data || [])
    const { data: tk } = await supabase.from('trucks').select('id,plate').order('plate')
    setTrucks(tk || [])
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  const handleCreate = async () => {
    if (!form.full_name || !form.password) { showToast('Name and password required.', 'error'); return }
    if (form.use_email && !form.email) { showToast('Email required.', 'error'); return }
    if (form.password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return }
    if (form.role === 'viewer' && form.viewer_plates.length === 0) { showToast('Select at least one truck for this viewer account.', 'error'); return }
    setSaving(true)
    try {
      await callEdgeFunction({ action: 'create', full_name: form.full_name, email: form.email, password: form.password, role: form.role, use_email: form.use_email, viewer_plates: form.viewer_plates })
      logAudit('generate', 'Created', 'User',
        `${form.full_name} · ${form.role}`,
        '', null, 'Superuser/Admin')
      showToast(`Account created for ${form.full_name}.`)
      setForm({ full_name: '', email: '', password: '', role: 'staff', use_email: true, viewer_plates: [] })
      setShowForm(false)
      fetchUsers()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    setSaving(false)
  }

  const validatePin = (pin) => {
    if (!pin) return '' // optional
    if (!/^[A-Za-z]\d{5}$/.test(pin)) return 'PIN must be 1 letter followed by 5 numbers (e.g. A12345)'
    return ''
  }

  const handleUpdateUser = async () => {
    if (editForm.override_pin) {
      const pinErr = validatePin(editForm.override_pin)
      if (pinErr) { setPinError(pinErr); return }
      // Check uniqueness against other admins
      const { data: others } = await supabase.from('profiles').select('id,full_name,override_pin').neq('id', editingUser.id)
      const dup = others?.find(u => u.override_pin && u.override_pin.toUpperCase() === editForm.override_pin.toUpperCase())
      if (dup) { setPinError(`PIN already used by ${dup.full_name}. Each admin must have a unique PIN.`); return }
    }
    setPinError('')
    setSaving(true)
    try {
      await callEdgeFunction({ action: 'update_password', user_id: editingUser.id, full_name: editForm.full_name, role: editForm.role, new_password: editForm.new_password || undefined, viewer_plates: editForm.role === 'viewer' ? editForm.viewer_plates : undefined })
      // Save override_pin directly to profiles
      // Use real auth UID for superuser (fake session stores 'superuser' not a real UUID)
      if (editForm.override_pin !== undefined) {
        let targetId = editingUser.id
        if (targetId === 'superuser') {
          const { data: { user } } = await supabase.auth.getUser()
          targetId = user?.id
        }
        if (targetId) {
          await supabase.from('profiles').update({ override_pin: editForm.override_pin.toUpperCase() || null }).eq('id', targetId)
        }
      }
      logAudit('destructive', 'Edited', 'User',
        `${editForm.full_name} · role: ${editForm.role}${editForm.new_password ? ' · password changed' : ''}`,
        editingUser.id, null, 'Superuser/Admin')
      showToast('User updated.')
      await supabase.rpc('update_user_permissions', { p_user_id: editingUser.id, p_permissions: editPerms })
      setEditingUser(null)
      setEditForm({ full_name: '', role: 'staff', new_password: '', override_pin: '', viewer_plates: [] })
      fetchUsers()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    setSaving(false)
  }

  const handleDelete = (userId, name) => {
    setConfirmModal({
      message: `Delete user "${name}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await callEdgeFunction({ action: 'delete', user_id: userId })
          showToast('User deleted.', 'info')
        } catch (err) {
          await supabase.rpc('permanent_delete', { p_table: 'profiles', p_id: userId })
          showToast('Removed from list.', 'info')
        }
        fetchUsers()
      }
    })
  }

  const roleLabel = (role) => {
    if (role === 'superuser') return <span className="badge" style={{ background: 'rgba(139,92,246,0.15)', color: '#6d28d9', fontSize: 10 }}>⚡ Superuser</span>
    if (role === 'admin') return <span className="badge" style={{ background: 'var(--accent-light)', color: 'var(--accent)', fontSize: 10 }}>Admin</span>
    if (role === 'viewer') return <span className="badge" style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb', fontSize: 10 }}>👁️ Viewer</span>
    return <span className="badge badge-success" style={{ fontSize: 10 }}>Staff</span>
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Manage Users</h1><p className="page-sub">Create and manage staff accounts</p></div>
        <button className="btn-primary" onClick={() => { setShowForm(!showForm); setEditingUser(null) }}>
          {showForm ? '✕ Cancel' : '+ Add User'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 24, maxWidth: 520 }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>New User Account</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[{ val: true, label: '📧 Email + Password' }, { val: false, label: '👤 Name + Password only' }].map(opt => (
              <button key={String(opt.val)} onClick={() => setForm(f => ({ ...f, use_email: opt.val }))} style={{
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: form.use_email === opt.val ? 'var(--accent)' : 'var(--surface)',
                color: form.use_email === opt.val ? '#fff' : 'var(--muted)',
                border: `1.5px solid ${form.use_email === opt.val ? 'var(--accent)' : 'var(--border)'}`,
              }}>{opt.label}</button>
            ))}
          </div>
          {!form.use_email && (
            <div style={{ padding: '8px 12px', background: 'var(--accent-light)', borderRadius: 6, fontSize: 12, color: 'var(--accent-dark)', marginBottom: 14 }}>
              ℹ️ Staff logs in with their <strong>full name</strong> and password.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="label required">Full Name</label>
              <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="e.g. Maria Santos" />
            </div>
            {form.use_email && (
              <div className="form-group">
                <label className="label required">Email Address</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="staff@example.com" />
              </div>
            )}
            <div className="form-group">
              <label className="label required">Password</label>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 6 characters" autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label className="label">Role</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="staff">Staff — Trip entry, billing, expenses</option>
                <option value="admin">Admin — Full access</option>
                <option value="viewer">Viewer — Read-only, own truck(s) only</option>
                {isSuperuser && <option value="superuser">Superuser</option>}
              </select>
            </div>
            {form.role === 'viewer' && (
              <div className="form-group">
                <label className="label required">Truck(s) this account can view</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 4, maxHeight: 140, overflowY: 'auto', padding: 8, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  {trucks.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No trucks found.</div> : trucks.map(t => {
                    const checked = form.viewer_plates.includes(t.plate)
                    return (
                      <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 5px', borderRadius: 3, cursor: 'pointer', background: checked ? 'rgba(37,99,235,0.08)' : 'transparent' }}>
                        <input type="checkbox" checked={checked} onChange={e => setForm(f => ({ ...f, viewer_plates: e.target.checked ? [...f.viewer_plates, t.plate] : f.viewer_plates.filter(p => p !== t.plate) }))} style={{ width: 'auto', margin: 0 }} />
                        <span style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{t.plate}</span>
                      </label>
                    )
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 4 }}>This account will only ever see trips for the truck(s) checked above.</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create Account'}</button>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="card" style={{ marginBottom: 24, maxWidth: 520, border: '1.5px solid var(--accent)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>Edit: {editingUser.full_name || editingUser.email}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="label">Full Name</label>
              <input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Role</label>
              <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer — Read-only, own truck(s) only</option>
                {isSuperuser && <option value="superuser">Superuser</option>}
              </select>
            </div>
            {editForm.role === 'viewer' && (
              <div className="form-group">
                <label className="label required">Truck(s) this account can view</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 4, maxHeight: 140, overflowY: 'auto', padding: 8, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  {trucks.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No trucks found.</div> : trucks.map(t => {
                    const checked = editForm.viewer_plates.includes(t.plate)
                    return (
                      <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 5px', borderRadius: 3, cursor: 'pointer', background: checked ? 'rgba(37,99,235,0.08)' : 'transparent' }}>
                        <input type="checkbox" checked={checked} onChange={e => setEditForm(f => ({ ...f, viewer_plates: e.target.checked ? [...f.viewer_plates, t.plate] : f.viewer_plates.filter(p => p !== t.plate) }))} style={{ width: 'auto', margin: 0 }} />
                        <span style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{t.plate}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="form-group">
              <label className="label">New Password <span style={{ fontWeight: 400, color: 'var(--hint)', textTransform: 'none', letterSpacing: 0 }}>(leave blank to keep current)</span></label>
              <input type="password" value={editForm.new_password} onChange={e => setEditForm(f => ({ ...f, new_password: e.target.value }))} placeholder="Min. 6 characters" autoComplete="new-password" />
            </div>
            {(editForm.role === 'admin' || editForm.role === 'superuser') && (
              <div className="form-group">
                <label className="label">Override PIN <span style={{ fontWeight: 400, color: 'var(--hint)', textTransform: 'none', letterSpacing: 0 }}>1 letter + 5 numbers (e.g. A12345) — used to authorize invoiced trip edits</span></label>
                <input value={editForm.override_pin} onChange={e => { setEditForm(f => ({ ...f, override_pin: e.target.value.toUpperCase() })); setPinError('') }} placeholder="e.g. A12345" maxLength={6} style={{ fontFamily: 'var(--mono)', letterSpacing: 2 }} />
                {pinError && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{pinError}</div>}
                {editForm.override_pin && !pinError && /^[A-Za-z]\d{5}$/.test(editForm.override_pin) && (
                  <div style={{ color: 'var(--success)', fontSize: 11, marginTop: 4 }}>✓ Valid PIN format</div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            {/* Module Permissions — not applicable to viewer accounts, which are
                always locked to just their own read-only page */}
            {editForm.role !== 'viewer' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Module Access</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => { const obj = {}; ALL_MODULES.filter(m => editForm.role === 'staff' ? m.minRole === 'staff' : true).forEach(m => obj[m.key] = true); setEditPerms(obj) }}
                    style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>All</button>
                  <button onClick={() => setEditPerms({})}
                    style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>None</button>
                  <button onClick={() => setEditPerms(null)}
                    style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #16a34a', background: '#f0fdf4', color: '#16a34a', cursor: 'pointer' }}>Defaults</button>
                </div>
              </div>
              {editPerms === null && (
                <div style={{ fontSize: 11, color: '#16a34a', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 5, padding: '4px 8px', marginBottom: 6 }}>
                  ✅ Using role defaults
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 3, maxHeight: 180, overflowY: 'auto', padding: 6, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
                {ALL_MODULES.filter(m => editForm.role === 'staff' ? m.minRole === 'staff' : true).map(m => {
                  const defaults = editForm.role === 'staff' ? STAFF_DEFAULTS : ADMIN_DEFAULTS
                  const checked = editPerms === null ? defaults.includes(m.key) : !!(editPerms[m.key])
                  return (
                    <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 5px', borderRadius: 3, cursor: 'pointer', background: checked ? 'rgba(255,30,0,0.08)' : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={e => {
                        const base = editPerms === null ? defaults.reduce((o,k) => ({...o,[k]:true}), {}) : {...editPerms}
                        base[m.key] = e.target.checked
                        setEditPerms(base)
                      }} style={{ width: 'auto', margin: 0 }} />
                      <span style={{ fontSize: 11 }}>{m.icon} {m.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            )}

            <button className="btn-ghost" onClick={() => { setEditingUser(null); setEditPerms(null); setEditForm({ full_name: '', role: 'staff', new_password: '', override_pin: '', viewer_plates: [] }); setPinError('') }}>Cancel</button>
            <button className="btn-primary" onClick={handleUpdateUser} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </div>
      )}

      {loading ? <div className="empty-state"><p>Loading users…</p></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Email / Login</th><th>Role</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.full_name || '—'}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {u.email === 'superuser@5gems.internal' ? '(superuser)' :
                     (u.email?.includes('@5gems.internal') || u.email?.includes('@5gems.local')) ? '(name login)' : u.email}
                  </td>
                  <td>
                    {roleLabel(u.role)}
                    {u.override_pin && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(22,163,74,0.1)', color: 'var(--success)', padding: '1px 5px', borderRadius: 4 }}>🔑 PIN set</span>}
                    {u.role === 'viewer' && <span className="mono" style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)' }}>{(u.viewer_plates || []).join(', ') || 'no truck assigned'}</span>}
                  </td>
                  <td className="muted mono" style={{ fontSize: 12 }}>{u.created_at ? new Date(u.created_at).toLocaleDateString('en-PH') : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-ghost btn-sm" onClick={() => {
                        setEditingUser(u)
                        setEditForm({ full_name: u.full_name || '', role: u.role || 'staff', new_password: '', override_pin: u.override_pin || '', viewer_plates: u.viewer_plates || [] })
                        setEditPerms(u.permissions || null)
        setPinError('')
                        setShowForm(false)
                      }}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={() => handleDelete(u.id, u.full_name || u.email)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmModal && (
        <div className="modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Confirm</h3>
            <p>{confirmModal.message}</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmModal(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => { confirmModal.onConfirm(); setConfirmModal(null) }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  )
}
