// === Mobile chat entry gate ===
// Directiva utente (22 set): dal telefono, aprendo la tab chat si entra SEMPRE
// nella welcome chat (nuova chat). No-op su desktop/iPad (mob=false).
import { useEffect, useRef } from 'react'

export function MobileChatEntryGate({ mob, tab, windowLabel, taskChatMode, onEnterWelcome, onRestoreSession }: {
  mob: boolean
  tab: string
  windowLabel: string
  taskChatMode: boolean
  onEnterWelcome: () => void
  onRestoreSession?: (key: string) => void
}) {
  // Il primo run dopo il caricamento pagina: se la pagina si e' appena ricaricata
  // da sola (tipico su Android tornando dalla fotocamera) riapriamo la chat di
  // prima invece di scaricare tutto nella welcome. I run successivi (cambio tab)
  // seguono la regola normale: la tab Chat entra nella welcome.
  const firstRun = useRef(true)
  useEffect(() => {
    if (mob && tab === 'chat' && windowLabel === 'main' && !taskChatMode) {
      try {
        if (firstRun.current) {
          firstRun.current = false
          const key = sessionStorage.getItem('quinki-last-session')
          const ts = Number(sessionStorage.getItem('quinki-last-session-ts') || '0')
          if (key && Date.now() - ts < 90000 && onRestoreSession) { onRestoreSession(key); return }
        }
        onEnterWelcome()
      } catch { try { onEnterWelcome() } catch {} }
    }
  }, [mob, tab, windowLabel, taskChatMode])
  return null
}
