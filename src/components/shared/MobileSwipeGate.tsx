// === Mobile swipe gate ===
// Direttiva utente (22 set): la sidebar si apre trascinando il dito da SINISTRA verso
// DESTRA e si vede muoversi IN TEMPO REALE (il pannello segue il dito). L'inizio dello
// swipe e' generoso: va bene da qualsiasi punto della meta' sinistra dello schermo.
// Con la sidebar aperta, il trascinamento verso sinistra la chiude.
// NOTA: i listener sono registrati UNA volta (deps [mob]) e leggono props/stato via ref:
// registrare l'effetto a ogni render azzerava il gesto a meta' trascinamento
// (ogni setSwipeX ri-renderizzava App -> cleanup+setup -> active/x0 persi).
import { useEffect, useRef } from 'react'

export function MobileSwipeGate({ mob, sidebarOpen, setSwipeX, onOpenSidebar, onCloseSidebar }: {
  mob: boolean
  sidebarOpen: boolean
  setSwipeX: (x: number | null) => void
  onOpenSidebar: () => void
  onCloseSidebar: () => void
}) {
  const ref = useRef({ sidebarOpen, setSwipeX, onOpenSidebar, onCloseSidebar })
  ref.current = { sidebarOpen, setSwipeX, onOpenSidebar, onCloseSidebar }

  useEffect(() => {
    if (!mob) return
    const st = { active: false, x0: 0, y0: 0, w: 0 }
    const onStart = (e: TouchEvent) => {
      if (st.active) return
      const t = e.touches[0]
      if (!t) return
      const p = ref.current
      st.w = window.innerWidth || 390
      st.x0 = t.clientX
      st.y0 = t.clientY
      if (!p.sidebarOpen) {
        if (st.x0 <= st.w * 0.5) {
          st.active = true
          p.setSwipeX(-st.w)
        }
      } else {
        st.active = true
      }
    }
    const onMove = (e: TouchEvent) => {
      if (!st.active) return
      const t = e.touches[0]
      if (!t) return
      const p = ref.current
      const dx = t.clientX - st.x0
      if (!p.sidebarOpen) p.setSwipeX(Math.min(0, -st.w + Math.max(0, dx)))
      else p.setSwipeX(Math.min(0, Math.min(dx, 0)))
    }
    const onEnd = (e: TouchEvent) => {
      if (!st.active) return
      st.active = false
      const p = ref.current
      const t = e.changedTouches[0]
      const dx = (t ? t.clientX : st.x0) - st.x0
      const dy = Math.abs((t ? t.clientY : st.y0) - st.y0)
      if (dy <= 90) {
        if (!p.sidebarOpen) {
          if (dx > st.w * 0.3) p.onOpenSidebar()
        } else {
          if (dx < -st.w * 0.3) p.onCloseSidebar()
        }
      }
      p.setSwipeX(null)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [mob])

  return null
}
