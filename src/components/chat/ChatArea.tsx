// ============================================================
// ChatArea — structure fix: overflow hidden on messages, button outside
// ============================================================

import { useRef, useEffect, useState } from 'react'
import { messageMatchesFilters } from '../../utils/dateParser'
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
  onExport: (format?: string) => void
  onReset?: () => void
  onReload?: () => void
  onCompact?: () => void
}

export function ChatArea(props: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchDate, setSearchDate] = useState('')
  const [searchTime, setSearchTime] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)

  // Date/time filter: just find the FIRST matching message (for yellow border + scroll)
  const hasDateFilter = !!(searchDate.trim() || searchTime.trim())
  const dateFirstMatch = (() => {
    if (!hasDateFilter) return -1
    // Search from NEWEST to OLDEST (most recent match first)
    for (let i = props.messages.length - 1; i >= 0; i--) {
      const m = props.messages[i]
      if (m.role !== 'user' && m.role !== 'assistant') continue
      const ts = new Date(m.timestamp).getTime()
      if (messageMatchesFilters(ts, searchDate, searchTime)) return i
    }
    return -1
  })()

  // Text matches: only when there's a text query (filtered by date/time if set)
  const matches = (() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.trim().toLowerCase()
    const out: { msgIdx: number, charIdx: number }[] = []
    props.messages.forEach((m, i) => {
      if (m.role !== 'user' && m.role !== 'assistant') return
      if (hasDateFilter) {
        const ts = new Date(m.timestamp).getTime()
        if (!messageMatchesFilters(ts, searchDate, searchTime)) return
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

  // Auto-scroll to active match when search changes
  // BUT skip when clearing search (prevSearchRef check)
  const prevSearchRef = useRef({ q: '', d: '', t: '' })
  useEffect(() => {
    const prev = prevSearchRef.current
    const isClearing = (prev.q && !searchQuery) || (prev.d && !searchDate) || (prev.t && !searchTime)
    prevSearchRef.current = { q: searchQuery, d: searchDate, t: searchTime }
    if (isClearing) return // Don't scroll when clearing

    // Text search: scroll to text match
    if (matches.length > 0 && activeMatchIdx >= 0) {
      const match = matches[activeMatchIdx]
      const msgEl = scrollRef.current?.querySelector(`[data-msg-idx="${match.msgIdx}"]`)
      if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    // Date-only: scroll to first matching message
    if (!searchQuery.trim() && hasDateFilter && dateFirstMatch >= 0) {
      const msgEl = scrollRef.current?.querySelector(`[data-msg-idx="${dateFirstMatch}"]`)
      if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [searchQuery, searchDate, searchTime, activeMatchIdx, dateFirstMatch])

  const isEmpty = props.messages.length === 0 || props.welcomeMode

  // Auto-scroll on session change or new messages (NOT on search change)
  const sessionId = props.session?.id || ''
  const msgCount = props.messages.length
  const msgCount = props.messages.length
  useEffect(() => {
    // Skip auto-scroll when search is active
    if (searchQuery || searchDate || searchTime) return
    if (scrollRef.current && !isEmpty) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      const raf1 = requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })
      const t1 = setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, 100)
      const t2 = setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, 300)
      const t3 = setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, 500)
      return () => { cancelAnimationFrame(raf1); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
    }
  }, [sessionId, msgCount, isEmpty, props.streaming, searchQuery, searchDate, searchTime])

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
          onReload={props.onReload}
          searchQuery={searchQuery}
          onSearchQueryChange={(q) => { setSearchQuery(q); setCurrentMatch(-1) }}
          searchDate={searchDate}
          onSearchDateChange={(d) => { setSearchDate(d); setCurrentMatch(-1) }}
          searchTime={searchTime}
          onSearchTimeChange={(t) => { setSearchTime(t); setCurrentMatch(-1) }}
          matchCount={matches.length}
          currentMatch={currentMatch < 0 ? Math.max(0, matches.length - 1) : currentMatch}
          onMatchNavigate={(dir) => {
            if (isTextSearch) {
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
          {/* Messages */}
          {/* minHeight:0 = flex shrink corretto (composer non spinto fuori); overflow visible = shadow auto-scroll non clippata */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'visible', position: 'relative' }}>
            <div ref={scrollRef} style={{ height: '100%', overflowY: 'auto', padding: '4px 16px 0 16px', scrollbarGutter: 'stable' }}
              onScroll={e => { const el = e.currentTarget; setShowScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 100) }}>
              {props.messages.map((msg, mIdx) => (
                <div key={msg.id} data-msg-idx={mIdx} style={{ marginBottom: '12px' }}>
                  <MessageBubble message={msg} onCopy={() => {}} searchQuery={searchQuery} msgIndex={mIdx} activeMatchMsgIdx={activeMatchInfo?.msgIdx ?? -1} activeMatchOccurrence={activeMatchInfo?.occurrence ?? -1} isDateMatch={!searchQuery.trim() && hasDateFilter && mIdx === dateFirstMatch} />
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