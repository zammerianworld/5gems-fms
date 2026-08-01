import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
const AuthContext = createContext({})
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const fetchProfile = async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data)
    return data
  }

  // ── SESSION REFRESH ──────────────────────────────────────────────────────
  // 1. Idle logout after 30 min of inactivity
  // 2. Activity-based session refresh 10 min after last user action
  // 3. Periodic refresh every 45 min regardless (JWT expires at 60 min)
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes
  useEffect(() => {
    let activityTimer = null
    let idleTimer = null

    const doRefresh = async () => {
      if (sessionStorage.getItem('superuser_session')) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) await supabase.auth.refreshSession()
      } catch (e) { /* silent */ }
    }

    const doIdleLogout = async () => {
      const isSuperSess = sessionStorage.getItem('superuser_session')
      if (isSuperSess) {
        sessionStorage.removeItem('superuser_session')
        setUser(null); setProfile(null)
      } else {
        await supabase.auth.signOut()
      }
    }

    const resetTimers = () => {
      // Reset session refresh timer
      if (activityTimer) clearTimeout(activityTimer)
      activityTimer = setTimeout(doRefresh, 10 * 60 * 1000)
      // Reset idle logout timer
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(doIdleLogout, IDLE_TIMEOUT_MS)
    }

    // Periodic refresh every 45 min — keeps session alive while active
    const periodicTimer = setInterval(doRefresh, 45 * 60 * 1000)

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetTimers, { passive: true }))
    resetTimers()

    return () => {
      if (activityTimer) clearTimeout(activityTimer)
      if (idleTimer) clearTimeout(idleTimer)
      clearInterval(periodicTimer)
      events.forEach(e => window.removeEventListener(e, resetTimers))
    }
  }, [])

  useEffect(() => {
    // Auto-purge check on load (if superuser and auto-purge enabled)
    const checkAutoPurge = async () => {
      try {
        const { data: settings } = await supabase.from('company_settings')
          .select('audit_enabled, audit_retention, audit_auto_purge, audit_last_purge').eq('id', 1).maybeSingle()
        if (!settings?.audit_auto_purge || !settings?.audit_retention || settings.audit_retention === 'forever') return
        const lastPurge = settings.audit_last_purge ? new Date(settings.audit_last_purge) : null
        const now = new Date()
        const daysSince = lastPurge ? Math.floor((now - lastPurge) / 86400000) : 999
        const retentionDays = { '3months': 90, '6months': 180, '1year': 365, '2years': 730 }[settings.audit_retention] || 365
        if (daysSince >= retentionDays) {
          const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - retentionDays)
          const cutoffStr = cutoff.toISOString()
          await supabase.from('login_logs').delete().lt('created_at', cutoffStr)
          await supabase.from('audit_logs').delete().lt('created_at', cutoffStr)
          await supabase.from('company_settings').update({ audit_last_purge: now.toISOString() }).eq('id', 1)
        }
      } catch (e) { console.warn('Auto-purge check failed:', e.message) }
    }

    // Check for superuser session first
    const superSession = sessionStorage.getItem('superuser_session')
    if (superSession) {
      try {
        const superProfile = JSON.parse(superSession)
        setUser({ id: 'superuser', email: 'superuser@5gems.internal' })
        setProfile(superProfile)
        setLoading(false)
        checkAutoPurge()
        return
      } catch (e) {
        sessionStorage.removeItem('superuser_session')
      }
    }

    // Use onAuthStateChange as the SOLE source of truth.
    // getSession() is only used to set the initial user synchronously before
    // the listener fires — this prevents the brief null flash that causes
    // the redirect-to-login loop.
    let initialised = false
    const mountedAt = Date.now()
    const SIGNED_OUT_GRACE_MS = 4000 // right after a fresh page load (e.g. post-login
    // redirect), Supabase's client can emit a spurious SIGNED_OUT while it's still
    // settling the session from storage — a real one arriving in this window gets
    // double-checked against a fresh getSession() before we actually log anyone out.

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Ignore spurious SIGNED_OUT during the initial token refresh window
      if (!initialised && event === 'SIGNED_OUT') return

      if (event === 'SIGNED_OUT' && Date.now() - mountedAt < SIGNED_OUT_GRACE_MS) {
        const { data: { session: recheck } } = await supabase.auth.getSession()
        if (recheck) { initialised = true; return } // false alarm — session is actually fine
      }

      const superSess = sessionStorage.getItem('superuser_session')
      if (superSess) {
        try {
          const superProfile = JSON.parse(superSess)
          setUser(session?.user ?? { id: 'superuser', email: 'superuser@5gems.internal' })
          setProfile(superProfile)
          setLoading(false)
        } catch (e) {}
        return
      }

      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setProfile(null)
        setLoading(false)
      }
      initialised = true
    })

    // Prime the listener with the current session so the first paint is correct
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialised) {
        initialised = true
        setUser(session?.user ?? null)
        if (session?.user) fetchProfile(session.user.id).finally(() => setLoading(false))
        else setLoading(false)
        if (session?.user) checkAutoPurge()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }
  const signOut = async () => {
    sessionStorage.removeItem('superuser_session')
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }
  const isSuperuser = profile?.role === 'superuser'
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superuser'
  const isStaff = profile?.role === 'staff' || profile?.role === 'admin' || profile?.role === 'superuser'
  const isViewer = profile?.role === 'viewer'
  const viewerPlates = profile?.viewer_plates || []

  // Module permission check
  // Superuser always has access. For others, check custom permissions first,
  // then fall back to role defaults.
  const STAFF_DEFAULTS = ['dashboard','trips','expenses','subcon','how_to','billing','paid_invoices']
  const ADMIN_DEFAULTS = ['dashboard','trips','expenses','subcon','how_to','billing','paid_invoices','orcr','reports','summary','yoy','cashflow','vouchers','cash_vouchers','payroll','loans','extra_income','historical','settings','trash','backup']
  const hasModule = (key) => {
    if (isSuperuser) return true
    if (!profile) return false
    if (key === 'my_account') return true
    // Viewer accounts are locked to their own read-only page — no dashboard,
    // no other module, regardless of any custom permissions on the profile.
    if (isViewer) return key === 'viewer_trips'
    // Dashboard is always accessible to all other logged-in users
    if (key === 'dashboard') return true
    const perms = profile.permissions
    if (perms && typeof perms === 'object' && Object.keys(perms).length > 0) return !!perms[key]
    // No custom permissions (null or empty) — use role defaults
    if (isAdmin) return ADMIN_DEFAULTS.includes(key)
    return STAFF_DEFAULTS.includes(key)
  }
  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, isSuperuser, isAdmin, isStaff, isViewer, viewerPlates, hasModule, refreshProfile: () => user && fetchProfile(user.id) }}>
      {children}
    </AuthContext.Provider>
  )
}
export const useAuth = () => useContext(AuthContext)
