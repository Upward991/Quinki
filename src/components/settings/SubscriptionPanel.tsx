import React, { useState, useCallback } from 'react'

/**
 * Subscription OAuth provider panel (Anthropic, OpenAI, GitHub Copilot, xAI).
 * IDENTICAL structure to OpenRouterPanel: card with "{Name} account" label
 * on the left, Sign in / Logout button on the right. Description below.
 */
export function SubscriptionPanel(props: {
  call: (method: string, params?: any, timeoutMs?: number) => Promise<any>
  providerId: string
  displayName: string          // "OpenAI (ChatGPT)" | "Anthropic (Claude)" | ...
  description: string
}) {
  const { call, providerId, displayName, description } = props
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [err, setErr] = useState('')
  const [hLogin, setHLogin] = useState(false)
  const [hLogout, setHLogout] = useState(false)

  const check = useCallback(async () => {
    try {
      const st: any = await call('subscriptionStatus', { providerId })
      setConnected(!!st?.connected)
    } catch {
      setConnected(false)
    }
  }, [call, providerId])

  React.useEffect(() => { check(); const t = setInterval(check, 15000); return () => clearInterval(t) }, [check])

  const doLogin = async () => {
    setBusy(true); setErr('')
    try {
      const r: any = await call('subscriptionLogin', { providerId }, 330000)
      if (r?.success) await check()
      else setErr(String(r?.error || 'Login failed'))
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
    setBusy(false)
  }

  const doLogout = async () => {
    setBusy(true)
    try { await call('subscriptionLogout', { providerId }); await check() } catch {}
    setBusy(false)
  }

  // EXACT same style as OpenRouterPanel
  const label = { color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '2px' } as any
  const card = { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', padding: '10px 12px' } as any

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Account status + sign in/logout — IDENTICAL to OpenRouterPanel */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={label}>{displayName} account</div>
          {connected === false && (
            <button
              onClick={doLogin}
              disabled={busy}
              onMouseEnter={() => setHLogin(true)}
              onMouseLeave={() => setHLogin(false)}
              style={{
                padding: '5px 12px', fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 600,
                color: hLogin ? 'var(--q-bg)' : 'var(--q-tab-accent)',
                backgroundColor: hLogin ? 'var(--q-tab-accent)' : 'transparent',
                border: '1px solid var(--q-tab-accent)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', flexShrink: 0,
              }}
            >{busy ? 'Opening browser...' : 'Sign in'}</button>
          )}
          {connected === true && (
            <button
              onClick={doLogout}
              disabled={busy}
              onMouseEnter={() => setHLogout(true)}
              onMouseLeave={() => setHLogout(false)}
              style={{
                padding: '5px 12px', fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 600,
                color: hLogout ? 'var(--q-bg)' : 'var(--q-accent-danger)',
                backgroundColor: hLogout ? 'var(--q-accent-danger)' : 'transparent',
                border: '1px solid var(--q-accent-danger)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', flexShrink: 0,
              }}
            >Logout</button>
          )}
          {connected === null && <div style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>...</div>}
        </div>
      </div>

      {/* Description (approved by user) */}
      <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5 }}>
        {description}
      </div>

      {/* Error — same style as OpenRouterPanel */}
      {err && <div style={{ ...label, color: 'var(--q-accent-danger)' }}>{err}</div>}
    </div>
  )
}