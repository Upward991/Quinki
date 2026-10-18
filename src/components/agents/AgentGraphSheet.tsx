import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Network, Plus, Maximize, X } from '../icons'
import { useSidecarContext } from '../shared/AppShell'

/**
 * AgentGraphSheet — il grafo degli agenti a schermo intero.
 *
 * Sostituisce il vecchio menù a tendina degli agenti nella chat. Mostra:
 * l'orchestrator in alto, sotto (con le frecce) gli agenti che PUÒ delegare,
 * poi i loro, all'infinito — la gerarchia viene da `delegates` nel config.
 *
 * Navigazione: rotella = zoom (sul puntatore), trascina = pan, ⤢ = adatta tutto,
 * +/− = zoom manuale con percentuale. Clic su un nodo = apri l'agente.
 * `+ sub` su un nodo = scegli chi può essere delegato da lui (scrive `delegates`).
 */

type Props = {
  agents: any[]
  chatAgentIds: string[]
  orchestratorId: string
  orchestratorModel?: string
  orchestratorThinking?: string
  onClose: () => void
  onOpenAgent: (id: string) => void
  onAddAgent: () => void
  onRefreshAgents?: () => void
}

const NODE_W = 196
const NODE_H = 78
const GAP_X = 26
const GAP_Y = 54

type TNode = { id: string; agent: any; depth: number; x: number; y: number; children: TNode[]; isOrch: boolean }

