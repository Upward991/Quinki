import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Network, Plus, Maximize, MessageSquare, Cpu, Brain, RefreshCw } from '../icons'
import { useSidecarContext } from '../shared/AppShell'

/**
 * AgentGraphSheet — il grafo degli agenti della chat, a schermo intero.
 *
 * REGOLE (19 ott):
 * - Nessun orchestrator automatico. Senza orchestrator gli agenti stanno in riga.
 * - Un solo agente in chat → card con "change agent" e "sub agent".
 * - Più agenti senza orchestrator → solo modello/thinking (niente change, niente sub).
 * - Con orchestrator → l'orchestrator ha "sub agent"; gli altri modello/thinking/sub.
 * - Il menu del tasto destro è quello ORIGINALE (Set as orchestrator / Select /
 *   Remove) con la conferma originale. Il tasto a sinistra torna alla chat.
 * - Le card hanno l'altezza del loro contenuto (niente spazio vuoto).
 */

type Props = {
  agents: any[]
  chatAgentIds: string[]
  orchestratorId: string
  onClose: () => void
  onOpenAgent: (id: string) => void
  onChangeAgent: (id: string) => void
  onPickModel: (id: string) => void
  onPickThinking: (id: string) => void
  onRefreshAgents?: () => void
  onSetOrchestrator: (id: string) => void
  agentOverrides?: Record<string, any>
  selectMode: boolean
  picked: Set<string>
  onContextMenu: (id: string, x: number, y: number) => void
  onTogglePick: (id: string) => void
}

const NODE_W = 210
const ROOT_H = 64    // orchestrator: nome + sub agent
const H_DUE = 88     // nome + 2 chip
const H_TRE = 111    // nome + 3 chip
const GAP_X = 30
const GAP_Y = 54

type TNode = { id: string; agent: any; depth: number; x: number; y: number; children: TNode[]; isOrch: boolean }

