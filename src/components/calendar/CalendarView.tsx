import React, { useState, useEffect, useCallback } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Calendar, Clock, Play, X, RotateCcw, Trash2, Bot } from '../icons'

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
  backgroundColor: 'var(--q-bg-panel)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-floating)',
  padding: '8px',
  minHeight: 'var(--spacing-header-min)',
  display: 'flex',
  alignItems: 'center',
}

const btnGhost: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)',
  backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
  cursor: 'pointer', transition: 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
}
const btnText: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
  cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center', gap: 3,
}
const btnAccent: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-accent-calendar)',
  backgroundColor: 'transparent', color: 'var(--q-accent-calendar)', fontSize: '13px', fontWeight: 600,
  fontFamily: 'var(--font-interface)', cursor: 'pointer', transition: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
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
      display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-interface)',
      color, border: '1px solid ' + color, backgroundColor: 'transparent', letterSpacing: 0.2,
      textTransform: 'capitalize', flexShrink: 0,
    },
  }, text)
}

export function CalendarView(props: { activePanel: string; onSelectPanel: (p: string) => void; agents?: any[]; onOpenSession?: (key: string) => void }) {
  const { call } = useSidecarContext()
  const [schedules, setSchedules] = useState<any[]>([])
  const [executions, setExecutions] = useState<any[]>([])
  const [view, setView] = useState(new Date())
  const [dragId, setDragId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const a = await call('listSchedules')
      const b = await call('listExecutions')
      setSchedules(a?.schedules || [])
      setExecutions(b?.executions || [])
    } catch {}
  }, [call])

  useEffect(() => { refresh(); const iv = setInterval(refresh, 4000); return () => clearInterval(iv) }, [refresh])

  const act = useCallback(async (fn: () => Promise<any>) => {
    try { await fn() } catch {}
    await refresh()
  }, [refresh])

  // === Calendario: giorni del mese visibile (lun→dom), fino a 6 settimane ===
  const year = view.getFullYear()
  const month = view.getMonth()
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7 // lun=0
  const cells: { date: Date; inMonth: boolean }[] = []
  const gridStart = new Date(year, month, 1 - startOffset)
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    cells.push({ date: d, inMonth: d.getMonth() === month })
  }
  // bucket: schedule → giorno nextFireAt (se esiste); execution → giorno scheduledFor || createdAt
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

  // === Rendering helpers ===
  const IconBtn = ({ icon: Icon, onClick }: { icon: React.FC<any>; onClick: () => void }) => {
    const [h, setH] = useState(false)
    return React.createElement('button', {
      onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false),
      style: {
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
        backgroundColor: h ? 'var(--q-hover)' : 'transparent',
        color: h ? 'var(--q-text)' : 'var(--q-text-secondary)',
        flexShrink: 0, padding: '0', transition: 'none',
      },
    }, React.createElement(Icon, { size: 20 }))
  }

  const schedVisible = schedules.filter((s: any) => s.enabled || s.lastFiredAt)
  const execVisible = executions.slice(0, 60)

  const todoList = React.createElement('div', {
    style: {
      width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12,
      paddingRight: 12, borderRight: '1px solid var(--q-border)', marginRight: 16, overflowY: 'auto',
    },
  }, [
    // — Scheduled —
    React.createElement('div', { key: 'sh', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
      React.createElement(Clock, { size: 14, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Scheduled'),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, '(' + schedVisible.length + ')'),
    ]),
    React.createElement('div', { key: 'sl', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      schedVisible.length === 0
        ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 0' } }, 'Nothing scheduled.')
        : (schedVisible as any[]).map((s: any) => {
            const row = [
              React.createElement('div', { key: 'chip', style: { width: 8, height: 8, borderRadius: 4, flexShrink: 0, backgroundColor: s.enabled ? 'var(--q-accent-calendar)' : 'var(--q-text-tertiary)', marginTop: 5 } }),
              React.createElement('div', { key: 'mid', style: { flex: 1, minWidth: 0 } }, [
                React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.title || '(untitled)'),
                React.createElement('div', { key: 'd', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)', marginTop: 1 } }, fmtWhen(s)),
              ]),
              s.enabled ? React.createElement('button', { key: 'run', style: btnText, title: 'Run now', onClick: () => act(async () => { await call('runScheduleNow', { id: s.id }) }) }, React.createElement(Play, { size: 12 })) : null,
              React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteSchedule', { id: s.id }) }) }, React.createElement(Trash2, { size: 12 })),
            ]
            return React.createElement('div', {
              key: s.id,
              draggable: true,
              onDragStart: (e: any) => { e.dataTransfer.setData('text/quinki-schedule', s.id); setDragId(s.id) },
              onDragEnd: () => setDragId(null),
              style: {
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px',
                backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (dragId === s.id ? 'var(--q-accent-calendar)' : 'var(--q-border)'),
                cursor: 'grab', transition: 'none',
              },
            }, row)
          }),
    ),
    // — Executions —
    React.createElement('div', { key: 'eh', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
      React.createElement(Bot, { size: 14, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Executions'),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, '(' + executions.length + ')'),
    ]),
    React.createElement('div', { key: 'el', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      execVisible.length === 0
        ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 0' } }, 'No executions yet.')
        : execVisible.map((ex: any) => {
            const row = [
              React.createElement(Chip, { key: 'chip', color: STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)', text: ex.status || '?' }),
              React.createElement('div', { key: 'mid', style: { flex: 1, minWidth: 0 } }, [
                React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ex.label || ex.id),
                React.createElement('div', { key: 'd', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)', marginTop: 1 } },
                  (ex.agentIds || []).join(', ') + ' · ' + fmtTime(ex.createdAt) +
                  (ex.error ? ' · ' + String(ex.error).slice(0, 40) : '')),
              ]),
              (ex.status === 'running' || ex.status === 'queued') ? React.createElement('button', { key: 'stop', style: btnText, title: 'Stop (interrupt, can resume)', onClick: () => act(async () => { await call('stopExecution', { executionId: ex.id }) }) }, React.createElement(X, { size: 12 })) : null,
              ex.status === 'interrupted' ? React.createElement('button', { key: 'res', style: btnText, title: 'Resume', onClick: () => act(async () => { await call('resumeExecution', { executionId: ex.id }) }) }, React.createElement(RotateCcw, { size: 12 })) : null,
              React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteExecution', { executionId: ex.id }) }) }, React.createElement(Trash2, { size: 12 })),
            ]
            return React.createElement('div', {
              key: ex.id,
              style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', transition: 'none',
              },
            }, row)
          }),
    ),
  ])

  // === Griglia calendario ===
  const daysGrid = cells.map((c) => {
    const k = dayKey(c.date.getTime())
    const ss = schedByDay[k] || []
    const ee = execByDay[k] || []
    const dim = !c.inMonth
    const isToday = dayKey(c.date.getTime()) === dayKey(Date.now())
    return React.createElement('div', {
      key: k,
      onDragOver: (e: any) => { e.preventDefault() },
      onDrop: (e: any) => onDropOnDay(e, c.date),
      style: {
        minHeight: 96, padding: 6, borderRadius: 'var(--radius-sm)',
        backgroundColor: isToday ? 'var(--q-active)' : 'transparent',
        border: '1px solid ' + (isToday ? 'var(--q-accent-calendar)' : 'var(--q-border-soft)'),
        opacity: dim ? 0.45 : 1, display: 'flex', flexDirection: 'column', gap: 3,
        cursor: 'pointer', transition: 'none',
      },
    }, [
      React.createElement('div', { key: 'n', style: { color: isToday ? 'var(--q-accent-calendar)' : 'var(--q-text-secondary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, c.date.getDate()),
      ...ss.map((s: any) => React.createElement('div', {
        key: s.id, draggable: true,
        onDragStart: (e: any) => { e.dataTransfer.setData('text/quinki-schedule', s.id); setDragId(s.id) },
        onDragEnd: () => setDragId(null),
        title: s.title + ' · ' + fmtWhen(s),
        style: {
          display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 6,
          backgroundColor: 'color-mix(in srgb, var(--q-accent-calendar) 14%, transparent)',
          border: '1px solid ' + (dragId === s.id ? 'var(--q-accent-calendar)' : 'var(--q-accent-calendar)'),
          color: 'var(--q-text)', fontSize: 11, fontFamily: 'var(--font-interface)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'grab',
        },
      }, s.title || '(untitled)')),
      ...ee.map((ex: any) => {
        const col = STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)'
        return React.createElement('div', {
          key: ex.id,
          title: ex.label + ' · ' + ex.status,
          style: {
            display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 6,
            backgroundColor: 'color-mix(in srgb, ' + col + ' 14%, transparent)',
            border: '1px solid ' + col, color: 'var(--q-text)', fontSize: 11, fontFamily: 'var(--font-interface)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, ex.label || ex.id)
      }),
    ])
  })

  const calendar = React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 } }, [
    React.createElement('div', { key: 'ch', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
      React.createElement('button', { onClick: () => setView(new Date(year, month - 1, 1)), style: btnGhost }, '‹'),
      React.createElement('button', { onClick: () => setView(new Date()), style: btnGhost }, 'Today'),
      React.createElement('button', { onClick: () => setView(new Date(year, month + 1, 1)), style: btnGhost }, '›'),
      React.createElement('span', { key: 'tt', style: { color: 'var(--q-text)', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-interface)', marginLeft: 8 } }, MONTHS[month] + ' ' + year),
    ]),
    React.createElement('div', { key: 'wh', style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 } },
      WEEK.map((w) => React.createElement('div', { key: w, style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', textAlign: 'center', padding: 4 } }, w))),
    React.createElement('div', { key: 'g', style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, flex: 1 } }, daysGrid),
    React.createElement('div', { key: 'hint', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } },
      'Drag a scheduled task to another day to move it. To-do on the left shows live status.'),
  ])

  return React.createElement('div', { className: 'h-full flex flex-col', style: { maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%', position: 'relative' } }, [
    // === Header identico alle altre tab ===
    React.createElement('div', { key: 'hdr', style: { marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center' } }, [
      React.createElement('div', { key: 'h1', style: panelStyle }, [
        React.createElement(IconBtn, { key: 'home', icon: Home, onClick: () => props.onSelectPanel('home') }),
      ]),
      React.createElement('div', { key: 'sp1', style: { width: '8px', flexShrink: 0 } }),
      React.createElement('div', { key: 'h2', style: { ...panelStyle, flex: 1 } }, [
        React.createElement('div', { key: 'sp2', style: { width: '8px', flexShrink: 0 } }),
        React.createElement(Calendar, { key: 'ic', size: 18, style: { color: 'var(--q-text-secondary)', flexShrink: 0 } }),
        React.createElement('div', { key: 'sp3', style: { width: '12px', flexShrink: 0 } }),
        React.createElement('span', { key: 'ti', style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Agents Calendar'),
        React.createElement('div', { key: 'sp4', style: { width: '8px', flexShrink: 0 } }),
        React.createElement('span', { key: 'ct', style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } }, '(' + schedules.length + ' scheduled, ' + executions.length + ' runs)'),
        React.createElement('div', { key: 'sp5', style: { width: '8px', flexShrink: 0 } }),
        React.createElement('span', { key: 'fx', style: { flex: 1 } }),
        React.createElement('button', {
          key: 'refresh',
          onClick: () => act(async () => {}),
          onMouseEnter: (ev: any) => { ev.currentTarget.style.backgroundColor = 'var(--q-accent-calendar)'; ev.currentTarget.style.color = 'var(--q-bg)' },
          onMouseLeave: (ev: any) => { ev.currentTarget.style.backgroundColor = 'transparent'; ev.currentTarget.style.color = 'var(--q-accent-calendar)' },
          style: btnAccent,
        }, 'Refresh'),
      ]),
    ]),
    // === Corpo: to-do (sinistra) + calendario (centro) ===
    React.createElement('div', { key: 'body', className: 'q-scroll', style: { flex: 1, overflowY: 'auto', padding: '4px 16px 12px 16px', display: 'flex' } }, [
      todoList,
      calendar,
    ]),
  ])
}