export function AgentGraphSheet(props: Props) {
  const { call } = useSidecarContext()
  const { agents = [], chatAgentIds = [], orchestratorId } = props
  const byId = useMemo(() => {
    const m: Record<string, any> = {}
    for (const a of agents) m[a.id] = a
    return m
  }, [agents])

  // ── albero ────────────────────────────────────────────────────────────────
  const root = useMemo(() => {
    const seen = new Set<string>()
    const build = (id: string, depth: number, chain: Set<string>): TNode | null => {
      const agent = byId[id]
      if (!agent) return null
      seen.add(id)
      const kidsIds: string[] = Array.isArray(agent.delegates) ? agent.delegates.filter((d: string) => d && d !== id) : []
      const kids: TNode[] = []
      for (const k of kidsIds) {
        if (chain.has(k) || !byId[k]) continue // anti-ciclo: mai un ciclo nel disegno
        const n = build(k, depth + 1, new Set([...chain, k]))
        if (n) kids.push(n)
      }
      return { id, agent, depth, x: 0, y: depth * (NODE_H + GAP_Y), children: kids, isOrch: false }
    }
    const orchId = orchestratorId && byId[orchestratorId] ? orchestratorId : chatAgentIds.find(id => byId[id])
    if (!orchId) return null
    const r = build(orchId, 0, new Set([orchId]))
    if (r) r.isOrch = true
    return r
  }, [byId, chatAgentIds, orchestratorId])

  // agente della chat NON raggiungibili dalla radice (o senza orchestrator): righe a parte
  const extraRoots = useMemo(() => {
    const reachable = new Set<string>()
    const walk = (n: TNode | null) => { if (!n) return; reachable.add(n.id); n.children.forEach(walk) }
    walk(root)
    return chatAgentIds.filter(id => byId[id] && !reachable.has(id)).map(id => ({ id, agent: byId[id] }))
  }, [root, chatAgentIds, byId])

  // ── layout (larghezza dei sottoalberi, poi x) ────────────────────────────
  const laid = useMemo(() => {
    const nodes: TNode[] = []
    if (!root) return { nodes, width: 0, height: 0 }
    const measure = (n: TNode): number => {
      if (!n.children.length) { n.x = 0; return 1 }
      const ws = n.children.map(measure)
      const total = ws.reduce((a, b) => a + b, 0)
      let acc = 0
      n.children.forEach((c, i) => {
        c.x = acc + ws[i] / 2 - total / 2
        acc += ws[i]
      })
      return total
    }
    const units = measure(root)
    const unitW = NODE_W + GAP_X
    const place = (n: TNode, cx: number) => {
      n.x = cx + n.x * unitW
      nodes.push(n)
      for (const c of n.children) place(c, n.x)
    }
    place(root, (units - 1) * unitW / 2)
    const minX = Math.min(...nodes.map(n => n.x))
    for (const n of nodes) n.x -= minX
    const maxX = Math.max(...nodes.map(n => n.x))
    const maxY = Math.max(...nodes.map(n => n.y))
    return { nodes, width: maxX + NODE_W, height: maxY + NODE_H }
  }, [root])

  // ── zoom / pan ───────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const fit = () => {
    const el = viewRef.current
    if (!el || !laid.width || !laid.height) return
    const pad = 48
    const z = Math.min((el.clientWidth - pad * 2) / laid.width, (el.clientHeight - pad * 2) / laid.height, 1.4)
    const zz = Math.max(0.15, z)
    setZoom(zz)
    setPan({
      x: (el.clientWidth - laid.width * zz) / 2,
      y: Math.max(pad, (el.clientHeight - laid.height * zz) / 2),
    })
  }

  useEffect(() => { const t = setTimeout(fit, 30); return () => clearTimeout(t) }, [laid.width, laid.height])

  // Esc chiude (come ogni pannello dell'app)
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
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const next = Math.min(2.5, Math.max(0.12, zoom * (e.deltaY < 0 ? 1.08 : 0.92)))
    // zoom verso il puntatore
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
    if (!d) return
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
  }
  const onPointerUp = () => { dragRef.current = null }

  // ── + sub (chi può essere delegato da questo agente) ─────────────────────
  const [pickFor, setPickFor] = useState<string | null>(null)
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

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'var(--q-bg)', display: 'flex', flexDirection: 'column' }}>
      {/* barra */}
      <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderBottom: '1px solid var(--q-border)' }}>
        <Bot size={18} style={{ color: 'var(--q-text-secondary)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)', color: 'var(--q-text)' }}>Agents</span>
        <span style={{ fontSize: 12, color: 'var(--q-text-tertiary)', fontFamily: 'var(--font-interface)' }}>
          {laid.nodes.length} in the graph · {Math.round(zoom * 100)}%
        </span>
        <div style={{ flex: 1 }} />
        <IconBtn title="Zoom out" onClick={() => setZoom(z => Math.max(0.12, z * 0.9))}><span style={{ fontSize: 16, lineHeight: 1 }}>−</span></IconBtn>
        <IconBtn title="Zoom in" onClick={() => setZoom(z => Math.min(2.5, z * 1.1))}><Plus size={16} /></IconBtn>
        <IconBtn title="Fit to screen" onClick={fit}><Maximize size={16} /></IconBtn>
        <div style={{ width: 6 }} />
        <button
          onClick={() => { props.onAddAgent(); }}
          style={{ height: 30, padding: '0 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
        >+ Agent</button>
        <IconBtn title="Close" onClick={props.onClose}><X size={18} /></IconBtn>
      </div>

      {/* tela */}
      <div
        ref={viewRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ position: 'relative', flex: 1, overflow: 'hidden', cursor: dragRef.current ? 'grabbing' : 'grab', background: 'var(--q-chat-bg, var(--q-bg))' }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: laid.width, height: laid.height }}>
          {/* frecce */}
          <svg width={laid.width} height={laid.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {edges.map((e, i) => {
              const x1 = e.from.x + NODE_W / 2, y1 = e.from.y + NODE_H
              const x2 = e.to.x + NODE_W / 2, y2 = e.to.y
              const my = (y1 + y2) / 2
              return (
                <path key={i} d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
                  fill="none" stroke="var(--q-border)" strokeWidth={1.4} />
              )
            })}
          </svg>

          {/* nodi */}
          {laid.nodes.map(n => (
            <div key={n.id} data-node-card
              onDoubleClick={() => props.onOpenAgent(n.id)}
              style={{
                position: 'absolute', left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H,
                backgroundColor: 'var(--q-bg)', border: `1px solid ${n.isOrch ? 'var(--q-tab-accent)' : 'var(--q-border)'}`,
                borderRadius: 'var(--radius-lg)', padding: '10px 12px', cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,.05)',
              }}
              onClick={() => props.onOpenAgent(n.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {n.isOrch ? <Network size={14} style={{ color: 'var(--q-tab-accent)', flexShrink: 0 }} /> : <Bot size={14} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />}
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--q-text)', fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.agent.name || n.id}</span>
                <div style={{ flex: 1 }} />
                {n.children.length > 0 && (
                  <span style={{ fontSize: 10.5, color: 'var(--q-text-tertiary)', fontFamily: 'var(--font-interface)' }}>{n.children.length}</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {n.agent.model && <Pill>{String(n.agent.model).split('/').pop()}</Pill>}
                {n.agent.thinkingLevel && <Pill>{n.agent.thinkingLevel}</Pill>}
                <div style={{ flex: 1 }} />
                <button
                  onClick={(ev) => { ev.stopPropagation(); setPickFor(n.id === pickFor ? null : n.id) }}
                  title="Choose who this agent can delegate to"
                  style={{ height: 20, padding: '0 7px', borderRadius: 999, border: '1px solid var(--q-border)', background: 'transparent', color: 'var(--q-text-secondary)', fontSize: 10.5, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
                >+ sub</button>
              </div>

              {/* scelta dei delegati */}
              {pickFor === n.id && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 230, maxHeight: 240, overflowY: 'auto', zIndex: 10, background: 'var(--q-bg)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}
                >
                  {(agents || []).filter(a => a.id !== n.id).map(a => {
                    const on = Array.isArray(n.agent.delegates) && n.agent.delegates.includes(a.id)
                    return (
                      <div key={a.id} onClick={() => toggleDelegate(n.id, a.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-interface)', color: 'var(--q-text)' }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--q-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <span style={{ width: 14, color: on ? 'var(--q-tab-accent)' : 'var(--q-text-tertiary)' }}>{on ? '✓' : ''}</span>
                        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || a.id}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* altri agenti della chat, non nel grafo */}
        {extraRoots.length > 0 && (
          <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '60%' }}>
            {extraRoots.map(r => (
              <button key={r.id} onClick={() => props.onOpenAgent(r.id)}
                style={{ height: 26, padding: '0 10px', borderRadius: 999, border: '1px solid var(--q-border)', background: 'var(--q-bg)', color: 'var(--q-text-secondary)', fontSize: 11.5, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}
              >{r.agent?.name || r.id}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 999, border: '1px solid var(--q-border)', color: 'var(--q-text-secondary)', fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' }}>{children}</span>
  )
}

function IconBtn({ children, onClick, title }: any) {
  return (
    <button title={title} onClick={onClick}
      style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', border: '1px solid transparent', background: 'transparent', color: 'var(--q-text-secondary)', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.color = 'var(--q-text)' }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-text-secondary)' }}
    >{children}</button>
  )
}
