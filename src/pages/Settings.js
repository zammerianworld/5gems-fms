import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
const SIG_SECTIONS = [
  { key: 'soa', label: 'SOA / Billing', prepKey: 'prepared_by_name', prepTitleKey: 'prepared_by_title', notedKey: 'noted_by_name', notedTitleKey: 'noted_by_title' },
  { key: 'mgmt', label: 'Management Report', prepKey: 'mgmt_prepared_by_name', prepTitleKey: 'mgmt_prepared_by_title', notedKey: 'mgmt_noted_by_name', notedTitleKey: 'mgmt_noted_by_title' },
  { key: 'bk', label: 'Bookkeeper Report', prepKey: 'bk_prepared_by_name', prepTitleKey: 'bk_prepared_by_title', notedKey: 'bk_noted_by_name', notedTitleKey: 'bk_noted_by_title' },
  { key: 'aging', label: 'Aging Report', prepKey: 'aging_prepared_by_name', prepTitleKey: 'aging_prepared_by_title', notedKey: 'aging_noted_by_name', notedTitleKey: 'aging_noted_by_title' },
  { key: 'cv', label: 'Check Voucher', prepKey: 'cv_prepared_by_name', prepTitleKey: 'cv_prepared_by_title', notedKey: 'cv_noted_by_name', notedTitleKey: 'cv_noted_by_title' },
  { key: 'cashv', label: 'Cash Voucher', prepKey: 'cashv_prepared_by_name', prepTitleKey: 'cashv_prepared_by_title', notedKey: 'cashv_noted_by_name', notedTitleKey: 'cashv_noted_by_title' },
  { key: 'orcr', label: 'OR/CR Report', prepKey: 'orcr_prepared_by_name', prepTitleKey: 'orcr_prepared_by_title', notedKey: 'orcr_noted_by_name', notedTitleKey: 'orcr_noted_by_title' },
]
function F({ label, value, onChange, placeholder, type = 'text', span }) {
  return (
    <div className="form-group" style={span ? { gridColumn: `span ${span}` } : {}}>
      <label className="label">{label}</label>
      <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} />
    </div>
  )
}
const EMPTY_NEW_TRUCK = { plate: '', truck_code: '', truck_type: 'Dump Truck', make: '', model: '', year: '', notes: '', ownership: 'company', subcon_name: '', start_date: '2024-01-01', end_date: '' }
export default function Settings() {
  const { toast, showToast } = useToast()
  const { isSuperuser } = useAuth()
  const [appVersion, setAppVersion] = useState('1.0')
  const [appBeta, setAppBeta] = useState(true)
  const [appBetaLabel, setAppBetaLabel] = useState('BETA — Testing Phase')
  const [versionSaving, setVersionSaving] = useState(false)
  const TABS = ['Company Info', 'Signatories', 'Trucks', 'Drivers', 'Clientele', 'Commodities', 'Routes', ...(isSuperuser ? ['PWA Icons', 'App Version'] : [])]
  const [tab, setTab] = useState('Company Info')
  const [confirmState, setConfirmState] = useState(null)
  const [settings, setSettings] = useState({
    company_name: '',
    logo_url: '', vat_tin: '', address: '', contact: '', email: '',
    prepared_by_name: '', prepared_by_title: 'VP for Finance / Treasurer',
    noted_by_name: '', noted_by_title: 'President',
    mgmt_prepared_by_name: '', mgmt_prepared_by_title: '',
    mgmt_noted_by_name: '', mgmt_noted_by_title: '',
    bk_prepared_by_name: '', bk_prepared_by_title: '',
    bk_noted_by_name: '', bk_noted_by_title: '',
    aging_prepared_by_name: '', aging_prepared_by_title: '',
    aging_noted_by_name: '', aging_noted_by_title: '',
    cv_prepared_by_name: '', cv_prepared_by_title: '',
    cv_noted_by_name: '', cv_noted_by_title: '',
    cashv_prepared_by_name: '', cashv_prepared_by_title: '',
    cashv_noted_by_name: '', cashv_noted_by_title: '',
    orcr_prepared_by_name: '', orcr_prepared_by_title: '',
    orcr_noted_by_name: '', orcr_noted_by_title: '',
  })
  const [trucks, setTrucks] = useState([])
  const [clients, setClients] = useState([])
  const [commodities, setCommodities] = useState([])
  const [routes, setRoutes] = useState([])
  const [newRoute, setNewRoute] = useState('')
  const [saving, setSaving] = useState(false)
  const [signatories, setSignatories] = useState([])
  const [newSig, setNewSig] = useState({ full_name: '', title: '', is_default_prepared: false, is_default_approved: false })
  const [editingSig, setEditingSig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [drivers, setDrivers] = useState([])
  const [newDriver, setNewDriver] = useState({ driver_name: '', truck_id: '', notes: '' })
  const [editingDriver, setEditingDriver] = useState(null)
  const [newTruck, setNewTruck] = useState(EMPTY_NEW_TRUCK)
  const [newClient, setNewClient] = useState({ nickname: '', full_name: '', address: '', tin: '', contact: '' })
  const [newCommodity, setNewCommodity] = useState('')
  const [newCommodityType, setNewCommodityType] = useState('dump')
  const [editingTruck, setEditingTruck] = useState(null)
  const [editingClient, setEditingClient] = useState(null)
  useEffect(() => { fetchAll() }, [])
  const fetchAll = async () => {
    setLoading(true)
    const [s, t, c, co, drv, sig] = await Promise.all([
      supabase.from('company_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('trucks').select('*').order('truck_type').order('plate'),
      supabase.from('clients').select('*').order('nickname'),
      supabase.from('commodities').select('*').order('for_type').order('name'),
      supabase.from('drivers').select('*').order('driver_name'),
      supabase.from('signatories').select('*').order('sort_order').order('full_name'),
    ])
    if (s.data) {
      setSettings(prev => ({ ...prev, ...s.data }))
      if (s.data.app_version !== undefined) setAppVersion(s.data.app_version || '1.0')
      if (s.data.app_beta !== undefined) setAppBeta(s.data.app_beta)
      if (s.data.app_beta_label !== undefined) setAppBetaLabel(s.data.app_beta_label || 'BETA — Testing Phase')
    }
    if (t.data) setTrucks(t.data)
    if (c.data) setClients(c.data)
    if (co.data) setCommodities(co.data)
    const { data: rts } = await supabase.from('saved_routes').select('*').order('label')
    if (rts) setRoutes(rts)
    if (drv.data) setDrivers(drv.data)
    if (sig.data) setSignatories(sig.data)
    setLoading(false)
  }
  const confirm = (message, onConfirm) => setConfirmState({ title: 'Confirm Removal', variant: 'danger', confirmLabel: 'Remove', message, onConfirm })
  const addDriver = async () => {
    if (!newDriver.driver_name) { showToast('Driver name required.', 'error'); return }
    const { error } = await supabase.from('drivers').insert(newDriver)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Driver added.'); setNewDriver({ driver_name: '', truck_id: '', notes: '' }); fetchAll() }
  }
  const saveDriver = async () => {
    const { error } = await supabase.from('drivers').update(editingDriver).eq('id', editingDriver.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Driver updated.'); setEditingDriver(null); fetchAll() }
  }
  const deleteDriver = (id, name) => confirm(`Remove driver "${name}"?`, async () => {
    await supabase.rpc('permanent_delete', { p_table: 'drivers', p_id: id })
    showToast('Removed.', 'info'); fetchAll()
  })
  const saveSettings = async () => {
    setSaving(true)
    const { error } = await supabase.from('company_settings')
      .update({ ...settings, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) showToast('Error: ' + error.message, 'error')
    else showToast('Settings saved.')
    setSaving(false)
  }
  const saveVersion = async () => {
    setVersionSaving(true)
    const { data, error } = await supabase.rpc('update_app_version', {
      p_version: appVersion.trim(),
      p_beta: appBeta,
      p_beta_label: appBetaLabel.trim()
    })
    if (error) showToast('Error: ' + error.message, 'error')
    else showToast('Version updated. Refresh the page to see changes.')
    setVersionSaving(false)
  }

  const addTruck = async () => {
    if (!newTruck.plate || !newTruck.truck_type) { showToast('Plate and type required.', 'error'); return }
    const payload = { ...newTruck, start_date: newTruck.start_date || '2024-01-01', end_date: newTruck.end_date || null }
    const { error } = await supabase.from('trucks').insert(payload)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Truck added.'); setNewTruck(EMPTY_NEW_TRUCK); fetchAll() }
  }
  const saveTruck = async () => {
    const payload = { ...editingTruck, start_date: editingTruck.start_date || '2024-01-01', end_date: editingTruck.end_date || null }
    const { error } = await supabase.from('trucks').update(payload).eq('id', editingTruck.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Truck updated.'); setEditingTruck(null); fetchAll() }
  }
  const deleteTruck = (id, plate) => confirm(`Remove truck ${plate}?`, async () => {
    await supabase.rpc('permanent_delete', { p_table: 'trucks', p_id: id })
    showToast('Removed.', 'info'); fetchAll()
  })
  const addClient = async () => {
    if (!newClient.nickname || !newClient.full_name) { showToast('Nickname and full name required.', 'error'); return }
    const { error } = await supabase.from('clients').insert(newClient)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Client added.'); setNewClient({ nickname: '', full_name: '', address: '', tin: '', contact: '' }); fetchAll() }
  }
  const saveClient = async () => {
    const { error } = await supabase.from('clients').update(editingClient).eq('id', editingClient.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Client updated.'); setEditingClient(null); fetchAll() }
  }
  const deleteClient = (id, name) => confirm(`Remove client "${name}"?`, async () => {
    await supabase.rpc('permanent_delete', { p_table: 'clients', p_id: id })
    showToast('Removed.', 'info'); fetchAll()
  })
  const addRoute = async () => {
    const name = newRoute.trim()
    if (!name) return
    if (routes.some(r => r.label?.toLowerCase() === name.toLowerCase())) { showToast('Route already exists.', 'error'); return }
    const { data, error } = await supabase.from('saved_routes').insert({ label: name }).select().single()
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    setRoutes(prev => [...prev, data].sort((a,b) => a.label.localeCompare(b.label)))
    setNewRoute('')
    showToast('Route added.')
  }

  const deleteRoute = async (id, name) => {
    const { error } = await supabase.from('saved_routes').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    setRoutes(prev => prev.filter(r => r.id !== id))
    showToast(`"${name}" removed.`, 'info')
  }

  const addCommodity = async () => {
    const name = newCommodity.trim()
    if (!name) return
    const { error } = await supabase.from('commodities').insert({ name, for_type: newCommodityType })
    if (error) showToast('Already exists or error.', 'error')
    else { showToast(`"${name}" added.`); setNewCommodity(''); fetchAll() }
  }
  const deleteCommodity = (id, name) => confirm(`Remove "${name}"?`, async () => {
    await supabase.rpc('permanent_delete', { p_table: 'commodities', p_id: id })
    showToast('Removed.', 'info'); fetchAll()
  })

  // ── TRUCK DATE FIELDS ── shared between Add and Edit forms
  const TruckDateFields = ({ form, setForm }) => (
    <>
      <div className="form-group">
        <label className="label required">Fleet Start Date</label>
        <input type="date" value={form.start_date || '2024-01-01'}
          onChange={e => setForm(t => ({ ...t, start_date: e.target.value }))}
          max={new Date().toISOString().slice(0, 10)} />
        <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, display: 'block' }}>
          When this truck joined the fleet. Used for expense division.
        </span>
      </div>
      <div className="form-group">
        <label className="label">Fleet End Date <span style={{ fontWeight: 400, color: 'var(--hint)', textTransform: 'none', letterSpacing: 0 }}>(blank = still active)</span></label>
        <input type="date" value={form.end_date || ''}
          onChange={e => setForm(t => ({ ...t, end_date: e.target.value || '' }))}
          min={form.start_date || '2024-01-01'} />
        {form.end_date && (
          <span style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3, display: 'block' }}>
            ⚠️ Excluded from expense division after this date.
          </span>
        )}
      </div>
    </>
  )

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Settings</h1><p className="page-sub">Company info, signatories, trucks, clients, commodities</p></div>
      </div>
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '0.5px solid var(--border)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none', padding: '8px 16px', fontSize: 13, whiteSpace: 'nowrap',
            fontWeight: tab === t ? 500 : 400, cursor: 'pointer',
            color: tab === t ? 'var(--text)' : 'var(--muted)',
            borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>
      {loading ? <div className="empty-state"><p>Loading…</p></div> : <>
        {tab === 'Company Info' && (
          <div className="card" style={{ maxWidth: 680 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>Company Information</h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Appears on all printed documents.</p>
            <div className="form-grid" style={{ marginBottom: 16 }}>
              <div className="form-group" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: '0.5px solid var(--border)', marginBottom: 8 }}>
                <div style={{ width: 72, height: 72, background: 'var(--bg)', border: '1.5px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                  {settings.logo_url ? <img src={settings.logo_url} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', margin: 'auto' }} /> : <span style={{ fontSize: 28 }}>🐉</span>}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Company Logo</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Shown on Login and Dashboard. PNG or JPG recommended.</div>
                  <input type="file" accept="image/*" onChange={async e => {
                    const file = e.target.files[0]; if (!file) return
                    if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2MB.', 'error'); return }
                    const reader = new FileReader()
                    reader.onloadend = () => { const dataUrl = reader.result; setSettings(s => ({ ...s, logo_url: dataUrl })); localStorage.setItem('ds_logo', dataUrl) }
                    reader.readAsDataURL(file)
                  }} style={{ fontSize: 12 }} />
                  {settings.logo_url && <button className="btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => { setSettings(s => ({ ...s, logo_url: '' })); localStorage.removeItem('ds_logo') }}>Remove logo</button>}
                </div>
              </div>
              <F label="Company Name" value={settings.company_name} onChange={v => setSettings(s => ({ ...s, company_name: v }))} span={2} />
              <F label="VAT Registration TIN" value={settings.vat_tin} onChange={v => setSettings(s => ({ ...s, vat_tin: v }))} placeholder="000-190-742-00001 VAT" />
              <F label="Contact Number" value={settings.contact} onChange={v => setSettings(s => ({ ...s, contact: v }))} />
              <F label="Email Address" value={settings.email} onChange={v => setSettings(s => ({ ...s, email: v }))} type="email" span={2} />
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="label">Full Address</label>
              <textarea rows={2} value={settings.address || ''} onChange={e => setSettings(s => ({ ...s, address: e.target.value }))} placeholder="Purok 1, Matti, Digos City, Davao del Sur" style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-primary" onClick={saveSettings} disabled={saving}>{saving ? 'Saving…' : 'Save Company Info'}</button>
            </div>
          </div>
        )}
        {tab === 'Signatories' && (
          <div style={{ maxWidth: 600 }}>
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Signatory Directory</h2>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Define people who sign documents. When printing, pick from this list and their title auto-fills.</p>
              <div className="form-grid" style={{ marginBottom: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="label required">Full Name</label>
                  <input value={newSig.full_name} onChange={e => setNewSig(s => ({ ...s, full_name: e.target.value.toUpperCase() }))} placeholder="e.g. JUAN DELA CRUZ" />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="label required">Title / Position</label>
                  <input value={newSig.title} onChange={e => setNewSig(s => ({ ...s, title: e.target.value }))} placeholder="e.g. VP for Finance" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14, fontSize: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newSig.is_default_prepared} onChange={e => setNewSig(s => ({ ...s, is_default_prepared: e.target.checked }))} style={{ width: 'auto' }} />Default "Prepared by"
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newSig.is_default_approved} onChange={e => setNewSig(s => ({ ...s, is_default_approved: e.target.checked }))} style={{ width: 'auto' }} />Default "Approved by"
                </label>
              </div>
              <button className="btn-primary btn-sm" onClick={async () => {
                if (!newSig.full_name || !newSig.title) { showToast('Name and title required.', 'error'); return }
                const { error } = await supabase.from('signatories').insert({ ...newSig, sort_order: signatories.length })
                if (error) showToast('Error: ' + error.message, 'error')
                else { showToast('Signatory added.'); setNewSig({ full_name: '', title: '', is_default_prepared: false, is_default_approved: false }); fetchAll() }
              }}>+ Add Signatory</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {signatories.map((sig) => (
                <div key={sig.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                  {editingSig?.id === sig.id ? (
                    <>
                      <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                        <input value={editingSig.full_name} onChange={e => setEditingSig(s => ({ ...s, full_name: e.target.value.toUpperCase() }))} style={{ flex: 2 }} />
                        <input value={editingSig.title} onChange={e => setEditingSig(s => ({ ...s, title: e.target.value }))} style={{ flex: 1 }} placeholder="Title" />
                      </div>
                      <button className="btn-primary btn-sm" onClick={async () => {
                        const { error } = await supabase.from('signatories').update({ full_name: editingSig.full_name, title: editingSig.title, is_default_prepared: editingSig.is_default_prepared, is_default_approved: editingSig.is_default_approved }).eq('id', sig.id)
                        if (error) showToast('Error: ' + error.message, 'error')
                        else { showToast('Updated.'); setEditingSig(null); fetchAll() }
                      }}>Save</button>
                      <button className="btn-ghost btn-sm" onClick={() => setEditingSig(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{sig.full_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--accent)' }}>{sig.title}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                          {sig.is_default_prepared && <span style={{ fontSize: 10, background: 'rgba(255,30,0,0.1)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>Default Prepared</span>}
                          {sig.is_default_approved && <span style={{ fontSize: 10, background: 'rgba(22,163,74,0.1)', color: 'var(--success)', padding: '1px 6px', borderRadius: 4 }}>Default Approved</span>}
                        </div>
                      </div>
                      <button className="btn-ghost btn-sm" onClick={() => setEditingSig({ ...sig })}>✏️</button>
                      <button className="btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => {
                        setConfirmState({
                          title: 'Remove Signatory',
                          variant: 'danger',
                          confirmLabel: 'Remove',
                          message: `Remove ${sig.full_name}?`,
                          onConfirm: async () => {
                            await supabase.rpc('permanent_delete', { p_table: 'signatories', p_id: sig.id }); fetchAll()
                          },
                        })
                      }}>✕</button>
                    </>
                  )}
                </div>
              ))}
              {signatories.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: 8 }}>No signatories added yet.</div>}
            </div>
          </div>
        )}
        {tab === 'Trucks' && (
          <>
            {/* Add Truck */}
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 14 }}>Add Truck</h2>
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <div className="form-group"><label className="label required">Plate Number</label>
                  <input value={newTruck.plate} onChange={e => setNewTruck(t => ({ ...t, plate: e.target.value }))} placeholder="e.g. ABC-1234" /></div>
                <div className="form-group"><label className="label required">Type</label>
                  <select value={newTruck.truck_type} onChange={e => setNewTruck(t => ({ ...t, truck_type: e.target.value }))}>
                    <option value="Dump Truck">Dump Truck</option>
                    <option value="Prime Mover">Prime Mover</option>
                  </select></div>
                <div className="form-group"><label className="label">Ownership</label>
                  <select value={newTruck.ownership || 'company'} onChange={e => setNewTruck(t => ({ ...t, ownership: e.target.value, subcon_name: e.target.value === 'company' ? '' : t.subcon_name }))}>
                    <option value="company">🏢 Company</option>
                    <option value="subcon">🤝 Sub-contractor (Regular)</option>
                    <option value="special_subcon">⭐ Sub-contractor (Special)</option>
                  </select></div>
                {newTruck.ownership !== 'company' && (
                  <div className="form-group"><label className="label">Sub-con Partner Name</label>
                    <input value={newTruck.subcon_name || ''} onChange={e => setNewTruck(t => ({ ...t, subcon_name: e.target.value }))} placeholder="e.g. Juan dela Cruz" /></div>
                )}
                <F label="Truck Code" value={newTruck.truck_code} onChange={v => setNewTruck(t => ({ ...t, truck_code: v }))} placeholder="e.g. DT-01" />
                <F label="Make" value={newTruck.make} onChange={v => setNewTruck(t => ({ ...t, make: v }))} placeholder="e.g. Hino" />
                <F label="Model" value={newTruck.model} onChange={v => setNewTruck(t => ({ ...t, model: v }))} />
                <F label="Year" value={newTruck.year} onChange={v => setNewTruck(t => ({ ...t, year: v }))} />
                <TruckDateFields form={newTruck} setForm={setNewTruck} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-primary" onClick={addTruck}>Add Truck</button>
              </div>
            </div>

            {/* Edit Truck */}
            {editingTruck && (
              <div className="card" style={{ marginBottom: 20, border: '1.5px solid var(--accent)' }}>
                <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Editing: {editingTruck.plate}</h2>
                <div className="form-grid" style={{ marginBottom: 14 }}>
                  {[['plate','Plate'],['truck_code','Code'],['make','Make'],['model','Model'],['year','Year']].map(([f,l]) => (
                    <div key={f} className="form-group"><label className="label">{l}</label>
                      <input value={editingTruck[f]||''} onChange={e => setEditingTruck(t=>({...t,[f]:e.target.value}))} /></div>
                  ))}
                  <div className="form-group"><label className="label">Type</label>
                    <select value={editingTruck.truck_type} onChange={e => setEditingTruck(t=>({...t,truck_type:e.target.value}))}>
                      <option value="Dump Truck">Dump Truck</option>
                      <option value="Prime Mover">Prime Mover</option>
                    </select></div>
                  <div className="form-group"><label className="label">Ownership</label>
                    <select value={editingTruck.ownership || 'company'} onChange={e => setEditingTruck(t=>({...t, ownership: e.target.value, subcon_name: e.target.value === 'company' ? '' : t.subcon_name}))}>
                      <option value="company">🏢 Company</option>
                      <option value="subcon">🤝 Sub-contractor (Regular)</option>
                      <option value="special_subcon">⭐ Sub-contractor (Special)</option>
                    </select></div>
                  {editingTruck.ownership !== 'company' && (
                    <div className="form-group"><label className="label">Sub-con Partner Name</label>
                      <input value={editingTruck.subcon_name || ''} onChange={e => setEditingTruck(t=>({...t, subcon_name: e.target.value}))} placeholder="e.g. Juan dela Cruz" /></div>
                  )}
                  <TruckDateFields form={editingTruck} setForm={setEditingTruck} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn-ghost" onClick={() => setEditingTruck(null)}>Cancel</button>
                  <button className="btn-primary" onClick={saveTruck}>Save</button>
                </div>
              </div>
            )}

            {/* Truck count summary */}
            {trucks.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {[
                  { label: 'Company', key: 'company', color: 'var(--success)' },
                  { label: 'Regular Sub-con', key: 'subcon', color: '#6d28d9' },
                  { label: 'Special Sub-con', key: 'special_subcon', color: 'var(--accent)' },
                ].map(({ label, key, color }) => {
                  const count = trucks.filter(t => t.ownership === key).length
                  return count > 0 ? (
                    <div key={key} style={{ padding: '5px 12px', borderRadius: 8, background: 'var(--bg)', border: '0.5px solid var(--border)', fontSize: 12 }}>
                      <span style={{ color, fontWeight: 600 }}>{count}</span>
                      <span style={{ color: 'var(--muted)', marginLeft: 4 }}>{label}</span>
                    </div>
                  ) : null
                })}
                <div style={{ padding: '5px 12px', borderRadius: 8, background: 'var(--bg)', border: '0.5px solid var(--border)', fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{trucks.length}</span>
                  <span style={{ color: 'var(--muted)', marginLeft: 4 }}>Total</span>
                </div>
              </div>
            )}

            {/* Trucks table */}
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Plate</th><th>Code</th><th>Type</th><th>Make / Model</th><th>Year</th><th>Fleet Start</th><th>Fleet End</th><th></th></tr></thead>
                <tbody>
                  {trucks.length === 0
                    ? <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No trucks yet.</td></tr>
                    : trucks.map(t => (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 500, fontFamily: 'var(--mono)' }}>{t.plate}</td>
                        <td className="muted">{t.truck_code || '—'}</td>
                        <td>
                          <span className={`badge ${t.truck_type === 'Dump Truck' ? 'badge-dump' : 'badge-prime'}`}>{t.truck_type}</span>
                          {t.ownership === 'subcon' && <span className="badge" style={{ fontSize: 9, background: 'rgba(139,92,246,0.12)', color: '#6d28d9', marginLeft: 4 }}>🤝 Sub-con{t.subcon_name ? ` · ${t.subcon_name}` : ''}</span>}
                          {t.ownership === 'special_subcon' && <span className="badge" style={{ fontSize: 9, background: 'rgba(245,114,0,0.12)', color: '#c45e00', marginLeft: 4 }}>⭐ Spc Sub-con{t.subcon_name ? ` · ${t.subcon_name}` : ''}</span>}
                        </td>
                        <td className="muted">{[t.make, t.model].filter(Boolean).join(' ') || '—'}</td>
                        <td className="muted">{t.year || '—'}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{t.start_date || '2024-01-01'}</td>
                        <td style={{ fontSize: 12 }}>
                          {t.end_date
                            ? <span style={{ color: 'var(--danger)', fontFamily: 'var(--mono)' }}>{t.end_date}</span>
                            : <span style={{ color: 'var(--success)', fontSize: 11 }}>Active</span>}
                        </td>
                        <td><div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-ghost btn-sm" onClick={() => setEditingTruck(t)}>Edit</button>
                          <button className="btn-danger btn-sm" onClick={() => deleteTruck(t.id, t.plate)}>Remove</button>
                        </div></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === 'Drivers' && (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 14 }}>Add Driver</h2>
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <div className="form-group"><label className="label required">Driver Name</label>
                  <input value={newDriver.driver_name} onChange={e => setNewDriver(d => ({ ...d, driver_name: e.target.value }))} placeholder="Full name" /></div>
                <div className="form-group"><label className="label">Assigned Truck</label>
                  <select value={newDriver.truck_id} onChange={e => setNewDriver(d => ({ ...d, truck_id: e.target.value }))}>
                    <option value="">No specific truck</option>
                    {trucks.map(t => <option key={t.id} value={t.id}>{t.plate} ({t.truck_type})</option>)}
                  </select></div>
                <div className="form-group"><label className="label">Notes</label>
                  <input value={newDriver.notes} onChange={e => setNewDriver(d => ({ ...d, notes: e.target.value }))} placeholder="Optional notes" /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-primary" onClick={addDriver}>Add Driver</button>
              </div>
            </div>
            {editingDriver && (
              <div className="card" style={{ marginBottom: 20, border: '1.5px solid var(--accent)' }}>
                <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Editing: {editingDriver.driver_name}</h2>
                <div className="form-grid" style={{ marginBottom: 14 }}>
                  <div className="form-group"><label className="label">Name</label>
                    <input value={editingDriver.driver_name} onChange={e => setEditingDriver(d => ({ ...d, driver_name: e.target.value }))} /></div>
                  <div className="form-group"><label className="label">Assigned Truck</label>
                    <select value={editingDriver.truck_id || ''} onChange={e => setEditingDriver(d => ({ ...d, truck_id: e.target.value }))}>
                      <option value="">No specific truck</option>
                      {trucks.map(t => <option key={t.id} value={t.id}>{t.plate} ({t.truck_type})</option>)}
                    </select></div>
                  <div className="form-group"><label className="label">Notes</label>
                    <input value={editingDriver.notes || ''} onChange={e => setEditingDriver(d => ({ ...d, notes: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn-ghost" onClick={() => setEditingDriver(null)}>Cancel</button>
                  <button className="btn-primary" onClick={saveDriver}>Save</button>
                </div>
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Driver Name</th><th>Assigned Truck</th><th>Notes</th><th></th></tr></thead>
                <tbody>
                  {drivers.length === 0
                    ? <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No drivers yet.</td></tr>
                    : drivers.map(d => {
                      const truck = trucks.find(t => t.id === d.truck_id)
                      return (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 500 }}>{d.driver_name}</td>
                          <td>{truck ? <span className={`badge ${truck.truck_type === 'Dump Truck' ? 'badge-dump' : 'badge-prime'}`}>{truck.plate}</span> : <span className="muted">—</span>}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{d.notes || '—'}</td>
                          <td><div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn-ghost btn-sm" onClick={() => setEditingDriver(d)}>Edit</button>
                            <button className="btn-danger btn-sm" onClick={() => deleteDriver(d.id, d.driver_name)}>Remove</button>
                          </div></td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === 'Clientele' && (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 14 }}>Add Client</h2>
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <F label="Nickname" value={newClient.nickname} onChange={v => setNewClient(c=>({...c,nickname:v}))} placeholder="e.g. SMC" />
                <F label="Full Company Name" value={newClient.full_name} onChange={v => setNewClient(c=>({...c,full_name:v}))} />
                <F label="TIN" value={newClient.tin} onChange={v => setNewClient(c=>({...c,tin:v}))} placeholder="000-000-000-000" />
                <F label="Contact" value={newClient.contact} onChange={v => setNewClient(c=>({...c,contact:v}))} />
                <div className="form-group" style={{ gridColumn: 'span 2' }}><label className="label">Address</label>
                  <input value={newClient.address||''} onChange={e=>setNewClient(c=>({...c,address:e.target.value}))} /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-primary" onClick={addClient}>Add Client</button>
              </div>
            </div>
            {editingClient && (
              <div className="card" style={{ marginBottom: 20, border: '1.5px solid var(--accent)' }}>
                <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Editing: {editingClient.nickname}</h2>
                <div className="form-grid" style={{ marginBottom: 14 }}>
                  {[['nickname','Nickname'],['full_name','Full Name'],['tin','TIN'],['contact','Contact']].map(([f,l]) => (
                    <div key={f} className="form-group"><label className="label">{l}</label>
                      <input value={editingClient[f]||''} onChange={e=>setEditingClient(c=>({...c,[f]:e.target.value}))} /></div>
                  ))}
                  <div className="form-group" style={{ gridColumn: 'span 2' }}><label className="label">Address</label>
                    <input value={editingClient.address||''} onChange={e=>setEditingClient(c=>({...c,address:e.target.value}))} /></div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn-ghost" onClick={() => setEditingClient(null)}>Cancel</button>
                  <button className="btn-primary" onClick={saveClient}>Save</button>
                </div>
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Nickname</th><th>Full Name</th><th>TIN</th><th>Contact</th><th>Address</th><th></th></tr></thead>
                <tbody>
                  {clients.length === 0
                    ? <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No clients yet.</td></tr>
                    : clients.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 500 }}>{c.nickname}</td>
                        <td>{c.full_name}</td>
                        <td className="mono muted" style={{ fontSize: 12 }}>{c.tin || '—'}</td>
                        <td className="muted">{c.contact || '—'}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{c.address || '—'}</td>
                        <td><div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-ghost btn-sm" onClick={() => setEditingClient(c)}>Edit</button>
                          <button className="btn-danger btn-sm" onClick={() => deleteClient(c.id, c.nickname)}>Remove</button>
                        </div></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === 'Commodities' && (
          <>
            <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 14 }}>Add Commodity</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={newCommodity} onChange={e => setNewCommodity(e.target.value.toUpperCase())}
                  placeholder="Commodity name…" onKeyDown={e => e.key === 'Enter' && addCommodity()} style={{ flex: 2, minWidth: 140 }} />
                <select value={newCommodityType} onChange={e => setNewCommodityType(e.target.value)} style={{ width: 'auto' }}>
                  <option value="dump">🚛 Dump Truck</option>
                  <option value="pm">🚜 Prime Mover</option>
                </select>
                <button className="btn-primary" onClick={addCommodity}>Add</button>
              </div>
            </div>
            {['dump','pm'].map(type => (
              <div key={type} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: type==='dump'?'var(--accent)':'#4338CA', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {type === 'dump' ? '🚛 Dump Truck' : '🚜 Prime Mover'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {commodities.filter(c => (c.for_type || 'dump') === type).map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, background: 'var(--surface)', border: '0.5px solid var(--border-md)', borderRadius: 20, padding: '5px 10px 5px 14px' }}>
                      {c.name}
                      <button title={`Move to ${type==='dump'?'Prime Mover':'Dump Truck'}`}
                        onClick={async () => {
                          const newType = type === 'dump' ? 'pm' : 'dump'
                          const { error } = await supabase.from('commodities').update({ for_type: newType }).eq('id', c.id)
                          if (error) { showToast('Error: ' + error.message, 'error') }
                          else { showToast(`Moved to ${newType==='pm'?'Prime Mover':'Dump Truck'}.`); setCommodities(prev => prev.map(x => x.id === c.id ? { ...x, for_type: newType } : x)) }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', padding: '0 2px', lineHeight: 1 }}>
                        {type === 'dump' ? '→🚜' : '→🚛'}
                      </button>
                      <button onClick={() => deleteCommodity(c.id, c.name)} style={{ background: 'none', border: 'none', color: 'var(--hint)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                    </div>
                  ))}
                  {commodities.filter(c => (c.for_type || 'dump') === type).length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>None yet.</span>}
                </div>
              </div>
            ))}
          </>
        )}
        {tab === 'Routes' && (
          <>
            <div className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Add Route</h2>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Routes appear in Trip Entry (Dump Truck) and the Manage Trips filter. Custom routes here are combined with the built-in list.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={newRoute} onChange={e => setNewRoute(e.target.value)}
                  placeholder="e.g. Lagonglong-Davao" onKeyDown={e => e.key === 'Enter' && addRoute()}
                  style={{ flex: 1 }} />
                <button className="btn-primary" onClick={addRoute}>Add</button>
              </div>
            </div>
            <div className="card">
              <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Custom Routes</h2>
              {routes.length === 0
                ? <p style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No custom routes yet. Built-in routes (CDO-Davao, Lagonglong-Davao, etc.) are always available.</p>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {routes.map(r => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, background: 'var(--surface)', border: '0.5px solid var(--border-md)', borderRadius: 20, padding: '5px 10px 5px 14px' }}>
                        {r.label}
                        <button onClick={() => deleteRoute(r.id, r.label)} style={{ background: 'none', border: 'none', color: 'var(--hint)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </>
        )}
        {tab === 'PWA Icons' && isSuperuser && (
          <div className="card" style={{ maxWidth: 520 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>PWA App Icons</h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>These icons appear when staff installs the app on their phone. Files must be replaced in GitHub to take effect.</p>
            {[
              { label: 'Small Icon (192×192)', src: '/icons/icon-192.png', file: 'public/icons/icon-192.png', hint: 'Used on home screen and app list' },
              { label: 'Large Icon (512×512)', src: '/icons/icon-512.png', file: 'public/icons/icon-512.png', hint: 'Used for splash screen on launch' },
              { label: 'Document Header Image', src: '/header-logo.png', file: 'public/header-logo.png', hint: 'Used on Check Voucher PDF header' },
            ].map(icon => (
              <div key={icon.file} style={{ marginBottom: 16, padding: 14, background: 'var(--bg)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
                  <img src={icon.src} alt={icon.label} style={{ height: 48, width: 48, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--border)' }} onError={e => { e.target.style.opacity = 0.2 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{icon.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{icon.hint}</div>
                  </div>
                </div>
                <a href={icon.src} download style={{ fontSize: 12, color: 'var(--accent)' }}>⬇ Download current</a>
                <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 6 }}>To update: replace <code>{icon.file}</code> in GitHub → redeploy</div>
              </div>
            ))}
            <div style={{ padding: '10px 14px', background: 'var(--accent-light)', borderRadius: 8, fontSize: 12, color: 'var(--accent-dark)' }}>
              💡 These are static files in your GitHub repo. Download the current version, replace it with your new icon, then upload to GitHub and Vercel will redeploy automatically.
            </div>
          </div>
        )}
      </>}
      {/* ── APP VERSION TAB ── */}
      {tab === 'App Version' && isSuperuser && (
        <div className="card" style={{ maxWidth: 500 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>⚙️ App Version Settings</h2>
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="form-group">
              <label className="label">Version Number</label>
              <input value={appVersion} onChange={e => setAppVersion(e.target.value)} placeholder="e.g. 1.0, 1.1, 2.0"
                style={{ fontFamily: 'var(--mono)', letterSpacing: '.05em' }} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Shows as "FMS v1.0" in the sidebar</div>
            </div>
            <div className="form-group">
              <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" checked={appBeta} onChange={e => setAppBeta(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                Show Beta Badge
              </label>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Displays the beta label below the logout button</div>
            </div>
            {appBeta && (
              <div className="form-group">
                <label className="label">Beta Label Text</label>
                <input value={appBetaLabel} onChange={e => setAppBetaLabel(e.target.value)} placeholder="BETA — Testing Phase" />
              </div>
            )}
            <div style={{ padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--muted)' }}>
              Preview: <strong style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>FMS v{appVersion}</strong>
              {appBeta && <span style={{ marginLeft: 8, fontSize: 10, color: 'rgba(255,255,255,0.4)', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>{appBetaLabel}</span>}
            </div>
            <button className="btn-primary" onClick={saveVersion} disabled={versionSaving} style={{ width: 'fit-content' }}>
              {versionSaving ? 'Saving…' : 'Save Version'}
            </button>
          </div>
        </div>
      )}

      <Toast toast={toast} />
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}
