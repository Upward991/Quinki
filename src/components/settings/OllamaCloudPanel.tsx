import React, { useState, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RefreshCw, Maximize, Download, Pin } from '../icons'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Ollama account + cloud usage, Option A layout: one usage card, NO separator
 * lines. Session/weekly usage with percentage bars and reset countdowns
 * ("(estimated)" until an actual reset is observed), extra usage in dollars,
 * bullet-list ranking of models by request count, "Open ollama.com/settings"
 * button. Same window/pin behavior as OpenRouter (freccetta + win-usage).
 */

function fmtCountdown(sec: number) {
  if (sec <= 0) return 'resetting...'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
const fmtPct = (u: number) => `${Math.round(u * 1000) / 10}%`

/** Usage-only card (shared between the provider toggle and the usage window). */
export function OllamaUsageCard(props: {
  call: (method: string, params?: any, timeoutMs?: number) => Promise<any>
  showOpenWindow?: boolean
  variant?: 'card' | 'window'
}) {
  const { call, showOpenWindow, variant = 'card' } = props
  const isWindow = variant === 'window'
  const [usage, setUsage] = useState<any>(null)
  const [err, setErr] = useState('')
  const [hRefresh, setHRefresh] = useState(false)
  const [hSettings, setHSettings] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [hPin, setHPin] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const visibleRef = useRef(false)

  const check = useCallback(async () => {
    try {
      const u: any = await call('getOllamaCloudUsage', {}).catch(() => null)
      if (u?.ok) { setUsage(u); setErr('') } else setErr(String(u?.error || ''))
    } catch {}
  }, [call])

  React.useEffect(() => {
    const el = rootRef.current
    let io: IntersectionObserver | null = null
    const isOnScreen = () => visibleRef.current && document.visibilityState === 'visible'
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        visibleRef.current = entries.some((e) => e.isIntersecting)
        if (isOnScreen()) check()
      }, { threshold: 0.05 })
      io.observe(el)
    } else visibleRef.current = true
    check()
    const t = setInterval(() => { if (isOnScreen()) check() }, 60000)
    return () => { if (io) io.disconnect(); clearInterval(t) }
  }, [check])

  const label = { color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } as any
  const val = { color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 600 } as any
  const iconBtn = (hover: boolean) => ({
    background: hover ? 'rgba(255,255,255,0.06)' : 'transparent',
    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '5px',
    color: 'var(--q-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
  } as any)
  const settingsBtn = (hover: boolean) => ({
    padding: '5px 12px', fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 600,
    color: hover ? 'var(--q-bg)' : 'var(--q-tab-accent)',
    backgroundColor: hover ? 'var(--q-tab-accent)' : 'transparent',
    border: '1px solid var(--q-tab-accent)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', textDecoration: 'none',
  } as any)
  const bar = (u: number) => {
    const pct = Math.max(0, Math.min(1, u)) * 100
    const color = pct > 90 ? 'var(--q-accent-danger)' : 'var(--q-tab-accent)'
    return (
      <div style={{ flex: 1, height: '5px', borderRadius: '3px', backgroundColor: 'var(--q-border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: '3px', backgroundColor: color }} />
      </div>
    )
  }
  const ranking = (models: any[]) => [...(models || [])].sort((a, b) => (b.request_count || 0) - (a.request_count || 0))

  return (
    <div ref={rootRef} style={isWindow ? { width: '100%', padding: '16px', paddingTop: '8px', boxSizing: 'border-box' } : { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ ...label, fontSize: '12px', fontWeight: 600 }}>Ollama usage</div>
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
          <button onClick={check} onMouseEnter={() => setHRefresh(true)} onMouseLeave={() => setHRefresh(false)} title="Refresh" style={iconBtn(hRefresh)}><RefreshCw size={15} /></button>
          {!isWindow && showOpenWindow && (
            <button onClick={() => { try { invoke('open_in_new_window', { tab: 'usage-ollama' }).catch(() => {}) } catch {} }} title="Open in separate window" style={iconBtn(false)}><Maximize size={15} /></button>
          )}
        </div>
      </div>

      {/* Session */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
        <div style={{ ...label, width: '52px', flexShrink: 0, fontSize: '12px' }}>Session</div>
        {bar(usage?.session?.usage || 0)}
        <div style={{ ...val, width: '48px', textAlign: 'right', flexShrink: 0 }}>{usage ? fmtPct(usage.session?.usage || 0) : '...'}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
        {usage && <div style={{ ...label, fontSize: '11px' }}>resets in {fmtCountdown(usage.session?.resetInSec || 0)}{usage.session?.estimated ? ' (estimated)' : ''}</div>}
      </div>

      {/* Weekly */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
        <div style={{ ...label, width: '52px', flexShrink: 0, fontSize: '12px' }}>Weekly</div>
        {bar(usage?.weekly?.usage || 0)}
        <div style={{ ...val, width: '48px', textAlign: 'right', flexShrink: 0, color: usage && (usage.weekly?.usage || 0) > 0.9 ? 'var(--q-accent-danger)' : 'var(--q-text)' }}>{usage ? fmtPct(usage.weekly?.usage || 0) : '...'}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
        {usage && <div style={{ ...label, fontSize: '11px' }}>resets in {fmtCountdown(usage.weekly?.resetInSec || 0)}{usage.weekly?.estimated ? ' (estimated)' : ''}</div>}
      </div>

      {/* Extra usage */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
        <div style={{ ...label, fontSize: '12px' }}>Extra usage</div>
        <div style={val}>{usage?.activity?.cost !== undefined ? `$${Number(usage.activity.cost || 0).toFixed(2)}` : '...'}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '10px' }}>
        <div style={{ ...label, fontSize: '11px', flex: 1 }}>To see more details and top up your credit, go to ollama settings</div>
        <a href="https://ollama.com/settings" onClick={(e) => { e.preventDefault(); try { invoke('open_url', { url: 'https://ollama.com/settings' }).catch(() => {}) } catch {} }}
          onMouseEnter={() => setHSettings(true)} onMouseLeave={() => setHSettings(false)}
          style={settingsBtn(hSettings)}
        >Open ollama.com/settings</a>
      </div>

      {err && err !== 'no_key' && <div style={{ ...label, color: 'var(--q-accent-danger)', marginTop: '6px' }}>{err}</div>}
    </div>
  )
}

/** Account card + usage, for the provider toggle. */
export function OllamaCloudPanel(props: {
  call: (method: string, params?: any, timeoutMs?: number) => Promise<any>,
  refreshProviders?: (models: any[]) => void,
  onRefreshAll?: () => any
}) {
  const { call, refreshProviders, onRefreshAll } = props
  const [keySet, setKeySet] = useState<boolean | null>(null)
  const [inputKey, setInputKey] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [installStatus, setInstallStatus] = useState('idle')
  const [err, setErr] = useState('')
  const [hInstall, setHInstall] = useState(false)
  const [hLogin, setHLogin] = useState(false)
  const [hLogout, setHLogout] = useState(false)
  const [hSave, setHSave] = useState(false)
  const [hCancel, setHCancel] = useState(false)
  const [installVersion, setInstallVersion] = useState('')
  const [installPct, setInstallPct] = useState(0)
  const [installMb, setInstallMb] = useState(0)
  const [installTotalMb, setInstallTotalMb] = useState(0)
  const [installErrMsg, setInstallErrMsg] = useState('')
  const [hModalInstall, setHModalInstall] = useState(false)
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [remoteHost, setRemoteHost] = useState('')
  const [remoteActive, setRemoteActive] = useState(false)
  const [remoteMsg, setRemoteMsg] = useState('')
  const [remoteErr, setRemoteErr] = useState('')
  const [hRemote, setHRemote] = useState(false)
  const [hRevert, setHRevert] = useState(false)

  const check = useCallback(async () => {
    try {
      const st: any = await call('ollamaCloudStatus', {}).catch(() => null)
      setKeySet(!!st?.set)
      const inst: any = await call('ollamaInstalled', {}).catch(() => null)
      setInstalled(!!inst?.installed)
      setInstallVersion(String(inst?.version || ''))
      const is: any = await call('ollamaInstallStatus', {}).catch(() => null)
      setInstallStatus(String(is?.status || 'idle'))
      setInstallPct(Number(is?.pct || 0))
      setInstallMb(Number(is?.mb || 0))
      setInstallTotalMb(Number(is?.totalMb || 0))
      setInstallErrMsg(String(is?.error || ''))
      const pc: any = await call('getProvidersConfig', {}).catch(() => null)
      const ob = pc?.providers?.Ollama?.baseUrl || ''
      const hostOnly = ob.replace(/\/v1\/?$/, '')
      const isLocalHost = /localhost|127\.0\.0\.1/.test(hostOnly)
      setRemoteActive(!!hostOnly && !isLocalHost)
      if (hostOnly && !isLocalHost) setRemoteHost(hostOnly)
    } catch {}
  }, [call])

  React.useEffect(() => { check() }, [check])

  React.useEffect(() => {
    if (['starting', 'downloading', 'extracting', 'installing'].includes(installStatus)) {
      const t = setInterval(async () => {
        const is: any = await call('ollamaInstallStatus', {}).catch(() => null)
        const st = String(is?.status || 'idle')
        setInstallStatus(st)
        setInstallPct(Number(is?.pct || 0))
        setInstallMb(Number(is?.mb || 0))
        setInstallTotalMb(Number(is?.totalMb || 0))
        setInstallErrMsg(String(is?.error || ''))
        if (st === 'done') { const i: any = await call('ollamaInstalled', {}).catch(() => null); setInstalled(!!i?.installed); setInstallVersion(String(i?.version || '')) }
        if (st === 'done' || st === 'idle') clearInterval(t)
      }, 500)
      return () => clearInterval(t)
    }
  }, [installStatus, call])

  const connectRemote = async () => {
    let host = remoteHost.trim()
    if (!host) { setRemoteErr('Connection failed'); setRemoteMsg(''); return }
    if (!/^https?:\/\//.test(host)) host = 'http://' + host
    if (!/:\d+/.test(host)) host = host.replace(/\/$/, '') + ':11434'
    setBusy(true); setRemoteErr(''); setRemoteMsg('')
    try {
      const models: any = await call('fetchProviderModels', { providerName: 'Ollama', baseUrl: host + '/v1', apiKey: '' }).catch(() => null)
      const arr = Array.isArray(models) ? models : (models?.models || [])
      if (arr.length > 0) {
        const cfg: any = await call('getProvidersConfig', {})
        cfg.providers.Ollama.baseUrl = host.replace(/\/$/, '') + '/v1'
        await call('setProvidersConfig', cfg)
        // refresh App-level (baseUrl nuovo in tutto l'UI) PRIMA dei modelli locali
        if (onRefreshAll) { try { await onRefreshAll() } catch {} }
        if (refreshProviders) refreshProviders(arr)
        setRemoteActive(true)
        setRemoteMsg('Connection successful')
      } else {
        setRemoteErr('Connection failed')
      }
    } catch (e: any) { setRemoteErr('Connection failed') }
    finally { setBusy(false) }
  }

  const revertRemote = async () => {
    setBusy(true); setRemoteErr(''); setRemoteMsg('')
    try {
      const cfg: any = await call('getProvidersConfig', {})
      cfg.providers.Ollama.baseUrl = 'http://127.0.0.1:11434/v1'
      await call('setProvidersConfig', cfg)
      const localModels: any = await call('fetchProviderModels', { providerName: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }).catch(() => [])
      if (onRefreshAll) { try { await onRefreshAll() } catch {} }
      setRemoteActive(false); setRemoteHost('')
      setRemoteMsg('Back to local Ollama')
      if (refreshProviders) refreshProviders(Array.isArray(localModels) ? localModels : [])
    } catch {} finally { setBusy(false) }
  }

  const doSaveKey = async () => {
    if (!inputKey.trim()) return
    setBusy(true); setErr('')
    try {
      const r: any = await call('setOllamaCloudKey', { key: inputKey.trim() })
      if (r?.ok) {
        // valida subito la key chiamando l'usage: se invalida, rollback
        const u: any = await call('getOllamaCloudUsage', {})
        if (u?.ok) { setInputKey(''); setShowInput(false); await check() }
        else { await call('clearOllamaCloudKey', {}); setErr('Invalid API key. Create one at ollama.com/settings/keys') }
      }
      else setErr(String(r?.error || 'Save failed'))
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const doLogout = async () => {
    setBusy(true)
    try { await call('clearOllamaCloudKey', {}); await check() } catch {}
    setBusy(false)
  }

  const doInstall = async () => {
    setBusy(true); setErr('')
    setInstallStatus('starting') // feedback immediato: il poll parte subito
    try { await call('ollamaInstall', {}) } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const label = { color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } as any
  const smallBtn = (hover: boolean, accent: string) => ({
    padding: '5px 12px', fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 600,
    color: hover ? 'var(--q-bg)' : accent,
    backgroundColor: hover ? accent : 'transparent',
    border: `1px solid ${accent}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', flexShrink: 0,
  } as any)
  const installRunning = ['starting', 'downloading', 'extracting', 'installing'].includes(installStatus)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Ollama installation — dedicated section, always visible */}
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={label}>Ollama installation</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {installed === true && <div style={{ color: 'var(--q-accent-success)', fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 600 }}>Installed{installVersion ? ` (${installVersion})` : ''}</div>}
          <button onClick={() => setShowInstallModal(true)} disabled={installed === true || installRunning}
            onMouseEnter={() => setHInstall(true)} onMouseLeave={() => setHInstall(false)}
            style={{ ...smallBtn(hInstall, 'var(--q-tab-accent)'), opacity: installed === true || installRunning ? 0.45 : 1, cursor: installed === true || installRunning ? 'default' : 'pointer' }}
          ><span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Download size={13} /> Install Ollama</span></button>
          </div>
        </div>
        {/* FIX: Ollama su UN ALTRO computer — usa l'host remoto invece di installare una seconda copia */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--q-border)', flexWrap: 'wrap' }}>
          <div style={{ ...label, flex: 1, minWidth: 170 }}>
            Already have Ollama on another computer?
            <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>Use it from here instead of installing a second copy. Enter the address of the computer where Ollama runs.</div>
          </div>
          {!remoteActive && <input value={remoteHost} onChange={(e: any) => { setRemoteHost(e.target.value); setRemoteMsg(''); setRemoteErr('') }}
            placeholder="http://localhost:11434"
            style={{ padding: '5px 10px', fontSize: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg)', color: 'var(--q-text)', width: '200px', fontFamily: 'var(--font-code)', outline: 'none', flexShrink: 0 }} />}
          {!remoteActive && <button onClick={connectRemote} disabled={busy}
            onMouseEnter={() => setHRemote(true)} onMouseLeave={() => setHRemote(false)}
            style={{ ...smallBtn(hRemote, 'var(--q-tab-accent)'), opacity: busy ? 0.45 : 1, cursor: busy ? 'default' : 'pointer' }}
          >{busy ? 'Connecting…' : 'Use remote'}</button>}
          {remoteActive && <button onClick={revertRemote} disabled={busy}
            onMouseEnter={() => setHRevert(true)} onMouseLeave={() => setHRevert(false)}
            style={smallBtn(hRevert, 'var(--q-accent-danger)')}>Back to local</button>}
        </div>
        {(remoteMsg || remoteErr) && <div style={{ fontSize: '11px', marginTop: '6px', color: remoteErr ? 'var(--q-accent-danger)' : 'var(--q-accent-success)', fontFamily: 'var(--font-interface)' }}>{remoteErr || remoteMsg}</div>}
      </div>

      {/* Account card (own section, like OpenRouter account) */}
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={label}>Ollama account</div>
          {keySet === false && !showInput && (
            <button onClick={() => { setShowInput(true); try { invoke('open_url', { url: 'https://ollama.com/settings/keys' }).catch(() => {}) } catch {} }}
              onMouseEnter={() => setHLogin(true)} onMouseLeave={() => setHLogin(false)}
              style={smallBtn(hLogin, 'var(--q-tab-accent)')}
            >Login</button>
          )}
          {keySet === true && (
            <button onClick={doLogout} disabled={busy} onMouseEnter={() => setHLogout(true)} onMouseLeave={() => setHLogout(false)}
              style={smallBtn(hLogout, 'var(--q-accent-danger)')}
            >Logout</button>
          )}
          {keySet === null && <div style={label}>...</div>}
        </div>
        {showInput && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="Paste your Ollama API key"
              style={{ width: '100%', height: '36px', backgroundColor: 'var(--q-bg)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <a href="https://ollama.com/settings/keys" onClick={(e) => { e.preventDefault(); try { invoke('open_url', { url: 'https://ollama.com/settings/keys' }).catch(() => {}) } catch {} }}
                style={{ color: 'var(--q-tab-accent)', fontSize: '12px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
              >Get one at ollama.com/settings/keys</a>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setShowInput(false)}
                  onMouseEnter={() => setHCancel(true)} onMouseLeave={() => setHCancel(false)}
                  style={{ padding: '5px 12px', fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: hCancel ? 'rgba(255,255,255,0.06)' : 'transparent', color: 'var(--q-accent-danger)', cursor: 'pointer', flexShrink: 0 }}
                >Cancel</button>
                <button onClick={doSaveKey} disabled={busy} onMouseEnter={() => setHSave(true)} onMouseLeave={() => setHSave(false)}
                  style={smallBtn(hSave, 'var(--q-tab-accent)')}
                >Save</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Usage card */}
      {keySet === true && <OllamaUsageCard call={call} showOpenWindow={true} />}

      {err && err !== 'no_key' && <div style={{ ...label, color: 'var(--q-accent-danger)' }}>{err}</div>}

      {/* Install Ollama — confirm + real download progress modal */}
      {showInstallModal && (() => {
        const running = installRunning
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => { if (!running && !busy) setShowInstallModal(false) }}>
            <div style={{ backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--q-border)', boxShadow: 'var(--shadow-modal)', padding: '24px', width: '460px' }}
              onClick={(e) => e.stopPropagation()}>
              <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '10px' }}>
                {installStatus === 'done' ? 'Ollama installed' : 'Install Ollama'}
              </div>
              {!running && installStatus !== 'done' && (
                <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' }}>
                  Ollama is not installed on this computer. Download and install it to use the Ollama provider. The download may take a few minutes depending on your connection.
                </div>
              )}
              {!running && installErrMsg && (
                <div style={{ color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '12px' }}>
                  {installErrMsg}. Check your internet connection and try again.
                </div>
              )}
              {running && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>
                      {installStatus === 'downloading' ? 'Downloading Ollama' : installStatus === 'extracting' ? 'Extracting...' : 'Installing to /Applications...'}
                    </div>
                    <div style={{ color: 'var(--q-text)', fontSize: '18px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{installPct}%</div>
                  </div>
                  <div style={{ height: '10px', borderRadius: '5px', backgroundColor: 'var(--q-border)', overflow: 'hidden' }}>
                    <div style={{ width: `${installPct}%`, height: '100%', borderRadius: '5px', backgroundColor: 'var(--q-tab-accent)' }} />
                  </div>
                  {installStatus === 'downloading' && (
                    <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '8px' }}>
                      {installMb} MB{installTotalMb ? ` / ${installTotalMb} MB` : ''}
                    </div>
                  )}
                  {installErrMsg && <div style={{ color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginTop: '10px' }}>{installErrMsg}</div>}
                  <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '14px' }}>You can close this window, the installation continues in the background.</div>
                </div>
              )}
              {installStatus === 'done' && (
                <div style={{ color: 'var(--q-accent-success)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
                  Ollama installed successfully. The Ollama app has been opened.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                {!running && installStatus !== 'done' && (
                  <button onClick={() => setShowInstallModal(false)}
                    onMouseEnter={() => setHCancel(true)} onMouseLeave={() => setHCancel(false)}
                    style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: hCancel ? 'rgba(255,255,255,0.06)' : 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
                  >Cancel</button>
                )}
                {!running && installStatus !== 'done' && (
                  <button onClick={doInstall}
                    onMouseEnter={() => setHModalInstall(true)} onMouseLeave={() => setHModalInstall(false)}
                    style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: hModalInstall ? 'var(--q-tab-accent)' : 'transparent', color: hModalInstall ? 'var(--q-bg)' : 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
                  >Install</button>
                )}
                {installStatus === 'done' && (
                  <button onClick={() => { setShowInstallModal(false); check() }}
                    style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
                  >Done</button>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

/** Standalone Ollama usage window (win-usage-ollama): the usage card only, with pin. */
export function OllamaUsageStandaloneWindow(props: { call: (method: string, params?: any, timeoutMs?: number) => Promise<any> }) {
  const { call } = props
  const style = {
    height: '100vh', width: '100vw', overflow: 'hidden',
    backgroundColor: 'var(--q-bg-panel)', color: 'var(--q-text)',
    fontFamily: 'var(--font-interface)', display: 'flex', flexDirection: 'column',
  } as any
  return (
    <div style={style}>
      <div data-tauri-drag-region style={{ height: '25px', flexShrink: 0, width: '100%', backgroundColor: 'var(--q-bg-panel)', WebkitAppRegion: 'drag' }} />
      <OllamaUsageCard call={call} showOpenWindow={false} variant="window" />
    </div>
  )
}