export function AgentGraphSheet(props: Props) {
  const { call } = useSidecarContext()
  // Canale RPC: preferiamo quello GLOBALE dell'app (sempre presente), con fallback al context.
  const rpc = (m: string, p: any) => {
    const w = (window as any).__sidecarCall
    if (typeof w === 'function') return Promise.resolve(w(m, p))
    return Promise.resolve(call ? call(m, p) : null)
  }
  const { agents = [], chatAgentIds = [], orchestratorId, agentOverrides = {}, selectMode, picked } = props

  const byId = useMemo(() => {
    const m: Record<string, any> = {}
    for (const a of agents) m[a.id] = a
    return m
  }, [agents])

  const orchId = (orchestratorId && byId[orchestratorId]) ? orchestratorId : ''
  const soloUno = chatAgentIds.length <= 1
  const [subFor, setSubFor] = useState<string | null>(null)
  const [changeFor, setChangeFor] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2200); return () => clearTimeout(t) }, [toast])

  // altezza reale della card in base a cosa contiene
  const cardH = (n: TNode) => n.isOrch ? ROOT_H : (soloUno ? H_DUE : (orchId ? H_TRE : H_DUE))

  const laid = useMemo(() => {
    const nodes: TNode[] = []

    const build = (id: string, depth: number, chain: Set<string>, markOrch: boolean): TNode | null => {
      const agent = byId[id]
      if (!agent) return null
      let kidsIds: string[] = []
      if (depth === 0 && markOrch) {
        const declared = Array.isArray(agent.delegates) ? agent.delegates.filter(Boolean) : []
        kidsIds = declared.length ? declared : chatAgentIds.filter(x => x !== id)
      } else {
        kidsIds = Array.isArray(agent.delegates) ? agent.delegates.filter(Boolean) : []
      }
      const kids: TNode[] = []
      for (const k of kidsIds) {
        if (k === id || chain.has(k) || !byId[k]) continue
        const n = build(k, depth + 1, new Set([...chain, k]), markOrch)
        if (n) kids.push(n)
      }
      return { id, agent, depth, x: 0, y: 0, children: kids, isOrch: markOrch && depth === 0 }
    }

    const measure = (n: TNode): number => {
      if (!n.children.length) { n.x = 0; return 1 }
      const ws = n.children.map(measure)
      const total = ws.reduce((a, b) => a + b, 0)
      let acc = 0
      n.children.forEach((c, i) => { c.x = acc + ws[i] / 2 - total / 2; acc += ws[i] })
      return total
    }

    const unitW = NODE_W + GAP_X
    const H = soloUno ? H_DUE : (orchId ? H_TRE : H_DUE)
    const placeTree = (root: TNode, offsetX: number) => {
      const units = measure(root)
      const place = (n: TNode, cx: number) => {
        n.x = cx + n.x * unitW
        n.y = n.depth * (H + GAP_Y) + (n.depth === 0 ? 0 : ROOT_H - H) // la radice orch è più bassa
        nodes.push(n)
        for (const c of n.children) place(c, n.x)
      }
      place(root, offsetX + (units - 1) * unitW / 2)
      return units * unitW
    }

    let width = 0
    if (orchId) {
      const root = build(orchId, 0, new Set([orchId]), true)
      if (!root) return { nodes, width: 0, height: 0 }
      width = placeTree(root, 0)
    } else {
      // Nessun orchestrator: foresta — ogni agente della chat CON I SUOI sub-agent
      const roots = chatAgentIds.filter(id => byId[id]).map(id => build(id, 0, new Set([id]), false)).filter(Boolean) as TNode[]
      if (!roots.length) return { nodes, width: 0, height: 0 }
      let offset = 0
      for (const r of roots) { offset += placeTree(r, offset); offset += GAP_X }
      width = offset - GAP_X
    }

    const minX = Math.min(...nodes.map(n => n.x))
    for (const n of nodes) n.x -= minX
    const maxY = Math.max(...nodes.map(n => n.y + cardH(n)))
    return { nodes, width, height: maxY }
  }, [orchId, byId, chatAgentIds, soloUno])

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const MIN_Z = 0.5, MAX_Z = 3

  // All'apertura deve entrare TUTTO l'albero: zoom dinamico (max 300%, min 50%).
  useEffect(() => {
    const el = viewRef.current
    if (!el || !laid.width) return
    const pad = 48
    const z = Math.max(MIN_Z, Math.min(MAX_Z, (el.clientWidth - pad * 2) / laid.width, (el.clientHeight - pad * 2) / laid.height))
    setZoom(z)
    setPan({ x: (el.clientWidth - laid.width * z) / 2, y: Math.max(20, (el.clientHeight - laid.height * z) / 2) })
  }, [laid.width, laid.height])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSubFor(null); setChangeFor(false); props.onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const fit = () => {
    const el = viewRef.current
    if (!el || !laid.width) return
    const pad = 56
    const z = Math.min(MAX_Z, (el.clientWidth - pad * 2) / laid.width, (el.clientHeight - pad * 2) / laid.height)
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
      {/* heading — pannelli flottanti, larghezza standard */}
      <div style={{ flexShrink: 0, marginBottom: 8, paddingBottom: 6, width: '100%', maxWidth: 'var(--spacing-chat-max)', margin: '0 auto' }}>
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
            <IconBtn title="Zoom out" onClick={() => setZoom(z => Math.max(MIN_Z, z * 0.9))}><span style={{ fontSize: 16, lineHeight: 1 }}>−</span></IconBtn>
            <span style={{ minWidth: 42, textAlign: 'center', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)' }}>{pct}%</span>
            <IconBtn title="Zoom in" onClick={() => setZoom(z => Math.min(MAX_Z, z * 1.1))}><span style={{ fontSize: 15, lineHeight: 1 }}>+</span></IconBtn>
            <IconBtn title="Fit to screen" onClick={fit}><Maximize size={16} /></IconBtn>
          </div>
        </div>
      </div>

      {/* tela */}
      <div ref={viewRef} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', cursor: dragRef.current ? 'grabbing' : 'default' }}>
        {laid.nodes.length === 0 ? (
          <div style={{ padding: 40, color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' }}>No agents in this chat.</div>
        ) : (
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: laid.width, height: laid.height }}>
            <svg width={laid.width} height={laid.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
              {edges.map((e, i) => {
                const x1 = e.from.x + NODE_W / 2
                const y1 = e.from.y + cardH(e.from)
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
              const bloccato = selectMode ? 'none' : 'auto'
              return (
                <div key={n.id} data-node-card
                  onClick={() => { if (selectMode) props.onTogglePick(n.id); else props.onOpenAgent(n.id) }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); props.onContextMenu(n.id, e.clientX, e.clientY) }}
                  style={{
                    position: 'absolute', left: n.x + NODE_W / 2, top: n.y, transform: 'translateX(-50%)',
                    width: 'max-content', maxWidth: 340,
                    height: cardH(n),
                    backgroundColor: isPicked ? 'var(--q-danger, #e5484d)' : 'var(--q-bg-panel)',
                    border: '1px solid var(--q-border)',
                    borderRadius: 'var(--radius-lg)', padding: '10px 13px 13px 13px', cursor: 'pointer',
                    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {n.isOrch
                      ? <Network size={14} style={{ color: isPicked ? '#fff' : 'var(--q-text-secondary)', flexShrink: 0 }} />
                      : <Bot size={14} style={{ color: isPicked ? '#fff' : 'var(--q-text-secondary)', flexShrink: 0 }} />}
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: isPicked ? '#fff' : 'var(--q-text)', fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap' }}>{n.agent.name || n.id}</span>
                  </div>

                  {/* UN SOLO agente: change agent ✗ sub agent */}
                  {soloUno && (
                    <>
                      <div style={{ display: 'flex', marginTop: 7, pointerEvents: bloccato }}>
                        <Chip picked={isPicked} onClick={(e: any) => { e.stopPropagation(); setChangeFor(true) }} icon={<RefreshCw size={11} />}>change agent</Chip>
                      </div>
                      <div style={{ display: 'flex', marginTop: 4, pointerEvents: bloccato }}>
                        <Chip picked={isPicked} onClick={(e: any) => { e.stopPropagation(); setSubFor(n.id) }} icon={<Plus size={11} />}>sub agent</Chip>
                      </div>
                    </>
                  )}

                  {/* PIU' agenti, non orchestrator: modello ✗ thinking (+ sub se c'è l'orchestrator) */}
                  {!soloUno && !n.isOrch && (
                    <>
                      <div style={{ display: 'flex', marginTop: 7, pointerEvents: bloccato }}>
                        <Chip picked={isPicked} onClick={(e: any) => { e.stopPropagation(); props.onPickModel(n.id) }} icon={<Cpu size={11} />}>
                          {String(ov.model || n.agent.model || 'Chat default').split('/').pop()}
                        </Chip>
                      </div>
                      <div style={{ display: 'flex', marginTop: 4, pointerEvents: bloccato }}>
                        <Chip picked={isPicked} onClick={(e: any) => { e.stopPropagation(); props.onPickThinking(n.id) }} icon={<Brain size={11} />}>{thinking}</Chip>
                      </div>
                      {orchId && (
                        <div style={{ display: 'flex', marginTop: 4, pointerEvents: bloccato }}>
                          <Chip picked={isPicked} onClick={(e: any) => { e.stopPropagation(); setSubFor(n.id) }} icon={<Plus size={11} />}>sub agent</Chip>
                        </div>
                      )}
                    </>
                  )}

                  {/* ORCHESTRATOR: nome ✗ sub agent */}
                  {!soloUno && n.isOrch && (
                    <div style={{ display: 'flex', marginTop: 6, pointerEvents: bloccato }}>
                      <Chip picked={isPicked} onClick={(e: any) => { e.stopPropagation(); setSubFor(n.id) }} icon={<Plus size={11} />}>sub agent</Chip>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* PICKER LOCALE (stesso design di quello della chat, zero dipendenze) */}
      {subFor && (
        <PickerOverlay
          title={`Add sub agents to ${byId[subFor]?.name || subFor}`}
          agents={agents}
          exclude={[...chatAgentIds, ...((byId[subFor]?.delegates as string[]) || [])]}
          onClose={() => setSubFor(null)}
          onConfirm={async (ids) => {
            const cur: string[] = Array.isArray(byId[subFor]?.delegates) ? byId[subFor].delegates : []
            try {
              const res: any = await rpc('updateAgent', { id: subFor, config: { delegates: [...cur, ...ids] } })
              if (res && res.success === false) { alert('Add sub agent failed: ' + (res.error || 'unknown')); return }
              if (!orchId) { try { props.onSetOrchestrator(subFor) } catch {} }
              props.onRefreshAgents?.()
              setToast(`Added ${ids.length} sub agent${ids.length > 1 ? 's' : ''}`)
              setSubFor(null)
            } catch (e: any) { alert('Add sub agent failed: ' + (e?.message || String(e))) }
          }}
        />
      )}

      {changeFor && (
        <PickerOverlay
          title="Change agent"
          agents={agents}
          exclude={chatAgentIds}
          single
          onClose={() => setChangeFor(false)}
          onConfirm={(ids) => {
            if (ids[0]) { try { props.onChangeAgent(ids[0]); setToast('Agent changed') } catch (e: any) { alert('Change failed: ' + (e?.message || String(e))) } }
            setChangeFor(false)
          }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 950, backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', padding: '10px 16px', color: 'var(--q-text)', fontSize: 12.5, fontFamily: 'var(--font-interface)', boxShadow: '0 10px 30px rgba(0,0,0,.25)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

function Chip({ children, icon, onClick, picked }: any) {
  return (
    <span onClick={onClick}
      onMouseEnter={(e: any) => (e.currentTarget.style.backgroundColor = 'var(--q-hover)')}
      onMouseLeave={(e: any) => (e.currentTarget.style.backgroundColor = 'transparent')}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        padding: '2px 9px', borderRadius: 999, lineHeight: 1,
        border: `1px solid ${picked ? 'rgba(255,255,255,.5)' : 'var(--q-border)'}`,
        fontSize: 10.5, color: picked ? '#fff' : 'var(--q-text-secondary)',
        fontFamily: 'var(--font-interface)', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {icon}{children}
    </span>
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

/** Picker agenti — stesso design di quello della chat, ma locale al grafo. */
function PickerOverlay({ title, agents, exclude, single, onClose, onConfirm }: any) {
  const [sel, setSel] = React.useState<Set<string>>(new Set())
  const [q, setQ] = React.useState('')
  const list = (agents || [])
    .filter((a: any) => !(exclude || []).includes(a.id))
    .filter((a: any) => String(a.name || '').toLowerCase().includes(q.toLowerCase()))
  const toggle = (id: string) => {
    if (single) { setSel(new Set([id])); return }
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, flexShrink: 0 }}>
          <span style={{ color: 'var(--q-text)', fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{title}</span>
        </div>
        <div style={{ padding: '8px 16px', flexShrink: 0 }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search..."
            style={{ width: '100%', boxSizing: 'border-box', height: 36, padding: '0 10px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)', color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', outline: 'none' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 120 }}>
          {list.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' }}>No agents available</div>
          )}
          {list.map((a: any) => (
            <div key={a.id} onClick={() => toggle(a.id)}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--q-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0, color: 'var(--q-text)', fontSize: 14, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || a.id}</div>
              <input type={single ? 'radio' : 'checkbox'} checked={sel.has(a.id)} onChange={() => toggle(a.id)} onClick={e => e.stopPropagation()}
                style={{ accentColor: 'var(--q-tab-accent)', width: 16, height: 16, cursor: 'pointer' }} />
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, borderTop: '1px solid var(--q-border)' }}>
          <button onClick={() => setSel(new Set(list.map((a: any) => a.id)))} disabled={list.length === 0}
            style={{ background: 'none', border: 'none', color: list.length ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', fontSize: 12.5, fontFamily: 'var(--font-interface)', cursor: list.length ? 'pointer' : 'default' }}>Select all</button>
          <button onClick={() => setSel(new Set())} disabled={sel.size === 0}
            style={{ background: 'none', border: 'none', color: sel.size ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', fontSize: 12.5, fontFamily: 'var(--font-interface)', cursor: sel.size ? 'pointer' : 'default' }}>Select none</button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}
            style={{ height: 34, padding: '0 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onConfirm([...sel])} disabled={sel.size === 0}
            style={{ height: 34, padding: '0 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', background: sel.size ? 'var(--q-tab-accent)' : 'transparent', color: sel.size ? '#fff' : 'var(--q-tab-accent)', fontSize: 13, fontFamily: 'var(--font-interface)', cursor: sel.size ? 'pointer' : 'default' }}>Add</button>
        </div>
      </div>
    </div>
  )
}
