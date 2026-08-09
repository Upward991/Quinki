import React, { useState, useEffect, useCallback } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Calendar, Clock, Play, X, RotateCcw, Trash2, Bot, PanelLeft, ChevronLeft, ChevronRight, ChevronDown } from '../icons'

const STATUS_COLOR: Record<string, string> = {
  queued: 'var(--q-accent-warning)',
  running: 'var(--q-accent-info)',
  completed: 'var(--q-accent-success)',
  failed: 'var(--q-accent-danger)',
  cancelled: 'var(--q-text-tertiary)',
  interrupted: 'var(--q-accent-warning)',
  missed: 'var(--q-text-tertiary)',
}
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const panelStyle: React.CSSProperties = {
  backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)',
  padding: '8px', minHeight: 'var(--spacing-header-min)', display: 'flex', alignItems: 'center',
}
const btnGhost: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)',
  backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
  cursor: 'pointer', transition: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, height: 28,
}
const btnText: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
  cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center', gap: 3,
}

function fmtWhen(s: any): string {
  const w = s.when || {}
  if (w.type === 'once') return w.date ? new Date(w.date).toLocaleString() : 'Once'
  if (w.type === 'daily') return 'Daily at ' + (w.at || '08:00')
  if (w.type === 'weekly') return 'Weekly ' + (w.at || '08:00') + ' · ' + (w.daysOfWeek || []).map((d: number) => WEEK[(d - 1 + 7) % 7]).join(' ')
  if (w.type === 'monthly') return 'Monthly · day ' + (w.dayOfMonth ?? 1) + ' at ' + (w.at || '08:00')
  return w.type || '?'
}
function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
function dayKey(ts: number): string {
  const d = new Date(ts)
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate()
}
function Chip({ color, text }: { color: string; text: string }) {
  return React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
      fontFamily: 'var(--font-interface)', color, border: '1px solid ' + color, backgroundColor: 'transparent',
      letterSpacing: 0.2, textTransform: 'capitalize', flexShrink: 0,
    },
  }, text)
}

