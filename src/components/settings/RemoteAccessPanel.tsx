// ============================================================
// Web app / Remote access (F0) — Impostazioni.
// Quinki raggiungibile dal telefono o da un altro computer:
//   - stessa Wi-Fi (LAN): link diretto http://<ip-del-mac>:9182
//   - da fuori casa: tunnel Cloudflare gestito DENTRO l'app (nessun programma
//     da installare a mano: se manca, cloudflared viene scaricato dall'app)
// ============================================================
import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Globe } from '../icons'

export function RemoteAccessSection() {
  const [status, setStatus] = useState<{ running: boolean; url: string }>({ running: false, url: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [token, setToken] = useState('')
  const [devices, setDevices] = useState<any[]>([])
  const [rotating, setRotating] = useState(false)
  const [confirmAct, setConfirmAct] = useState<null | 'token' | 'link'>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s: any = await invoke('remote_tunnel_status')
        if (!cancelled && s) setStatus({ running: !!s.running, url: String(s.url || '') })
      } catch {}
      try {
        const t: any = await invoke('get_remote_token')
        if (!cancelled && t) setToken(String(t))
      } catch {}
      try {
        const d: any = await invoke('remote_devices_list')
        if (!cancelled && Array.isArray(d)) setDevices(d)
      } catch {}
    })()
    const iv = setInterval(async () => {
      try {
        const s2: any = await invoke('remote_tunnel_status')
        if (!cancelled && s2) setStatus(prev => (prev.running === !!s2.running && prev.url === String(s2.url || '')) ? prev : { running: !!s2.running, url: String(s2.url || '') })
      } catch {}
    }, 3000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])


  const copy = async (text: string, which: string) => {
    if (!text) return
    try { await invoke('copy_to_clipboard', { text }) } catch {
      try { await navigator.clipboard.writeText(text) } catch {}
    }
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

  const refreshDevices = async () => {
    try { const d: any = await invoke('remote_devices_list'); if (Array.isArray(d)) setDevices(d) } catch {}
  }
  const revoke = async (id: string) => {
    try { await invoke('remote_device_revoke', { id }) } catch {}
    refreshDevices()
  }
  const doRotateToken = async () => {
    setConfirmAct(null); setRotating(true)
    try { const t: any = await invoke('remote_token_rotate'); if (t) setToken(String(t)) } catch {}
    setRotating(false)
  }
  const doRefreshLink = async () => {
    setConfirmAct(null); setBusy(true); setErr('')
    try {
      await invoke('remote_tunnel_stop')
      const url: any = await invoke('remote_tunnel_start', { port: 9182 })
      setStatus({ running: true, url: String(url || '') })
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const fmtWhen = (ms: number) => { try { return ms ? new Date(ms).toLocaleString() : '—' } catch { return '—' } }

  return (
    <div id="settings-webapp" style={{ width: '100%', marginBottom: '12px', padding: '14px 18px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Globe size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Web app</span>
      </div>
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>
        Use Quinki from your phone or another computer. Same sessions, same data as this Mac. Works while Quinki is running.
      </div>
      <div style={{ height: '6px' }} />
      <div style={{ color: 'var(--q-accent-warning)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
        To install Quinki as a real app on a phone, use the secure HTTPS link below (plain local links can only create a shortcut).
      </div>

      <div style={{ height: '12px' }} />
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Secure link</div>
      <div style={{ height: '6px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={urlBox}>{status.running && status.url ? status.url : (busy ? 'starting…' : 'not active')}</div>
        {status.running && status.url && (
          <button style={rowBtn} onClick={() => copy(withToken(status.url), 'tun')}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}>
            {copied === 'tun' ? 'Copied' : 'Copy'}
          </button>
        )}
        {status.running && (
          <button style={rowBtn} disabled={busy} onClick={() => setConfirmAct('link')}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}>
            Refresh
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
        <button style={rowBtn} disabled={rotating} onClick={() => setConfirmAct('token')}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}>
          {rotating ? '…' : 'Refresh'}
        </button>
      </div>
      <div style={{ height: '16px' }} />
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Paired devices</div>
      <div style={{ height: '6px' }} />
      {devices.length === 0 && (
        <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>No devices paired yet.</div>
      )}
      {devices.map((d: any) => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
            <div style={{ color: 'var(--q-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-code)' }}>added {fmtWhen(d.createdAt)} · last seen {fmtWhen(d.lastSeen)}</div>
          </div>
          <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-accent-danger)' }} onClick={() => revoke(d.id)}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
            Revoke
          </button>
        </div>
      ))}

      <div style={{ height: '8px' }} />
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
        “Copy” gives a link that already contains the token: open it once on the phone and the device is remembered for good (it survives updates, reinstalls and restarts). The secure link is HTTPS: open it and use “Install app” to keep Quinki as a real app with its icon.
      </div>
      {err && <div style={{ color: 'var(--q-accent-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '6px' }}>{err}</div>}

      {confirmAct && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setConfirmAct(null) }}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '24px', maxWidth: '420px', width: '90%', boxShadow: 'var(--shadow-modal)' }}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
              {confirmAct === 'token' ? 'Refresh access token?' : 'Get a new secure link?'}
            </div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' }}>
              {confirmAct === 'token'
                ? 'Old pairing links stop working. Devices already paired keep working.'
                : 'The secure link changes: open the new pairing link once on the devices you use. Devices already paired keep working.'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmAct(null)}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmAct === 'token' ? doRotateToken : doRefreshLink}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
