import { useState } from 'react'
import { Bot, Brain, Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Cpu, Download, Folder, Home, MessageSquare, Network, RefreshCw, Search, Shield, X, PanelLeft, FolderAdd, Check } from '../icons'

interface ChatHeaderProps {
  welcomeMode?: boolean
  activePanel?: string
  contextWindow?: number
  contextTokens?: number
  onSelectPanel: (panel: string) => void
  onToggleSidebar?: () => void
  sidebarOpen?: boolean
  session?: { title?: string }
  onExport?: () => void
  agents?: any[]
  selectedAgentIds?: string[]
  onAgentToggle?: (id: string) => void
  agentDropdownOpen?: boolean
  onToggleAgentDropdown?: () => void
  providers?: any[]
}

const panelClass = "bg-bg-panel rounded-lg shadow-floating p-2 min-h-header-min flex items-center"

export function ChatHeader(props: ChatHeaderProps) {
  const isWelcome = props.welcomeMode ?? false
  const isExpert = props.activePanel === 'expert'
  const [showContext, setShowContext] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showThinkingPicker, setShowThinkingPicker] = useState(false)

  const fmt = (n: number) => {
    if (!n || n === 0) return '0'
    if (n >= 1e6) { const m = n / 1e6; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }
    if (n >= 1e3) return `${Math.floor(n / 1e3)}K`
    return `${n}`
  }

  const ctxPct = props.contextWindow && props.contextWindow > 0 ? Math.floor((props.contextTokens || 0) / props.contextWindow * 100) : 0
  const ctxColor = ctxPct >= 80 ? 'var(--q-accent-danger)' : ctxPct >= 50 ? 'var(--q-accent-warning)' : 'var(--q-text)'

  const allModels = (props.providers || []).flatMap(p => p.models.map((m: any) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow, provider: p.name })))
  const selectedAgents = (props.agents || []).filter(a => (props.selectedAgentIds || []).includes(a.id))

  return (
    <>
      <div className="flex items-center">
        {/* Home button */}
        <div className={panelClass}>
          <IconButton icon={Home} onClick={() => props.onSelectPanel('home')} title="Home" />
        </div>
        <div className="w-2 shrink-0" />

        {/* Sidebar toggle (hidden in welcome mode) */}
        {!isWelcome && (
          <>
            <div className={panelClass}>
              <IconButton icon={PanelLeft} onClick={props.onToggleSidebar} title={props.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} />
            </div>
            <div className="w-2 shrink-0" />
          </>
        )}

        {/* Title bar */}
        <div className={panelClass + " flex-1"}>
          <div className="w-2 shrink-0" />
          <MessageSquare size={18} className="text-text-secondary shrink-0" />
          <div className="w-3 shrink-0" />
          <span
            className="text-16 font-interface flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
            style={{
              color: isWelcome ? 'var(--q-text-tertiary)' : 'var(--q-text)',
              fontWeight: isWelcome ? 400 : 600,
              fontStyle: isWelcome ? 'italic' : 'normal',
            }}
          >
            {isWelcome ? 'The chat title will be generated automatically' : props.session?.title ?? 'Chat'}
          </span>

          {/* Context counter */}
          <div className="relative">
            <button
              onClick={() => setShowContext(!showContext)}
              className="font-code text-13 px-2 py-1 rounded-md border-none cursor-pointer whitespace-nowrap shrink-0"
              style={{
                color: ctxColor,
                backgroundColor: showContext ? 'var(--q-hover)' : 'transparent',
              }}
            >
              {props.contextTokens && props.contextTokens > 0
                ? `${fmt(props.contextTokens)}/${fmt(props.contextWindow || 0)} (${ctxPct}%)`
                : `0/${fmt(props.contextWindow || 0)} (0%)`}
            </button>
            {showContext && (
              <>
                <div className="fixed inset-0 z-overlay" onClick={() => setShowContext(false)} />
                <div className="absolute right-0 top-[calc(100%+8px)] z-dropdown bg-bg-panel rounded-md shadow-modal border border-border p-3 min-w-[260px] max-w-[300px]">
                  <div className="text-center text-text-tertiary text-10 font-code font-semibold tracking-wide mb-1.5">CONTEXT</div>
                  <ContextRow label="Total" value={fmt(props.contextWindow || 0)} />
                  <ContextRow label="Input" value="0" />
                  <ContextRow label="Output" value="0" />
                  <ContextRow label="Used" value={fmt(props.contextTokens || 0)} />
                  <ContextRow label="Percent" value={`${((props.contextTokens || 0) / (props.contextWindow || 1) * 100).toFixed(1)}%`} />
                  <div className="h-3.5" />
                  <div className="text-center text-text-tertiary text-10 font-code font-semibold tracking-wide mb-1.5">COMPACTION</div>
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input type="checkbox" defaultChecked style={{ accentColor: 'var(--q-accent-info)' }} />
                    <span className="text-text text-13 font-interface">Auto-compaction at 80%</span>
                  </label>
                  <div className="text-text-tertiary text-11 font-interface">Compacts automatically when context exceeds 80%.</div>
                </div>
              </>
            )}
          </div>

          {/* Agent tags */}
          {!isWelcome && selectedAgents.length > 0 && (
            <>
              <div className="w-2 shrink-0" />
              {selectedAgents.slice(0, 2).map(agent => (
                <div key={agent.id} className="flex items-center gap-1 px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--q-accent-secondary-soft, rgba(201,112,132,0.1))' }}>
                  <Bot size={12} className="text-accent-secondary" />
                  <span className="text-12 font-interface text-text">{agent.name}</span>
                </div>
              ))}
              {selectedAgents.length > 2 && (
                <span className="text-12 font-code text-text-tertiary">+{selectedAgents.length - 2}</span>
              )}
            </>
          )}

          {/* Add agents button */}
          {!isWelcome && !isExpert && (
            <>
              <div className="w-2 shrink-0" />
              <button
                onClick={() => setShowAgentPicker(true)}
                className="w-8 h-8 flex items-center justify-center rounded-md border border-border cursor-pointer bg-transparent text-text-secondary"
              >
                <Bot size={16} />
              </button>
            </>
          )}

          <div className="w-2 shrink-0" />

          {/* Search button */}
          <IconButton icon={Search} onClick={() => setShowSearch(!showSearch)} title="Search" />
          <div className="w-1 shrink-0" />

          {/* Export button */}
          <IconButton icon={Download} onClick={() => setShowExport(true)} title="Export" />
        </div>
      </div>

      {/* Search popup */}
      {showSearch && (
        <SearchPopup onClose={() => setShowSearch(false)} />
      )}

      {/* Export dialog */}
      {showExport && (
        <ExportDialog onClose={() => setShowExport(false)} sessionTitle={props.session?.title || 'Chat'} />
      )

      }

      {/* Agent picker modal */}
      {showAgentPicker && props.agents && (
        <AgentPickerModal
          agents={props.agents}
          selectedIds={props.selectedAgentIds || []}
          onSelect={(id) => props.onAgentToggle?.(id)}
          onClose={() => setShowAgentPicker(false)}
        />
      )}
    </>
  )
}

