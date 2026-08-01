import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../components/AuthContext'
import { supabase } from '../lib/supabase'

// Log login attempt to Supabase
async function logAttempt({ user_name, user_role, email, status }) {
  const ua = navigator.userAgent
  const browser = ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' :
    ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Unknown'
  const device = /Mobi|Android/i.test(ua) ? 'Mobile' : 'Desktop'
  try {
    await fetch(`${process.env.REACT_APP_SUPABASE_URL}/rest/v1/login_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.REACT_APP_SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ user_name, user_role, email: email || '', status, browser, device }),
    })
  } catch(e) { /* silent fail */ }
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [logoUrl, setLogoUrl] = useState(() => localStorage.getItem('ds_logo') || '')
  const [companyName, setCompanyName] = useState(localStorage.getItem('ds_company_name') || '')
  const [logoLoaded, setLogoLoaded] = useState(!!localStorage.getItem('ds_logo'))
  useEffect(() => {
    supabase.from('company_settings').select('logo_url,company_name').eq('id', 1).maybeSingle().then(({data}) => {
      if (data?.logo_url) {
        setLogoUrl(data.logo_url)
        setLogoLoaded(true)
        localStorage.setItem('ds_logo', data.logo_url)
      }
      if (data?.company_name) { setCompanyName(data.company_name); localStorage.setItem('ds_company_name', data.company_name) }
    })
  }, [])
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { signIn , profile} = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    // Check superuser FIRST before anything else
    const superName = process.env.REACT_APP_SUPERUSER_NAME
    const superHash = process.env.REACT_APP_SUPERUSER_HASH
    if (superName && superHash && email.trim().toLowerCase() === superName.toLowerCase()) {
      const msgBuffer = new TextEncoder().encode(password)
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      if (hashHex === superHash) {
        // Sign into real Supabase superuser account so RLS works
        // Uses the password the user typed — no hardcoded credentials in code
        // Always set sessionStorage first so AuthContext sees superuser role
        sessionStorage.setItem('superuser_session', JSON.stringify({
          id: 'superuser', full_name: 'Superuser', role: 'superuser',
          email: 'superuser@5gems.internal',
        }))
        // Sign into Supabase using the env var password so RLS works
        // Set REACT_APP_SUPERUSER_PW in Vercel environment variables
        const suPassword = process.env.REACT_APP_SUPERUSER_PW
        if (!suPassword) { setError('Superuser password not configured. Contact system administrator.'); setLoading(false); return }
        const { error: suErr } = await supabase.auth.signInWithPassword({
          email: 'superuser@5gems.internal',
          password: suPassword,
        })
        if (suErr) {
          console.warn('Supabase superuser auth warning:', suErr.message)
        }
        await logAttempt({ user_name: 'Superuser', user_role: 'superuser', email: 'superuser@5gems.internal', status: 'success' })
        window.location.href = '/dashboard'
        return
      } else {
        await logAttempt({ user_name: email.trim(), user_role: 'superuser', status: 'failed' })
        setError('Invalid superuser credentials.')
        setLoading(false)
        return
      }
    }

    // If input doesn't look like email, try to find user by name
    if (email && !email.includes('@')) {
      // Look up profile by full_name — try exact then partial match
      let foundEmail = null
      const { data: exact } = await supabase
        .from('profiles')
        .select('email, full_name')
        .ilike('full_name', email.trim())
        .limit(1)
      if (exact && exact.length > 0) {
        foundEmail = exact[0].email
      } else {
        // Try partial match in case they typed partial name
        const { data: partial } = await supabase
          .from('profiles')
          .select('email, full_name')
          .ilike('full_name', `%${email.trim()}%`)
          .limit(1)
        if (partial && partial.length > 0) foundEmail = partial[0].email
      }


      if (!foundEmail) {
        setError('No account found with that name.')
        setLoading(false)
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: foundEmail,
        password,
      })
      if (signInError) {
        await logAttempt({ user_name: email.trim(), user_role: 'unknown', status: 'failed' })
        setError('Invalid name or password.')
        setLoading(false)
        return
      }
      // Log success - fetch profile for role
      const { data: prof } = await supabase.from('profiles').select('full_name,role,email').eq('email', foundEmail).maybeSingle()
      await logAttempt({ user_name: prof?.full_name || email, user_role: prof?.role || 'staff', email: foundEmail, status: 'success' })
      window.location.href = prof?.role === 'viewer' ? '/my-trips' : '/dashboard'
      return
    }
    setError('')
    const err = await signIn(email, password)
    if (err) {
      await logAttempt({ user_name: email, user_role: 'unknown', email, status: 'failed' })
      setError('Invalid email or password. Please try again.')
      setLoading(false)
    } else {
      const { data: prof } = await supabase.from('profiles').select('full_name,role').eq('email', email).maybeSingle()
      await logAttempt({ user_name: prof?.full_name || email, user_role: prof?.role || 'staff', email, status: 'success' })
      window.location.href = prof?.role === 'viewer' ? '/my-trips' : '/dashboard'
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0f1f2e', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ margin: '0 auto 14px', maxWidth: 280 }}>
            {logoUrl
              ? <img src={logoUrl} alt="Logo" onLoad={() => setLogoLoaded(true)}
                  style={{ maxWidth: '100%', maxHeight: 100, objectFit: 'contain', opacity: logoLoaded ? 1 : 0, transition: 'opacity 0.3s ease', display: 'block', margin: '0 auto' }} />
              : <div style={{ width: 72, height: 72, background: 'rgba(255,255,255,0.1)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto' }}><span>🐉</span></div>}
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, color: '#fff', marginBottom: 4 }}>
            {companyName}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            Fleet Management System
          </div>
        </div>

        {/* Form */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: '28px 28px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 20, color: 'var(--text)' }}>
            Sign in to your account
          </h2>

          {error && (
            <div style={{
              background: 'var(--danger-light)', color: 'var(--danger)',
              padding: '10px 14px', borderRadius: 6, fontSize: 13,
              marginBottom: 16, border: '0.5px solid #e0a09a',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label className="label">Email or Name</label>
              <input
                type="text" value={email} required autoFocus
                onChange={e => setEmail(e.target.value)}
                placeholder="Email or full name"
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label className="label">Password</label>
              <input
                type="password" value={password} required
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}
              style={{ width: '100%', padding: '11px', fontSize: 14 }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 20 }}>
          {companyName} © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
