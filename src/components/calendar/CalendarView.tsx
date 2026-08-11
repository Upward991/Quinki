import React, { useState, useEffect, useCallback } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Bot, Play, X, RotateCcw, Trash2, Search, RefreshCw } from '../icons'

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'var(--q-accent-calendar)',
  off: 'var(--q-text-tertiary)',
  queued: 'var(--q-accent-warning)',
  running: 'var(--q-accent-info)',
  completed: 'var(--q-accent-success)',
  failed: 'var(--q-accent-danger)',
  cancelled: 'var(--q-text-tertiary)',
  interrupted: 'var(--q-accent-warning)',
}

const panelStyle: React.CSSProperties = { backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)', padding: '8px', minHeight: 'var(--spacing-header-min)', display: 'flex', alignItems: 'center' }
const btnText: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center', gap: 3 }
const cellBorder = '1px solid var(--q-border)'

function fmtDT(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}
function dayKey(ts: number | null | undefined): string { if (!ts) return '—'; const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
function dayLabel(key: string): string { const p = key.split('-'); if (p.length !== 3) return key; return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }
function Chip({ color, text }: { color: string; text: string }) {
  return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-interface)', color, border: '1px solid ' + color, backgroundColor: 'transparent', letterSpacing: 0.2, textTransform: 'capitalize', flexShrink: 0 } }, text)
}

