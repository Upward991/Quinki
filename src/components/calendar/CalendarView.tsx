import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Calendar, Clock, Play, X, RotateCcw, Trash2, Bot, PanelLeft, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon, Check } from '../icons'

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
  const [editSched, setEditSched] = useState<any>(null) // attività aperta per orario preciso
  const [hoverDay, setHoverDay] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyH, setBodyH] = useState(600)

  const refresh = useCallback(async () => {
    try {
      const a = await call('listSchedules')
      const b = await call('listExecutions')
      setSchedules(a?.schedules || [])
      setExecutions(b?.executions || [])
    } catch {}
  }, [call])

  useEffect(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv) }, [refresh])
  useEffect(() => { subscribe?.('execution_update', refresh); return () => {} }, [refresh])
  useEffect(() => { subscribe?.('schedule_update', refresh); return () => {} }, [refresh])

  // misura altezza disponibile: il calendario deve SEMPRE entrare (niente tagli)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(() => { setBodyH(el.clientHeight) })
    ro.observe(el)
    setBodyH(el.clientHeight)
    return () => { try { ro.disconnect() } catch {} }
  }, [mode])

  const act = useCallback(async (fn: () => Promise<any>) => {
    try { await fn() } catch {}
    await refresh()
  }, [refresh])

  const year = view.getFullYear()
  const month = view.getMonth()

  const dayActivities = (d: Date): { type: string; color: string; text: string; h: number; m: number; s: number; id: string; ex?: any }[] => {
    const out: any[] = []
    const jsDay = d.getDay(); const dayNum = jsDay === 0 ? 7 : jsDay
    for (const s of schedules) {
      const w = s.when || {}
      if (w.type === 'once') {
        if (!w.date) continue
        const dt = new Date(w.date)
        if (!sameDay(dt, d)) continue
        out.push({ type: 'schedule', color: 'var(--q-accent-calendar)', text: (s.enabled ? '' : '(off) ') + (s.title || 'Task') + ' · ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }), h: dt.getHours(), m: dt.getMinutes(), s: dt.getSeconds(), id: s.id, ex: s })
      } else if (w.type === 'daily') {
        const { h, m } = parseAt(w.at || '08:00')
        out.push({ type: 'schedule', color: 'var(--q-accent-calendar)', text: (s.enabled ? '' : '(off) ') + (s.title || 'Task') + ' · ' + (w.at || '08:00'), h, m, s: 0, id: s.id, ex: s })
      } else if (w.type === 'weekly') {
        if (!(w.daysOfWeek || []).includes(dayNum)) continue
        const { h, m } = parseAt(w.at || '08:00')
        out.push({ type: 'schedule', color: 'var(--q-accent-calendar)', text: (s.enabled ? '' : '(off) ') + (s.title || 'Task') + ' · ' + (w.at || '08:00'), h, m, s: 0, id: s.id, ex: s })
      } else if (w.type === 'monthly') {
        if ((w.dayOfMonth ?? 1) !== d.getDate()) continue
        const { h, m } = parseAt(w.at || '08:00')
        out.push({ type: 'schedule', color: 'var(--q-accent-calendar)', text: (s.enabled ? '' : '(off) ') + (s.title || 'Task') + ' · ' + (w.at || '08:00'), h, m, s: 0, id: s.id, ex: s })
      }
    }
    for (const ex of executions) {
      const t = ex.scheduledFor || ex.createdAt
      if (!t) continue
      const dt = new Date(t)
      if (!sameDay(dt, d)) continue
      const col = STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)'
      out.push({ type: 'exec', color: col, text: (ex.label || ex.id) + ' · ' + ex.status + ' · ' + fmtTime(dt.getTime()), h: dt.getHours(), m: dt.getMinutes(), s: dt.getSeconds(), id: ex.id, ex })
    }
    out.sort((a, b) => (a.h * 3600 + a.m * 60 + a.s) - (b.h * 3600 + b.m * 60 + b.s))
    return out
  }

  // aggiorna l'orario di una schedule (drop o click precise)
  const setScheduleTime = async (id: string, d: Date, hh: number, mm: number, ss: number) => {
    const s = schedules.find((x: any) => x.id === id)
    if (!s) return
    const when = { ...(s.when || {}) }
    const t = new Date(d); t.setHours(hh, mm, ss, 0)
    if (when.type === 'once') {
      when.date = t.toISOString()
    } else if (when.type === 'daily') {
      when.at = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
    } else if (when.type === 'weekly') {
      when.daysOfWeek = [d.getDay() === 0 ? 7 : d.getDay()]
      when.at = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
    } else if (when.type === 'monthly') {
      when.dayOfMonth = d.getDate()
      when.at = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
    } else { return }
    await act(async () => { await call('updateSchedule', { id, when }) })
  }
  const startDrag = (e: any, id: string) => { e.dataTransfer.setData('text/quinki-schedule', id); setDragId(id); e.stopPropagation() }
  const endDrag = () => setDragId(null)
  const today0 = () => { const n = new Date(); n.setHours(0, 0, 0, 0); return n }
  const openDay = (d: Date) => { const nd = new Date(d); nd.setHours(0, 0, 0, 0); setSelected(nd); setView(nd); setMode('day') }

  // === MESE: riempie la finestra (mai tagliato), hover, oggi accent ===
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
      const k = dayKey(d.getTime())
      const isHover = hoverDay === k
      const acts = dayActivities(d)
      const kids: React.ReactNode[] = [
        React.createElement('div', { key: 'n', style: { color: isToday ? 'var(--q-accent-calendar)' : 'var(--q-text-secondary)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, d.getDate()),
      ]
      for (const a of acts.slice(0, 3)) {
        kids.push(React.createElement('div', {
          key: 'a' + a.id, title: a.text,
          style: { padding: '2px 6px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-interface)', color: 'var(--q-text)', backgroundColor: 'color-mix(in srgb, ' + a.color + ' 18%, transparent)', border: '1px solid ' + a.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }, a.text.split('·')[0]))
      }
      if (acts.length > 3) kids.push(React.createElement('div', { key: 'more', style: { color: 'var(--q-text-tertiary)', fontSize: 10, fontFamily: 'var(--font-interface)' } }, '+' + (acts.length - 3) + ' more'))
      cells.push(React.createElement('div', {
        key: k,
        onClick: () => openDay(d),
        onMouseEnter: () => setHoverDay(k),
        onMouseLeave: () => setHoverDay(null),
        onDragOver: (e: any) => e.preventDefault(),
        onDrop: (e: any) => { e.preventDefault(); e.stopPropagation(); const id = e.dataTransfer.getData ? e.dataTransfer.getData('text/quinki-schedule') : ''; if (id) { const when = { ...(schedules.find((x: any) => x.id === id)?.when || {}) }; if (when.type === 'once') { setScheduleTime(id, d, 12, 0, 0) } else { setScheduleTime(id, d, 12, 0, 0) } } setDragId(null) },
        style: {
          minHeight: 0, padding: 6, borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden', cursor: 'pointer', transition: 'none',
          backgroundColor: isHover ? 'var(--q-hover)' : 'var(--q-bg-panel)',
          border: isToday ? '1px solid var(--q-accent-calendar)' : '1px solid var(--q-border)',
          opacity: inMonth ? 1 : 0.4,
        },
      }, kids))
    }
    calendarGrid = React.createElement('div', { key: 'g', style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 4 } }, cells)
  } else {
    // === SETTIMANA/GIORNO: UNA tabella unica (barra orari + colonne collegate), 24h sempre visibili ===
    const days: Date[] = []
    if (mode === 'week') { const dow = (view.getDay() + 6) % 7; const ws = new Date(year, month, view.getDate() - dow); for (let i = 0; i < 7; i++) days.push(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i)) }
    else days.push(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()))
    const hourH = Math.max(26, bodyH / 24)
    const totalH = 24 * hourH
    // colonne larghezza (gutter 56 + restante diviso per N giorni)
    const gutterW = 54
    const colW = mode === 'week' ? ((100 - 6) / 7) + '%' : '100%'
    const colL = (i: number) => (i === 0 ? gutterW : gutterW + i * ((bodyRef.current ? bodyRef.current.clientWidth : 900) - gutterW) / days.length)

    const hourLines: React.ReactNode[] = []
    for (let h = 0; h < 24; h++) {
      hourLines.push(React.createElement('div', { key: 'hl' + h, style: { position: 'absolute', left: gutterW, right: 0, top: h * hourH, borderTop: '1px solid var(--q-border)', pointerEvents: 'none' } }))
      hourLines.push(React.createElement('div', { key: 'gl' + h, style: { position: 'absolute', left: 0, top: h * hourH - 7, width: gutterW - 6, textAlign: 'right', fontSize: 9, fontFamily: 'var(--font-code)', color: 'var(--q-text-tertiary)' } }, String(h).padStart(2, '0') + ':00'))
    }
    // mezze/linee 15-min
    for (let k = 0; k < 24 * 4; k++) {
      const y = k * (hourH / 4)
      if (k % 4 !== 0) hourLines.push(React.createElement('div', { key: 'hlq' + k, style: { position: 'absolute', left: gutterW, right: 0, top: y, borderTop: '1px solid var(--q-border-soft)', pointerEvents: 'none' } }))
    }

    const dayHeaders: React.ReactNode[] = days.map((d, i) => React.createElement('div', {
      key: 'dh' + i,
      onClick: () => { if (mode === 'week') openDay(d) },
      style: { position: 'absolute', top: 0, height: 28, left: i === 0 ? gutterW : (i === 0 ? gutterW : gutterW + i * ((bodyRef.current ? bodyRef.current.clientWidth : 900) - gutterW) / days.length), width: i === 0 ? ((bodyRef.current ? bodyRef.current.clientWidth : 900) - gutterW) / days.length : ((bodyRef.current ? bodyRef.current.clientWidth : 900) - gutterW) / days.length, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', color: sameDay(d, today0()) ? 'var(--q-accent-calendar)' : 'var(--q-text)', cursor: 'pointer' } },
      mode === 'week' ? WEEK[i] + ' ' + d.getDate() : fullDate(d),
    ))

    const cols: React.ReactNode[] = days.map((d, di) => {
      const acts = dayActivities(d)
      const x = di === 0 ? gutterW : gutterW + di * ((bodyRef.current ? bodyRef.current.clientWidth : 900) - gutterW) / days.length
      const w = ((bodyRef.current ? bodyRef.current.clientWidth : 900) - gutterW) / days.length
      const blocks: React.ReactNode[] = []
      for (const a of acts) {
        const topPx = a.h * hourH + (a.m / 60) * hourH + (a.s / 60 / 60) * hourH
        blocks.push(React.createElement('div', {
          key: a.id + a.h + a.m + a.s,
          draggable: a.type === 'schedule',
          onDragStart: a.type === 'schedule' ? (ev: any) => startDrag(ev, a.id) : undefined,
          onClick: a.type === 'schedule' ? () => setEditSched({ id: a.id, h: a.h, m: a.m, s: a.s, day: new Date(d) }) : undefined,
          title: a.text,
          style: {
            position: 'absolute', left: 2, right: 2, top: topPx, height: Math.max(16, hourH / 2), borderRadius: 6, zIndex: 3, cursor: a.type === 'schedule' ? 'grab' : 'default',
            backgroundColor: 'color-mix(in srgb, ' + a.color + ' 22%, transparent)', border: '1px solid ' + a.color, padding: '1px 5px',
            fontSize: 10, fontFamily: 'var(--font-interface)', color: 'var(--q-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, a.text.split('·')[0] + (a.type === 'schedule' ? ' ✎' : '')))
      }
      return React.createElement('div', {
        key: 'col' + di,
        onDragOver: (e: any) => e.preventDefault(),
        onDrop: (e: any) => {
          e.preventDefault(); e.stopPropagation()
          const id = e.dataTransfer.getData('text/quinki-schedule')
          if (!id) { setDragId(null); return }
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const off = e.clientY - rect.top
          const mins = off / hourH * 60
          const totalMin = Math.floor(mins / 15) * 15
          const hh = Math.min(23, Math.floor(totalMin / 60))
          const mm = totalMin % 60
          setScheduleTime(id, d, hh, mm, 0)
          setDragId(null)
        },
        style: { position: 'absolute', top: 28, left: x, width: w, height: totalH, backgroundColor: sameDay(d, today0()) ? 'var(--q-active)' : 'transparent', borderLeft: '1px solid var(--q-border)', borderRight: '1px solid var(--q-border)', borderTop: '1px solid var(--q-border)' },
      }, blocks)
    })

    // contenitore tabella: altezza totale, scroll verticale INTERNO (le 24h ci stanno, midnight sopra se serve)
    calendarGrid = React.createElement('div', { key: 'wg', style: { position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--q-border-strong)', borderRadius: 'var(--radius-sm)' } }, [
      React.createElement('div', { key: 'inner', style: { position: 'relative', height: totalH + 28 } }, [
        ...hourLines,
        ...dayHeaders,
        ...cols,
      ]),
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

  // === Sidebar to-do ===
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
    if (s.enabled) row.push(React.createElement('button', { key: 'run', style: btnText, title: 'Run now', onClick: () => act(async () => { await call('runScheduleNow', { id: s.id }) }) }, React.createElement(Play, { size: 12 })))
    row.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteSchedule', { id: s.id }) }) }, React.createElement(Trash2, { size: 12 })))
    schedRows.push(React.createElement('div', { key: s.id, draggable: true, onDragStart: (e: any) => startDrag(e, s.id), onDragEnd: endDrag, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (dragId === s.id ? 'var(--q-accent-calendar)' : 'var(--q-border)'), cursor: 'grab', transition: 'none' } }, row))
  }
  const execRows: React.ReactElement[] = []
  for (const ex of executions.slice(0, 60)) {
    const row: React.ReactNode[] = [
      React.createElement(Chip, { key: 'c', color: STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)', text: ex.status || '?' }),
      React.createElement('div', { key: 'mid', style: { flex: 1, minWidth: 0 } }, [
        React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ex.label || ex.id),
        React.createElement('div', { key: 'd', style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)', marginTop: 1 } }, (ex.agentIds || []).join(', ') + ' · ' + fmtTime(ex.createdAt)),
      ]),
    ]
    if (ex.status === 'running' || ex.status === 'queued') row.push(React.createElement('button', { key: 'stop', style: btnText, title: 'Stop (interrupt)', onClick: () => act(async () => { await call('stopExecution', { executionId: ex.id }) }) }, React.createElement(X, { size: 12 })))
    if (ex.status === 'interrupted') row.push(React.createElement('button', { key: 'res', style: btnText, title: 'Resume', onClick: () => act(async () => { await call('resumeExecution', { executionId: ex.id }) }) }, React.createElement(RotateCcw, { size: 12 })))
    row.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteExecution', { executionId: ex.id }) }) }, React.createElement(Trash2, { size: 12 })))
    execRows.push(React.createElement('div', { key: ex.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', transition: 'none' } }, row))
  }
  const todoPanel = React.createElement('div', {
    style: { width: 280, flexShrink: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 10, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)', border: '1px solid var(--q-border)', padding: '12px', overflowY: 'auto' },
  }, [
    React.createElement('div', { key: 'sh', style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }, onClick: () => setOpenSched(!openSched) }, [
      openSched ? React.createElement(ChevronDown, { size: 14, style: { color: 'var(--q-text-secondary)' } }) : React.createElement(ChevronRightIcon, { size: 14, style: { color: 'var(--q-text-secondary)' } }),
      React.createElement(Clock, { size: 14, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', flex: 1 } }, 'Scheduled'),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, '(' + schedules.filter((x: any) => x.enabled).length + ')'),
    ]),
    openSched ? React.createElement('div', { key: 'sl', style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '45%', overflowY: 'auto' } }, schedRows.length ? schedRows : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 0' } }, 'Nothing scheduled.')) : null,
    React.createElement('div', { key: 'eh', style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }, onClick: () => setOpenExec(!openExec) }, [
      openExec ? React.createElement(ChevronDown, { size: 14, style: { color: 'var(--q-text-secondary)' } }) : React.createElement(ChevronRightIcon, { size: 14, style: { color: 'var(--q-text-secondary)' } }),
      React.createElement(Bot, { size: 14, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-interface)', flex: 1 } }, 'Executions'),
      React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-interface)' } }, '(' + executions.length + ')'),
    ]),
    openExec ? React.createElement('div', { key: 'el', style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '45%', overflowY: 'auto' } }, execRows.length ? execRows : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', padding: '6px 0' } }, 'No executions yet.')) : null,
  ])

  // === Header (come la chat: Home | sidebar) ===
  const IconBtn = ({ icon: Icon, onClick }: { icon: React.FC<any>; onClick: () => void }) => {
    const [h, setH] = useState(false)
    return React.createElement('button', {
      onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false),
      style: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', padding: '0', backgroundColor: h ? 'var(--q-hover)' : 'transparent', color: h ? 'var(--q-text)' : 'var(--q-text-secondary)', transition: 'none' },
    }, React.createElement(Icon, { size: 20 }))
  }

  const headerKids: React.ReactNode[] = [
    React.createElement('div', { key: 'h1', style: panelStyle }, [React.createElement(IconBtn, { key: 'home', icon: Home, onClick: () => props.onSelectPanel('home') })]),
    React.createElement('div', { key: 'sp1', style: { width: '8px', flexShrink: 0 } }),
    React.createElement('div', { key: 'h2', style: panelStyle }, [React.createElement(IconBtn, { key: 'todo', icon: PanelLeft, onClick: () => setShowTodo(!showTodo) })]),
    React.createElement('div', { key: 'sp2', style: { width: '8px', flexShrink: 0 } }),
    React.createElement('div', { key: 'h3', style: { ...panelStyle, flex: 1, minWidth: 0 } }, [
      React.createElement(Calendar, { key: 'ic', size: 18, style: { color: 'var(--q-text-secondary)', flexShrink: 0 } }),
      React.createElement('div', { key: 'sp0', style: { width: '12px', flexShrink: 0 } }),
      React.createElement('span', { key: 'ti', style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' } }, 'Agents Calendar'),
      React.createElement('div', { key: 'fx', style: { flex: 1 } }),
      React.createElement('button', { key: 'm', onClick: () => setMode('month'), style: modeBtn('month', mode) }, 'Month'),
      React.createElement('button', { key: 'w', onClick: () => setMode('week'), style: modeBtn('week', mode) }, 'Week'),
      React.createElement('div', { key: 'sp3', style: { width: '10px', flexShrink: 0 } }),
      React.createElement('button', { key: 'prev', onClick: () => nav(-1), style: btnGhost }, React.createElement(ChevronLeft, { size: 14 })),
      React.createElement('button', { key: 'today', onClick: () => { const n = today0(); setSelected(n); setView(n); setMode('month') }, style: btnGhost }, 'Today'),
      React.createElement('button', { key: 'next', onClick: () => nav(1), style: btnGhost }, React.createElement(ChevronRight, { size: 14 })),
      React.createElement('div', { key: 'sp4', style: { width: '10px', flexShrink: 0 } }),
      React.createElement('span', { key: 'dt', style: { color: 'var(--q-text)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-interface)', minWidth: 130, whiteSpace: 'nowrap' } }, fullDate(selected)),
    ]),
  ]

  // Modale orario preciso (click su attività)
  let editModal: React.ReactElement | null = null
  if (editSched) {
    const dv: any = editSched.day || new Date()
    const inputStyle: React.CSSProperties = { width: 64, padding: '4px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-code)', textAlign: 'center' }
    editModal = React.createElement('div', { key: 'modal', style: { position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setEditSched(null) }, React.createElement('div', { style: { backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: 20, minWidth: 320 }, onClick: (e: any) => e.stopPropagation() }, [
      React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: 12 } }, 'Exact time'),
      React.createElement('div', { key: 'ctrls', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
        DateEditor({ value: dv, onChange: (nd: any) => setEditSched({ ...editSched, day: nd }) }),
      ]),
      React.createElement('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 } }, [
        React.createElement('input', { style: inputStyle, defaultValue: String(editSched.h).padStart(2, '0'), id: 'edh', type: 'number', min: 0, max: 23 }),
        React.createElement('span', { style: { color: 'var(--q-text-secondary)' } }, ':'),
        React.createElement('input', { style: inputStyle, defaultValue: String(editSched.m).padStart(2, '0'), id: 'edm', type: 'number', min: 0, max: 59 }),
        React.createElement('span', { style: { color: 'var(--q-text-secondary)' } }, ':'),
        React.createElement('input', { style: inputStyle, defaultValue: String(editSched.s).padStart(2, '0'), id: 'eds', type: 'number', min: 0, max: 59 }),
      ]),
      React.createElement('div', { key: 'btns', style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 } }, [
        React.createElement('button', { onClick: () => setEditSched(null), style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Cancel'),
        React.createElement('button', { onClick: async () => {
          const hh = parseInt((document.getElementById('edh') as HTMLInputElement)?.value || '0', 10)
          const mm = parseInt((document.getElementById('edm') as HTMLInputElement)?.value || '0', 10)
          const ss = parseInt((document.getElementById('eds') as HTMLInputElement)?.value || '0', 10)
          await setScheduleTime(editSched.id, editSched.day || new Date(), hh || 0, mm || 0, ss || 0)
          setEditSched(null)
        }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-accent-calendar)', background: 'transparent', color: 'var(--q-accent-calendar)', fontSize: 13, fontFamily: 'var(--font-interface)', fontWeight: 600, cursor: 'pointer' } }, 'Save'),
      ]),
    ]))
  }

  return React.createElement('div', { className: 'h-full flex flex-col', style: { width: '100%', position: 'relative', overflow: 'hidden' } }, [
    React.createElement('div', { key: 'hdr', style: { marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, width: '100%' } }, headerKids),
    React.createElement('div', { key: 'body', ref: bodyRef, style: { flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: '0 4px 4px 4px', overflow: 'hidden' } }, [
      showTodo ? todoPanel : null,
      React.createElement('div', { key: 'cal', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden', height: '100%' } }, [
        mode === 'month' ? React.createElement('div', { key: 'wh', style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, flexShrink: 0 } }, WEEK.map((w) => React.createElement('div', { key: w, style: { color: 'var(--q-text-tertiary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', textAlign: 'center', padding: 4 } }, w))) : null,
        calendarGrid,
      ]),
      editModal,
    ]),
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

function DateEditor({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  return React.createElement('input', { style: { width: 150, padding: '4px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-code)' }, type: 'date', value: value.toISOString().slice(0, 10), onChange: (e: any) => { const nd = new Date(e.target.value + 'T' + value.toLocaleTimeString('en-GB')); if (!isNaN(nd.getTime())) onChange(nd) } })
}