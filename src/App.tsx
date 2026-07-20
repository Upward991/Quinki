// ============================================================
// App.tsx — Functional app connected to real sidecar
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSidecarData } from './hooks/useSidecarData'
import { Sidebar } from './components/sidebar/Sidebar'
import { ChatArea } from './components/chat/ChatArea'
import { HomeView } from './components/home/HomeView'
import { AgentsPanel } from './components/agents/AgentsPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { LogPanel } from './components/log/LogPanel'
import { GlobalContextMenu } from './components/shared/GlobalContextMenu'
import { mockThemes } from './design/mock-data'
import type { ChatMode, ThinkingLevel, Session } from './types'

type SidebarMode = 'pinned' | 'hidden' | 'peek'

// Theme IDs matching CSS [data-theme] selectors (referenced by mockThemes)

export default function App() {
  const sidecar = useSidecarData('ws://127.0.0.1:9182')

  const [activePanel, setActivePanel] = useState<string>('home')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('pinned')
  const [sidebarWidth] = useState(260)
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(['quinki-expert', 'orchestrator'])
  const [chatAgentIds, setChatAgentIds] = useState<string[]>(['quinki-expert'])
  const [selectedModel, setSelectedModel] = useState('')
  const [mode, setMode] = useState<ChatMode>('build')
  const [thinking, setThinking] = useState<ThinkingLevel>('on')
  const [themeId, setThemeId] = useState('comfort')
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const [expertDirModal, setExpertDirModal] = useState(false)
  const [expertDir, setExpertDir] = useState<string>('')
  const [welcomeMode, setWelcomeMode] = useState(false)
  const expertDirAsked = useRef(false)

  // ── Set theme on mount and change ──
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeId)
  }, [themeId])

  // ── Welcome mode when entering chat with no session ──
  useEffect(() => {
    if (activePanel === 'chat' && !sidecar.activeSessionId && !sidecar.isStreaming) {
      setWelcomeMode(true)
    } else if (sidecar.activeSessionId) {
      setWelcomeMode(false)
    }
  }, [activePanel, sidecar.activeSessionId, sidecar.isStreaming])

  const activeSession = sidecar.sessions.find(s => s.id === sidecar.activeSessionId)
  const sidebarPinned = activePanel === 'chat' && sidebarMode === 'pinned'
  const sidebarVisible = activePanel === 'chat' && (sidebarMode === 'pinned' || sidebarMode === 'peek')

  const handleThemeChange = useCallback((id: string) => {
    setThemeId(id)
  }, [])

  const handleAgentToggle = useCallback((agentId: string) => {
    setSelectedAgentIds(prev =>
      prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
    )
  }, [])

  const handleChatAgentToggle = useCallback((agentId: string) => {
    setChatAgentIds(prev => {
      const next = prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
      // Sync to sidecar
      sidecar.setChatAgents(next)
      return next
    })
  }, [sidecar])

  const handleSend = useCallback((text: string) => {
    // Extract @agent mentions from text
    const mentionMatch = text.match(/@(\w+)/)
    const agentId = mentionMatch ? sidecar.agents.find(a => a.name.toLowerCase() === mentionMatch[1].toLowerCase())?.id : undefined

    sidecar.sendMessage(text, {
      agentId: agentId || chatAgentIds[0],
      model: selectedModel || undefined,
      thinkingLevel: thinking,
    })
    setWelcomeMode(false)
  }, [sidecar, chatAgentIds, selectedModel, thinking])

  const handleStop = useCallback(() => {
    sidecar.stopStreaming()
  }, [sidecar])

  const handleToggleSidebar = useCallback(() => {
    if (activePanel !== 'chat') return
    setSidebarMode(prev => prev === 'pinned' ? 'hidden' : 'pinned')
  }, [activePanel])

  const handleToggleFolder = useCallback((_id: string) => {
    // For now, folders are managed locally
    // Could be extended with sidecar.setFolders
  }, [])

  const handleSelectSession = useCallback((id: string) => {
    sidecar.selectSession(id)
    setWelcomeMode(false)
    setActivePanel('chat')
  }, [sidecar])

  const handleNewSession = useCallback(() => {
    setWelcomeMode(true)
    setActivePanel('chat')
    // Session will be created on first message by sendMessage
  }, [])

  const handleSelectPanel = useCallback((panel: string) => {
    // Expert panel: ask for directory on first access
    if (panel === 'expert' && !expertDirAsked.current) {
      setExpertDirModal(true)
      expertDirAsked.current = true
      return
    }
    setActivePanel(panel)
  }, [])

  const handleExpertDirConfirm = useCallback(async () => {
    if (expertDir.trim()) {
      // Create expert session with fixed key
      await sidecar.ensureSession('__quinki_expert__', 'Quinki Expert')
      if (expertDir) {
        await sidecar.setWorkingDir(expertDir, '__quinki_expert__')
      }
    }
    setExpertDirModal(false)
    setActivePanel('expert')
    sidecar.selectSession('__quinki_expert__')
  }, [expertDir, sidecar])

  // ── Model select: also set on sidecar ──
  const handleModelSelect = useCallback((model: string) => {
    setSelectedModel(model)
    sidecar.setModel(model)
  }, [sidecar])

  // ── Thinking change ──
  const handleThinkingChange = useCallback((level: ThinkingLevel) => {
    setThinking(level)
    sidecar.setThinkingLevel(level)
  }, [sidecar])

  // ── Mode change ──
  const handleModeChange = useCallback((m: ChatMode) => {
    setMode(m)
    sidecar.setMode(m)
  }, [sidecar])

  // ── Reset session ──
  const handleReset = useCallback(() => {
    if (sidecar.activeSessionId) {
      sidecar.resetSession(sidecar.activeSessionId)
    }
  }, [sidecar])

  // ── Session reorder (sidebar drag&drop) ──
  const handleReorder = useCallback((_newSessions: Session[]) => {
    // Update local state — sidecar doesn't have a reorder RPC, but we can moveSession
    // For now, just update the sessions array locally
    // The sidecar manages folders via setFolders
  }, [])

  // ── Connecting screen ──
  if (!sidecar.connected) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        backgroundColor: 'var(--q-bg)',
        color: 'var(--q-text-secondary)',
        fontFamily: 'var(--font-interface)',
        fontSize: '16px',
        gap: '16px',
      }}>
        <div style={{
          width: '24px',
          height: '24px',
          border: '2px solid var(--q-text-tertiary)',
          borderTopColor: 'var(--q-accent-secondary)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <span>Connecting to sidecar…</span>
      </div>
    )
  }

  const mainPaddingLeft = sidebarPinned ? sidebarWidth + 8 : 0

  // Build providers list for components
  const providers = sidecar.providers.length > 0 ? sidecar.providers : []

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--q-bg)' }}>
      {/* Title bar drag region — Overlay style */}
      <div
        data-tauri-drag-region
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '28px',
          zIndex: 9999,
          backgroundColor: 'var(--q-bg)',
          pointerEvents: 'none',
        }}
      />

      <div className="flex-1 relative overflow-hidden" style={{ marginTop: '28px' }}>
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
              messages={sidecar.messages}
              streaming={sidecar.isStreaming}
              welcomeMode={welcomeMode}
              mode={mode}
              activePanel={activePanel}
              onSelectPanel={handleSelectPanel}
              sidebarOpen={sidebarMode === 'pinned'}
              onToggleSidebar={handleToggleSidebar}
              agentDropdownOpen={agentDropdownOpen}
              onToggleAgentDropdown={() => setAgentDropdownOpen(!agentDropdownOpen)}
              agents={sidecar.agents}
              selectedAgentIds={chatAgentIds}
              onAgentToggle={handleChatAgentToggle}
              providers={providers}
              selectedModel={selectedModel}
              onModelSelect={handleModelSelect}
              onModeChange={handleModeChange}
              thinking={thinking}
              onThinkingChange={handleThinkingChange}
              contextTokens={sidecar.contextTokens}
              contextWindow={sidecar.contextWindow}
              onSend={handleSend}
              onStop={handleStop}
              onRenameSession={(label) => { if (sidecar.activeSessionId) sidecar.renameSession(sidecar.activeSessionId, label) }}
              statusLabel={sidecar.statusLabel}
              statusKind={sidecar.statusKind}
              onExport={() => {}}
              onReset={handleReset}
            />
          )}

          {activePanel === 'expert' && (
            <ChatArea
              session={{ id: '__quinki_expert__', title: 'Quinki Expert', type: 'chat', updatedAt: new Date().toISOString() }}
              messages={sidecar.activeSessionId === '__quinki_expert__' ? sidecar.messages : []}
              streaming={sidecar.isStreaming}
              welcomeMode={sidecar.activeSessionId !== '__quinki_expert__'}
              mode={mode}
              activePanel={activePanel}
              onSelectPanel={handleSelectPanel}
              sidebarOpen={false}
              onToggleSidebar={() => {}}
              agentDropdownOpen={agentDropdownOpen}
              onToggleAgentDropdown={() => setAgentDropdownOpen(!agentDropdownOpen)}
              agents={sidecar.agents}
              selectedAgentIds={selectedAgentIds}
              onAgentToggle={handleAgentToggle}
              providers={providers}
              selectedModel={selectedModel}
              onModelSelect={handleModelSelect}
              onModeChange={handleModeChange}
              thinking={thinking}
              onThinkingChange={handleThinkingChange}
              contextTokens={sidecar.contextTokens}
              contextWindow={sidecar.contextWindow}
              onSend={(text) => {
                // Expert always sends with quinki-expert agent
                sidecar.sendMessage(text, {
                  sessionKey: '__quinki_expert__',
                  agentId: 'quinki-expert',
                  model: selectedModel || undefined,
                  thinkingLevel: thinking,
                  workingDirs: expertDir ? [expertDir] : undefined,
                })
              }}
              onStop={handleStop}
              onRenameSession={() => {}}
              onExport={() => {}}
            />
          )}

          {activePanel === 'agents' && (
            <AgentsPanel
              activePanel={activePanel}
              onSelectPanel={handleSelectPanel}
              agents={sidecar.agents}
              call={sidecar.call}
            />
          )}

          {activePanel === 'log' && (
            <LogPanel
              activePanel={activePanel}
              onSelectPanel={handleSelectPanel}
              
              
              
            />
          )}

          {activePanel === 'settings' && (
            <SettingsPanel
              activePanel={activePanel}
              onSelectPanel={handleSelectPanel}
              themes={mockThemes}
              activeThemeId={themeId}
              onThemeChange={handleThemeChange}
              providers={providers}
              call={sidecar.call}
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
                sessions={sidecar.sessions}
                activeSessionId={sidecar.activeSessionId || ''}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                onToggleFolder={handleToggleFolder}
                onReorder={handleReorder}
                welcomeMode={welcomeMode}
                onDeleteSession={sidecar.deleteSession}
                onRenameSession={sidecar.renameSession}
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

      {/* Expert directory modal */}
      {expertDirModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            backgroundColor: 'var(--q-overlay)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setExpertDirModal(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--q-bg-elevated)',
              borderRadius: 'var(--radius-xl)',
              boxShadow: 'var(--shadow-modal)',
              border: '1px solid var(--q-border)',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ color: 'var(--q-text)', fontSize: '18px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
              Quinki Expert — Source Directory
            </div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>
              Enter the path to your source code directory. Quinki Expert will work with files in this directory.
            </div>
            <input
              type="text"
              placeholder="/Users/you/Projects/my-project"
              value={expertDir}
              autoFocus
              onChange={e => setExpertDir(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleExpertDirConfirm() }}
              style={{
                width: '100%', height: '40px',
                backgroundColor: 'var(--q-bg-panel)',
                border: '1px solid var(--q-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--q-text)', fontSize: '14px',
                fontFamily: 'var(--font-interface)',
                padding: '0 12px', outline: 'none',
                marginBottom: '20px',
                WebkitUserSelect: 'text',
                userSelect: 'text',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setExpertDirModal(false)}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-md)',
                  border: 'none', cursor: 'pointer',
                  backgroundColor: 'transparent',
                  color: 'var(--q-text-secondary)',
                  fontSize: '15px', fontFamily: 'var(--font-interface)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleExpertDirConfirm}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-md)',
                  border: 'none', cursor: 'pointer',
                  backgroundColor: 'var(--q-accent-primary)',
                  color: 'var(--q-bg)',
                  fontSize: '15px', fontWeight: 500,
                  fontFamily: 'var(--font-interface)',
                }}
              >
                Start
              </button>
            </div>
          </div>
        </div>
      )}

      <GlobalContextMenu />
    </div>
  )
}