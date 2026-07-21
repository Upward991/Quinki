import { useState, useRef, useEffect } from 'react'
import { Bot, Terminal, MessageSquare, Settings, Brain, ArrowDown } from '../icons'
import { ChatHeader } from './ChatHeader'
import { SlashMenu } from './SlashMenu'
import { MessageBubble } from './MessageBubble'

interface ChatAreaProps {
  messages: any[]
  welcomeMode?: boolean
  session?: any
  activePanel?: string
  onSelectPanel: (panel: string) => void
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  agentDropdownOpen?: boolean
  onToggleAgentDropdown?: () => void
  agents?: any[]
  selectedAgentIds?: string[]
  onAgentToggle?: (id: string) => void
  contextTokens?: number
  contextWindow?: number
  providers?: any[]
  onExport?: () => void
  selectedModel?: string
  onModelSelect?: (model: string) => void
  mode?: string
  onModeChange?: (mode: string) => void
  thinking?: string
  onThinkingChange?: (level: string) => void
  onSend: (text: string) => void
  onStop?: () => void
  streaming?: boolean
  statusLabel?: string
  statusKind?: string
}

export function ChatArea(e: ChatAreaProps) {
  const t = useRef<HTMLDivElement>(null)
  const [n, r] = useState(false)
  const i = e.messages.length === 0 || e.welcomeMode

  useEffect(() => {
    if (t.current && !i) t.current.scrollTop = t.current.scrollHeight
  }, [e.messages, i])

  return (
    <div className="h-full flex flex-col max-w-chat-max mx-auto w-full relative">
      <div className="mb-2 shrink-0">
        <ChatHeader
          session={e.session}
          activePanel={e.activePanel}
          onSelectPanel={e.onSelectPanel}
          sidebarOpen={e.sidebarOpen}
          onToggleSidebar={e.onToggleSidebar}
          agentDropdownOpen={e.agentDropdownOpen}
          onToggleAgentDropdown={e.onToggleAgentDropdown}
          agents={e.agents}
          selectedAgentIds={e.selectedAgentIds}
          onAgentToggle={e.onAgentToggle}
          contextTokens={e.contextTokens}
          contextWindow={e.contextWindow}
          providers={e.providers}
          onExport={e.onExport}
          welcomeMode={e.welcomeMode}
        />
      </div>
      {i ? (
        <div className="flex-1 flex items-center justify-center">
          <SlashMenu
            providers={e.providers}
            selectedModel={e.selectedModel}
            mode={e.mode}
            thinking={e.thinking}
            contextTokens={e.contextTokens}
            contextWindow={e.contextWindow}
            isStreaming={e.streaming}
            statusLabel={e.statusLabel}
            statusKind={e.statusKind}
            onSend={e.onSend}
            onStop={e.onStop}
            onModelChange={e.onModelSelect}
            onModeChange={e.onModeChange}
            onThinkingChange={(t: string) => e.onThinkingChange?.(t)}
            welcomeMode={true}
            agents={e.agents}
          />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-hidden relative">
            <div
              ref={t}
              className="h-full overflow-y-auto pt-px pr-4 pl-4"
              style={{ scrollbarGutter: 'stable' }}
              onScroll={(ev) => {
                const el = ev.currentTarget
                r(el.scrollTop + el.clientHeight < el.scrollHeight - 100)
              }}
            >
              {e.messages.map((msg: any) => (
                <div key={msg.id} className="mb-3">
                  <MessageBubble message={msg} onCopy={() => {}} />
                </div>
              ))}
            </div>
            {n && (
              <button
                onClick={() => { if (t.current) t.current.scrollTop = t.current.scrollHeight }}
                className="absolute bottom-0 right-0 w-8 h-8 flex items-center justify-center rounded-md bg-bg-panel text-text-secondary border-none cursor-pointer"
              >
                <ArrowDown size={20} />
              </button>
            )}
          </div>
          <div className="pt-2 shrink-0">
            <SlashMenu
              providers={e.providers}
              selectedModel={e.selectedModel}
              mode={e.mode}
              thinking={e.thinking}
              contextTokens={e.contextTokens}
              contextWindow={e.contextWindow}
              isStreaming={e.streaming}
              statusLabel={e.statusLabel}
              statusKind={e.statusKind}
              onSend={e.onSend}
              onStop={e.onStop}
              onModelChange={e.onModelSelect}
              onModeChange={e.onModeChange}
              onThinkingChange={(t: string) => e.onThinkingChange?.(t)}
              welcomeMode={false}
              agents={e.agents}
            />
          </div>
        </>
      )}
    </div>
  )
}

export const hh = [
  {id:'expert', icon:Bot, label:'Quinki Expert', color:'var(--q-accent-orange)', panel:'expert', doubleBot:false},
  {id:'chat', icon:MessageSquare, label:'Chat', color:'var(--q-accent-info)', panel:'chat', doubleBot:false},
  {id:'log', icon:Terminal, label:'Log', color:'var(--q-accent-success)', panel:'log', doubleBot:false},
  {id:'agents', icon:Bot, label:'Agents', color:'var(--q-accent-secondary)', panel:'agents', doubleBot:true},
  {id:'settings', icon:Settings, label:'Settings', color:'var(--q-accent-primary)', panel:'settings', doubleBot:false},
]