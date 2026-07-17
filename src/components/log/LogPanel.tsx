// ============================================================
// LogPanel — exact Flutter copy
// Header: Home panel + expanded panel (icon, title, count, filter pills, more, spacer, action buttons)
// Log list: bubbles with level-based colors, timestamp, tag, payload, copy on hover
// Search bar: search icon + input + clear + match counter + nav arrows
// ============================================================

import { useState, useRef, useEffect } from 'react'
import { Home, Activity, Search, ChevronDown, ChevronUp, Copy, Check, Download, RefreshCw, Trash } from '../icons'

interface LogEntry {
  ts: number
  tag: string
  data: string | object
}

interface LogPanelProps {
  activePanel: string
  onSelectPanel: (panel: string) => void
}

// ── Level derivation (matches Flutter _deriveLevel) ──
function deriveLevel(tag: string): string {
  if (tag.startsWith('error') || tag.includes('error')) return 'error'
  if (tag.startsWith('warn') || tag.startsWith('warning') || tag === 'retrying') return 'warn'
  if (tag.startsWith('success')) return 'success'
  if (tag.startsWith('ui-') || tag.startsWith('ui:') || tag.includes('ui-click') || tag.includes('ui-nav') || tag.includes('ui-keyboard') || tag.includes('ui-panel')) return 'ui'
  if (tag.startsWith('bridge:') || tag.startsWith('bridge-') || tag.startsWith('full-state-') || tag.startsWith('get_') || tag.startsWith('ws:') || tag.startsWith('send:') || tag.startsWith('stream:') || tag.startsWith('history:') || tag.startsWith('session:')) return 'bridge'
  if (tag.startsWith('renderer:') || tag.startsWith('renderer-')) return 'renderer'
  return 'info'
}

// ── Level colors ──
const levelColors: Record<string, { bg: string; text: string; tag: string; pill: string }> = {
  error:    { bg: '#7a3a3a', text: '#ffffff', tag: '#ffb0b0', pill: 'var(--q-accent-danger)' },
  warn:     { bg: '#7a6a3a', text: '#ffffff', tag: '#ffe0a0', pill: 'var(--q-accent-warning)' },
  ui:       { bg: '#3a5566', text: '#ffffff', tag: '#a0d0e0', pill: 'var(--q-accent-info)' },
  success:  { bg: '#3a6a4a', text: '#ffffff', tag: '#b0e0a0', pill: 'var(--q-accent-success)' },
  bridge:   { bg: '#2a3340', text: '#e6e6e6', tag: '#e6e6e6', pill: 'var(--q-text)' },
  renderer: { bg: '#2a3340', text: '#9c9c9c', tag: '#9c9c9c', pill: 'var(--q-text-secondary)' },
  info:     { bg: '#2a3340', text: '#6e6e6e', tag: '#6e6e6e', pill: 'var(--q-text-tertiary)' },
}

// ── Mock log entries ──
const now = Date.now()
const mockLogs: LogEntry[] = [
  { ts: now - 60000, tag: 'ui-nav-click', data: { panel: 'chat', from: 'home' } },
  { ts: now - 55000, tag: 'session:create', data: 'Created session s0a' },
  { ts: now - 50000, tag: 'bridge:connect', data: 'Connected to sidecar at 127.0.0.1:0' },
  { ts: now - 45000, tag: 'ui-click-send', data: { streaming: false, inputLen: 42, filesCount: 0 } },
  { ts: now - 44000, tag: 'stream:start', data: 'Started streaming response' },
  { ts: now - 43000, tag: 'error:tool-failed', data: 'Tool execution failed: grep argument list too long' },
  { ts: now - 42000, tag: 'warn:retrying', data: 'Retrying request (attempt 1/3)' },
  { ts: now - 41000, tag: 'success:tool-call', data: 'read main.ts completed (2048 bytes)' },
  { ts: now - 40000, tag: 'ui-keyboard', data: { key: 'Enter', shift: false, ctrl: false } },
  { ts: now - 39000, tag: 'bridge:ws-message', data: { type: 'agent_status', status: 'thinking' } },
  { ts: now - 38000, tag: 'renderer:scroll', data: 'Auto-scroll to bottom' },
  { ts: now - 37000, tag: 'stream:chunk', data: 'Received 156 tokens' },
  { ts: now - 36000, tag: 'ui-panel-change', data: { from: 'log', to: 'chat' } },
  { ts: now - 35000, tag: 'error:connection', data: 'Connection refused — Ollama server not running' },
  { ts: now - 34000, tag: 'warn:context-80', data: 'Context window at 80% — auto-compaction triggered' },
  { ts: now - 33000, tag: 'success:compaction', data: 'Compacted 12 messages → 2,400 tokens saved' },
  { ts: now - 32000, tag: 'info:config', data: 'Theme changed to vision-comfort-neutral' },
  { ts: now - 31000, tag: 'bridge:get-models', data: 'Fetched 11 models from 3 providers' },
  { ts: now - 30000, tag: 'renderer:bubble', data: 'Rendered 16 message bubbles' },
  { ts: now - 29000, tag: 'ui-toggle-sidebar', data: { mode: 'pinned', from: 'hidden' } },
  { ts: now - 28000, tag: 'error:rate-limit', data: 'Rate limit exceeded (429) — waiting 30s' },
  { ts: now - 27000, tag: 'success:delegation', data: 'Notion agent created page successfully' },
  { ts: now - 26000, tag: 'bridge:history', data: 'Loaded 16 messages for session s50' },
  { ts: now - 25000, tag: 'info:startup', data: 'Quinki started — version 1.0.0' },
]

