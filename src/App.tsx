import { useState, useRef, useEffect, useCallback } from 'react'
import { SidecarContext } from './components/shared/AppShell'
import { HomeView } from './components/home/HomeView'
import { ChatArea } from './components/chat/ChatArea'
import { AgentsPanel } from './components/agents/AgentsPanel'
import { LogPanel } from './components/log/LogPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { Sidebar } from './components/sidebar/Sidebar'
import { GlobalContextMenu } from './components/shared/GlobalContextMenu'
import { useSidecarData } from './hooks/useSidecarData'
import { mockThemes } from './design/mock-data'

export default function App() {
  const e = useSidecarData()
  const [tab, setTab] = useState('home')
  const [sidebarState, setSidebarState] = useState('pinned')
  const [sidebarWidth] = useState(260)
  const [activeSession, setActiveSession] = useState('')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [mode, setMode] = useState('build')
  const [thinking, setThinking] = useState('on')
  const [themeId, setThemeId] = useState('comfort')
  const [welcomeMode, setWelcomeMode] = useState(false)
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)

  useEffect(() => { document.documentElement.setAttribute('data-theme', themeId) }, [])
  useEffect(() => { if (e.activeSessionId) setActiveSession(e.activeSessionId) }, [e.activeSessionId])
  useEffect(() => { if (e.activeSessionId) setWelcomeMode(false); else if (tab === 'chat') setWelcomeMode(true) }, [e.activeSessionId, tab])

  const onThemeChange = useCallback((t: string) => { setThemeId(t); document.documentElement.setAttribute('data-theme', t) }, [])
  const onAgentToggle = useCallback((id: string) => {
    setSelectedAgentIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      const sk = activeSession || e.activeSessionId || ''
      if (sk) e.setChatAgents(sk, next)
      return next
    })
  }, [e, activeSession])

  const onToggleSidebar = useCallback(() => { if (tab === 'chat') setSidebarState(s => s === 'pinned' ? 'hidden' : 'pinned') }, [tab])
  const onToggleFolder = useCallback(() => {}, [])
  const onSelectSession = useCallback((id: string) => { setActiveSession(id); setWelcomeMode(false); e.selectSession(id) }, [e])
  const onNewSession = useCallback(() => { setActiveSession(''); setWelcomeMode(true); setTab('chat') }, [])
  const onSend = useCallback((text: string) => {
    const sk = activeSession || e.activeSessionId || ''
    const agents = tab === 'expert' ? ['quinki-expert'] : selectedAgentIds
    e.sendMessage(text, sk, agents)
    setWelcomeMode(false)
  }, [e, activeSession, selectedAgentIds, tab])
  const onStop = useCallback(() => { e.stopStreaming() }, [e])
  const onSelectPanel = useCallback((p: string) => setTab(p), [])
  const onReorder = useCallback((newSessions: any[]) => {
    const oldIds = new Set(e.sessions.map((s: any) => s.id))
    const newIds = new Set(newSessions.map(s => s.id))
    for (const id of oldIds) { if (!newIds.has(id)) e.deleteSession(id) }
  }, [e])

  // Connecting screen
  if (!e.connected) return (
    <div className="flex items-center justify-center h-screen bg-bg flex-col gap-4">
      <div className="text-18 font-interface text-text-secondary">Connecting to sidecar…</div>
      <div className="text-13 font-code text-text-tertiary">ws://127.0.0.1:9182</div>
      <div className="w-[200px] h-0.5 bg-border rounded-sm overflow-hidden">
        <div className="w-2/5 h-full bg-accent-primary rounded-sm" style={{ animation: 'breathe 1.5s ease-in-out infinite' }} />
      </div>
      {e.error && <div className="text-12 font-code text-accent-danger mt-2">{e.error}</div>}
      <div className="text-12 font-interface text-text-tertiary mt-4 text-center max-w-[400px]" style={{ lineHeight: 1.6 }}>
        Start the sidecar with:<br />
        <code className="text-text-secondary font-code">cd ~/Projects/Quinki/sidecar-src && npx tsx ws-bridge.ts</code>
      </div>
    </div>
  )

  const sessions = e.sessions
  const agents = e.agents
  const providers = e.providers
  const messages = e.messages
  const isStreaming = e.isStreaming
  const statusLabel = e.statusLabel
  const statusKind = e.statusKind
  const contextTokens = e.contextTokens
  const contextWindow = e.contextWindow
  const currentSession = sessions.find((s: any) => s.id === activeSession)
  const showSidebar = tab === 'chat' && (sidebarState === 'pinned' || sidebarState === 'peek')
  const sidebarOffset = sidebarState === 'pinned' ? sidebarWidth + 8 : 0

  return (
    <SidecarContext.Provider value={{ call: e.call, notify: e.notify, connected: e.connected }}>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg">
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 transition-all duration-200" style={{ padding: '8px', paddingLeft: `${8 + sidebarOffset}px` }}>
            {tab === 'home' && <HomeView activePanel={tab} onSelectPanel={onSelectPanel} />}
            {tab === 'chat' && (
              <ChatArea
                session={currentSession}
                messages={messages}
                streaming={isStreaming}
                welcomeMode={welcomeMode}
                mode={mode}
                activePanel={tab}
                onSelectPanel={onSelectPanel}
                sidebarOpen={sidebarState === 'pinned'}
                onToggleSidebar={onToggleSidebar}
                agentDropdownOpen={agentDropdownOpen}
                onToggleAgentDropdown={() => setAgentDropdownOpen(!agentDropdownOpen)}
                agents={agents}
                selectedAgentIds={selectedAgentIds}
                onAgentToggle={onAgentToggle}
                providers={providers}
                selectedModel={selectedModel}
                onModelSelect={(m: string) => {
                  setSelectedModel(m)
                  const sk = activeSession || e.activeSessionId || ''
                  if (sk) e.setModel(sk, m)
                }}
                onModeChange={setMode}
                thinking={thinking}
                onThinkingChange={(t: string) => {
                  setThinking(t)
                  const sk = activeSession || e.activeSessionId || ''
                  if (sk) e.setThinkingLevel(sk, t)
                }}
                contextTokens={contextTokens}
                contextWindow={contextWindow}
                onSend={onSend}
                onStop={onStop}
                onExport={() => {}}
                statusLabel={statusLabel}
                statusKind={statusKind}
              />
            )}
            {tab === 'expert' && (
              <ChatArea
                session={undefined}
                messages={messages}
                streaming={isStreaming}
                welcomeMode={welcomeMode}
                mode={mode}
                activePanel={tab}
                onSelectPanel={onSelectPanel}
                sidebarOpen={false}
                onToggleSidebar={() => {}}
                agentDropdownOpen={agentDropdownOpen}
                onToggleAgentDropdown={() => setAgentDropdownOpen(!agentDropdownOpen)}
                agents={agents}
                selectedAgentIds={['quinki-expert']}
                onAgentToggle={onAgentToggle}
                providers={providers}
                selectedModel={selectedModel}
                onModelSelect={(m: string) => {
                  setSelectedModel(m)
                  const sk = activeSession || e.activeSessionId || ''
                  if (sk) e.setModel(sk, m)
                }}
                onModeChange={setMode}
                thinking={thinking}
                onThinkingChange={(t: string) => {
                  setThinking(t)
                  const sk = activeSession || e.activeSessionId || ''
                  if (sk) e.setThinkingLevel(sk, t)
                }}
                contextTokens={contextTokens}
                contextWindow={contextWindow}
                onSend={onSend}
                onStop={onStop}
                onExport={() => {}}
                statusLabel={statusLabel}
                statusKind={statusKind}
              />
            )}
            {tab === 'agents' && <AgentsPanel activePanel={tab} onSelectPanel={onSelectPanel} agents={agents} />}
            {tab === 'log' && <LogPanel activePanel={tab} onSelectPanel={onSelectPanel} logs={[]} />}
            {tab === 'settings' && <SettingsPanel activePanel={tab} onSelectPanel={onSelectPanel} themes={mockThemes} activeThemeId={themeId} onThemeChange={onThemeChange} providers={providers} />}
          </div>

          {/* Sidebar */}
          {showSidebar && (
            <div className="absolute top-2 bottom-2 transition-all duration-200" style={{ left: '8px', width: `${sidebarWidth}px` }}>
              <div className="h-full overflow-hidden bg-bg-panel rounded-lg shadow-floating">
                <Sidebar
                  sessions={sessions}
                  activeSessionId={activeSession || e.activeSessionId || ''}
                  onSelectSession={onSelectSession}
                  onNewSession={onNewSession}
                  onToggleFolder={onToggleFolder}
                  onReorder={onReorder}
                  welcomeMode={welcomeMode}
                />
              </div>
            </div>
          )}

          {/* Sidebar hover zones */}
          {tab === 'chat' && sidebarState === 'hidden' && (
            <div className="absolute top-2 bottom-2 left-0" style={{ width: '12px' }} onMouseEnter={() => setSidebarState('peek')} />
          )}
          {sidebarState === 'peek' && (
            <div className="absolute inset-0" style={{ width: `${sidebarWidth + 20}px` }} onMouseLeave={() => setSidebarState('hidden')} />
          )}
        </div>
        <GlobalContextMenu />
      </div>
    </SidecarContext.Provider>
  )
}