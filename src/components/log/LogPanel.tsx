// ============================================================
// LogPanel — Real sidecar logs
// ============================================================

import { useState, useRef, useEffect } from 'react'
import { Home, Terminal, Search, ChevronDown, ChevronUp, Copy, Check } from '../icons'

interface LogEntry {
  ts: number
  tag: string
  data: string | object
}

interface LogPanelProps {
  activePanel?: string
  onSelectPanel: (panel: string) => void
  logs?: any[]
  onLoadLog?: () => Promise<void>
  onClearLog?: () => Promise<void>
}

// ── Format helpers ──
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function formatPayload(data: string | object): string {
  if (typeof data === 'string') return data
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}

// ── Level derivation ──
function deriveLevel(tag: string): 'error' | 'warn' | 'debug' | 'info' {
  if (tag.includes('error') || tag.includes('fail') || tag.includes('crash')) return 'error'
  if (tag.includes('warn') || tag.includes('deprecated')) return 'warn'
  if (tag.includes('debug') || tag.includes('trace')) return 'debug'
  return 'info'
}

// ── Level colors ──
const levelColors: Record<string, { pill: string; text: string }> = {
  info:   { pill: 'var(--q-accent-info)',    text: 'var(--q-accent-info)' },
  warn:   { pill: 'var(--q-accent-warning)',  text: 'var(--q-accent-warning)' },
  error:  { pill: 'var(--q-accent-danger)',   text: 'var(--q-accent-danger)' },
  debug:  { pill: 'var(--q-text-tertiary)',   text: 'var(--q-text-tertiary)' },
}

// ── Map sidecar log entries to LogEntry ──
function mapLogs(raw: any[]): LogEntry[] {
  return raw.map((entry) => {
    // Sidecar log format: { tag, data, timestamp } or { tag, data, ts } or { tag, message }
    const ts = entry.timestamp || entry.ts || entry.time || Date.now()
    const tag = entry.tag || entry.level || entry.type || 'info'
    const data = entry.data || entry.message || entry.content || ''
    return { ts: typeof ts === 'number' ? ts : new Date(ts).getTime(), tag, data }
  })
}

export function LogPanel({ onSelectPanel, logs = [], onLoadLog, onClearLog }: LogPanelProps) {
  const [searchFilter, setSearchFilter] = useState('')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showClearModal, setShowClearModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load full log on mount
  useEffect(() => {
    onLoadLog?.()
  }, [onLoadLog])

  const entries = mapLogs(logs)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length, autoScroll])

  const filtered = searchFilter
    ? entries.filter(e =>
        e.tag.toLowerCase().includes(searchFilter.toLowerCase()) ||
        formatPayload(e.data).toLowerCase().includes(searchFilter.toLowerCase())
      )
    : entries

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%' }}>
      {/* ── Header ── */}
      <div style={{
        marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px', backgroundColor: 'var(--q-bg-panel)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)',
      }}>
        <button onClick={() => onSelectPanel('home')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', color: 'var(--q-text-secondary)' }}>
          <Home size={20} />
        </button>
        <div style={{ width: '8px' }} />
        <Terminal size={20} style={{ color: 'var(--q-accent-success)' }} />
        <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Log</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-code)' }}>
          {filtered.length} entries
        </span>

        {copied ? (
          <>
            <Check size={16} style={{ color: 'var(--q-accent-success)' }} />
            <span style={{ color: 'var(--q-accent-success)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Copied</span>
          </>
        ) : (
          <button
            onClick={() => {
              const text = filtered.map(e =>
                `### [${deriveLevel(e.tag)}] ${formatDate(e.ts)} ${formatTime(e.ts)}\n**Tag:** ${e.tag}\n\n${formatPayload(e.data)}\n`
              ).join('\n---\n\n')
              navigator.clipboard.writeText(text)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <Copy size={16} /> Export
          </button>
        )}

        <div style={{ width: '8px' }} />
        <button onClick={() => setShowClearModal(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
          Clear
        </button>
      </div>

      {/* ── Search bar ── */}
      <div style={{
        marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)',
      }}>
        <Search size={16} style={{ color: 'var(--q-text-tertiary)' }} />
        <input type="text" placeholder="Search in logs..." value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
          style={{
            flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none',
            color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)',
          }} />
        {searchFilter && (
          <button onClick={() => setSearchFilter('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)' }}>✕</button>
        )}
        <div style={{ width: '8px' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontFamily: 'var(--font-interface)', color: 'var(--q-text-tertiary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
            style={{ accentColor: 'var(--q-accent-success)' }} />
          Auto-scroll
        </label>
      </div>

      {/* ── Log list ── */}
      <div ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', backgroundColor: 'var(--q-bg-panel)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)',
        }}>
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
            No log entries
          </div>
        ) : (
          filtered.map((entry, i) => {
            const level = deriveLevel(entry.tag)
            const colors = levelColors[level]
            const isExpanded = expandedIdx === i
            return (
              <div key={i}
                style={{ borderBottom: '1px solid var(--q-border)', padding: '8px 12px', cursor: 'pointer' }}
                onClick={() => setExpandedIdx(isExpanded ? null : i)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors.pill, flexShrink: 0 }} />
                  <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', flexShrink: 0 }}>
                    {formatTime(entry.ts)}
                  </span>
                  <span style={{ color: colors.text, fontSize: '12px', fontFamily: 'var(--font-code)', flexShrink: 0 }}>
                    {entry.tag}
                  </span>
                  <span style={{
                    flex: 1, color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-code)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {typeof entry.data === 'string' ? entry.data.substring(0, 100) : JSON.stringify(entry.data).substring(0, 100)}
                  </span>
                  {isExpanded ? <ChevronUp size={14} style={{ color: 'var(--q-text-tertiary)' }} /> : <ChevronDown size={14} style={{ color: 'var(--q-text-tertiary)' }} />}
                </div>
                {isExpanded && (
                  <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', overflow: 'auto' }}>
                    <pre style={{ margin: 0, color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-code)', whiteSpace: 'pre-wrap' }}>
                      {formatPayload(entry.data)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ── Clear confirmation modal ── */}
      {showClearModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowClearModal(false)}>
          <div style={{
            backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)',
            padding: '24px', maxWidth: '400px', width: '90%',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
              Clear all log entries?
            </div>
            <div style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>
              {entries.length} entries will be removed from the debug log file.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button className="q-press" onClick={() => setShowClearModal(false)}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
                  backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '15px', fontFamily: 'var(--font-interface)',
                }}>Cancel</button>
              <div style={{ width: '8px' }} />
              <button className="q-press" onClick={async () => { await onClearLog?.(); setShowClearModal(false) }}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer',
                  backgroundColor: 'var(--q-accent-success)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)',
                }}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}