// ============================================================
// ChatArea — structure fix: overflow hidden on messages, button outside
// ============================================================

import { useRef, useEffect, useState, useLayoutEffect, useCallback } from 'react'

import { messageMatchesFilters } from '../../utils/dateParser'
import { getContrastColor } from '../../utils/contrast'
import { MessageBubble } from './MessageBubble'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { ArrowDown, Checklist, ChevronDown, ChevronRight, ChevronUp, Copy, Paperclip, X } from '../icons'
import { useSidecarContext } from '../shared/AppShell'
import type { Message, Session, Agent, Provider, ChatMode, ThinkingLevel } from '../../types'

function TaskResultToggle({ run, sessionKey, defaultOpen, showClip }: { run: any; sessionKey?: string; defaultOpen?: boolean; showClip?: boolean }) {
  const [collapsed, setCollapsed] = useState(!defaultOpen)
  const [hovered, setHovered] = useState(false)
  const [copyHovered, setCopyHovered] = useState(false)
  const [clipHovered, setClipHovered] = useState(false)
  const st = run.status
  const isRunning = st === 'running' || st === 'queued'
  const color = isRunning ? 'var(--q-accent-info)' : 'var(--q-accent-calendar)'
  const hoverBg = isRunning ? 'rgba(122, 162, 247, 0.06)' : 'rgba(127, 209, 192, 0.06)'
  const label = isRunning ? 'Task running' : 'Task result'
  return (
    <div style={{ marginTop: '12px', padding: '4px' }}>
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: 'pointer', backgroundColor: hovered ? hoverBg : 'transparent', borderRadius: 'var(--radius-md)', padding: '8px', transform: hovered ? 'translateX(2px)' : 'translateX(0)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ChevronRight size={14} style={{ color, flexShrink: 0, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'none' }} />
          <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-interface)', fontSize: '13px', fontWeight: 600, color: 'var(--q-text)' }}>{run.label}</span>
          <span style={{ flex: 1 }} />
          {showClip && (
          <button onClick={(e) => { e.stopPropagation(); try { let respText = ''; for (const m of run.messages || []) { if (m.role === 'assistant' && m.content) respText += (m.content || '') + '\n\n' } const text = respText.trim() || run.label; window.dispatchEvent(new CustomEvent('quinki-task-clip', { detail: { id: run.id, label: run.label, text } })) } catch {} }}
            onMouseEnter={() => setClipHovered(true)} onMouseLeave={() => setClipHovered(false)}
            title="Clip to chat"
            style={{ opacity: hovered ? 1 : 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: 'var(--radius-sm)', color: clipHovered ? color : 'var(--q-text-tertiary)' }}>
            <Paperclip size={14} />
          </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); try { let fullText = ''; for (const m of run.messages || []) { fullText += (m.role === 'user' ? 'User: ' : 'Agent: ') + (m.content || '') + '\n' } navigator.clipboard.writeText(fullText) } catch {} }}
            onMouseEnter={() => setCopyHovered(true)} onMouseLeave={() => setCopyHovered(false)}
            style={{ opacity: hovered ? 1 : 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: 'var(--radius-sm)', color: copyHovered ? color : 'var(--q-text-tertiary)' }}>
            <Copy size={14} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div style={{ marginTop: '4px', padding: '8px 8px 8px 16px', borderLeft: `2px solid ${color}`, userSelect: 'text', WebkitUserSelect: 'text' }}>
          {run.messages.length === 0 && run.error ? (
            <div style={{ color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '4px 0' }}>{String(run.error)}</div>
          ) : null}
          {run.messages.map((msg: any, mIdx: number) => (
            <div key={msg.id + '-' + mIdx} style={{ marginBottom: '12px' }}>
              <MessageBubble message={msg} onCopy={() => {}} searchQuery={''} msgIndex={mIdx} activeMatchMsgIdx={-1} activeMatchOccurrence={-1} isDateMatch={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface ChatAreaProps {
  session?: Session
  messages: Message[]
  streaming: boolean
  isCompacting?: boolean
  welcomeMode: boolean
  mode: ChatMode
  activePanel: string
  onSelectPanel: (panel: string) => void
  homeIcon?: 'home' | 'agent-task'
  onHomeClick?: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  hideSidebarToggle?: boolean
  isExpertApp?: boolean
  showRollback?: boolean
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
  onSteer?: (text: string) => void
  longHorizon?: boolean
  onLongHorizon?: (activate: boolean) => void
  onRequestPlan?: (text: string) => void
  longHorizonStatus?: string
  longHorizonPhase?: string
  longHorizonSystemMessage?: string
  longHorizonStartedAt?: number
  onProceedToPlanning?: () => void
  onStartExecution?: () => void
  onNewDiscussion?: () => void
  onPauseLongHorizon?: () => void
  onResumeLongHorizon?: () => void
  onRenameSession: (label: string) => void
  onExport: (format?: string) => void
  onReset?: () => void
  onReload?: () => void
  onCompact?: () => void
  compactionAuto?: boolean
  onCompactionChange?: (auto: boolean) => void
  notifyMode?: string
  onSetNotifyMode?: (mode: string) => void
}

export function ChatArea(props: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const taskScrollRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [showTaskScrollBtn, setShowTaskScrollBtn] = useState(false)
  const taskPinnedRef = useRef(true)
  const [lhApprovalDismissed, setLhApprovalDismissed] = useState(false)
  // Pinned-to-bottom: true finché l'utente è in fondo. Se l'utente sale durante lo
  // streaming, il pin si scioglie e lo scroll automatico si ferma; rientrando in fondo
  // il pin si rinsalda e lo scroll automatico riprende.
  const pinnedRef = useRef(true)
  const [composerH, setComposerH] = useState(0)
  // === A2.8: Task Timeline ===
  const { call: sidecarCall } = useSidecarContext()
  const sessionIdKey = props.session?.id || ''
  // === A3: marker unread + segnalibro ===
  const [lastReadTs, setLastReadTs] = useState(0)
  const [lastReadTaskTs, setLastReadTaskTs] = useState(0)
  const [bookmarkTs, setBookmarkTs] = useState<number | null>(null)
  const [markerVisible, setMarkerVisible] = useState(false)
  const [readStateLoaded, setReadStateLoaded] = useState(false)
  const markerScrolledRef = useRef(false)
  const autoScrollDoneRef = useRef(false)
  const openTsRef = useRef(0)
  const markReadTimerRef = useRef<any>(null)
  const messagesRef = useRef(props.messages)
  useEffect(() => { messagesRef.current = props.messages }, [props.messages])
  const chatItemsRef = useRef<any[]>([])
  useEffect(() => {
    if (!sessionIdKey) return
    markerScrolledRef.current = false
    autoScrollDoneRef.current = false
    setMarkerVisible(false)
    setReadStateLoaded(false)
    let cancelled = false
    // openTs = momento dell'apertura: il marker mostra SOLO ciò che era unread PRIMA
    // dell'apertura (ts <= openTs), non ciò che arriva live mentre sei dentro.
    openTsRef.current = Date.now()
    sidecarCall('getReadState', { sessionKey: sessionIdKey }).then((r: any) => {
      if (!cancelled && r?.state) {
        // baseline = il lastReadTs PRIMA del mark-read → il marker resta visibile finché esci
        setLastReadTs(r.state.lastReadTs || 0)
        setLastReadTaskTs(r.state.lastReadTaskTs || 0)
        if (r.state.bookmarkTs) setBookmarkTs(r.state.bookmarkTs)
      }
      if (!cancelled) setReadStateLoaded(true)
      // Mark-read on open (DOPO aver catturato la baseline): persiste SEMPRE → dopo
      // reinstall/uccisione l'app, le chat già viste NON mostrano badge/marker.
      if (!cancelled && sessionIdKey !== '__app_expert__') {
        try { sidecarCall('setReadState', { sessionKey: sessionIdKey, patch: { lastReadTs: Date.now() } }) } catch {}
      }
    }).catch(() => {
      if (!cancelled) { setReadStateLoaded(true); if (sessionIdKey !== '__app_expert__') { try { sidecarCall('setReadState', { sessionKey: sessionIdKey, patch: { lastReadTs: Date.now() } }) } catch {} } }
    })
    return () => { cancelled = true }
  }, [sessionIdKey, sidecarCall])

  // Mark-read alla FINE dello streaming: la risposta è arrivata mentre la chat era aperta
  // → l'utente l'ha vista in tempo reale → NON deve diventare unread (niente badge né marker).
  const prevStreamingRef = useRef(false)
  const streamingSessionRef = useRef<string | null>(null)
  useEffect(() => {
    if (props.streaming && sessionIdKey) streamingSessionRef.current = sessionIdKey
    const wasStreaming = prevStreamingRef.current
    prevStreamingRef.current = props.streaming
    if (wasStreaming && !props.streaming && streamingSessionRef.current && streamingSessionRef.current !== '__app_expert__') {
      const sk = streamingSessionRef.current
      streamingSessionRef.current = null
      // Marca SOLO se l'utente è ANCORA nella chat (ha visto la risposta in tempo reale).
      // Se è uscito prima che finisse → la parte non vista resta UNREAD (badge + marker).
      if (sk === sessionIdKey) {
        try { sidecarCall('setReadState', { sessionKey: sk, patch: { lastReadTs: Date.now() } }) } catch {}
      }
    }
  }, [props.streaming, sessionIdKey, sidecarCall])

  // Mark-on-exit: quando ESCi dalla chat, segna tutto come letto → al prossimo ingresso
  // niente badge né marker (il marker resta visibile finché la chat è aperta).
  useEffect(() => {
    const key = sessionIdKey
    return () => {
      if (key && key !== '__app_expert__') {
        try { sidecarCall('setReadState', { sessionKey: key, patch: { lastReadTs: Date.now() } }) } catch {}
      }
    }
  }, [sessionIdKey, sidecarCall])

  // Mark-read PERIODICO mentre la chat è aperta (5s): lo stato persistito resta sempre
  // recente → se l'app viene uccisa/reinstallata, le chat già viste NON mostrano badge.
  useEffect(() => {
    if (!sessionIdKey || sessionIdKey === '__app_expert__') return
    const iv = setInterval(() => {
      try { sidecarCall('setReadState', { sessionKey: sessionIdKey, patch: { lastReadTs: Date.now() } }) } catch {}
    }, 5000)
    return () => clearInterval(iv)
  }, [sessionIdKey, sidecarCall])

  const [taskPanelOpen, setTaskPanelOpen] = useState<boolean>(() => { try { return localStorage.getItem('quinki-taskpanel-' + sessionIdKey) === '1' } catch { return false } })
  const [taskExecs, setTaskExecs] = useState<any[]>([])
  const [taskScheds, setTaskScheds] = useState<any[]>([])
  const [taskRuns, setTaskRuns] = useState<any[]>([])

  // Auto-scroll al marker all'apertura (UNA volta per sessione) + mostra il marker.
  // Il marker include messaggi E task (endedAt > lastReadTs).
  const isUnreadItem = (it: any): boolean => {
    return ((it.kind === 'msg' && it.msg?.role === 'assistant') || it.kind === 'task') && it.ts > lastReadTs && it.ts <= openTsRef.current
  }
  const hasAnyUnread = (): boolean => {
    for (const it of chatItemsRef.current) {
      if (isUnreadItem(it)) return true
    }
    return false
  }
  useEffect(() => {
    if (!sessionIdKey || !readStateLoaded || markerScrolledRef.current) return
    const el = scrollRef.current
    if (!el) return
    const items = chatItemsRef.current
    if (items.length === 0) return
    const firstUnreadIdx = items.findIndex(it => isUnreadItem(it))
    if (firstUnreadIdx >= 0) {
      const target = el.querySelector(`[data-item-idx="${firstUnreadIdx}"]`)
      if (target) {
        (target as HTMLElement).scrollIntoView({ block: 'start' })
        markerScrolledRef.current = true
      }
    }
    setMarkerVisible(hasAnyUnread())
  }, [sessionIdKey, lastReadTs, props.messages, readStateLoaded, taskRuns])

  const chatScrollPos = useRef(0)
  const toggleTaskPanel = () => {
    const el = scrollRef.current
    if (el && !taskPanelOpen) chatScrollPos.current = el.scrollTop
    const nv = !taskPanelOpen
    setTaskPanelOpen(nv)
    try { localStorage.setItem('quinki-taskpanel-' + sessionIdKey, nv ? '1' : '0') } catch {}

  }
  useEffect(() => {
    if (!taskPanelOpen) {
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = chatScrollPos.current })
    }
  }, [taskPanelOpen])
  const refreshTasks = useCallback(async () => {
    console.log('[A3] refreshTasks sessionIdKey:', sessionIdKey)
    if (!sessionIdKey || sessionIdKey === '__app_expert__') {
      setTaskExecs([]); setTaskScheds([]); setTaskRuns([])
      // Resetta le firme: al ritorno in una chat il confronto rileva il cambiamento e aggiorna
      taskExecsSig.current = ''; taskSchedsSig.current = ''; taskRunsSig.current = ''
      return
    }
    try {
      const [exR, schR] = await Promise.all([sidecarCall('listExecutions'), sidecarCall('listSchedules')])
      // Se una RPC fallisce, NON aggiornare (mantieni lo stato attuale — le task non spariscono)
      if (!exR || !schR) return
      const execs = (exR.executions || []).filter((e: any) => e.sourceSession?.key === sessionIdKey)
      const scheds = (schR.schedules || []).filter((s: any) => s.sourceSession?.key === sessionIdKey)
      console.log('[A3] refreshTasks', sessionIdKey.slice(0, 18), '→ execs:', execs.length, 'scheds:', scheds.length)
      const es = execs.map((e: any) => e.id + ':' + e.status + ':' + (e.label || '')).join('|')
      if (es !== taskExecsSig.current) { taskExecsSig.current = es; setTaskExecs(execs) }
      const ss = scheds.map((s: any) => s.id + ':' + (s.enabled ? '1' : '0')).join('|')
      if (ss !== taskSchedsSig.current) { taskSchedsSig.current = ss; setTaskScheds(scheds) }
      const runs: any[] = []
      for (const e of execs) {
        // Anche se getExecutionMessages fallisce, il run viene pushato (messaggi vuoti) → le task non spariscono
        let msgs: any[] = []
        try { const mR = await sidecarCall('getExecutionMessages', { executionId: e.id }); msgs = (mR?.messages || []) } catch {}
        runs.push({ id: e.id, label: e.label || 'Task', status: e.status || '?', error: e.error || null, endedAt: e.endedAt || null, createdAt: e.createdAt || null, messages: msgs.sort((a: any, b: any) => String(a.timestamp || '').localeCompare(String(b.timestamp || ''))) })
      }
      runs.sort((a, b) => String(a.messages[0]?.timestamp || '').localeCompare(String(b.messages[0]?.timestamp || '')))
      const rs = runs.map((r: any) => r.id + ':' + r.status + ':' + (r.messages || []).length).join('|')
      if (rs !== taskRunsSig.current) { taskRunsSig.current = rs; setTaskRuns(runs) }
    } catch {}
  }, [sessionIdKey, sidecarCall])
  useEffect(() => { refreshTasks(); const iv = setInterval(refreshTasks, 3000); return () => clearInterval(iv) }, [refreshTasks])
  const taskPrevOpen = useRef(false)
  const taskExecsSig = useRef('')
  const taskSchedsSig = useRef('')
  const taskRunsSig = useRef('')
  useEffect(() => {
    const opening = taskPanelOpen && !taskPrevOpen.current
    taskPrevOpen.current = taskPanelOpen
    if (!taskPanelOpen) return
    if (opening || taskPinnedRef.current) {
      requestAnimationFrame(() => { if (taskScrollRef.current) taskScrollRef.current.scrollTop = taskScrollRef.current.scrollHeight })
      setTimeout(() => { if (taskScrollRef.current) taskScrollRef.current.scrollTop = taskScrollRef.current.scrollHeight }, 120)
      setTimeout(() => { if (taskScrollRef.current) taskScrollRef.current.scrollTop = taskScrollRef.current.scrollHeight }, 400)
      if (opening) taskPinnedRef.current = true
    }
  }, [taskPanelOpen, taskRuns])
  const taskRunning = taskExecs.filter((e: any) => e.status === 'running' || e.status === 'queued').length
  const taskDone = taskExecs.filter((e: any) => e.status === 'executed').length
  const taskRunningItem = taskExecs.find((e: any) => e.status === 'running' || e.status === 'queued')
  const pl = (n: number) => (n === 1 ? '' : 's')
  const taskLabel = taskScheds.length + ' task' + pl(taskScheds.length) + ' scheduled' + (taskDone ? ' · ' + taskDone + ' executed' : '')
  const hasTasks = taskExecs.length > 0 || taskScheds.length > 0
  const taskStripBar = hasTasks ? (
    <button onClick={toggleTaskPanel} title={taskPanelOpen ? 'Collapse tasks' : 'Show tasks'} style={{ width: '100%', marginTop: 8, padding: '8px 14px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, border: taskPanelOpen ? 'none' : '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', backgroundColor: taskPanelOpen ? 'transparent' : 'var(--q-bg-panel)', color: 'var(--q-text-secondary)', fontFamily: 'var(--font-interface)', fontSize: 13, transition: 'none', textAlign: 'left' }}>
      <Checklist size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--q-text-secondary)' }}>{taskLabel}</span>
      {taskPanelOpen ? <ChevronDown size={16} style={{ flexShrink: 0 }} /> : <ChevronUp size={16} style={{ flexShrink: 0 }} />}
    </button>
  ) : null
  const taskPanelEl = (
    <div style={{ position: 'absolute', inset: '2px 2px 0 2px', zIndex: 20, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', animation: 'taskPanelExpand 180ms ease-out', transformOrigin: 'bottom', overflow: 'hidden' }}>
      <div ref={scrollRef} className="q-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', scrollbarGutter: 'stable' }}>
        {taskRuns.length === 0 ? (
          <div style={{ color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '24px 8px', textAlign: 'center' }}>No tasks yet.</div>
        ) : taskRuns.map((run) => (
          <TaskResultToggle key={run.id} run={run} sessionKey={props.session?.key} showClip />
        ))}
      </div>
      {/* Barra riassunto IN BASSO = la striscia che diventa la heading inferiore della sezione espansa — tutta cliccabile per chiudere */}
      <button onClick={toggleTaskPanel} title="Collapse tasks" style={{ width: '100%', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-bg-panel)', color: 'var(--q-text-secondary)', fontFamily: 'var(--font-interface)', fontSize: 13, transition: 'none', textAlign: 'left' }}>
        <Checklist size={16} style={{ color: taskRunning ? 'var(--q-accent-info)' : 'var(--q-text-secondary)', flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--q-text)' }}>{taskLabel}</span>
        <ChevronDown size={16} style={{ flexShrink: 0 }} />
      </button>
    </div>
  )
  const taskStrip = (taskExecs.length > 0 || taskScheds.length > 0) ? (
    <div key="tstrip" style={{ paddingTop: taskPanelOpen ? '0px' : '8px', flexShrink: 0 }}>
      <button onClick={toggleTaskPanel} title={taskPanelOpen ? 'Collapse tasks' : 'Show tasks'} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-panel)', cursor: 'pointer', color: 'var(--q-text-secondary)', fontFamily: 'var(--font-interface)', fontSize: 13, transition: 'none' }}>
        <Checklist size={16} style={{ color: taskRunning ? 'var(--q-accent-info)' : 'var(--q-text-secondary)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{taskLabel}</span>
        {taskPanelOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
    </div>
  ) : null
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
    // Skip auto-scroll when search is active, or quando la sezione task è aperta (lì scrolla il task view, non la chat)
    if (searchQuery || searchDate || searchTime) return
    if (taskPanelOpen) return
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
  }, [sessionId, msgCount, isEmpty, props.streaming, searchQuery, searchDate, searchTime, props.messages, composerH, hasTasks, taskRuns])

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
          longHorizon={props.longHorizon}
          session={props.session}
          activePanel={props.activePanel}
          onSelectPanel={props.onSelectPanel}
          homeIcon={props.homeIcon}
          onHomeClick={props.onHomeClick}
          sidebarOpen={props.sidebarOpen}
          onToggleSidebar={props.onToggleSidebar}
          hideSidebarToggle={props.hideSidebarToggle}
          isExpertApp={props.isExpertApp}
          showRollback={props.showRollback}
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
          compactionAuto={props.compactionAuto}
          onCompactionChange={props.onCompactionChange}
          onReload={props.onReload}
          notifyMode={props.notifyMode}
          onSetNotifyMode={props.onSetNotifyMode}
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
        taskPanelOpen ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', margin: '2px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', animation: 'taskPanelExpand 180ms ease-out', transformOrigin: 'bottom' }}>
            <div ref={scrollRef} className="q-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', scrollbarGutter: 'stable' }}>
              {taskRuns.length === 0 ? (
                <div style={{ color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '24px 8px', textAlign: 'center' }}>No tasks yet.</div>
              ) : taskRuns.map((run) => (
                <TaskResultToggle key={run.id} run={run} sessionKey={props.session?.key} showClip />
              ))}
            </div>
            {taskStripBar}
          </div>
        ) : (
        <>
          <div className="flex-1 flex items-center justify-center">
            <Composer
              providers={props.providers} selectedModel={props.selectedModel} mode={props.mode}
              thinking={props.thinking} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
              isStreaming={props.streaming} isCompacting={props.isCompacting} statusLabel={props.statusLabel} statusKind={props.statusKind}
              onSend={props.onSend} onStop={props.onStop} onSteer={props.onSteer}
              onModelChange={props.onModelSelect} onModeChange={props.onModeChange}
              onThinkingChange={t => props.onThinkingChange(t)} welcomeMode={true}
              longHorizon={props.longHorizon} longHorizonStatus={props.longHorizonStatus} longHorizonPhase={props.longHorizonPhase}
              longHorizonPlanProposed={(() => { const la = [...(props.messages || [])].reverse().find((m: any) => m.role === 'assistant' && m.content); return !!la && String(typeof la.content === 'string' ? la.content : '').includes('- [') })()}
              onLongHorizon={props.onLongHorizon} onRequestPlan={props.onRequestPlan}
              onApprovePlan={props.onApprovePlan} onContinueDiscussing={() => setLhApprovalDismissed(true)}
              onPauseLongHorizon={props.onPauseLongHorizon} onResumeLongHorizon={props.onResumeLongHorizon}
              agents={props.agents}
              chatAgentIds={props.selectedAgentIds}
              onReset={props.onReset}
              onAgentToggle={props.onAgentToggle}
            />
          </div>
          {taskStripBar}
        </>
        )
      ) : (
        <>
          {/* Messages — area unica: scroll (chat o task) + barra riassunto in fondo (la striscia, sempre stessa posizione) */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', ...(taskPanelOpen ? { margin: '2px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', animation: 'taskPanelExpand 180ms ease-out', transformOrigin: 'bottom' } : {}) }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              {/* Chat — SEMPRE montata (display none quando il pannello task è aperto) → lo scroll resta dov'era */}
              <div ref={scrollRef} className="q-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 16px ' + (hasTasks ? 8 : 0) + 'px 16px', scrollbarGutter: 'stable', display: taskPanelOpen ? 'none' : 'block' }}
                onScroll={e => { const el = e.currentTarget; setShowScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 100); pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 120; }}>
                {(() => {
                  const chatItems: { kind: 'msg' | 'task' | 'sys'; ts: number; msg?: any; run?: any; sysMsg?: string; mIdx?: number }[] = []
                  props.messages.forEach((msg, mIdx) => {
                    let ts = 0
                    try { ts = new Date(msg.timestamp).getTime() } catch {}
                    chatItems.push({ kind: 'msg', ts, msg, mIdx })
                  })
                  for (const run of taskRuns) {
                    if (run.status !== 'executed') continue
                    chatItems.push({ kind: 'task', ts: run.endedAt || run.createdAt || 0, run })
                  }
                  if (props.longHorizonSystemMessage && props.longHorizonStartedAt) {
                    chatItems.push({ kind: 'sys', ts: props.longHorizonStartedAt, sysMsg: props.longHorizonSystemMessage })
                  }
                  chatItems.sort((a, b) => a.ts - b.ts || (a.kind === 'msg' ? 0 : 1))
                  chatItemsRef.current = chatItems
                  return (
                    <>
                    {chatItems.map((item, i) => {
                      const isUnread = ((item.kind === 'msg' && item.msg?.role === 'assistant') || item.kind === 'task') && item.ts > lastReadTs && item.ts <= openTsRef.current && markerVisible && !props.streaming
                      const isFirstUnread = isUnread && (i === 0 || !(((chatItems[i-1].kind === 'msg' && chatItems[i-1].msg?.role === 'assistant') || chatItems[i-1].kind === 'task') && chatItems[i-1].ts > lastReadTs && chatItems[i-1].ts <= openTsRef.current && markerVisible && !props.streaming))
                      const isBookmark = bookmarkTs != null && item.ts >= bookmarkTs && (i === 0 || chatItems[i-1].ts < bookmarkTs)
                      return (
                    <div key={item.kind === 'msg' ? item.msg!.id : item.kind === 'sys' ? 'lh-sys' : 'chat-' + item.run!.id} data-msg-idx={item.mIdx ?? -1} data-item-idx={i} style={{ marginBottom: '12px' }}>
                      {isBookmark && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', padding: '2px 0' }}>
                          <span style={{ flex: 1, height: '1px', backgroundColor: 'var(--q-accent-warning)' }} />
                          <span style={{ fontSize: '11px', fontFamily: 'var(--font-interface)', color: 'var(--q-accent-warning)', fontWeight: 600, whiteSpace: 'nowrap' }}>📌 bookmark</span>
                          <span style={{ flex: 1, height: '1px', backgroundColor: 'var(--q-accent-warning)' }} />
                        </div>
                      )}
                      {isFirstUnread && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', padding: '2px 0' }}>
                          <span style={{ flex: 1, height: '1px', backgroundColor: 'var(--q-tab-accent)' }} />
                          <span style={{ fontSize: '11px', fontFamily: 'var(--font-interface)', color: 'var(--q-tab-accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>unread messages below</span>
                          <span style={{ flex: 1, height: '1px', backgroundColor: 'var(--q-tab-accent)' }} />
                        </div>
                      )}
                      {item.kind === 'msg' ? (
                        <MessageBubble message={item.msg} onCopy={() => {}} searchQuery={searchQuery} msgIndex={item.mIdx ?? 0} activeMatchMsgIdx={activeMatchInfo?.msgIdx ?? -1} activeMatchOccurrence={activeMatchInfo?.occurrence ?? -1} isDateMatch={!searchQuery.trim() && hasDateFilter && dateMatchIndices.includes(item.mIdx ?? -1) && (item.mIdx ?? -1) === dateMatchIndices[Math.min(dateMatchIdx, dateMatchIndices.length - 1)]} />
                      ) : item.kind === 'sys' ? (
                        <div style={{ maxWidth: 'var(--spacing-chat-max)', minWidth: 0 }}>
                          <div style={{ backgroundColor: 'var(--q-bg)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '12px 16px' }}>
                            <div style={{ color: 'var(--q-text)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-interface)', marginBottom: 8 }}>Long Horizon Mode</div>
                            <div style={{ color: 'var(--q-text)', fontSize: 13, lineHeight: 1.6, fontFamily: 'var(--font-interface)', whiteSpace: 'pre-wrap' }}>{item.sysMsg}</div>
                          </div>
                        </div>
                      ) : (
                        <TaskResultToggle run={item.run} sessionKey={props.session?.key} defaultOpen />
                      )}
                    </div>
                    )})}
                    </>
                  )
                })()}
                {props.longHorizon && (() => {
                  const ph = props.longHorizonPhase || 'discussion'
                  let title = '', desc = '', btnLabel = '', onBtn: (() => void) | null = null
                  if (ph === 'discussion') { title = 'Discussion phase'; desc = 'Discuss the problem with the agent. Nothing will be executed yet.'; btnLabel = 'Proceed to planning'; onBtn = props.onProceedToPlanning }
                  else if (ph === 'planning') { title = 'Planning phase'; desc = 'Refine the plan with the agent. Nothing will be executed yet.'; btnLabel = 'Start'; onBtn = props.onStartExecution }
                  else if (ph === 'running') { title = 'Long Horizon running'; desc = 'The agent is working through the plan autonomously.'; btnLabel = 'Pause'; onBtn = props.onPauseLongHorizon }
                  else if (ph === 'paused') { title = 'Long Horizon paused'; desc = 'You are back in the discussion phase. Discuss changes, then resume.'; btnLabel = 'Resume'; onBtn = props.onResumeLongHorizon }
                  else if (ph === 'done') { title = 'Long Horizon complete'; desc = 'The plan is complete. You can start a new discussion or disable Long Horizon.'; btnLabel = 'New discussion'; onBtn = props.onNewDiscussion }
                  return (
                    <div style={{ maxWidth: 'var(--spacing-chat-max)', minWidth: 0, margin: '8px 0' }}>
                      <div style={{ backgroundColor: 'var(--q-bg)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'var(--q-text)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-interface)' }}>{title}</div>
                            <div style={{ color: 'var(--q-text)', fontSize: 12, lineHeight: 1.4, fontFamily: 'var(--font-interface)', marginTop: 2 }}>{desc}</div>
                          </div>
                          {onBtn && (
                            <button onClick={onBtn} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}
                              style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)', flexShrink: 0 }}>{btnLabel}</button>
                          )}
                          {ph === 'done' && (
                            <button onClick={() => props.onLongHorizon?.(false)} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                              style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', flexShrink: 0 }}>Disable</button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
              {/* Task — SEMPRE montato (display none quando il pannello è chiuso) */}
              <div ref={taskScrollRef} className="q-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', scrollbarGutter: 'stable', display: taskPanelOpen ? 'block' : 'none' }}
                onScroll={e => { const el = e.currentTarget; setShowTaskScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 100); taskPinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 120 }}>
                {taskRuns.length === 0 ? (
                  <div style={{ color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '24px 8px', textAlign: 'center' }}>No tasks yet.</div>
                ) : taskRuns.map((run) => (
                  <TaskResultToggle key={run.id} run={run} sessionKey={props.session?.key} showClip />
                ))}
              </div>
            </div>
            {(taskPanelOpen ? showTaskScrollBtn : showScrollBtn) && (
              <button onClick={() => { const el = taskPanelOpen ? taskScrollRef.current : scrollRef.current; if (el) el.scrollTop = el.scrollHeight }}
                style={{ position: 'absolute', bottom: (hasTasks ? 44 : 0) + 'px', right: '0px', zIndex: 10, width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--q-tab-accent)', color: getContrastColor('--q-tab-accent'), border: 'none', boxShadow: 'var(--shadow-floating)', cursor: 'pointer' }}>
                <ArrowDown size={20} />
              </button>
            )}
            {taskStripBar}
          </div>

          {/* Composer — flexShrink 0 so it stays visible */}
          <div style={{ paddingTop: '8px', flexShrink: 0 }}>
            <Composer
              providers={props.providers} selectedModel={props.selectedModel} mode={props.mode}
              thinking={props.thinking} contextTokens={props.contextTokens} contextWindow={props.contextWindow}
              isStreaming={props.streaming} isCompacting={props.isCompacting} statusLabel={props.statusLabel} statusKind={props.statusKind}
              onSend={props.onSend} onStop={props.onStop} onSteer={props.onSteer}
              onModelChange={props.onModelSelect} onModeChange={props.onModeChange}
              onThinkingChange={t => props.onThinkingChange(t)} welcomeMode={false}
              longHorizon={props.longHorizon} longHorizonStatus={props.longHorizonStatus} longHorizonPhase={props.longHorizonPhase}
              longHorizonPlanProposed={(() => { const la = [...(props.messages || [])].reverse().find((m: any) => m.role === 'assistant' && m.content); return !!la && String(typeof la.content === 'string' ? la.content : '').includes('- [') })()}
              onLongHorizon={props.onLongHorizon} onRequestPlan={props.onRequestPlan}
              onApprovePlan={props.onApprovePlan} onContinueDiscussing={() => setLhApprovalDismissed(true)}
              onPauseLongHorizon={props.onPauseLongHorizon} onResumeLongHorizon={props.onResumeLongHorizon}
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