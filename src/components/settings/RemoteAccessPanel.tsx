// ============================================================
// Web app / Remote access — Impostazioni.
// Setup guidato: l'app porta l'utente sulle pagine giuste (account Tailscale,
// consolle per Funnel) con i bottoni. Nessun campo di testo da riempire.
//
// Meccanica: nodo Tailscale embedded (tsnet) + Funnel = link stabile
// <nome>.ts.net per sempre, nessuna installazione di sistema e niente app
// sul telefono. L'accesso resta protetto dal token/pairing: il link e' la porta.
// Fallback automatico: tunnel Cloudflare se il binario tsnet non c'e'.
// ============================================================
import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Globe } from '../icons'

const URL_SIGNUP = 'https://login.tailscale.com/start'
const URL_ADMIN_DNS = 'https://login.tailscale.com/admin/dns'

export function RemoteAccessSection() {
  const [status, setStatus] = useState<{ running: boolean; url: string; authUrl?: string }>({ running: false, url: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [token, setToken] = useState('')
  const [devices, setDevices] = useState<any[]>([])
  const [rotating, setRotating] = useState(false)
  const [confirmAct, setConfirmAct] = useState<null | 'token' | 'revoke'>(null)
  const [revokeId, setRevokeId] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s: any = await invoke('remote_tunnel_status')
        if (!cancelled && s) setStatus({ running: !!s.running, url: String(s.url || ''), authUrl: String(s.authUrl || '') })
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
        if (!cancelled && s2) setStatus(prev => (prev.running === !!s2.running && prev.url === String(s2.url || '') && (prev.authUrl || '') === String(s2.authUrl || '')) ? prev : { running: !!s2.running, url: String(s2.url || ''), authUrl: String(s2.authUrl || '') })
      } catch {}
      try {
        const d2: any = await invoke('remote_devices_list')
        if (!cancelled && Array.isArray(d2)) setDevices(prev => JSON.stringify(prev) === JSON.stringify(d2) ? prev : d2)
      } catch {}
    }, 3000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  // link di pairing = URL + token (il token resta comunque la chiave d'accesso)
  const withToken = (base: string) => (base && token ? `${base}/?token=${token}` : base)

  const openUrl = (url: string) => { invoke('open_url', { url }).catch(() => {}) }

  const copy = async (text: string, which: string) => {
    if (!text) {
      setErr('Nothing to copy yet: start the secure link first.')
      setTimeout(() => setErr(''), 4000)
      return
    }
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

  const start = async () => {
    setBusy(true); setErr('')
    try {
      const url: any = await invoke('remote_tunnel_start', { port: 9182, hostname: '' })
      setStatus(prev => ({ running: !!url, url: String(url || ''), authUrl: prev.authUrl || '' }))
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
    setBusy(false)
  }

  const stop = async () => {
    setBusy(true); setErr('')
    try {
      await invoke('remote_tunnel_stop')
      setStatus({ running: false, url: '', authUrl: '' })
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
    setBusy(false)
  }

  // Riavvia il nodo (usato per: ricontrollare dopo il setup, passare dal link
  // temporaneo a quello stabile). Senza conferma: non c'e' nulla da rompere.
  const restart = async () => {
    setBusy(true); setErr('')
    try {
      await invoke('remote_tunnel_stop')
      const url: any = await invoke('remote_tunnel_start', { port: 9182, hostname: '' })
      setStatus(prev => ({ running: !!url, url: String(url || ''), authUrl: prev.authUrl || '' }))
    } catch (e: any) { setErr(String(e?.message || e)) }
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
  const doRevoke = async () => {
    const id = revokeId
    setConfirmAct(null); setRevokeId('')
    if (!id) return
    try { await invoke('remote_device_revoke', { id }) } catch {}
    refreshDevices()
  }
  const doRotateToken = async () => {
    setConfirmAct(null); setRotating(true)
    try { const t: any = await invoke('remote_token_rotate'); if (t) setToken(String(t)) } catch {}
    setRotating(false)
  }
  const fmtWhen = (ms: number) => { try { return ms ? new Date(ms).toLocaleString() : '—' } catch { return '—' } }

  const stepNum: React.CSSProperties = {
    width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
    backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--q-text-secondary)', fontSize: '11px', fontFamily: 'var(--font-code)',
  }
  const stepRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0' }
  const stepTxt: React.CSSProperties = { flex: 1, minWidth: 0, color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }

  const stable = status.url.includes('.ts.net')
  const showSetup = !status.running && !status.authUrl

  return (
    <div id="settings-webapp" style={{ width: '100%', marginBottom: '12px', padding: '14px 18px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Globe size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Web app</span>
      </div>
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>
        Use Quinki from your phone or another computer: same sessions, same data as this Mac, while Quinki is running. On the phone, use “Install app” to keep Quinki as a real app with its icon.
      </div>

      {showSetup && (
        <>
          <div style={{ height: '12px' }} />
          <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Setup, one time only</div>
          <div style={{ height: '4px' }} />
          <div style={stepRow}>
            <div style={stepNum}>1</div>
            <div style={stepTxt}>Create a free Tailscale account. It links your phone to this Mac, nothing gets installed on the phone.</div>
            <button style={rowBtn} onClick={() => openUrl(URL_SIGNUP)}>Create account</button>
          </div>
          <div style={stepRow}>
            <div style={stepNum}>2</div>
            <div style={stepTxt}>In the Tailscale admin console open the DNS page and turn on “HTTPS Certificates” and “Funnel”.</div>
            <button style={rowBtn} onClick={() => openUrl(URL_ADMIN_DNS)}>Open admin console</button>
          </div>
          <div style={stepRow}>
            <div style={stepNum}>3</div>
            <div style={stepTxt}>Start the secure link here. This Mac gets one permanent address, it never changes.</div>
            <button style={rowBtn} disabled={busy} onClick={start}>{busy ? '…' : 'Start secure link'}</button>
          </div>
        </>
      )}

      {!status.running && !!status.authUrl && (
        <>
          <div style={{ height: '12px' }} />
          <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Almost there: finish the two steps</div>
          <div style={{ height: '4px' }} />
          <div style={stepRow}>
            <div style={stepNum}>1</div>
            <div style={stepTxt}>Sign in with your Tailscale account (create it right there if you don’t have one yet). This authorizes this Mac.</div>
            <button style={rowBtn} onClick={() => openUrl(String(status.authUrl))}>Sign in</button>
          </div>
          <div style={stepRow}>
            <div style={stepNum}>2</div>
            <div style={stepTxt}>In the admin console DNS page, turn on “HTTPS Certificates” and “Funnel”.</div>
            <button style={rowBtn} onClick={() => openUrl(URL_ADMIN_DNS)}>Open admin console</button>
          </div>
          <div style={{ height: '4px' }} />
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
            The permanent link appears here automatically, about a minute after both steps.
          </div>
          <div style={{ height: '8px' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={rowBtn} disabled={busy} onClick={restart}>{busy ? '…' : 'Check now'}</button>
            <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-text-secondary)' }} disabled={busy} onClick={stop}>Cancel setup</button>
          </div>
        </>
      )}

      {status.running && (
        <>
          <div style={{ height: '12px' }} />
          <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Secure link</div>
          <div style={{ height: '6px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={urlBox}>{status.url || (busy ? 'starting…' : 'not active')}</div>
            <button style={rowBtn} onClick={() => copy(withToken(status.url), 'tun')}>{copied === 'tun' ? 'Copied' : 'Copy'}</button>
            <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-text-secondary)' }} disabled={busy} onClick={stop}>{busy ? '…' : 'Disable'}</button>
          </div>
          <div style={{ height: '6px' }} />
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
            {stable
              ? 'Permanent link: it never changes, not even after updates or restarts of this Mac. Open it once on your phone and install Quinki from there.'
              : 'Temporary link: it can change if the tunnel restarts.'}
          </div>
          {!stable && (
            <>
              <div style={{ height: '12px' }} />
              <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Get the permanent link</div>
              <div style={{ height: '4px' }} />
              <div style={stepRow}>
                <div style={stepNum}>1</div>
                <div style={stepTxt}>Create a free Tailscale account. It links your phone to this Mac, nothing gets installed on the phone.</div>
                <button style={rowBtn} onClick={() => openUrl(URL_SIGNUP)}>Create account</button>
              </div>
              <div style={stepRow}>
                <div style={stepNum}>2</div>
                <div style={stepTxt}>In the Tailscale admin console open the DNS page and turn on “HTTPS Certificates” and “Funnel”.</div>
                <button style={rowBtn} onClick={() => openUrl(URL_ADMIN_DNS)}>Open admin console</button>
              </div>
              <div style={stepRow}>
                <div style={stepNum}>3</div>
                <div style={stepTxt}>Switch now: the app asks you to sign in, then the permanent link appears here by itself.</div>
                <button style={rowBtn} disabled={busy} onClick={restart}>{busy ? '…' : 'Switch to the permanent link'}</button>
              </div>
            </>
          )}
        </>
      )}

      <div style={{ height: '16px' }} />
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Access token</div>
      <div style={{ height: '6px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={urlBox}>{token || '—'}</div>
        <button style={rowBtn} disabled={!token} onClick={() => copy(token, 'tok')}>{copied === 'tok' ? 'Copied' : 'Copy'}</button>
        <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-text-secondary)' }} disabled={rotating} onClick={() => setConfirmAct('token')}>{rotating ? '…' : 'Refresh'}</button>
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
          <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-accent-danger)' }} onClick={() => { setRevokeId(d.id); setConfirmAct('revoke') }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
            Revoke
          </button>
        </div>
      ))}
      {err && <div style={{ color: 'var(--q-accent-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '6px' }}>{err}</div>}

      {confirmAct && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setConfirmAct(null) }}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '24px', maxWidth: '420px', width: '90%', boxShadow: 'var(--shadow-modal)' }}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
              {confirmAct === 'token' ? 'Refresh access token?' : 'Revoke this device?'}
            </div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' }}>
              {confirmAct === 'token'
                ? 'Old pairing links stop working. Devices already paired keep working.'
                : 'This device loses access immediately. You can pair it again with a new pairing link.'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmAct(null)}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmAct === 'token' ? doRotateToken : doRevoke}
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
