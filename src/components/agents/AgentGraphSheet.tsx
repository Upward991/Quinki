import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Network, Plus, Maximize, MessageSquare, Cpu, Brain } from '../icons'
import { useSidecarContext } from '../shared/AppShell'

/**
 * AgentGraphSheet — il grafo degli agenti della chat, a schermo intero.
 *
 * Sostituisce il menù a tendina: l'orchestrator in alto, sotto gli agenti che
 * può delegare (frecce), poi i loro, senza limiti. La gerarchia viene da
 * `delegates`; per l'orchestrator, se non c'è, valgono gli agenti della chat
 * (come fa il motore).
 *
 * Heading identica alle altre tab (pannelli flottanti separati, larghezza
 * standard). Zoom 50–300% con rotella sul puntatore, trascinamento, adatta,
 * percentuale fra − e +. Tasto a sinistra = icona chat (chiude e torna).
 */

type Props = {
  agents: any[]
  chatAgentIds: string[]
  orchestratorId: string
  onClose: () => void
  onOpenAgent: (id: string) => void
  onRemoveAgent: (id: string) => void
  onSetOrchestrator: (id: string) => void
  onPickModel: (id: string) => void
  onPickThinking: (id: string) => void
  onRefreshAgents?: () => void
  agentOverrides?: Record<string, any>
}

const NODE_W = 210        // larghezza di riferimento per il layout
const NODE_H = 96         // altezza card agente
const ROOT_H = 46         // altezza card orchestrator (compatta)
const GAP_X = 30
const GAP_Y = 54

type TNode = { id: string; agent: any; depth: number; x: number; y: number; children: TNode[]; isRoot: boolean }

