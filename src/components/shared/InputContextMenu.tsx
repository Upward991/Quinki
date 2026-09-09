import React, { useState, useEffect, useRef } from 'react'

// Context Menu CUSTOM per input/textarea — stile Quinki (dark theme).
// Sostituisce COMPLETAMENTE il menu nativo WKWebView (preventDefault capture).
// Cut/Copy usano execCommand (nativo del webview, sempre affidabile).
// Paste usa il Tauri clipboard plugin.

type MenuState = { x: number; y: number; el: HTMLInputElement | HTMLTextAreaElement } | null

export function InputContextMenu() {
  const [menu, setMenu] = useState<MenuState>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onCtx = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement
      if (!t) return
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
        ev.preventDefault()
        ev.stopPropagation()
        // NON salvare la selezione: lasciala com'è (l'utente l'ha fatta lui)
        setMenu({ x: ev.clientX, y: ev.clientY, el: t as HTMLInputElement })
      } else {
        // Fuori dagli input: blocca TUTTO (niente Reload/Inspect)
        ev.preventDefault()
      }
    }
    // capture: true → intercetta PRIMA di qualunque altro handler
    document.addEventListener('contextmenu', onCtx, { capture: true })
    return () => document.removeEventListener('contextmenu', onCtx, { capture: true })
  }, [])

  // Chiudi su click fuori, Escape, scroll
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) setMenu(null)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  if (!menu) return null

  const el = menu.el
  const hasSel = (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0)

  const itemStyle = (enabled: boolean): React.CSSProperties => ({
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 14px', cursor: enabled ? 'pointer' : 'default',
    color: enabled ? 'var(--q-text)' : 'var(--q-text-tertiary)',
    fontSize: '13px', fontFamily: 'var(--font-interface)',
    whiteSpace: 'nowrap', gap: '24px', userSelect: 'none',
    transition: 'none',
  })

  const scStyle: React.CSSProperties = {
    color: 'var(--q-text-tertiary)', fontSize: '11px',
    fontFamily: 'var(--font-code)',
  }

  const doCut = () => {
    if (!hasSel) return
    el.focus()
    // execCommand('cut') — nativo del webview, taglia E copia nella clipboard
    document.execCommand('cut')
    // dispatch per React
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const doCopy = () => {
    if (!hasSel) return
    el.focus()
    document.execCommand('copy')
  }

  const doPaste = () => {
    el.focus()
    const w = window as any
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const insert = (text: string) => {
      el.value = el.value.substring(0, start) + text + el.value.substring(end)
      el.setSelectionRange(start + text.length, start + text.length)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // Tauri clipboard plugin (affidabile in WKWebView)
    if (w.__TAURI_INTERNALS__ && w.__invoke) {
      w.__invoke('plugin:clipboard-manager|read_text')
        .then((n: string) => insert(n))
        .catch(() => {})
    } else {
      navigator.clipboard.readText().then(insert).catch(() => {})
    }
  }

  const doSelectAll = () => {
    el.focus()
    el.select()
  }

  const items = [
    { label: 'Cut', sc: '⌘X', fn: doCut, enabled: true },
    { label: 'Copy', sc: '⌘C', fn: doCopy, enabled: hasSel },
    { label: 'Paste', sc: '⌘V', fn: doPaste, enabled: true },
    { label: 'Select All', sc: '⌘A', fn: doSelectAll, enabled: true },
  ]

  // Posizionamento intelligente (mai fuori dalla finestra)
  const menuW = 200, menuH = items.length * 32 + 8
  let x = menu.x, y = menu.y
  if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 4
  if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4
  if (x < 0) x = 4; if (y < 0) y = 4

  return (
    <div ref={menuRef} style={{
      position: 'fixed', left: x, top: y, zIndex: 99999,
      backgroundColor: 'var(--q-bg-panel)',
      border: '1px solid var(--q-border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      padding: '4px 0', minWidth: '180px',
    }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={itemStyle(item.enabled)}
          onMouseEnter={(e) => { if (item.enabled) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          onClick={(e) => { e.stopPropagation(); setMenu(null); if (item.enabled) item.fn() }}
        >
          <span>{item.label}</span>
          <span style={scStyle}>{item.sc}</span>
        </div>
      ))}
    </div>
  )
}
