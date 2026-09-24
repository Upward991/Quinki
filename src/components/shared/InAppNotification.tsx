import React, { useEffect, useState } from 'react'

// === POPUP IN-APP (scelta "C", 24 set) ===
// Su macOS 27 i banner di sistema non vengono più mostrati quando l'app è in
// primo piano (verificato con la traccia: macOS riceve le opzioni corrette e li
// scarta). Quando una chat risponde mentre l'app è davanti ma stai guardando
// UN'ALTRA chat, il popup arriva qui dentro la finestra. Se l'app è dietro, il
// banner macOS normale fa il suo lavoro.
type Toast = { id: number; title: string; body: string; sk: string }

export function InAppNotification() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const onToast = (e: any) => {
      const d = e?.detail || {}
      if (!d.title) return
      const t: Toast = { id: Date.now() + Math.random(), title: String(d.title), body: String(d.body || ''), sk: String(d.sk || '') }
      setToasts(prev => [...prev.slice(-2), t])
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 6000)
    }
    window.addEventListener('quinki-inapp-toast', onToast)
    return () => window.removeEventListener('quinki-inapp-toast', onToast)
  }, [])

  if (!toasts.length) return null
  return (
    <div style={{ position: 'fixed', top: '34px', right: '12px', zIndex: 350, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {toasts.map(t => (
        <div key={t.id}
          onClick={() => {
            try { window.dispatchEvent(new CustomEvent('quinki-open-session', { detail: t.sk })) } catch {}
            setToasts(prev => prev.filter(x => x.id !== t.id))
          }}
          style={{ width: '320px', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', padding: '12px', cursor: 'pointer', transition: 'none' }}>
          <div style={{ color: 'var(--q-text)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
          <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.4, overflow: 'hidden' }}>{t.body}</div>
        </div>
      ))}
    </div>
  )
}
