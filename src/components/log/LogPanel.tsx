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
  const [searchMatches, setSearchMatches] = useState<number[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const { call, notify, connected } = useSidecarContext()

  // Highlight match in golden (same as Settings)
  function hlLog(q: string, entryIdx: number) {
    document.querySelectorAll('.search-highlight-mark').forEach((el) => {
      const p = el.parentNode; if (p) { p.replaceChild(document.createTextNode(el.textContent || ''), el); p.normalize() }
    })
    if (!q.trim() || !bodyRef.current) return
    const children = bodyRef.current.children
    const el = children[entryIdx] as HTMLElement
    if (!el) return
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = w.nextNode())) {
      const pn = (node as Text).parentElement
      if (pn && pn.tagName !== 'SCRIPT' && pn.tagName !== 'STYLE') {
        const t = (node as Text).textContent || '', l = t.toLowerCase(), ql = q.toLowerCase()
        let i = 0
        while ((i = l.indexOf(ql, i)) !== -1) {
          const frag = document.createDocumentFragment()
          if (i > 0) frag.appendChild(document.createTextNode(t.substring(0, i)))
          const m = document.createElement('mark')
          m.className = 'search-highlight-mark'
          m.textContent = t.substring(i, i + q.length)
          frag.appendChild(m)
          if (i + q.length < t.length) frag.appendChild(document.createTextNode(t.substring(i + q.length)))
          ;(node as Text).parentNode!.replaceChild(frag, node)
          return
        }
      }
    }
  }

  // Scroll to a log entry
  function scrollToEntry(idx: number) {
    if (!bodyRef.current) return
    const el = bodyRef.current.children[idx] as HTMLElement
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

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
    error:    { bg: 'color-mix(in srgb, var(--q-accent-danger) 6%, transparent)', text: 'var(--q-accent-danger)', tag: 'var(--q-accent-danger)', pill: 'var(--q-accent-danger)' },
    warn:     { bg: 'color-mix(in srgb, var(--q-accent-warning) 6%, transparent)', text: 'var(--q-accent-warning)', tag: 'var(--q-accent-warning)', pill: 'var(--q-accent-warning)' },
    ui:       { bg: 'color-mix(in srgb, var(--q-accent-info) 6%, transparent)', text: 'var(--q-accent-info)', tag: 'var(--q-accent-info)', pill: 'var(--q-accent-info)' },
    success:  { bg: 'color-mix(in srgb, var(--q-accent-success) 6%, transparent)', text: 'var(--q-accent-success)', tag: 'var(--q-accent-success)', pill: 'var(--q-accent-success)' },
    bridge:   { bg: 'color-mix(in srgb, var(--q-text) 4%, transparent)', text: 'var(--q-text)', tag: 'var(--q-text)', pill: 'var(--q-text)' },
    renderer: { bg: 'color-mix(in srgb, var(--q-text-secondary) 4%, transparent)', text: 'var(--q-text-secondary)', tag: 'var(--q-text-secondary)', pill: 'var(--q-text-secondary)' },
    info:     { bg: 'color-mix(in srgb, var(--q-text-tertiary) 4%, transparent)', text: 'var(--q-text-tertiary)', tag: 'var(--q-text-tertiary)', pill: 'var(--q-text-tertiary)' },
  }

  const moreFilters = ['success', 'bridge', 'renderer', 'info']

  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

  function deriveLevel(tag: string): string {
    // Hide verbose technical logs
    if (tag.startsWith('ollama-probe-') || tag.startsWith('sync-') || tag.startsWith('model-registry') || tag.startsWith('ollama-info') || tag.startsWith('ollama-baseurl') || tag.startsWith('ollama-levels') || tag.startsWith('verify-thinking') || tag.startsWith('mapMessage')) return 'renderer'
    // Errors
    if (tag.startsWith('error') || tag.includes('error') || tag.includes('Error') || tag.includes('failed') || tag.includes('-error')) return 'error'
    // Warnings
    if (tag.startsWith('warn') || tag.startsWith('warning') || tag === 'retrying' || tag.includes('deprecat')) return 'warn'
    // Success/loaded/done
    if (tag.startsWith('success') || tag.includes('done') || tag.includes('loaded') || tag.includes('initialized') || tag.includes('created') || tag.includes('renamed') || tag.includes('sent')) return 'success'
    // UI actions
    if (tag.startsWith('ui-') || tag.startsWith('ui:') || tag.includes('ui-click') || tag.includes('ui-nav') || tag.includes('ui-keyboard') || tag.includes('ui-panel')) return 'ui'
    // Bridge: session/agent/model/thinking/mode changes + send/receive
    if (tag.startsWith('send-message') || tag.startsWith('set-agent') || tag.startsWith('set-mode') || tag.startsWith('set-thinking') || tag.startsWith('set-model') || tag.startsWith('chat-agents') || tag.startsWith('agent-changed') || tag.startsWith('model-changed') || tag.startsWith('thinking-changed') || tag.startsWith('mode-changed') || tag.startsWith('session-') || tag.startsWith('working-dir') || tag.startsWith('stream') || tag.startsWith('bridge') || tag.startsWith('full-state') || tag.startsWith('get_') || tag.startsWith('ws:') || tag.startsWith('send:') || tag.startsWith('create') || tag.startsWith('delete') || tag.startsWith('update') || tag.startsWith('rename') || tag.startsWith('reload') || tag.startsWith('flush') || tag.startsWith('compact') || tag.startsWith('set-')) return 'bridge'
    // Renderer/sidecar internals
    if (tag.startsWith('renderer') || tag.startsWith('sidecar-marker') || tag.startsWith('stdout')) return 'renderer'
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
    // Hide renderer (verbose technical logs) by default
    if (level === 'renderer') return false
    if (activeFilters.size > 0 && !activeFilters.has(level)) return false
    return true
  })

  // searchMatches is now a state, computed in onChange
  // (removed the derived const to avoid duplicate declaration)

  function toggleFilter(level: string) {
    setActiveFilters((prev) => {
      const n = new Set(prev)
      if (n.has(level)) n.delete(level)
      else n.add(level)
      return n
    })
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

  function IconBtn({ icon: Icon, onClick }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void }) {
    const [hovered, setHovered] = useState(false)
    return (
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
          backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
          color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
          flexShrink: 0, padding: '0',
          transition: 'none',
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
        style={{
          height: '32px', padding: '0 8px', minWidth: '45px', borderRadius: 'var(--radius-md)',
          cursor: 'pointer', backgroundColor: isActive ? color : 'transparent',
          border: `1px solid ${color}`, color: isActive ? 'var(--q-bg)' : color,
          fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'none',
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
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px', height: '32px',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${isGreen ? 'var(--q-accent-success)' : 'var(--q-border)'}`,
          cursor: 'pointer', backgroundColor: 'transparent',
          color: isGreen ? 'var(--q-accent-success)' : 'var(--q-text-secondary)',
          fontSize: '12px', fontFamily: 'var(--font-interface)',
          transition: 'none',
        }}
      >
        {icon}
        {label}
      </button>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%', position: 'relative' }}>
      {/* Header */}
      <div style={{ marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <div style={panelStyle}>
          <IconBtn icon={Home} onClick={() => props.onSelectPanel('home')} />
        </div>
        <div style={{ width: '8px', flexShrink: 0 }} />
        <div style={{ ...panelStyle, flex: 1 }}>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <Terminal size={18} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
          <div style={{ width: '12px', flexShrink: 0 }} />
          <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Log</span>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>({filtered.length})</span>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <FilterPill level="error" />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <FilterPill level="warn" />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <FilterPill level="ui" />
          <div style={{ width: '8px', flexShrink: 0 }} />
          {/* More filters dropdown */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
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
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px', height: '32px',
                borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)',
                cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)',
                fontSize: '12px', fontFamily: 'var(--font-interface)',
                transition: 'none',
              }}
            >
              <ChevronDown size={14} style={{ transition: 'none' }} />
              More
            </button>
            <div
              ref={overlayRef}
              style={{ position: 'fixed', inset: 0, zIndex: 40, backgroundColor: 'transparent', display: 'none' }}
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
              style={{
                position: 'absolute', top: 'calc(100% + 8px)', left: '0', zIndex: 50,
                backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)',
                padding: '4px', display: 'none', flexDirection: 'column', gap: '4px',
              }}
            >
              {moreFilters.map((level) => <FilterPill key={level} level={level} />)}
            </div>
          </div>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <span style={{ flex: 1 }} />
          <HeaderBtn label="export all" icon={<Download size={14} />} onClick={() => setShowExport(true)} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <HeaderBtn label="copy" icon={<Copy size={14} />} onClick={() => {
            const md = filtered.map((e) => `### [${deriveLevel(e.tag)}] ${fmtTimestampFull(e.ts)}\n**Tag:** ${e.tag}\n\n${formatPayload(e.data)}\n`).join(`\n---\n\n`)
            navigator.clipboard.writeText(md)
          }} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <HeaderBtn label="refresh" icon={<RefreshCw size={14} />} onClick={() => {
            if (!call) return
            call('getFullDebugLog', {}).then((r: any) => {
              if (r && r.log) setEntries(r.log.slice(-500))
            }).catch(() => {})
          }} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <HeaderBtn label="clear" icon={<Trash size={14} />} onClick={() => setShowClear(true)} />
        </div>
      </div>

      {/* Log body */}
      <div ref={bodyRef}
        style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 8px 16px', position: 'relative' }}
        onScroll={(e) => {
          const el = e.currentTarget
          setShowScrollBtn(el.scrollTop + el.clientHeight < el.scrollHeight - 100)
        }}>
        
        {entries.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
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
                style={{
                  width: '100%', padding: '16px', marginBottom: '12px', borderRadius: 'var(--radius-lg)',
                  backgroundColor: colors.bg, boxShadow: 'var(--shadow-floating)', position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', flexShrink: 0 }}>
                    {fmtTimestampFull(e.ts)}
                  </span>
                  <span style={{ color: colors.tag, fontSize: '12px', fontFamily: 'var(--font-code)', fontWeight: 600, flexShrink: 0 }}>
                    [{e.tag}]
                  </span>
                </div>
                {payload ? (
                  <div style={{ marginTop: '4px', color: colors.text, fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {payload}
                  </div>
                ) : null}
                <button
                  onClick={(ev) => { ev.stopPropagation(); navigator.clipboard.writeText(formatPayload(e.data)) }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.color = colors.text }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.color = colors.tag }}
                  style={{
                    position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none',
                    cursor: 'pointer', padding: '6px', borderRadius: 'var(--radius-md)', color: colors.tag,
                    display: 'flex', opacity: isHovered ? 1 : 0,
                  }}
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
          style={{
            position: 'absolute',
            bottom: '60px',
            right: '0',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--q-accent-success)',
            color: 'var(--q-bg)',
            border: 'none',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-floating)',
            zIndex: 10,
          }}
        >
          <ArrowDown size={20} />
        </button>
      )}
      {/* Search bar */}
      <div style={{ marginTop: '8px', flexShrink: 0, ...panelStyle }}>
        <div style={{ width: '12px', flexShrink: 0 }} />
        <Search size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
        <div style={{ width: '8px', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search in logs..."
          value={search}
          onChange={(e) => {
            const v = e.target.value
            setSearch(v)
            const q = v.toLowerCase()
            const matches: number[] = []
            if (q) {
              filtered.forEach((entry, i) => {
                const p = formatPayload(entry.data)
                const f = (fmtDateShort(entry.ts) + ' ' + fmtTimeShort(entry.ts) + ' ' + entry.tag + ' ' + p).toLowerCase()
                if (f.includes(q)) matches.push(i)
              })
            }
            setSearchMatches(matches)
            setCurrentMatch(0)
            if (matches.length > 0) {
              const lastIdx = matches.length - 1
              setCurrentMatch(lastIdx)
              scrollToEntry(matches[lastIdx])
              setTimeout(() => hlLog(v, matches[lastIdx]), 100)
            } else {
              document.querySelectorAll('.search-highlight-mark').forEach((el) => {
                const p = el.parentNode; if (p) { p.replaceChild(document.createTextNode(el.textContent || ''), el); p.normalize() }
              })
            }
          }}
          style={{
            flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none',
            color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0', margin: '0',
          }}
        />
        <button
          onClick={() => {
            setSearch('')
            setSearchMatches([])
            setCurrentMatch(0)
            document.querySelectorAll('.search-highlight-mark').forEach((el) => {
              const p = el.parentNode; if (p) { p.replaceChild(document.createTextNode(el.textContent || ''), el); p.normalize() }
            })
          }}
          style={{
            background: 'none', border: 'none', cursor: search ? 'pointer' : 'default', padding: '8px',
            color: search ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', fontSize: '14px', opacity: search ? 1 : 0.3,
          }}
        >
          ✕
        </button>
        <div style={{ width: '8px', flexShrink: 0 }} />
        <span style={{ color: !search || searchMatches.length === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-code)', opacity: !search || searchMatches.length === 0 ? 0.3 : 1 }}>
          {search ? (searchMatches.length === 0 ? '0/0' : `${currentMatch + 1}/${searchMatches.length}`) : '0/0'}
        </span>
        <div style={{ width: '8px', flexShrink: 0 }} />
        <button
          onClick={() => {
            if (searchMatches.length > 0) {
              const ni = (currentMatch - 1 + searchMatches.length) % searchMatches.length
              setCurrentMatch(ni)
              scrollToEntry(searchMatches[ni])
              setTimeout(() => hlLog(search, searchMatches[ni]), 100)
            }
          }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0px',
            color: searchMatches.length > 0 ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)',
            opacity: searchMatches.length > 0 ? 1 : 0.3, display: 'flex',
          }}
        >
          <ChevronUp size={16} />
        </button>
        <button
          onClick={() => {
            if (searchMatches.length > 0) {
              const ni = (currentMatch + 1) % searchMatches.length
              setCurrentMatch(ni)
              scrollToEntry(searchMatches[ni])
              setTimeout(() => hlLog(search, searchMatches[ni]), 100)
            }
          }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0px',
            color: searchMatches.length > 0 ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)',
            opacity: searchMatches.length > 0 ? 1 : 0.3, display: 'flex',
          }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {/* Export modal */}
      {showExport && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowExport(false)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>Export log entries?</div>
            <div style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>
              {filtered.length} entries will be exported to clipboard as markdown.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button className="q-press" onClick={() => setShowExport(false)} style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Cancel</button>
              <div style={{ width: '8px' }} />
              <button className="q-press" onClick={() => {
                const md = filtered.map((e) => `### [${deriveLevel(e.tag)}] ${fmtTimestampFull(e.ts)}\n**Tag:** ${e.tag}\n\n${formatPayload(e.data)}\n`).join(`\n---\n\n`)
                navigator.clipboard.writeText(md)
                setShowExport(false)
              }} style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-success)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)' }}>Export</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear modal */}
      {showClear && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowClear(false)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>Clear all log entries?</div>
            <div style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>
              {entries.length} entries will be removed.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button className="q-press" onClick={() => setShowClear(false)} style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Cancel</button>
              <div style={{ width: '8px' }} />
              <button className="q-press" onClick={async () => {
                if (call) { try { await call('clearDebugLogFile', {}) } catch (e) {} }
                setEntries([])
                setShowClear(false)
              }} style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-success)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)' }}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}