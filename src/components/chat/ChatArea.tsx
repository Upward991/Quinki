// ============================================================
// ChatArea — structure fix: overflow hidden on messages, button outside
// ============================================================

import { useRef, useEffect, useState } from 'react'
import { getContrastColor } from '../../utils/contrast'
import { MessageBubble } from './MessageBubble'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { ArrowDown } from '../icons'
import type { Message, Session, Agent, Provider, ChatMode, ThinkingLevel } from '../../types'

interface ChatAreaProps {
  session?: Session
  messages: Message[]
  streaming: boolean
  isCompacting?: boolean
  welcomeMode: boolean
  mode: ChatMode
  activePanel: string
  onSelectPanel: (panel: string) => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  agentDropdownOpen: boolean
  onToggleAgentDropdown: () => void
  agents: Agent[]
  selectedAgentIds: string[]
  onAgentToggle: (id: string) => void
  agentOverrides?: Record<string, { model?: string; thinkingLevel?: string }>
  onSetAgentOverride?: (agentId: string, overrides: { model?: string | null; thinkingLevel?: string | null }) => void
  providers: Provider[]
  selectedModel: string
  onModelSelect: (model: string) => void
  onModeChange: (mode: ChatMode) => void
  thinking: ThinkingLevel
  onThinkingChange: (level: ThinkingLevel) => void
  contextTokens: number
  contextWindow: number
  contextInput?: number
  contextOutput?: number
  statusLabel?: string
  statusKind?: string
  onSend: (text: string) => void
  onStop: () => void
  onRenameSession: (label: string) => void
  onExport: () => void
  onReset?: () => void
  onCompact?: () => void
}

export function ChatArea(props: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const isEmpty = props.messages.length === 0 || props.welcomeMode

  useEffect(() => {
    // Auto-scroll: segue SEMPRE la generazione verso il basso.
    // Doppio pass: immediato + dopo il render del markdown (altezza cambia).
    if (scrollRef.current && !isEmpty) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      const raf = requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      })
      const t = setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }, 120)
      return () => { cancelAnimationFrame(raf); clearTimeout(t) }
    }
  }, [props.messages, isEmpty, props.streaming])

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%', position: 'relative' }}>
      {/* Header */}
      <div style={{ marginBottom: '8px', flexShrink: 0 }}>
        <ChatHeader
          session={props.session}
          activePanel={props.activePanel}
          onSelectPanel={props.onSelectPanel}
          sidebarOpen={props.sidebarOpen}
          onToggleSidebar={props.onToggleSidebar}
          agentDropdownOpen={props.agentDropdownOpen}
          onToggleAgentDropdown={props.onToggleAgentDropdown}
          agents={props.agents}
          selectedAgentIds={props.selectedAgentIds}
          onAgentToggle={props.onAgentToggle}
          contextTokens={props.contextTokens}
          contextWindow={props.contextWindow}
          contextInput={props.contextInput}
          contextOutput={props.contextOutput}
          providers={props.providers}
          onExport={props.onExport}
          welcomeMode={props.welcomeMode}
          agentOverrides={props.agentOverrides}
          onSetAgentOverride={props.onSetAgentOverride}
          onCompact={props.onCompact}
        />
      </div>

{/* Welcome: composer centered */}
      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center">
          <Composer
            providers={props.providers} selectedModel={props.selectedModel} mode={props.mode}
            thinking={props.thinking} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
            isStreaming={props.streaming} isCompacting={props.isCompacting} statusLabel={props.statusLabel} statusKind={props.statusKind}
            onSend={props.onSend} onStop={props.onStop}
            onModelChange={props.onModelSelect} onModeChange={props.onModeChange}
            onThinkingChange={t => props.onThinkingChange(t)} welcomeMode={true}
            agents={props.agents}
            chatAgentIds={props.selectedAgentIds}
            onReset={props.onReset}
            onAgentToggle={props.onAgentToggle}
          />
        </div>
      ) : (
        <>
          {/* Messages */}
          {/* minHeight:0 = flex shrink corretto (composer non spinto fuori); overflow visible = shadow auto-scroll non clippata */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'visible', position: 'relative' }}>
            <div ref={scrollRef} style={{ height: '100%', overflowY: 'auto', padding: '4px 16px 0 16px', scrollbarGutter: 'stable' }}
              onScroll={e => { const el = e.currentTarget; setShowScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 100) }}>
              {props.messages.map(msg => (
                <div key={msg.id} style={{ marginBottom: '12px' }}>
                  <MessageBubble message={msg} onCopy={() => {}} />
                </div>
              ))}
            </div>
            {showScrollBtn && (
              <button onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }}
                style={{ position: 'absolute', bottom: '0px', right: '0px', zIndex: 10, width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--q-tab-accent)', color: getContrastColor('--q-tab-accent'), border: 'none', boxShadow: 'var(--shadow-floating)', cursor: 'pointer' }}>
                <ArrowDown size={20} />
              </button>
            )}
          </div>

          {/* Composer — flexShrink 0 so it stays visible */}
          <div style={{ paddingTop: '8px', flexShrink: 0 }}>
            <Composer
              providers={props.providers} selectedModel={props.selectedModel} mode={props.mode}
              thinking={props.thinking} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
              isStreaming={props.streaming} isCompacting={props.isCompacting} statusLabel={props.statusLabel} statusKind={props.statusKind}
              onSend={props.onSend} onStop={props.onStop}
              onModelChange={props.onModelSelect} onModeChange={props.onModeChange}
              onThinkingChange={t => props.onThinkingChange(t)} welcomeMode={false}
            onReset={props.onReset}
              agents={props.agents}
              chatAgentIds={props.selectedAgentIds}
              onAgentToggle={props.onAgentToggle}
            />
          </div>
        </>
      )}
    </div>
  )
}