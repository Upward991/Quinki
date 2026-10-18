import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Home, Network, Plus, Maximize, X, Cpu, Brain } from '../icons'
import { useSidecarContext } from '../shared/AppShell'

/**
 * AgentGraphSheet — il grafo degli agenti, a schermo intero.
 *
 * Sostituisce il menù a tendina degli agenti nella chat. Mostra l'albero:
 * l'orchestrator in alto, sotto gli agenti che può delegare (con le frecce),
 * poi i loro, senza limiti. La gerarchia viene da `delegates` nel config;
 * per l'orchestrator, se `delegates` non c'è, valgono gli agenti della chat
 * (esattamente come fa il motore).
 *
 * È una schermata come le altre: stessa heading (stessa larghezza), sotto i
 * semafori, e le sezioni degli agenti sono card con lo sfondo della chat.
 */

type Props = {
  agents: any[]
  chatAgentIds: string[]
  orchestratorId: string
  onClose: () => void
  onOpenAgent: (id: string) => void
  onAddAgent: () => void
  onRemoveAgent: (id: string) => void
  onSetOrchestrator: (id: string) => void
  onPickModel: (id: string) => void
  onPickThinking: (id: string) => void
  onRefreshAgents?: () => void
  onHome?: () => void
  agentOverrides?: Record<string, any>
}

const NODE_W = 208
const NODE_H = 84
const GAP_X = 28
const GAP_Y = 56

type TNode = { id: string; agent: any; depth: number; x: number; y: number; children: TNode[]; isRoot: boolean }

