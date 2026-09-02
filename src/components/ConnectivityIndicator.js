import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Two independent checks, deliberately kept separate: "internet is fine but
// the server is slow" and "internet itself is the problem" are different
// situations worth telling apart, not one blended status.
const CHECK_INTERVAL_MS = 20000
const SLOW_THRESHOLD_MS = 1500

function useConnectivity() {
  const [internetStatus, setInternetStatus] = useState('checking') // 'good' | 'slow' | 'down' | 'checking'
  const [serverStatus, setServerStatus] = useState('checking')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const checkInternet = async () => {
      const start = Date.now()
      try {
        // Ping the app's own hosting (same origin) — independent of Supabase,
        // so this reflects internet/hosting reachability specifically.
        await fetch(`${window.location.origin}/manifest.json?_=${start}`, { cache: 'no-store', method: 'HEAD' })
        const elapsed = Date.now() - start
        if (mountedRef.current) setInternetStatus(elapsed > SLOW_THRESHOLD_MS ? 'slow' : 'good')
      } catch {
        if (mountedRef.current) setInternetStatus('down')
      }
    }

    const checkServer = async () => {
      const start = Date.now()
      try {
        const { error } = await supabase.from('company_settings').select('id', { head: true, count: 'exact' }).eq('id', 1)
        const elapsed = Date.now() - start
        if (mountedRef.current) setServerStatus(error ? 'down' : (elapsed > SLOW_THRESHOLD_MS ? 'slow' : 'good'))
      } catch {
        if (mountedRef.current) setServerStatus('down')
      }
    }

    const runChecks = () => { checkInternet(); checkServer() }
    runChecks()
    const interval = setInterval(runChecks, CHECK_INTERVAL_MS)

    return () => { mountedRef.current = false; clearInterval(interval) }
  }, [])

  return { internetStatus, serverStatus }
}

const STATUS_COLOR = { good: '#22c55e', slow: '#eab308', down: '#ef4444', checking: '#9ca3af' }
const STATUS_LABEL = { good: 'Good', slow: 'Slow', down: 'Down', checking: 'Checking…' }

function SignalDot({ status }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: STATUS_COLOR[status] || STATUS_COLOR.checking,
      flexShrink: 0,
    }} />
  )
}

function IndicatorRow({ label, status }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap' }}>
      <SignalDot status={status} />
      <span>{label}: {STATUS_LABEL[status] || STATUS_LABEL.checking}</span>
    </div>
  )
}

// mode="inline": plain flex row, for embedding inside an existing topbar (mobile).
// mode="floating" (default): self-contained fixed-position pill, works
// standalone anywhere — including the Login page, which has no topbar to
// embed into at all.
export default function ConnectivityIndicator({ mode = 'floating' }) {
  const { internetStatus, serverStatus } = useConnectivity()

  if (mode === 'inline') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 4px' }}>
        <IndicatorRow label="Net" status={internetStatus} />
        <IndicatorRow label="Server" status={serverStatus} />
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', top: 12, right: 16, zIndex: 90,
      background: 'rgba(26,26,26,0.9)', borderRadius: 8, padding: '6px 10px',
      display: 'flex', flexDirection: 'column', gap: 3,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <IndicatorRow label="Internet" status={internetStatus} />
      <IndicatorRow label="Server" status={serverStatus} />
    </div>
  )
}
