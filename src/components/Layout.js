import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'
import GlobalSearch from './GlobalSearch'

// Nav grouped by category
const NAV_OPERATIONS = [
  { path: '/dashboard', label: 'Dashboard', icon: '🏠', moduleKey: 'dashboard' },
  { path: '/trips', label: 'Trip Entry', icon: '🚛', moduleKey: 'trips' },
  { path: '/billing', label: 'Billing & SOA', icon: '🧾', moduleKey: 'billing' },
  { path: '/paid-invoices', label: 'Paid Invoices', icon: '✅', moduleKey: 'paid_invoices' },
  { path: '/subcon-trips', label: 'Sub-con Trips', icon: '🤝', moduleKey: 'subcon' },
  { path: '/orcr', label: 'OR/CR Tracking', icon: '🚗', adminOnly: true, moduleKey: 'orcr' },
  { path: '/expenses', label: 'Expenses', icon: '💸', moduleKey: 'expenses' },
]

const NAV_FINANCE = [
  { path: '/reports', label: 'Reports', icon: '📊', moduleKey: 'reports' },
  { path: '/midyear-report', label: 'Midyear Report', icon: '📋', moduleKey: 'reports' },
  { path: '/summary', label: 'Overall Summary', icon: '📋', moduleKey: 'summary' },
  { path: '/year-over-year', label: 'Year-over-Year', icon: '📈', moduleKey: 'yoy' },
  { path: '/cashflow', label: 'Cashflow', icon: '💰', moduleKey: 'cashflow' },
  { path: '/vouchers', label: 'Check Vouchers', icon: '🖨️', moduleKey: 'vouchers' },
  { path: '/payroll', label: 'Payroll', icon: '💼', moduleKey: 'payroll' },
  { path: '/loans', label: 'Loans', icon: '🏦', moduleKey: 'loans' },
  { path: '/extra-income', label: 'Extra Income', icon: '💹', moduleKey: 'extra_income' },
  { path: '/cash-vouchers', label: 'Cash Vouchers', icon: '💵', moduleKey: 'cash_vouchers' },
  { path: '/historical', label: 'Historical Data', icon: '📅', moduleKey: 'historical' },
]

const NAV_SYSTEM = [
  { path: '/how-to', label: 'How-To Guide', icon: '📖', moduleKey: 'how_to' },
  { path: '/settings', label: 'Settings', icon: '⚙️', moduleKey: 'settings' },
  { path: '/backup', label: 'DB Backup', icon: '💾', moduleKey: 'backup' },
  { path: '/trash', label: 'Trash', icon: '🗑️', moduleKey: 'trash' },
  { path: '/print-layouts', label: 'Print Layouts', icon: '🖨️', superuserOnly: true },
  { path: '/users', label: 'Manage Users', icon: '👥' },
  { path: '/activity', label: 'Activity Feed', icon: '📡' },
  { path: '/logs', label: 'Activity Logs', icon: '📋' },
]

// Keep for compatibility
const NAV_STAFF = NAV_OPERATIONS
const NAV_ADMIN = NAV_FINANCE
const NAV_SUPERUSER = []