// ── Icon button (home, sidebar, search, export) ──
function IconButton({ icon: Icon, onClick, title }: { icon: React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>; onClick?: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-8 h-8 flex items-center justify-center rounded-md border-none cursor-pointer shrink-0 p-0"
      style={{
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1), transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <Icon size={20} />
    </button>
  )
}

// ── Context row ──
function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-text-tertiary text-12 font-interface">{label}</span>
      <span className="text-text-secondary text-12 font-code">{value}</span>
    </div>
  )
}

// ── Search popup ──
function SearchPopup({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  return (
    <>
      <div className="fixed inset-0 z-overlay" onClick={onClose} />
      <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-dropdown bg-bg-panel rounded-lg shadow-modal border border-border p-2 w-[360px]">
        <div className="flex items-center gap-2 px-2.5 py-1">
          <Search size={16} className="text-text-tertiary shrink-0" />
          <input
            type="text"
            placeholder="Search in conversation..."
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-text text-14 font-interface py-1.5"
          />
          <button onClick={() => setQuery('')} className="bg-none border-none cursor-pointer text-text-tertiary text-14" style={{ opacity: query ? 1 : 0.3 }}>✕</button>
        </div>
        <div className="flex items-center gap-1 px-2 py-1">
          <span className="text-text-tertiary text-12 font-code flex-1">0/0</span>
          <button className="bg-none border-none cursor-pointer p-0 flex" style={{ opacity: 0.3 }}>
            <ChevronUp size={16} className="text-text-secondary" />
          </button>
          <button className="bg-none border-none cursor-pointer p-0 flex" style={{ opacity: 0.3 }}>
            <ChevronDown size={16} className="text-text-secondary" />
          </button>
        </div>
      </div>
    </>
  )
}

// ── Export dialog ──
function ExportDialog({ onClose, sessionTitle }: { onClose: () => void; sessionTitle: string }) {
  return (
    <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={onClose}>
      <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter p-6 max-w-[400px] w-[90%]" onClick={(e) => e.stopPropagation()}>
        <div className="text-text text-16 font-interface mb-2">Export "{sessionTitle}"?</div>
        <div className="text-text-tertiary text-13 font-interface mb-5">The conversation will be exported to clipboard as markdown.</div>
        <div className="flex justify-end items-center">
          <button className="q-press px-4 py-2 rounded-md border-none cursor-pointer bg-transparent text-accent-danger text-15 font-interface" onClick={onClose}>Cancel</button>
          <div className="w-2" />
          <button className="q-press px-4 py-2 rounded-lg border-none cursor-pointer bg-accent-success text-bg text-15 font-medium font-interface" onClick={onClose}>Export</button>
        </div>
      </div>
    </div>
  )
}

// ── Agent picker modal ──
function AgentPickerModal({ agents, selectedIds, onSelect, onClose }: { agents: any[]; selectedIds: string[]; onSelect: (id: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const filtered = search ? agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase())) : agents
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="bg-bg-elevated border border-border rounded-lg w-[90%] max-w-[450px] max-h-[70vh] flex flex-col shadow-modal q-modal-enter" onClick={(e) => e.stopPropagation()}>
        <div className="p-3 px-4 text-text text-16 font-semibold font-interface">Add agents to chat</div>
        <div className="px-4 pb-3">
          <div className="flex items-center pl-2.5 bg-bg-panel border border-border rounded-md">
            <Search size={14} className="text-text-tertiary shrink-0" />
            <div className="w-2 shrink-0" />
            <input type="text" placeholder="Search agent..." autoFocus value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-text text-14 font-interface py-2" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.map((agent) => {
            const isSelected = selectedIds.includes(agent.id)
            return (
              <div key={agent.id} onClick={() => onSelect(agent.id)} className="px-4 py-2 cursor-pointer flex items-center gap-2"
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <Bot size={16} className="text-text-secondary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-text text-14 font-interface">{agent.name}</div>
                  <div className="text-text-tertiary text-12 font-interface overflow-hidden text-ellipsis whitespace-nowrap">{agent.id}</div>
                </div>
                <input type="checkbox" checked={isSelected} onChange={() => onSelect(agent.id)} style={{ accentColor: 'var(--q-accent-info)' }} />
              </div>
            )
          })}
        </div>
        <div className="p-2 px-4 pb-2.5 border-t border-border flex items-center">
          <span className="flex-1" />
          <button onClick={onClose} className="q-press bg-none border-none cursor-pointer text-accent-danger text-15 font-interface p-1 px-2">Cancel</button>
          <div className="w-2" />
          <button onClick={onClose} className="q-press rounded-md border-none cursor-pointer bg-accent-info text-bg text-15 font-interface p-1 px-4">Done</button>
        </div>
      </div>
    </div>
  )
}