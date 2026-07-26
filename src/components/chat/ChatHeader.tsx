// ============================================================
// ChatHeader — all menus positioned relative to their own button
// ============================================================

import { useState } from 'react'
import type { Session, Agent } from '../../types'
import { Home, PanelLeft, MessageSquare, Download, Search, RefreshCw, Bot, Calendar, Clock, ChevronDown, ChevronUp, Cpu, Brain, Network, X } from '../icons'

interface ChatHeaderProps {
  session?: Session
  activePanel: string
  onSelectPanel: (panel: string) => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  agentDropdownOpen: boolean
  onToggleAgentDropdown: () => void
  agents: Agent[]
  selectedAgentIds: string[]
  onAgentToggle: (id: string) => void
  contextTokens: number
  contextWindow: number
  providers: any[]
  onExport: () => void
  welcomeMode?: boolean
  agentOverrides?: Record<string, { model?: string; thinkingLevel?: string }>
  onSetAgentOverride?: (agentId: string, overrides: { model?: string | null; thinkingLevel?: string | null }) => void
}

export function ChatHeader(props: ChatHeaderProps) {
  const isExpert = props.activePanel === 'expert'
  const [exportOpen, setExportOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchDate, setSearchDate] = useState('')
  const [searchTime, setSearchTime] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{x: number, y: number, agentId: string} | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set())
  const [modelPickerFor, setModelPickerFor] = useState<string | null>(null)
  const [thinkingPickerFor, setThinkingPickerFor] = useState<string | null>(null)
  const [addAgentOpen, setAddAgentOpen] = useState(false)
  const [agentQuery, setAgentQuery] = useState('')

  const fmt = (n: number) => {
    if (n >= 1000000) { const m = Math.round(n / 100000) / 10; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }
    if (n >= 1000) return `${Math.floor(n / 1000)}K`
    return `${n}`
  }
  const ctxPercent = props.contextWindow > 0 ? Math.floor((props.contextTokens / props.contextWindow) * 100) : 0
  const ctxColor = ctxPercent >= 80 ? 'var(--q-accent-danger)' : ctxPercent >= 50 ? 'var(--q-accent-warning)' : 'var(--q-text)'

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'var(--q-bg-panel)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-floating)',
    padding: '8px',
    minHeight: 'var(--spacing-header-min)',
    display: 'flex',
    alignItems: 'center',
  }
  const popupStyle: React.CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: '0',
    zIndex: 50,
    backgroundColor: 'var(--q-bg-panel)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-floating)',
  }
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 40,
    backgroundColor: 'transparent',
  }
  const ctxOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    backgroundColor: 'transparent',
  }

  return (
    <>
      <div className="flex items-center">
        {/* Panel 1: Home */}
        <div style={panelStyle}>
          <IconBtn icon={Home} onClick={() => props.onSelectPanel('home')} title="Home" />
        </div>
        <div style={{ width: '8px', flexShrink: 0 }} />

        {/* Panel 2: Sidebar toggle */}
        {!isExpert && (
          <>
            <div style={panelStyle}>
              <IconBtn icon={PanelLeft} onClick={props.onToggleSidebar} title={props.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} />
            </div>
            <div style={{ width: '8px', flexShrink: 0 }} />
          </>
        )}

        {/* Panel 3: Expanded */}
        <div style={{ ...panelStyle, flex: 1 }}>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <MessageSquare size={18} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
          <div style={{ width: '12px', flexShrink: 0 }} />
          <span style={{ color: props.welcomeMode ? 'var(--q-text-tertiary)' : 'var(--q-text)', fontSize: '16px', fontWeight: props.welcomeMode ? 400 : 600, fontStyle: props.welcomeMode ? 'italic' : 'normal', fontFamily: 'var(--font-interface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {props.welcomeMode ? 'The chat title will be generated automatically' : (props.session?.title ?? 'Chat')}
          </span>

          {/* Context counter — inside its own position:relative wrapper */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setContextOpen(!contextOpen)}
              style={{ color: ctxColor, fontFamily: 'var(--font-code)', fontSize: '13px', padding: '4px 8px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: contextOpen ? 'var(--q-hover)' : 'transparent', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {props.contextTokens > 0 ? `${fmt(props.contextTokens)}/${fmt(props.contextWindow)} (${ctxPercent}%)` : `0/${fmt(props.contextWindow)} (0%)`}
            </button>
            {contextOpen && (
              <>
                <div style={overlayStyle} onClick={() => setContextOpen(false)} />
                <div style={{ ...popupStyle, minWidth: '260px', maxWidth: '300px', padding: '12px' }}>
                  <div style={{ textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.8px', fontFamily: 'var(--font-code)', marginBottom: '6px' }}>CONTEXT</div>
                  <CtxRow label="Total" value={fmt(props.contextWindow)} />
                  <CtxRow label="Input" value="0" />
                  <CtxRow label="Output" value="0" />
                  <CtxRow label="Used" value={fmt(props.contextTokens)} />
                  <CtxRow label="Percent" value={`${((props.contextTokens / props.contextWindow) * 100).toFixed(1)}%`} />
                  <div style={{ height: '14px' }} />
                  <div style={{ textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.8px', fontFamily: 'var(--font-code)', marginBottom: '6px' }}>COMPACTION</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: 'var(--q-accent-info)' }} />
                    <span style={{ color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Auto-compaction (80%)</span>
                  </label>
                  <CompactionBtn />
                </div>
              </>
            )}
          </div>

                {/* Right-click context menu */}
      {ctxMenu && (
        <>
          <div style={ctxOverlayStyle} onClick={() => { setCtxMenu(null) }} onContextMenu={e => { e.preventDefault(); setCtxMenu(null) }} />
          <div style={{ position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 180), top: Math.min(ctxMenu.y, window.innerHeight - 200), zIndex: 210, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '4px 0', minWidth: '160px' }}>
            {!multiSelect && (
              <button onClick={() => { setMultiSelect(true); setSelectedForRemoval(new Set([ctxMenu.agentId])); setCtxMenu(null) }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>Select</button>
            )}
            {!multiSelect && (
              <button onClick={() => { setConfirmDelete(ctxMenu.agentId); setCtxMenu(null) }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)' }} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>Remove</button>
            )}
            {multiSelect && (
              <button onClick={() => { setMultiSelect(false); setSelectedForRemoval(new Set()); setCtxMenu(null) }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>Deselect all</button>
            )}
            {multiSelect && selectedForRemoval.size > 0 && (
              <button onClick={() => { setConfirmDelete('selected'); setCtxMenu(null) }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '14px', fontFamily: 'var(--font-interface)' }} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>Remove {selectedForRemoval.size} agent{selectedForRemoval.size > 1 ? 's' : ''}</button>
            )}
          </div>
        </>
      )}

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>{confirmDelete === 'selected' ? `Remove ${selectedForRemoval.size} selected agents?` : 'Remove agent from chat?'}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <ExportBtn label="Cancel" color="var(--q-text-secondary)" hoverRgb="255,255,255" onClick={() => setConfirmDelete(null)} />
              <div style={{ width: '8px' }} />
              <button onClick={() => {
                if (confirmDelete === 'selected') { selectedForRemoval.forEach(id => props.onAgentToggle(id)); setSelectedForRemoval(new Set()); setMultiSelect(false) }
                
                else { props.onAgentToggle(confirmDelete) }
                setConfirmDelete(null)
              }}
                style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-secondary)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)' }}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

{/* Export */}
          <div style={{ width: '8px', flexShrink: 0 }} />
          <IconBtn icon={Download} onClick={() => setExportOpen(true)} title="Export chat" />

          {/* Search — panel INSIDE the position:relative wrapper */}
          <div style={{ width: '8px', flexShrink: 0 }} />
          <div style={{ position: 'relative' }}>
            <IconBtn icon={Search} onClick={() => setSearchOpen(!searchOpen)} title="Search messages" activeBg={searchOpen} />
            {searchOpen && (
              <>
                <div style={overlayStyle} onClick={() => setSearchOpen(false)} />
                <div style={{ ...popupStyle, width: '320px', padding: '10px' }}>
                  {/* Row 1 */}
                  <div style={{ display: 'flex', alignItems: 'center', height: '24px' }}>
                    <Search size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
                    <div style={{ width: '10px', flexShrink: 0 }} />
                    <input type="text" placeholder="Search in messages..." autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0', margin: '0', lineHeight: '24px', height: '24px' }} />
                    <button onClick={() => { setSearchQuery(''); setSearchDate(''); setSearchTime('') }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: searchQuery ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', fontSize: '14px', opacity: searchQuery ? 1 : 0.3, lineHeight: '1', flexShrink: 0 }}>✕</button>
                    <div style={{ width: '10px', flexShrink: 0 }} />
                    <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', whiteSpace: 'nowrap', opacity: 0.3, flexShrink: 0 }}>0/0</span>
                    <div style={{ width: '8px', flexShrink: 0 }} />
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--q-text-tertiary)', opacity: 0.3, lineHeight: '0', flexShrink: 0 }}><ChevronDown size={16} /></button>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--q-text-tertiary)', opacity: 0.3, lineHeight: '0', flexShrink: 0 }}><ChevronUp size={16} /></button>
                  </div>
                  <div style={{ height: '8px' }} />
                  {/* Row 2 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '24px' }}>
                    <Calendar size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
                    <div style={{ width: '6px', flexShrink: 0 }} />
                    <input type="text" placeholder="dd/mm/yyyy" value={searchDate} onChange={e => setSearchDate(e.target.value)}
                      style={{ width: '90px', backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', textAlign: 'center', padding: '0', margin: '0', lineHeight: '24px', height: '24px' }} />
                    <div style={{ width: '4px', flexShrink: 0 }} />
                    <button onClick={() => setSearchDate('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--q-text-tertiary)', fontSize: '12px', opacity: searchDate ? 1 : 0.3, lineHeight: '1', flexShrink: 0 }}>✕</button>
                    <div style={{ width: '12px', flexShrink: 0 }} />
                    <Clock size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
                    <div style={{ width: '6px', flexShrink: 0 }} />
                    <input type="text" placeholder="hh:mm:ss" value={searchTime} onChange={e => setSearchTime(e.target.value)}
                      style={{ width: '60px', backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', textAlign: 'center', padding: '0', margin: '0', lineHeight: '24px', height: '24px' }} />
                    <div style={{ width: '4px', flexShrink: 0 }} />
                    <button onClick={() => setSearchTime('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--q-text-tertiary)', fontSize: '12px', opacity: searchTime ? 1 : 0.3, lineHeight: '1', flexShrink: 0 }}>✕</button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Reload */}
          <div style={{ width: '8px', flexShrink: 0 }} />
          <IconBtn icon={RefreshCw} onClick={() => {}} title="Reload chat" />
        </div>

        {/* Panel 4: Agent dropdown */}
        <div style={{ width: '8px', flexShrink: 0 }} />
        <div style={panelStyle}>
          <div style={{ position: 'relative' }}>
            <IconBtn icon={Bot} onClick={props.onToggleAgentDropdown} title="Show agents" activeBg={props.agentDropdownOpen} />
            {props.agentDropdownOpen && (
              <>
                <div style={overlayStyle} onClick={() => { props.onToggleAgentDropdown(); setMultiSelect(false); setSelectedForRemoval(new Set()) }} />
                <div style={{ ...popupStyle, top: 'calc(100% + 16px)', right: '-8px', minWidth: '260px', maxWidth: '300px', minHeight: '50vh', maxHeight: '70vh', border: '1px solid var(--q-border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {/* Add agent + Orchestrator */}
                  <div style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button onClick={() => setAddAgentOpen(true)} style={{ flex: 1, height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontFamily: 'var(--font-interface)', fontSize: '13px', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.color = 'var(--q-text)' }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-text-secondary)' }}>
                      <Bot size={20} style={{ display: 'flex', flexShrink: 0 }} /> <span style={{ lineHeight: '1' }}>Add agent</span>
                    </button>
                    <button onClick={() => { if (!props.selectedAgentIds.includes('orchestrator')) props.onAgentToggle('orchestrator') }} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: props.selectedAgentIds.includes('orchestrator') ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', opacity: props.selectedAgentIds.includes('orchestrator') ? 0.4 : 1, transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                      onMouseEnter={e => { if (!props.selectedAgentIds.includes('orchestrator')) { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.color = 'var(--q-text)' } }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = props.selectedAgentIds.includes('orchestrator') ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)' }}>
                      <Network size={20} />
                    </button>
                  </div>
                  {/* Search field */}
                  <div style={{ padding: '4px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '12px', paddingRight: '8px' }}>
                      <Search size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
                      <div style={{ width: '8px', flexShrink: 0 }} />
                      <input type="text" placeholder="Search agent..." value={agentQuery} onChange={e => setAgentQuery(e.target.value)} style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0', margin: '0' }} />
                      <div style={{ width: '4px', flexShrink: 0 }} />
                      <span onClick={() => setAgentQuery('')} style={{ color: 'var(--q-text-tertiary)', fontSize: '14px', opacity: agentQuery ? 1 : 0.3, cursor: agentQuery ? 'pointer' : 'default', padding: '4px' }}>✕</span>
                    </div>
                  </div>
                  {/* Agent list */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {(() => {
                      const agents = props.agents
                        .filter(a => props.selectedAgentIds.includes(a.id) && (!agentQuery || a.name.toLowerCase().includes(agentQuery.toLowerCase())))
                        .sort((a, b) => a.id === 'orchestrator' ? -1 : b.id === 'orchestrator' ? 1 : 0)
                      if (agents.length === 0) {
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '200px', padding: '24px 8px', textAlign: 'center' }}>
                            <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: '1.5' }}>
                              No agents in chat.<br />Click "Add agent" to add one.
                            </span>
                          </div>
                        )
                      }
                      return agents.map(agent => (
                      <div key={agent.id} style={{ padding: '0 8px 8px 8px' }} onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, agentId: agent.id }) }}>
                        <div style={{ padding: '8px 8px 8px 12px', borderRadius: 'var(--radius-md)', minHeight: '40px', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: agent.id === 'orchestrator' ? 'center' : 'flex-start' }}
                          onClick={() => { if (multiSelect) { const s = new Set(selectedForRemoval); if (s.has(agent.id)) s.delete(agent.id); else s.add(agent.id); setSelectedForRemoval(s) } }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                          {/* Agent name */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Bot size={16} style={{ color: multiSelect && selectedForRemoval.has(agent.id) ? 'var(--q-accent-secondary)' : 'var(--q-text-tertiary)', display: 'flex', flexShrink: 0 }} />
                            <span style={{ color: multiSelect && selectedForRemoval.has(agent.id) ? 'var(--q-accent-danger)' : 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1, lineHeight: '16px' }}>{agent.name}</span>
                          </div>
                          {/* Model + Thinking (not for orchestrator) */}
                          {agent.id !== 'orchestrator' && (
                            <>
                              <div style={{ height: '6px' }} />
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '24px', cursor: multiSelect && selectedForRemoval.has(agent.id) ? 'default' : 'pointer' }}
                                onMouseEnter={e => { if (!(multiSelect && selectedForRemoval.has(agent.id))) { e.currentTarget.querySelectorAll('span,svg').forEach((el: any) => el.style.color = 'var(--q-text)') } }}
                                onMouseLeave={e => { if (!(multiSelect && selectedForRemoval.has(agent.id))) { e.currentTarget.querySelectorAll('span,svg').forEach((el: any) => el.style.color = 'var(--q-text-tertiary)') } }}>
                                <Cpu size={14} style={{ color: multiSelect && selectedForRemoval.has(agent.id) ? 'var(--q-accent-secondary)' : 'var(--q-text-tertiary)', display: 'flex', flexShrink: 0 }} />
                                <span onClick={(e) => { if (!(multiSelect && selectedForRemoval.has(agent.id))) { e.stopPropagation(); setModelPickerFor(agent.id) } }} style={{ color: multiSelect && selectedForRemoval.has(agent.id) ? 'var(--q-accent-secondary)' : 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: '14px', cursor: multiSelect && selectedForRemoval.has(agent.id) ? 'default' : 'pointer' }}>{props.agentOverrides?.[agent.id]?.model || 'Chat default'}</span>
                              </div>
                              <div style={{ height: '4px' }} />
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '24px', cursor: multiSelect && selectedForRemoval.has(agent.id) ? 'default' : 'pointer' }}
                                onMouseEnter={e => { if (!(multiSelect && selectedForRemoval.has(agent.id))) { e.currentTarget.querySelectorAll('span,svg').forEach((el: any) => el.style.color = 'var(--q-text)') } }}
                                onMouseLeave={e => { if (!(multiSelect && selectedForRemoval.has(agent.id))) { e.currentTarget.querySelectorAll('span,svg').forEach((el: any) => el.style.color = 'var(--q-text-tertiary)') } }}>
                                <Brain size={14} style={{ color: multiSelect && selectedForRemoval.has(agent.id) ? 'var(--q-accent-secondary)' : 'var(--q-text-tertiary)', display: 'flex', flexShrink: 0 }} />
                                <span onClick={(e) => { if (!(multiSelect && selectedForRemoval.has(agent.id))) { e.stopPropagation(); setThinkingPickerFor(agent.id) } }} style={{ color: multiSelect && selectedForRemoval.has(agent.id) ? 'var(--q-accent-secondary)' : 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: '14px', cursor: multiSelect && selectedForRemoval.has(agent.id) ? 'default' : 'pointer' }}>
                                  {props.agentOverrides?.[agent.id]?.thinkingLevel ? (props.agentOverrides[agent.id].thinkingLevel === 'off' ? 'Off' : `On (${props.agentOverrides[agent.id].thinkingLevel})`) : 'Chat default'}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Export modal — Flutter AlertDialog: bgElevated, radiusXl, NO border, all TextButtons coral */}
      {exportOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setExportOpen(false)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            {/* Title — 24px top, 24px left/right, 0 bottom (Material 3 titlePadding) */}
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', padding: '14px 18px' }}>Export chat</div>
            {/* Content — 16px top, 24px left/right, 0 bottom (Material 3 contentPadding) */}
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.4, padding: '14px 18px' }}>Choose export format:</div>
            {/* Actions — 8px bottom, 16px right (Material 3 actionsPadding) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 16px 12px 16px' }}>
              <ExportBtn label="Markdown (.md)" color="var(--q-accent-info-bright)" hoverRgb="181,199,224" onClick={() => setExportOpen(false)} />
              <ExportBtn label="HTML (.html)" color="var(--q-accent-info-bright)" hoverRgb="181,199,224" onClick={() => setExportOpen(false)} />
              <ExportBtn label="Cancel" color="var(--q-accent-danger)" hoverRgb="217,107,107" onClick={() => setExportOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Agent picker modal (Add agent) */}
      {addAgentOpen && (
        <AgentPickerModal
          agents={props.agents.filter(a => !props.selectedAgentIds.includes(a.id) && a.id !== 'orchestrator')}
          onClose={() => setAddAgentOpen(false)}
          onAdd={(ids) => { ids.forEach(id => props.onAgentToggle(id)); setAddAgentOpen(false) }}
        />
      )}

      {/* Model picker modal */}
      {modelPickerFor && (
        <ModelPickerModal
          currentModel={props.agentOverrides?.[modelPickerFor]?.model || ''}
          models={props.providers?.flatMap((p: any) => p.models.map((m: any) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow, provider: p.name }))) || []}
          onClose={() => setModelPickerFor(null)}
          onConfirm={(model) => { props.onSetAgentOverride?.(modelPickerFor, { model, thinkingLevel: '__skip__' }); setModelPickerFor(null) }}
        />
      )}

      {/* Thinking picker modal */}
      {thinkingPickerFor && (
        <ThinkingPickerModal
          currentThinking={props.agentOverrides?.[thinkingPickerFor]?.thinkingLevel || ''}
          onClose={() => setThinkingPickerFor(null)}
          onConfirm={(level) => { props.onSetAgentOverride?.(thinkingPickerFor, { thinkingLevel: level, model: '__skip__' }); setThinkingPickerFor(null) }}
        />
      )}
    </>
  )
}

function ExportBtn({ label, color, hoverRgb, onClick }: { label: string; color: string; hoverRgb: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ padding: '10px 12px', border: 'none', cursor: 'pointer', backgroundColor: hovered ? `rgba(${hoverRgb},0.08)` : 'transparent', color, fontSize: '14px', fontFamily: 'var(--font-interface)', fontWeight: 500, borderRadius: 'var(--radius-md)', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
      {label}
    </button>
  )
}

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-code)' }}>{label}</span>
      <span style={{ color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-code)' }}>{value}</span>
    </div>
  )
}

function CompactionBtn() {
  const [hovered, setHovered] = useState(false)
  return (
    <button style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: hovered ? 'var(--q-hover)' : 'var(--q-bg)', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      Compaction
    </button>
  )
}

function IconBtn({ icon: Icon, onClick, title, activeBg }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void; title?: string; activeBg?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const bg = activeBg ? 'var(--q-hover)' : hovered ? 'var(--q-hover)' : 'transparent'
  const color = hovered ? 'var(--q-text)' : 'var(--q-text-secondary)'
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: bg, color, flexShrink: 0, padding: '0', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <Icon size={20} />
    </button>
  )
}


// ── Agent picker modal — fedele a _AgentPickerDialog Flutter: header, search, checkbox, footer ──
function AgentPickerModal({ agents, onClose, onAdd }: {
  agents: Agent[]
  onClose: () => void
  onAdd: (ids: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const filtered = agents.filter(a => a.name.toLowerCase().includes(query.toLowerCase()))
  const toggle = (id: string) => setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s })
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '500px', maxHeight: '500px', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', flex: 1 }}>Add agents to chat</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }}><X size={18} style={{ color: 'var(--q-text-secondary)' }} /></button>
        </div>
        {/* Search */}
        <div style={{ padding: '8px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '10px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' }}>
            <Search size={14} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
            <div style={{ width: '8px', flexShrink: 0 }} />
            <input type="text" placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} autoFocus
              style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '8px 0' }} />
          </div>
        </div>
        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>No agents found</div>
          )}
          {filtered.map(agent => (
            <div key={agent.id} onClick={() => toggle(agent.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
              <input type="checkbox" checked={selected.has(agent.id)} onChange={() => toggle(agent.id)} onClick={e => e.stopPropagation()}
                style={{ accentColor: 'var(--q-accent-info)', width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
            </div>
          ))}
        </div>
        {/* Footer */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => setSelected(new Set(filtered.map(a => a.id)))} disabled={filtered.length === 0}
            style={{ background: 'none', border: 'none', cursor: filtered.length === 0 ? 'default' : 'pointer', color: filtered.length === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Select all</button>
          <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}
            style={{ background: 'none', border: 'none', cursor: selected.size === 0 ? 'default' : 'pointer', color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Deselect</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', fontSize: '15px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
          <div style={{ width: '8px' }} />
          <button onClick={() => onAdd([...selected])} disabled={selected.size === 0}
            style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: selected.size === 0 ? 'default' : 'pointer', backgroundColor: selected.size === 0 ? 'var(--q-hover)' : 'var(--q-accent-info)', color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-bg)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Add ({selected.size})</button>
        </div>
      </div>
    </div>
  )
}

// ── Model picker modal — exact Flutter _ModelPickerDialog copy ──
function ModelPickerModal({ currentModel, models, onClose, onConfirm }: {
  currentModel: string
  models: { id: string; name: string; contextWindow?: number; provider: string }[]
  onClose: () => void
  onConfirm: (model: string | null) => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(currentModel || null)
  const filtered = search ? models.filter(m => m.id.toLowerCase().includes(search.toLowerCase()) || m.provider.toLowerCase().includes(search.toLowerCase())) : models
  const byProvider: Record<string, typeof models> = {}
  for (const m of filtered) { if (!byProvider[m.provider]) byProvider[m.provider] = []; byProvider[m.provider].push(m) }
  const fmtCtx = (cw?: number) => { if (!cw || cw === 0) return '—'; if (cw >= 1000000) { const m = Math.round(cw / 100000) / 10; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }; if (cw >= 1000) return `${Math.floor(cw / 1000)}K`; return `${cw}` }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '480px', height: '80vh', maxHeight: '500px', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '12px 16px', backgroundColor: 'var(--q-bg-panel)', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <Cpu size={18} style={{ color: 'var(--q-accent-info)', flexShrink: 0 }} />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Agent model</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }}><X size={18} style={{ color: 'var(--q-text-secondary)' }} /></button>
        </div>
        <div style={{ padding: '8px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '10px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' }}>
            <Search size={14} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
            <div style={{ width: '8px', flexShrink: 0 }} />
            <input type="text" placeholder="Search model..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '8px 0' }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          <div onClick={() => setSelected(null)} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: selected === null ? 'color-mix(in srgb, var(--q-accent-info) 12%, transparent)' : 'transparent', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid ' + (selected === null ? 'var(--q-accent-info)' : 'var(--q-text-tertiary)'), backgroundColor: selected === null ? 'var(--q-accent-info)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{selected === null && <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--q-bg)' }} />}</div>
            <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1 }}>Chat default</span>
            <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>Use chat default model</span>
          </div>
          {Object.entries(byProvider).map(([provider, pModels]) => (
            <div key={provider}>
              <div style={{ padding: '8px 16px 4px 16px', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>{provider}</div>
              {pModels.map(m => (
                <div key={m.id} onClick={() => setSelected(m.id)} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: selected === m.id ? 'color-mix(in srgb, var(--q-accent-info) 12%, transparent)' : 'transparent', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid ' + (selected === m.id ? 'var(--q-accent-info)' : 'var(--q-text-tertiary)'), backgroundColor: selected === m.id ? 'var(--q-accent-info)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{selected === m.id && <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--q-bg)' }} />}</div>
                  <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.id}</span>
                  <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 }}>{fmtCtx(m.contextWindow)} ctx</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>{selected === null ? 'Chat default' : (selected.length > 30 ? selected.substring(0, 30) + '...' : selected)}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', fontSize: '15px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
          <div style={{ width: '8px' }} />
          <button onClick={() => onConfirm(selected)} style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-info)', color: 'var(--q-bg)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ── Thinking picker modal — exact Flutter _ThinkingPickerDialog copy ──
function ThinkingPickerModal({ currentThinking, onClose, onConfirm }: { currentThinking: string; onClose: () => void; onConfirm: (level: string | null) => void }) {
  const [selected, setSelected] = useState<string | null>(currentThinking || null)
  const options: { value: string | null; label: string }[] = [{ value: null, label: 'Chat default' }, { value: 'on', label: 'On (xhigh)' }, { value: 'off', label: 'Off' }]
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '380px', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '12px 16px', backgroundColor: 'var(--q-bg-panel)', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center' }}>
          <Brain size={18} style={{ color: 'var(--q-accent-info)', flexShrink: 0 }} />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Thinking</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }}><X size={18} style={{ color: 'var(--q-text-secondary)' }} /></button>
        </div>
        <div style={{ padding: '8px 0' }}>
          {options.map(opt => {
            const isSelected = selected === opt.value
            return (
              <div key={opt.label} onClick={() => setSelected(opt.value)} style={{ padding: '10px 16px', cursor: 'pointer', backgroundColor: isSelected ? 'color-mix(in srgb, var(--q-accent-info) 12%, transparent)' : 'transparent', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid ' + (isSelected ? 'var(--q-accent-info)' : 'var(--q-text-tertiary)'), backgroundColor: isSelected ? 'var(--q-accent-info)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{isSelected && <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--q-bg)' }} />}</div>
                <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{opt.label}</span>
              </div>
            )
          })}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--q-border)', display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', fontSize: '15px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
          <div style={{ width: '8px' }} />
          <button onClick={() => onConfirm(selected)} style={{ padding: '4px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-info)', color: 'var(--q-bg)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}