export default function Layout({ children }) {
  const { profile, signOut, isAdmin, isSuperuser, isViewer, hasModule } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [appSettings, setAppSettings] = useState({ app_version: '1.0', app_beta: true, app_beta_label: 'BETA — Testing Phase' })
  const [companyName, setCompanyName] = useState(localStorage.getItem('ds_company_name') || '')
  const [navLogo, setNavLogo] = useState(() => {
    // Try localStorage first for instant load
    return localStorage.getItem('ds_logo') || ''
  })

  useEffect(() => {
    // Also fetch from DB to stay in sync
    supabase.from('company_settings').select('logo_url,company_name').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data?.logo_url) { setNavLogo(data.logo_url); localStorage.setItem('ds_logo', data.logo_url) }
        if (data?.company_name) { setCompanyName(data.company_name); localStorage.setItem('ds_company_name', data.company_name) }
      })
  }, [])
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark')

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode)
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    supabase.from('company_settings').select('app_version,app_beta,app_beta_label').eq('id',1).maybeSingle().then(({data}) => { if (data) setAppSettings(s=>({...s,...data})) })
  }, [])

  // Auto-logout when tab/window closes
  useEffect(() => {
    const handleUnload = () => { supabase.auth.signOut() }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  const handleSignOut = async () => { await signOut(); navigate('/login') }

  // Global "/" shortcut to open search — ignored when typing in inputs/textareas/selects
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '/' && !searchOpen) {
        const tag = document.activeElement?.tagName
        const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable
        if (!isEditable) { e.preventDefault(); setSearchOpen(true) }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchOpen])

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar spacer for desktop layout */}
      <div className="desktop-sidebar-spacer" style={{ display: 'none', width: 'var(--sidebar-width)', flexShrink: 0 }} />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150,
        }} />
      )}

      {/* Sidebar */}
      <aside className="app-sidebar" style={{
        width: 'var(--sidebar-width)',
        background: '#1a1a1a',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 200,
        transform: sidebarOpen ? 'translateX(0)' : undefined,
        transition: 'transform 0.25s ease',
        overflowY: 'auto',
      }}>
        {/* Logo / Brand */}
        <div style={{ padding: '16px 18px 14px', borderBottom: '0.5px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {navLogo
                ? <img src={navLogo} alt="Company logo" style={{ height: 36, maxWidth: 180, objectFit: 'contain', objectPosition: 'left center' }} onError={() => setNavLogo('')} />
                : <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, background: 'var(--accent)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🚚</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '.04em', textTransform: 'uppercase' }}>FMS</div>
                  </div>
              }
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '.03em', textTransform: 'uppercase', lineHeight: 1.3, marginTop: 4 }}>{companyName}</div>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="mobile-close-btn" style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer', fontSize: 18, padding: 4,
          }}>✕</button>
        </div>

        {/* Global search trigger */}
        <div style={{ padding: '10px 12px 4px' }}>
          <button onClick={() => setSearchOpen(true)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '8px 10px', color: 'rgba(255,255,255,0.6)',
            fontSize: 12, cursor: 'pointer', textAlign: 'left',
          }}>
            <span>🔍</span><span style={{ flex: 1 }}>Search…</span>
            <kbd style={{ fontSize: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '1px 5px' }}>/</kbd>
          </button>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Operations — all users */}
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '8px 8px 4px' }}>{isViewer ? 'My Account' : 'Operations'}</div>
          {isViewer ? (
            <NavItem item={{ path: '/my-trips', label: 'My Trips', icon: '🚛' }} active={location.pathname === '/my-trips'} onNav={() => setSidebarOpen(false)} />
          ) : (
            NAV_OPERATIONS.filter(item => (!item.adminOnly || isAdmin) && hasModule(item.moduleKey || 'dashboard')).map(item => (
              <NavItem key={item.path} item={item} active={location.pathname === item.path} onNav={() => setSidebarOpen(false)} />
            ))
          )}

          {/* Finance — admin + superuser */}
          {isAdmin && (<>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '14px 8px 4px' }}>Finance & Reports</div>
            {NAV_FINANCE.filter(item => isAdmin && hasModule(item.moduleKey || 'reports')).map(item => (
              <NavItem key={item.path} item={item} active={location.pathname === item.path} onNav={() => setSidebarOpen(false)} />
            ))}
          </>)}

          {/* My Account for staff — shown in simple system area */}
          {!isAdmin && <>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '14px 8px 4px', borderTop: '0.5px solid rgba(255,255,255,0.06)', marginTop: 8 }}>Account</div>
            <NavItem item={{ path: '/my-account', label: 'My Account', icon: '👤' }} active={location.pathname === '/my-account'} onNav={() => setSidebarOpen(false)} />
          </>}

          {/* Spacer to push system to bottom */}
          <div style={{ flex: 1 }} />

          {/* System — bottom, admin + superuser */}
          {isAdmin && (<>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '14px 8px 4px', borderTop: '0.5px solid rgba(255,255,255,0.06)', marginTop: 8 }}>System</div>
            <NavItem item={{ path: '/my-account', label: 'My Account', icon: '👤' }} active={location.pathname === '/my-account'} onNav={() => setSidebarOpen(false)} />
            {NAV_SYSTEM.filter(item => {
              if (item.path === '/users' || item.path === '/logs') return isSuperuser
              if (item.path === '/activity') return isAdmin || isSuperuser
              if (item.path === '/print-layouts') return isSuperuser
              return true
            }).filter(item => !item.superuserOnly || isSuperuser)
              .filter(item => !item.moduleKey || hasModule(item.moduleKey))
              .map(item => (
              <NavItem key={item.path} item={item} active={location.pathname === item.path} onNav={() => setSidebarOpen(false)} />
            ))}
          </>)}


        </nav>

        {/* Mobile bottom nav */}
      <nav style={{ display: 'none' }} className="mobile-bottom-nav">
        {[
          { path: '/', icon: '🏠', label: 'Home' },
          { path: '/trips', icon: '🚛', label: 'Trips' },
          { path: '/billing', icon: '📄', label: 'Billing' },
          { path: '/reports', icon: '📊', label: 'Reports' },
          { path: '/expenses', icon: '💰', label: 'Expenses' },
        ].map(item => (
          <a key={item.path} href={item.path}
            onClick={e => { e.preventDefault(); navigate(item.path) }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '6px 0', flex: 1, textDecoration: 'none',
              color: location.pathname === item.path ? 'var(--accent)' : 'var(--muted)',
              fontSize: 10, fontWeight: location.pathname === item.path ? 600 : 400
            }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            {item.label}
          </a>
        ))}
      </nav>

      {/* About / Version */}
        <button onClick={() => setShowAbout(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, borderTop: '0.5px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontSize: 11 }}>ℹ️</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '.04em' }}>FMS v{appSettings.app_version} · 2026</span>
        </button>

        {/* User footer */}
        <div style={{ padding: '12px 14px', borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 1 }}>
            {profile?.role === 'superuser' ? '⚡ Superuser' : profile?.role === 'admin' ? '🔑 Admin' : '👤 Staff'}
          </div>
          <div style={{ fontSize: 12, color: '#fff', marginBottom: 8, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profile?.full_name || profile?.email || profile?.username || 'User'}
          </div>
          <button onClick={() => setDarkMode(d => !d)} style={{
            width: '100%',
            background: 'rgba(255,255,255,0.06)',
            border: '0.5px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.6)',
            padding: '6px 0',
            borderRadius: 6,
            fontSize: 12,
            cursor: 'pointer',
            marginBottom: 6,
            fontWeight: 400,
          }}>{darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
          {appSettings.app_beta && (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginBottom: 6, letterSpacing: '0.05em' }}>
              {appSettings.app_beta_label || 'BETA — Testing Phase'}
            </div>
          )}
          <button onClick={handleSignOut} style={{
            width: '100%',
            background: 'rgba(255,30,0,0.15)',
            border: '0.5px solid rgba(255,30,0,0.3)',
            color: 'var(--accent)',
            padding: '6px 0',
            borderRadius: 6,
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 500,
          }}>Sign out</button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content" style={{ flex: 1, minHeight: '100vh', background: 'var(--bg)' }}>
        {/* Mobile top bar */}
        <div className="mobile-topbar" style={{
          display: 'none',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: '#1a1a1a',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <button onClick={() => setSidebarOpen(true)} style={{
            background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '0 2px', lineHeight: 1,
          }}>☰</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }}>
            {navLogo
              ? <img src={navLogo} alt="Logo" style={{ maxHeight: 28, maxWidth: 140, objectFit: 'contain', objectPosition: 'left center' }} onError={() => setNavLogo('')} />
              : <>
                  <div style={{ width: 24, height: 24, background: 'var(--accent)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>🐉</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{companyName}</span>
                </>
            }
          </div>
          {/* Search icon for mobile */}
          <button onClick={() => setSearchOpen(true)} style={{
            background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', padding: '0 4px',
          }}>🔍</button>

          {/* Dark mode toggle in topbar for mobile */}
          <button onClick={() => setDarkMode(d => !d)} style={{
            background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', padding: '0 4px',
          }}>{darkMode ? '☀️' : '🌙'}</button>
        </div>

        {children}
      </main>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <style>{`
        @media (min-width: 768px) {
          .desktop-sidebar-spacer { display: block !important; }
          .mobile-topbar { display: none !important; }
          .mobile-close-btn { display: none !important; }
          .app-sidebar { transform: translateX(0) !important; }
        }
        @media (max-width: 767px) {
          .desktop-sidebar-spacer { display: none !important; }
          .mobile-topbar { display: flex !important; }
          .app-sidebar { transform: translateX(-100%); }
          .app-sidebar.open { transform: translateX(0); }
        }
      `}</style>

      {/* About Modal */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380, textAlign: 'center' }}>
            <div style={{ marginBottom: 20 }}>
              {navLogo
                ? <img src={navLogo} alt="Logo" style={{ maxHeight: 60, maxWidth: 200, objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} />
                : <div style={{ fontSize: 36, marginBottom: 12 }}>🐉</div>
              }
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>Fleet Management System</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Version {appSettings.app_version} — 2026{appSettings.app_beta ? ' · ' + (appSettings.app_beta_label||'BETA') : ''}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{companyName}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--hint)', marginBottom: 4 }}>Developed by</div>
                <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>Kenneth Nomar</div>
                <div style={{ fontSize: 12 }}>Administrative Officer</div>
                <div style={{ fontSize: 11, color: 'var(--hint)' }}>System Owner & Project Lead</div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--hint)', marginBottom: 4 }}>Built with</div>
                <div>React · Supabase · Vercel</div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--hint)', marginBottom: 4 }}>AI Development Partner</div>
                <div>Claude (Anthropic)</div>
              </div>
              <div style={{ fontStyle: 'italic', color: 'var(--accent)', fontWeight: 500, borderTop: '0.5px solid var(--border)', paddingTop: 12 }}>
                "Your Business. Our Passion."
              </div>
            </div>
            <button className="btn-ghost" onClick={() => setShowAbout(false)} style={{ width: '100%', marginTop: 16 }}>Close</button>
          </div>
        </div>
      )}

    </div>
  )
}

function NavItem({ item, active, onNav }) {
  return (
    <Link to={item.path} style={{ textDecoration: 'none' }} onClick={onNav}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 10px',
        borderRadius: 7,
        marginBottom: 2,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.5)',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        transition: 'all 0.12s',
      }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
        <span>{item.label}</span>
      </div>
    </Link>
  )
}
