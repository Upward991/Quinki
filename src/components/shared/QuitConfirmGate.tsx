import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// === Ciclo di vita chiusura app ===
// Cmd+Q (o quit dal menu macOS) → Rust fa prevent_exit + emette "quit_requested".
// Questo gate mostra il modale con 3 opzioni:
//   - Cancel                    → non chiudere nulla
//   - Close Window Only         → nasconde la finestra (tray/Dock resta, backend resta)
//   - Quit App & Backend        → chiude frontend + backend (le task interrotte riprendono al riavvio)
export function QuitConfirmGate() {
  const [open, setOpen] = useState(false)
  const isExpert = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('expert') === '1'

  useEffect(() => {
    let un: (() => void) | undefined
    listen('quit_requested', () => setOpen(true))
      .then((u: any) => { un = u })
      .catch(() => {})
    return () => { un?.() }
  }, [])

  if (!open) return null

  const appName = isExpert ? 'App Expert' : 'Quinki'

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{ backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '20px 24px', minWidth: '380px', maxWidth: '460px' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
          Close {appName}?
        </div>
        <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' }}>
          Choose what happens when you close the app:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)' }}>
            <span style={{ color: 'var(--q-tab-accent)', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 600, flexShrink: 0 }}>Close Window Only</span>
            <span style={{ color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.4 }}>
              The window closes. The app stays in the menu bar{isExpert ? '' : ' / tray'} and the background service keeps running: notifications and scheduled tasks continue.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)' }}>
            <span style={{ color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 600, flexShrink: 0 }}>Quit App &amp; Backend</span>
            <span style={{ color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.4 }}>
              Closes the app and its background service. Interrupted messages and tasks resume automatically the next time you open it.
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={() => setOpen(false)}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => { try { invoke('hide_to_tray') } catch {} setOpen(false) }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
          >
            Close Window Only
          </button>
          <button
            onClick={() => { try { invoke('quit_app') } catch {} }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--q-accent-danger)'; e.currentTarget.style.color = 'var(--q-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-accent-danger)' }}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-accent-danger)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
          >
            Quit App &amp; Backend
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
