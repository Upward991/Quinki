// ============================================================
// BottomSheet — forma standard dei menu della chat in visione mobile.
// Direttiva utente (22 set): i menu/dropdown/modali della chat si aprono dal BASSO
// (stile Discord) con la grafica dei floating panel; barra di navigazione IDENTICA
// al menu slash: 4 frecce + Close (grafica del Cancel) + Back (grafica del Confirm,
// per tornare indietro tra le viste del menu). Si chiude trascinando giù, col tasto
// Close o toccando il backdrop.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from '../icons'

export interface SheetItem {
  icon?: React.ReactNode
  label: string
  value?: string
  valueColor?: string
  onSelect: () => void
}

// Riga standard del menu (usata sia dagli item sia dalle viste interne)
export function SheetRow({ icon, label, value, valueColor, onClick }: {
  icon?: React.ReactNode
  label: string
  value?: string
  valueColor?: string
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 14px',
        borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'none',
      }}
    >
      {icon
        ? <span style={{ color: 'var(--q-text-secondary)', display: 'flex', flexShrink: 0 }}>{icon}</span>
        : <span style={{ width: '20px', flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0, color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {value && <span style={{ color: valueColor || 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-code)', flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right', maxWidth: '58%' }}>{value}</span>}
    </div>
  )
}

export function BottomSheet({ open, onClose, items, view, onViewBack, onBack, title }: {
  open: boolean
  onClose: () => void
  items: SheetItem[]
  view?: React.ReactNode | null
  onViewBack?: () => void
  onBack?: () => void
  title?: string
}) {
  const [sel, setSel] = useState(0)
  const [dragY, setDragY] = useState(0)
  const startY = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Il pannello comunica la sua altezza all'app: la chat si solleva sopra di lui
  // (come fa la text box) invece di finirci dietro. Vale anche per il search:
  // gli elementi evidenziati restano visibili e scorrevoli.
  useEffect(() => {
    const el = panelRef.current
    const clear = () => { try { document.documentElement.style.setProperty('--q-sheet-h', '0px') } catch {} }
    if (!open || !el) { clear(); return }
    const set = () => { try { document.documentElement.style.setProperty('--q-sheet-h', el.offsetHeight + 'px') } catch {} }
    set()
    let ro: any = null
    try { ro = new ResizeObserver(() => set()); ro.observe(el) } catch {}
    return () => { try { ro && ro.disconnect() } catch {}; clear() }
  }, [open])

  useEffect(() => { if (open) { setSel(0); setDragY(0) } }, [open])

  if (!open) return null

  const activate = (i: number) => {
    const it = items[i]
    if (it) { try { it.onSelect() } catch {} }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
      <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)' }} />
      <div
        ref={panelRef as any}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          backgroundColor: 'var(--q-bg-panel)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
          boxShadow: 'var(--shadow-modal)',
          paddingBottom: 'calc(4px + env(safe-area-inset-bottom, 0px))',
          transform: dragY > 0 ? `translateY(${dragY}px)` : 'none',
          display: 'flex', flexDirection: 'column', maxHeight: '100dvh', transition: 'none',
        }}
      >
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
            if (dy > 70) onClose()
          }}
          style={{ padding: '10px 0 6px 0', flexShrink: 0, touchAction: 'none' }}
        >
          <div style={{ width: '40px', height: '4px', borderRadius: '2px', backgroundColor: 'rgba(255,255,255,0.13)', margin: '0 auto' }} />
        </div>
        {title && (
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.8px', fontFamily: 'var(--font-code)', textAlign: 'center', marginBottom: '4px', flexShrink: 0 }}>{title}</div>
        )}

        {view ? (
          <div style={{ minHeight: 0, overflowY: 'auto', padding: '0 8px 4px 8px' }}>{view}</div>
        ) : (
          <div style={{ minHeight: 0, overflowY: 'auto', padding: '0 8px 4px 8px' }}>
            {items.map((it, i) => (
              <div
                key={it.label}
                onMouseEnter={() => setSel(i)}
                style={{ backgroundColor: sel === i ? 'rgba(255,255,255,0.06)' : 'transparent', borderRadius: 'var(--radius-md)', transition: 'none' }}
              >
                <SheetRow icon={it.icon} label={it.label} value={it.value} valueColor={it.valueColor} onClick={() => activate(i)} />
              </div>
            ))}
          </div>
        )}

        {/* NavBar: una sola freccia indietro (grande, a sinistra) + Close.
            Le frecce su/giù erano inutili (nessun evidenziato visibile al dito). */}
        <div style={{ padding: '8px 16px 10px 16px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <button
            onClick={() => { if (view) { onViewBack?.() } else if (onBack) { onBack() } else { onClose() } }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--q-text)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-text-secondary)' }}
            style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', cursor: 'pointer', flexShrink: 0, padding: 0 }}>
            <ChevronLeft size={28} />
          </button>
          <span style={{ flex: 1 }} />
          <NavTextBtn label="Close" danger onClick={onClose} />
        </div>
      </div>
    </div>
  )
}

// Frecce della barra: su touch NON c'è hover → il tocco lascia il fondo hover
// visibile per un attimo (feedback come sul computer)
function ArrowBtn({ icon: Icon, onClick }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const t = useRef<any>(null)
  const flash = () => {
    setHovered(true)
    try { clearTimeout(t.current) } catch {}
    t.current = setTimeout(() => setHovered(false), 350)
  }
  return (
    <button
      onClick={() => { flash(); onClick() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={flash}
      style={{
        padding: '6px', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
        backgroundColor: hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        display: 'flex', alignItems: 'center', transition: 'none',
      }}
    >
      <Icon size={14} />
    </button>
  )
}

// Tasti della barra: Close = grafica Cancel del menu slash, Back = grafica Confirm
function NavTextBtn({ label, danger, accent, onClick }: { label: string; danger?: boolean; accent?: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const t = useRef<any>(null)
  const flash = () => {
    setHovered(true)
    try { clearTimeout(t.current) } catch {}
    t.current = setTimeout(() => setHovered(false), 350)
  }
  const textColor = danger ? 'var(--q-accent-danger)' : accent ? 'var(--q-tab-accent)' : 'var(--q-text-secondary)'
  const hoverText = danger ? 'var(--q-accent-danger)' : accent ? 'var(--q-bg)' : 'var(--q-text)'
  return (
    <button
      onClick={() => { flash(); onClick() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={flash}
      style={{
        padding: '7px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        border: `1px solid ${accent ? 'var(--q-tab-accent)' : 'var(--q-border)'}`,
        backgroundColor: hovered ? (accent ? 'var(--q-tab-accent)' : 'rgba(255,255,255,0.06)') : 'transparent',
        color: hovered ? hoverText : textColor,
        fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: accent ? 600 : 400, transition: 'none',
      }}
    >
      {label}
    </button>
  )
}
