import { useState, useRef, useEffect } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Terminal, Search, ChevronDown, ChevronUp, Download, Copy, RefreshCw, Trash, ArrowDown } from '../icons'

interface LogEntry {
  ts: number
  tag: string
  data: string | object
}

interface LogPanelProps {
  activePanel?: string
  onSelectPanel: (panel: string) => void
  logs?: LogEntry[]
}

export function LogPanel(props: LogPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [showClear, setShowClear] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [currentMatch, setCurrentMatch] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { call, notify, connected } = useSidecarContext()

  useEffect(() => {
    if (!call) return
    call('getFullDebugLog', {}).then((r: any) => {
      if (r && r.log) setEntries(r.log.slice(-500))
    }).catch(() => {})
  }, [call])

  useEffect(() => {
    if (props.logs && props.logs.length > 0) setEntries(props.logs.slice(-500))
  }, [props.logs])

  useEffect(() => {
    if (autoScroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [entries, autoScroll])

  const levelColors: Record<string, { bg: string; text: string; tag: string; pill: string }> = {
    error:    { bg: 'var(--q-log-error-bg)',    text: 'var(--q-log-error-text)',    tag: 'var(--q-log-error-tag)',    pill: 'var(--q-accent-danger)' },
    warn:     { bg: 'var(--q-log-warn-bg)',     text: 'var(--q-log-warn-text)',     tag: 'var(--q-log-warn-tag)',     pill: 'var(--q-accent-warning)' },
    ui:       { bg: 'var(--q-log-ui-bg)',       text: 'var(--q-log-ui-text)',       tag: 'var(--q-log-ui-tag)',       pill: 'var(--q-accent-info)' },
    success:  { bg: 'var(--q-log-success-bg)',  text: 'var(--q-log-success-text)',  tag: 'var(--q-log-success-tag)',  pill: 'var(--q-accent-success)' },
    bridge:   { bg: 'var(--q-log-bridge-bg)',   text: 'var(--q-log-bridge-text)',   tag: 'var(--q-log-bridge-tag)',   pill: 'var(--q-text)' },
    renderer: { bg: 'var(--q-log-renderer-bg)', text: 'var(--q-log-renderer-text)', tag: 'var(--q-log-renderer-tag)', pill: 'var(--q-text-secondary)' },
    info:     { bg: 'var(--q-log-info-bg)',     text: 'var(--q-log-info-text)',     tag: 'var(--q-log-info-tag)',     pill: 'var(--q-text-tertiary)' },
  }

  const moreFilters = ['success', 'bridge', 'renderer', 'info']

  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

  function deriveLevel(tag: string): string {
    if (tag.startsWith('error') || tag.includes('error')) return 'error'
    if (tag.startsWith('warn') || tag.startsWith('warning') || tag === 'retrying') return 'warn'
    if (tag.startsWith('success')) return 'success'
    if (tag.startsWith('ui-') || tag.startsWith('ui:') || tag.includes('ui-click') || tag.includes('ui-nav') || tag.includes('ui-keyboard') || tag.includes('ui-panel')) return 'ui'
    if (tag.startsWith('bridge:') || tag.startsWith('bridge-') || tag.startsWith('full-state-') || tag.startsWith('get_') || tag.startsWith('ws:') || tag.startsWith('send:') || tag.startsWith('stream:') || tag.startsWith('history:') || tag.startsWith('session:')) return 'bridge'
    if (tag.startsWith('renderer:') || tag.startsWith('renderer-')) return 'renderer'
    return 'info'
  }

  function formatPayload(data: any): string {
    if (data == null) return ''
    if (typeof data === 'string') return data
    if (typeof data !== 'object') return String(data)
    try { return JSON.stringify(data, null, 2) } catch { return String(data) }
  }

  function fmtDateShort(ts: number): string {
    const d = new Date(ts)
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
  }

  function fmtTimeShort(ts: number): string {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  function fmtTimestampFull(ts: number): string {
    return fmtDateShort(ts) + ', ' + fmtTimeShort(ts)
  }

  const filtered = entries.filter((e) => {
    const level = deriveLevel(e.tag)
    if (activeFilters.size > 0 && !activeFilters.has(level)) return false
    if (search) {
      const p = formatPayload(e.data)
      if (!(fmtDateShort(e.ts) + ' ' + fmtTimeShort(e.ts) + ' ' + e.tag + ' ' + p).toLowerCase().includes(search.toLowerCase())) return false
    }
    return true
  })

  const searchMatches: number[] = []
  if (search) {
    const q = search.toLowerCase()
    filtered.forEach((e, i) => {
      const p = formatPayload(e.data)
      const f = (fmtDateShort(e.ts) + ' ' + fmtTimeShort(e.ts) + ' ' + e.tag + ' ' + p).toLowerCase()
      let idx = 0
      while ((idx = f.indexOf(q, idx)) !== -1) {
        searchMatches.push(i)
        idx += q.length
      }
    })
  }

  function toggleFilter(level: string) {
    setActiveFilters((prev) => {
      const n = new Set(prev)
      if (n.has(level)) n.delete(level)
      else n.add(level)
      return n
    })
  }

  // Shared className for panel bars
  const panelClass = "bg-bg-panel rounded-lg shadow-floating p-2 min-h-header-min flex items-center"

  function IconBtn({ icon: Icon, onClick }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void }) {
    const [hovered, setHovered] = useState(false)
    return (
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-8 h-8 flex items-center justify-center rounded-md border-none cursor-pointer shrink-0 p-0"
        style={{
          backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
          color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
          transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <Icon size={20} />
      </button>
    )
  }

  function FilterPill({ level }: { level: string }) {
    const isActive = activeFilters.has(level)
    const color = levelColors[level]?.pill || 'var(--q-text-tertiary)'
    return (
      <button
        onClick={() => toggleFilter(level)}
        className="h-8 px-2 min-w-[45px] rounded-md cursor-pointer border text-12 font-interface font-medium flex items-center justify-center"
        style={{
          backgroundColor: isActive ? color : 'transparent',
          borderColor: color,
          color: isActive ? 'var(--q-bg)' : color,
          transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease',
        }}
      >
        {level}
      </button>
    )
  }

  function HeaderBtn({ label, icon, onClick, active }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean }) {
    const [hovered, setHovered] = useState(false)
    const isGreen = hovered || active
    return (
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex items-center gap-1.5 px-2 h-8 rounded-md border cursor-pointer bg-transparent text-12 font-interface"
        style={{
          borderColor: isGreen ? 'var(--q-accent-success)' : 'var(--q-border)',
          color: isGreen ? 'var(--q-accent-success)' : 'var(--q-text-secondary)',
          transition: 'border-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease',
        }}
      >
        {icon}
        {label}
      </button>
    )
  }

  return (
    <div className="h-full flex flex-col max-w-chat-max mx-auto w-full relative">
      {/* Header */}
      <div className="mb-2 shrink-0 flex items-center">
        <div className={panelClass}>
          <IconBtn icon={Home} onClick={() => props.onSelectPanel('home')} />
        </div>
        <div className="w-2 shrink-0" />
        <div className={panelClass + " flex-1"}>
          <div className="w-2 shrink-0" />
          <Terminal size={18} className="text-text-secondary shrink-0" />
          <div className="w-3 shrink-0" />
          <span className="text-text text-16 font-semibold font-interface">Log</span>
          <div className="w-2 shrink-0" />
          <span className="text-text-tertiary text-12 font-interface">({filtered.length})</span>
          <div className="w-2 shrink-0" />
          <FilterPill level="error" />
          <div className="w-2 shrink-0" />
          <FilterPill level="warn" />
          <div className="w-2 shrink-0" />
          <FilterPill level="ui" />
          <div className="w-2 shrink-0" />
          {/* More filters dropdown */}
          <div className="relative flex items-center">
            <button
              onClick={(e) => {
                const btn = e.currentTarget
                const isOpen = btn.dataset.open === '1'
                if (dropdownRef.current) dropdownRef.current.style.display = isOpen ? 'none' : 'flex'
                if (overlayRef.current) overlayRef.current.style.display = isOpen ? 'none' : 'block'
                const arrow = btn.querySelector('svg')
                if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)'
                btn.dataset.open = isOpen ? '0' : '1'
                btn.style.borderColor = isOpen ? 'var(--q-border)' : 'var(--q-accent-success)'
                btn.style.color = isOpen ? 'var(--q-text-secondary)' : 'var(--q-accent-success)'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--q-accent-success)'; e.currentTarget.style.color = 'var(--q-accent-success)' }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget
                const isOpen = btn.dataset.open === '1'
                btn.style.borderColor = isOpen ? 'var(--q-accent-success)' : 'var(--q-border)'
                btn.style.color = isOpen ? 'var(--q-accent-success)' : 'var(--q-text-secondary)'
              }}
              className="flex items-center gap-1.5 px-2 h-8 rounded-md border border-border cursor-pointer bg-transparent text-text-secondary text-12 font-interface"
              style={{ transition: 'border-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease' }}
            >
              <ChevronDown size={14} style={{ transition: 'transform 120ms ease' }} />
              More
            </button>
            <div
              ref={overlayRef}
              className="fixed inset-0 z-overlay bg-transparent hidden"
              onClick={() => {
                if (dropdownRef.current) dropdownRef.current.style.display = 'none'
                if (overlayRef.current) overlayRef.current.style.display = 'none'
                const moreBtn = dropdownRef.current?.parentElement?.querySelector('button')
                if (moreBtn) {
                  moreBtn.dataset.open = '0'
                  moreBtn.style.borderColor = 'var(--q-border)'
                  moreBtn.style.color = 'var(--q-text-secondary)'
                  const arrow = moreBtn.querySelector('svg')
                  if (arrow) arrow.style.transform = 'rotate(0deg)'
                }
              }}
            />
            <div
              ref={dropdownRef}
              className="absolute top-[calc(100%+8px)] left-0 z-dropdown bg-bg-panel rounded-md shadow-modal border border-border p-1 hidden flex-col gap-1"
            >
              {moreFilters.map((level) => <FilterPill key={level} level={level} />)}
            </div>
          </div>
          <div className="w-2 shrink-0" />
          <span className="flex-1" />
          <HeaderBtn label="export all" icon={<Download size={14} />} onClick={() => setShowExport(true)} />
          <div className="w-1 shrink-0" />
          <HeaderBtn label="copy" icon={<Copy size={14} />} onClick={() => {}} />
          <div className="w-1 shrink-0" />
          <HeaderBtn label="refresh" icon={<RefreshCw size={14} />} onClick={() => {}} />
          <div className="w-1 shrink-0" />
          <HeaderBtn label="clear" icon={<Trash size={14} />} onClick={() => setShowClear(true)} />
        </div>
      </div>

      {/* Log body */}
      <div ref={bodyRef}
        className="flex-1 overflow-y-auto pt-px pr-4 pb-2 pl-4 relative"
        onScroll={(e) => {
          const el = e.currentTarget
          setShowScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 100)
        }}>
        
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-14 font-interface">
            log vuoto
          </div>
        ) : (
          filtered.map((e, i) => {
            const level = deriveLevel(e.tag)
            const colors = levelColors[level] || levelColors.info
            const payload = formatPayload(e.data)
            const isHovered = hoveredIdx === i
            return (
              <div
                key={i}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="w-full p-4 mb-2 rounded-lg shadow-floating relative"
                style={{ backgroundColor: colors.bg }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-text-tertiary text-12 font-code shrink-0">
                    {fmtTimestampFull(e.ts)}
                  </span>
                  <span className="text-12 font-code font-semibold shrink-0" style={{ color: colors.tag }}>
                    [{e.tag}]
                  </span>
                </div>
                {payload ? (
                  <div className="mt-1 text-14 font-interface leading-relaxed whitespace-pre-wrap break-words" style={{ color: colors.text }}>
                    {payload}
                  </div>
                ) : null}
                <button
                  onClick={(ev) => { ev.stopPropagation(); navigator.clipboard.writeText(formatPayload(e.data)) }}
                  className="absolute top-2 right-2 bg-none border-none cursor-pointer p-1.5 rounded-md text-text flex"
                  style={{ opacity: isHovered ? 1 : 0, transition: 'opacity 150ms ease' }}
                >
                  <Copy size={16} />
                </button>
              </div>
            )
          })
        )}

      </div>

      {showScrollBtn && (
        <button
          onClick={() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }}
          className="absolute bottom-[60px] right-0 w-8 h-8 flex items-center justify-center rounded-md bg-bg-panel text-text-secondary border-none cursor-pointer shadow-floating z-10"
        >
          <ArrowDown size={20} />
        </button>
      )}
      {/* Search bar */}
      <div className={"mt-2 shrink-0 " + panelClass}>
        <div className="w-3 shrink-0" />
        <Search size={16} className="text-text-tertiary shrink-0" />
        <div className="w-2 shrink-0" />
        <input
          type="text"
          placeholder="Search in logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-text text-14 font-interface p-0 m-0"
        />
        <button
          onClick={() => setSearch('')}
          className="bg-none border-none p-2 text-14"
          style={{
            cursor: search ? 'pointer' : 'default',
            color: search ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)',
            opacity: search ? 1 : 0.3,
          }}
        >
          ✕
        </button>
        <div className="w-2 shrink-0" />
        <span className="text-text-tertiary text-12 font-code" style={{ opacity: !search || searchMatches.length === 0 ? 0.3 : 1 }}>
          {search ? (searchMatches.length === 0 ? '0/0' : `${currentMatch + 1}/${searchMatches.length}`) : '0/0'}
        </span>
        <div className="w-2 shrink-0" />
        <button
          onClick={() => searchMatches.length > 0 && setCurrentMatch((p) => (p - 1 + searchMatches.length) % searchMatches.length)}
          className="bg-none border-none cursor-pointer p-0 flex"
          style={{
            color: searchMatches.length > 0 ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)',
            opacity: searchMatches.length > 0 ? 1 : 0.3,
          }}
        >
          <ChevronUp size={16} />
        </button>
        <button
          onClick={() => searchMatches.length > 0 && setCurrentMatch((p) => (p + 1) % searchMatches.length)}
          className="bg-none border-none cursor-pointer p-0 flex"
          style={{
            color: searchMatches.length > 0 ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)',
            opacity: searchMatches.length > 0 ? 1 : 0.3,
          }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {/* Export modal */}
      {showExport && (
        <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setShowExport(false)}>
          <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter p-6 max-w-[400px] w-[90%]" onClick={(e) => e.stopPropagation()}>
            <div className="text-text text-16 font-interface mb-2">Export log entries?</div>
            <div className="text-text-tertiary text-13 font-interface mb-5">
              {filtered.length} entries will be exported to clipboard as markdown.
            </div>
            <div className="flex justify-end items-center">
              <button className="q-press px-4 py-2 rounded-md border-none cursor-pointer bg-transparent text-accent-danger text-15 font-interface" onClick={() => setShowExport(false)}>Cancel</button>
              <div className="w-2" />
              <button className="q-press px-4 py-2 rounded-lg border-none cursor-pointer bg-accent-success text-bg text-15 font-medium font-interface" onClick={() => {
                const md = filtered.map((e) => `### [${deriveLevel(e.tag)}] ${fmtTimestampFull(e.ts)}\n**Tag:** ${e.tag}\n\n${formatPayload(e.data)}\n`).join(`\n---\n\n`)
                navigator.clipboard.writeText(md)
                setShowExport(false)
              }}>Export</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear modal */}
      {showClear && (
        <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setShowClear(false)}>
          <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter p-6 max-w-[400px] w-[90%]" onClick={(e) => e.stopPropagation()}>
            <div className="text-text text-16 font-interface mb-2">Clear all log entries?</div>
            <div className="text-text-tertiary text-13 font-interface mb-5">
              {entries.length} entries will be removed.
            </div>
            <div className="flex justify-end items-center">
              <button className="q-press px-4 py-2 rounded-md border-none cursor-pointer bg-transparent text-accent-danger text-15 font-interface" onClick={() => setShowClear(false)}>Cancel</button>
              <div className="w-2" />
              <button className="q-press px-4 py-2 rounded-lg border-none cursor-pointer bg-accent-success text-bg text-15 font-medium font-interface" onClick={async () => {
                if (call) { try { await call('clearDebugLogFile', {}) } catch (e) {} }
                setEntries([])
                setShowClear(false)
              }}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}