// === Mobile swipe gate ===
// Direttiva utente (22 set): la sidebar si apre con uno swipe da SINISTRA verso DESTRA
// (dito che parte dal bordo sinistro e va verso destra). Con la sidebar aperta (full
// screen), lo swipe inverso (destra -> sinistra) la richiude. Solo visione mobile.
import { useEffect } from 'react'

export function MobileSwipeGate({ mob, sidebarOpen, onOpenSidebar, onCloseSidebar }: {
  mob: boolean
  sidebarOpen: boolean
  onOpenSidebar: () => void
  onCloseSidebar: () => void
}) {
  useEffect(() => {
    if (!mob) return
    let x0: number | null = null
    let y0 = 0
    let edge = false
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      x0 = t.clientX
      y0 = t.clientY
      edge = t.clientX <= 90
    }
    const onEnd = (e: TouchEvent) => {
      if (x0 == null) return
      const t = e.changedTouches[0]
      const x1 = t ? t.clientX : x0
      const y1 = t ? t.clientY : y0
      const dx = x1 - x0
      const dy = Math.abs(y1 - y0)
      const fromEdge = edge
      x0 = null
      edge = false
      if (dy > 70 || Math.abs(dx) < 50) return
      if (!sidebarOpen && fromEdge && dx > 50) { try { onOpenSidebar() } catch {} }
      else if (sidebarOpen && dx < -50) { try { onCloseSidebar() } catch {} }
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [mob, sidebarOpen, onOpenSidebar, onCloseSidebar])
  return null
}
