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
          const n = new Notification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' })
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
    case 'copy_to_attachments': {
      // Web: il file e' stato caricato sul Mac; ora entra SUBITO nella cartella
      // allegati della sessione (stesso nome <uuid>-<nome> del desktop), via sidecar.
      try {
        const call = (globalThis as Any).__sidecarCall
        if (!call) return null
        return await call('copyToAttachments', { srcPath: String(args?.srcPath || ''), sessionKey: String(args?.sessionKey || '') })
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


// === PUSH (web app / PWA): richiesta automatica del permesso + subscription ===
// Le notifiche arrivano anche quando la web app e' chiusa (push del browser).
try {
  const w = globalThis as Any
  const hasPush = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in (w as any) && w.Notification
  if (hasPush) {
    const doSetup = async () => {
      try {
        if (Notification.permission === 'default') {
          const p = await Notification.requestPermission()
          if (p !== 'granted') return
        }
        if (Notification.permission !== 'granted') return
        const reg = await navigator.serviceWorker.ready
        let sub: any = await reg.pushManager.getSubscription()
        if (!sub) {
          const call = w.__sidecarCall
          if (!call) return
          const kr: any = await call('pushGetKey', {})
          const pub = kr && (kr.key || kr.publicKey)
          if (!pub) return
          const pad = pub.replace(/-/g, '+').replace(/_/g, '/')
          const raw = atob(pad)
          const arr = new Uint8Array(raw.length)
          for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: arr })
        }
        if (sub && w.__sidecarCall) await w.__sidecarCall('pushSubscribe', { subscription: sub.toJSON() })
      } catch {}
    }
    // Richiesta automatica: subito, e comunque al primo gesto (compatibile con tutti i browser)
    let kicked = false
    const kick = () => { if (kicked) return; kicked = true; doSetup() }
    try { setTimeout(kick, 4000) } catch {}
    window.addEventListener('pointerdown', kick, { once: true })
    window.addEventListener('keydown', kick, { once: true })
  }
} catch {}


// === Android: sul tocco, il long-press su un link apriva "copia URL"/anteprima ===
// Lo sopprimiamo SOLO sui dispositivi touch (il desktop col tasto destro resta intatto).
try {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    document.addEventListener('contextmenu', function (e: any) {
      try {
        const t = e.target
        if (t && t.closest && t.closest('a')) { e.preventDefault(); e.stopPropagation() }
      } catch {}
    }, true)
  }
} catch {} // contextmenu-linkguard
