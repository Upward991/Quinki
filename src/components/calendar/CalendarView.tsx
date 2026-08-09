import React, { useState, useEffect, useCallback } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Calendar, Clock, Play, X, RotateCcw, Trash2, RefreshCw, Bot } from '../icons'

const STATUS_COLOR: Record<string, string> = {
  queued: 'var(--q-accent-warning)',
  running: 'var(--q-accent-info)',
  completed: 'var(--q-accent-success)',
  failed: 'var(--q-accent-danger)',
  cancelled: 'var(--q-text-tertiary)',
  interrupted: 'var(--q-accent-warning)',
  missed: 'var(--q-text-tertiary)',
}

const week = ['L', 'M', 'M', 'G', 'V', 'S', 'D']

function fmtWhen(s: any): string {
  const w = s.when || {}
  if (w.type === 'once') return w.date ? 'Once · ' + new Date(w.date).toLocaleString() : 'Once'
  if (w.type === 'daily') return 'Daily at ' + (w.at || '08:00')
  if (w.type === 'weekly') return 'Weekly at ' + (w.at || '08:00') + ' (days ' + (w.daysOfWeek || []).map((d: number) => week[d - 1] || d).join(',') + ')'
  if (w.type === 'monthly') return 'Monthly at ' + (w.at || '08:00') + ' (day ' + (w.dayOfMonth ?? 1) + ')'
  return w.type || '?'
}

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) +
    (sameYear ? '' : ' ' + d.getFullYear())
  )
}

const btnAccent: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)',
  backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600,
  fontFamily: 'var(--font-interface)', cursor: 'pointer', transition: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
}
const btnGhost: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)',
  backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
  cursor: 'pointer', transition: 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
}
const btnText: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
  cursor: 'pointer', padding: '2px 4px', display: 'inline-flex', alignItems: 'center', gap: 4,
}

function Chip({ color, text }: { color: string; text: string }) {
  return React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)',
      color, border: '1px solid ' + color, backgroundColor: 'transparent', letterSpacing: 0.2,
      textTransform: 'capitalize', flexShrink: 0,
    },
  }, text)
}

function Row({ s }: { s: any }) {
  // Ritorna un blocchetto contenitore per allineare gli elementi in riga
  return React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', width: '100%',
    },
  }, s)
}

function SectionTitle({ icon, label, extra }: { icon: React.ReactElement; label: string; extra?: string }) {
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 } }, [
    icon,
    React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, label),
    extra ? React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)' } }, extra) : null,
  ])
}

