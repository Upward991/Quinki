// ============================================================
// ChatArea — structure fix: overflow hidden on messages, button outside
// ============================================================

import { useRef, useEffect, useState, useLayoutEffect, useCallback } from 'react'

import { messageMatchesFilters } from '../../utils/dateParser'
import { getContrastColor } from '../../utils/contrast'
import { MessageBubble } from './MessageBubble'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { ArrowDown, Checklist, ChevronDown, ChevronUp } from '../icons'
import { useSidecarContext } from '../shared/AppShell'
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
  hideSidebarToggle?: boolean
  isExpertApp?: boolean
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
  onExport: (format?: string) => void
  onReset?: () => void
  onReload?: () => void
  onCompact?: () => void
}

export function ChatArea(props: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  // Pinned-to-bottom: true finché l'utente è in fondo. Se l'utente sale durante lo
  // streaming, il pin si scioglie e lo scroll automatico si ferma; rientrando in fondo
  // il pin si rinsalda e lo scroll automatico riprende.
  const pinnedRef = useRef(true)
  const [composerH, setComposerH] = useState(0)
  // === A2.8: Task Timeline ===
  const { call: sidecarCall } = useSidecarContext()
  const sessionIdKey = props.session?.id || ''
  const [taskPanelOpen, setTaskPanelOpen] = useState<boolean>(() => { try { return localStorage.getItem('quinki-taskpanel-' + sessionIdKey) === '1' } catch { return false } })
  const [taskExecs, setTaskExecs] = useState<any[]>([])
  const [taskScheds, setTaskScheds] = useState<any[]>([])
  const [taskMsgs, setTaskMsgs] = useState<any[]>([])
  const taskScrollRef = useRef<HTMLDivElement>(null)
  const toggleTaskPanel = () => { const nv = !taskPanelOpen; setTaskPanelOpen(nv); try { localStorage.setItem('quinki-taskpanel-' + sessionIdKey, nv ? '1' : '0') } catch {} }
  const refreshTasks = useCallback(async () => {
    if (!sessionIdKey || sessionIdKey === '__app_expert__') { setTaskExecs([]); setTaskScheds([]); setTaskMsgs([]); return }
    try {
      const [exR, schR] = await Promise.all([sidecarCall('listExecutions'), sidecarCall('listSchedules')])
      const execs = (exR?.executions || []).filter((e: any) => e.sourceSession?.key === sessionIdKey)
      const scheds = (schR?.schedules || []).filter((s: any) => s.sourceSession?.key === sessionIdKey)
      setTaskExecs(execs); setTaskScheds(scheds)
      const all: any[] = []
      for (const e of execs) {
        try { const mR = await sidecarCall('getExecutionMessages', { executionId: e.id }); for (const m of (mR?.messages || [])) all.push(m) } catch {}
      }
      all.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
      setTaskMsgs(all)
    } catch {}
  }, [sessionIdKey, sidecarCall])
  useEffect(() => { refreshTasks(); const iv = setInterval(refreshTasks, 3000); return () => clearInterval(iv) }, [refreshTasks])
  useEffect(() => { if (taskPanelOpen && taskScrollRef.current) taskScrollRef.current.scrollTop = taskScrollRef.current.scrollHeight }, [taskPanelOpen, taskMsgs])
  const prevSessionIdRef = useRef('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchDate, setSearchDate] = useState('')
  const [searchTime, setSearchTime] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const [dateMatchIdx, setDateMatchIdx] = useState(0)
  const [dragOver, setDragOver] = useState(false)

  // === HTML5 Drag-and-drop file support ===
  // dragDropEnabled: false in tauri.conf.json lets WKWebView handle HTML5 drag events
  const dragCounter = useRef(0)
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    setDragOver(true)
  }
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragOver(false)
    }
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const b64 = btoa(binary)
        if ((window as any).__quinkiAddAttachmentFromContent) {
          await (window as any).__quinkiAddAttachmentFromContent(file.name, b64)
        }
      } catch (err) {
        console.error('[drag-drop] file read error:', err)
      }
    }
  }

  // Date/time filter: just find the FIRST matching message (for yellow border + scroll)
  const hasDateFilter = !!(searchDate.trim() || searchTime.trim())
  const lastMsgTs = props.messages.length > 0 ? new Date(props.messages[props.messages.length - 1].timestamp).getTime() : undefined
  const dateMatchIndices: number[] = (() => {
    if (!hasDateFilter) return []
    const out: number[] = []
    for (let i = 0; i < props.messages.length; i++) {
      const m = props.messages[i]
      if (m.role !== 'user' && m.role !== 'assistant') continue
      if (!m.content && !m.errorContent && !(m as any).blocks?.length) continue
      const ts = new Date(m.timestamp).getTime()
      if (messageMatchesFilters(ts, searchDate, searchTime, lastMsgTs)) out.push(i)
    }
    return out
  })()
  const dateFirstMatch = dateMatchIndices.length > 0 ? dateMatchIndices[0] : -1

  // Text matches: only when there's a text query (filtered by date/time if set)
  const matches = (() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.trim().toLowerCase()
    const out: { msgIdx: number, charIdx: number }[] = []
    props.messages.forEach((m, i) => {
      if (m.role !== 'user' && m.role !== 'assistant') return
      if (hasDateFilter) {
        const ts = new Date(m.timestamp).getTime()
        if (!messageMatchesFilters(ts, searchDate, searchTime, lastMsgTs)) return
      }
      let text = (m.content || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
      text = text.toLowerCase()
      let idx = 0
      while ((idx = text.indexOf(q, idx)) !== -1) {
        out.push({ msgIdx: i, charIdx: idx })
        idx += q.length
      }
    })
    return out
  })()

  // Active match: only for text search (date-only has no matches)
  const activeMatchIdx = currentMatch < 0 ? matches.length - 1 : currentMatch
  const activeMatchInfo = (() => {
    if (matches.length === 0 || activeMatchIdx < 0) return null
    const m = matches[activeMatchIdx]
    let occ = 0
    for (let i = 0; i < activeMatchIdx; i++) {
      if (matches[i].msgIdx === m.msgIdx) occ++
    }
    return { msgIdx: m.msgIdx, occurrence: occ }
  })()

  // Auto-scroll: only when search fields CHANGE (not on every render)
  const prevSearchRef = useRef({ q: '', d: '', t: '' })
  useEffect(() => {
    const prev = prevSearchRef.current
    const qChanged = prev.q !== searchQuery
    const dChanged = prev.d !== searchDate
    const tChanged = prev.t !== searchTime
    prevSearchRef.current = { q: searchQuery, d: searchDate, t: searchTime }
    // Only scroll when a search field actually changed
    if (!qChanged && !dChanged && !tChanged) return

    // Text search: scroll to text match
    if (matches.length > 0 && activeMatchIdx >= 0) {
      const match = matches[activeMatchIdx]
      const msgEl = scrollRef.current?.querySelector(`[data-msg-idx="${match.msgIdx}"]`)
      if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    // Date-only: scroll to first matching message
    if (!searchQuery.trim() && hasDateFilter && dateMatchIndices.length > 0) {
      const mi = dateMatchIndices[Math.min(dateMatchIdx, dateMatchIndices.length - 1)]
      const msgEl = scrollRef.current?.querySelector(`[data-msg-idx="${mi}"]`)
      if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [searchQuery, searchDate, searchTime, activeMatchIdx, dateFirstMatch, dateMatchIdx])

  const isEmpty = props.messages.length === 0 || props.welcomeMode

  // Auto-scroll on session change or new messages (NOT on search change)
  const sessionId = props.session?.id || ''
  const msgCount = props.messages.length
  useLayoutEffect(() => {
    // Skip auto-scroll when search is active
    if (searchQuery || searchDate || searchTime) return
    // Cambio sessione: torna in fondo e rinsalda il pin
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      pinnedRef.current = true
    }
    if (!scrollRef.current || isEmpty) return
    // Se l'utente è salito sopra, NON forzare lo scroll (può leggere i messaggi
    // precedenti durante lo streaming). Rientrerà in automatico quando torna in fondo.
    if (!pinnedRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    // timeout multipli: servono all'apertura della chat (contenuto carica in più passate);
    // OGNI volta ricontrollano pinned → durante lo streaming NON riscendono se hai scrollato su.
    const raf1 = requestAnimationFrame(() => { if (scrollRef.current && pinnedRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })
    const raf2 = requestAnimationFrame(() => { if (scrollRef.current && pinnedRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })
    const t1 = setTimeout(() => { if (scrollRef.current && pinnedRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, 120)
    const t2 = setTimeout(() => { if (scrollRef.current && pinnedRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, 250)
    const t3 = setTimeout(() => { if (scrollRef.current && pinnedRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, 450)
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [sessionId, msgCount, isEmpty, props.streaming, searchQuery, searchDate, searchTime, props.messages, composerH])

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%', position: 'relative' }} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* Drag-drop overlay */}
      {dragOver && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 90, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '32px 48px', borderRadius: 'var(--radius-lg)', border: '2px solid var(--q-tab-accent)', backgroundColor: 'rgba(8,8,11,0.85)', boxShadow: 'inset 0 0 0 8px rgba(8,8,11,0.85), 0 0 40px rgba(0,0,0,0.3)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--q-tab-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', fontWeight: 600 }}>Drop files to attach</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div style={{ marginBottom: '8px', flexShrink: 0 }}>
        <ChatHeader
          session={props.session}
          activePanel={props.activePanel}
          onSelectPanel={props.onSelectPanel}
          sidebarOpen={props.sidebarOpen}
          onToggleSidebar={props.onToggleSidebar}
          hideSidebarToggle={props.hideSidebarToggle}
          isExpertApp={props.isExpertApp}
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
          onReload={props.onReload}
          searchQuery={searchQuery}
          onSearchQueryChange={(q) => { setSearchQuery(q); setCurrentMatch(q.trim() && hasDateFilter ? 0 : -1) }}
          searchDate={searchDate}
          onSearchDateChange={(d) => { setSearchDate(d); setCurrentMatch(-1); setDateMatchIdx(0) }}
          searchTime={searchTime}
          onSearchTimeChange={(t) => { setSearchTime(t); setCurrentMatch(-1); setDateMatchIdx(0) }}
          matchCount={(searchQuery.trim() ? matches.length : 0)}
          currentMatch={currentMatch < 0 ? Math.max(0, matches.length - 1) : currentMatch}
          onMatchNavigate={(dir) => {
            if (searchQuery.trim()) {
              if (matches.length === 0) return
              const start = currentMatch < 0 ? matches.length - 1 : currentMatch
              const next = dir === 'next' ? (start + 1) % matches.length : (start - 1 + matches.length) % matches.length
              setCurrentMatch(next)
              const match = matches[next]
              if (match) {
                const msgEl = scrollRef.current?.querySelector(`[data-msg-idx="${match.msgIdx}"]`)
                if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            } else {
              if (dateMatchCount === 0) return
              const start = dateMatchIdx < 0 ? dateMatchCount - 1 : dateMatchIdx
              const next = dir === 'next' ? (start + 1) % dateMatchCount : (start - 1 + dateMatchCount) % dateMatchCount
              setDateMatchIdx(next)
              const mi = dateMatchIndices[next]
              if (mi !== undefined) {
                const msgEl = scrollRef.current?.querySelector(`[data-msg-idx="${mi}"]`)
                if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }
            // Scroll to the matched message
          }}
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
          {/* Messages / Task panel (A2.8) */}
          {taskPanelOpen ? (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '4px 16px 8px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <Checklist size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
                <span style={{ color: 'var(--q-text)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Tasks</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)' }}>{taskMsgs.length} messages</span>
              </div>
              <div ref={taskScrollRef} className="q-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 16px 8px 16px', scrollbarGutter: 'stable' }}>
                {taskMsgs.length === 0 ? (
                  <div style={{ color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '24px 8px', textAlign: 'center' }}>No tasks yet.</div>
                ) : taskMsgs.map((msg, mIdx) => (
                  <div key={msg.id + '-' + mIdx} style={{ marginBottom: '12px' }}>
                    <MessageBubble message={msg} onCopy={() => {}} searchQuery={''} msgIndex={mIdx} activeMatchMsgIdx={-1} activeMatchOccurrence={-1} isDateMatch={false} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
              <div ref={scrollRef} className="q-scroll" style={{ height: '100%', overflowY: 'auto', padding: '4px 16px 0 16px', scrollbarGutter: 'stable' }}
                onScroll={e => { const el = e.currentTarget; setShowScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 100); pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 120 }}>
                {props.messages.map((msg, mIdx) => (
                  <div key={msg.id} data-msg-idx={mIdx} style={{ marginBottom: '12px' }}>
                    <MessageBubble message={msg} onCopy={() => {}} searchQuery={searchQuery} msgIndex={mIdx} activeMatchMsgIdx={activeMatchInfo?.msgIdx ?? -1} activeMatchOccurrence={activeMatchInfo?.occurrence ?? -1} isDateMatch={!searchQuery.trim() && hasDateFilter && dateMatchIndices.includes(mIdx) && mIdx === dateMatchIndices[Math.min(dateMatchIdx, dateMatchIndices.length - 1)]} />
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
          )}

          {/* A2.8: Task strip sopra il composer (visibile solo se la sessione ha task) */}
          {(taskExecs.length > 0 || taskScheds.length > 0) && (() => {
            const runningCount = taskExecs.filter((e: any) => e.status === 'running' || e.status === 'queued').length
            const doneCount = taskExecs.filter((e: any) => e.status === 'completed').length
            const failCount = taskExecs.filter((e: any) => e.status === 'failed').length
            const running = taskExecs.find((e: any) => e.status === 'running' || e.status === 'queued')
            const label = running ? '"' + (running.label || 'task') + '" in corso' : (taskExecs.length + taskScheds.length) + ' tasks · ' + doneCount + ' done' + (failCount ? ' · ' + failCount + ' failed' : '')
            return (
              <div key="tstrip" style={{ paddingTop: '8px', flexShrink: 0 }}>
                <button onClick={toggleTaskPanel} title={taskPanelOpen ? 'Collapse tasks' : 'Show tasks'} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-panel)', cursor: 'pointer', color: 'var(--q-text-secondary)', fontFamily: 'var(--font-interface)', fontSize: 13, transition: 'none' }}>
                  <Checklist size={16} style={{ color: runningCount ? 'var(--q-accent-info)' : 'var(--q-text-secondary)', flexShrink: 0 }} />
                  <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                  {taskPanelOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
              </div>
            )
          })()}

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
              sessionKey={props.session?.id || ''}
              onHeightChange={setComposerH}
              onHeightChangeNow={() => { if (scrollRef.current && pinnedRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }}
            />
          </div>
        </>
      )}
    </div>
  )
}