function Dropdown({ value, options, onChange, allLabel }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; allLabel: string }) {
  const [open, setOpen] = useState(false)
  const opts = [{ value: 'all', label: allLabel }, ...options]
  const cur = opts.find(o => o.value === value) || opts[0]
  const btnStyle: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }
  return React.createElement('div', { style: { position: 'relative', display: 'inline-block' } }, [
    React.createElement('button', { key: 'b', onClick: () => setOpen(!open), style: btnStyle }, cur.label + (open ? ' ▴' : ' ▾')),
    open ? React.createElement(React.Fragment, { key: 'm' }, [
      React.createElement('div', { key: 'o', style: { position: 'fixed', inset: 0, zIndex: 150 }, onClick: () => setOpen(false) }),
      React.createElement('div', { key: 'd', style: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 151, minWidth: 140, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: 4, display: 'flex', flexDirection: 'column', gap: 2 } },
        opts.map(o => React.createElement('button', { key: o.value, onClick: () => { onChange(o.value); setOpen(false) }, style: { textAlign: 'left', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-interface)', backgroundColor: o.value === value ? 'var(--q-active)' : 'transparent', color: 'var(--q-text)' } }, o.label))),
    ]) : null,
  ])
}

interface Item { id: string; kind: 'sched' | 'exec'; title: string; agent: string; chat: string; status: string; when: number | null; error: string; ex?: any }

const COLS: { key: string; label: string }[] = [
  { key: 'title', label: 'Title' }, { key: 'agent', label: 'Agent' }, { key: 'chat', label: 'Chat' }, { key: 'status', label: 'Status' }, { key: 'when', label: 'When' }, { key: 'error', label: 'Result' }, { key: 'x', label: '' },
]

export function CalendarView(props: { activePanel: string; onSelectPanel: (p: string) => void; agents?: any[]; onOpenSession?: (key: string) => void }) {
  const { call, subscribe } = useSidecarContext()
  const [schedules, setSchedules] = useState<any[]>([])
  const [executions, setExecutions] = useState<any[]>([])
  const [view, setView] = useState<'table' | 'board' | 'calendar'>('table')
  const [sortKey, setSortKey] = useState<string>('when'); const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [q, setQ] = useState(''); const [statusF, setStatusF] = useState('all'); const [chatF, setChatF] = useState('all')
  const [cols, setCols] = useState<string[]>(COLS.map(c => c.key))
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [hoverRow, setHoverRow] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { const a = await call('listSchedules'); const b = await call('listExecutions'); setSchedules(a?.schedules || []); setExecutions(b?.executions || []) } catch {}
  }, [call])
  useEffect(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv) }, [refresh])
  useEffect(() => { const u = subscribe?.('execution_update', refresh); return () => { if (u) try { u() } catch {} } }, [refresh, subscribe])
  useEffect(() => { const u = subscribe?.('schedule_update', refresh); return () => { if (u) try { u() } catch {} } }, [refresh, subscribe])

  const act = useCallback(async (fn: () => Promise<any>) => { try { await fn() } catch {}; await refresh() }, [refresh])

  const items: Item[] = []
  for (const s of schedules || []) items.push({ id: s.id, kind: 'sched', title: s.title || '(untitled)', agent: (s.agentIds || []).join(', ') || '—', chat: s.sourceSession ? (s.sourceSession.label || s.sourceSession.key) : '—', status: s.enabled ? 'scheduled' : 'off', when: s.nextFireAt || (s.lastFiredAt ? s.lastFiredAt : null), error: '', ex: undefined })
  for (const ex of executions || []) items.push({ id: ex.id, kind: 'exec', title: ex.label || ex.id, agent: (ex.agentIds || []).join(', ') || '—', chat: '—', status: ex.status || '?', when: ex.scheduledFor || ex.createdAt || null, error: ex.error ? String(ex.error).slice(0, 60) : '', ex })

  const chats = Array.from(new Set(items.map(i => i.chat).filter(c => c && c !== '—')))
  let filtered = items.filter(i => {
    if (q && !(i.title + ' ' + i.agent + ' ' + i.chat).toLowerCase().includes(q.toLowerCase())) return false
    if (statusF !== 'all') { const b = i.status === 'scheduled' || i.status === 'off' ? 'scheduled' : i.status === 'running' || i.status === 'queued' || i.status === 'interrupted' ? 'running' : i.status === 'completed' ? 'completed' : 'failed'; if (b !== statusF) return false }
    if (chatF !== 'all' && i.chat !== chatF) return false
    return true
  })
  const cmp = (a: Item, b: Item) => { let av: any = (a as any)[sortKey], bv: any = (b as any)[sortKey]; if (typeof av === 'string') av = av.toLowerCase(); if (typeof bv === 'string') bv = bv.toLowerCase(); if (av == null) av = ''; if (bv == null) bv = ''; return av < bv ? -1 * sortDir : av > bv ? 1 * sortDir : 0 }
  filtered = [...filtered].sort(cmp)

  const actions = (i: Item) => {
    const b: React.ReactNode[] = []
    if (i.kind === 'sched') {
      if (i.status === 'scheduled') b.push(React.createElement('button', { key: 'run', style: btnText, title: 'Run now', onClick: () => act(async () => { await call('runScheduleNow', { id: i.id }) }) }, React.createElement(Play, { size: 12 })))
      b.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteSchedule', { id: i.id }) }) }, React.createElement(Trash2, { size: 12 })))
    } else {
      if (i.status === 'running' || i.status === 'queued') b.push(React.createElement('button', { key: 'stop', style: btnText, title: 'Stop', onClick: () => act(async () => { await call('stopExecution', { executionId: i.id }) }) }, React.createElement(X, { size: 12 })))
      if (i.status === 'interrupted') b.push(React.createElement('button', { key: 'res', style: btnText, title: 'Resume', onClick: () => act(async () => { await call('resumeExecution', { executionId: i.id }) }) }, React.createElement(RotateCcw, { size: 12 })))
      if (i.status === 'failed' || i.status === 'cancelled') b.push(React.createElement('button', { key: 'retry', style: btnText, title: 'Retry', onClick: () => act(async () => { if (i.ex?.scheduleId) await call('runScheduleNow', { id: i.ex.scheduleId }); else await call('runTask', { label: i.ex.label, agentIds: i.ex.agentIds, workingDir: i.ex.workingDir, mode: i.ex.mode, model: i.ex.model, text: i.ex.text }) }) }, React.createElement(RotateCcw, { size: 12 })))
      b.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteExecution', { executionId: i.id }) }) }, React.createElement(Trash2, { size: 12 })))
    }
    return React.createElement('div', { key: 'acts', style: { display: 'flex', gap: 4, justifyContent: 'flex-end' } }, b)
  }

  const cellVal = (i: Item, key: string): React.ReactNode => {
    if (key === 'title') return i.title
    if (key === 'agent') return i.agent
    if (key === 'chat') return i.chat
    if (key === 'status') return React.createElement(Chip, { color: STATUS_COLOR[i.status] || 'var(--q-text-tertiary)', text: i.status || '?' })
    if (key === 'when') return fmtDT(i.when)
    if (key === 'error') return React.createElement('span', { style: { color: 'var(--q-accent-danger)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, i.error)
    if (key === 'x') return actions(i)
    return ''
  }
  const cellStyle = (align = 'left', rightBorder = true): React.CSSProperties => ({ padding: '7px 10px', borderBottom: '1px solid var(--q-border)', borderRight: rightBorder ? '1px solid var(--q-border)' : 'none', color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)', textAlign: align as any, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 })

  // === TABLE ===
  const thead = React.createElement('tr', { key: 'thr' }, cols.map((k, idx) => {
    const c = COLS.find(x => x.key === k)
    const sortable = k !== 'x'
    return React.createElement('th', {
      key: k, draggable: true, onDragStart: (e: any) => { setDragCol(k); e.dataTransfer.effectAllowed = 'move' }, onDragOver: (e: any) => { e.preventDefault() },
      onDrop: (e: any) => { e.preventDefault(); if (!dragCol || dragCol === k) { setDragCol(null); return } setCols(prev => { const arr = [...prev]; const from = arr.indexOf(dragCol); const to = arr.indexOf(k); arr.splice(from, 1); arr.splice(to, 0, dragCol); return arr }); setDragCol(null) },
      onClick: sortable ? () => { if (sortKey === k) setSortDir(sortDir === 1 ? -1 : 1); else { setSortKey(k); setSortDir(1) } } : undefined,
      style: { padding: '7px 10px', borderBottom: '1px solid var(--q-border)', borderRight: idx < cols.length - 1 ? '1px solid var(--q-border)' : 'none', cursor: sortable ? 'pointer' : 'default', color: 'var(--q-text-secondary)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', userSelect: 'none', background: dragCol === k ? 'var(--q-hover)' : 'transparent' },
    }, c ? c.label : '')
  }))
  const tbody = filtered.map(i => React.createElement('tr', { key: i.id, onMouseEnter: () => setHoverRow(i.id), onMouseLeave: () => setHoverRow(null), style: { backgroundColor: hoverRow === i.id ? 'var(--q-hover)' : 'transparent', transition: 'none' } }, cols.map((k, idx) => {
    const isHov = hoverRow === i.id
    const cell = cellVal(i, k)
    return React.createElement('td', { key: k, style: { ...cellStyle('left', idx < cols.length - 1), maxWidth: k === 'x' ? undefined : 220, opacity: k === 'x' ? (isHov ? 1 : 0) : 1 } }, k === 'x' && !isHov ? React.createElement('span', {}, ' ') : cell)
  })))
  const tableWrap = React.createElement('div', { key: 'tbl', style: { width: '100%', overflowX: 'auto' } }, React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 720 } }, [
    React.createElement('thead', { key: 'th' }, thead),
    React.createElement('tbody', { key: 'tb' }, tbody.length ? tbody : React.createElement('tr', { key: 'e' }, React.createElement('td', { colSpan: cols.length, style: { padding: 20, textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', border: 'none' } }, 'No activities match the filters.'))),
  ]))

  // === BOARD ===
  const groups: { key: string; label: string; color: string; items: Item[] }[] = [
    { key: 'scheduled', label: 'Scheduled', color: 'var(--q-accent-calendar)', items: [] },
    { key: 'running', label: 'Running', color: 'var(--q-accent-info)', items: [] },
    { key: 'completed', label: 'Completed', color: 'var(--q-accent-success)', items: [] },
    { key: 'failed', label: 'Failed', color: 'var(--q-accent-danger)', items: [] },
  ]
  for (const i of filtered) { const b = i.status === 'scheduled' || i.status === 'off' ? 'scheduled' : i.status === 'running' || i.status === 'queued' || i.status === 'interrupted' ? 'running' : i.status === 'completed' ? 'completed' : 'failed'; const g = groups.find(x => x.key === b); if (g) g.items.push(i) }
  const board = React.createElement('div', { key: 'bd', style: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start', flex: 1, minHeight: 0 } }, groups.map(g => React.createElement('div', { key: g.key, style: { flex: '1 1 220px', minWidth: 200, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--q-border)', display: 'flex', flexDirection: 'column', maxHeight: '100%' } }, [
    React.createElement('div', { key: 'h', style: { padding: '8px 10px', color: 'var(--q-text)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-interface)', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', gap: 6 } }, [React.createElement('span', { style: { width: 8, height: 8, borderRadius: 4, backgroundColor: g.color } }), g.label, React.createElement('span', { style: { color: 'var(--q-text-tertiary)' } }, '(' + g.items.length + ')')]),
    React.createElement('div', { key: 'l', style: { padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 } }, g.items.length ? g.items.map(i => React.createElement('div', { key: i.id, style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 } }, [
      React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, i.title),
      React.createElement('div', { key: 'a', style: { color: 'var(--q-text-secondary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, 'agent: ' + i.agent),
      i.chat !== '—' ? React.createElement('div', { key: 'c', style: { color: 'var(--q-text-secondary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, 'chat: ' + i.chat) : null,
      React.createElement('div', { key: 'w', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, fmtDT(i.when)),
      i.error ? React.createElement('div', { key: 'e', style: { color: 'var(--q-accent-danger)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, i.error) : null,
      React.createElement('div', { key: 'x', style: { display: 'flex', justifyContent: 'flex-end', marginTop: 2 } }, actions(i)),
    ])) : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: 8 } }, '—')),
  ])))

  // === CALENDAR (per giorno) ===
  const byDay: Record<string, Item[]> = {}
  for (const i of filtered) { const k = dayKey(i.when); if (!byDay[k]) byDay[k] = []; byDay[k].push(i) }
  const dayKeys = Object.keys(byDay).sort()
  const cal = React.createElement('div', { key: 'cv', style: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 } }, dayKeys.length ? dayKeys.map(k => React.createElement('div', { key: k }, [
    React.createElement('div', { key: 'h', style: { color: 'var(--q-text)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-interface)', marginBottom: 6 } }, dayLabel(k)),
    React.createElement('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, byDay[k].map(i => React.createElement('div', { key: i.id, style: { display: 'flex', alignItems: 'center', gap: 10, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', padding: '8px 10px' } }, [
      React.createElement(Chip, { key: 's', color: STATUS_COLOR[i.status] || 'var(--q-text-tertiary)', text: i.status || '?' }),
      React.createElement('div', { key: 'm', style: { flex: 1, minWidth: 0 } }, [
        React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, i.title),
        React.createElement('div', { key: 'd', style: { color: 'var(--q-text-secondary)', fontSize: 11, fontFamily: 'var(--font-interface)', marginTop: 1 } }, fmtDT(i.when) + ' · agent: ' + i.agent + (i.chat !== '—' ? ' · ' + i.chat : '')),
      ]),
      actions(i),
    ]))),
  ])) : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' } }, 'No activities.'))

  // === DATABASE TOOLBAR (dentro il database, stile Notion) ===
  const viewTab = (v: 'table' | 'board' | 'calendar', label: string) => React.createElement('button', {
    key: v, onClick: () => setView(v),
    style: { padding: '5px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: 'none', fontSize: 12, fontWeight: view === v ? 700 : 500, fontFamily: 'var(--font-interface)', backgroundColor: view === v ? 'var(--q-active)' : 'transparent', color: view === v ? 'var(--q-text)' : 'var(--q-text-secondary)', transition: 'none' },
  }, label)
  const selectStyle: React.CSSProperties = { height: 28, padding: '0 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: 'pointer' }

  const dbToolbar = React.createElement('div', { key: 'tb', style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--q-border-strong)', flexWrap: 'wrap' } }, [
    viewTab('table', 'Table'), viewTab('board', 'Board'), viewTab('calendar', 'Calendar'),
    React.createElement('span', { key: 'grow', style: { flex: 1 } }),
    React.createElement('div', { key: 'search', style: { display: 'flex', alignItems: 'center', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--q-bg-elevated)', paddingLeft: 8 } }, [
      React.createElement(Search, { size: 13, style: { color: 'var(--q-text-tertiary)' } }),
      React.createElement('input', { value: q, onChange: (e: any) => setQ(e.target.value), placeholder: 'Search...', style: { background: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 8px', width: 130 } }),
    ]),
    React.createElement(Dropdown, { key: 'st', value: statusF, allLabel: 'Status: all', options: ['scheduled', 'running', 'completed', 'failed'].map(s => ({ value: s, label: s })), onChange: setStatusF }),
    React.createElement(Dropdown, { key: 'ch', value: chatF, allLabel: 'Chat: all', options: chats.map(c => ({ value: c, label: c })), onChange: setChatF }),
    React.createElement('button', { key: 'refresh', onClick: () => act(async () => {}), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', padding: 4, display: 'flex' } }, React.createElement(RefreshCw, { size: 14 })),
  ])

  const dbPanel = React.createElement('div', { key: 'db', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, [
    dbToolbar,
    React.createElement('div', { key: 'content', style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' } }, view === 'table' ? tableWrap : view === 'board' ? board : cal),
  ])

  // === APP HEADER (solo Home + titolo, come le altre tab) ===
  const IconBtn = ({ icon: Icon, onClick }: { icon: React.FC<any>; onClick: () => void }) => {
    const [h, setH] = useState(false)
    return React.createElement('button', { onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', padding: '0', backgroundColor: h ? 'var(--q-hover)' : 'transparent', color: h ? 'var(--q-text)' : 'var(--q-text-secondary)', transition: 'none' } }, React.createElement(Icon, { size: 20 }))
  }

  return React.createElement('div', { className: 'h-full flex flex-col', style: { width: '100%', position: 'relative', overflow: 'hidden' } }, [
    React.createElement('div', { key: 'hdr', style: { marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, width: '100%' } }, [
      React.createElement('div', { key: 'h1', style: panelStyle }, [React.createElement(IconBtn, { key: 'home', icon: Home, onClick: () => props.onSelectPanel('home') })]),
      React.createElement('div', { key: 'h2', style: { ...panelStyle, flex: 1 } }, [
        React.createElement('div', { key: 'sp', style: { width: '8px', flexShrink: 0 } }),
        React.createElement(Bot, { key: 'ic', size: 18, style: { color: 'var(--q-text-secondary)', flexShrink: 0 } }),
        React.createElement('div', { key: 'sp2', style: { width: '12px', flexShrink: 0 } }),
        React.createElement('span', { key: 'ti', style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Agents Tasks'),
      ]),
    ]),
    React.createElement('div', { key: 'body', style: { flex: 1, minHeight: 0, padding: '0 0 8px 0', display: 'flex', justifyContent: 'center' } }, [React.createElement('div', { key: 'dbwrap', style: { width: '100%', display: 'flex', flexDirection: 'column' } }, [dbPanel])]),
  ])
}