// ============================================================
// Web app / Remote access — Impostazioni.
//
// PANNELLO STATICO: non sparisce mai niente.
//   - i 2 step restano sempre visibili (numeri sempre "1" e "2", neutri)
//   - il bottone [Sign in with Tailscale] resta SEMPRE presente
//   - Log out e' un bottone SEPARATO (compare quando sei dentro, non
//     sostituisce mai il sign in)
//   - il link permanente compare in cima quando e' pronto
//
// Meccanica: nodo Tailscale embedded (tsnet) + Funnel = link stabile
// <nome>.ts.net per sempre. Unica via, niente alternative.
// ============================================================
import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Globe } from '../icons'
import QRCode from 'qrcode'

const URL_ADMIN_DNS = 'https://login.tailscale.com/admin/dns'

function fmtWhen(ts: number) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
  return new Date(ts).toLocaleDateString()
}

const rowBtn: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)',
  backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600,
  fontFamily: 'var(--font-interface)', cursor: 'pointer', flexShrink: 0,
}
const hoverAccent = {
  onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' },
  onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' },
}
const hoverNeutral = {
  onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' },
  onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' },
}
const urlBox: React.CSSProperties = {
  flex: 1, minWidth: 0, color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-code)',
  backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)',
  padding: '0 12px', height: '34px', display: 'flex', alignItems: 'center', overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const stepNum: React.CSSProperties = {
  width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
  backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--q-text-secondary)', fontSize: '11px', fontFamily: 'var(--font-code)',
}
const stepRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0' }
const stepTxt: React.CSSProperties = { flex: 1, minWidth: 0, color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.45 }

