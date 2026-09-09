import React, { useState, useCallback } from 'react'
import { RemainingCreditsCard } from './RemainingCreditsCard'

/**
 * OpenRouter login panel inside the OpenRouter provider toggle.
 * English only. No manual base URL, no manual API key field, no Ollama data.
 * - Not connected: "Login with OpenRouter" button (OAuth PKCE, browser + loopback).
 * - Connected: "Connected" + Logout.
 * - Usage section (when connected): "Remaining credits" + top-right two buttons:
 *   refresh (rotella) and open in separate window (freccetta).
 */
export function OpenRouterPanel(props: {
  call: (method: string, params?: any, timeoutMs?: number) => Promise<any>
  onOpenWindow?: () => void
}) {
  const { call, onOpenWindow } = props
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [hLogin, setHLogin] = useState(false)
  const [hLogout, setHLogout] = useState(false)
  const [hCredit, setHCredit] = useState(false)
  const [hRefresh, setHRefresh] = useState(false)
  const [hWindow, setHWindow] = useState(false)

  const check = useCallback(async () => {
    try {
      const cfg: any = await call('getProvidersConfig', {})
      const keySet = cfg?.providers?.OpenRouter?.apiKeySet === true || !!cfg?.providers?.OpenRouter?.apiKey
      setConnected(!!keySet)
      if (keySet) {
        const u: any = await call('getProviderUsage', { providerName: 'OpenRouter' }).catch(() => null)
        if (u?.ok && u?.credits && typeof u.credits.total_credits === 'number') setCredits(u.credits.total_credits)
        else setCredits(null)
      } else {
        setCredits(null)
      }
    } catch {}
  }, [call])

  React.useEffect(() => { check(); const t = setInterval(check, 15000); return () => clearInterval(t) }, [check])

  const doLogin = async () => {
    setBusy(true); setErr('')
    try {
      const r: any = await call('openRouterLogin', {}, 310000)
      if (r?.success) await check()
      else setErr(String(r?.error || 'Login failed'))
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const doLogout = async () => {
    setBusy(true)
    try { await call('openRouterLogout', {}); await check() } catch {}
    setBusy(false)
  }

  const label = { color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '2px' } as any
  const val = { color: 'var(--q-text)', fontSize: '15px', fontFamily: 'var(--font-interface)', fontWeight: 600 } as any
  const card = { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', padding: '10px 12px' } as any
  const iconBtn = (hover: boolean) => ({
    background: hover ? 'rgba(255,255,255,0.06)' : 'transparent',
    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '5px',
    color: 'var(--q-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
  } as any)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Account status + login/logout */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={label}>OpenRouter account</div>
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
            >{busy ? 'Opening browser...' : 'Login'}</button>
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

      {/* Usage: shared Remaining credits card (same graphics as the standalone window) */}
      {connected === true && <RemainingCreditsCard call={call} showOpenWindow={true} />}

      {err && <div style={{ ...label, color: 'var(--q-accent-danger)' }}>{err}</div>}
    </div>
  )
}