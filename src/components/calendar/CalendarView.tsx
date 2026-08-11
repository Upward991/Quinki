import React, { useState, useEffect, useCallback } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Calendar, Play, X, RotateCcw, Trash2, Search, RefreshCw, Bot, Clock } from '../icons'

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
const btnGhost: React.CSSProperties = { padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-text)', fontSize: '12px', fontFamily: 'var(--font-interface)', cursor: 'pointer', transition: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, height: 28 }
const btnText: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center', gap: 3 }

function fmtDT(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
function dayKey(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function dayLabel(key: string): string {
  const p = key.split('-'); if (p.length !== 3) return key
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function statusLabel(st: string): string { return st || '?' }
function Chip({ color, text }: { color: string; text: string }) {
  return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-interface)', color, border: '1px solid ' + color, backgroundColor: 'transparent', letterSpacing: 0.2, textTransform: 'capitalize', flexShrink: 0 } }, text)
}

interface Item {
  id: string
  kind: 'sched' | 'exec'
  title: string
  agent: string
  chat: string
  status: string
  when: number | null
  error: string
  sched?: any
  ex?: any
}

export function CalendarView(props: { activePanel: string; onSelectPanel: (p: string) => void; agents?: any[]; onOpenSession?: (key: string) => void }) {
  const { call, subscribe } = useSidecarContext()
  const [schedules, setSchedules] = useState<any[]>([])
  const [executions, setExecutions] = useState<any[]>([])
  const [view, setView] = useState<'table' | 'board' | 'calendar'>('table')
  const [sortKey, setSortKey] = useState<string>('when')
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [chatF, setChatF] = useState('all')

  const refresh = useCallback(async () => {
    try {
      const a = await call('listSchedules'); const b = await call('listExecutions')
      setSchedules(a?.schedules || []); setExecutions(b?.executions || [])
    } catch {}
  }, [call])
  useEffect(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv) }, [refresh])
  useEffect(() => { const u = subscribe?.('execution_update', refresh); return () => { if (u) try { u() } catch {} } }, [refresh, subscribe])
  useEffect(() => { const u = subscribe?.('schedule_update', refresh); return () => { if (u) try { u() } catch {} } }, [refresh, subscribe])

  const act = useCallback(async (fn: () => Promise<any>) => { try { await fn() } catch {}; await refresh() }, [refresh])

  // Unifica schedule + execution in un'unica lista attività
  const items: Item[] = []
  for (const s of schedules || []) {
    items.push({
      id: s.id, kind: 'sched',
      title: s.title || '(untitled)',
      agent: (s.agentIds || []).join(', ') || '—',
      chat: s.sourceSession ? (s.sourceSession.label || s.sourceSession.key) : '—',
      status: s.enabled ? 'scheduled' : 'off',
      when: s.nextFireAt || (s.lastFiredAt ? s.lastFiredAt : null),
      error: '',
      sched: s,
    })
  }
  for (const ex of executions || []) {
    items.push({
      id: ex.id, kind: 'exec',
      title: ex.label || ex.id,
      agent: (ex.agentIds || []).join(', ') || '—',
      chat: '—',
      status: ex.status || '?',
      when: ex.scheduledFor || ex.createdAt || null,
      error: ex.error ? String(ex.error).slice(0, 60) : '',
      ex,
    })
  }

  // Filtri
  const chats = Array.from(new Set(items.map(i => i.chat).filter(c => c && c !== '—')))
  let filtered = items.filter(i => {
    if (q && !(i.title + ' ' + i.agent + ' ' + i.chat).toLowerCase().includes(q.toLowerCase())) return false
    if (statusF !== 'all') {
      const bucket = i.status === 'scheduled' || i.status === 'off' ? 'scheduled' : i.status === 'running' || i.status === 'queued' || i.status === 'interrupted' ? 'running' : i.status === 'completed' ? 'completed' : 'failed'
      if (bucket !== statusF) return false
    }
    if (chatF !== 'all' && i.chat !== chatF) return false
    return true
  })
  // Ordinamento
  const cmp = (a: Item, b: Item) => {
    let av: any = (a as any)[sortKey]; let bv: any = (b as any)[sortKey]
    if (typeof av === 'string') av = av.toLowerCase(); if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av == null) av = ''; if (bv == null) bv = ''
    if (av < bv) return -1 * sortDir; if (av > bv) return 1 * sortDir; return 0
  }
  filtered = [...filtered].sort(cmp)

  const toggleSort = (key: string) => { if (sortKey === key) setSortDir(sortDir === 1 ? -1 : 1); else { setSortKey(key); setSortDir(1) } }

  const actions = (i: Item) => {
    const btns: React.ReactNode[] = []
    if (i.kind === 'sched') {
      if (i.status === 'scheduled') btns.push(React.createElement('button', { key: 'run', style: btnText, title: 'Run now', onClick: () => act(async () => { await call('runScheduleNow', { id: i.id }) }) }, React.createElement(Play, { size: 12 })))
      btns.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteSchedule', { id: i.id }) }) }, React.createElement(Trash2, { size: 12 })))
    } else {
      if (i.status === 'running' || i.status === 'queued') btns.push(React.createElement('button', { key: 'stop', style: btnText, title: 'Stop', onClick: () => act(async () => { await call('stopExecution', { executionId: i.id }) }) }, React.createElement(X, { size: 12 })))
      if (i.status === 'interrupted') btns.push(React.createElement('button', { key: 'res', style: btnText, title: 'Resume', onClick: () => act(async () => { await call('resumeExecution', { executionId: i.id }) }) }, React.createElement(RotateCcw, { size: 12 })))
      if (i.status === 'failed' || i.status === 'cancelled') btns.push(React.createElement('button', { key: 'retry', style: btnText, title: 'Retry', onClick: () => act(async () => {
        if (i.ex?.scheduleId) await call('runScheduleNow', { id: i.ex.scheduleId })
        else await call('runTask', { label: i.ex.label, agentIds: i.ex.agentIds, workingDir: i.ex.workingDir, mode: i.ex.mode, model: i.ex.model, text: i.ex.text })
      }) }, React.createElement(RotateCcw, { size: 12 })))
      btns.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteExecution', { executionId: i.id }) }) }, React.createElement(Trash2, { size: 12 })))
    }
    return React.createElement('div', { key: 'acts', style: { display: 'flex', gap: 4, justifyContent: 'flex-end' } }, btns)
  }

  // === VISTA TABELLA ===
  const th = (key: string, label: string, align = 'left') => React.createElement('th', {
    key, onClick: () => toggleSort(key), style: { cursor: 'pointer', textAlign: align as any, padding: '8px 10px', color: 'var(--q-text-secondary)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-interface)', borderBottom: '1px solid var(--q-border-strong)', whiteSpace: 'nowrap', userSelect: 'none' },
  }, label + (sortKey === key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''))
  const tbody: React.ReactNode[] = filtered.map(i => React.createElement('tr', { key: i.id, style: { borderBottom: '1px solid var(--q-border-soft)' } }, [
    React.createElement('td', { key: 't', style: { padding: '8px 10px', color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-interface)' } }, i.title),
    React.createElement('td', { key: 'a', style: { padding: '8px 10px', color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)' } }, i.agent),
    React.createElement('td', { key: 'c', style: { padding: '8px 10px', color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)' } }, i.chat),
    React.createElement('td', { key: 's', style: { padding: '8px 10px' } }, React.createElement(Chip, { color: STATUS_COLOR[i.status] || 'var(--q-text-tertiary)', text: statusLabel(i.status) })),
    React.createElement('td', { key: 'w', style: { padding: '8px 10px', color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' } }, fmtDT(i.when)),
    React.createElement('td', { key: 'e', style: { padding: '8px 10px', color: 'var(--q-accent-danger)', fontSize: 11, fontFamily: 'var(--font-interface)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, i.error),
    React.createElement('td', { key: 'x', style: { padding: '8px 10px' } }, actions(i)),
  ]))
  const tableView = React.createElement('div', { key: 'tv', style: { width: '100%', overflow: 'auto', border: '1px solid var(--q-border-strong)', borderRadius: 'var(--radius-lg)' } }, React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } }, [
    React.createElement('thead', { key: 'th' }, React.createElement('tr', { key: 'tr' }, [th('title', 'Title'), th('agent', 'Agent'), th('chat', 'Chat'), th('status', 'Status'), th('when', 'When'), th('error', 'Result'), th('x', '', 'right')])),
    React.createElement('tbody', { key: 'tb' }, tbody.length ? tbody : React.createElement('tr', { key: 'e' }, React.createElement('td', { colSpan: 7, style: { padding: 20, textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' } }, 'No activities match the filters.'))),
  ]))

  // === VISTA BOARD ===
  const groups: { key: string; label: string; color: string; items: Item[] }[] = [
    { key: 'scheduled', label: 'Scheduled', color: 'var(--q-accent-calendar)', items: [] },
    { key: 'running', label: 'Running', color: 'var(--q-accent-info)', items: [] },
    { key: 'completed', label: 'Completed', color: 'var(--q-accent-success)', items: [] },
    { key: 'failed', label: 'Failed', color: 'var(--q-accent-danger)', items: [] },
  ]
  for (const i of filtered) {
    const bucket = i.status === 'scheduled' || i.status === 'off' ? 'scheduled' : i.status === 'running' || i.status === 'queued' || i.status === 'interrupted' ? 'running' : i.status === 'completed' ? 'completed' : 'failed'
    const g = groups.find(x => x.key === bucket); if (g) g.items.push(i)
  }
  const boardView = React.createElement('div', { key: 'bv', style: { display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minHeight: 0, overflowX: 'auto' } },
    groups.map(g => React.createElement('div', { key: g.key, style: { width: 250, flexShrink: 0, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--q-border)', display: 'flex', flexDirection: 'column', maxHeight: '100%' } }, [
      React.createElement('div', { key: 'h', style: { padding: '8px 10px', color: 'var(--q-text)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-interface)', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', gap: 6 } }, [React.createElement('span', { style: { width: 8, height: 8, borderRadius: 4, backgroundColor: g.color } }), g.label, React.createElement('span', { style: { color: 'var(--q-text-tertiary)' } }, '(' + g.items.length + ')')]),
      React.createElement('div', { key: 'l', style: { padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 } },
        g.items.length ? g.items.map(i => React.createElement('div', { key: i.id, style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 } }, [
          React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, i.title),
          React.createElement('div', { key: 'a', style: { color: 'var(--q-text-secondary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, 'agent: ' + i.agent),
          i.chat !== '—' ? React.createElement('div', { key: 'c', style: { color: 'var(--q-text-secondary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, 'chat: ' + i.chat) : null,
          React.createElement('div', { key: 'w', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, fmtDT(i.when)),
          i.error ? React.createElement('div', { key: 'e', style: { color: 'var(--q-accent-danger)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, i.error) : null,
          React.createElement('div', { key: 'x', style: { display: 'flex', justifyContent: 'flex-end', marginTop: 2 } }, actions(i)),
        ])) : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: 8 } }, '—'),
      ),
    ]))

  // === VISTA CALENDARIO (per giorno) ===
  const byDay: Record<string, Item[]> = {}
  for (const i of filtered) { const k = dayKey(i.when); if (!byDay[k]) byDay[k] = []; byDay[k].push(i) }
  const dayKeys = Object.keys(byDay).sort()
  const calView = React.createElement('div', { key: 'cv', style: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 } },
    dayKeys.length ? dayKeys.map(k => React.createElement('div', { key: k }, [
      React.createElement('div', { key: 'h', style: { color: 'var(--q-text)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-interface)', marginBottom: 6 } }, dayLabel(k)),
      React.createElement('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        byDay[k].map(i => React.createElement('div', { key: i.id, style: { display: 'flex', alignItems: 'center', gap: 10, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', padding: '8px 10px' } }, [
          React.createElement(Chip, { key: 's', color: STATUS_COLOR[i.status] || 'var(--q-text-tertiary)', text: statusLabel(i.status) }),
          React.createElement('div', { key: 'm', style: { flex: 1, minWidth: 0 } }, [
            React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, i.title),
            React.createElement('div', { key: 'd', style: { color: 'var(--q-text-secondary)', fontSize: 11, fontFamily: 'var(--font-interface)', marginTop: 1 } }, fmtDT(i.when) + ' · agent: ' + i.agent + (i.chat !== '—' ? ' · ' + i.chat : '')),
          ]),
          actions(i),
        ]))),
    ])) : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' } }, 'No activities.'))

  // === HEADER ===
  const IconBtn = ({ icon: Icon, onClick }: { icon: React.FC<any>; onClick: () => void }) => {
    const [h, setH] = useState(false)
    return React.createElement('button', { onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', padding: '0', backgroundColor: h ? 'var(--q-hover)' : 'transparent', color: h ? 'var(--q-text)' : 'var(--q-text-secondary)', transition: 'none' } }, React.createElement(Icon, { size: 20 }))
  }
  const modeBtn = (v: 'table' | 'board' | 'calendar') => {
    const active = view === v
    const radius = v === 'table' ? 'var(--radius-sm) 0 0 var(--radius-sm)' : v === 'board' ? '0' : '0 var(--radius-sm) var(--radius-sm) 0'
    return { cursor: 'pointer', height: 28, padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-interface)', backgroundColor: active ? 'var(--q-accent-calendar)' : 'transparent', color: active ? 'var(--q-bg)' : 'var(--q-text)', fontWeight: active ? 600 : 500, borderRadius: radius, transition: 'none', border: '1px solid var(--q-border)', borderRight: v === 'calendar' ? '1px solid var(--q-border)' : 'none' }
  }
  const selectStyle: React.CSSProperties = { height: 28, padding: '0 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: 'pointer' }

  const headerKids: React.ReactNode[] = [
    React.createElement('div', { key: 'h1', style: panelStyle }, [React.createElement(IconBtn, { key: 'home', icon: Home, onClick: () => props.onSelectPanel('home') })]),
    React.createElement('div', { key: 'sp1', style: { width: '8px', flexShrink: 0 } }),
    React.createElement('div', { key: 'h2', style: { ...panelStyle, flex: 1, minWidth: 0 } }, [
      React.createElement('div', { key: 'sp0', style: { width: '8px', flexShrink: 0 } }),
      React.createElement(Bot, { key: 'ic', size: 18, style: { color: 'var(--q-text-secondary)', flexShrink: 0 } }),
      React.createElement('div', { key: 'sp0b', style: { width: '12px', flexShrink: 0 } }),
      React.createElement('span', { key: 'ti', style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' } }, 'Tasks'),
      React.createElement('div', { key: 'sp2', style: { width: '8px', flexShrink: 0 } }),
      React.createElement('span', { key: 'ct', style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } }, '(' + filtered.length + ')'),
      React.createElement('div', { key: 'fx', style: { flex: 1 } }),
      React.createElement('button', { key: 'tb', onClick: () => setView('table'), style: modeBtn('table') }, 'Table'),
      React.createElement('button', { key: 'bd', onClick: () => setView('board'), style: modeBtn('board') }, 'Board'),
      React.createElement('button', { key: 'cl', onClick: () => setView('calendar'), style: modeBtn('calendar') }, 'Calendar'),
      React.createElement('div', { key: 'sp3', style: { width: '10px', flexShrink: 0 } }),
      React.createElement('div', { key: 'search', style: { display: 'flex', alignItems: 'center', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--q-bg-elevated)', paddingLeft: 8 } }, [
        React.createElement(Search, { size: 13, style: { color: 'var(--q-text-tertiary)' } }),
        React.createElement('input', { value: q, onChange: (e: any) => setQ(e.target.value), placeholder: 'Search...', style: { background: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 8px', width: 140 } }),
      ]),
      React.createElement('div', { key: 'sp4', style: { width: '8px', flexShrink: 0 } }),
      React.createElement('select', { value: statusF, onChange: (e: any) => setStatusF(e.target.value), style: selectStyle }, ['all', 'scheduled', 'running', 'completed', 'failed'].map(s => React.createElement('option', { key: s, value: s }, s === 'all' ? 'Status: all' : s))),
      React.createElement('div', { key: 'sp5', style: { width: '8px', flexShrink: 0 } }),
      React.createElement('select', { value: chatF, onChange: (e: any) => setChatF(e.target.value), style: selectStyle }, [
        React.createElement('option', { key: 'all', value: 'all' }, 'Chat: all'),
        ...chats.map(c => React.createElement('option', { key: c, value: c }, c)),
      ]),
      React.createElement('div', { key: 'sp6', style: { width: '8px', flexShrink: 0 } }),
      React.createElement('button', { key: 'refresh', onClick: () => act(async () => {}), style: btnGhost }, React.createElement(RefreshCw, { size: 13 })),
    ]),
  ]

  return React.createElement('div', { className: 'h-full flex flex-col', style: { width: '100%', position: 'relative', overflow: 'hidden' } }, [
    React.createElement('div', { key: 'hdr', style: { marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', width: '100%' } }, headerKids),
    React.createElement('div', { key: 'body', className: 'q-scroll', style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 8px 8px', display: 'flex', flexDirection: 'column' } }, [
      view === 'table' ? tableView : view === 'board' ? boardView : calView,
    ]),
  ])
}