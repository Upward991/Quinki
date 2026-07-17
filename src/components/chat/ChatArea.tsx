// ============================================================
// ChatArea — structure fix: overflow hidden on messages, button outside
// ============================================================

import { useRef, useEffect, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { ArrowDown } from '../icons'
import type { Message, Session, Agent, Provider, ChatMode, ThinkingLevel } from '../../types'

interface ChatAreaProps {
  session?: Session
  messages: Message[]
  streaming: boolean
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
  providers: Provider[]
  selectedModel: string
  onModelSelect: (model: string) => void
  onModeChange: (mode: ChatMode) => void
  thinking: ThinkingLevel
  onThinkingChange: (level: ThinkingLevel) => void
  contextTokens: number
  contextWindow: number
  statusLabel?: string
  statusKind?: string
  onSend: (text: string) => void
  onStop: () => void
  onRenameSession: (label: string) => void
  onExport: () => void
}

export function ChatArea(props: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const isEmpty = props.messages.length === 0 || props.welcomeMode

  useEffect(() => {
    if (scrollRef.current && !isEmpty) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [props.messages, isEmpty])

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
          providers={props.providers}
          onExport={props.onExport}
        />
      </div>

{/* Welcome: composer centered */}
      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center">
          <Composer
            providers={props.providers} selectedModel={props.selectedModel} mode={props.mode}
            thinking={props.thinking} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
            isStreaming={props.streaming} statusLabel={props.statusLabel} statusKind={props.statusKind}
            onSend={props.onSend} onStop={props.onStop}
            onModelChange={props.onModelSelect} onModeChange={props.onModeChange}
            onThinkingChange={(level: string) => props.onThinkingChange(level as any)} welcomeMode={true}
          />
        </div>
      ) : (
        <>
          {/* Messages */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div ref={scrollRef} style={{ height: '100%', overflowY: 'auto', padding: '0 16px' }}
              onScroll={e => { const el = e.currentTarget; setShowScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 100) }}>
              {props.messages.map(msg => (
                <div key={msg.id} style={{ marginBottom: '8px' }}>
                  <MessageBubble message={msg} onCopy={() => {}} />
                </div>
              ))}
            </div>
            {showScrollBtn && (
              <button onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }}
                style={{ position: 'absolute', bottom: 0, right: 0, width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--q-bg-panel)', color: 'var(--q-text-secondary)', border: 'none', cursor: 'pointer' }}>
                <ArrowDown size={20} />
              </button>
            )}
          </div>

          {/* Composer — flexShrink 0 so it stays visible */}
          <div style={{ paddingTop: '8px', flexShrink: 0 }}>
            <Composer
              providers={props.providers} selectedModel={props.selectedModel} mode={props.mode}
              thinking={props.thinking} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
              isStreaming={props.streaming} statusLabel={props.statusLabel} statusKind={props.statusKind}
              onSend={props.onSend} onStop={props.onStop}
              onModelChange={props.onModelSelect} onModeChange={props.onModeChange}
              onThinkingChange={(level: string) => props.onThinkingChange(level as any)} welcomeMode={false}
            />
          </div>
        </>
      )}
    </div>
  )
}