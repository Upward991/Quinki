import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Network, Plus, Maximize, MessageSquare, Cpu, Brain, RefreshCw, ChevronLeft, ChevronRight, Menu } from '../icons'
import { useSidecarContext } from '../shared/AppShell'
import { AgentPickerModal } from '../chat/AgentPickerModal'
import { BottomSheet } from '../chat/BottomSheet'
import { useLayout } from '../../platform/layout'

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
  onMakeOrchestrator: (id: string) => void
  onSelectAgent: (id: string) => void
  sessionKey: string
  onRemoveFromChat: (id: string) => void
  onToggleChatAgent: (id: string) => void
  agentOverrides?: Record<string, any>
  selectMode: boolean
  picked: Set<string>
  onContextMenu: (id: string, x: number, y: number) => void
  onTogglePick: (id: string) => void
  delegateTree: Record<string, string[]>
  refreshSignal?: number
  modelLabel?: (id: string) => string
  thinkingLabel?: (lv: string) => string
  onRequestRemoveSelected: () => void
  onCancelSelect: () => void
}

const EMPTY_TREE: Record<string, string[]> = {}
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
  /** RPC robusta: se il motore non è ancora connesso (boot) riprova, e logga l'errore.
   *  Prima l'errore era inghiottito: il primo Add su una chat "non faceva niente". */
  const rpc = async (m: string, p: any) => {
    for (let i = 0; i < 4; i++) {
      try {
        const w = (window as any).__sidecarCall
        const r = typeof w === 'function' ? await w(m, p) : (call ? await call(m, p) : null)
        if (r !== null && r !== undefined) return r
      } catch (e: any) { dlog('rpc-error', { m, err: String(e?.message || e) }) }
      await new Promise((r) => setTimeout(r, 350))
    }
    return null
  }
  const { agents = [], chatAgentIds = [], orchestratorId, agentOverrides = {}, selectMode, picked, delegateTree = {}, modelLabel, thinkingLabel } = props

  // Copia locale: dopo un salvataggio rileggo gli agenti e ridisegno SUBITO,
  // senza aspettare il refresh globale dell'app.
  const [localAgents, setLocalAgents] = useState<any[]>(agents)
  // NON svuotare mai la copia locale con un array vuoto (succede durante il refresh dell'app)
  useEffect(() => { if (Array.isArray(agents) && agents.length) setLocalAgents(agents) }, [agents])
  const reloadAgents = async () => {
    try {
      const r: any = await rpc('listAgents', {})
      const list = r?.agents || []
      if (Array.isArray(list) && list.length) {
        const mapped = list.map((a: any) => ({ ...a, delegates: Array.isArray(a.delegates) ? a.delegates : [] }))
        setLocalAgents(mapped)
        try { props.onRefreshAgents?.() } catch {}
        return mapped
      }
    } catch {}
    try { props.onRefreshAgents?.() } catch {}
    return null
  }

  useEffect(() => {
    reloadAgents()
    reloadOrch()
    dlog('graph-open', { sessionKey: props.sessionKey, chatIds, orchId, tree, agents: localAgents.length })
  }, [])

  // Il ruolo va riletto dal motore: quando resta un solo agente il motore lo AZZERA
  // e il grafo deve smettere di mostrare l'orchestrator.
  const refreshing = React.useRef(false)
  const clearingOrch = React.useRef(false)
  const reloadOrch = async () => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const r: any = await rpc('listSessions', {})
      const s = (r?.sessions || []).find((x: any) => x.key === props.sessionKey)
      setLocalOrch((s?.orchestratorId || '') as string)
      const ids = String(s?.agentId || '').split(',').map((x: string) => x.trim()).filter(Boolean)
      if (ids.length) setLocalChatIds(ids)
      const __tree = ((s as any)?.delegateTree || {}) as Record<string, string[]>
      setTree(__tree)
      setCanUndo(!!(s as any)?.graphCanUndo)
      setCanRedo(!!(s as any)?.graphCanRedo)
      dlog('reload-orch', { sessionKey: props.sessionKey, agentId: s?.agentId, orch: s?.orchestratorId, tree: (s as any)?.delegateTree })
    } catch {} finally { refreshing.current = false }
  }

  /** UNA scrittura per tutta la chat: agenti + orchestrator + albero. */
  /** Modifica transazionale: legge l'albero FRESCO dal motore, applica, scrive. */
  // Log diagnostico → ~/.quinki/agent-graph-debug.log (il client lo manda al motore)
  const dlog = (tag: string, data: any) => { try { rpc('clientLog', { tag, data }) } catch {} }

  const byId = useMemo(() => {
    const m: Record<string, any> = {}
    for (const a of localAgents) m[a.id] = a
    return m
  }, [localAgents])

  // Ruolo: SOLO quello scelto (ora il motore lo restituisce anche con 1 agente).
  // Niente derivazioni: senza ruolo il grafo resta senza orchestrator.
  // Il ruolo si legge dal MOTORE (reloadOrch); la prop può essere vecchia e non deve sovrascrivere.
  const [localOrch, setLocalOrch] = useState(orchestratorId)
  const [localChatIds, setLocalChatIds] = useState<string[]>(chatAgentIds)
  const [tree, setTree] = useState<Record<string, string[]>>(delegateTree || EMPTY_TREE)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const mob = useLayout().mode === 'mobile'
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => { if (Array.isArray(chatAgentIds) && chatAgentIds.length) setLocalChatIds(chatAgentIds) }, [chatAgentIds])
  // FONTE VERA: l'app può avere la lista vecchia; il motore no.
  const chatIds = localChatIds.length ? localChatIds : chatAgentIds
  const orchId = (localOrch && byId[localOrch]) ? localOrch : ''
  // "solo un agente" vale SOLO se in chat c'è un agente e NON ha sub-agent.
  const soloUno = chatIds.length <= 1
  const [subFor, setSubFor] = useState<string | null>(null)
  const [changeFor, setChangeFor] = useState(false)

  // altezza reale della card in base a cosa contiene
  const cardH = (n: TNode) => n.isOrch ? ROOT_H : (soloUno ? H_DUE : (orchId ? H_TRE : H_DUE))

  // VISTA: sempre l'albero riletto dal motore (localTree), mai la prop stantia.
  const tView: Record<string, string[]> = Object.keys(tree).length ? tree : (delegateTree || EMPTY_TREE)
  const laid = useMemo(() => {
    const nodes: TNode[] = []
    const placed = new Set<string>() // un agente = un solo nodo nell'albero

    const build = (id: string, depth: number, chain: Set<string>, markOrch: boolean): TNode | null => {
      const agent = byId[id]
      if (!agent) return null
      if (placed.has(id)) return null
      placed.add(id)
      let kidsIds: string[] = []
      // ALBERO = UNICA VERITÀ: la radice ha SOLO i figli dichiarati (non tutti gli agenti).
      // Fallback solo per dati vecchi senza legami.
      const declared = (tView[id] || []).filter(Boolean)
      kidsIds = declared
      const kids: TNode[] = []
      for (const k of kidsIds) {
        if (k === id || chain.has(k) || !byId[k] || kids.some(x => x.id === k)) continue
        const n = build(k, depth + 1, new Set([...chain, k]), markOrch)
        if (n) kids.push(n)
      }
      return { id, agent, depth, x: 0, y: 0, children: kids, isOrch: markOrch && depth === 0 && kids.length > 0 }
    }

    const measure = (n: TNode): number => {
      if (!n.children.length) { n.x = 0; return 1 }
      const ws = n.children.map(measure)
      const total = ws.reduce((a, b) => a + b, 0)
      // FIGLI A SINISTRA, NON CENTRATI: aggiungerne non sposta il padre di posizione.
      let acc = 0
      n.children.forEach((c, i) => { c.x = acc; acc += ws[i] })
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
      place(root, offsetX)
      return units * unitW
    }

    let width = 0
    if (orchId) {
      const root = build(orchId, 0, new Set([orchId]), true)
      if (!root) return { nodes, width: 0, height: 0 }
      width = placeTree(root, 0)
    } else {
      // Nessun orchestrator: foresta — ogni agente della chat CON I SUOI sub-agent
      // SENZA orchestrator il tree è piatto: niente sub-tree.
      const roots = chatIds.filter(id => byId[id]).map(id => ({ id, agent: byId[id], depth: 0, x: 0, y: 0, children: [], isOrch: false })) as TNode[]
      if (!roots.length) return { nodes, width: 0, height: 0 }
      let offset = 0
      for (const r of roots) { offset += placeTree(r, offset); offset += GAP_X }
      width = offset - GAP_X
    }

    const minX = Math.min(...nodes.map(n => n.x))
    for (const n of nodes) n.x -= minX
    const maxY = Math.max(...nodes.map(n => n.y + cardH(n)))
    return { nodes, width, height: maxY }
  }, [orchId, byId, chatIds, soloUno, tView])

  // Log del render: cosa la UI ha DAVVERO in mano (solo quando cambia)
  useEffect(() => { reloadAgents(); reloadOrch() }, [props.refreshSignal])

  const lastRenderRef = React.useRef('')
  try {
    const snap = JSON.stringify({ chatIds, orch: orchId, tree, nodes: laid?.nodes?.length, agents: localAgents.length })
    if (snap !== lastRenderRef.current) { lastRenderRef.current = snap; dlog('render', JSON.parse(snap)) }
  } catch {}

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const pinchRef = useRef<{ d0: number; z0: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      pinchRef.current = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z0: zoomRef.current }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinchRef.current) return
    e.preventDefault()
    const [a, b] = [e.touches[0], e.touches[1]]
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
    const ratio = d / pinchRef.current.d0
    const z0 = zoomRef.current
    const next = Math.min(MAX_Z, Math.max(MIN_Z, pinchRef.current.z0 * ratio))
    const rect = viewRef.current?.getBoundingClientRect()
    const mx = (a.clientX + b.clientX) / 2 - (rect?.left || 0)
    const my = (a.clientY + b.clientY) / 2 - (rect?.top || 0)
    setPan(p => ({ x: mx - (mx - p.x) * (next / z0), y: my - (my - p.y) * (next / z0) }))
    setZoom(next)
  }
  const onTouchEnd = () => { if (pinchRef.current) pinchRef.current = null }
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


  // ── operazioni strutturali (regole utente) ──────────────────────────────
  /** Rimuove un nodo a QUALSIASI livello: i suoi figli salgono di un livello.
   *  - se era un sub-agent: i figli entrano nei delegates del padre
   *  - se era un agente della chat: i figli salgono al primo livello (delegates dell'orchestrator)
   *  - se era l'orchestrator: il ruolo si azzera (NESSUN automatismo)
   */
  const removeNode = async (id: string) => {
    dlog('remove-start', { id, chatIds, tree })
    if (chatIds.includes(id)) {
      try { props.onRemoveFromChat(id) } catch {}   // dialogo originale
    } else {
      try { await (props as any).onRemoveSubAgents?.([id]) } catch {}
      await Promise.all([reloadAgents(), reloadOrch()])
    }
  }

  // Scorciatoie ⌘Z / ⇧⌘Z (solo con il grafo aperto, mai dentro un campo di testo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const t: any = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) { if (canRedo) void graphStep('redo') } else { if (canUndo) void graphStep('undo') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canUndo, canRedo])

  /** Annulla / ripristina l'ultima modifica del GRAFO (10 passi, per chat). */
  const graphStep = async (dir: 'undo' | 'redo') => {
    try { await rpc(dir === 'undo' ? 'graphUndo' : 'graphRedo', { sessionKey: props.sessionKey }) } catch {}
    await Promise.all([reloadAgents(), reloadOrch()])
  }

  // La conferma ORIGINALE (in ChatHeader) deve usare la rimozione con promozione dei figli.

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
    <div style={{ position: 'fixed', top: mob ? 0 : 25, left: 0, right: 0, bottom: 0, zIndex: 300, backgroundColor: 'var(--q-bg)', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box' }}>
      {/* heading — pannelli flottanti, larghezza standard */}
      <div style={{ flexShrink: 0, marginBottom: 8, paddingBottom: 6, width: '100%', maxWidth: 'var(--spacing-chat-max)', margin: '0 auto' }}>
        {mob ? (
          <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
            <div style={panelStyle}>
              <IconBtn title="Back to chat" onClick={props.onClose}><MessageSquare size={20} /></IconBtn>
            </div>
            <div style={{ ...panelStyle, flex: 1, minWidth: 0 }}>
              <div style={{ width: 8, flexShrink: 0 }} />
              <Bot size={18} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
              <div style={{ width: 12, flexShrink: 0 }} />
              <span style={{ color: 'var(--q-text)', fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-interface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Agents in chat</span>
              <div style={{ flex: 1 }} />
              <IconBtn title="Menu" onClick={() => setSheetOpen(true)}><Menu size={20} /></IconBtn>
            </div>
          </div>
        ) : (
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

            <div style={{ width: 10, flexShrink: 0 }} />
            {(['undo', 'redo'] as const).map((dir) => {
              const on = dir === 'undo' ? canUndo : canRedo
              return (
                <button key={dir}
                  onClick={() => { if (on) void graphStep(dir) }}
                  onMouseEnter={e => { if (on) { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.color = 'var(--q-text)' } }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-text-secondary)' }}
                  style={{
                    marginLeft: dir === 'redo' ? 6 : 0,
                    padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)',
                    backgroundColor: 'transparent', color: 'var(--q-text-secondary)',
                    fontSize: 12, fontFamily: 'var(--font-interface)', textTransform: 'capitalize',
                    opacity: on ? 1 : 0.35, cursor: on ? 'pointer' : 'default', whiteSpace: 'nowrap',
                  }}
                >{dir}</button>
              )
            })}

            <div style={{ flex: 1 }} />
            <IconBtn title="Zoom out" onClick={() => setZoom(z => Math.max(MIN_Z, z * 0.9))}><span style={{ fontSize: 16, lineHeight: 1 }}>−</span></IconBtn>
            <span style={{ minWidth: 42, textAlign: 'center', color: 'var(--q-text)', fontSize: 12, fontFamily: 'var(--font-interface)' }}>{pct}%</span>
            <IconBtn title="Zoom in" onClick={() => setZoom(z => Math.min(MAX_Z, z * 1.1))}><span style={{ fontSize: 15, lineHeight: 1 }}>+</span></IconBtn>
            <IconBtn title="Fit to screen" onClick={fit}><Maximize size={16} /></IconBtn>
          </div>
        </div>
        )}
      </div>

      {/* tela */}
      <div ref={viewRef} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', touchAction: 'none', cursor: dragRef.current ? 'grabbing' : 'default' }}>
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
              const thinking = ov.thinkingLevel ? (thinkingLabel ? thinkingLabel(ov.thinkingLevel) : ov.thinkingLevel) : 'Chat default'
              const bloccato = selectMode ? 'none' : 'auto'
              return (
                <div key={n.id} data-node-card
                  onClick={() => { if (selectMode) props.onTogglePick(n.id); else props.onOpenAgent(n.id) }}
                  onContextMenu={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    props.onContextMenu(n.id, e.clientX, e.clientY, laid.nodes.length) // menu originale + n. nodi
                  }}
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
                          {ov.model ? (() => { const n = modelLabel ? modelLabel(ov.model) : ov.model; return n.length > 24 ? n.slice(0, 23) + '…' : n })() : 'Chat default'}
                        </Chip>
                      </div>
                      <div style={{ display: 'flex', marginTop: 4, pointerEvents: bloccato }}>
                        <Chip picked={isPicked} onClick={(e: any) => { e.stopPropagation(); props.onPickThinking(n.id) }} icon={<Brain size={11} />}>{thinking}</Chip>
                      </div>
                      <div style={{ display: 'flex', marginTop: 4, pointerEvents: bloccato }}>
                        <Chip picked={isPicked} onClick={(e: any) => { e.stopPropagation(); setSubFor(n.id) }} icon={<Plus size={11} />}>sub agent</Chip>
                      </div>
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

      {/* MOBILE: tutte le opzioni della testata in un menu dal basso */}
      <BottomSheet
        zIndex={1000}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        items={[
          { icon: <ChevronLeft size={18} />, label: canUndo ? 'Undo' : 'Undo (nothing to undo)', onSelect: () => { setSheetOpen(false); if (canUndo) void graphStep('undo') } },
          { icon: <ChevronRight size={18} />, label: canRedo ? 'Redo' : 'Redo (nothing to redo)', onSelect: () => { setSheetOpen(false); if (canRedo) void graphStep('redo') } },
          { icon: <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>, label: `Zoom in (${pct}%)`, onSelect: () => setZoom(z => Math.min(MAX_Z, z * 1.15)) },
          { icon: <span style={{ fontSize: 16, lineHeight: 1 }}>−</span>, label: 'Zoom out', onSelect: () => setZoom(z => Math.max(MIN_Z, z * 0.87)) },
          { icon: <Maximize size={18} />, label: 'Fit to screen', onSelect: () => { setSheetOpen(false); fit() } },
        ]}
      />

      {/* Picker ORIGINALE della chat (stessa grafica): sub agent */}
      {subFor && (
        <AgentPickerModal
          agents={agents}
          initialSelected={[...new Set([...chatIds, ...laid.nodes.map(n => n.id), ...(tView[subFor] || [])])]}
          title={`Add sub agents to ${byId[subFor]?.name || subFor}`}
          onClose={() => setSubFor(null)}
          onAdd={async (ids: string[]) => {
            const cur: string[] = (tree[subFor] || [])
            dlog('add-click', { parent: subFor, ids, treeBefore: tree, chatBefore: chatIds })
            try {
              // ALBERO (strato nuovo): scrivi la struttura della chat
              // ALBERO (motore): un nodo ha UN SOLO padre → attachToParent stacca e attacca
              try { await rpc('attachToParent', { sessionKey: props.sessionKey, parentId: subFor, ids }) } catch {}
              await Promise.all([reloadAgents(), reloadOrch()])
              dlog('add-done', { parent: subFor, ids, tree, chatIds, orch: orchId })
              setSubFor(null)
            } catch {}
          }}
        />
      )}

      {/* Picker ORIGINALE: change agent (selezione singola, si conferma con Add) */}
      {changeFor && (
        <AgentPickerModal
          agents={agents}
          initialSelected={chatIds}
          title="Change agent"
          single
          onClose={() => setChangeFor(false)}
          onAdd={(ids: string[]) => {
            if (ids[0]) { try { props.onChangeAgent(ids[0]) } catch {} }
            setChangeFor(false)
          }}
        />
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
        maxWidth: 152, overflow: 'hidden',
      }}>
      {icon}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{children}</span>
    </span>
  )
}

function IconBtn({ children, onClick, title, style }: any) {
  return (
    <button title={title} onClick={onClick}
      style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', border: '1px solid transparent', background: 'transparent', color: 'var(--q-text-secondary)', cursor: 'pointer' , ...style}}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.color = 'var(--q-text)' }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-text-secondary)' }}>
      {children}
    </button>
  )
}
