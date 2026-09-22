// === Mobile chat entry gate ===
// Directiva utente (22 set): dal telefono, aprendo la tab chat si entra SEMPRE
// nella welcome chat (nuova chat). No-op su desktop/iPad (mob=false).
import { useEffect } from 'react'

export function MobileChatEntryGate({ mob, tab, windowLabel, taskChatMode, onEnterWelcome }: {
  mob: boolean
  tab: string
  windowLabel: string
  taskChatMode: boolean
  onEnterWelcome: () => void
}) {
  useEffect(() => {
    if (mob && tab === 'chat' && windowLabel === 'main' && !taskChatMode) {
      try {
        onEnterWelcome()
      } catch {}
    }
  }, [mob, tab, windowLabel, taskChatMode])
  return null
}
