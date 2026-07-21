import { useState, useEffect } from 'react'

export function GlobalContextMenu() {
  const [e, setE] = useState<{x: number, y: number, target: any} | null>(null)

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const n = ev.target as HTMLElement
      if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable) {
        ev.preventDefault()
        setE({ x: ev.clientX, y: ev.clientY, target: ev.target })
      }
    }
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])

  if (!e) return null

  const n = Math.min(e.x, window.innerWidth - 160)
  const r = Math.min(e.y, window.innerHeight - 140)

  return (
    <>
      <div
        className="fixed inset-0 bg-transparent"
        style={{ zIndex: 9998 }}
        onClick={() => setE(null)}
        onContextMenu={(ev) => { ev.preventDefault(); setE(null) }}
      />
      <div
        className="fixed bg-bg-panel rounded-md shadow-modal border border-border py-1 min-w-[140px] q-modal-enter"
        style={{ left: n, top: r, zIndex: 9999 }}
      >
        <MenuItem label="Copy" onClick={() => { document.execCommand('copy'); setE(null) }} />
        <MenuItem label="Paste" onClick={() => {
          navigator.clipboard.readText().then(text => {
            const target = e.target
            if (target && 'value' in target) {
              const start = target.selectionStart || 0
              const end = target.selectionEnd || 0
              target.value = target.value.substring(0, start) + text + target.value.substring(end)
              target.setSelectionRange(start + text.length, start + text.length)
              target.dispatchEvent(new Event('input', { bubbles: true }))
            }
            setE(null)
          }).catch(() => setE(null))
        }} />
        <MenuItem label="Cut" onClick={() => { document.execCommand('cut'); setE(null) }} />
      </div>
    </>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center w-full px-3 py-2 border-none cursor-pointer text-text text-14 font-interface text-left"
      style={{
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {label}
    </button>
  )
}

// Theme data export
export const cg = [
  {id:'comfort',name:'Comfort',bg:'#08080B',bgPanel:'#0F0F13',bgBubbleUser:'#1A1A20',text:'#E8E8EC'},
  {id:'midnight',name:'Midnight',bg:'#060608',bgPanel:'#0C0C10',bgBubbleUser:'#16161A',text:'#E8E8EC'},
  {id:'forest',name:'Forest',bg:'#08080A',bgPanel:'#0E0E10',bgBubbleUser:'#18181A',text:'#E8E8EC'},
  {id:'warm',name:'Warm',bg:'#0A0A0A',bgPanel:'#101010',bgBubbleUser:'#1A1A1A',text:'#E8E8EC'},
  {id:'eclipse',name:'Eclipse',bg:'#040406',bgPanel:'#0A0A0C',bgBubbleUser:'#141416',text:'#E8E8EC'},
  {id:'graphite',name:'Graphite',bg:'#0C0C0E',bgPanel:'#121214',bgBubbleUser:'#1E1E20',text:'#E8E8EC'},
  {id:'mist',name:'Mist',bg:'#141416',bgPanel:'#1A1A1C',bgBubbleUser:'#262628',text:'#E8E8EC'},
]