// ── Format helpers ──
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function fmtDateShort(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function fmtTimeShort(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function formatPayload(data: string | object): string {
  if (typeof data === 'string') return data
  if (typeof data !== 'object' || data === null) return String(data)
  const keys = Object.keys(data)
  if (keys.length === 0) return '{}'
  if (keys.length === 1) {
    const v = (data as any)[keys[0]]
    if (v == null) return ''
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    return JSON.stringify(v, null, 2)
  }
  const allPrimitive = keys.every(k => {
    const v = (data as any)[k]
    return v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
  })
  if (allPrimitive) return keys.map(k => `${k}: ${(data as any)[k]}`).join(', ')
  return JSON.stringify(data, null, 2)
}

export function LogPanel(props: LogPanelProps) {
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const [textFilter, setTextFilter] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [copiedTs, setCopiedTs] = useState<number | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const entries = mockLogs
  const filtered = entries.filter(e => {
    const lvl = deriveLevel(e.tag)
    if (activeFilters.size > 0 && !activeFilters.has(lvl)) return false
    if (textFilter.trim()) {
      const payload = formatPayload(e.data)
      const fullText = `${fmtDateShort(e.ts)} ${fmtTimeShort(e.ts)} [${e.tag}] ${payload}`.toLowerCase()
      if (!fullText.includes(textFilter.toLowerCase())) return false
    }
    return true
  })

  // Search matches
  const searchMatches: { entryIdx: number; charIndex: number }[] = []
  if (textFilter.trim()) {
    const q = textFilter.toLowerCase()
    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i]
      const payload = formatPayload(e.data)
      const fullText = `${fmtDateShort(e.ts)} ${fmtTimeShort(e.ts)} [${e.tag}] ${payload}`.toLowerCase()
      let idx = 0
      while ((idx = fullText.indexOf(q, idx)) !== -1) {
        searchMatches.push({ entryIdx: i, charIndex: idx })
        idx += q.length
      }
    }
  }
  const [currentMatch, setCurrentMatch] = useState(0)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  const toggleFilter = (level: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  const copyEntry = (e: LogEntry) => {
    const payload = formatPayload(e.data)
    const text = `[${fmtDateShort(e.ts)} ${fmtTimeShort(e.ts)}] [${e.tag}]\n${payload}`
    navigator.clipboard.writeText(text)
    setCopiedTs(e.ts)
    setTimeout(() => setCopiedTs(null), 1500)
  }

  const copyAll = () => {
    const text = filtered.map(e => {
      const payload = formatPayload(e.data)
      return `[${fmtDateShort(e.ts)} ${fmtTimeShort(e.ts)}] [${e.tag}]\n${payload}`
    }).join('\n\n')
    navigator.clipboard.writeText(text)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'var(--q-bg-panel)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-floating)',
    padding: '8px',
    minHeight: 'var(--spacing-header-min)',
    display: 'flex',
    alignItems: 'center',
  }

  const moreLevels = ['success', 'bridge', 'renderer', 'info']
  const allFilters = ['error', 'warn', 'ui']

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {/* Home panel */}
        <div style={panelStyle}>
          <IconBtn icon={Home} onClick={() => props.onSelectPanel('home')} title="Home" />
        </div>
        <div style={{ width: '8px', flexShrink: 0 }} />
        {/* Expanded panel */}
        <div style={{ ...panelStyle, flex: 1 }}>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <Activity size={18} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
          <div style={{ width: '16px', flexShrink: 0 }} />
          <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Log</span>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>({entries.length})</span>
          {/* Filter pills */}
          {allFilters.map(level => (
            <FilterPill key={level} level={level} active={activeFilters.has(level)} onToggle={toggleFilter} />
          ))}
          <div style={{ width: '8px', flexShrink: 0 }} />
          {/* More button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMore(!showMore)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                height: '32px', padding: '0 12px', borderRadius: '6px', border: '1px solid var(--q-border)',
                backgroundColor: 'transparent', cursor: 'pointer',
                color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
              }}
            >
              More
              <ChevronDown size={14} />
            </button>
            {showMore && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowMore(false)} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: '0', zIndex: 50,
                  backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)',
                  borderRadius: '8px', boxShadow: 'var(--shadow-floating)', padding: '8px',
                  display: 'flex', flexDirection: 'column', gap: '4px',
                }}>
                  {moreLevels.map(level => (
                    <FilterPill key={level} level={level} active={activeFilters.has(level)} onToggle={toggleFilter} />
                  ))}
                </div>
              </>
            )}
          </div>
          <span style={{ flex: 1 }} />
          {/* Action buttons */}
          <ActionBtn label="export all" icon={Download} onClick={() => {}} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <ActionBtn label={copiedAll ? 'copied' : 'copy'} icon={copiedAll ? Check : Copy} onClick={copyAll} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <ActionBtn label="refresh" icon={RefreshCw} onClick={() => {}} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <ActionBtn label="clear" icon={Trash} onClick={() => {}} />
        </div>
      </div>

      {/* Log list */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
            Log is empty
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              style={{ height: '100%', overflowY: 'auto', padding: '0 16px' }}
              onScroll={e => {
                const el = e.currentTarget
                setShowScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 50)
              }}
            >
              {filtered.map((e, i) => {
                const level = deriveLevel(e.tag)
                const colors = levelColors[level]
                const payload = formatPayload(e.data)
                const tsText = `${fmtDateShort(e.ts)} ${fmtTimeShort(e.ts)}`
                const isCopied = copiedTs === e.ts
                const isCurrentMatch = searchMatches.length > 0 && currentMatch < searchMatches.length && searchMatches[currentMatch]?.entryIdx === i

                return (
                  <div key={i} style={{ marginBottom: '8px', position: 'relative' }}>
                    <LogBubble
                      bg={colors.bg}
                      fg={colors.text}
                      tagColor={colors.tag}
                      tsText={tsText}
                      tag={e.tag}
                      payload={payload}
                      isCopied={isCopied}
                      onCopy={() => copyEntry(e)}
                      isCurrentMatch={isCurrentMatch}
                      searchQuery={textFilter}
                    />
                  </div>
                )
              })}
            </div>
            {showScrollBtn && (
              <button
                onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }}
                style={{
                  position: 'absolute', bottom: 0, right: 0, width: '32px', height: '32px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-md)', backgroundColor: 'var(--q-bg-panel)',
                  color: 'var(--q-text-secondary)', border: 'none', cursor: 'pointer',
                }}
              >
                <ChevronDown size={20} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Search bar */}
      <div style={{ marginTop: '8px', flexShrink: 0, ...panelStyle }}>
        <div style={{ width: '12px', flexShrink: 0 }} />
        <Search size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
        <div style={{ width: '8px', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search in logs..."
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
          style={{
            flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none',
            color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)',
            padding: '0', margin: '0',
          }}
        />
        <button
          onClick={() => setTextFilter('')}
          style={{
            background: 'none', border: 'none', cursor: textFilter ? 'pointer' : 'default',
            padding: '8px', color: textFilter ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)',
            fontSize: '14px', opacity: textFilter ? 1 : 0.3,
          }}
        >✕</button>
        <div style={{ width: '8px', flexShrink: 0 }} />
        <span style={{
          color: textFilter || searchMatches.length > 0 ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)',
          fontSize: '12px', fontFamily: 'var(--font-code)', opacity: textFilter || searchMatches.length > 0 ? 1 : 0.3,
        }}>
          {textFilter ? (searchMatches.length > 0 ? `${currentMatch + 1}/${searchMatches.length}` : '0/0') : '0/0'}
        </span>
        <div style={{ width: '8px', flexShrink: 0 }} />
        <NavArrow icon={ChevronUp} disabled={searchMatches.length === 0} onClick={() => setCurrentMatch((currentMatch - 1 + searchMatches.length) % searchMatches.length)} />
        <NavArrow icon={ChevronDown} disabled={searchMatches.length === 0} onClick={() => setCurrentMatch((currentMatch + 1) % searchMatches.length)} />
      </div>
    </div>
  )
}