// Una delle due parti (Main / Expert): link + Copy + QR + token + dispositivi.
// Il setup (login + console) e' in comune, sopra: UN login, due link.
function RemoteAccessLinkPart({ target }: { target: string }) {
  const [status, setStatus] = useState<{ running: boolean; url: string; authUrl?: string }>({ running: false, url: '' })
  const [token, setToken] = useState('')
  const [devices, setDevices] = useState<any[]>([])
  const [copied, setCopied] = useState('')
  const [rotating, setRotating] = useState(false)
  const [confirmAct, setConfirmAct] = useState<null | 'token' | 'revoke'>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrData, setQrData] = useState('')
  const [revokeId, setRevokeId] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const s: any = await invoke('remote_tunnel_status', { target })
        if (!cancelled && s) setStatus(prev => (prev.running === !!s.running && prev.url === String(s.url || '')) ? prev : { running: !!s.running, url: String(s.url || ''), authUrl: String(s.authUrl || '') })
      } catch {}
    }
    ;(async () => {
      await load()
      try { const t: any = await invoke('get_remote_token', { target }); if (!cancelled && t) setToken(String(t)) } catch {}
      try { const d: any = await invoke('remote_devices_list', { target }); if (!cancelled && Array.isArray(d)) setDevices(d) } catch {}
    })()
    const iv = setInterval(async () => {
      await load()
      try { const d2: any = await invoke('remote_devices_list', { target }); if (!cancelled && Array.isArray(d2)) setDevices(prev => JSON.stringify(prev) === JSON.stringify(d2) ? prev : d2) } catch {}
    }, 3000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const withToken = (base: string) => (base && token ? `${base}/?token=${token}` : base)

  const copy = async (text: string, which: string) => {
    if (!text) { setErr('Nothing to copy yet.'); setTimeout(() => setErr(''), 4000); return }
    let ok = false
    try { await invoke('copy_to_clipboard', { text }); ok = true } catch {}
    if (!ok) { try { await navigator.clipboard.writeText(text); ok = true } catch {} }
    if (!ok) {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {}
    }
    if (ok) { setCopied(which); setTimeout(() => setCopied(''), 1500) }
    else { setErr('Copy failed on this system.'); setTimeout(() => setErr(''), 4000) }
  }

  const openQr = async () => {
    if (!status.url) { setErr('The link is not ready yet.'); setTimeout(() => setErr(''), 4000); return }
    try {
      const data = await QRCode.toDataURL(withToken(status.url), { width: 520, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      setQrData(data)
      setQrOpen(true)
    } catch (e: any) { setErr('QR generation failed: ' + String((e && e.message) ? e.message : e)) }
  }

  const refreshDevices = async () => {
    try { const d: any = await invoke('remote_devices_list', { target }); if (Array.isArray(d)) setDevices(d) } catch {}
  }
  const rotate = async () => {
    setConfirmAct(null)
    setRotating(true)
    try { const t: any = await invoke('remote_token_rotate', { target }); if (t) setToken(String(t)) } catch {}
    setRotating(false)
  }
  const revoke = async () => {
    try { await invoke('remote_device_revoke', { id: revokeId, target }) } catch {}
    setConfirmAct(null)
    refreshDevices()
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', marginBottom: '2px' }}>
        <span style={{ color: 'var(--q-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{target === 'expert' ? 'Expert web app' : 'Main web app'}</span>
      </div>
      <div style={{ height: '8px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={urlBox}>{status.url || 'starting…'}</div>
        <button style={rowBtn} {...hoverAccent} onClick={() => copy(withToken(status.url), 'link')}>{copied === 'link' ? 'Copied' : 'Copy'}</button>
        <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-text-secondary)' }} {...hoverNeutral} onClick={openQr}>QR code</button>
      </div>
      <div style={{ height: '6px' }} />
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
        {target === 'expert'
          ? 'Opens the App Expert directly. Add it to your phone home screen: it installs as “Quinki Expert” with its own icon.'
          : 'This link never changes, not even after updates or restarts of this Mac.'}
      </div>

      <div style={{ height: '16px' }} />
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Access token</div>
      <div style={{ height: '6px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={urlBox}>{token || '—'}</div>
        <button style={rowBtn} {...hoverAccent} disabled={!token} onClick={() => copy(token, 'tok')}>{copied === 'tok' ? 'Copied' : 'Copy'}</button>
        <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-text-secondary)' }} {...hoverNeutral} disabled={rotating} onClick={() => setConfirmAct('token')}>{rotating ? '…' : 'Refresh'}</button>
      </div>
      <div style={{ height: '6px' }} />
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
        The “Copy” link above already contains this token: open it once on the phone and the device is remembered for good.
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
          <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-accent-danger)' }} onClick={() => { setRevokeId(d.id); setConfirmAct('revoke') }} {...hoverNeutral}>
            Revoke
          </button>
        </div>
      ))}
      {!!err && (
        <div style={{ color: 'var(--q-accent-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>{err}</div>
      )}

      {qrOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setQrOpen(false) }}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '20px', maxWidth: '420px', width: '90%' }}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
              {target === 'expert' ? 'Quinki Expert QR code' : 'QR code'}
            </div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '10px' }}>
              Scan this with your phone camera: {target === 'expert' ? 'Quinki Expert' : 'Quinki'} opens on the phone already signed in, nothing to type.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 10px 0' }}>
              <div style={{ backgroundColor: '#ffffff', padding: '10px', borderRadius: 'var(--radius-md)' }}>
                {qrData && <img src={qrData} width={220} height={220} alt="QR code" />}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setQrOpen(false)} {...hoverNeutral}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmAct === 'token' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setConfirmAct(null) }}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '20px', maxWidth: '420px', width: '90%' }}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>Create a new token?</div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>
              Devices already paired keep working. Links containing the previous token stop working.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmAct(null)} {...hoverNeutral}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={rotate} {...hoverAccent}
                style={rowBtn}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmAct === 'revoke' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setConfirmAct(null) }}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '20px', maxWidth: '420px', width: '90%' }}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>Remove this device?</div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>
              The device will need the link with the token again to reconnect.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmAct(null)} {...hoverNeutral}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={revoke} {...hoverAccent} style={rowBtn}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function RemoteAccessSection() {
  const [status, setStatus] = useState<{ running: boolean; url: string; authUrl?: string }>({ running: false, url: '' })
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [err, setErr] = useState('')
  const [confirmLogout, setConfirmLogout] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const s: any = await invoke('remote_tunnel_status', { target: 'main' })
        if (!cancelled && s) setStatus(prev => (prev.running === !!s.running && prev.url === String(s.url || '') && (prev.authUrl || '') === String(s.authUrl || '')) ? prev : { running: !!s.running, url: String(s.url || ''), authUrl: String(s.authUrl || '') })
      } catch {}
      try {
        const st: any = await invoke('remote_tunnel_state', { target: 'main' })
        if (!cancelled && st) setEnabled(!!st.enabled)
      } catch {}
    }
    load()
    const iv = setInterval(load, 3000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const openUrl = (url: string) => { invoke('open_url', { url }).catch(() => {}) }

  const signIn = async () => {
    if (busy) return
    setBusy(true); setSigningIn(true); setErr('')
    try {
      const url: any = await invoke('remote_tunnel_start', { port: 9182, hostname: '', target: 'main' })
      setEnabled(true)
      setStatus(prev => ({ running: !!url, url: String(url || ''), authUrl: prev.authUrl || '' }))
      if (url) { setSigningIn(false); setBusy(false); return } // gia' pronto
      let auth = String(status.authUrl || '')
      for (let i = 0; i < 16 && !auth; i++) {
        await new Promise(r => setTimeout(r, 500))
        try {
          const s: any = await invoke('remote_tunnel_status', { target: 'main' })
          const u = String(s?.url || '')
          if (u) { setStatus({ running: true, url: u, authUrl: '' }); break }
          auth = String(s?.authUrl || '')
          setStatus({ running: !!s?.running, url: u, authUrl: auth })
        } catch {}
      }
      if (auth) { openUrl(auth); setTimeout(() => setSigningIn(false), 1200) }
      else { setSigningIn(false) }
    } catch (e: any) {
      setSigningIn(false)
      setErr(String((e && e.message) ? e.message : e))
    }
    setBusy(false)
  }

  const startTunnel = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try { await invoke('remote_tunnel_start', { port: 9182, hostname: '', target: 'main' }) } catch (e: any) { setErr(String((e && e.message) ? e.message : e)) }
    setBusy(false)
  }

  const doLogout = async () => {
    setConfirmLogout(false); setBusy(true); setErr('')
    try {
      await invoke('remote_logout', { target: 'main' })
      setEnabled(false)
      setStatus({ running: false, url: '', authUrl: '' })
    } catch (e: any) { setErr('Log out failed: ' + String((e && e.message) ? e.message : e)) }
    setBusy(false)
  }

  const ready = !!status.url && status.url.includes('.ts.net')
  const loggedIn = ready || (enabled && !status.authUrl && !signingIn)
  const statusLine = signingIn
    ? 'Waiting for the login… finish it in the browser, then come back here.'
    : ready
      ? 'You are logged in with Tailscale.'
      : status.authUrl
        ? 'Not logged in yet: press the button and finish the login in the browser.'
        : enabled
          ? 'Connected. Waiting for the link: if it does not appear by itself, enable Funnel for this device in the Tailscale admin console (DNS page).'
          : 'Not started yet: press the button above.'

  return (
    <div id="settings-webapp" style={{ width: '100%', marginBottom: '12px', padding: '14px 18px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Globe size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Web app</span>
      </div>
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>
        Use Quinki from your phone or another computer: same sessions, same data as this Mac, while Quinki is running. On the phone, use “Install app” to keep Quinki as a real app with its icon.
      </div>

      {/* ---------- setup: UNO, vale per entrambi i link ---------- */}
      <div style={{ height: '12px' }} />
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Setup, one time only (2 steps)</div>
      <div style={{ height: '2px' }} />
      <div style={stepRow}>
        <div style={stepNum}>1</div>
        <div style={stepTxt}>
          Log in with Tailscale and authorize this Mac. No account yet? You create it right there, free (Google, GitHub or email).
        </div>
        <button style={rowBtn} {...hoverAccent} onClick={signIn}>Sign in with Tailscale</button>
      </div>
      <div style={stepRow}>
        <div style={stepNum}>2</div>
        <div style={stepTxt}>
          In the Tailscale admin console, on the DNS page, turn on “HTTPS Certificates” and “Funnel”. This makes the links reachable from your phone.
        </div>
        <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-text-secondary)' }} {...hoverNeutral} onClick={() => openUrl(URL_ADMIN_DNS)}>Open admin console</button>
      </div>
      <div style={{ height: '4px' }} />
      <div style={{ color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
        {statusLine}
      </div>
      <div style={{ height: '10px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button style={rowBtn} {...hoverAccent} disabled={busy} onClick={startTunnel}>Start / refresh</button>
        {loggedIn && (
          <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-accent-danger)' }} {...hoverNeutral} onClick={() => setConfirmLogout(true)}>
            Log out
          </button>
        )}
        {!!err && (
          <span style={{ color: 'var(--q-accent-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>{err}</span>
        )}
      </div>

      <div style={{ height: '1px', backgroundColor: 'var(--q-border)', margin: '14px 0 0 0' }} />
      <RemoteAccessLinkPart target="main" />
      <div style={{ height: '1px', backgroundColor: 'var(--q-border)', margin: '14px 0 0 0' }} />
      <RemoteAccessLinkPart target="expert" />

      {confirmLogout && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setConfirmLogout(false) }}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '20px', maxWidth: '420px', width: '90%' }}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>Log out of Tailscale?</div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>
              Both links stop working until you sign in again.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmLogout(false)} {...hoverNeutral}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={doLogout} {...hoverAccent} style={rowBtn}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
