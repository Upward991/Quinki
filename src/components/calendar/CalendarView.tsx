import React, { useState, useEffect, useCallback } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Calendar, Clock, Play, X, RotateCcw, Trash2, Bot, PanelLeft, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon } from '../icons'

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
const HOUR_H = 48 // altezza (px) di un'ora in week/day (spostamento al minuto)

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
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function parseAt(at: string): { h: number; m: number } {
  const p = String(at || '08:00').split(':')
  return { h: parseInt(p[0], 10) || 0, m: parseInt(p[1], 10) || 0 }
}
function fullDate(d: Date): string {
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
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

export function CalendarView(props: { activePanel: string; onSelectPanel: (p: string) => void; agents?: any[]; onOpenSession?: (key: string) => void }) {
  const { call, subscribe } = useSidecarContext()
  const [schedules, setSchedules] = useState<any[]>([])
  const [executions, setExecutions] = useState<any[]>([])
  const [view, setView] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [mode, setMode] = useState<'month' | 'week' | 'day'>('month')
  const [selected, setSelected] = useState<Date>(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
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

  // REALTIME senza polling aggressivo: aggiorna SOLO quando il sidecar notifica cambi
  // (execution_update / schedule_update) + un refresh lento di sicurezza ogni 30s.
  useEffect(() => {
    refresh()
    const iv = setInterval(refresh, 30000)
    const unsub1 = subscribe?.('execution_update', () => { refresh() })
    const unsub2 = subscribe?.('schedule_update', () => { refresh() })
    return () => { clearInterval(iv); if (unsub1) try { unsub1() } catch {}; if (unsub2) try { unsub2() } catch {} }
  }, [refresh, subscribe])

  const act = useCallback(async (fn: () => Promise<any>) => {
    try { await fn() } catch {}
    await refresh()
  }, [refresh])

  const year = view.getFullYear()
  const month = view.getMonth()

  const dayActivities = (d: Date): { type: string; color: string; text: string; h: number; m: number; id: string; ex?: any }[] => {
    const out: any[] = []
    const jsDay = d.getDay(); const dayNum = jsDay === 0 ? 7 : jsDay
    for (const s of schedules) {
      const w = s.when || {}
      if (w.type === 'once') {
        if (!w.date) continue
        const dt = new Date(w.date)
        if (!sameDay(dt, d)) continue
        out.push({ type: 'schedule', color: 'var(--q-accent-calendar)', text: (s.enabled ? '' : '(off) ') + (s.title || 'Task') + ' · ' + fmtTime(dt.getTime()), h: dt.getHours(), m: dt.getMinutes(), id: s.id, draggable: true })
      } else if (w.type === 'daily') {
        const { h, m } = parseAt(w.at || '08:00')
        out.push({ type: 'schedule', color: 'var(--q-accent-calendar)', text: (s.enabled ? '' : '(off) ') + (s.title || 'Task') + ' · ' + (w.at || '08:00'), h, m, id: s.id, draggable: true })
      } else if (w.type === 'weekly') {
        if (!(w.daysOfWeek || []).includes(dayNum)) continue
        const { h, m } = parseAt(w.at || '08:00')
        out.push({ type: 'schedule', color: 'var(--q-accent-calendar)', text: (s.enabled ? '' : '(off) ') + (s.title || 'Task') + ' · ' + (w.at || '08:00'), h, m, id: s.id, draggable: true })
      } else if (w.type === 'monthly') {
        if ((w.dayOfMonth ?? 1) !== d.getDate()) continue
        const { h, m } = parseAt(w.at || '08:00')
        out.push({ type: 'schedule', color: 'var(--q-accent-calendar)', text: (s.enabled ? '' : '(off) ') + (s.title || 'Task') + ' · ' + (w.at || '08:00'), h, m, id: s.id, draggable: true })
      }
    }
    for (const ex of executions) {
      const t = ex.scheduledFor || ex.createdAt
      if (!t) continue
      const dt = new Date(t)
      if (!sameDay(dt, d)) continue
      const col = STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)'
      out.push({ type: 'exec', color: col, text: (ex.label || ex.id) + ' · ' + ex.status + ' · ' + fmtTime(dt.getTime()), h: dt.getHours(), m: dt.getMinutes(), id: ex.id, ex })
    }
    out.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m))
    return out
  }

  const moveSchedule = async (id: string, target: Date) => {
    const s = schedules.find((x: any) => x.id === id)
    if (!s) return
    const when = { ...(s.when || {}) }
    const t = new Date(target)
    if (when.type === 'once') {
      when.date = t.toISOString()
    } else if (when.type === 'weekly') {
      const js = t.getDay()
      when.daysOfWeek = [js === 0 ? 7 : js]
      if (when.at) { const { h, m } = { h: t.getHours(), m: t.getMinutes() }; when.at = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') }
    } else if (when.type === 'monthly') {
      when.dayOfMonth = t.getDate()
      if (when.at) { const { h, m } = { h: t.getHours(), m: t.getMinutes() }; when.at = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') }
    } else if (when.type === 'daily') {
      if (when.at) { const { h, m } = { h: t.getHours(), m: t.getMinutes() }; when.at = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') }
    } else { return }
    await act(async () => { await call('updateSchedule', { id, when }) })
  }
  const startDrag = (e: any, id: string) => { e.dataTransfer.setData('text/quinki-schedule', id); setDragId(id); e.stopPropagation() }
  const endDrag = () => setDragId(null)
  const today0 = () => { const n = new Date(); n.setHours(0, 0, 0, 0); return n }
  const openDay = (d: Date) => { const nd = new Date(d); nd.setHours(0, 0, 0, 0); setSelected(nd); setView(nd); setMode('day') }

  // Drop con MINUTI (week/day): calcola ora:minuto dalla coordinata Y
  const onDropTimed = (e: React.DragEvent, d: Date, rectTop: number) => {
    e.preventDefault(); e.stopPropagation()
    const id = e.dataTransfer.getData('text/quinki-schedule')
    if (!id) { setDragId(null); return }
    const off = Math.max(0, e.clientY - rectTop)
    const minutes = Math.floor(off / HOUR_H * 60)
    const hh = Math.min(23, Math.floor(minutes / 60))
    const mm = minutes % 60
    const t = new Date(d); t.setHours(hh, mm, 0, 0)
    moveSchedule(id, t)
    setDragId(null)
  }
  const onDropDay = (e: React.DragEvent, d: Date) => {
    e.preventDefault(); e.stopPropagation()
    const id = e.dataTransfer.getData('text/quinki-schedule')
    if (id) moveSchedule(id, d)
    setDragId(null)
  }

  // === MESE ===
  let calendarGrid: React.ReactElement
  if (mode === 'month') {
    const first = new Date(year, month, 1)
    const startOffset = (first.getDay() + 6) % 7
    const gridStart = new Date(year, month, 1 - startOffset)
    const cells: React.ReactElement[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
      const inMonth = d.getMonth() === month
      const isToday = sameDay(d, today0())
      const isSel = sameDay(d, selected)
      const acts = dayActivities(d)
      const kids: React.ReactNode[] = [
        React.createElement('div', { key: 'n', style: { color: isToday ? 'var(--q-accent-calendar)' : 'var(--q-text-secondary)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, d.getDate()),
      ]
      for (const a of acts.slice(0, 4)) {
        kids.push(React.createElement('div', {
          key: 'a' + a.id, title: a.text,
          style: { padding: '2px 6px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-interface)', color: 'var(--q-text)', backgroundColor: 'color-mix(in srgb, ' + a.color + ' 15%, transparent)', border: '1px solid ' + a.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }, a.text.split('·')[0]))
      }
      if (acts.length > 4) kids.push(React.createElement('div', { key: 'more', style: { color: 'var(--q-text-tertiary)', fontSize: 10, fontFamily: 'var(--font-interface)' } }, '+' + (acts.length - 4) + ' more'))
      cells.push(React.createElement('div', {
        key: dayKey(d.getTime()),
        onClick: () => openDay(d),
        onDragOver: (e: any) => e.preventDefault(),
        onDrop: (e: any) => onDropDay(e, d),
        style: {
          aspectRatio: '1 / 1', padding: 6, borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 3,
          cursor: 'pointer', transition: 'none', overflow: 'hidden',
          backgroundColor: isSel ? 'var(--q-active)' : 'var(--q-bg-panel)',
          border: isToday ? '1px solid var(--q-accent-calendar)' : isSel ? '1px solid var(--q-text-secondary)' : '1px solid var(--q-border)',
          opacity: inMonth ? 1 : 0.4,
        },
      }, kids))
    }
    calendarGrid = React.createElement('div', { key: 'g', style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, width: '100%' } }, cells)
  } else {
    // === SETTIMANA / GIORNO — barra orari unica a sinistra + griglia (stile Google Calendar) ===
    const days: Date[] = []
    if (mode === 'week') {
      const dow = (view.getDay() + 6) % 7
      const weekStart = new Date(year, month, view.getDate() - dow)
      for (let i = 0; i < 7; i++) days.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))
    } else {
      days.push(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()))
    }
    const totalH = 24 * HOUR_H
    const gutterKids: React.ReactNode[] = []
    for (let h = 0; h < 24; h++) {
      gutterKids.push(React.createElement('div', {
        key: h,
        style: { position: 'absolute', top: h * HOUR_H - 7, left: 0, width: '100%', fontSize: 9, fontFamily: 'var(--font-code)', color: 'var(--q-text-tertiary)', textAlign: 'right', paddingRight: 6 },
      }, String(h).padStart(2, '0') + ':00'))
    }
    const gridKids: React.ReactNode[] = days.map((d, di) => {
      const acts = dayActivities(d)
      const isToday = sameDay(d, today0())
      const isSel = sameDay(d, selected)
      const blocks: React.ReactNode[] = acts.map((a, ai) => {
        const topPx = (a.h * HOUR_H) + Math.round((a.m / 60) * HOUR_H)
        if (a.ex && a.ex.status === 'running') { /* mostra bordi */ }
        return React.createElement('div', {
          key: ai,
          title: a.text,
          draggable: a.type === 'schedule',
          onDragStart: a.type === 'schedule' ? (e: any) => startDrag(e, a.id) : undefined,
          onDragEnd: a.type === 'schedule' ? endDrag : undefined,
          style: {
            position: 'absolute', left: 3, right: 3, top: topPx, height: Math.max(18, HOUR_H / 2), borderRadius: 6,
            backgroundColor: 'color-mix(in srgb, ' + a.color + ' 20%, transparent)', border: '1px solid ' + a.color,
            color: 'var(--q-text)', fontSize: 10, fontFamily: 'var(--font-interface)', padding: '1px 5px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: a.type === 'schedule' ? 'grab' : 'default', zIndex: 3,
          },
        }, a.text.split('·')[0])
      })
      // righe orarie di sfondo
      const bgRows: React.ReactNode[] = []
      for (let h = 0; h < 24; h++) {
        bgRows.push(React.createElement('div', { key: h, style: { position: 'absolute', left: 0, right: 0, top: h * HOUR_H, height: HOUR_H, borderTop: '1px solid var(--q-border-soft)' } }))
      }
      return React.createElement('div', {
        key: 'col' + di,
        onClick: () => { if (mode === 'week') openDay(d) },
        onDragOver: (e: any) => e.preventDefault(),
        onDrop: (e: any) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onDropTimed(e, d, rect.top)
        },
        style: { position: 'relative', minWidth: 0, height: totalH, backgroundColor: isToday ? 'var(--q-active)' : 'var(--q-bg-panel)', border: isSel ? '1px solid var(--q-text-secondary)' : isToday ? '1px solid var(--q-accent-calendar)' : '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', cursor: mode === 'week' ? 'pointer' : 'default' },
      }, [ ...bgRows, ...blocks ])
    })

    const grid = React.createElement('div', { key: 'grid', style: { position: 'relative', flex: 1, display: 'grid', gridTemplateColumns: 'repeat(' + days.length + ', 1fr)', gap: 4, overflow: 'hidden', borderRadius: 'var(--radius-sm)' } }, gridKids)
    const gutter = React.createElement('div', { key: 'gutter', style: { position: 'relative', width: 44, flexShrink: 0, height: totalH } }, gutterKids)
    const dayHeaders = React.createElement('div', { key: 'dh', style: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 } }, days.map((d, i) => React.createElement('div', {
      key: i, style: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', color: sameDay(d, today0()) ? 'var(--q-accent-calendar)' : 'var(--q-text)', padding: '4px 0', borderRadius: 'var(--radius-sm)', backgroundColor: sameDay(d, selected) ? 'var(--q-active)' : 'transparent', cursor: 'pointer' },
    }, mode === 'week' ? WEEK[i] + ' ' + d.getDate() : fullDate(d))))

    calendarGrid = React.createElement('div', { key: 'wg', style: { width: '100%', display: 'flex', flexDirection: 'column', gap: 4, overflowX: 'auto' } }, [
      dayHeaders,
      React.createElement('div', { key: 'wgbody', style: { display: 'flex', gap: 4, overflowY: 'auto' } }, [gutter, grid]),
    ])
  }

  const nav = (dir: number) => {
    const d = new Date(view)
    if (mode === 'month') d.setMonth(d.getMonth() + dir)
    else if (mode === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setDate(d.getDate() + dir)
    d.setHours(0, 0, 0, 0)
    setView(d)
  }

  // === To-do (panel laterale che SPINGE il calendario, altezza totale) ===
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
    if (s.enabled) { row.push(React.createElement('button', { key: 'run', style: btnText, title: 'Run now', onClick: () => act(async () => { await call('runScheduleNow', { id: s.id }) }) }, React.createElement(Play, { size: 12 }))) }
    row.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteSchedule', { id: s.id }) }) }, React.createElement(Trash2, { size: 12 })))
    schedRows.push(React.createElement('div', {
      key: s.id, draggable: true, onDragStart: (e: any) => startDrag(e, s.id), onDragEnd: endDrag,
      style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (dragId === s.id ? 'var(--q-accent-calendar)' : 'var(--q-border)'), cursor: 'grab', transition: 'none' },
    }, row))
  }
  const execRows: React.ReactElement[] = []
  for (const ex of executions.slice(0, 80)) {
    const row: React.ReactNode[] = [
      React.createElement(Chip, { key: 'chip', color: STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)', text: ex.status || '?' }),
      React.createElement('div', { key: 'mid', style: { flex: 1, minWidth: 0 } }, [
        React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ex.label || ex.id),
        React.createElement('div', { key: 'd', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)', marginTop: 1 } }, (ex.agentIds || []).join(', ') + ' · ' + fmtTime(ex.createdAt) + (ex.error ? ' · ' + String(ex.error).slice(0, 40) : '')),
      ]),
    ]
    if (ex.status === 'running' || ex.status === 'queued') { row.push(React.createElement('button', { key: 'stop', style: btnText, title: 'Stop (interrupt, can resume)', onClick: () => act(async () => { await call('stopExecution', { executionId: ex.id }) }) }, React.createElement(X, { size: 12 }))) }
    if (ex.status === 'interrupted') { row.push(React.createElement('button', { key: 'res', style: btnText, title: 'Resume', onClick: () => act(async () => { await call('resumeExecution', { executionId: ex.id }) }) }, React.createElement(RotateCcw, { size: 12 }))) }
    row.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteExecution', { executionId: ex.id }) }) }, React.createElement(Trash2, { size: 12 })))
    execRows.push(React.createElement('div', { key: ex.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', transition: 'none' } }, row))
  }
  const todoPanel = React.createElement('div', {
    style: {
      width: 300, flexShrink: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 10,
      backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)',
      border: '1px solid var(--q-border)', padding: '12px', overflowY: 'auto',
    },
  }, [
    React.createElement('div', { key: 'sh', style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }, onClick: () => setOpenSched(!openSched) }, [
      openSched ? React.createElement(ChevronDown, { size: 14, style: { color: 'var(--q-text-secondary)' } }) : React.createElement(ChevronRightIcon, { size: 14, style: { color: 'var(--q-text-secondary)' } }),
      React.createElement(Clock, { size: 14, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', flex: 1 } }, 'Scheduled'),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, '(' + schedules.filter((x: any) => x.enabled).length + ')'),
    ]),
    openSched ? React.createElement('div', { key: 'sl', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, schedRows.length ? schedRows : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 0' } }, 'Nothing scheduled.')) : null,
    React.createElement('div', { key: 'eh', style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }, onClick: () => setOpenExec(!openExec) }, [
      openExec ? React.createElement(ChevronDown, { size: 14, style: { color: 'var(--q-text-secondary)' } }) : React.createElement(ChevronRightIcon, { size: 14, style: { color: 'var(--q-text-secondary)' } }),
      React.createElement(Bot, { size: 14, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', flex: 1 } }, 'Executions'),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, '(' + executions.length + ')'),
    ]),
    openExec ? React.createElement('div', { key: 'el', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, execRows.length ? execRows : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 0' } }, 'No executions yet.')) : null,
  ])

  // === Header (come la chat: [Home][sidebar], niente glow sulla sidebar attiva) ===
  const IconBtn = ({ icon: Icon, onClick }: { icon: React.FC<any>; onClick: () => void }) => {
    const [h, setH] = useState(false)
    return React.createElement('button', {
      onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false),
      style: {
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', padding: '0',
        backgroundColor: h ? 'var(--q-hover)' : 'transparent',
        color: h ? 'var(--q-text)' : 'var(--q-text-secondary)',
        transition: 'none',
      },
    }, React.createElement(Icon, { size: 20 }))
  }
  const periodLabel = () => {
    if (mode === 'month') return MONTHS[month] + ' ' + year
    if (mode === 'week') {
      const dow = (view.getDay() + 6) % 7
      const ws = new Date(year, month, view.getDate() - dow)
      const we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6)
      if (ws.getMonth() === we.getMonth()) return ws.getDate() + ' – ' + we.getDate() + ' ' + MONTHS[ws.getMonth()] + ' ' + we.getFullYear()
      return ws.getDate() + ' ' + MONTHS[ws.getMonth()] + ' – ' + we.getDate() + ' ' + MONTHS[we.getMonth()] + ' ' + we.getFullYear()
    }
    return 'Day agenda'
  }

  const headerKids: React.ReactNode[] = [
    React.createElement('div', { key: 'h1', style: panelStyle }, [React.createElement(IconBtn, { key: 'home', icon: Home, onClick: () => props.onSelectPanel('home') })]),
    React.createElement('div', { key: 'sp1', style: { width: '8px', flexShrink: 0 } }),
    React.createElement('div', { key: 'h2', style: panelStyle }, [React.createElement(IconBtn, { key: 'todo', icon: PanelLeft, onClick: () => setShowTodo(!showTodo) })]),
    React.createElement('div', { key: 'sp2', style: { width: '8px', flexShrink: 0 } }),
    React.createElement('div', { key: 'h3', style: { ...panelStyle, flex: 1, minWidth: 0 } }, [
      React.createElement('div', { key: 'sp0', style: { width: '8px', flexShrink: 0 } }),
      React.createElement(Calendar, { key: 'ic', size: 18, style: { color: 'var(--q-text-secondary)', flexShrink: 0 } }),
      React.createElement('div', { key: 'sp1b', style: { width: '12px', flexShrink: 0 } }),
      React.createElement('span', { key: 'ti', style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' } }, 'Agents Calendar'),
      React.createElement('div', { key: 'sp2b', style: { width: '8px', flexShrink: 0 } }),
      React.createElement('span', { key: 'pd', style: { color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' } }, periodLabel()),
      React.createElement('div', { key: 'fx', style: { flex: 1 } }),
      React.createElement('button', { key: 'm', onClick: () => setMode('month'), style: modeBtn('month', mode) }, 'Month'),
      React.createElement('button', { key: 'w', onClick: () => setMode('week'), style: modeBtn('week', mode) }, 'Week'),
      React.createElement('div', { key: 'sp3', style: { width: '10px', flexShrink: 0 } }),
      React.createElement('button', { key: 'prev', onClick: () => nav(-1), style: btnGhost }, React.createElement(ChevronLeft, { size: 14 })),
      React.createElement('button', { key: 'today', onClick: () => { const n = today0(); setSelected(n); setView(n) }, style: btnGhost }, 'Today'),
      React.createElement('button', { key: 'next', onClick: () => nav(1), style: btnGhost }, React.createElement(ChevronRight, { size: 14 })),
      React.createElement('div', { key: 'sp4', style: { width: '10px', flexShrink: 0 } }),
      React.createElement('span', { key: 'dt', style: { color: 'var(--q-text)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-interface)', minWidth: 130, whiteSpace: 'nowrap' } }, fullDate(selected)),
    ]),
  ]
  const header = React.createElement('div', { key: 'hdr', style: { marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', width: '100%' } }, headerKids)

  const calWrap = React.createElement('div', { key: 'calwrap', style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: showTodo ? 12 : 0 } }, [
    React.createElement('div', { key: 'cal', style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' } }, [
      mode === 'month'
        ? React.createElement('div', { key: 'wh', style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 } }, WEEK.map((w, i) => React.createElement('div', { key: w, style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', textAlign: 'center', padding: 4 } }, w)))
        : null,
      calendarGrid,
    ]),
  ])

  const bodyKids: React.ReactNode[] = [calWrap]
  if (showTodo) bodyKids.unshift(todoPanel)

  return React.createElement('div', { className: 'h-full flex flex-col', style: { width: '100%', position: 'relative' } }, [
    header,
    React.createElement('div', { key: 'body', className: 'q-scroll', style: { flex: 1, overflowY: 'auto', padding: '4px 8px 12px 8px', minHeight: 0, display: 'flex', alignItems: 'stretch' } }, bodyKids),
  ])
}

function modeBtn(v: 'month' | 'week', cur: string): React.CSSProperties {
  const active = cur === v
  const radius = v === 'month' ? 'var(--radius-sm) 0 0 var(--radius-sm)' : '0 var(--radius-sm) var(--radius-sm) 0'
  return {
    cursor: 'pointer', height: 28, padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-interface)',
    backgroundColor: active ? 'var(--q-accent-calendar)' : 'transparent',
    color: active ? 'var(--q-bg)' : 'var(--q-text-secondary)',
    fontWeight: active ? 600 : 400, borderRadius: radius, transition: 'none',
    border: '1px solid var(--q-border)', borderRight: v === 'week' ? '1px solid var(--q-border)' : 'none',
  }
}