// ── Filter pill ──
function FilterPill({ level, active, onToggle }: { level: string; active: boolean; onToggle: (level: string) => void }) {
  const color = levelColors[level]?.pill || 'var(--q-text-tertiary)'
  return (
    <>
      <div style={{ width: '8px', flexShrink: 0 }} />
      <button
        onClick={() => onToggle(level)}
        style={{
          height: '32px', padding: '0 8px', minWidth: '45px', borderRadius: '4px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: active ? color : 'transparent',
          border: `1px solid ${color}`,
          color: active ? 'var(--q-bg)' : color,
          fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 500,
          transition: 'background-color 0.1s ease, color 0.1s ease',
        }}
      >
        {level}
      </button>
    </>
  )
}

// ── Action button ──
function ActionBtn({ label, icon: Icon, onClick }: { label: string; icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        height: '32px', padding: '0 12px', borderRadius: '6px',
        border: '1px solid var(--q-border)', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
        transition: 'background-color 0.1s ease',
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

// ── Nav arrow button ──
function NavArrow({ icon: Icon, disabled, onClick }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; disabled: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '2px', border: 'none', cursor: disabled ? 'default' : 'pointer',
        backgroundColor: 'transparent', display: 'flex',
        color: disabled ? 'var(--q-text-tertiary)' : (hovered ? 'var(--q-text)' : 'var(--q-text-secondary)'),
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <Icon size={16} />
    </button>
  )
}

// ── Log bubble ──
function LogBubble({ bg, fg, tagColor, tsText, tag, payload, isCopied, onCopy, isCurrentMatch, searchQuery }: {
  bg: string; fg: string; tagColor: string; tsText: string; tag: string; payload: string
  isCopied: boolean; onCopy: () => void; isCurrentMatch: boolean; searchQuery: string
}) {
  const [hovered, setHovered] = useState(false)

  // Highlight search match in text
  const highlight = (text: string): React.ReactNode => {
    if (!searchQuery || !isCurrentMatch) return text
    const q = searchQuery.toLowerCase()
    const lower = text.toLowerCase()
    const idx = lower.indexOf(q)
    if (idx === -1) return text
    return (
      <>
        {text.substring(0, idx)}
        <span style={{ backgroundColor: '#d7be66', color: '#161616' }}>{text.substring(idx, idx + q.length)}</span>
        {text.substring(idx + q.length)}
      </>
    )
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', padding: '16px', borderRadius: 'var(--radius-lg)',
        backgroundColor: bg, boxShadow: 'var(--shadow-floating)',
        position: 'relative',
      }}
    >
      {/* Header: timestamp + tag */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: `${fg}99`, fontSize: '12px', fontFamily: 'var(--font-code)' }}>{tsText}</span>
        <span style={{ color: tagColor, fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-code)' }}>[{tag}]</span>
      </div>
      {/* Payload */}
      {payload && (
        <>
          <div style={{ height: '4px' }} />
          <div style={{ color: fg, fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {highlight(payload)}
          </div>
        </>
      )}
      {/* Copy button */}
      {(hovered || isCopied) && (
        <button
          onClick={onCopy}
          style={{
            position: 'absolute', top: '8px', right: '8px',
            padding: '6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
            backgroundColor: bg, display: 'flex', alignItems: 'center',
          }}
        >
          {isCopied ? <Check size={16} style={{ color: fg }} /> : <Copy size={16} style={{ color: fg }} />}
        </button>
      )}
    </div>
  )
}

// ── Icon button (same as ChatHeader) ──
function IconBtn({ icon: Icon, onClick, title }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '6px', border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        flexShrink: 0, padding: '0', transition: 'background-color 0.15s ease, color 0.15s ease',
      }}
    >
      <Icon size={20} />
    </button>
  )
}