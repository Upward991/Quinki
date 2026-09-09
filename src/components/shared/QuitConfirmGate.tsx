import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// === Ciclo di vita chiusura app ===
// Cmd+Q (o Quit dal menu) → conferma di chiusura TOTALE (app + sidecar).
// Chiudere la sola finestra continua a funzionare con Cmd+W o il semaforo rosso.
export function QuitConfirmGate() {
  const [open, setOpen] = useState(false)
  const isExpert = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('expert') === '1'

  useEffect(() => {
    let un: (() => void) | undefined
    listen('quit_requested', () => setOpen(true))
      .then((u: any) => { un = u })
      .catch(() => {})
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { un?.(); window.removeEventListener('keydown', onKeyDown) }
  }, [])

  if (!open) return null

  const appName = isExpert ? 'App Expert' : 'Quinki'

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{ backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '20px 24px', minWidth: '360px', maxWidth: '440px' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
          Quit {appName}?
        </div>
        <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' }}>
          Quitting closes the app and its background service. The recovery system resumes interrupted messages and tasks automatically the next time you open the app.
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
            onClick={() => { try { invoke('quit_app') } catch {} }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--q-accent-danger)'; e.currentTarget.style.color = 'var(--q-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-accent-danger)' }}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-accent-danger)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
          >
            Quit App
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
