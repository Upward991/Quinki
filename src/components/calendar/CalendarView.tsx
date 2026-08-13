import React, { useState, useEffect, useCallback, useRef } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useSidecarContext } from '../shared/AppShell'
import { ModelPickerModal, ThinkingPickerModal } from '../chat/ChatHeader'
import { Home, Checklist, Play, X, RotateCcw, Trash2, Search, Plus, Filter, Check, ChevronDown, ChevronRight, PanelLeft, MessageSquare, Maximize, Minimize } from '../icons'

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
const COLS: { key: string; label: string }[] = [{ key: 'title', label: 'Task' }, { key: 'agent', label: 'Agent' }, { key: 'chat', label: 'Chat' }, { key: 'mt', label: 'Model · Thinking' }, { key: 'when', label: 'Time · Date' }, { key: 'actions', label: '' }]

const panelStyle: React.CSSProperties = { backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)', padding: '8px', minHeight: 'var(--spacing-header-min)', display: 'flex', alignItems: 'center' }
const cellBorder = '1px solid var(--q-border)'

function fmtDT(ts: number | null | undefined): string { if (!ts) return '—'; const d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) }
function parseFlexDate(s: string): Date | null {
  const t = s.trim()
  if (!t) return null
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december']
  const MSHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  const parts = t.split(/[\/\-\s.,]+/).filter(Boolean)
  if (parts.length !== 3) return null
  let day = 0, month = -1, year = 0
  const mi = parts.findIndex(p => MONTHS.includes(p.toLowerCase()) || MSHORT.includes(p.toLowerCase()))
  if (mi === 1) { day = parseInt(parts[0]); const mn = parts[1].toLowerCase(); month = MONTHS.indexOf(mn); if (month === -1) month = MSHORT.indexOf(mn); year = parseInt(parts[2]) }
  else if (mi === 0) { const mn = parts[0].toLowerCase(); month = MONTHS.indexOf(mn); if (month === -1) month = MSHORT.indexOf(mn); day = parseInt(parts[1]); year = parseInt(parts[2]) }
  else { day = parseInt(parts[0]); month = parseInt(parts[1]) - 1; year = parseInt(parts[2]) }
  if (isNaN(day) || month < 0 || isNaN(year)) return null
  if (year < 100) year += 2000
  const d = new Date(year, month, day)
  return isNaN(d.getTime()) ? null : d
}
function parseFlexTime(s: string): { h: number; m: number; sec: number } | null {
  const t = s.trim()
  if (!t) return null
  const parts = t.split(/[\/:\-\s.,]+/).filter(Boolean)
  if (parts.length < 2) return null
  const h = parseInt(parts[0]), m = parseInt(parts[1]), sec = parts.length >= 3 ? parseInt(parts[2]) : 0
  if (isNaN(h) || isNaN(m)) return null
  return { h, m, sec: isNaN(sec) ? 0 : sec }
}
function Chip({ color, text }: { color: string; text: string }) { return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-interface)', color, border: '1px solid ' + color, backgroundColor: 'transparent', letterSpacing: 0.2, textTransform: 'capitalize', flexShrink: 0 } }, text) }
function FilterChip({ label, values, options, onChange }: { label: string; values: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<React.CSSProperties>({})
  const wrapRef = useRef<HTMLDivElement>(null)
  const openMenu = () => {
    const r = wrapRef.current?.getBoundingClientRect()
    const p: React.CSSProperties = {}
    if (r) {
      const menuW = 230, menuH = 240
      if (r.left + menuW > window.innerWidth - 8) p.right = 0; else p.left = 0
      if (r.bottom + menuH > window.innerHeight - 8) p.bottom = 'calc(100% + 8px)'; else p.top = 'calc(100% + 8px)'
    } else { p.left = 0; p.top = 'calc(100% + 8px)' }
    setPos(p)
  }
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])
  const sorted = [...options].sort((a, b) => {
    const ai = values.includes(a) ? 0 : 1
    const bi = values.includes(b) ? 0 : 1
    if (ai !== bi) return ai - bi
    return a.localeCompare(b)
  })
  const filtered = sorted.filter(o => !q.trim() || o.toLowerCase().includes(q.trim().toLowerCase()))
  const has = values.length > 0
  return React.createElement('div', { ref: wrapRef, style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 2 } }, [
    React.createElement('button', { key: 'b', onClick: () => { if (!open) openMenu(); setOpen(!open); setQ('') }, title: label, style: { display: 'flex', alignItems: 'center', gap: 5, height: 30, boxSizing: 'border-box', padding: '0 12px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (has ? 'var(--q-tab-accent)' : 'var(--q-border)'), backgroundColor: has ? 'var(--q-active)' : 'var(--q-bg-elevated)', color: has ? 'var(--q-tab-accent)' : 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', cursor: 'pointer', maxWidth: 260 } }, [
      React.createElement('span', { key: 't', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, has ? label + ': ' + values.join(', ') : label),
      open ? React.createElement(ChevronDown, { key: 'a', size: 14, style: { flexShrink: 0 } }) : React.createElement(ChevronRight, { key: 'a', size: 14, style: { flexShrink: 0 } }),
    ]),
    has ? React.createElement('button', { key: 'x', title: 'Clear ' + label, onClick: () => onChange([]), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-tab-accent)', padding: 2, display: 'flex' } }, React.createElement(X, { size: 13 })) : null,
    open ? React.createElement(React.Fragment, { key: 'm' }, [
      React.createElement('div', { key: 'o', style: { position: 'fixed', inset: 0, zIndex: 150 }, onClick: () => setOpen(false) }),
      React.createElement('div', { key: 'd', style: { position: 'absolute', zIndex: 151, minWidth: 230, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 3, ...pos } }, [
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

function CheckBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return React.createElement('div', { onClick: (e: any) => { e.stopPropagation(); onToggle() }, style: { width: 16, height: 16, borderRadius: 4, border: '1px solid var(--q-border)', backgroundColor: checked ? 'var(--q-tab-accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'none' } }, checked ? React.createElement(Check, { size: 12, style: { color: 'var(--q-bg)' } }) : null)
}

function WhenCell({ i, onEdit }: { i: Item; onEdit: (e: any) => void }) {
  const [h, setH] = useState(false)
  const d = new Date(i.when as number)
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const dateStr = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
  const timeStr = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0')
  const color = h ? 'var(--q-text)' : 'var(--q-text-secondary)'
  return React.createElement('div', { onClick: onEdit, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, transition: 'none' } }, [
    React.createElement('span', { key: 'tt', style: { whiteSpace: 'normal', overflow: 'hidden', fontSize: 12.5, fontFamily: 'var(--font-interface)', color } }, timeStr),
    React.createElement('span', { key: 'dd', style: { whiteSpace: 'normal', overflow: 'hidden', fontSize: 12.5, fontFamily: 'var(--font-interface)', color, opacity: 0.8 } }, dateStr),
  ])
}

function RowBtn({ title, onClick, children, color, hoverColor }: { title: string; onClick: () => void; children: React.ReactNode; color?: string; hoverColor?: string }) {
  const [h, setH] = useState(false)
  return React.createElement('button', { title, onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { background: 'none', border: 'none', cursor: 'pointer', color: h ? (hoverColor || color || 'var(--q-text)') : (color || 'var(--q-text-tertiary)'), padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', flexShrink: 0, transition: 'none' } }, children)
}
function ViewRow({ v, active, renaming, renameVal, onRenameChange, onRenameCommit, onRenameCancel, onSelect, onContextMenu, multiSel, selected, onToggleSel, isOverlay }: { v: ViewCfg; active: boolean; renaming: boolean; renameVal: string; onRenameChange: (s: string) => void; onRenameCommit: () => void; onRenameCancel: () => void; onSelect: () => void; onContextMenu: (e: React.MouseEvent, v: ViewCfg) => void; multiSel: boolean; selected: boolean; onToggleSel: () => void; isOverlay?: boolean }) {
  const [h, setH] = useState(false)
  const isBase = v.id === BASE_ID
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: v.id, disabled: !!isOverlay })
  const { setNodeRef: setDropRef } = useDroppable({ id: v.id, disabled: !!isOverlay })
  const color = multiSel ? (selected ? 'var(--q-accent-danger)' : h ? 'var(--q-text)' : 'var(--q-text-secondary)') : active ? 'var(--q-tab-accent)' : h ? 'var(--q-text)' : 'var(--q-text-secondary)'
  return React.createElement('div', { ref: setDropRef, 'data-view-row-id': v.id, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { padding: '2px 8px', opacity: isDragging && !isOverlay ? 0.15 : 1 } }, [
    React.createElement('div', { ref: setNodeRef, ...attributes, ...listeners, onClick: multiSel ? onToggleSel : onSelect, onContextMenu: (e: any) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, v) }, style: { padding: '6px 8px', minHeight: '36px', borderRadius: 'var(--radius-md)', backgroundColor: h ? 'var(--q-hover)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', boxShadow: isOverlay ? '0 8px 16px rgba(0,0,0,0.5)' : 'none' } }, [
      React.createElement(Checklist, { key: 'i', size: 20, style: { color, flexShrink: 0, transform: h ? 'translateX(2px)' : 'translateX(0)' } }),
      renaming ? React.createElement('input', { key: 'r', autoFocus: true, value: renameVal, onChange: (e: any) => onRenameChange(e.target.value), onBlur: () => onRenameCommit(), onKeyDown: (e: any) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel() }, onClick: (e: any) => e.stopPropagation(), style: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', padding: 0 } })
      : React.createElement('span', { key: 'n', style: { flex: 1, color, fontSize: 14, fontWeight: active ? 700 : 500, fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, v.name),
    ]),
  ])
}

function MtText({ label, onClick }: { label: string; onClick: (e: any) => void }) {
  const [h, setH] = useState(false)
  return React.createElement('span', { onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false), style: { color: h ? 'var(--q-text)' : 'var(--q-text-secondary)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-interface)', whiteSpace: 'normal', overflow: 'hidden', transition: 'none' } }, label)
}

function MiniSelect({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const cur = options.find(o => o.value === value) || options[0]
  return React.createElement('div', { style: { position: 'relative', display: 'inline-block' } }, [
    React.createElement('button', { key: 'b', onClick: () => setOpen(!open), style: { height: 28, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 12.5, fontFamily: 'var(--font-interface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 } }, [cur.label, React.createElement(ChevronDown, { key: 'a', size: 12 })]),
    open ? React.createElement(React.Fragment, { key: 'm' }, [
      React.createElement('div', { key: 'o', style: { position: 'fixed', inset: 0, zIndex: 260 }, onClick: () => setOpen(false) }),
      React.createElement('div', { key: 'd', style: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 261, maxHeight: 180, overflowY: 'auto', minWidth: 90, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: 4, display: 'flex', flexDirection: 'column', gap: 1 } }, options.map(o => React.createElement('button', { key: o.value, onClick: () => { onChange(o.value); setOpen(false) }, style: { textAlign: 'left', padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-interface)', backgroundColor: o.value === value ? 'var(--q-active)' : 'transparent', color: 'var(--q-text)' } }, o.label))),
    ]) : null,
  ])
}

function MenuItem({ label, color, onClick }: any) {
  const [hovered, setHovered] = useState(false)
  return React.createElement('button', { onClick, onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false), style: { display: 'flex', alignItems: 'center', width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', backgroundColor: hovered ? 'var(--q-hover)' : 'transparent', color: color || 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', textAlign: 'left' } }, label)
}
function ViewContextMenu({ x, y, item, multiSelect, selectedCount, onClose, onRename, onSelect, onDelete, onDeselectAll, onDeleteSelected }: any) {
  return React.createElement(React.Fragment, null, [
    React.createElement('div', { key: 'o', style: { position: 'fixed', inset: 0, zIndex: 200 }, onClick: onClose, onContextMenu: (e: any) => { e.preventDefault(); onClose() } }),
    React.createElement('div', { key: 'm', style: { position: 'fixed', left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 250), zIndex: 210, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '4px 0', minWidth: '180px' } }, [
      multiSelect
        ? [React.createElement(MenuItem, { key: 'ds', label: 'Deselect all', onClick: onDeselectAll }), selectedCount > 0 ? React.createElement(MenuItem, { key: 'dl', label: 'Delete ' + selectedCount + ' view' + (selectedCount > 1 ? 's' : ''), color: 'var(--q-accent-danger)', onClick: onDeleteSelected }) : null]
        : [React.createElement(MenuItem, { key: 'rn', label: 'Rename', onClick: onRename }), React.createElement(MenuItem, { key: 'sl', label: 'Select view', onClick: onSelect }), React.createElement(MenuItem, { key: 'dl', label: 'Delete view', color: 'var(--q-accent-danger)', onClick: onDelete })],
    ]),
  ])
}
function ConfirmModal({ title, subtitle, onCancel, onConfirm }: any) {
  return React.createElement(React.Fragment, null, [
    React.createElement('div', { key: 'o', style: { position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.4)' }, onClick: onCancel }),
    React.createElement('div', { key: 'm', style: { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 310, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '20px 24px', minWidth: '320px', maxWidth: '400px' } }, [
      React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' } }, title),
      React.createElement('div', { key: 's', style: { color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '16px' } }, subtitle),
      React.createElement('div', { key: 'b', style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } }, [
        React.createElement('button', { key: 'c', onClick: onCancel, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 400, cursor: 'pointer' } }, 'Cancel'),
        React.createElement('button', { key: 'ok', onClick: onConfirm, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Delete'),
      ]),
    ]),
  ])
}

interface Item { id: string; kind: 'sched' | 'exec'; title: string; agent: string; chat: string; status: string; when: number | null; error: string; ex?: any; model?: string | null; thinkingLevel?: string | null; whenObj?: any; sourceKey?: string | null }
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
  const [sessionsMap, setSessionsMap] = useState<Record<string, string>>({})
  const [views, setViews] = useState<ViewCfg[]>(loadViews)
  const [activeId, setActiveId] = useState<string>(() => { const v = loadViews(); return v[0]?.id || BASE_ID })
  const [sortKey, setSortKey] = useState<string>('when'); const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [cols] = useState<string[]>(COLS.map(c => c.key))
  const [hoverRow, setHoverRow] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [deleteViews, setDeleteViews] = useState<ViewCfg[] | null>(null)
  const [deleteTask, setDeleteTask] = useState<{ items: { id: string; kind: 'sched' | 'exec'; title: string }[]; section?: string } | null>(null)
  const [selTasks, setSelTasks] = useState<Set<string>>(new Set())
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [ctTitle, setCtTitle] = useState('')
  const [ctText, setCtText] = useState('')
  const [ctAgent, setCtAgent] = useState('orchestrator')
  const [ctDate, setCtDate] = useState('')
  const [ctTime, setCtTime] = useState('')
  const [ctRecur, setCtRecur] = useState('once')
  const [ctModel, setCtModel] = useState<string | null>(null)
  const [ctThinking, setCtThinking] = useState<string | null>(null)
  const [ctChat, setCtChat] = useState('')
  const [sessions, setSessions] = useState<{ key: string; label: string }[]>([])
  const [renamingView, setRenamingView] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [allHover, setAllHover] = useState(false)
  const [sideMode, setSideMode] = useState<'open' | 'hidden' | 'peek'>('open')
  const [sideW, setSideW] = useState(260)
  const [draggingSide, setDraggingSide] = useState(false)
  const tblWrapRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ startX: number; startScroll: number; active: boolean; moved: boolean }>({ startX: 0, startScroll: 0, active: false, moved: false })
  const [panning, setPanning] = useState(false)
  const suppressClickRef = useRef(false)
  const [newViewFlash, setNewViewFlash] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; view: ViewCfg } | null>(null)
  const [mtModelPicker, setMtModelPicker] = useState<{ id: string; model: string | null } | null>(null)
  const [mtThinkingPicker, setMtThinkingPicker] = useState<{ id: string; thinking: string | null } | null>(null)
  const [editWhen, setEditWhen] = useState<{ id: string; when: any } | null>(null)
  const [whenDate, setWhenDate] = useState('')
  const [whenTime, setWhenTime] = useState('')
  const [models, setModels] = useState<any[]>([])
  const [defaultThinking, setDefaultThinking] = useState('xhigh')
  useEffect(() => { call('getModels').then((r: any) => setModels(r?.models || [])).catch(() => {}) }, [call])
  useEffect(() => { call('getProvidersConfig').then((r: any) => { if (r?.defaultThinking) setDefaultThinking(r.defaultThinking) }).catch(() => {}) }, [call])
  const [multiSel, setMultiSel] = useState(false)
  const [selViews, setSelViews] = useState<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement>(null)
  const pointerYRef = useRef(0)
  const itemRects = useRef<Map<string, DOMRect>>(new Map())
  const activeDragId = useRef<string | null>(null)
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const lastDrop = useRef<{ id: string; zone: 'before' | 'after' } | null>(null)
  const [dropZone, setDropZone] = useState<{ id: string; zone: 'before' | 'after' } | null>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent) => { pointerYRef.current = e.clientY }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  useEffect(() => {
    if (!panning) return
    const onMove = (e: MouseEvent) => {
      const el = tblWrapRef.current
      if (!el || !panRef.current.active) return
      const dx = e.clientX - panRef.current.startX
      if (Math.abs(dx) > 3) panRef.current.moved = true
      el.scrollLeft = panRef.current.startScroll - dx
    }
    const onUp = () => {
      panRef.current.active = false
      setPanning(false)
      if (panRef.current.moved) {
        suppressClickRef.current = true
        const kill = (e: MouseEvent) => {
          e.stopPropagation()
          e.preventDefault()
          window.removeEventListener('click', kill, true)
          suppressClickRef.current = false
        }
        window.addEventListener('click', kill, true)
      }
      panRef.current.moved = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [panning])
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

  const refresh = useCallback(async () => { try { const a = await call('listSchedules'); const b = await call('listExecutions'); setSchedules(a?.schedules || []); setExecutions(b?.executions || []); const s = await call('listSessions'); const m: Record<string, string> = {}; const sl: { key: string; label: string }[] = []; for (const x of (s?.sessions || [])) { const k = x.sessionKey || x.key; if (k) { const lb = x.label || x.title || k; m[k] = lb; sl.push({ key: k, label: lb }) } } setSessionsMap(m); setSessions(sl) } catch {} }, [call])
  useEffect(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv) }, [refresh])
  useEffect(() => { const u = subscribe?.('execution_update', refresh); return () => { if (u) try { u() } catch {} } }, [refresh, subscribe])
  useEffect(() => { const u = subscribe?.('schedule_update', refresh); return () => { if (u) try { u() } catch {} } }, [refresh, subscribe])
  const act = useCallback(async (fn: () => Promise<any>) => { try { await fn() } catch {}; await refresh() }, [refresh])

  const items: Item[] = []
  for (const s of schedules || []) items.push({ id: s.id, kind: 'sched', title: s.title || '(untitled)', agent: (s.agentIds || []).join(', ') || '—', chat: s.sourceSession ? (sessionsMap[s.sourceSession.key] || s.sourceSession.label || s.sourceSession.key) : '—', status: s.enabled ? 'scheduled' : 'off', when: s.nextFireAt || (s.lastFiredAt ? s.lastFiredAt : null), error: '', ex: undefined, model: s.model || null, thinkingLevel: s.thinkingLevel || null, whenObj: s.when || null, sourceKey: s.sourceSession?.key || null })
  for (const ex of executions || []) items.push({ id: ex.id, kind: 'exec', title: ex.label || ex.id, agent: (ex.agentIds || []).join(', ') || '—', chat: ex.sourceSession ? (sessionsMap[ex.sourceSession.key] || ex.sourceSession.label || ex.sourceSession.key) : '—', status: ex.status || '?', when: ex.scheduledFor || ex.createdAt || null, error: ex.error ? String(ex.error).slice(0, 60) : '', ex, model: ex.model || null, thinkingLevel: ex.thinkingLevel || null, whenObj: null, sourceKey: ex.sourceSession?.key || null })

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
    const delSel = () => { const sels = filtered.filter(x => selTasks.has(x.id)); if (sels.length > 0) setDeleteTask({ items: sels.map(x => ({ id: x.id, kind: x.kind, title: x.title })) }); else setDeleteTask({ items: [{ id: i.id, kind: i.kind, title: i.title }] }) }
    if (i.kind === 'sched') { if (i.status === 'scheduled') b.push(React.createElement(RowBtn, { key: 'run', title: 'Run now', onClick: () => act(async () => { await call('runScheduleNow', { id: i.id }) }) }, React.createElement(Play, { size: 16 }))); b.push(React.createElement(RowBtn, { key: 'del', title: 'Delete', hoverColor: 'var(--q-accent-danger)', onClick: delSel }, React.createElement(Trash2, { size: 16 }))) }
    else { if (i.status === 'running' || i.status === 'queued') b.push(React.createElement(RowBtn, { key: 'stop', title: 'Stop', hoverColor: 'var(--q-accent-warning)', onClick: () => act(async () => { await call('stopExecution', { executionId: i.id }) }) }, React.createElement(X, { size: 16 }))); if (i.status === 'interrupted') b.push(React.createElement(RowBtn, { key: 'res', title: 'Resume', hoverColor: 'var(--q-accent-info)', onClick: () => act(async () => { await call('resumeExecution', { executionId: i.id }) }) }, React.createElement(RotateCcw, { size: 16 }))); if (i.status === 'failed' || i.status === 'cancelled') b.push(React.createElement(RowBtn, { key: 'retry', title: 'Retry', hoverColor: 'var(--q-accent-info)', onClick: () => act(async () => { if (i.ex?.scheduleId) await call('runScheduleNow', { id: i.ex.scheduleId }); else await call('runTask', { label: i.ex.label, agentIds: i.ex.agentIds, workingDir: i.ex.workingDir, mode: i.ex.mode, model: i.ex.model, text: i.ex.text }) }) }, React.createElement(RotateCcw, { size: 16 }))); b.push(React.createElement(RowBtn, { key: 'del', title: 'Delete', hoverColor: 'var(--q-accent-danger)', onClick: delSel }, React.createElement(Trash2, { size: 16 }))) }
    return React.createElement('div', { key: 'acts', style: { display: 'flex', gap: 4, justifyContent: 'center' } }, b)
  }
  const cellVal = (i: Item, key: string): React.ReactNode => {
    if (key === 'when') {
      if (!i.when) return '—'
      const d = new Date(i.when)
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
      const dateStr = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
      const timeStr = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0')
      const content = React.createElement('div', { key: 'dt', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 } }, [
        React.createElement('span', { key: 'tt', style: { whiteSpace: 'normal', overflow: 'hidden', fontSize: 12.5, fontFamily: 'var(--font-interface)', color: 'var(--q-text-secondary)' } }, timeStr),
        React.createElement('span', { key: 'dd', style: { whiteSpace: 'normal', overflow: 'hidden', fontSize: 12.5, fontFamily: 'var(--font-interface)', color: 'var(--q-text-secondary)', opacity: 0.8 } }, dateStr),
      ])
      if (i.kind === 'sched') {
        return React.createElement(WhenCell, { key: 'w', i, onEdit: (e: any) => { e.stopPropagation(); const w = i.whenObj || {}; const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']; const pad2 = (n: number) => String(n).padStart(2, '0'); const base = new Date(i.when || Date.now()); let ds: string, ts: string; if (w.date) { const dd = new Date(String(w.date)); ds = dd.getDate() + ' ' + MONTHS[dd.getMonth()] + ' ' + dd.getFullYear(); ts = pad2(dd.getHours()) + ':' + pad2(dd.getMinutes()) + ':' + pad2(dd.getSeconds()) } else if (w.at) { const at = String(w.at); ds = base.getDate() + ' ' + MONTHS[base.getMonth()] + ' ' + base.getFullYear(); ts = at.length === 5 ? at + ':00' : at } else { ds = base.getDate() + ' ' + MONTHS[base.getMonth()] + ' ' + base.getFullYear(); ts = pad2(base.getHours()) + ':' + pad2(base.getMinutes()) + ':' + pad2(base.getSeconds()) } setWhenDate(ds); setWhenTime(ts); setEditWhen({ id: i.id, when: w }) } })
      }
      return content
    }
    if (key === 'title') return i.title
    if (key === 'agent') return i.agent
    if (key === 'chat') {
      if (i.sourceKey) return React.createElement(MtText, { key: 'ch', label: i.chat, onClick: (e: any) => { e.stopPropagation(); props.onOpenSession?.(i.sourceKey as string) } })
      return i.chat
    }
    if (key === 'actions') return actions(i)
    if (key === 'mt') {
      const modelName = (models.find((x: any) => x.id === i.model)?.name) || i.model || 'Chat default'
      const rawT = i.thinkingLevel || null
      const tName = rawT === null ? 'Chat default' : rawT === 'off' ? 'Off' : 'On (' + ((rawT && rawT !== 'on') ? rawT : defaultThinking) + ')'
      if (i.kind === 'sched') return React.createElement('div', { key: 'mtb', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 } }, [
        React.createElement(MtText, { key: 'm', label: modelName, onClick: (e: any) => { e.stopPropagation(); setMtModelPicker({ id: i.id, model: i.model || null }) } }),
        React.createElement(MtText, { key: 't', label: tName, onClick: (e: any) => { e.stopPropagation(); setMtThinkingPicker({ id: i.id, thinking: i.thinkingLevel || null }) } }),
      ])
      return React.createElement('div', { key: 'mts', style: { color: 'var(--q-text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 } }, [
        React.createElement('span', { key: 'm', style: { maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, modelName),
        React.createElement('span', { key: 't', style: { maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontFamily: 'var(--font-interface)', opacity: 0.8 } }, tName),
      ])
    }
    return ''
  }
  const cellStyle = (align = 'left', isLast = false, isLastCol = false): React.CSSProperties => ({ padding: '9px 12px', color: 'var(--q-text-secondary)', fontSize: 13.5, fontFamily: 'var(--font-interface)', textAlign: align as any, whiteSpace: 'normal', overflow: 'hidden', borderBottom: isLast ? 'none' : '1px solid var(--q-border-solid)', borderRight: isLastCol ? 'none' : '1px solid var(--q-border-solid)' })

  // Tabella per un gruppo (header colonne + righe) — la stessa struttura in ogni toggle
  const COL_MIN: Record<string, number> = { title: 180, agent: 110, chat: 140, mt: 140, when: 130, actions: 90 }
  const tableFor = (rows: Item[]) => {
    const renderCols = ['sel', ...cols.filter(x => x !== 'actions'), 'actions']
    const thead = React.createElement('tr', { key: 'thr' }, renderCols.map((k, idx) => { const c = COLS.find(x => x.key === k); const isLastCol = idx === renderCols.length - 1; if (k === 'sel') return React.createElement('th', { key: k, style: { padding: '9px 12px', minWidth: 52, borderBottom: '1px solid var(--q-border-solid)', borderRight: '1px solid var(--q-border-solid)' } }, React.createElement(Checklist, { key: 'i', size: 15, style: { color: 'var(--q-text-tertiary)' } })); if (k === 'actions') return React.createElement('th', { key: k, style: { padding: '9px 12px', color: 'var(--q-text-secondary)', fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', userSelect: 'none', minWidth: COL_MIN.actions, borderBottom: '1px solid var(--q-border-solid)' } }, 'Actions'); return React.createElement('th', { key: k, onClick: () => toggleSort(k), style: { padding: '9px 12px', cursor: 'grab', color: 'var(--q-text-secondary)', fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', userSelect: 'none', minWidth: COL_MIN[k] || 80, borderBottom: '1px solid var(--q-border-solid)', borderRight: isLastCol ? 'none' : '1px solid var(--q-border-solid)' } }, c ? c.label : '') }))
    const tbody = rows.map((i, ri) => React.createElement('tr', { key: i.id, onMouseEnter: () => setHoverRow(i.id), onMouseLeave: () => setHoverRow(null), style: { backgroundColor: hoverRow === i.id ? 'var(--q-hover)' : 'transparent', transition: 'none' } }, renderCols.map((k, idx) => { const isLast = ri === rows.length - 1; const isLastCol = idx === renderCols.length - 1; if (k === 'sel') { return React.createElement('td', { key: k, style: cellStyle('left', isLast, isLastCol) }, React.createElement(CheckBox, { key: 'cb', checked: selTasks.has(i.id), onToggle: () => setSelTasks(prev => { const n = new Set(prev); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n }) })) } if (k === 'title') { return React.createElement('td', { key: k, style: cellStyle('left', isLast, isLastCol) }, React.createElement('span', { key: 't', style: { color: 'var(--q-text)', whiteSpace: 'normal', overflow: 'hidden' } }, i.title)) } if (k === 'actions') { return React.createElement('td', { key: k, style: cellStyle('left', isLast, isLastCol) }, actions(i)) } return React.createElement('td', { key: k, style: cellStyle('left', isLast, isLastCol) }, cellVal(i, k)) })))
    const startPan = (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const t = e.target as HTMLElement
      if (t.closest('button, input, a, [role="button"]')) return
      const el = tblWrapRef.current
      if (!el) return
      panRef.current = { startX: e.clientX, startScroll: el.scrollLeft, active: true, moved: false }
      setPanning(true)
    }
    return React.createElement('div', { key: 'tbl', ref: tblWrapRef, onMouseDown: startPan, style: { width: '100%', overflowX: 'auto', cursor: panning ? 'grabbing' : 'grab', userSelect: panning ? 'none' : 'text' } }, React.createElement('table', { style: { borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'auto', margin: '0 auto' } }, [React.createElement('thead', { key: 'th' }, thead), React.createElement('tbody', { key: 'tb' }, tbody.length ? tbody : React.createElement('tr', { key: 'e' }, React.createElement('td', { colSpan: renderCols.length, style: { padding: 16, textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)', borderBottom: '1px solid var(--q-border-solid)' } }, 'No tasks in this group.')))]))
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
        React.createElement('span', { key: 'sp', style: { flex: 1 } }),
        React.createElement(RowBtn, { key: 'del', title: 'Delete all tasks in ' + g.label, hoverColor: 'var(--q-accent-danger)', onClick: (e: any) => { e.stopPropagation(); setDeleteTask({ items: gItems.map(x => ({ id: x.id, kind: x.kind, title: x.title })), section: g.label }) } }, React.createElement(Trash2, { size: 14 })),
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
  const addView = () => { const id = 'v' + Date.now(); const nv: ViewCfg = { id, name: 'View ' + (views.filter(v => v.id !== BASE_ID).length + 1), type: 'table', f: { q: '', status: 'all', agents: [], chats: [] } }; persist([views[0], nv, ...views.slice(1)]); setActiveId(id); setNewViewFlash(true); setTimeout(() => setNewViewFlash(false), 600) }
  const renameView = (id: string, name: string) => { const nm = name.trim(); if (!nm) { setRenamingView(null); setRenameVal(''); return } persist(views.map(x => x.id === id ? { ...x, name: nm } : x)); setRenamingView(null); setRenameVal('') }
  const doDelete = (targets: ViewCfg[]) => { const ids = new Set(targets.map(t => t.id)); const rem = views.filter(x => !ids.has(x.id)); persist(rem); if (ids.has(activeId)) setActiveId(rem[0]?.id || BASE_ID); setDeleteViews(null); setMultiSel(false); setSelViews(new Set()) }
  const doDeleteTask = (t: { items: { id: string; kind: 'sched' | 'exec' }[] }) => { setDeleteTask(null); act(async () => { for (const it of t.items) { if (it.kind === 'sched') await call('deleteSchedule', { id: it.id }); else await call('deleteExecution', { executionId: it.id }) } setSelTasks(new Set()) }) }
  const doCreateTask = async () => {
    const title = ctTitle.trim()
    if (!title) return
    setCreateTaskOpen(false)
    try {
      let chatKey = ctChat
      let chatLabel = ''
      if (!chatKey) {
        const r: any = await call('createSession', { label: 'Task: ' + title, agentId: ctAgent, model: ctModel || undefined, thinkingLevel: ctThinking || undefined, mode: 'plan' })
        chatKey = r?.key || ''
        chatLabel = r?.label || 'Task: ' + title
      } else {
        chatLabel = sessions.find(s => s.key === chatKey)?.label || chatKey
      }
      const sourceSession = chatKey ? { key: chatKey, label: chatLabel } : undefined
      const text = ctText.trim() || title
      const dd = parseFlexDate(ctDate)
      const tt = parseFlexTime(ctTime)
      if (dd && tt) {
        const nd = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
        const nt = String(tt.h).padStart(2, '0') + ':' + String(tt.m).padStart(2, '0') + ':' + String(tt.sec).padStart(2, '0')
        await call('createSchedule', { title, agentIds: [ctAgent], when: ctRecur === 'once' ? { type: 'once', date: nd + 'T' + nt } : { type: ctRecur, at: nt }, model: ctModel || undefined, thinkingLevel: ctThinking || undefined, sourceSession })
      } else {
        await call('runTask', { label: title, agentIds: [ctAgent], text, model: ctModel || undefined, thinkingLevel: ctThinking || undefined, sourceSession })
      }
    } catch {}
    refresh()
  }
  const hasActiveFilters = f.agents.length > 0 || f.chats.length > 0
  const filterChips = (filterBarOpen || hasActiveFilters) ? [
    React.createElement(FilterChip, { key: 'fA', label: 'Agent', values: f.agents, options: agents, onChange: (v: string[]) => patchF({ agents: v }) }),
    React.createElement(FilterChip, { key: 'fC', label: 'Chat', values: f.chats, options: chats, onChange: (v: string[]) => patchF({ chats: v }) }),
    hasActiveFilters ? React.createElement('button', { key: 'clr', onClick: () => patchF({ agents: [], chats: [] }), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', height: 30, display: 'inline-flex', alignItems: 'center', padding: '0 6px' } }, 'Clear') : null,
  ] : []
  const toolbar = React.createElement('div', { key: 'tb', style: { display: 'flex', flexDirection: 'column', padding: '4px 0 8px 0' } }, [
    React.createElement('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' } }, [
    React.createElement('span', { key: 'grow', style: { flex: 1 } }),
    searchOpen ? React.createElement('input', { key: 'si', autoFocus: true, value: f.q, onChange: (e: any) => patchF({ q: e.target.value }), onKeyDown: (e: any) => { if (e.key === 'Escape') setSearchOpen(false) }, placeholder: 'Search activities...', style: { width: 240, height: 30, padding: '0 12px', boxSizing: 'border-box', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', flexShrink: 0 } }) : null,
    React.createElement(RowBtn, { key: 'search', title: 'Search', onClick: () => setSearchOpen(!searchOpen), color: f.q ? 'var(--q-tab-accent)' : undefined }, React.createElement(Search, { size: 18 })),
    ...filterChips,
    React.createElement(RowBtn, { key: 'filters', title: 'Filters', onClick: () => setFilterBarOpen(!filterBarOpen), color: hasActiveFilters ? 'var(--q-tab-accent)' : undefined }, React.createElement(Filter, { size: 18 })),
    React.createElement(RowBtn, { key: 'fwbtn', title: fullWidth ? 'Default width' : 'Full width', onClick: () => { const nv = !fullWidth; setFullWidth(nv); saveUi(nv, views) } }, React.createElement(fullWidth ? Minimize : Maximize, { size: 18 })),
    React.createElement(RowBtn, { key: 'addtask', title: 'New task', onClick: () => { setCtTitle(''); setCtText(''); setCtAgent(agents[0]?.id || 'orchestrator'); setCtDate(''); setCtTime(''); setCtRecur('once'); setCtModel(null); setCtThinking(null); setCtChat(''); setCreateTaskOpen(true) }, color: 'var(--q-tab-accent)' }, React.createElement(Plus, { size: 18 })),
    React.createElement('div', { key: 'sep', style: { height: 1, backgroundColor: 'var(--q-border)', marginTop: 6 } }),
  ]),
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
    React.createElement('div', { key: 'list', style: { flex: 1, overflowY: 'auto', paddingBottom: 8, scrollbarGutter: 'stable' } }, React.createElement(DndContext, { key: 'dnd', sensors: useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } })), collisionDetection: closestCenter, onDragStart: (e: any) => { activeDragId.current = e.active?.id || null; setOverlayId(e.active?.id || null); lastDrop.current = null; const rects = new Map<string, DOMRect>(); document.querySelectorAll('[data-view-row-id]').forEach(el => { const id = el.getAttribute('data-view-row-id'); if (id) rects.set(id, el.getBoundingClientRect()) }); itemRects.current = rects }, onDragMove: () => { const pointerY = pointerYRef.current; const ids = views.filter(v => v.id !== BASE_ID); const dragIdx = ids.findIndex(v => v.id === activeDragId.current); const itemAbove = dragIdx > 0 ? ids[dragIdx - 1] : null; const itemBelow = dragIdx >= 0 && dragIdx < ids.length - 1 ? ids[dragIdx + 1] : null; for (const v of ids) { if (v.id === activeDragId.current) continue; const rect = itemRects.current.get(v.id); if (!rect) continue; if (pointerY <= rect.bottom) { const zone = (pointerY < rect.top || (pointerY - rect.top) < rect.height / 2) ? 'before' : 'after'; const isUselessAfter = zone === 'after' && itemAbove && v.id === itemAbove.id; const isUselessBefore = zone === 'before' && itemBelow && v.id === itemBelow.id; if (isUselessAfter || isUselessBefore) { setDropZone(null); lastDrop.current = null; return } setDropZone(prev => (prev && prev.id === v.id && prev.zone === zone) ? prev : { id: v.id, zone }); lastDrop.current = { id: v.id, zone }; return } } if (ids.length) { const last = ids[ids.length - 1]; if (last.id === itemAbove?.id) { setDropZone(null); lastDrop.current = null; return } setDropZone(prev => (prev && prev.id === last.id && prev.zone === 'after') ? prev : { id: last.id, zone: 'after' }); lastDrop.current = { id: last.id, zone: 'after' } } else { setDropZone(null); lastDrop.current = null } }, onDragEnd: () => { const activeId = activeDragId.current; const target = lastDrop.current; setDropZone(null); activeDragId.current = null; setOverlayId(null); lastDrop.current = null; if (!activeId || !target) return; const ids = views.filter(v => v.id !== BASE_ID); const from = ids.findIndex(v => v.id === activeId); if (from === -1) return; const toIdx = ids.findIndex(v => v.id === target.id); if (toIdx === -1) return; let insertAt = target.zone === 'before' ? toIdx : toIdx + 1; if (from < insertAt) insertAt -= 1; if (insertAt === from) return; const reordered = [...ids]; const [moved] = reordered.splice(from, 1); reordered.splice(insertAt, 0, moved); persist([views[0], ...reordered]) }, onDragCancel: () => { setDropZone(null); activeDragId.current = null; setOverlayId(null); lastDrop.current = null } }, [
      (() => { const nodes: React.ReactNode[] = []; views.filter(v => v.id !== BASE_ID).forEach(v => { if (dropZone && dropZone.id === v.id && dropZone.zone === 'before') nodes.push(React.createElement('div', { key: 'indb_' + v.id, style: { display: 'flex', alignItems: 'center', gap: 6, height: 18, padding: '0 12px' } }, [React.createElement('span', { key: 'l1', style: { flex: 1, height: 1, backgroundColor: 'var(--q-tab-accent)' } }), React.createElement('span', { key: 'lab', style: { color: 'var(--q-tab-accent)', fontSize: 11, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' } }, 'Drop here'), React.createElement('span', { key: 'l2', style: { flex: 1, height: 1, backgroundColor: 'var(--q-tab-accent)' } })])); nodes.push(React.createElement(ViewRow, { key: v.id, v, active: v.id === activeId, renaming: renamingView === v.id, renameVal, onRenameChange: setRenameVal, onRenameCommit: () => renameView(v.id, renameVal), onRenameCancel: () => { setRenamingView(null); setRenameVal('') }, onSelect: () => setActiveId(v.id), onContextMenu: (e: any, vv: ViewCfg) => setCtxMenu({ x: e.clientX, y: e.clientY, view: vv }), multiSel, selected: selViews.has(v.id), onToggleSel: () => setSelViews(prev => { const n = new Set(prev); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n }) })); if (dropZone && dropZone.id === v.id && dropZone.zone === 'after') nodes.push(React.createElement('div', { key: 'inda_' + v.id, style: { display: 'flex', alignItems: 'center', gap: 6, height: 18, padding: '0 12px' } }, [React.createElement('span', { key: 'l1', style: { flex: 1, height: 1, backgroundColor: 'var(--q-tab-accent)' } }), React.createElement('span', { key: 'lab', style: { color: 'var(--q-tab-accent)', fontSize: 11, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' } }, 'Drop here'), React.createElement('span', { key: 'l2', style: { flex: 1, height: 1, backgroundColor: 'var(--q-tab-accent)' } })])); }); return nodes })(),
      React.createElement(DragOverlay, { key: 'ov', dropAnimation: null }, overlayId ? (() => { const v = views.find(x => x.id === overlayId); if (!v) return null; return React.createElement(ViewRow, { key: v.id, v, active: false, renaming: false, renameVal: '', onRenameChange: () => {}, onRenameCommit: () => {}, onRenameCancel: () => {}, onSelect: () => {}, onContextMenu: () => {}, multiSel: false, selected: false, onToggleSel: () => {}, isOverlay: true }) })() : null),
    ])),
    React.createElement('div', { key: 'rsz', onMouseDown: (e: any) => { e.preventDefault(); setDraggingSide(true) }, style: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 6, cursor: 'col-resize', zIndex: 5 } }),
  ])

  return React.createElement('div', { key: 'root', ref: rootRef, className: 'h-full flex flex-row', style: { width: '100%', position: 'relative' } }, [
    sideMode !== 'hidden' ? viewSidebar : null,
    React.createElement('div', { key: 'main', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingLeft: sideMode === 'open' ? sideW + 8 : 0 } }, [

    React.createElement('div', { key: 'hdrwrap', style: { width: '100%', maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', flexShrink: 0, paddingTop: '0px' } }, [
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
    sideMode === 'peek' && !draggingSide ? React.createElement('div', { key: 'peekov', style: { position: 'absolute', top: 0, bottom: 0, left: sideW + 24, right: 0, zIndex: 30 }, onMouseEnter: () => setSideMode('hidden') }) : null,
    ctxMenu ? React.createElement(ViewContextMenu, { key: 'cm', x: ctxMenu.x, y: ctxMenu.y, item: ctxMenu.view, multiSelect: multiSel, selectedCount: selViews.size, onClose: () => setCtxMenu(null), onRename: () => { setRenamingView(ctxMenu.view.id); setRenameVal(ctxMenu.view.name); setCtxMenu(null) }, onSelect: () => { setMultiSel(true); setSelViews(new Set([ctxMenu.view.id])); setCtxMenu(null) }, onDelete: () => { setDeleteViews([ctxMenu.view]); setCtxMenu(null) }, onDeselectAll: () => { setMultiSel(false); setSelViews(new Set()); setCtxMenu(null) }, onDeleteSelected: () => { setDeleteViews(views.filter(v => selViews.has(v.id))); setCtxMenu(null) } }) : null,
    mtModelPicker ? React.createElement(ModelPickerModal, { key: 'mp', currentModel: mtModelPicker.model || '', models, onClose: () => setMtModelPicker(null), onConfirm: (model: string | null) => { const id = mtModelPicker.id; setMtModelPicker(null); if (!id) return; if (id === '__new__') { setCtModel(model); return } call('updateSchedule', { id, model: model || null }).then(() => refresh()).catch(() => {}) } }) : null,
    mtThinkingPicker ? React.createElement(ThinkingPickerModal, { key: 'tp', currentThinking: mtThinkingPicker.thinking || '', chatThinkingLevel: defaultThinking, onClose: () => setMtThinkingPicker(null), onConfirm: (level: string | null) => { const id = mtThinkingPicker.id; setMtThinkingPicker(null); if (!id) return; if (id === '__new__') { setCtThinking(level); return } call('updateSchedule', { id, thinkingLevel: level || null }).then(() => refresh()).catch(() => {}) } }) : null,
    editWhen ? React.createElement(React.Fragment, { key: 'wted' }, [
      React.createElement('div', { key: 'o', style: { position: 'fixed', inset: 0, zIndex: 250 }, onClick: () => setEditWhen(null) }),
      React.createElement('div', { key: 'p', style: { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 251, width: 340, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 } }, [
        React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Time · Date'),
        React.createElement('div', { key: 'l2', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'Time (e.g. 14:30 or 14:30:45)'),
        React.createElement('input', { key: 't2', value: whenTime, onChange: (e: any) => setWhenTime(e.target.value), placeholder: '14:30:45', style: { padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', width: '100%', boxSizing: 'border-box' } }),
        React.createElement('div', { key: 'l1', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'Date (e.g. 12 August 2026, 12/08/2026, 12-08-2026)'),
        React.createElement('input', { key: 'd', value: whenDate, onChange: (e: any) => setWhenDate(e.target.value), placeholder: '12 August 2026', style: { padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', width: '100%', boxSizing: 'border-box' } }),
        React.createElement('div', { key: 'b', style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } }, [
          React.createElement('button', { key: 'c', onClick: () => setEditWhen(null), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', fontWeight: 400, cursor: 'pointer' } }, 'Cancel'),
          React.createElement('button', { key: 's', onClick: async () => { const id = editWhen.id; const w = editWhen.when; setEditWhen(null); if (!id) return; try { const dd = parseFlexDate(whenDate); const tt = parseFlexTime(whenTime); if (!dd || !tt) return; const nd = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0'); const nt = String(tt.h).padStart(2, '0') + ':' + String(tt.m).padStart(2, '0') + ':' + String(tt.sec).padStart(2, '0'); if (w.type === 'once') await call('updateSchedule', { id, when: { date: nd + 'T' + nt } }); else await call('updateSchedule', { id, when: { at: nt } }); refresh() } catch {} }, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Save'),
        ]),
      ]),
    ]) : null,
    deleteViews ? React.createElement(ConfirmModal, { key: 'dv', title: deleteViews.length === 1 ? 'Delete view?' : 'Delete ' + deleteViews.length + ' views?', subtitle: deleteViews.length === 1 ? deleteViews[0].name + ' will be permanently deleted.' : deleteViews.length + ' views will be permanently deleted.', onCancel: () => setDeleteViews(null), onConfirm: () => doDelete(deleteViews) }) : null,
    deleteTask ? React.createElement(ConfirmModal, { key: 'dt', title: deleteTask.items.length === 1 ? 'Delete task?' : 'Delete ' + deleteTask.items.length + ' tasks?', subtitle: deleteTask.section ? 'All tasks in "' + deleteTask.section + '" will be permanently deleted.' : deleteTask.items.length + (deleteTask.items.length === 1 ? ' task will be permanently deleted.' : ' tasks will be permanently deleted.'), onCancel: () => setDeleteTask(null), onConfirm: () => doDeleteTask(deleteTask) }) : null,
    createTaskOpen ? React.createElement('div', { key: 'ct', style: { position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setCreateTaskOpen(false) }, React.createElement('div', { onClick: (e: any) => e.stopPropagation(), style: { backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: 20, width: 440, maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 } }, [
      React.createElement('div', { key: 't', style: { color: 'var(--q-text)', fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'New task'),
      React.createElement('div', { key: 'l1', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'Title'),
      React.createElement('input', { key: 'i1', value: ctTitle, onChange: (e: any) => setCtTitle(e.target.value), placeholder: 'e.g. Create report', style: { padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', width: '100%', boxSizing: 'border-box' } }),
      React.createElement('div', { key: 'l2', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'Task text (optional — add \"Verify:\" with shell commands to check the result)'),
      React.createElement('textarea', { key: 'i2', value: ctText, onChange: (e: any) => setCtText(e.target.value), placeholder: 'Create the file /tmp/test.txt with content hello.\nVerify: test -f /tmp/test.txt && grep -q hello /tmp/test.txt', rows: 3, style: { padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-interface)', width: '100%', boxSizing: 'border-box', resize: 'vertical' } }),
      React.createElement('div', { key: 'l3', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'Agent'),
      React.createElement(MiniSelect, { key: 'i3', value: ctAgent, options: (agents || []).map((a: any) => ({ value: a.id, label: a.name || a.id })), onChange: (v: string) => setCtAgent(v) }),
      React.createElement('div', { key: 'l4', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'When (leave empty to run now)'),
      React.createElement('div', { key: 'i4', style: { display: 'flex', gap: 8 } }, [
        React.createElement('input', { key: 'd', value: ctDate, onChange: (e: any) => setCtDate(e.target.value), placeholder: '12 August 2026', style: { flex: 1, padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', boxSizing: 'border-box' } }),
        React.createElement('input', { key: 'tm', value: ctTime, onChange: (e: any) => setCtTime(e.target.value), placeholder: '14:30:00', style: { width: 110, padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', boxSizing: 'border-box' } }),
      ]),
      React.createElement('div', { key: 'l5', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'Recurrence'),
      React.createElement(MiniSelect, { key: 'i5', value: ctRecur, options: [{ value: 'once', label: 'Once' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }], onChange: (v: string) => setCtRecur(v) }),
      React.createElement('div', { key: 'l6', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'Model · Thinking'),
      React.createElement('div', { key: 'i6', style: { display: 'flex', gap: 8 } }, [
        React.createElement('button', { key: 'm', onClick: () => setMtModelPicker({ id: '__new__', model: ctModel }), style: { flex: 1, padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text-secondary)', fontSize: 13, fontFamily: 'var(--font-interface)', cursor: 'pointer', textAlign: 'left' } }, ctModel || 'Chat default'),
        React.createElement('button', { key: 'th', onClick: () => setMtThinkingPicker({ id: '__new__', thinking: ctThinking }), style: { flex: 1, padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'var(--q-bg-elevated)', color: 'var(--q-text-secondary)', fontSize: 13, fontFamily: 'var(--font-interface)', cursor: 'pointer', textAlign: 'left' } }, ctThinking === null ? 'Chat default' : ctThinking === 'off' ? 'Off' : 'On (' + ctThinking + ')'),
      ]),
      React.createElement('div', { key: 'l7', style: { color: 'var(--q-text-secondary)', fontSize: 12.5, fontFamily: 'var(--font-interface)' } }, 'Chat (optional — empty creates a new session)'),
      React.createElement(MiniSelect, { key: 'i7', value: ctChat, options: [{ value: '', label: 'Auto-create session' }, ...sessions.map(s => ({ value: s.key, label: s.label }))], onChange: (v: string) => setCtChat(v) }),
      React.createElement('div', { key: 'b', style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } }, [
        React.createElement('button', { key: 'c', onClick: () => setCreateTaskOpen(false), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: 13, fontFamily: 'var(--font-interface)', fontWeight: 400, cursor: 'pointer' } }, 'Cancel'),
        React.createElement('button', { key: 's', onClick: doCreateTask, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Create'),
      ]),
    ])) : null,
  ])
}