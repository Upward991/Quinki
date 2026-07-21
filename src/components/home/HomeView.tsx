import { useState } from 'react'
import { Bot, Terminal, MessageSquare, Settings, Brain } from '../icons'

const tabs = [
  {id:'expert', icon:Bot, label:'Quinki Expert', color:'var(--q-accent-orange)', panel:'expert', doubleBot:false},
  {id:'chat', icon:MessageSquare, label:'Chat', color:'var(--q-accent-info)', panel:'chat', doubleBot:false},
  {id:'log', icon:Terminal, label:'Log', color:'var(--q-accent-success)', panel:'log', doubleBot:false},
  {id:'agents', icon:Bot, label:'Agents', color:'var(--q-accent-secondary)', panel:'agents', doubleBot:true},
  {id:'settings', icon:Settings, label:'Settings', color:'var(--q-accent-primary)', panel:'settings', doubleBot:false},
]

export function HomeView({onSelectPanel}: {onSelectPanel: (panel: string) => void}) {
  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="max-w-[600px] p-8 mx-auto">
        <div className="flex flex-wrap gap-2.5">
          {tabs.map((card, idx) => (
            <HomeCard key={card.id} card={card} idx={idx} onSelectPanel={onSelectPanel} />
          ))}
        </div>
      </div>
    </div>
  )
}

function HomeCard({card, idx, onSelectPanel}: any) {
  const [hovered, setHovered] = useState(false)
  const Icon = card.icon
  return (
    <button
      onClick={() => card.panel && onSelectPanel(card.panel)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-40 h-30 bg-bg-panel rounded-lg flex flex-col items-center justify-center cursor-pointer relative overflow-hidden"
      style={{
        border: `1px solid ${hovered ? 'var(--q-border-strong)' : 'var(--q-border)'}`,
        boxShadow: hovered
          ? '0 0 0 1px var(--q-border-strong), 0 0 24px rgba(157, 139, 217, 0.06), inset 0 1px 0 rgba(255,255,255,0.02)'
          : 'var(--shadow-floating)',
        animation: `staggerIn 300ms cubic-bezier(0.16, 1, 0.3, 1) ${idx*40}ms both`,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1), border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 50%, ${card.color}, transparent 70%)`,
          opacity: hovered ? 0.06 : 0,
          transition: 'opacity 120ms ease',
        }}
      />
      <div
        className="flex items-center justify-center"
        style={{
          transform: hovered ? 'scale(1.05)' : 'scale(1)',
          transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {card.doubleBot ? <Bot size={28} style={{ color: card.color }} /> : <Icon size={28} style={{ color: card.color }} />}
      </div>
      <div className="h-2.5" />
      <span className="text-14 font-medium text-text">{card.label}</span>
    </button>
  )
}