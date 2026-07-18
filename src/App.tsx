// ============================================================
// App.tsx — Container principale (logic layer)
// ============================================================

import { useState, useCallback, useRef } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { ChatArea } from './components/chat/ChatArea'
import { HomeView } from './components/home/HomeView'
import { AgentsPanel } from './components/agents/AgentsPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { LogPanel } from './components/log/LogPanel'
import { GlobalContextMenu } from './components/shared/GlobalContextMenu'
import { mockMessages, mockSessions, mockAgents, mockProviders, mockThemes } from './design/mock-data'
import type { ViewTab, ChatMode, ThinkingLevel } from './types'

type SidebarMode = 'pinned' | 'hidden' | 'peek'

// Context tokens per session
const sessionCtx: Record<string, number> = {
  s0a: 0,
  s0b: 0,
  s50: 500000,   // 50% of 1M
  s80: 800000,   // 80% of 1M
}

export default function App() {
  const [activePanel, setActivePanel] = useState<string>('home')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('pinned')
  const [sidebarWidth] = useState(284)
  const [activeSessionId, setActiveSessionId] = useState('s0a')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(['quinki-expert', 'orchestrator'])
  const [chatAgentIds, setChatAgentIds] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('glm-4.5')
  const [mode, setMode] = useState<ChatMode>('build')
  const [thinking, setThinking] = useState<ThinkingLevel>('on')
  const [themeId, setThemeId] = useState('vision-comfort-neutral')
  const [isStreaming, setIsStreaming] = useState(false)
  const [messages, setMessages] = useState(mockMessages)
  const [sessions, setSessions] = useState(mockSessions)
  const [welcomeMode, setWelcomeMode] = useState(false)
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const [statusLabel, setStatusLabel] = useState('')
  const [statusKind, setStatusKind] = useState('')
  const isStreamingRef = useRef(false)

  const activeSession = sessions.find(s => s.id === activeSessionId)
  const sidebarPinned = activePanel === 'chat' && sidebarMode === 'pinned'
  const sidebarVisible = activePanel === 'chat' && (sidebarMode === 'pinned' || sidebarMode === 'peek')

  // Context tokens based on session
  const sessionCtxTokens = activeSessionId && sessionCtx[activeSessionId] !== undefined
    ? sessionCtx[activeSessionId]
    : 0

  const handleThemeChange = useCallback((id: string) => {
    setThemeId(id)
    document.documentElement.setAttribute('data-theme', id)
  }, [])

  const handleAgentToggle = useCallback((agentId: string) => {
    setSelectedAgentIds(prev =>
      prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
    )
  }, [])

  const handleChatAgentToggle = useCallback((agentId: string) => {
    setChatAgentIds(prev =>
      prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
    )
  }, [])

  const handleSend = useCallback((text: string) => {
    const userMsg = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: text,
      timestamp: new Date().toISOString(),
      tokensIn: Math.ceil(text.length / 4),
    }
    setMessages(prev => [...prev, userMsg])
    setWelcomeMode(false)
    setIsStreaming(true)
    isStreamingRef.current = true
    setStatusLabel('Thinking')
    setStatusKind('thinking')

    const assistantId = `msg-${Date.now() + 1}`
    const assistantMsg = {
      id: assistantId,
      role: 'assistant' as const,
      content: '',
      agentName: 'Quinki Expert',
      agentModel: selectedModel,
      timestamp: new Date().toISOString(),
      isStreaming: true,
    }
    setMessages(prev => [...prev, assistantMsg as any])

    // Simulate ALL status states for designer review
    const states = [
      { label: 'Thinking', kind: 'thinking', delay: 0 },
      { label: 'Tool call', kind: 'tool', delay: 2000 },
      { label: 'Tool result', kind: 'tool_result', delay: 3500 },
      { label: 'Tool error', kind: 'tool_error', delay: 4700 },
      { label: 'Compacting', kind: 'compacting', delay: 5900 },
      { label: 'Running', kind: 'running', delay: 6900 },
      { label: 'Failed', kind: 'failed', delay: 7900 },
      { label: 'Writing', kind: 'writing', delay: 8900 },
    ]

    states.forEach(s => {
      setTimeout(() => {
        if (!isStreamingRef.current) return
        setStatusLabel(s.label)
        setStatusKind(s.kind)
      }, s.delay)
    })

    // Start writing after the states
    const response = 'This is a simulated response. The prototype is running with mock data — no sidecar connected.\n\nOnce the visual design is verified pixel-perfect against Quinki, we\'ll connect the real sidecar.'
    const tokens = response.split(' ')
    let idx = 0
    setTimeout(() => {
      if (!isStreamingRef.current) return
      const interval = setInterval(() => {
        if (idx >= tokens.length) {
          clearInterval(interval)
          setIsStreaming(false)
          isStreamingRef.current = false
          setStatusLabel('')
          setStatusKind('')
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
          return
        }
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + tokens[idx] + ' ' } : m))
        idx++
      }, 50)
    }, 8900)

  }, [selectedModel])

  const handleStop = useCallback(() => {
    setIsStreaming(false)
    isStreamingRef.current = false
    setStatusLabel('')
    setStatusKind('')
    setMessages(prev => prev.map(m => ({ ...m, isStreaming: false })))
  }, [])

  const handleToggleSidebar = useCallback(() => {
    if (activePanel !== 'chat') return
    setSidebarMode(prev => prev === 'pinned' ? 'hidden' : 'pinned')
  }, [activePanel])

  const handleToggleFolder = useCallback((id: string) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, isExpanded: !s.isExpanded } : s))
  }, [])

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id)
    setWelcomeMode(false)
    // Load messages for the session — use mockMessages for sessions with content, empty for new
    // All sessions show the same mock messages
    setMessages(mockMessages)
    setWelcomeMode(false)
  }, [])

  const handleNewSession = useCallback(() => {
    const newId = 'new-' + Date.now()
    const newSession = { id: newId, title: 'New chat', type: 'chat' as const, updatedAt: new Date().toISOString(), messageCount: 0 }
    setSessions(prev => [newSession, ...prev])
    setActiveSessionId(newId)
    setMessages([])
    setWelcomeMode(true)
    setActivePanel('chat')
  }, [])

  const handleSelectPanel = useCallback((panel: string) => {
    setActivePanel(panel)
  }, [])

  const mainPaddingLeft = sidebarPinned ? sidebarWidth + 8 : 0

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--q-bg)' }}>
      <div className="flex-1 relative overflow-hidden">
        <div
          className="absolute inset-0 transition-all duration-200"
          style={{ padding: '8px', paddingLeft: `${8 + mainPaddingLeft}px` }}
        >
          {activePanel === 'home' && (
            <HomeView activePanel={activePanel} onSelectPanel={handleSelectPanel} />
          )}

          {activePanel === 'chat' && (
            <ChatArea
              session={activeSession}
              messages={messages}
              streaming={isStreaming}
              welcomeMode={welcomeMode}
              mode={mode}
              activePanel={activePanel}
              onSelectPanel={handleSelectPanel}
              sidebarOpen={sidebarMode === 'pinned'}
              onToggleSidebar={handleToggleSidebar}
              agentDropdownOpen={agentDropdownOpen}
              onToggleAgentDropdown={() => setAgentDropdownOpen(!agentDropdownOpen)}
              agents={mockAgents}
              selectedAgentIds={chatAgentIds}
              onAgentToggle={handleChatAgentToggle}
              providers={mockProviders}
              selectedModel={selectedModel}
              onModelSelect={setSelectedModel}
              onModeChange={setMode}
              thinking={thinking}
              onThinkingChange={setThinking}
              contextTokens={sessionCtxTokens}
              contextWindow={1000000}
              onSend={handleSend}
              onStop={handleStop}
              onRenameSession={() => {}}
              statusLabel={statusLabel}
              statusKind={statusKind}
              onExport={() => {}}
            />
          )}

          {activePanel === 'expert' && (
            <ChatArea
              session={{ id: '__expert__', title: 'Quinki Expert', type: 'chat', updatedAt: new Date().toISOString() }}
              messages={messages}
              streaming={isStreaming}
              welcomeMode={welcomeMode}
              mode={mode}
              activePanel={activePanel}
              onSelectPanel={handleSelectPanel}
              sidebarOpen={false}
              onToggleSidebar={() => {}}
              agentDropdownOpen={agentDropdownOpen}
              onToggleAgentDropdown={() => setAgentDropdownOpen(!agentDropdownOpen)}
              agents={mockAgents}
              selectedAgentIds={selectedAgentIds}
              onAgentToggle={handleAgentToggle}
              providers={mockProviders}
              selectedModel={selectedModel}
              onModelSelect={setSelectedModel}
              onModeChange={setMode}
              thinking={thinking}
              onThinkingChange={setThinking}
              contextTokens={154200}
              contextWindow={1000000}
              onSend={handleSend}
              onStop={handleStop}
              onRenameSession={() => {}}
              onExport={() => {}}
            />
          )}

          {activePanel === 'agents' && (
            <AgentsPanel activePanel={activePanel} onSelectPanel={handleSelectPanel} agents={mockAgents} />
          )}

          {activePanel === 'log' && (
            <LogPanel activePanel={activePanel} onSelectPanel={handleSelectPanel} />
          )}

          {activePanel === 'settings' && (
            <SettingsPanel
              activePanel={activePanel}
              onSelectPanel={handleSelectPanel}
              themes={mockThemes}
              activeThemeId={themeId}
              onThemeChange={handleThemeChange}
              providers={mockProviders}
            />
          )}
        </div>

        {sidebarVisible && (
          <div
            className="absolute top-2 bottom-2 transition-all duration-200"
            style={{ left: '8px', width: `${sidebarWidth}px` }}
          >
            <div
              className="h-full overflow-hidden"
              style={{
                backgroundColor: 'var(--q-bg-panel)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-floating)',
              }}
            >
              <Sidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                onToggleFolder={handleToggleFolder}
                onReorder={setSessions}
              />
            </div>
          </div>
        )}

        {activePanel === 'chat' && sidebarMode === 'hidden' && (
          <div
            className="absolute top-2 bottom-2 left-0"
            style={{ width: '12px' }}
            onMouseEnter={() => setSidebarMode('peek')}
          />
        )}

        {sidebarMode === 'peek' && (
          <div
            className="absolute inset-0"
            style={{ width: `${sidebarWidth + 20}px` }}
            onMouseLeave={() => setSidebarMode('hidden')}
          />
        )}
      </div>
      <GlobalContextMenu />
    </div>
  )
}