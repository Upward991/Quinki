import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Home, Checklist, Play, X, RotateCcw, Trash2, Search, Plus, Filter, Check, ChevronDown, ChevronRight, PanelLeft, Maximize, Minimize } from '../icons'

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
const GROUP_DEFS: { key: string; label: string; color: string }[] = [
  { key: 'scheduled', label: 'Scheduled', color: 'var(--q-accent-calendar)' },
  { key: 'running', label: 'Execution', color: 'var(--q-accent-info)' },
  { key: 'completed', label: 'Completed', color: 'var(--q-accent-success)' },
  { key: 'failed', label: 'Failed', color: 'var(--q-accent-danger)' },
  { key: 'cancelled', label: 'Cancelled', color: 'var(--q-text-tertiary)' },
]
const COLS: { key: string; label: string }[] = [{ key: 'title', label: 'Task' }, { key: 'agent', label: 'Agent' }, { key: 'chat', label: 'Chat' }, { key: 'when', label: 'Date & Time' }]

const panelStyle: React.CSSProperties = { backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)', padding: '8px', minHeight: 'var(--spacing-header-min)', display: 'flex', alignItems: 'center' }
const btnText: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer', padding: '3px', display: 'inline-flex', alignItems: 'center', gap: 4 }
const cellBorder = '1px solid var(--q-border)'

