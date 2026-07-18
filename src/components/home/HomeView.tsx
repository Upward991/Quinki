// ============================================================
// HomeView — Hub centrale con card di accesso ai panel
// Container bg, Center, maxWidth 600px, padding 32px
// Wrap of cards (140x100 each, bgPanel, radiusLg, shadowFloating)
// Cards: Expert, Chat, Log, Agents, Settings
// ============================================================

import { Bot, MessageSquare, Activity, Settings } from '../icons'

interface HomeViewProps {
  activePanel: string
  onSelectPanel: (panel: string) => void
}

const cards = [
  { id: 'expert', icon: Bot, label: 'Quinki Expert', color: 'var(--q-accent-orange)', panel: 'expert', doubleBot: false },
  { id: 'chat', icon: MessageSquare, label: 'Chat', color: 'var(--q-accent-info)', panel: 'chat', doubleBot: false },
  { id: 'log', icon: Activity, label: 'Log', color: 'var(--q-accent-success)', panel: 'log', doubleBot: false },
  { id: 'agents', icon: Bot, label: 'Agents', color: 'var(--q-accent-danger)', panel: 'agents', doubleBot: true },
  { id: 'settings', icon: Settings, label: 'Settings', color: 'var(--q-accent-secondary)', panel: 'settings', doubleBot: false },
]

export function HomeView({ activePanel, onSelectPanel }: HomeViewProps) {
  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--q-bg)' }}>
      <div style={{ maxWidth: '600px', padding: '32px' }}>
        <div className="flex flex-wrap gap-2">
          {cards.map(card => {
            const Icon = card.icon
            return (
              <button
                key={card.id}
                onClick={() => card.panel && onSelectPanel(card.panel)}
                className="flex flex-col items-center justify-center hover:opacity-100 transition-all"
                style={{
                  width: '140px',
                  height: '100px',
                  backgroundColor: 'var(--q-bg-panel)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-floating)',
                  opacity: 0.85,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.85' }}
              >
                {card.doubleBot ? (
                  <DoubleBotIcon size={28} color={card.color} />
                ) : (
                  <Icon size={28} style={{ color: card.color, opacity: 0.85 }} />
                )}
                <div style={{ height: '10px' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--q-text)', opacity: 0.85 }}>
                  {card.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── DoubleBotIcon — 3 bot in piramide (1 sopra, 2 sotto) ──
function DoubleBotIcon({ size, color }: { size: number; color: string }) {
  const small = size * 0.65
  return (
    <div style={{ position: 'relative', width: small * 2 + 4, height: small * 2 + 2 }}>
      <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)' }}>
        <Bot size={small} style={{ color, opacity: 0.85 }} />
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0 }}>
        <Bot size={small} style={{ color, opacity: 0.85 }} />
      </div>
      <div style={{ position: 'absolute', bottom: 0, right: 0 }}>
        <Bot size={small} style={{ color, opacity: 0.85 }} />
      </div>
    </div>
  )
}