// === Mobile layout flag ===
// One flag decides desktop vs phone UI:
//   - auto (default): a PHONE (web, narrow screen) gets the mobile layout; the desktop
//     app and tablets (iPad, wide screens) always keep the desktop layout
//   - manual override (persisted, or ?layout=mobile|desktop in the URL for testing)
import { useEffect, useState } from 'react'

export type LayoutMode = 'auto' | 'mobile' | 'desktop'

const KEY = 'quinki-layout'

// Phones are <= 480 CSS px wide; small tablets/iPads are >= 744: the gap keeps
// tablets on the desktop layout.
export const MOBILE_MAX_WIDTH = 600

function isTauriRuntime(): boolean {
  try {
    return !!(globalThis as any).__TAURI_INTERNALS__
  } catch {
    return false
  }
}

export function readLayoutOverride(): LayoutMode {
  try {
    const q = new URLSearchParams(window.location.search).get('layout')
    if (q === 'mobile' || q === 'desktop' || q === 'auto') {
      window.localStorage.setItem(KEY, q)
      return q
    }
  } catch {}
  try {
    const v = window.localStorage.getItem(KEY)
    if (v === 'mobile' || v === 'desktop' || v === 'auto') return v as LayoutMode
  } catch {}
  return 'auto'
}

export function useLayout(): { mode: 'mobile' | 'desktop'; override: LayoutMode } {
  const [override] = useState<LayoutMode>(() => readLayoutOverride())
  const [narrow, setNarrow] = useState<boolean>(() => {
    try {
      return window.innerWidth <= MOBILE_MAX_WIDTH
    } catch {
      return false
    }
  })
  useEffect(() => {
    const onResize = () => {
      try {
        setNarrow(window.innerWidth <= MOBILE_MAX_WIDTH)
      } catch {}
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // TELEFONO (touch + stretto): SEMPRE layout mobile, qualunque override sia
  // stato salvato in passato (un test vecchio con ?layout=desktop teneva il
  // telefono bloccato sul layout desktop: tutti i fix mobile invisibili).
  const isTouch = (() => { try { return ('ontouchstart' in window) || ((navigator as any).maxTouchPoints || 0) > 0 } catch { return false } })()
  const forcePhone = !isTauriRuntime() && narrow && isTouch
  const mode: 'mobile' | 'desktop' = forcePhone ? 'mobile' : (override === 'auto' ? (!isTauriRuntime() && narrow ? 'mobile' : 'desktop') : override)
  return { mode, override }
}
