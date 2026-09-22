// ============================================================
// BottomSheet — forma standard dei menu della chat in visione mobile.
// Direttiva utente (22 set): i menu/dropdown/modali della chat si aprono dal BASSO
// (stile Discord), con la barra di navigazione IDENTICA a quella del menu slash
// (4 frecce + Close con la grafica del Cancel). Si chiude trascinando giù,
// col tasto Close o toccando il backdrop.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from '../icons'

export interface SheetItem {
  icon?: React.ReactNode
  label: string
  value?: string
  onSelect: () => void
}

export function BottomSheet({ open, onClose, items, view, onViewBack, title }: {
  open: boolean
  onClose: () => void
  items: SheetItem[]
  view?: React.ReactNode | null
  onViewBack?: () => void
  title?: string
}) {
  const [sel, setSel] = useState(0)
  const [dragY, setDragY] = useState(0)
  const startY = useRef<number | null>(null)

  useEffect(() => { if (open) { setSel(0); setDragY(0) } }, [open])
  useEffect(() => { if (!open) setDragY(0) }, [open])

  if (!open) return null

  const activate = (i: number) => {
    const it = items[i]
    if (it) { try { it.onSelect() } catch {} }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)' }} />
      <div
        onTouchStart={e => { startY.current = e.touches[0].clientY }}
        onTouchMove={e => {
          if (startY.current == null) return
          const dy = e.touches[0].clientY - startY.current
          if (dy > 0) setDragY(dy)
        }}
        onTouchEnd={e => {
          const dy = e.changedTouches[0].clientY - (startY.current || 0)
          startY.current = null
          setDragY(0)
          if (dy > 80) onClose()
        }}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          backgroundColor: 'var(--q-bg-elevated)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
          boxShadow: 'var(--shadow-modal)',
          paddingBottom: 'calc(4px + env(safe-area-inset-bottom, 0px))',
          transform: dragY > 0 ? `translateY(${dragY}px)` : 'none',
          display: 'flex', flexDirection: 'column', maxHeight: '82dvh', transition: 'none',
        }}
      >
        <div style={{ width: '40px', height: '4px', borderRadius: '2px', backgroundColor: 'rgba(255,255,255,0.13)', margin: '8px auto 8px auto', flexShrink: 0 }} />
        {title && (
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.8px', fontFamily: 'var(--font-code)', textAlign: 'center', marginBottom: '4px', flexShrink: 0 }}>{title}</div>
        )}

        {view ? (
          <div style={{ overflowY: 'auto', padding: '0 8px 4px 8px' }}>{view}</div>
        ) : (
          <div style={{ overflowY: 'auto', padding: '0 8px 4px 8px' }}>
            {items.map((it, i) => (
              <div
                key={it.label}
                onClick={() => activate(i)}
                onMouseEnter={() => setSel(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 12px',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  backgroundColor: sel === i ? 'rgba(255,255,255,0.06)' : 'transparent', transition: 'none',
                }}
              >
                {it.icon
                  ? <span style={{ color: 'var(--q-text-secondary)', display: 'flex', flexShrink: 0 }}>{it.icon}</span>
                  : <span style={{ width: '18px', flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, color: 'var(--q-text)', fontSize: '15px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                {it.value && <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', flexShrink: 0, whiteSpace: 'nowrap' }}>{it.value}</span>}
              </div>
            ))}
          </div>
        )}

        {/* NavBar — identica al menu slash (4 frecce + Close al posto di Cancel) */}
        <div style={{ padding: '8px 16px 10px 16px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <ArrowBtn icon={ChevronUp} onClick={() => setSel(s => Math.max(0, s - 1))} />
          <ArrowBtn icon={ChevronDown} onClick={() => setSel(s => Math.min(items.length - 1, s + 1))} />
          <ArrowBtn icon={ChevronLeft} onClick={() => { if (view) { onViewBack?.() } else { onClose() } }} />
          <ArrowBtn icon={ChevronRight} onClick={() => { if (!view) activate(sel) }} />
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              border: '1px solid var(--q-border)', backgroundColor: 'transparent',
              color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', transition: 'none',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ArrowBtn({ icon: Icon, onClick }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
        backgroundColor: 'transparent', color: 'var(--q-text-secondary)', display: 'flex', alignItems: 'center', transition: 'none',
      }}
    >
      <Icon size={14} />
    </button>
  )
}