export function AgentGraphSheet(props: Props) {
  const { call } = useSidecarContext()
  const { agents = [], chatAgentIds = [], orchestratorId, agentOverrides = {} } = props

  const byId = useMemo(() => {
    const m: Record<string, any> = {}
    for (const a of agents) m[a.id] = a
    return m
  }, [agents])

  // ── albero ────────────────────────────────────────────────────────────────
  // Radice: l'orchestrator della chat. I suoi figli: `delegates` se configurato,
  // altrimenti GLI AGENTI DELLA CHAT (il fallback che usa anche il motore).
  // Per gli altri nodi: solo `delegates` (niente esplosione).
  const rootId = (orchestratorId && byId[orchestratorId]) ? orchestratorId : chatAgentIds.find(id => byId[id]) || ''

  const tree = useMemo(() => {
    if (!rootId) return null
    const seen = new Set<string>()
    const build = (id: string, depth: number, chain: Set<string>): TNode | null => {
      const agent = byId[id]
      if (!agent) return null
      seen.add(id)
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
      return { id, agent, depth, x: 0, y: depth * (NODE_H + GAP_Y), children: kids, isRoot: depth === 0 }
    }
    return build(rootId, 0, new Set([rootId]))
  }, [rootId, byId, chatAgentIds])

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
    const place = (n: TNode, cx: number) => {
      n.x = cx + n.x * unitW
      nodes.push(n)
      for (const c of n.children) place(c, n.x)
    }
    place(tree, (units - 1) * unitW / 2)
    const minX = Math.min(...nodes.map(n => n.x))
    for (const n of nodes) n.x -= minX
    const maxX = Math.max(...nodes.map(n => n.x))
    const maxY = Math.max(...nodes.map(n => n.y))
    return { nodes, width: maxX + NODE_W, height: maxY + NODE_H }
  }, [tree])

  // ── zoom / pan (base 100%) ────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const center = (z: number) => {
    const el = viewRef.current
    if (!el || !laid.width) return
    setPan({ x: (el.clientWidth - laid.width * z) / 2, y: 32 })
  }
  const fit = () => {
    const el = viewRef.current
    if (!el || !laid.width) return
    const pad = 48
    // "Adatta" riduce solo se serve: NON ingrandisce oltre il 100%.
    const z = Math.min(1, (el.clientWidth - pad * 2) / laid.width, (el.clientHeight - pad * 2) / laid.height)
    const zz = Math.max(0.12, z)
    setZoom(zz)
    setPan({ x: (el.clientWidth - laid.width * zz) / 2, y: Math.max(24, (el.clientHeight - laid.height * zz) / 2) })
  }
  useEffect(() => { center(1) }, [laid.width, laid.height])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const el = viewRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const next = Math.min(2, Math.max(0.12, zoom * (e.deltaY < 0 ? 1.08 : 0.92)))
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

  // ── impostazioni: selezione multipla, orchestrator, rimozione ─────────────
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [subFor, setSubFor] = useState<string | null>(null)

  const togglePicked = (id: string) => {
    setPicked(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
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

  return (
    <div style={{ position: 'fixed', top: 25, left: 0, right: 0, bottom: 0, zIndex: 400, backgroundColor: 'var(--q-bg)', display: 'flex', flexDirection: 'column' }}>
      {/* ── heading standard dell'app (stessa larghezza delle altre schermate) ── */}
      <div style={{ flexShrink: 0, padding: '6px 16px 0 16px' }}>
        <div style={{ width: '100%', maxWidth: 'var(--spacing-chat-max)', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, width: '100%' }}>
            {props.onHome && <IconBtn title="Home" onClick={props.onHome}><Home size={20} /></IconBtn>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <Bot size={18} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
              <span style={{ color: 'var(--q-text)', fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Agents</span>
              <span style={{ color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)' }}>
                {laid.nodes.length} {laid.nodes.length === 1 ? 'agent' : 'agents'} · {pct}%
              </span>
            </div>

            {selectMode ? (
              <>
                <button onClick={removePicked} disabled={picked.size === 0}
                  style={{ height: 28, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: picked.size ? 'var(--q-danger, #e5484d)' : 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: picked.size ? 'pointer' : 'default' }}>
                  Remove{picked.size ? ` (${picked.size})` : ''}
                </button>
                <button onClick={() => { setSelectMode(false); setPicked(new Set()) }}
                  style={{ height: 28, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setSelectMode(true)}
                style={{ height: 28, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Select
              </button>
            )}

            <IconBtn title="Zoom out" onClick={() => setZoom(z => Math.max(0.12, z * 0.9))}><span style={{ fontSize: 16, lineHeight: 1 }}>−</span></IconBtn>
            <IconBtn title="Zoom in" onClick={() => setZoom(z => Math.min(2, z * 1.1))}><span style={{ fontSize: 15, lineHeight: 1 }}>+</span></IconBtn>
            <IconBtn title="Fit to screen" onClick={fit}><Maximize size={16} /></IconBtn>
            <button onClick={props.onAddAgent}
              style={{ height: 28, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
              + Agent
            </button>
            <IconBtn title="Close" onClick={props.onClose}><X size={18} /></IconBtn>
          </div>
        </div>
      </div>

      {/* ── tela ── */}
      <div ref={viewRef} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ position: 'relative', flex: 1, overflow: 'hidden', cursor: dragRef.current ? 'grabbing' : 'default' }}>
        {laid.nodes.length === 0 ? (
          <div style={{ padding: 40, color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' }}>No agents in this chat.</div>
        ) : (
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: laid.width, height: laid.height }}>
            <svg width={laid.width} height={laid.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
              {edges.map((e, i) => {
                const x1 = e.from.x + NODE_W / 2, y1 = e.from.y + NODE_H
                const x2 = e.to.x + NODE_W / 2, y2 = e.to.y
                const my = (y1 + y2) / 2
                return <path key={i} d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`} fill="none" stroke="var(--q-border)" strokeWidth={1.4} />
              })}
            </svg>

            {laid.nodes.map(n => {
              const isPicked = picked.has(n.id)
              return (
                <div key={n.id} data-node-card
                  onClick={() => { if (selectMode) togglePicked(n.id); else props.onOpenAgent(n.id) }}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ id: n.id, x: e.clientX, y: e.clientY }) }}
                  style={{
                    position: 'absolute', left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H,
                    backgroundColor: 'var(--q-bg-panel)',
                    border: `1px solid ${isPicked ? 'var(--q-danger, #e5484d)' : 'var(--q-border)'}`,
                    borderRadius: 'var(--radius-lg)', padding: '11px 13px', cursor: 'pointer',
                    boxSizing: 'border-box',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {n.isRoot ? <Network size={14} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} /> : <Bot size={14} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />}
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--q-text)', fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.agent.name || n.id}</span>
                    {n.isRoot && (
                      <span style={{ flexShrink: 0, fontSize: 9.5, padding: '0 5px', lineHeight: '15px', borderRadius: 999, border: '1px solid var(--q-border)', color: 'var(--q-text-tertiary)', fontFamily: 'var(--font-interface)' }}>orchestrator</span>
                    )}
                  </div>

                  {/* modello / thinking: solo per gli agenti (l'orchestrator usa quelli della chat) */}
                  {!n.isRoot && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <span onClick={(e) => { e.stopPropagation(); props.onPickModel(n.id) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--q-text-secondary)', fontFamily: 'var(--font-interface)', cursor: 'pointer', maxWidth: 110, overflow: 'hidden' }}>
                        <Cpu size={12} style={{ flexShrink: 0 }} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(n.agent.model || 'chat').split('/').pop()}</span>
                      </span>
                      <span onClick={(e) => { e.stopPropagation(); props.onPickThinking(n.id) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--q-text-secondary)', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                        <Brain size={12} style={{ flexShrink: 0 }} />
                        <span>{agentOverrides?.[n.id]?.thinkingLevel === 'off' ? 'Off' : agentOverrides?.[n.id]?.thinkingLevel ? 'On' : 'Chat default'}</span>
                      </span>
                      <div style={{ flex: 1 }} />
                      <span onClick={(e) => { e.stopPropagation(); setSubFor(subFor === n.id ? null : n.id) }}
                        style={{ fontSize: 10.5, color: 'var(--q-text-tertiary)', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>+ sub</span>
                    </div>
                  )}

                  {/* chi può delegare (solo agenti, mai l'orchestrator) */}
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

        {/* menu contestuale del nodo */}
        {menu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
            <div style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 21, minWidth: 190, backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', padding: 5, boxShadow: '0 10px 30px rgba(0,0,0,.22)' }}>
              {menu.id !== rootId && (
                <MenuItem onClick={() => { props.onSetOrchestrator(menu.id); setMenu(null) }}>Set as orchestrator</MenuItem>
              )}
              <MenuItem onClick={() => { props.onOpenAgent(menu.id); setMenu(null) }}>Agent settings…</MenuItem>
              {menu.id !== rootId && (
                <MenuItem danger onClick={() => { props.onRemoveAgent(menu.id); setMenu(null) }}>Remove from chat</MenuItem>
              )}
            </div>
          </>
        )}
      </div>
    </div>
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