function fmtDT(ts: number | null | undefined): string { if (!ts) return '—'; const d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) }
function Chip({ color, text }: { color: string; text: string }) { return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', color, border: '1px solid ' + color, backgroundColor: 'transparent', letterSpacing: 0.2, textTransform: 'capitalize', flexShrink: 0 } }, text) }
function FilterChip({ label, values, options, onChange }: { label: string; values: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])
  const sorted = [...options].sort((a, b) => {
    const ai = values.includes(a) ? 0 : 1
    const bi = values.includes(b) ? 0 : 1
    if (ai !== bi) return ai - bi
    return a.localeCompare(b)
  })
  const filtered = sorted.filter(o => !q.trim() || o.toLowerCase().includes(q.trim().toLowerCase()))
  const has = values.length > 0
  return React.createElement('div', { style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 2 } }, [
    React.createElement('button', { key: 'b', onClick: () => { setOpen(!open); setQ('') }, title: label, style: { display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (has ? 'var(--q-tab-accent)' : 'var(--q-border)'), backgroundColor: has ? 'var(--q-active)' : 'var(--q-bg-elevated)', color: has ? 'var(--q-tab-accent)' : 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', cursor: 'pointer', maxWidth: 260 } }, [
      React.createElement('span', { key: 't', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, has ? label + ': ' + values.join(', ') : label),
      open ? React.createElement(ChevronDown, { key: 'a', size: 14, style: { flexShrink: 0 } }) : React.createElement(ChevronRight, { key: 'a', size: 14, style: { flexShrink: 0 } }),
    ]),
    has ? React.createElement('button', { key: 'x', title: 'Clear ' + label, onClick: () => onChange([]), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-tab-accent)', padding: 2, display: 'flex' } }, React.createElement(X, { size: 13 })) : null,
    open ? React.createElement(React.Fragment, { key: 'm' }, [
      React.createElement('div', { key: 'o', style: { position: 'fixed', inset: 0, zIndex: 150 }, onClick: () => setOpen(false) }),
      React.createElement('div', { key: 'd', style: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 151, minWidth: 230, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 3 } }, [
        React.createElement('input', { key: 'i', autoFocus: true, value: q, onChange: (e: any) => setQ(e.target.value), placeholder: 'Search ' + label.toLowerCase() + '...', style: { padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', width: '100%', boxSizing: 'border-box', marginBottom: 5 } }),
        filtered.length === 0 ? React.createElement('div', { key: 'e', style: { color: 'var(--q-text-tertiary)', fontSize: 14, fontFamily: 'var(--font-interface)', padding: '8px 10px' } }, 'No options') :
          filtered.map(o => React.createElement('label', { key: o, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-interface)', color: 'var(--q-text)', backgroundColor: values.includes(o) ? 'var(--q-active)' : 'transparent' } }, [
            React.createElement('input', { key: 'c', type: 'checkbox', checked: values.includes(o), onChange: () => toggle(o), style: { accentColor: 'var(--q-tab-accent)', cursor: 'pointer' } }),
            React.createElement('span', { key: 'l' }, o),
          ])),
        values.length > 0 ? React.createElement('button', { key: 'cl', onClick: () => { onChange([]); setOpen(false) }, style: { alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: 14, fontFamily: 'var(--font-interface)', padding: '5px 8px', marginTop: 2 } }, 'Clear') : null,
      ]),
    ]) : null,
  ])
}

function RowBtn({ title, onClick, children, color }: { title: string; onClick: () => void; children: React.ReactNode; color?: string }) {
  const [h, setH] = useState(false)
  return React.createElement('button', { title, onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { background: h ? 'var(--q-hover)' : 'none', border: 'none', cursor: 'pointer', color: color || 'var(--q-text-secondary)', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', flexShrink: 0, transition: 'none' } }, children)
}
function ViewRow({ v, active, renaming, renameVal, onRenameChange, onRenameCommit, onRenameCancel, onSelect, onContextMenu, multiSel, selected, onToggleSel }: { v: ViewCfg; active: boolean; renaming: boolean; renameVal: string; onRenameChange: (s: string) => void; onRenameCommit: () => void; onRenameCancel: () => void; onSelect: () => void; onContextMenu: (e: React.MouseEvent, v: ViewCfg) => void; multiSel: boolean; selected: boolean; onToggleSel: () => void }) {
  const [h, setH] = useState(false)
  const isBase = v.id === BASE_ID
  const color = multiSel ? (selected ? 'var(--q-accent-danger)' : h ? 'var(--q-text)' : 'var(--q-text-secondary)') : active ? 'var(--q-tab-accent)' : h ? 'var(--q-text)' : 'var(--q-text-secondary)'
  return React.createElement('div', { onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { padding: '2px 8px' } }, [
    React.createElement('div', { onClick: multiSel ? onToggleSel : onSelect, onContextMenu: (e: any) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, v) }, style: { padding: '6px 8px', minHeight: '36px', borderRadius: 'var(--radius-md)', backgroundColor: h ? 'var(--q-hover)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box' } }, [
      React.createElement(Checklist, { key: 'i', size: 20, style: { color, flexShrink: 0 } }),
      renaming ? React.createElement('input', { key: 'r', autoFocus: true, value: renameVal, onChange: (e: any) => onRenameChange(e.target.value), onBlur: () => onRenameCommit(), onKeyDown: (e: any) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel() }, onClick: (e: any) => e.stopPropagation(), style: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', padding: 0 } })
      : React.createElement('span', { key: 'n', style: { flex: 1, color, fontSize: 14, fontWeight: active ? 700 : 500, fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, v.name),
    ]),
  ])
}

interface Item { id: string; kind: 'sched' | 'exec'; title: string; agent: string; chat: string; status: string; when: number | null; error: string; ex?: any }
interface ViewCfg { id: string; name: string; type: 'table' | 'board'; f: { q: string; status: string; agents: string[]; chats: string[] } }
const BASE_ID = 'v-table'
const VIEWS_KEY = 'quinki-views-v1'
function normalizeF(f: any): ViewCfg['f'] {
  const out: ViewCfg['f'] = { q: f?.q || '', status: f?.status || 'all', agents: [], chats: [] }
  if (Array.isArray(f?.agents)) out.agents = f.agents
  else if (typeof f?.agent === 'string' && f.agent !== 'all') out.agents = [f.agent]
  if (Array.isArray(f?.chats)) out.chats = f.chats
  else if (typeof f?.chat === 'string' && f.chat !== 'all') out.chats = [f.chat]
  return out
}
function normViews(v: any): ViewCfg[] { return (Array.isArray(v) ? v : []).map((x: any) => ({ id: x.id, name: x.name, type: x.type === 'board' ? 'board' : 'table', f: normalizeF(x.f) })) }
function loadViews(): ViewCfg[] { try { const s = localStorage.getItem(VIEWS_KEY); if (s) { const v = normViews(JSON.parse(s)); if (v.length) return v } } catch {} return [{ id: BASE_ID, name: 'All', type: 'table', f: { q: '', status: 'all', agents: [], chats: [] } }] }
const DEFAULT_VIEWS: ViewCfg[] = [{ id: BASE_ID, name: 'All', type: 'table', f: { q: '', status: 'all', agents: [], chats: [] } }]

export function CalendarView(props: { activePanel: string; onSelectPanel: (p: string) => void; agents?: any[]; onOpenSession?: (key: string) => void }) {
  const { call, subscribe } = useSidecarContext()
  const [schedules, setSchedules] = useState<any[]>([])
  const [executions, setExecutions] = useState<any[]>([])
  const [views, setViews] = useState<ViewCfg[]>(loadViews)
  const [activeId, setActiveId] = useState<string>(() => { const v = loadViews(); return v[0]?.id || BASE_ID })
  const [sortKey, setSortKey] = useState<string>('when'); const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [cols, setCols] = useState<string[]>(COLS.map(c => c.key))
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [hoverRow, setHoverRow] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [deleteViews, setDeleteViews] = useState<ViewCfg[] | null>(null)
  const [renamingView, setRenamingView] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [allHover, setAllHover] = useState(false)
  const [sideMode, setSideMode] = useState<'open' | 'hidden' | 'peek'>('open')
  const [sideW, setSideW] = useState(260)
  const [draggingSide, setDraggingSide] = useState(false)
  const [newViewFlash, setNewViewFlash] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; view: ViewCfg } | null>(null)
  const [multiSel, setMultiSel] = useState(false)
  const [selViews, setSelViews] = useState<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!draggingSide) return
    const onMove = (e: MouseEvent) => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      setSideW(Math.max(180, Math.min(420, e.clientX - rect.left)))
    }
    const onUp = () => setDraggingSide(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [draggingSide])
  const [filterBarOpen, setFilterBarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [fullWidth, setFullWidth] = useState(() => { try { return localStorage.getItem('quinki-tasks-fullwidth') === '1' } catch { return false } })
  const saveUi = (fw: boolean, v: ViewCfg[]) => {
    try { localStorage.setItem('quinki-tasks-fullwidth', fw ? '1' : '0'); localStorage.setItem(VIEWS_KEY, JSON.stringify(v)) } catch {}
    call('saveUiState', { state: { fullWidth: fw, views: v } }).catch(() => {})
  }
  useEffect(() => {
    let alive = true
    call('getUiState').then((s: any) => {
      if (!alive || !s) return
      if (typeof s.fullWidth === 'boolean') setFullWidth(s.fullWidth)
      if (Array.isArray(s.views) && s.views.length) { const nv = normViews(s.views); setViews(nv); setActiveId(nv[0].id) }
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const view = views.find(v => v.id === activeId) || views[0]
  // Normalizza SEMPRE f: le viste salvate in formato vecchio (agent/chat stringhe)
  // potrebbero non avere agents/chats array -> crash su .length
  const f = normalizeF(view ? view.f : null)
  const persist = (v: ViewCfg[]) => { setViews(v); saveUi(fullWidth, v) }
  const patchF = (patch: Partial<ViewCfg['f']>) => { const v = { ...view, f: { ...view.f, ...patch } }; persist(views.map(x => x.id === v.id ? v : x)) }

  const refresh = useCallback(async () => { try { const a = await call('listSchedules'); const b = await call('listExecutions'); setSchedules(a?.schedules || []); setExecutions(b?.executions || []) } catch {} }, [call])
  useEffect(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv) }, [refresh])
  useEffect(() => { const u = subscribe?.('execution_update', refresh); return () => { if (u) try { u() } catch {} } }, [refresh, subscribe])
  useEffect(() => { const u = subscribe?.('schedule_update', refresh); return () => { if (u) try { u() } catch {} } }, [refresh, subscribe])
  const act = useCallback(async (fn: () => Promise<any>) => { try { await fn() } catch {}; await refresh() }, [refresh])

  const items: Item[] = []
  for (const s of schedules || []) items.push({ id: s.id, kind: 'sched', title: s.title || '(untitled)', agent: (s.agentIds || []).join(', ') || '—', chat: s.sourceSession ? (s.sourceSession.label || s.sourceSession.key) : '—', status: s.enabled ? 'scheduled' : 'off', when: s.nextFireAt || (s.lastFiredAt ? s.lastFiredAt : null), error: '', ex: undefined })
  for (const ex of executions || []) items.push({ id: ex.id, kind: 'exec', title: ex.label || ex.id, agent: (ex.agentIds || []).join(', ') || '—', chat: '—', status: ex.status || '?', when: ex.scheduledFor || ex.createdAt || null, error: ex.error ? String(ex.error).slice(0, 60) : '', ex })

  const chats = Array.from(new Set(items.map(i => i.chat).filter(c => c && c !== '—')))
  const agents = Array.from(new Set(items.map(i => i.agent).filter(a => a && a !== '—')))
  let filtered = items.filter(i => {
    if (f.q && !i.title.toLowerCase().includes(f.q.toLowerCase())) return false
    if (f.status !== 'all' && bucketOf(i.status) !== f.status) return false
    if (f.chats.length > 0 && !f.chats.includes(i.chat)) return false
    if (f.agents.length > 0 && !f.agents.includes(i.agent)) return false
    return true
  })
  const cmp = (a: Item, b: Item) => { let av: any = (a as any)[sortKey], bv: any = (b as any)[sortKey]; if (typeof av === 'string') av = av.toLowerCase(); if (typeof bv === 'string') bv = bv.toLowerCase(); if (av == null) av = ''; if (bv == null) bv = ''; return av < bv ? -1 * sortDir : av > bv ? 1 * sortDir : 0 }
  filtered = [...filtered].sort(cmp)
  const toggleSort = (key: string) => { if (sortKey === key) setSortDir(sortDir === 1 ? -1 : 1); else { setSortKey(key); setSortDir(1) } }
  function bucketOf(st: string): string { if (st === 'scheduled' || st === 'off') return 'scheduled'; if (st === 'running' || st === 'queued' || st === 'interrupted') return 'running'; if (st === 'completed') return 'completed'; if (st === 'cancelled') return 'cancelled'; return 'failed' }

  const actions = (i: Item) => {
    const b: React.ReactNode[] = []
    if (i.kind === 'sched') { if (i.status === 'scheduled') b.push(React.createElement('button', { key: 'run', style: btnText, title: 'Run now', onClick: () => act(async () => { await call('runScheduleNow', { id: i.id }) }) }, React.createElement(Play, { size: 15 }))); b.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteSchedule', { id: i.id }) }) }, React.createElement(Trash2, { size: 15 }))) }
    else { if (i.status === 'running' || i.status === 'queued') b.push(React.createElement('button', { key: 'stop', style: btnText, title: 'Stop', onClick: () => act(async () => { await call('stopExecution', { executionId: i.id }) }) }, React.createElement(X, { size: 15 }))); if (i.status === 'interrupted') b.push(React.createElement('button', { key: 'res', style: btnText, title: 'Resume', onClick: () => act(async () => { await call('resumeExecution', { executionId: i.id }) }) }, React.createElement(RotateCcw, { size: 15 }))); if (i.status === 'failed' || i.status === 'cancelled') b.push(React.createElement('button', { key: 'retry', style: btnText, title: 'Retry', onClick: () => act(async () => { if (i.ex?.scheduleId) await call('runScheduleNow', { id: i.ex.scheduleId }); else await call('runTask', { label: i.ex.label, agentIds: i.ex.agentIds, workingDir: i.ex.workingDir, mode: i.ex.mode, model: i.ex.model, text: i.ex.text }) }) }, React.createElement(RotateCcw, { size: 15 }))); b.push(React.createElement('button', { key: 'del', style: btnText, title: 'Delete', onClick: () => act(async () => { await call('deleteExecution', { executionId: i.id }) }) }, React.createElement(Trash2, { size: 15 }))) }
    return React.createElement('div', { key: 'acts', style: { display: 'flex', gap: 4 } }, b)
  }
  const cellVal = (i: Item, key: string): React.ReactNode => { if (key === 'when') return i.when ? fmtDT(i.when) : '—'; if (key === 'title') return i.title; if (key === 'agent') return i.agent; if (key === 'chat') return i.chat; return '' }
  const cellStyle = (align = 'left', rightBorder = true): React.CSSProperties => ({ padding: '9px 12px', borderBottom: cellBorder, borderRight: rightBorder ? cellBorder : 'none', color: 'var(--q-text-secondary)', fontSize: 13.5, fontFamily: 'var(--font-interface)', textAlign: align as any, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })

  // Tabella per un gruppo (header colonne + righe) — la stessa struttura in ogni toggle
  const tableFor = (rows: Item[]) => {
    const thead = React.createElement('tr', { key: 'thr' }, cols.map((k, idx) => { const c = COLS.find(x => x.key === k); return React.createElement('th', { key: k, draggable: true, onDragStart: (e: any) => { setDragCol(k); e.dataTransfer.effectAllowed = 'move' }, onDragOver: (e: any) => e.preventDefault(), onDrop: (e: any) => { e.preventDefault(); if (!dragCol || dragCol === k) { setDragCol(null); return } setCols(prev => { const arr = [...prev]; const from = arr.indexOf(dragCol); const to = arr.indexOf(k); arr.splice(from, 1); arr.splice(to, 0, dragCol); return arr }); setDragCol(null) }, onClick: () => toggleSort(k), style: { padding: '9px 12px', borderBottom: cellBorder, borderRight: idx < cols.length - 1 ? cellBorder : 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', userSelect: 'none', background: dragCol === k ? 'var(--q-hover)' : 'transparent' } }, c ? c.label : '') }))
    const tbody = rows.map(i => React.createElement('tr', { key: i.id, onMouseEnter: () => setHoverRow(i.id), onMouseLeave: () => setHoverRow(null), style: { backgroundColor: hoverRow === i.id ? 'var(--q-hover)' : 'transparent', transition: 'none' } }, cols.map((k, idx) => { const isHov = hoverRow === i.id; if (k === 'title') { return React.createElement('td', { key: k, style: cellStyle('left', idx < cols.length - 1) }, React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, [React.createElement('span', { key: 't', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--q-text)' } }, i.title), isHov ? React.createElement('span', { key: 'a' }, actions(i)) : null])) } return React.createElement('td', { key: k, style: cellStyle('left', idx < cols.length - 1) }, cellVal(i, k)) })))
    return React.createElement('div', { key: 'tbl', style: { width: '100%', overflowX: 'auto' } }, React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' } }, [React.createElement('thead', { key: 'th' }, thead), React.createElement('tbody', { key: 'tb' }, tbody.length ? tbody : React.createElement('tr', { key: 'e' }, React.createElement('td', { colSpan: cols.length, style: { padding: 16, textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', border: 'none' } }, 'No tasks in this group.')))]))
  }

  // Vista TABLE = toggle per status (Notion group-by-status)
  const tableWrap = React.createElement('div', { key: 'tbl', style: { width: '100%' } }, GROUP_DEFS.map(g => {
    const gItems = filtered.filter(i => bucketOf(i.status) === g.key)
    const open = !!openGroups[g.key]
    return React.createElement('div', { key: g.key, style: { marginBottom: 6 } }, [
      React.createElement('div', { key: 'h', onClick: () => setOpenGroups(prev => ({ ...prev, [g.key]: !prev[g.key] })), style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', cursor: 'pointer', userSelect: 'none' } }, [
        open ? React.createElement(ChevronDown, { size: 16, style: { color: 'var(--q-text-secondary)' } }) : React.createElement(ChevronRight, { size: 16, style: { color: 'var(--q-text-secondary)' } }),
        React.createElement('span', { style: { width: 8, height: 8, borderRadius: 4, backgroundColor: g.color } }),
        React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-interface)' } }, g.label),
        React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' } }, '(' + gItems.length + ')'),
      ]),
      open ? tableFor(gItems) : null,
    ])
  }))

  // Vista BOARD (5 colonne)
  const groups: { key: string; label: string; color: string; items: Item[] }[] = GROUP_DEFS.map(g => ({ ...g, items: [] }))
  for (const i of filtered) { const g = groups.find(x => x.key === bucketOf(i.status)); if (g) g.items.push(i) }
  const board = React.createElement('div', { key: 'bd', style: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start', flex: 1, minHeight: 0 } }, groups.map(g => React.createElement('div', { key: g.key, style: { flex: '1 1 180px', minWidth: 170, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--q-border)', display: 'flex', flexDirection: 'column', maxHeight: '100%' } }, [
    React.createElement('div', { key: 'h', style: { padding: '10px 12px', color: 'var(--q-text)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-interface)', borderBottom: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', gap: 6 } }, [React.createElement('span', { style: { width: 8, height: 8, borderRadius: 4, backgroundColor: g.color } }), g.label, React.createElement('span', { style: { color: 'var(--q-text-tertiary)' } }, '(' + g.items.length + ')')]),
    React.createElement('div', { key: 'l', style: { padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 } }, g.items.length ? g.items.map(i => React.createElement('div', { key: i.id, style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 } }, [
      React.createElement('div', { key: 't', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [i.status === 'cancelled' ? React.createElement(X, { size: 14, style: { color: 'var(--q-text-tertiary)', flexShrink: 0 } }) : i.status === 'completed' ? React.createElement(Check, { size: 14, style: { color: 'var(--q-accent-success)', flexShrink: 0 } }) : null, React.createElement('span', { style: { color: 'var(--q-text)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, i.title)]),
      React.createElement('div', { key: 'a', style: { color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)' } }, 'agent: ' + i.agent),
      i.chat !== '—' ? React.createElement('div', { key: 'c', style: { color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)' } }, 'chat: ' + i.chat) : null,
      React.createElement('div', { key: 'w', style: { color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)' } }, fmtDT(i.when)),
      i.error ? React.createElement('div', { key: 'e', style: { color: 'var(--q-accent-danger)', fontSize: 12, fontFamily: 'var(--font-interface)' } }, i.error) : null,
      React.createElement('div', { key: 'x', style: { display: 'flex', justifyContent: 'flex-end', marginTop: 2 } }, actions(i)),
    ])) : React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: 10 } }, 'No tasks')),
  ])))

  // Toolbar: view dinamiche (base non eliminabile) + Filters + Search
  const addView = () => { const id = 'v' + Date.now(); const nv: ViewCfg = { id, name: 'View ' + (views.length + 1), type: 'table', f: { q: '', status: 'all', agents: [], chats: [] } }; persist([...views, nv]); setActiveId(id); setNewViewFlash(true); setTimeout(() => setNewViewFlash(false), 600) }
  const renameView = (id: string, name: string) => { const nm = name.trim(); if (!nm) { setRenamingView(null); setRenameVal(''); return } persist(views.map(x => x.id === id ? { ...x, name: nm } : x)); setRenamingView(null); setRenameVal('') }
  const doDelete = (targets: ViewCfg[]) => { const ids = new Set(targets.map(t => t.id)); const rem = views.filter(x => !ids.has(x.id)); persist(rem); if (ids.has(activeId)) setActiveId(rem[0]?.id || BASE_ID); setDeleteViews(null); setMultiSel(false); setSelViews(new Set()) }
  const hasActiveFilters = f.agents.length > 0 || f.chats.length > 0
  const filterBar = (filterBarOpen || hasActiveFilters) ? React.createElement('div', { key: 'fbar', style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0 0 0', flexWrap: 'wrap' } }, [
    React.createElement(FilterChip, { key: 'fA', label: 'Agent', values: f.agents, options: agents, onChange: (v: string[]) => patchF({ agents: v }) }),
    React.createElement(FilterChip, { key: 'fC', label: 'Chat', values: f.chats, options: chats, onChange: (v: string[]) => patchF({ chats: v }) }),
    hasActiveFilters ? React.createElement('button', { key: 'clr', onClick: () => patchF({ agents: [], chats: [] }), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '4px 6px' } }, 'Clear') : null,
  ]) : null
  const toolbar = React.createElement('div', { key: 'tb', style: { display: 'flex', flexDirection: 'column', padding: '4px 0 8px 0' } }, [
    React.createElement('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' } }, [
    React.createElement('span', { key: 'grow', style: { flex: 1 } }),
    searchOpen ? React.createElement('input', { key: 'si', autoFocus: true, value: f.q, onChange: (e: any) => patchF({ q: e.target.value }), onKeyDown: (e: any) => { if (e.key === 'Escape') setSearchOpen(false) }, placeholder: 'Search activities...', style: { width: 240, height: 30, padding: '0 12px', boxSizing: 'border-box', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', flexShrink: 0 } }) : null,
    React.createElement('div', { key: 'right', style: { display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 } }, [
      React.createElement(RowBtn, { key: 'search', title: 'Search', onClick: () => setSearchOpen(!searchOpen), color: f.q ? 'var(--q-tab-accent)' : undefined }, React.createElement(Search, { size: 18 })),
      React.createElement(RowBtn, { key: 'filters', title: 'Filters', onClick: () => setFilterBarOpen(!filterBarOpen), color: hasActiveFilters ? 'var(--q-tab-accent)' : undefined }, React.createElement(Filter, { size: 18 })),
      React.createElement(RowBtn, { key: 'fwbtn', title: fullWidth ? 'Default width' : 'Full width', onClick: () => { const nv = !fullWidth; setFullWidth(nv); saveUi(nv, views) } }, React.createElement(fullWidth ? Minimize : Maximize, { size: 18 })),
    ]),
    React.createElement('div', { key: 'sep', style: { height: 1, backgroundColor: 'var(--q-border)', marginTop: 6 } }),
  ]),
  filterBar,
])

  const IconBtn = ({ icon: Icon, onClick }: { icon: React.FC<any>; onClick: () => void }) => { const [h, setH] = useState(false); return React.createElement('button', { onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', padding: '0', backgroundColor: h ? 'var(--q-hover)' : 'transparent', color: h ? 'var(--q-text)' : 'var(--q-text-secondary)', transition: 'none' } }, React.createElement(Icon, { size: 20 })) }

  const isAllActive = activeId === BASE_ID
  const viewSidebar = React.createElement('div', { key: 'vsb', style: { position: 'absolute', top: 0, bottom: 0, left: 0, width: sideW, zIndex: 40, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, [
    React.createElement('div', { key: 'hdr', style: { padding: '8px' } }, [
      React.createElement('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
        React.createElement('button', { key: 'all', title: 'All views', onClick: () => setActiveId(views.find(v => v.id === BASE_ID)?.id || views[0]?.id || BASE_ID), onMouseEnter: () => setAllHover(true), onMouseLeave: () => setAllHover(false), style: { flex: 1, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: allHover ? 'var(--q-hover)' : 'transparent', color: isAllActive ? 'var(--q-tab-accent)' : allHover ? 'var(--q-text)' : 'var(--q-text-secondary)', padding: 0 } }, [React.createElement(Checklist, { key: 'i', size: 18 }), React.createElement('span', { key: 't', style: { fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'All')]),
        React.createElement(RowBtn, { key: 'add', title: 'New view', onClick: addView, color: newViewFlash ? 'var(--q-tab-accent)' : undefined }, React.createElement(Plus, { size: 18 })),
      ]),
    ]),
    React.createElement('div', { key: 'list', style: { flex: 1, overflowY: 'auto', paddingBottom: 8, scrollbarGutter: 'stable' } }, views.filter(v => v.id !== BASE_ID).map(v => React.createElement(ViewRow, { key: v.id, v, active: v.id === activeId, renaming: renamingView === v.id, renameVal, onRenameChange: setRenameVal, onRenameCommit: () => renameView(v.id, renameVal), onRenameCancel: () => { setRenamingView(null); setRenameVal('') }, onSelect: () => setActiveId(v.id), onContextMenu: (e: any, vv: ViewCfg) => setCtxMenu({ x: e.clientX, y: e.clientY, view: vv }), multiSel, selected: selViews.has(v.id), onToggleSel: () => setSelViews(prev => { const n = new Set(prev); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n }) }))),
    multiSel ? React.createElement('div', { key: 'mtb', style: { padding: '8px', borderTop: '1px solid var(--q-border)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } }, [
      React.createElement('button', { key: 'sa', onClick: () => setSelViews(new Set(views.filter(x => x.id !== BASE_ID).map(x => x.id))), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '4px 6px' } }, 'Select all'),
      React.createElement('button', { key: 'dl', onClick: () => { if (selViews.size) setDeleteViews(views.filter(v => selViews.has(v.id))) }, style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '4px 6px' } }, 'Delete'),
      React.createElement('button', { key: 'cx', onClick: () => { setMultiSel(false); setSelViews(new Set()) }, style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', padding: '4px 6px' } }, 'Cancel'),
      React.createElement('span', { key: 'cnt', style: { flex: 1, textAlign: 'right', color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)' } }, selViews.size + ' selected'),
    ]) : null,
    React.createElement('div', { key: 'rsz', onMouseDown: (e: any) => { e.preventDefault(); setDraggingSide(true) }, style: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 6, cursor: 'col-resize', zIndex: 5 } }),
  ])

  return React.createElement('div', { key: 'root', ref: rootRef, className: 'h-full flex flex-row', style: { width: '100%', position: 'relative', overflow: 'hidden' } }, [
    sideMode !== 'hidden' ? viewSidebar : null,
    React.createElement('div', { key: 'main', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingLeft: sideMode === 'open' ? sideW + 8 : 0 } }, [

    React.createElement('div', { key: 'hdrwrap', style: { width: '100%', maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', flexShrink: 0, paddingTop: '4px' } }, [
      React.createElement('div', { key: 'hdr', style: { marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 8, width: '100%' } }, [
        React.createElement('div', { key: 'h1', style: panelStyle }, [React.createElement(IconBtn, { key: 'home', icon: Home, onClick: () => props.onSelectPanel('home') })]),
        React.createElement('div', { key: 'h1b', style: panelStyle }, [React.createElement(IconBtn, { key: 'side', icon: PanelLeft, onClick: () => setSideMode(m => m === 'open' ? 'hidden' : 'open'), title: sideMode === 'open' ? 'Hide sidebar' : 'Show sidebar' })]),
        React.createElement('div', { key: 'h2', style: { ...panelStyle, flex: 1 } }, [React.createElement('div', { key: 'sp', style: { width: '8px', flexShrink: 0 } }), React.createElement(Checklist, { key: 'ic', size: 18, style: { color: 'var(--q-text-secondary)', flexShrink: 0 } }), React.createElement('div', { key: 'sp2', style: { width: '16px', flexShrink: 0 } }), React.createElement('span', { key: 'ti', style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Agents Tasks')]),
      ]),
    ]),
    React.createElement('div', { key: 'body', style: { flex: 1, minHeight: 0, padding: '0 0 8px 0', overflowY: 'auto', scrollbarGutter: 'stable' } }, [
      React.createElement('div', { key: 'dbwrap', style: { width: '100%', maxWidth: fullWidth ? '100%' : 'calc(var(--spacing-chat-max) - 32px)', margin: '0 auto', display: 'flex', flexDirection: 'column' } }, [
        toolbar,
        React.createElement('div', { key: 'content', style: { flex: 1, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable' } }, view.type === 'table' ? tableWrap : board),
      ]),
    ]),
    ]),
    sideMode === 'hidden' ? React.createElement('div', { key: 'strip', style: { position: 'absolute', top: 8, bottom: 8, left: 0, width: 12, zIndex: 10, cursor: 'pointer' }, onMouseEnter: () => setSideMode('peek') }) : null,
    sideMode === 'peek' ? React.createElement('div', { key: 'peekov', style: { position: 'absolute', top: 0, bottom: 0, left: sideW + 20, right: 0, zIndex: 30 }, onMouseLeave: () => setSideMode('hidden') }) : null,
    ctxMenu ? React.createElement(React.Fragment, { key: 'cm' }, [
      React.createElement('div', { key: 'o', style: { position: 'fixed', inset: 0, zIndex: 9998, backgroundColor: 'transparent' }, onClick: () => setCtxMenu(null), onContextMenu: (e: any) => { e.preventDefault(); setCtxMenu(null) } }),
      React.createElement('div', { key: 'm', style: { position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 170), top: Math.min(ctxMenu.y, window.innerHeight - 120), zIndex: 9999, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '4px 0', minWidth: 160, display: 'flex', flexDirection: 'column' } }, [
        ctxMenu.view.id !== BASE_ID ? React.createElement('button', { key: 'rn', onClick: () => { setRenamingView(ctxMenu.view.id); setRenameVal(ctxMenu.view.name); setCtxMenu(null) }, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { textAlign: 'left', padding: '7px 12px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-interface)' } }, 'Rename') : null,
        React.createElement('button', { key: 'sl', onClick: () => { setMultiSel(true); setSelViews(new Set([ctxMenu.view.id])); setCtxMenu(null) }, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { textAlign: 'left', padding: '7px 12px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-interface)' } }, 'Select'),
        ctxMenu.view.id !== BASE_ID ? React.createElement('button', { key: 'dl', onClick: () => { setDeleteViews([ctxMenu.view]); setCtxMenu(null) }, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { textAlign: 'left', padding: '7px 12px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)' } }, 'Delete') : null,
      ]),
    ]) : null,
    deleteViews ? React.createElement('div', { key: 'dv', style: { position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setDeleteViews(null) }, React.createElement('div', { style: { backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '20px 24px', minWidth: 320, maxWidth: 400 }, onClick: (e: any) => e.stopPropagation() }, [
      React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: 8 } }, deleteViews.length === 1 ? 'Delete view?' : 'Delete ' + deleteViews.length + ' views?'),
      React.createElement('div', { key: 'd', style: { color: 'var(--q-text-secondary)', fontSize: 14, fontFamily: 'var(--font-interface)', marginBottom: 16 } }, deleteViews.length === 1 ? 'The view "' + deleteViews[0].name + '" will be deleted.' : deleteViews.length + ' views will be deleted.'),
      React.createElement('div', { key: 'b', style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } }, [
        React.createElement('button', { key: 'c', onClick: () => setDeleteViews(null), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Cancel'),
        React.createElement('button', { key: 'ok', onClick: () => doDelete(deleteViews), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Delete'),
      ]),
    ])) : null,
  ])
}