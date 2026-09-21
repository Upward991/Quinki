// === Web shim for @tauri-apps/api/core (vite alias, web build only) ===
// The desktop app keeps the real Tauri API: this module lets the same UI run in a
// browser (served by the sidecar). Desktop-only commands (tray, updater, TCC, expert
// sync, local file paths) resolve to null instead of throwing, so flows degrade softly.
type Any = any

export async function invoke(cmd: string, args?: Any): Promise<Any> {
  switch (cmd) {
    case 'open_url': {
      try {
        const u = String(args?.url || args || '')
        if (u) window.open(u, '_blank', 'noopener,noreferrer')
      } catch {}
      return null
    }
    case 'send_notification': {
      try {
        const title = String(args?.title || 'Quinki')
        const body = String(args?.body || args?.message || '')
        if ((window as Any).Notification && Notification.permission === 'granted') new Notification(title, { body })
      } catch {}
      return null
    }
    case 'request_notification_permission': {
      try {
        if ((window as Any).Notification && Notification.permission === 'default') await Notification.requestPermission()
      } catch {}
      return null
    }
    case 'get_window_label':
      return 'main'
    case 'is_autostart_enabled':
      return false
    case 'get_quick_chat_shortcut':
      return 'Option+Space'
    case 'check_expert_running':
    case 'check_expert_installed':
    case 'check_expert_backup_exists':
      return false
    default:
      // Desktop-only command (updater, tray, window controls, expert sync, local
      // files). No-op in web: log once per command to keep the console readable.
      try {
        const w = globalThis as Any
        w.__quinki_noopCmds = w.__quinki_noopCmds || new Set<string>()
        if (!w.__quinki_noopCmds.has(cmd)) {
          w.__quinki_noopCmds.add(cmd)
          console.warn('[web] desktop-only command ignored:', cmd)
        }
      } catch {}
      return null
  }
}

export async function convertFileSrc(filePath: string): Promise<string> {
  return filePath
}
