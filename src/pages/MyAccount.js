import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthContext'
import { useToast, Toast } from '../components/Toast'

export default function MyAccount() {
  const { profile, isSuperuser, isAdmin, refreshProfile } = useAuth()
  const { toast, showToast, dismissToast } = useToast()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinSuccess, setPinSuccess] = useState(false)

  const roleLabel = {
    superuser: '⚡ Superuser',
    admin: '🔑 Admin',
    staff: '👤 Staff',
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast('All fields required.', 'error'); return
    }
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.', 'error'); return
    }
    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters.', 'error'); return
    }
    if (isSuperuser) {
      showToast('Superuser password is managed via Vercel environment variables.', 'info'); return
    }

    setSaving(true)
    try {
      // Verify current password by attempting sign-in
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: profile?.email,
        password: currentPassword,
      })
      if (verifyError) {
        showToast('Current password is incorrect.', 'error')
        setSaving(false)
        return
      }

      // Update own password directly via Supabase auth
      const { error: pwError } = await supabase.auth.updateUser({ password: newPassword })
      if (pwError) { showToast('Error: ' + pwError.message, 'error'); setSaving(false); return }

      showToast('Password updated successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      showToast('Error: ' + err.message, 'error')
    }
    setSaving(false)
  }

  // Override PINs live in the admin-only override_pins table (migrations
  // 028/029), not in profiles. Only admins/superusers have PINs.
  const [hasPin, setHasPin] = useState(false)
  useEffect(() => {
    if (!isAdmin || !profile?.id) return
    supabase.from('override_pins').select('user_id').eq('user_id', profile.id).maybeSingle()
      .then(({ data, error }) => setHasPin(error ? !!profile?.override_pin : !!data))
  }, [isAdmin, profile?.id])

  const handleSavePin = async () => {
    setPinError(''); setPinSuccess(false)
    if (!pin) { setPinError('Enter a PIN.'); return }
    if (!/^[A-Za-z]\d{5}$/.test(pin)) { setPinError('PIN must be 1 letter + 5 numbers (e.g. A12345).'); return }
    const upper = pin.toUpperCase()
    setPinSaving(true)
    // Check uniqueness against other admins' PINs
    const { data: pins, error: tableErr } = await supabase.from('override_pins').select('user_id,pin').neq('user_id', profile.id)
    if (!tableErr) {
      if ((pins || []).some(r => (r.pin || '').toUpperCase() === upper)) {
        setPinError('That PIN is already used by another admin. Choose a different one.'); setPinSaving(false); return
      }
      const { error } = await supabase.from('override_pins').upsert({ user_id: profile.id, pin: upper, updated_at: new Date().toISOString() })
      if (error) setPinError('Error: ' + error.message)
      else { setPinSuccess(true); setPin(''); setHasPin(true) }
    } else {
      // Before migration 028 the table doesn't exist — keep the old column working.
      const { data: others } = await supabase.from('profiles').select('id,full_name,override_pin').neq('id', profile.id)
      const dup = others?.find(u => u.override_pin && u.override_pin.toUpperCase() === upper)
      if (dup) { setPinError(`PIN already used by ${dup.full_name}. Choose a different one.`); setPinSaving(false); return }
      const { error } = await supabase.from('profiles').update({ override_pin: upper }).eq('id', profile.id)
      if (error) setPinError('Error: ' + error.message)
      else { setPinSuccess(true); setPin(''); setHasPin(true); refreshProfile() }
    }
    setPinSaving(false)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">My Account</h1><p className="page-sub">View your profile and change your password</p></div>
      </div>

      {/* Profile info */}
      <div className="card" style={{ marginBottom: 24, maxWidth: 520 }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>Profile</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Name</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{profile?.full_name || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Email</span>
            <span style={{ fontSize: 13, fontFamily: 'var(--mono)' }}>
              {profile?.email?.includes('@5gems.internal') ? '(name login)' : profile?.email || '—'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Role</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{roleLabel[profile?.role] || profile?.role}</span>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="card" style={{ maxWidth: 520 }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Change Password</h2>
        {isSuperuser
          ? <div style={{ padding: '10px 14px', background: 'var(--warning-light)', borderRadius: 8, fontSize: 13, color: 'var(--warning)' }}>
              ⚡ Superuser password is managed via Vercel environment variables. Contact the developer to change it.
            </div>
          : <>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>You must enter your current password to set a new one.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="label required">Current Password</label>
                <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Your current password" autoComplete="current-password" />
              </div>
              <div className="form-group">
                <label className="label required">New Password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min. 6 characters" autoComplete="new-password" />
              </div>
              <div className="form-group">
                <label className="label required">Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn-primary" onClick={handleChangePassword} disabled={saving}>
                {saving ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </>
        }
      </div>
      {/* Override PIN — admin only */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Override PIN</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            Used to authorize editing of invoiced trips. Format: 1 letter + 5 numbers (e.g. <span style={{ fontFamily: 'var(--mono)' }}>A12345</span>).
          </p>
          {hasPin && (
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--success)' }}>
              ✅ PIN is currently set. Enter a new one below to change it.
            </div>
          )}
          {!hasPin && (
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--warning, #92400E)', background: '#FEF9C3', padding: '6px 10px', borderRadius: 6 }}>
              ⚠️ No PIN set yet. Set one to allow override of invoiced trip edits.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 180 }}>
              <label className="label">New Override PIN</label>
              <input
                value={pin}
                onChange={e => { setPin(e.target.value.toUpperCase()); setPinError(''); setPinSuccess(false) }}
                placeholder="e.g. A12345"
                maxLength={6}
                style={{ fontFamily: 'var(--mono)', letterSpacing: 4, fontSize: 18, textAlign: 'center' }}
              />
              {pinError && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{pinError}</div>}
              {pinSuccess && <div style={{ color: 'var(--success)', fontSize: 11, marginTop: 4 }}>✅ PIN updated successfully.</div>}
              {pin && !pinError && /^[A-Za-z]\d{5}$/.test(pin) && (
                <div style={{ color: 'var(--success)', fontSize: 11, marginTop: 4 }}>✓ Valid format</div>
              )}
            </div>
            <button className="btn-primary" onClick={handleSavePin} disabled={pinSaving || !pin} style={{ marginTop: 20 }}>
              {pinSaving ? 'Saving…' : 'Save PIN'}
            </button>
          </div>
        </div>
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