export function AgentGraphSheet(props: Props) {
  const { call } = useSidecarContext()
  const { agents = [], chatAgentIds = [], orchestratorId, agentOverrides = {} } = props

  const byId = useMemo(() => {
    const m: Record<string, any> = {}
    for (const a of agents) m[a.id] = a
    return m
  }, [agents])

  const rootId = (orchestratorId && byId[orchestratorId]) ? orchestratorId : chatAgentIds.find(id => byId[id]) || ''

  const tree = useMemo(() => {
    if (!rootId) return null
    const build = (id: string, depth: number, chain: Set<string>): TNode | null => {
      const agent = byId[id]
      if (!agent) return null
      let kidsIds: string[] = []
      if (depth === 0) {
        const declared = Array.isArray(agent.delegates) ? agent.delegates.filter(Boolean) : []
        kidsIds = declared.length ? declared : chatAgentIds.filter(x => x !== id)
      } else {
        kidsIds = Array.isArray(agent.delegates) ? agent.delegates.filter(Boolean) : []
      }
      const kids: TNode[] = []
      for (const k of kidsIds) {
        if (k === id || chain.has(k) || !byId[k]) continue
        const n = build(k, depth + 1, new Set([...chain, k]))
        if (n) kids.push(n)
      }
      return { id, agent, depth, x: 0, y: 0, children: kids, isRoot: depth === 0 }
    }
    return build(rootId, 0, new Set([rootId]))
  }, [rootId, byId, chatAgentIds])

  // ── layout: larghezze dei sottoalberi, poi le y in base alle altezze vere ──
  const laid = useMemo(() => {
    const nodes: TNode[] = []
    if (!tree) return { nodes, width: 0, height: 0 }
    const measure = (n: TNode): number => {
      if (!n.children.length) { n.x = 0; return 1 }
      const ws = n.children.map(measure)
      const total = ws.reduce((a, b) => a + b, 0)
      let acc = 0
      n.children.forEach((c, i) => { c.x = acc + ws[i] / 2 - total / 2; acc += ws[i] })
      return total
    }
    const units = measure(tree)
    const unitW = NODE_W + GAP_X
    // y: la radice è più bassa, gli altri hanno altezza piena
    const yFor = (depth: number) => depth === 0 ? 0 : ROOT_H + GAP_Y + (depth - 1) * (NODE_H + GAP_Y)
    const place = (n: TNode, cx: number) => {
      n.x = cx + n.x * unitW
      n.y = yFor(n.depth)
      nodes.push(n)
      for (const c of n.children) place(c, n.x)
    }
    place(tree, (units - 1) * unitW / 2)
    const minX = Math.min(...nodes.map(n => n.x))
    for (const n of nodes) n.x -= minX
    const maxX = Math.max(...nodes.map(n => n.x))
    const maxY = Math.max(...nodes.map(n => n.y + (n.isRoot ? ROOT_H : NODE_H)))
    return { nodes, width: maxX + NODE_W, height: maxY }
  }, [tree])

  // ── zoom (50–300%) / pan ─────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const MIN_Z = 0.5, MAX_Z = 3

  useEffect(() => {
    const el = viewRef.current
    if (!el || !laid.width) return
    setZoom(1)
    setPan({ x: (el.clientWidth - laid.width) / 2, y: 28 })
  }, [laid.width, laid.height])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const fit = () => {
    const el = viewRef.current
    if (!el || !laid.width) return
    const pad = 56
    const z = Math.min(1, (el.clientWidth - pad * 2) / laid.width, (el.clientHeight - pad * 2) / laid.height)
    const zz = Math.max(MIN_Z, Math.min(MAX_Z, z))
    setZoom(zz)
    setPan({ x: (el.clientWidth - laid.width * zz) / 2, y: Math.max(24, (el.clientHeight - laid.height * zz) / 2) })
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const el = viewRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const next = Math.min(MAX_Z, Math.max(MIN_Z, zoom * (e.deltaY < 0 ? 1.08 : 0.92)))
    setPan({ x: mx - (mx - pan.x) * (next / zoom), y: my - (my - pan.y) * (next / zoom) })
    setZoom(next)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-node-card]')) return
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (d) setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
  }
  const onPointerUp = () => { dragRef.current = null }

  // ── selezione multipla / menu contestuale / +sub ─────────────────────────
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [subFor, setSubFor] = useState<string | null>(null)

  const togglePicked = (id: string) => setPicked(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const removePicked = () => { for (const id of picked) props.onRemoveAgent(id); setPicked(new Set()); setSelectMode(false) }

  const toggleDelegate = async (parentId: string, childId: string) => {
    const cur: string[] = Array.isArray(byId[parentId]?.delegates) ? [...byId[parentId].delegates] : []
    const next = cur.includes(childId) ? cur.filter(x => x !== childId) : [...cur, childId]
    try {
      await call('updateAgent', { id: parentId, config: { delegates: next } })
      props.onRefreshAgents?.()
    } catch {}
  }

  const edges: { from: TNode; to: TNode }[] = []
  for (const n of laid.nodes) for (const c of n.children) edges.push({ from: n, to: c })
  const pct = Math.round(zoom * 100)

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'var(--q-bg-panel)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-floating)',
    padding: '8px',
    minHeight: 'var(--spacing-header-min)',
    display: 'flex',
    alignItems: 'center',
  }

  return (
    <div style={{ position: 'fixed', top: 25, left: 0, right: 0, bottom: 0, zIndex: 300, backgroundColor: 'var(--q-bg)', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box' }}>
      {/* ── heading: pannelli flottanti separati, larghezza standard ── */}
      <div style={{ flexShrink: 0, marginBottom: 8, width: '100%', maxWidth: 'var(--spacing-chat-max)', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
          <div style={panelStyle}>
            <IconBtn title="Back to chat" onClick={props.onClose}><MessageSquare size={20} /></IconBtn>
          </div>

          <div style={{ ...panelStyle, flex: 1, minWidth: 0 }}>
            <div style={{ width: 8, flexShrink: 0 }} />
            <Bot size={18} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
            <div style={{ width: 16, flexShrink: 0 }} />
            <span style={{ color: 'var(--q-text)', fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' }}>Agents in chat</span>
            <span style={{ color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', marginLeft: 10, whiteSpace: 'nowrap' }}>
              {laid.nodes.length} {laid.nodes.length === 1 ? 'agent' : 'agents'}
            </span>
            <div style={{ flex: 1 }} />

            {selectMode ? (
              <>
                <TinyBtn danger disabled={picked.size === 0} onClick={removePicked}>Remove{picked.size ? ` (${picked.size})` : ''}</TinyBtn>
                <TinyBtn onClick={() => { setSelectMode(false); setPicked(new Set()) }}>Cancel</TinyBtn>
              </>
            ) : (
              <TinyBtn onClick={() => setSelectMode(true)}>Select Agents</TinyBtn>
            )}

            <IconBtn title="Zoom out" onClick={() => setZoom(z => Math.max(MIN_Z, z * 0.9))}><span style={{ fontSize: 16, lineHeight: 1 }}>−</span></IconBtn>
            <span style={{ minWidth: 42, textAlign: 'center', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)' }}>{pct}%</span>
            <IconBtn title="Zoom in" onClick={() => setZoom(z => Math.min(MAX_Z, z * 1.1))}><span style={{ fontSize: 15, lineHeight: 1 }}>+</span></IconBtn>
            <IconBtn title="Fit to screen" onClick={fit}><Maximize size={16} /></IconBtn>
          </div>

          <div style={panelStyle}>
            <IconBtn title="Add agent" onClick={() => {
              // aggiunge un agente alla chat: riusa il picker della chat
              ;(props as any).onAddAgent?.()
            }}><Plus size={18} /></IconBtn>
          </div>
        </div>
      </div>

      {/* ── tela (stesso sfondo dell'app) ── */}
      <div ref={viewRef} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', cursor: dragRef.current ? 'grabbing' : 'default' }}>
        {laid.nodes.length === 0 ? (
          <div style={{ padding: 40, color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' }}>No agents in this chat.</div>
        ) : (
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: laid.width, height: laid.height }}>
            <svg width={laid.width} height={laid.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
              {edges.map((e, i) => {
                const x1 = e.from.x + NODE_W / 2
                const y1 = e.from.y + (e.from.isRoot ? ROOT_H : NODE_H)
                const x2 = e.to.x + NODE_W / 2
                const y2 = e.to.y
                const my = (y1 + y2) / 2
                return <path key={i} d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`} fill="none" stroke="var(--q-border)" strokeWidth={1.4} />
              })}
            </svg>

            {laid.nodes.map(n => {
              const isPicked = picked.has(n.id)
              const ov = agentOverrides?.[n.id] || {}
              const thinking = ov.thinkingLevel === 'off' ? 'off' : ov.thinkingLevel ? ov.thinkingLevel : 'Chat default'
              return (
                <div key={n.id} data-node-card
                  onClick={() => { if (selectMode) togglePicked(n.id); else props.onOpenAgent(n.id) }}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ id: n.id, x: e.clientX, y: e.clientY }) }}
                  style={{
                    position: 'absolute', left: n.x + NODE_W / 2, top: n.y, transform: 'translateX(-50%)',
                    width: 'max-content', maxWidth: 320,
                    height: n.isRoot ? ROOT_H : NODE_H,
                    backgroundColor: isPicked ? 'var(--q-danger, #e5484d)' : 'var(--q-bg-panel)',
                    border: '1px solid var(--q-border)',
                    borderRadius: 'var(--radius-lg)', padding: n.isRoot ? '0 14px' : '10px 13px', cursor: 'pointer',
                    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: n.isRoot ? 'center' : 'flex-start',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {n.isRoot
                      ? <Network size={14} style={{ color: isPicked ? '#fff' : 'var(--q-text-secondary)', flexShrink: 0 }} />
                      : <Bot size={14} style={{ color: isPicked ? '#fff' : 'var(--q-text-secondary)', flexShrink: 0 }} />}
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: isPicked ? '#fff' : 'var(--q-text)', fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' }}>{n.agent.name || n.id}</span>
                  </div>

                  {!n.isRoot && (
                    <>
                      {/* modello (nome intero) sopra, thinking sotto */}
                      <div style={{ display: 'flex', marginTop: 8 }}>
                        <Chip picked={isPicked} onClick={(e) => { e.stopPropagation(); props.onPickModel(n.id) }} icon={<Cpu size={11} />}>
                          {String(ov.model || n.agent.model || 'Chat default').split('/').pop()}
                        </Chip>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
                        <Chip picked={isPicked} onClick={(e) => { e.stopPropagation(); props.onPickThinking(n.id) }} icon={<Brain size={11} />}>
                          {thinking}
                        </Chip>
                        <div style={{ flex: 1 }} />
                        <span onClick={(e) => { e.stopPropagation(); setSubFor(subFor === n.id ? null : n.id) }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--q-hover)')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                          style={{ fontSize: 10.5, color: isPicked ? '#fff' : 'var(--q-text-tertiary)', fontFamily: 'var(--font-interface)', cursor: 'pointer', marginLeft: 8, padding: '1px 6px', borderRadius: 999 }}>+ sub agent</span>
                      </div>
                    </>
                  )}

                  {subFor === n.id && !n.isRoot && (
                    <div onClick={e => e.stopPropagation()}
                      style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 236, maxHeight: 250, overflowY: 'auto', zIndex: 10, backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', padding: 6, boxShadow: '0 10px 30px rgba(0,0,0,.22)' }}>
                      {(agents || []).filter(a => a.id !== n.id).map(a => {
                        const on = Array.isArray(byId[n.id]?.delegates) && byId[n.id].delegates.includes(a.id)
                        return (
                          <div key={a.id} onClick={() => toggleDelegate(n.id, a.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-interface)', color: 'var(--q-text)' }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--q-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                            <span style={{ width: 12, color: on ? 'var(--q-text)' : 'var(--q-text-tertiary)' }}>{on ? '✓' : ''}</span>
                            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || a.id}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* menu contestuale del nodo (solo azioni che non stanno altrove) */}
        {menu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
            <div style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 21, minWidth: 190, backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', padding: 5, boxShadow: '0 10px 30px rgba(0,0,0,.22)' }}>
              {menu.id !== rootId && (
                <MenuItem onClick={() => { props.onSetOrchestrator(menu.id); setMenu(null) }}>Set as orchestrator</MenuItem>
              )}
              <MenuItem danger onClick={() => { props.onRemoveAgent(menu.id); setMenu(null) }}>Remove from chat</MenuItem>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Chip({ children, icon, onClick, picked }: any) {
  return (
    <span onClick={onClick}
      onMouseEnter={(e: any) => (e.currentTarget.style.backgroundColor = 'var(--q-hover)')}
      onMouseLeave={(e: any) => (e.currentTarget.style.backgroundColor = 'transparent')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999,
        border: `1px solid ${picked ? 'rgba(255,255,255,.5)' : 'var(--q-border)'}`,
        fontSize: 10.5, color: picked ? '#fff' : 'var(--q-text-secondary)',
        fontFamily: 'var(--font-interface)', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {icon}{children}
    </span>
  )
}

function TinyBtn({ children, onClick, disabled, danger }: any) {
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.backgroundColor = 'var(--q-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
      style={{ height: 28, padding: '0 10px', marginRight: 6, borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: disabled ? 'var(--q-text-tertiary)' : danger ? 'var(--q-danger, #e5484d)' : 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: disabled ? 'default' : 'pointer' }}>
      {children}
    </button>
  )
}

function MenuItem({ children, onClick, danger }: any) {
  return (
    <div onClick={onClick}
      style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12.5, fontFamily: 'var(--font-interface)', color: danger ? 'var(--q-danger, #e5484d)' : 'var(--q-text)', cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--q-hover)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>{children}</div>
  )
}

function IconBtn({ children, onClick, title }: any) {
  return (
    <button title={title} onClick={onClick}
      style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', border: '1px solid transparent', background: 'transparent', color: 'var(--q-text-secondary)', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.color = 'var(--q-text)' }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-text-secondary)' }}>
      {children}
    </button>
  )
}