function DayCell(props: {
  date: Date; inMonth: boolean; showDays: boolean;
  sched: any[]; exec: any[]; dragId: string | null;
  onDragStart: (e: any, id: string) => void; onDragEnd: () => void; onDrop: (e: any) => void;
}) {
  const d = props.date
  const isToday = dayKey(d.getTime()) === dayKey(Date.now())
  const kids: React.ReactNode[] = [
    React.createElement('div', { key: 'n', style: { color: isToday ? 'var(--q-accent-calendar)' : 'var(--q-text-secondary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, d.getDate()),
  ]
  for (const s of props.sched) {
    kids.push(React.createElement('div', {
      key: s.id, draggable: true,
      onDragStart: (e: any) => props.onDragStart(e, s.id),
      onDragEnd: props.onDragEnd,
      title: s.title + ' · ' + fmtWhen(s),
      style: {
        display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 6,
        backgroundColor: 'color-mix(in srgb, var(--q-accent-calendar) 14%, transparent)',
        border: '1px solid var(--q-accent-calendar)', color: 'var(--q-text)', fontSize: 11, fontFamily: 'var(--font-interface)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'grab',
      },
    }, s.title || '(untitled)'))
  }
  for (const ex of props.exec) {
    const col = STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)'
    kids.push(React.createElement('div', {
      key: ex.id, title: ex.label + ' · ' + ex.status,
      style: {
        display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 6,
        backgroundColor: 'color-mix(in srgb, ' + col + ' 14%, transparent)',
        border: '1px solid ' + col, color: 'var(--q-text)', fontSize: 11, fontFamily: 'var(--font-interface)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
    }, ex.label || ex.id))
  }
  return React.createElement('div', {
    onDragOver: (e: any) => e.preventDefault(),
    onDrop: props.onDrop,
    style: {
      minHeight: 88, padding: 5, borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 3,
      backgroundColor: isToday ? 'var(--q-active)' : 'transparent',
      border: '1px solid ' + (isToday ? 'var(--q-accent-calendar)' : 'var(--q-border-soft)'),
      opacity: (props.inMonth || props.showDays) ? 1 : 0.4, transition: 'none',
    },
  }, kids)
}

export function CalendarView(props: { activePanel: string; onSelectPanel: (p: string) => void; agents?: any[]; onOpenSession?: (key: string) => void }) {
  const { call } = useSidecarContext()
  const [schedules, setSchedules] = useState<any[]>([])
  const [executions, setExecutions] = useState<any[]>([])
  const [view, setView] = useState(new Date())
  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [dragId, setDragId] = useState<string | null>(null)
  const [showTodo, setShowTodo] = useState(true)
  const [openSched, setOpenSched] = useState(true)
  const [openExec, setOpenExec] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const a = await call('listSchedules')
      const b = await call('listExecutions')
      setSchedules(a?.schedules || [])
      setExecutions(b?.executions || [])
    } catch {}
  }, [call])

  useEffect(() => { refresh(); const iv = setInterval(refresh, 2000); return () => clearInterval(iv) }, [refresh])

  const act = useCallback(async (fn: () => Promise<any>) => {
    try { await fn() } catch {}
    await refresh()
  }, [refresh])

  const year = view.getFullYear()
  const month = view.getMonth()

  const schedByDay: Record<string, any[]> = {}
  const execByDay: Record<string, any[]> = {}
  for (const s of schedules) {
    const k = s.nextFireAt ? dayKey(s.nextFireAt) : (s.lastFiredAt ? dayKey(s.lastFiredAt) : null)
    if (k) { if (!schedByDay[k]) schedByDay[k] = []; schedByDay[k].push(s) }
  }
  for (const ex of executions) {
    const k = dayKey(ex.scheduledFor || ex.createdAt)
    if (!execByDay[k]) execByDay[k] = []
    execByDay[k].push(ex)
  }

  const moveSchedule = async (id: string, target: Date) => {
    const s = schedules.find((x: any) => x.id === id)
    if (!s) return
    const when = { ...(s.when || {}) }
    const t = new Date(target)
    if (when.type === 'once') {
      const cur = when.date ? new Date(when.date) : new Date()
      t.setHours(cur.getHours(), cur.getMinutes(), 0, 0)
      when.date = t.toISOString()
    } else if (when.type === 'weekly') {
      const js = t.getDay()
      when.daysOfWeek = [js === 0 ? 7 : js]
    } else if (when.type === 'monthly') {
      when.dayOfMonth = t.getDate()
    } else {
      return
    }
    await act(async () => { await call('updateSchedule', { id, when }) })
  }

  const onDropOnDay = (e: React.DragEvent, target: Date) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/quinki-schedule')
    if (id) moveSchedule(id, target)
    setDragId(null)
  }
  const makeDay = (d: Date, inMonth: boolean, showDays: boolean) => {
    const k = dayKey(d.getTime())
    return React.createElement(DayCell, {
      key: k, date: d, inMonth, showDays, dragId,
      sched: schedByDay[k] || [], exec: execByDay[k] || [],
      onDragStart: (e: any, id: string) => { e.dataTransfer.setData('text/quinki-schedule', id); setDragId(id) },
      onDragEnd: () => setDragId(null),
      onDrop: (e: any) => onDropOnDay(e, d),
    })
  }

  let calendarGrid: React.ReactElement
  if (mode === 'month') {
    const first = new Date(year, month, 1)
    const startOffset = (first.getDay() + 6) % 7
    const gridStart = new Date(year, month, 1 - startOffset)
    const cells: React.ReactElement[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
      cells.push(makeDay(d, d.getMonth() === month, false))
    }
    calendarGrid = React.createElement('div', { key: 'g', style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, flex: 1 } }, cells)
  } else {
    const dow = (view.getDay() + 6) % 7
    const weekStart = new Date(year, month, view.getDate() - dow)
    const cells: React.ReactElement[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)
      cells.push(React.createElement('div', { key: 'wk' + i, style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } }, [
        React.createElement('div', { key: 'w', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', textAlign: 'center', padding: 4 } }, WEEK[i]),
        React.createElement('div', { key: 'd', style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 } }, makeDay(d, true, true)),
      ]))
    }
    calendarGrid = React.createElement('div', { key: 'g', style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, flex: 1, minHeight: 320 } }, cells)
  }

  const navSched = (dir: number) => {
    const d = new Date(view)
    if (mode === 'month') d.setMonth(d.getMonth() + dir)
    else d.setDate(d.getDate() + dir * 7)
    setView(d)
  }

  // To-do rows
  const schedRows: React.ReactElement[] = []
  for (const s of schedules) {
    if (!s.enabled && !s.lastFiredAt) continue
    const row: React.ReactNode[] = [
      React.createElement('div', { key: 'dot', style: { width: 8, height: 8, borderRadius: 4, flexShrink: 0, backgroundColor: s.enabled ? 'var(--q-accent-calendar)' : 'var(--q-text-tertiary)', marginTop: 5 } }),
      React.createElement('div', { key: 'mid', style: { flex: 1, minWidth: 0 } }, [
        React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.title || '(untitled)'),
        React.createElement('div', { key: 'd', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)', marginTop: 1 } }, fmtWhen(s)),
      ]),
    ]
    if (s.enabled) {
      row.push(React.createElement('button', { key: 'run', style: btnText, title: 'Run now', onClick: () => act(async () => { await call('runScheduleNow', { id: s.id }) }) }, React.createElement(Play, { size: 12 })))
    }
    row.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteSchedule', { id: s.id }) }) }, React.createElement(Trash2, { size: 12 })))
    schedRows.push(React.createElement('div', {
      key: s.id, draggable: true,
      onDragStart: (e: any) => { e.dataTransfer.setData('text/quinki-schedule', s.id); setDragId(s.id) },
      onDragEnd: () => setDragId(null),
      style: {
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px',
        backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)',
        border: '1px solid ' + (dragId === s.id ? 'var(--q-accent-calendar)' : 'var(--q-border)'),
        cursor: 'grab', transition: 'none',
      },
    }, row))
  }

  const execRows: React.ReactElement[] = []
  for (const ex of executions.slice(0, 80)) {
    const row: React.ReactNode[] = [
      React.createElement(Chip, { key: 'chip', color: STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)', text: ex.status || '?' }),
      React.createElement('div', { key: 'mid', style: { flex: 1, minWidth: 0 } }, [
        React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ex.label || ex.id),
        React.createElement('div', { key: 'd', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)', marginTop: 1 } },
          (ex.agentIds || []).join(', ') + ' · ' + fmtTime(ex.createdAt) + (ex.error ? ' · ' + String(ex.error).slice(0, 40) : '')),
      ]),
    ]
    if (ex.status === 'running' || ex.status === 'queued') {
      row.push(React.createElement('button', { key: 'stop', style: btnText, title: 'Stop (interrupt, can resume)', onClick: () => act(async () => { await call('stopExecution', { executionId: ex.id }) }) }, React.createElement(X, { size: 12 })))
    }
    if (ex.status === 'interrupted') {
      row.push(React.createElement('button', { key: 'res', style: btnText, title: 'Resume', onClick: () => act(async () => { await call('resumeExecution', { executionId: ex.id }) }) }, React.createElement(RotateCcw, { size: 12 })))
    }
    row.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteExecution', { executionId: ex.id }) }) }, React.createElement(Trash2, { size: 12 })))
    execRows.push(React.createElement('div', {
      key: ex.id,
      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', transition: 'none' },
    }, row))
  }

  // To-do floating panel
  const todoPanel = React.createElement('div', {
    style: {
      position: 'absolute', top: 0, bottom: 0, left: 0, width: 300, zIndex: 20,
      backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)',
      border: '1px solid var(--q-border)', padding: '12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto',
    },
  }, [
    React.createElement('div', { key: 'sh', style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }, onClick: () => setOpenSched(!openSched) }, [
      openSched ? React.createElement(ChevronDown, { size: 14, style: { color: 'var(--q-text-secondary)' } }) : React.createElement(ChevronRight, { size: 14, style: { color: 'var(--q-text-secondary)' } }),
      React.createElement(Clock, { size: 14, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', flex: 1 } }, 'Scheduled'),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, '(' + schedules.filter((x: any) => x.enabled).length + ')'),
    ]),
    openSched ? React.createElement('div', { key: 'sl', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      schedRows.length ? schedRows : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 0' } }, 'Nothing scheduled.')) : null,
    React.createElement('div', { key: 'eh', style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }, onClick: () => setOpenExec(!openExec) }, [
      openExec ? React.createElement(ChevronDown, { size: 14, style: { color: 'var(--q-text-secondary)' } }) : React.createElement(ChevronRight, { size: 14, style: { color: 'var(--q-text-secondary)' } }),
      React.createElement(Bot, { size: 14, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', flex: 1 } }, 'Executions'),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, '(' + executions.length + ')'),
    ]),
    openExec ? React.createElement('div', { key: 'el', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      execRows.length ? execRows : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 0' } }, 'No executions yet.')) : null,
  ])

  // Header
  const IconBtn = ({ icon: Icon, onClick, active }: { icon: React.FC<any>; onClick: () => void; active?: boolean }) => {
    const [h, setH] = useState(false)
    return React.createElement('button', {
      onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false),
      style: {
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', padding: '0',
        backgroundColor: (h || active) ? 'var(--q-hover)' : 'transparent',
        color: (h || active) ? 'var(--q-text)' : 'var(--q-text-secondary)',
        transition: 'none',
      },
    }, React.createElement(Icon, { size: 20 }))
  }

  const headerKids: React.ReactNode[] = [
    React.createElement('div', { key: 'h1', style: panelStyle }, [
      React.createElement(IconBtn, { key: 'home', icon: Home, onClick: () => props.onSelectPanel('home') }),
    ]),
    React.createElement('div', { key: 'h2', style: { ...panelStyle, flex: 1, minWidth: 0 } }, [
      React.createElement('div', { key: 'sp0', style: { width: '8px', flexShrink: 0 } }),
      React.createElement(Calendar, { key: 'ic', size: 18, style: { color: 'var(--q-text-secondary)', flexShrink: 0 } }),
      React.createElement('div', { key: 'sp1', style: { width: '12px', flexShrink: 0 } }),
      React.createElement('span', { key: 'ti', style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' } }, 'Agents Calendar'),
      React.createElement('div', { key: 'sp2', style: { width: '8px', flexShrink: 0 } }),
      React.createElement('span', { key: 'live', style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } }, 'live'),
      React.createElement('div', { key: 'fx', style: { flex: 1 } }),
      React.createElement('button', { key: 'mv', style: { cursor: 'pointer', border: '1px solid var(--q-border)', height: 28, padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-interface)', backgroundColor: mode === 'month' ? 'var(--q-accent-calendar)' : 'transparent', color: mode === 'month' ? 'var(--q-bg)' : 'var(--q-text-secondary)', fontWeight: mode === 'month' ? 600 : 400, borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)', transition: 'none' }, onClick: () => setMode('month') }, 'Month'),
      React.createElement('button', { key: 'wk', style: { cursor: 'pointer', border: '1px solid var(--q-border)', borderLeft: 'none', height: 28, padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-interface)', backgroundColor: mode === 'week' ? 'var(--q-accent-calendar)' : 'transparent', color: mode === 'week' ? 'var(--q-bg)' : 'var(--q-text-secondary)', fontWeight: mode === 'week' ? 600 : 400, borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', transition: 'none' }, onClick: () => setMode('week') }, 'Week'),
      React.createElement('div', { key: 'sp3', style: { width: '10px', flexShrink: 0 } }),
      React.createElement('button', { key: 'prev', onClick: () => navSched(-1), style: btnGhost }, React.createElement(ChevronLeft, { size: 14 })),
      React.createElement('button', { key: 'today', onClick: () => setView(new Date()), style: btnGhost }, 'Today'),
      React.createElement('button', { key: 'next', onClick: () => navSched(1), style: btnGhost }, React.createElement(ChevronRight, { size: 14 })),
      React.createElement('div', { key: 'sp4', style: { width: '10px', flexShrink: 0 } }),
      React.createElement('span', { key: 'tt', style: { color: 'var(--q-text)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-interface)', minWidth: 130 } },
        mode === 'month' ? MONTHS[month] + ' ' + year : 'Week of ' + WEEK[0] + ' ' + view.getDate()),
      React.createElement('div', { key: 'sp5', style: { width: '8px', flexShrink: 0 } }),
      React.createElement(IconBtn, { key: 'todo', icon: PanelLeft, onClick: () => setShowTodo(!showTodo), active: showTodo }),
    ]),
  ]
  const header = React.createElement('div', { key: 'hdr', style: { marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, width: '100%' } }, headerKids)

  const bodyKids: React.ReactNode[] = [
    React.createElement('div', { key: 'cal', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 } }, [
      mode === 'month'
        ? React.createElement('div', { key: 'wh', style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 } }, WEEK.map((w) => React.createElement('div', { key: w, style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', textAlign: 'center', padding: 4 } }, w)))
        : null,
      calendarGrid,
    ]),
  ]
  if (showTodo) bodyKids.push(todoPanel)

  return React.createElement('div', { className: 'h-full flex flex-col', style: { width: '100%', position: 'relative' } }, [
    header,
    React.createElement('div', { key: 'body', className: 'q-scroll', style: { flex: 1, overflowY: 'auto', padding: '4px 8px 12px 8px', minHeight: 0, position: 'relative' } }, bodyKids),
  ])
}