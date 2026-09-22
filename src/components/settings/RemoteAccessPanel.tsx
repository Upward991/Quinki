// ============================================================
// Web app / Remote access (F0) — Impostazioni.
// Quinki raggiungibile dal telefono o da un altro computer:
//   - stessa Wi-Fi (LAN): link diretto http://<ip-del-mac>:9182
//   - da fuori casa: tunnel Cloudflare gestito DENTRO l'app (nessun programma
//     da installare a mano: se manca, cloudflared viene scaricato dall'app)
// ============================================================
import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export function RemoteAccessSection() {
  const [status, setStatus] = useState<{ running: boolean; url: string }>({ running: false, url: '' })
  const [lanIp, setLanIp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s: any = await invoke('remote_tunnel_status')
        if (!cancelled && s) setStatus({ running: !!s.running, url: String(s.url || '') })
      } catch {}
      try {
        const ip: any = await invoke('get_lan_ip')
        if (!cancelled && ip) setLanIp(String(ip))
      } catch {}
      try {
        const t: any = await invoke('get_remote_token')
        if (!cancelled && t) setToken(String(t))
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  const lanUrl = lanIp ? `http://${lanIp}:9182` : ''

  const copy = async (text: string, which: string) => {
    try { await navigator.clipboard.writeText(text) } catch {}
    setCopied(which)
    setTimeout(() => setCopied(''), 1500)
  }

  const start = async () => {
    setBusy(true); setErr('')
    try {
      const url: any = await invoke('remote_tunnel_start', { port: 9182 })
      setStatus({ running: true, url: String(url || '') })
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
    setBusy(false)
  }

  const stop = async () => {
    setBusy(true); setErr('')
    try {
      await invoke('remote_tunnel_stop')
      setStatus({ running: false, url: '' })
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
    setBusy(false)
  }

  const rowBtn: React.CSSProperties = {
    padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)',
    backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600,
    fontFamily: 'var(--font-interface)', cursor: 'pointer', flexShrink: 0,
  }
  const urlBox: React.CSSProperties = {
    flex: 1, minWidth: 0, color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-code)',
    backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)',
    padding: '0 12px', height: '34px', display: 'flex', alignItems: 'center', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }

  return (
    <div id="settings-webapp" style={{ width: '100%', marginBottom: '12px', padding: '14px 18px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--q-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />
        </svg>
        <span style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Web app</span>
      </div>
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>
        Use Quinki from your phone or another computer. Same sessions, same data as this Mac. Works while Quinki is running.
      </div>

      <div style={{ height: '12px' }} />
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Same Wi-Fi (LAN)</div>
      <div style={{ height: '6px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={urlBox}>{lanUrl || 'no network address found'}</div>
        <button style={rowBtn} disabled={!lanUrl} onClick={() => copy(withToken(lanUrl), 'lan')}
          onMouseEnter={e => { if (lanUrl) { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' } }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}>
          {copied === 'lan' ? 'Copied' : 'Copy pairing link'}
        </button>
      </div>

      <div style={{ height: '16px' }} />
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>From anywhere (secure link)</div>
      <div style={{ height: '6px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={urlBox}>{status.running && status.url ? status.url : (busy ? 'starting…' : 'not active')}</div>
        {status.running && status.url && (
          <button style={rowBtn} onClick={() => copy(withToken(status.url), 'tun')}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}>
            {copied === 'tun' ? 'Copied' : 'Copy pairing link'}
          </button>
        )}
        <button style={rowBtn} disabled={busy} onClick={status.running ? stop : start}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}>
          {busy ? '…' : status.running ? 'Disable' : 'Enable'}
        </button>
      </div>
      <div style={{ height: '16px' }} />
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Access token</div>
      <div style={{ height: '6px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={urlBox}>{token || '—'}</div>
        <button style={rowBtn} disabled={!token} onClick={() => copy(token, 'tok')}
          onMouseEnter={e => { if (token) { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' } }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}>
          {copied === 'tok' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ height: '8px' }} />
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
        “Copy pairing link” gives a link that already contains the token: open it once on the phone (the device is remembered). The secure link is HTTPS: open it and use “Install app” to keep Quinki as a real app with its icon. Everything stays active while enabled and stops when you quit Quinki.
      </div>
      {err && <div style={{ color: 'var(--q-accent-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '6px' }}>{err}</div>}
    </div>
  )
}
