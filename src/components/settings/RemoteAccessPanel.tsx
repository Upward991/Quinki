// ============================================================
// Web app / Remote access — Impostazioni.
//
// UNA SOLA VIA: Tailscale (nodo embedded, niente da installare, niente app
// sul telefono). Il link permanente <nome>.ts.net non cambia mai.
// Setup utente ridotto al minimo e spiegato chiaramente:
//   1. Sign in with Tailscale  -> apre la pagina, autorizza il Mac
//   2. Open admin console      -> accende "HTTPS Certificates" e "Funnel"
// Il link appare da solo quando entrambi sono fatti.
// Log out: esce da Tailscale e cancella l'iscrizione di questo Mac.
// ============================================================
import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Globe } from '../icons'

const URL_ADMIN_DNS = 'https://login.tailscale.com/admin/dns'

export function RemoteAccessSection() {
  const [status, setStatus] = useState<{ running: boolean; url: string; authUrl?: string }>({ running: false, url: '' })
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [token, setToken] = useState('')
  const [devices, setDevices] = useState<any[]>([])
  const [rotating, setRotating] = useState(false)
  const [confirmAct, setConfirmAct] = useState<null | 'token' | 'revoke' | 'logout'>(null)
  const [revokeId, setRevokeId] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const s: any = await invoke('remote_tunnel_status')
        if (!cancelled && s) setStatus({ running: !!s.running, url: String(s.url || ''), authUrl: String(s.authUrl || '') })
      } catch {}
      try {
        const st: any = await invoke('remote_tunnel_state')
        if (!cancelled && st) setEnabled(!!st.enabled)
      } catch {}
    }
    ;(async () => {
      await load()
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
        const st2: any = await invoke('remote_tunnel_state')
        if (!cancelled && st2) setEnabled(!!st2.enabled)
      } catch {}
      try {
        const d2: any = await invoke('remote_devices_list')
        if (!cancelled && Array.isArray(d2)) setDevices(prev => JSON.stringify(prev) === JSON.stringify(d2) ? prev : d2)
      } catch {}
    }, 3000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const withToken = (base: string) => (base && token ? `${base}/?token=${token}` : base)
  const openUrl = (url: string) => { invoke('open_url', { url }).catch(() => {}) }

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

  // Sign in with Tailscale: UN click. Avvia/riavvia il nodo se serve, aspetta
  // il link di autorizzazione e apre il browser da solo. Se il nodo e' gia'
  // iscritto (o il link e' gia' pronto) NON si mette in attesa: niente
  // pulsanti bloccati per decine di secondi.
  const signIn = async () => {
    setBusy(true); setSigningIn(true); setErr('')
    try {
      // se c'e' ancora un link vecchio/temporaneo, ripartiamo pulito col nodo
      if (status.url && !status.url.includes('.ts.net')) {
        try { await invoke('remote_tunnel_stop') } catch {}
      }
      const url: any = await invoke('remote_tunnel_start', { port: 9182, hostname: '' })
      setEnabled(true)
      setStatus(prev => ({ running: !!url, url: String(url || ''), authUrl: prev.authUrl || '' }))
      if (url) { setSigningIn(false); setBusy(false); return } // gia' pronto: niente attesa
      let auth = String(status.authUrl || '')
      for (let i = 0; i < 16 && !auth; i++) {
        await new Promise(r => setTimeout(r, 500))
        try {
          const s: any = await invoke('remote_tunnel_status')
          const u = String(s?.url || '')
          if (u) { setStatus({ running: true, url: u, authUrl: '' }); break }
          auth = String(s?.authUrl || '')
          setStatus({ running: !!s?.running, url: u, authUrl: auth })
        } catch {}
      }
      if (auth) { openUrl(auth); setTimeout(() => setSigningIn(false), 1000) }
      else { setSigningIn(false) }
    } catch (e: any) {
      setSigningIn(false)
      setErr(String((e && e.message) ? e.message : e))
    }
    setBusy(false)
  }

  const doLogout = async () => {
    setConfirmAct(null); setBusy(true); setErr('')
    try {
      await invoke('remote_logout')
      setEnabled(false)
      setStatus({ running: false, url: '', authUrl: '' })
    } catch (e: any) { setErr('Log out failed: ' + String((e && e.message) ? e.message : e)) }
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
  const stepNum: React.CSSProperties = {
    width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
    backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--q-text-secondary)', fontSize: '11px', fontFamily: 'var(--font-code)',
  }
  const stepRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0' }
  const stepTxt: React.CSSProperties = { flex: 1, minWidth: 0, color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.45 }

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

  const ready = !!status.url && status.url.includes('.ts.net')
  const needsSignIn = !ready && !signingIn && !!status.authUrl
  const step1Done = !ready && !signingIn && enabled && !status.authUrl && !status.url

  return (
    <div id="settings-webapp" style={{ width: '100%', marginBottom: '12px', padding: '14px 18px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Globe size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Web app</span>
      </div>
      {!!err && (
        <div style={{ marginBottom: '8px', padding: '8px 12px', border: '1px solid var(--q-accent-danger)', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255,80,80,0.08)', color: 'var(--q-accent-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>{err}</div>
      )}

      {/* ---------- tutto pronto: il link ---------- */}
      {ready && (
        <>
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>
            Quinki is online: open the link below on your phone or another computer to use it from anywhere (same sessions, same data as this Mac). On the phone, use “Install app” to keep it as a real app with its icon.
          </div>
          <div style={{ height: '12px' }} />
          <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Your permanent link</div>
          <div style={{ height: '6px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={urlBox}>{status.url}</div>
            <button style={rowBtn} onClick={() => copy(withToken(status.url), 'tun')}>{copied === 'tun' ? 'Copied' : 'Copy'}</button>
          </div>
          <div style={{ height: '6px' }} />
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
            This link never changes, not even after updates or restarts of this Mac.
          </div>
          <div style={{ height: '10px' }} />
          <button style={{ ...rowBtn, borderColor: 'var(--q-border)', color: 'var(--q-accent-danger)' }} disabled={busy} onClick={() => setConfirmAct('logout')}>Log out</button>
        </>
      )}

      {/* ---------- setup guidato ---------- */}
      {!ready && (
        <>
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>
            To use Quinki from your phone or another computer, sign in with Tailscale. It creates a private, free connection between your devices. Nothing gets installed on the phone.
          </div>
          <div style={{ height: '12px' }} />
          <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Setup, one time only (2 steps)</div>
          <div style={{ height: '2px' }} />
          <div style={stepRow}>
            <div style={stepNum}>{step1Done ? '✓' : '1'}</div>
            <div style={stepTxt}>
              {signingIn
                ? 'Waiting for the sign-in… finish it in the browser, then come back here.'
                : step1Done
                  ? 'Signed in. (You can press the button again any time.)'
                  : 'Sign in with Tailscale and authorize this Mac. No account yet? You create it right there, free (Google, GitHub or email).'}
            </div>
            <button style={rowBtn} disabled={busy} onClick={signIn}>{busy ? '…' : 'Sign in with Tailscale'}</button>
          </div>
          <div style={stepRow}>
            <div style={stepNum}>2</div>
            <div style={stepTxt}>
              In the Tailscale admin console, on the DNS page, turn on “HTTPS Certificates” and “Funnel”. This makes the link reachable from your phone.
            </div>
            <button style={rowBtn} onClick={() => openUrl(URL_ADMIN_DNS)}>Open admin console</button>
          </div>
          <div style={{ height: '4px' }} />
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
            The permanent link appears here by itself when both steps are done. You can also do them in any order.
          </div>
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

      {confirmAct && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e: any) => { if (e.target === e.currentTarget) setConfirmAct(null) }}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '24px', maxWidth: '420px', width: '90%', boxShadow: 'var(--shadow-modal)' }}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
              {confirmAct === 'token' ? 'Refresh access token?' : confirmAct === 'revoke' ? 'Revoke this device?' : 'Log out from Tailscale?'}
            </div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' }}>
              {confirmAct === 'token'
                ? 'Old pairing links stop working. Devices already paired keep working.'
                : confirmAct === 'revoke'
                  ? 'This device loses access immediately. You can pair it again with a new pairing link.'
                  : 'The permanent link stops working and this Mac leaves your Tailscale network. You can sign in again at any time (a new link will be created).'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmAct(null)}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmAct === 'token' ? doRotateToken : confirmAct === 'revoke' ? doRevoke : doLogout}
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
