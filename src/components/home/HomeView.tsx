// ============================================================
// HomeView — Hub centrale con card di accesso ai panel
// Deep Cosmos redesign: 160x120 cards, stagger animation,
// hover glow + lift, radial gradient overlay
// ============================================================

import { useState } from 'react'
import { Bot, MessageSquare, Terminal, Settings } from '../icons'

interface CardDef {
  id: string
  icon: React.FC<any>
  label: string
  color: string
  panel: string
  doubleBot: boolean
}

const cards: CardDef[] = [
  { id: 'expert', icon: Bot, label: 'Quinki Expert', color: 'var(--q-accent-orange)', panel: 'expert', doubleBot: false },
  { id: 'chat', icon: MessageSquare, label: 'Chat', color: 'var(--q-accent-info)', panel: 'chat', doubleBot: false },
  { id: 'log', icon: Terminal, label: 'Log', color: 'var(--q-accent-success)', panel: 'log', doubleBot: false },
  { id: 'agents', icon: Bot, label: 'Agents', color: 'var(--q-accent-secondary)', panel: 'agents', doubleBot: true },
  { id: 'settings', icon: Settings, label: 'Settings', color: 'var(--q-accent-primary)', panel: 'settings', doubleBot: false },
]

interface HomeViewProps {
  activePanel?: string
  onSelectPanel: (panel: string) => void
}

export function HomeView({ onSelectPanel }: HomeViewProps) {
  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--q-bg)' }}>
      <div style={{ maxWidth: '600px', padding: '32px', margin: '0 auto' }}>
        <div className="flex flex-wrap" style={{ gap: '10px' }}>
          {cards.map((card, idx) => (
            <HomeNavCard key={card.id} card={card} idx={idx} onSelectPanel={onSelectPanel} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── DoubleBotIcon — renders a single Bot icon (matches Deep Cosmos build) ──
function DoubleBotIcon({ size = 28, color }: { size?: number; color?: string }) {
  return <Bot size={size} style={{ color }} />
}

// ── HomeNavCard — individual card with hover effects ──
function HomeNavCard({ card, idx, onSelectPanel }: { card: CardDef; idx: number; onSelectPanel: (panel: string) => void }) {
  const [hovered, setHovered] = useState(false)
  const Icon = card.icon

  return (
    <button
      onClick={() => card.panel && onSelectPanel(card.panel)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '160px',
        height: '120px',
        backgroundColor: 'var(--q-bg-panel)',
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${hovered ? 'var(--q-border-strong)' : 'var(--q-border)'}`,
        boxShadow: hovered
          ? '0 0 0 1px var(--q-border-strong), 0 0 24px rgba(157, 139, 217, 0.06), inset 0 1px 0 rgba(255,255,255,0.02)'
          : 'var(--shadow-floating)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        animation: `staggerIn 300ms cubic-bezier(0.16, 1, 0.3, 1) ${idx * 40}ms both`,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1), border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      {/* Radial gradient glow on hover */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 80% 60% at 50% 50%, ${card.color}, transparent 70%)`,
        opacity: hovered ? 0.06 : 0,
        transition: 'opacity 120ms ease',
        pointerEvents: 'none',
      }} />

      {/* Icon */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
        transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {card.doubleBot
          ? <DoubleBotIcon size={28} color={card.color} />
          : <Icon size={28} style={{ color: card.color }} />
        }
      </div>

      <div style={{ height: '10px' }} />

      <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--q-text)' }}>
        {card.label}
      </span>
    </button>
  )
}