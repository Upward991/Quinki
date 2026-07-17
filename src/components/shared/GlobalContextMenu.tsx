// ============================================================
// GlobalContextMenu — shows Cut/Copy/Paste on right-click
// for any text input in the app
// ============================================================

import { useState, useEffect } from 'react'

export function GlobalContextMenu() {
  const [menu, setMenu] = useState<{x: number, y: number, target: EventTarget | null} | null>(null)

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Only show for text inputs and textareas
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, target: e.target })
      }
    }
    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [])

  if (!menu) return null

  const x = Math.min(menu.x, window.innerWidth - 160)
  const y = Math.min(menu.y, window.innerHeight - 140)

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998, backgroundColor: 'transparent' }}
        onClick={() => setMenu(null)}
        onContextMenu={e => { e.preventDefault(); setMenu(null) }} />
      <div style={{
        position: 'fixed', left: x, top: y, zIndex: 9999,
        backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)',
        padding: '4px 0', minWidth: '140px',
      }}>
        <CtxItem label="Copy" onClick={() => { document.execCommand('copy'); setMenu(null) }} />
        <CtxItem label="Paste" onClick={() => {
          navigator.clipboard.readText().then(text => {
            const target = menu.target as HTMLInputElement | HTMLTextAreaElement
            if (target && 'value' in target) {
              const start = target.selectionStart || 0
              const end = target.selectionEnd || 0
              target.value = target.value.substring(0, start) + text + target.value.substring(end)
              target.setSelectionRange(start + text.length, start + text.length)
              target.dispatchEvent(new Event('input', { bubbles: true }))
            }
            setMenu(null)
          }).catch(() => setMenu(null))
        }} />
        <CtxItem label="Cut" onClick={() => { document.execCommand('cut'); setMenu(null) }} />
      </div>
    </>
  )
}

function CtxItem({ label, onClick }: { label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', width: '100%',
        padding: '8px 12px', border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)',
        textAlign: 'left',
      }}>
      {label}
    </button>
  )
}