export function CalendarView(props: { activePanel: string; onSelectPanel: (p: string) => void; agents?: any[]; onOpenSession?: (key: string) => void }) {
  const { call } = useSidecarContext()
  const [schedules, setSchedules] = useState<any[]>([])
  const [executions, setExecutions] = useState<any[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const a = await call('listSchedules')
      const b = await call('listExecutions')
      setSchedules(a?.schedules || [])
      setExecutions(b?.executions || [])
    } catch {}
  }, [call])

  useEffect(() => {
    refresh()
    const iv = setInterval(refresh, 4000)
    return () => clearInterval(iv)
  }, [refresh])

  const act = useCallback(async (fn: () => Promise<any>) => {
    setBusy(true)
    try { await fn() } catch {}
    await refresh()
    setBusy(false)
  }, [refresh])

  // ---- Schedule rows ----
  const scheduleRows: React.ReactElement[] = schedules.map((s: any) => {
    const inner: React.ReactElement[] = []
    inner.push(React.createElement(Chip, { key: 'chip', color: s.enabled ? 'var(--q-accent-calendar)' : 'var(--q-text-tertiary)', text: s.enabled ? 'scheduled' : 'off' }))
    inner.push(React.createElement('div', { key: 'mid', style: { flex: 1, minWidth: 0 } }, [
      React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.title || '(untitled)'),
      React.createElement('div', { key: 'd', style: { color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)', marginTop: 2 } },
        fmtWhen(s) + ' · agents: ' + (s.agentIds || []).join(', ') + (s.lastFiredAt ? ' · last run ' + fmtTs(s.lastFiredAt) : '')),
    ]))
    inner.push(React.createElement('div', { key: 'next', style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', textAlign: 'right', flexShrink: 0 } },
      s.nextFireAt ? 'next ' + fmtTs(s.nextFireAt) : (s.enabled ? '—' : 'done')))
    if (s.enabled) {
      inner.push(React.createElement('button', {
        key: 'run', style: btnGhost, onClick: () => act(async () => { await call('runScheduleNow', { id: s.id }) }),
      }, React.createElement(Play, { size: 13 }), 'Run now'))
    }
    inner.push(React.createElement('button', {
      key: 'del', style: btnText, onClick: () => act(async () => { await call('deleteSchedule', { id: s.id }) }),
    }, React.createElement(Trash2, { size: 13 })))
    return React.createElement(Row, { key: s.id, s: inner })
  })

  const emptyText = React.createElement('div', { key: 'empty', style: { color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '8px 0' } },
    'Nothing scheduled. Ask an agent in chat: "tomorrow at 7am do X" — it will appear here.')

  // ---- Execution rows ----
  const execRows: React.ReactElement[] = executions.map((ex: any) => {
    const inner: React.ReactElement[] = []
    inner.push(React.createElement(Chip, { key: 'chip', color: STATUS_COLOR[ex.status] || 'var(--q-text-tertiary)', text: ex.status || '?' }))
    inner.push(React.createElement('div', { key: 'mid', style: { flex: 1, minWidth: 0 } }, [
      React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ex.label || ex.id),
      React.createElement('div', { key: 'd', style: { color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)', marginTop: 2 } },
        (ex.agentIds || []).join(', ') + ' · ' + fmtTs(ex.createdAt) +
        (ex.scheduledFor && ex.status === 'completed' && ex.endedAt && ex.scheduledFor < ex.endedAt ? ' · late' : '') +
        (ex.error ? ' · ' + String(ex.error).slice(0, 60) : '')),
    ]))
    if (ex.status === 'running' || ex.status === 'queued') {
      inner.push(React.createElement('button', {
        key: 'cancel', style: btnGhost, onClick: () => act(async () => { await call('cancelExecution', { executionId: ex.id }) }),
      }, React.createElement(X, { size: 13 }), 'Cancel'))
    }
    if (ex.status === 'interrupted') {
      inner.push(React.createElement('button', {
        key: 'res', style: btnGhost, onClick: () => act(async () => { await call('resumeExecution', { executionId: ex.id }) }),
      }, React.createElement(RotateCcw, { size: 13 }), 'Resume'))
    }
    inner.push(React.createElement('button', {
      key: 'del', style: btnText, onClick: () => act(async () => { await call('deleteExecution', { executionId: ex.id }) }),
    }, React.createElement(Trash2, { size: 13 })))
    return React.createElement(Row, { key: ex.id, s: inner })
  })

  const execEmpty = React.createElement('div', { key: 'empty', style: { color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '8px 0' } }, 'No executions yet.')

  const header = React.createElement('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, justifyContent: 'space-between' } }, [
    React.createElement('div', { key: 'tt', style: { display: 'flex', alignItems: 'center', gap: 10 } }, [
      React.createElement(Calendar, { size: 22, style: { color: 'var(--q-accent-calendar)' } }),
      React.createElement('span', { key: 'l', style: { color: 'var(--q-text)', fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Agents Calendar'),
    ]),
    React.createElement('button', {
      key: 'r', style: btnAccent, onClick: () => act(async () => {}),
      onMouseEnter: (ev: any) => { ev.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; ev.currentTarget.style.color = 'var(--q-bg)' },
      onMouseLeave: (ev: any) => { ev.currentTarget.style.backgroundColor = 'transparent'; ev.currentTarget.style.color = 'var(--q-tab-accent)' },
    }, React.createElement(RefreshCw, { size: 15 }), React.createElement('span', { key: 'rt' }, 'Refresh')),
  ])

  return React.createElement('div', { className: 'q-scroll', style: { flex: 1, overflowY: 'auto', padding: '16px 20px' } }, [
    header,
    React.createElement(SectionTitle, {
      key: 'st', icon: React.createElement(Clock, { size: 16, style: { color: 'var(--q-accent-calendar)' } }),
      label: 'Scheduled tasks', extra: '(' + schedules.filter((x: any) => x.enabled).length + ' active)',
    }),
    React.createElement('div', { key: 'slist', style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 } },
      scheduleRows.length ? scheduleRows : emptyText),
    React.createElement(SectionTitle, {
      key: 'et', icon: React.createElement(Bot, { size: 16, style: { color: 'var(--q-accent-calendar)' } }),
      label: 'Executions', extra: '(' + executions.length + ')',
    }),
    React.createElement('div', { key: 'elist', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      execRows.length ? execRows : execEmpty),
  ])
}