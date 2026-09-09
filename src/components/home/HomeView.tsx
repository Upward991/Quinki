import React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { invoke } from '@tauri-apps/api/core'
import { useSidecarContext } from '../shared/AppShell'
import { Bot, Store, Search, X } from '../icons'
import { getHomeTabs, saveTabOrder, loadHomeColumns, saveHomeColumns, serializeInstalledTabs, saveInstalledTabs, getMarketItems, saveMarketItems } from '../../tabs'

// A4.1 — Home registry-driven: benvenuto + ricerca + Marketplace + riordino drag&drop
// Layout: tutto centrato; griglia tab responsive (auto-fill) che si adatta alla larghezza.

export function HomeView({onSelectPanel}: {onSelectPanel: (panel: string) => void}) {
  const { call: rpcCall, connected } = useSidecarContext()
  const [ctxMenu, setCtxMenu] = useState<{x: number, y: number, card: any} | null>(null)
  const [query, setQuery] = useState('')
  const [tabs, setTabs] = useState<any[]>(() => getHomeTabs())

  // A4.3: ripristino ISTANTANEO dal file settings (senza aspettare il sidecar) —
  // le tab installate dallo store appaiono subito, anche dopo un reinstall.
  useEffect(() => {
    let cancelled = false
    invoke('read_quinki_settings').then((s: any) => {
      if (cancelled || !s || !s.homeConfig) return
      const hc = s.homeConfig
      if (typeof hc.columns === 'number') { setColumns(hc.columns); saveHomeColumns(hc.columns) }
      if (Array.isArray(hc.order)) { saveTabOrder(hc.order); setTabs(getHomeTabs()) }
      if (Array.isArray(hc.tabs) && hc.tabs.length > 0) { saveInstalledTabs(hc.tabs); setTabs(getHomeTabs()) }
      if (Array.isArray(hc.market) && hc.market.length > 0) {
        const curM = getMarketItems()
        const mergedM = [...curM]
        for (const x of hc.market) { if (!mergedM.some((y: any) => y.id === x.id)) mergedM.push(x) }
        saveMarketItems(mergedM)
      }
      if (Array.isArray(hc.themes) && hc.themes.length > 0) {
        try {
          const cur = JSON.parse(localStorage.getItem('quinki-installed-themes') || '[]') || []
          if (cur.length === 0) localStorage.setItem('quinki-installed-themes', JSON.stringify(hc.themes))
        } catch {}
      }
      if (Array.isArray(hc.repos) && hc.repos.length > 0) {
        try {
          const cur = JSON.parse(localStorage.getItem('quinki-my-repos') || '[]') || []
          if (cur.length === 0) localStorage.setItem('quinki-my-repos', JSON.stringify(hc.repos))
        } catch {}
      }
      if (Array.isArray(hc.registry) && hc.registry.length > 0) {
        try {
          const cur = JSON.parse(localStorage.getItem('quinki-registry') || '[]') || []
          if (cur.length === 0) localStorage.setItem('quinki-registry', JSON.stringify(hc.registry))
        } catch {}
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const setColumnsValue = useCallback((v: number) => {
    setColumns(v); saveHomeColumns(v)
    persistHome(v)
  }, [rpcCall])

  // PERSISTENZA: salva colonne + ordine + tab installate nel file settings (sopravvive a riavvii/reinstall)
  const persistHome = useCallback((cols: number) => {
    try {
      const hc = { columns: cols, order: loadTabOrder(), tabs: serializeInstalledTabs() }
      rpcCall('saveSettings', { homeConfig: hc }).catch(() => {})
    } catch {}
  }, [rpcCall])

  // HYDRATE all'avvio dal file settings — riparte quando il sidecar è connesso
  // e RIPROVA finché le tab installate non sono visibili (al primo avvio dopo un
  // reinstall il sidecar può essere ancora in boot → getSettings fallisce → Home vuota)
  useEffect(() => {
    if (!rpcCall || !connected) return
    let cancelled = false
    let attempts = 0
    const tryHydrate = () => {
      if (cancelled) return
      rpcCall('getSettings', {}).then((s: any) => {
        if (cancelled) return
        if (s && s.homeConfig) {
          const hc = s.homeConfig
          if (typeof hc.columns === 'number') { setColumns(hc.columns); saveHomeColumns(hc.columns) }
          if (Array.isArray(hc.order)) { saveTabOrder(hc.order); setTabs(getHomeTabs()) }
          if (Array.isArray(hc.tabs) && hc.tabs.length > 0) { saveInstalledTabs(hc.tabs); setTabs(getHomeTabs()) }
        }
        // Se le tab installate dal settings non sono ancora visibili, riprova
        const hc2 = s && s.homeConfig
        const want = (hc2 && Array.isArray(hc2.tabs) ? hc2.tabs : []).map((t: any) => t.id)
        const have = getHomeTabs().map((t: any) => t.id)
        const missing = want.some((id: string) => !have.includes(id))
        if (missing && attempts < 8) { attempts++; setTimeout(tryHydrate, 1000) }
      }).catch(() => { if (attempts < 8) { attempts++; setTimeout(tryHydrate, 1000) } })
    }
    tryHydrate()
    return () => { cancelled = true }
  }, [rpcCall, connected])
  const [columns, setColumns] = useState<number>(() => loadHomeColumns())
  const [winW, setWinW] = useState<number>(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // colonne effettive: AUTO (0) → quante ce ne stanno; altrimenti min(impostate, quante ce ne stanno)
  const cardW = 160, gap = 10
  const maxFit = Math.max(1, Math.floor((winW - 64) / (cardW + gap)))
  const effColumns = columns === 0 ? maxFit : Math.min(columns, maxFit)

  const onContext = useCallback((e: React.MouseEvent, card: any) => {
    if (card.id === 'chat' || card.id === 'expert') return
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({x: e.clientX, y: e.clientY, card})
  }, [])

  // === RIORDINO TAB via @dnd-kit (29 ago) — STESSO pattern dei provider in Settings:
  // PointerSensor (funziona con dragDropEnabled nativo, che uccide l'HTML5 DnD su
  // macOS) + DragOverlay (la card SEGUE IL CURSORE durante il drag). ===
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragStart = useCallback((e: any) => {
    setActiveCardId(String(e.active?.id || '') || null)
  }, [])

  const handleDragEnd = useCallback((e: any) => {
    setActiveCardId(null)
    const { active, over } = e
    if (!over || !active || active.id === over.id) return
    const src = String(active.id)
    const targetId = String(over.id)
    setTabs(prev => {
      const ids = prev.map(t => t.id)
      const from = ids.indexOf(src)
      const to = ids.indexOf(targetId)
      if (from < 0 || to < 0) return prev
      const moved = arrayMove(ids, from, to)
      saveTabOrder(moved)
      try { rpcCall('saveSettings', { homeConfig: { columns: columns, order: moved, tabs: serializeInstalledTabs() } }).catch(() => {}) } catch {}
      return moved.map(id => prev.find(t => t.id === id)!).filter(Boolean)
    })
  }, [rpcCall, columns])

  const filtered = query.trim()
    ? tabs.filter(t => t.label.toLowerCase().includes(query.trim().toLowerCase()))
    : tabs

  const activeCard = activeCardId ? (filtered.find((t: any) => t.id === activeCardId) || null) : null

  // Saluto in base all'ora locale: 5-12 morning, 12-18 afternoon, 18-5 evening.
  // FIX (29 ago): non cambia in tempo reale se l'app resta aperta sulla Home
  // (si vedeva 'Good evening' anche alle 8 di mattina). Ora si rivaluta ogni minuto.
  const [hour, setHour] = React.useState(() => new Date().getHours())
  React.useEffect(() => {
    const iv = setInterval(() => setHour(new Date().getHours()), 60000)
    return () => clearInterval(iv)
  }, [])
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening'

  return React.createElement('div',
  {className:'h-full flex flex-col overflow-hidden', style:{backgroundColor:'var(--q-bg)'}},
  // ── OPZIONE B CORRETTA: la sezione sta al CENTRO e SALE con le card;
  // quando il blocco riempie l'altezza, si blocca in alto e parte lo scroll ──
  React.createElement('div',
    {style:{flex:1, minHeight:0, overflowY:'auto', display:'flex', flexDirection:'column', boxSizing:'border-box'}},
    // Spacer superiore (si comprime quando il blocco cresce → la sezione sale)
    React.createElement('div', {style:{flex:1, minHeight:0}}),
    // Sezione superiore: sticky — resta al centro finché c'è spazio, poi si blocca in alto
    React.createElement('div',
      {style:{flexShrink:0, position:'sticky', top:0, zIndex:10, width:'100%', backgroundColor:'transparent', display:'flex', flexDirection:'column', alignItems:'center', padding:'0 32px 28px 32px', boxSizing:'border-box'}},
      // Wrapper con sfondo UI (var(--q-bg), abbinato ai temi): copre benvenuto+searchbox
      // + pochi px sotto. Il padding sotto resta TRASPARENTE (distanza senza tagli).
      React.createElement('div',
        {style:{width:'100%', backgroundColor:'var(--q-bg)', display:'flex', flexDirection:'column', alignItems:'center', paddingTop:'24px', paddingBottom:'8px', boxSizing:'border-box'}},
      // Benvenuto
      React.createElement('div',
        {style:{display:'flex', alignItems:'center', justifyContent:'center', gap:'12px', marginBottom:'20px'}},
        React.createElement('img', {src:'/quinki-logo.png', style:{width:'40px', height:'40px'}}),
        React.createElement('div', {style:{color:'var(--q-text)', fontSize:'22px', fontWeight:700, fontFamily:'var(--font-interface)'}},
          greeting + ', welcome to Quinki!'
        )
      ),
      // Ricerca + Market
      React.createElement('div',
        {style:{display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px', width:'100%', maxWidth:'500px'}},
        React.createElement('div',
          {style:{flex:1, display:'flex', alignItems:'center', gap:'8px', backgroundColor:'var(--q-bg-panel)', border:'1px solid var(--q-border)', borderRadius:'var(--radius-md)', padding:'0 12px', height:'38px'}},
          React.createElement(Search, {size:16, style:{color:'var(--q-text-tertiary)', flexShrink:0}}),
          React.createElement('input',
            {
              value: query,
              onChange: (e: any) => setQuery(e.target.value),
              placeholder: 'Search tabs…',
              style:{flex:1, background:'transparent', border:'none', outline:'none', color:'var(--q-text)', fontSize:'14px', fontFamily:'var(--font-interface)'}
            }
          ),
          query && React.createElement('button',
            {onClick: () => setQuery(''), style:{background:'none', border:'none', cursor:'pointer', color:'var(--q-text-tertiary)', display:'flex', padding:'2px'}},
            React.createElement(X, {size:14})
          )
        ),
        React.createElement('button',
          {
            onClick: () => onSelectPanel('market'),
            title: 'Market',
            onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor='var(--q-tab-accent)'; e.currentTarget.style.color='var(--q-bg)' },
            onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor='transparent'; e.currentTarget.style.color='var(--q-tab-accent)' },
            style:{display:'flex', alignItems:'center', gap:'6px', padding:'0 14px', height:'38px', borderRadius:'var(--radius-md)', border:'1px solid var(--q-tab-accent)', backgroundColor:'transparent', color:'var(--q-tab-accent)', cursor:'pointer', flexShrink:0, transition:'none', fontSize:'13px', fontWeight:600, fontFamily:'var(--font-interface)'}
          },
          React.createElement(Store, {size:16}),
          'Market'
        )
      )
      )
    ),
    // Card
    React.createElement('div',
      {style:{flexShrink:0, padding:'0 32px 56px 32px', boxSizing:'border-box', display:'flex', justifyContent:'center'}},
      React.createElement(DndContext,
        { sensors, collisionDetection: closestCenter, onDragStart: handleDragStart, onDragEnd: handleDragEnd },
        React.createElement(SortableContext,
          { items: filtered.map((t: any) => t.id), strategy: rectSortingStrategy },
          React.createElement('div',
            {style:{display:'grid', gridTemplateColumns:`repeat(${effColumns}, 160px)`, gap:'10px'}},
            filtered.map((card: any, idx: number) =>
              React.createElement(SortableHomeCard, {
                key: card.id, card, idx, onSelectPanel, onContext
              }, card.id)
            )
          )
        ),
        // DragOverlay: la card SEGUE IL CURSORE durante il drag (come i provider)
        React.createElement(DragOverlay, null,
          activeCard ? React.createElement('div',
            {style:{opacity: 0.9, filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))'}},
            React.createElement(HomeCard, { card: activeCard, idx: -1, onSelectPanel: () => {}, onContext: () => {}, floating: true }, activeCard.id)
          ) : null
        )
      )
    ),
    // Spacer inferiore
    React.createElement('div', {style:{flex:1, minHeight:0}})
  ),
  // ── BARRA INFERIORE (29 ago): barra di PADDING — le opzioni (hint drag,
  // colonne, tutorial) vivono ora in Settings → Global defaults → Home ──
  React.createElement('div',
    {style:{flexShrink:0, height:'25px', width:'100%', boxSizing:'border-box', backgroundColor:'var(--q-bg)'}}
  ),
  // ── Custom context menu + Marketplace ──
ctxMenu && React.createElement(React.Fragment, null,
      React.createElement('div', {
        style: {position:'fixed', inset:0, zIndex:9998, backgroundColor:'transparent'},
        onClick: () => setCtxMenu(null),
        onContextMenu: (e: any) => { e.preventDefault(); setCtxMenu(null) }
      }),
      React.createElement('div', {
        style: {
          position:'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 180),
          top: Math.min(ctxMenu.y, window.innerHeight - 50),
          zIndex:9999, backgroundColor:'var(--q-bg-panel)',
          borderRadius:'var(--radius-md)', boxShadow:'var(--shadow-modal)',
          border:'1px solid var(--q-border)', padding:'4px 0', minWidth:'160px'
        }
      },
        ctxMenu.card.id === 'expert'
          ? null
          : React.createElement(CtxItem, {
              label: 'Open in new window',
              onClick: () => {
                invoke('open_in_new_window', {tab: ctxMenu.card.id}).catch(() => {})
                setCtxMenu(null)
              }
            })
      )
    ),
  )
}

function CtxItem({label, onClick}: {label: string, onClick: () => void}) {
  const [hovered, setHovered] = useState(false)
  return React.createElement('button', {
    onClick,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    style: {
      display:'flex', alignItems:'center', width:'100%', padding:'8px 12px',
      border:'none', cursor:'pointer',
      backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
      color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
      fontSize:'14px', fontFamily:'var(--font-interface)', textAlign:'left',
      transition:'none'
    }
  }, label)
}

// Wrapper sortable (pattern dei provider): ref + transform dnd-kit + listeners
function SortableHomeCard({card, idx, onSelectPanel, onContext}: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  return React.createElement('div',
    {
      ref: setNodeRef,
      style: { transform: CSS.Transform.toString(transform), transition: transition || 'none', opacity: isDragging ? 0.3 : 1 },
      ...attributes, ...listeners
    },
    React.createElement(HomeCard, { card, idx, onSelectPanel, onContext }, card.id)
  )
}

function HomeCard({card, idx, onSelectPanel, onContext, floating}: any) {
  const [hovered, setHovered] = useState(false)
  const Icon = card.icon
  return React.createElement('button',
    {
      onClick: () => card.panel && onSelectPanel(card.panel),
      onContextMenu: (e: any) => onContext(e, card),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        width:'160px', height:'110px', backgroundColor:'var(--q-bg-panel)',
        borderRadius:'var(--radius-lg)',
        border:`1px solid ${(hovered || floating) ? 'var(--q-border-strong)' : 'var(--q-border)'}`,
        boxShadow: (hovered || floating) ? '0 0 0 1px var(--q-border-strong), 0 0 24px rgba(157, 139, 217, 0.06), inset 0 1px 0 rgba(255,255,255,0.02)' : 'var(--shadow-floating)',
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        cursor: floating ? 'grabbing' : 'pointer', position:'relative', overflow:'hidden',
        transform: (hovered || floating) ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'none'
      }
    },
    React.createElement('div', {style:{position:'absolute', inset:0, background:`radial-gradient(ellipse 80% 60% at 50% 50%, ${card.color}, transparent 70%)`, opacity:(hovered||floating)?0.06:0, transition: 'none', pointerEvents:'none'}}),
    React.createElement('div', {style:{display:'flex', alignItems:'center', justifyContent:'center', transform:(hovered||floating)?'scale(1.05)':'scale(1)', transition: 'none'}},
      card.doubleBot ? React.createElement(Bot, {size:28, style:{color:card.color}}) : React.createElement(Icon, {size:28, style:{color:card.color}})
    ),
    React.createElement('div', {style:{height:'10px'}}),
    React.createElement('span', {style:{color:'var(--q-text)', fontSize:'14px', fontWeight:500, fontFamily:'var(--font-interface)'}}, card.label),
  )
}
