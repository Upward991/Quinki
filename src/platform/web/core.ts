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
        if ((window as Any).Notification && Notification.permission === 'granted') {
          const n = new Notification(title, { body })
          n.onclick = () => { try { window.focus() } catch {} }
        }
      } catch {}
      return null
    }
    case 'request_notification_permission': {
      try {
        if ((window as Any).Notification && Notification.permission === 'default') await Notification.requestPermission()
      } catch {}
      return null
    }
    case 'export_chat_file': {
      // In web l'export scarica il file dal browser (stesso percorso della app:
      // .md / .html generati dalla UI).
      try {
        const content = String(args?.content || '')
        const filename = String(args?.filename || 'quinki-export.txt')
        const ext = String(args?.extension || '').toLowerCase()
        const mime = ext === 'html' ? 'text/html' : ext === 'md' ? 'text/markdown' : 'text/plain'
        const blob = new Blob([content], { type: mime + ';charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 3000)
        return filename
      } catch { return null }
    }
    case 'copy_to_clipboard': {
      try {
        const text = String(args?.text ?? '')
        await navigator.clipboard.writeText(text)
      } catch {}
      return null
    }
    case 'pick_files': {
      // Web: scelta file dal browser -> upload al sidecar (stessa origine, cookie
      // del dispositivo) -> ritorna i percorsi locali come farebbe il desktop.
      try {
        const files: File[] = await new Promise((resolve) => {
          const inp = document.createElement('input')
          inp.type = 'file'
          inp.multiple = true
          inp.style.display = 'none'
          document.body.appendChild(inp)
          inp.onchange = () => resolve(Array.from(inp.files || []))
          inp.oncancel = () => resolve([])
          inp.click()
        })
        const out: string[] = []
        for (const f of files) {
          try {
            const r = await fetch('/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
            const j: any = await r.json().catch(() => null)
            if (j && j.ok && j.path) out.push(String(j.path))
          } catch {}
        }
        return out.length ? out : null
      } catch { return null }
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
