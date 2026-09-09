import React, { useState, useEffect } from 'react'
import { Copy } from '../icons'

// Menu contestuale CUSTOM su input/textarea (sostituisce quello nativo di macOS):
// Copy / Paste / Cut / Select All. Paste usa il plugin clipboard-manager di Tauri
// (fallback navigator.clipboard.readText).
type MenuState = { x: number; y: number; target: HTMLElement } | null

export function GlobalContextMenu() {
  const [menu, setMenu] = useState<MenuState>(null)

  useEffect(() => {
    const onCtx = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement
      if (!t || !t.tagName) return
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
        ev.preventDefault()
        setMenu({ x: ev.clientX, y: ev.clientY, target: t })
      }
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [])

  const insertAtCursor = (field: HTMLElement, text: string) => {
    if (!field || !('value' in field)) return
    const el = field as HTMLInputElement & HTMLTextAreaElement
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    el.value = el.value.substring(0, start) + text + el.value.substring(end)
    el.setSelectionRange(start + text.length, start + text.length)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const doPaste = () => {
    const target = menu?.target
    if (!target) return
    const paste = (text: string) => { insertAtCursor(target, text); setMenu(null) }
    const w = window as any
    try {
      if (w.__TAURI_INTERNALS__) {
        w.__invoke?.(`plugin:clipboard-manager|read_text`)
          .then((n: string) => paste(n))
          .catch(() => navigator.clipboard.readText().then(paste).catch(() => setMenu(null)))
      } else {
        navigator.clipboard.readText().then(paste).catch(() => setMenu(null))
      }
    } catch { setMenu(null) }
  }

  const doCopy = () => {
    const target = menu?.target
    if (!target || !('value' in target)) { setMenu(null); return }
    const el = target as HTMLInputElement
    const text = el.value.substring(el.selectionStart ?? 0, el.selectionEnd ?? 0)
    const w = window as any
    try {
      if (w.__TAURI_INTERNALS__) {
        w.__invoke?.(`plugin:clipboard-manager|write_text`, { text })
          .catch(() => navigator.clipboard.writeText(text).catch(() => document.execCommand('copy')))
      } else {
        navigator.clipboard.writeText(text).catch(() => document.execCommand('copy'))
      }
    } catch {}
    setMenu(null)
  }

  const doCut = () => {
    const target = menu?.target
    if (!target || !('value' in target)) { setMenu(null); return }
    const el = target as HTMLInputElement
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const text = el.value.substring(start, end)
    try { navigator.clipboard.writeText(text).catch(() => document.execCommand('copy')) } catch {}
    el.value = el.value.substring(0, start) + el.value.substring(end)
    el.setSelectionRange(start, start)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    setMenu(null)
  }

  const doSelectAll = () => {
    const target = menu?.target
    if (!target || !('value' in target)) { setMenu(null); return }
    const el = target as HTMLInputElement
    el.select()
    el.setSelectionRange(0, el.value.length)
    setMenu(null)
  }

  if (!menu) return null

  const MH = 4 * 36 + 16
  const n = Math.min(menu.x, window.innerWidth - 152)
  const r = menu.y + MH > window.innerHeight ? Math.max(8, window.innerHeight - MH - 8) : menu.y

  const Item = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => {
    const [hover, setHover] = useState(false)
    return React.createElement('button', {
      onClick,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: {
        display: 'flex', alignItems: 'center', width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer',
        backgroundColor: hover ? 'var(--q-hover)' : 'transparent',
        color: danger ? 'var(--q-accent-danger)' : 'var(--q-text)',
        fontSize: '14px', fontFamily: 'var(--font-interface)', textAlign: 'left',
        transform: hover ? 'scale(1.02)' : 'scale(1)', transition: 'none',
      },
      children: label,
    })
  }

  return React.createElement(React.Fragment, null, [
    React.createElement('div', {
      key: 'ov', style: { position: 'fixed', inset: 0, zIndex: 9998, backgroundColor: 'transparent' },
      onClick: () => setMenu(null),
      onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); setMenu(null) },
    }),
    React.createElement('div', {
      key: 'menu',
      style: {
        position: 'fixed', left: Math.max(8, n), top: r, zIndex: 9999,
        backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '4px 0', minWidth: '140px',
      },
      children: [
        React.createElement(Item, { key: 'copy', label: 'Copy', onClick: doCopy }),
        React.createElement(Item, { key: 'paste', label: 'Paste', onClick: doPaste }),
        React.createElement(Item, { key: 'cut', label: 'Cut', onClick: doCut }),
        React.createElement(Item, { key: 'all', label: 'Select All', onClick: doSelectAll }),
      ],
    }),
  ])
}