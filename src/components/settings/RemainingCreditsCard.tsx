import React, { useState, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RefreshCw, Maximize, Pin } from '../icons'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * "Remaining credits OpenRouter" content, shared by the provider toggle (card
 * variant, with border) and the standalone usage window (window variant: same
 * graphics, no contour, fills the window). No separator line between label and
 * value. Remaining = total_credits - total_usage (current balance).
 * Polls every 60s ONLY while actually visible on screen (IntersectionObserver
 * + document visibility), so hidden UI never burns RPCs.
 */
export function RemainingCreditsContent(props: {
  call: (method: string, params?: any, timeoutMs?: number) => Promise<any>
  showOpenWindow?: boolean
  variant?: 'card' | 'window'
}) {
  const { call, showOpenWindow, variant = 'card' } = props
  const [credits, setCredits] = useState<number | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [hRefresh, setHRefresh] = useState(false)
  const [hWindow, setHWindow] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [hPin, setHPin] = useState(false)
  const [hCredit, setHCredit] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const visibleRef = useRef(false)

  const check = useCallback(async () => {
    try {
      const cfg: any = await call('getProvidersConfig', {})
      const keySet = cfg?.providers?.OpenRouter?.apiKeySet === true || !!cfg?.providers?.OpenRouter?.apiKey
      setConnected(!!keySet)
      if (keySet) {
        const u: any = await call('getProviderUsage', { providerName: 'OpenRouter' }).catch(() => null)
        const c = u?.ok ? u?.credits : null
        if (c && typeof c.total_credits === 'number' && typeof c.total_usage === 'number') {
          setCredits(Math.round((c.total_credits - c.total_usage) * 100) / 100)
        } else setCredits(null)
      } else setCredits(null)
    } catch {}
  }, [call])

  React.useEffect(() => {
    // refresh subito se visibile, poi ogni minuto SOLO se visibile
    const el = rootRef.current
    let io: IntersectionObserver | null = null
    const isOnScreen = () => visibleRef.current && document.visibilityState === 'visible'
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        visibleRef.current = entries.some((e) => e.isIntersecting)
        if (isOnScreen()) check()
      }, { threshold: 0.05 })
      io.observe(el)
    } else {
      visibleRef.current = true
    }
    if (isOnScreen() || !io) check()
    const onVis = () => { if (document.visibilityState === 'visible' && visibleRef.current) check() }
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(() => { if (isOnScreen()) check() }, 60000)
    return () => { if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVis); clearInterval(t) }
  }, [check])

  const isWindow = variant === 'window'
  const label = { color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } as any
  const val = { color: 'var(--q-text)', fontSize: '15px', fontFamily: 'var(--font-interface)', fontWeight: 600 } as any
  const iconBtn = (hover: boolean) => ({
    background: hover ? 'rgba(255,255,255,0.06)' : 'transparent',
    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '5px',
    color: 'var(--q-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
  } as any)
  const addBtn = (hover: boolean) => ({
    padding: '5px 12px', fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 600,
    color: hover ? 'var(--q-bg)' : 'var(--q-tab-accent)',
    backgroundColor: hover ? 'var(--q-tab-accent)' : 'transparent',
    border: '1px solid var(--q-tab-accent)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  } as any)
  const openCredits = () => { try { invoke('open_url', { url: 'https://openrouter.ai/settings/credits' }).catch(() => {}) } catch {} }

  // window variant: no contour, fills the window, bottom row pinned to the bottom
  const outer: any = isWindow
    ? { width: '100%', padding: '16px', paddingTop: '8px', boxSizing: 'border-box' }
    : { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', padding: '10px 12px' }

  return (
    <div ref={rootRef} style={outer}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={label}>Remaining credits OpenRouter</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {isWindow && (
            <button
              onClick={() => {
                const v = !pinned
                setPinned(v)
                try { getCurrentWindow().setAlwaysOnTop(v).catch(() => {}) } catch {}
              }}
              onMouseEnter={() => setHPin(true)}
              onMouseLeave={() => setHPin(false)}
              title={pinned ? 'Unpin (not always on top)' : 'Pin (always on top)'}
              style={{ ...iconBtn(hPin), color: pinned ? 'var(--q-tab-accent)' : 'var(--q-text-secondary)' }}
            ><Pin size={15} /></button>
          )}
          <button
            onClick={check}
            onMouseEnter={() => setHRefresh(true)}
            onMouseLeave={() => setHRefresh(false)}
            title="Refresh"
            style={iconBtn(hRefresh)}
          ><RefreshCw size={15} /></button>
          {!isWindow && showOpenWindow && (
            <button
              onClick={() => { try { invoke('open_in_new_window', { tab: 'usage' }).catch(() => {}) } catch {} }}
              onMouseEnter={() => setHWindow(true)}
              onMouseLeave={() => setHWindow(false)}
              title="Open in separate window"
              style={iconBtn(hWindow)}
            ><Maximize size={15} /></button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '12px' }}>
        <div style={val}>
          {connected === true ? (credits !== null ? `$${credits.toFixed(2)}` : '...') : connected === null ? '...' : 'Not connected'}
        </div>
        {connected === true && (
          <button
            onClick={openCredits}
            onMouseEnter={() => setHCredit(true)}
            onMouseLeave={() => setHCredit(false)}
            style={addBtn(hCredit)}
          >Add credits</button>
        )}
      </div>
    </div>
  )
}

/** Card variant (provider toggle): bordered elevated box. */
export function RemainingCreditsCard(props: {
  call: (method: string, params?: any, timeoutMs?: number) => Promise<any>
  showOpenWindow?: boolean
}) {
  return <RemainingCreditsContent {...props} variant="card" />
}
