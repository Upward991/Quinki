import React from 'react'
const { useState, useRef, useEffect } = React as any
const { jsx: zjsx, jsxs: zjsxs } = React as any

function LogPanel(props: { activePanel: string; onSelectPanel: (p: string) => void }) {
  const [entries, setEntries] = useState<any[]>([
    { ts: Date.now()-60000, tag: 'ui-click', data: { target: 'button#send', x: 420, y: 180 } },
    { ts: Date.now()-50000, tag: 'bridge:sendMessage', data: 'Sending message to agent' },
    { ts: Date.now()-40000, tag: 'error:stream', data: 'Connection timeout after 30s' },
    { ts: Date.now()-30000, tag: 'renderer:render', data: { component: 'ChatArea', duration: 12 } },
    { ts: Date.now()-20000, tag: 'ws:connect', data: 'WebSocket connected to ws://127.0.0.1:9182' },
    { ts: Date.now()-10000, tag: 'info', data: 'Sidecar ready — PiBridge initialized' },
  ])
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const [showClear, setShowClear] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [currentMatch, setCurrentMatch] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [entries, autoScroll])

  const levelColors: Record<string, any> = {
    error: { bg: 'var(--q-log-error-bg)', text: 'var(--q-log-error-text)', tag: 'var(--q-log-error-tag)', pill: 'var(--q-accent-danger)' },
    warn: { bg: 'var(--q-log-warn-bg)', text: 'var(--q-log-warn-text)', tag: 'var(--q-log-warn-tag)', pill: 'var(--q-accent-warning)' },
    ui: { bg: 'var(--q-log-ui-bg)', text: 'var(--q-log-ui-text)', tag: 'var(--q-log-ui-tag)', pill: 'var(--q-accent-info)' },
    success: { bg: 'var(--q-log-success-bg)', text: 'var(--q-log-success-text)', tag: 'var(--q-log-success-tag)', pill: 'var(--q-accent-success)' },
    bridge: { bg: 'var(--q-log-bridge-bg)', text: 'var(--q-log-bridge-text)', tag: 'var(--q-log-bridge-tag)', pill: 'var(--q-text)' },
    renderer: { bg: 'var(--q-log-renderer-bg)', text: 'var(--q-log-renderer-text)', tag: 'var(--q-log-renderer-tag)', pill: 'var(--q-text-secondary)' },
    info: { bg: 'var(--q-log-info-bg)', text: 'var(--q-log-info-text)', tag: 'var(--q-log-info-tag)', pill: 'var(--q-text-tertiary)' },
  }
  const primaryFilters = ['error', 'warn', 'ui']
  const moreFilters = ['success', 'bridge', 'renderer', 'info']
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december']

  function deriveLevel(tag: string): string {
    if (tag.startsWith('error') || tag.includes('error')) return 'error'
    if (tag.startsWith('warn') || tag.startsWith('warning') || tag === 'retrying') return 'warn'
    if (tag.startsWith('success')) return 'success'
    if (tag.startsWith('ui-') || tag.startsWith('ui:') || tag.includes('ui-click') || tag.includes('ui-nav') || tag.includes('ui-keyboard') || tag.includes('ui-panel')) return 'ui'
    if (tag.startsWith('bridge:') || tag.startsWith('bridge-') || tag.startsWith('full-state-') || tag.startsWith('get_') || tag.startsWith('ws:') || tag.startsWith('send:') || tag.startsWith('stream:') || tag.startsWith('history:') || tag.startsWith('session:')) return 'bridge'
    if (tag.startsWith('renderer:') || tag.startsWith('renderer-')) return 'renderer'
    return 'info'
  }
  function formatPayload(data: any): string {
    if (data == null) return ''
    if (typeof data === 'string') return data
    if (typeof data !== 'object') return String(data)
    try { return JSON.stringify(data, null, 2) } catch { return String(data) }
  }
  function fmtDateShort(ts: number): string { const d = new Date(ts); return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() }
  function fmtTimeShort(ts: number): string { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') }
  function fmtTimestampFull(ts: number): string { return fmtDateShort(ts) + ', ' + fmtTimeShort(ts) }

  const filtered = entries.filter(e => {
    const level = deriveLevel(e.tag)
    if (activeFilters.size > 0 && !activeFilters.has(level)) return false
    if (search) { const p = formatPayload(e.data); const f = (fmtDateShort(e.ts) + ' ' + fmtTimeShort(e.ts) + ' ' + e.tag + ' ' + p).toLowerCase(); if (!f.includes(search.toLowerCase())) return false }
    return true
  })

  const searchMatches: any[] = []
  if (search) { const q = search.toLowerCase(); filtered.forEach((e, i) => { const p = formatPayload(e.data); const f = (fmtDateShort(e.ts) + ' ' + fmtTimeShort(e.ts) + ' ' + e.tag + ' ' + p).toLowerCase(); let idx = 0; while ((idx = f.indexOf(q, idx)) !== -1) { searchMatches.push({ entryIdx: i }); idx += q.length } }) }

  function toggleFilter(level: string) { setActiveFilters(prev => { const n = new Set(prev); if (n.has(level)) n.delete(level); else n.add(level); return n }) }

  // panelStyle — EXACT copy from ChatHeader/SettingsPanel
  const panelStyle: any = {
    backgroundColor: 'var(--q-bg-panel)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-floating)',
    padding: '8px',
    minHeight: 'var(--spacing-header-min)',
    display: 'flex',
    alignItems: 'center',
  }

  // IconBtn — EXACT copy from ChatHeader (32x32, hover bg, no border)
  function IconBtn({ icon: Icon, onClick }: any) {
    return zjsx('button', {
      onClick,
      onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.color = 'var(--q-text)' },
      onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-text-secondary)' },
      style: {
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
        backgroundColor: 'transparent',
        color: 'var(--q-text-secondary)',
        flexShrink: 0, padding: '0',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      children: zjsx(Icon, { size: 20 })
    })
  }

  // FilterPill — border + text, active = fill
  function FilterPill({ level }: { level: string }) {
    const isActive = activeFilters.has(level)
    const color = levelColors[level]?.pill || 'var(--q-text-tertiary)'
    return zjsx('button', {
      onClick: () => toggleFilter(level),
      style: {
        height: '32px', padding: '0 8px', minWidth: '45px',
        borderRadius: 'var(--radius-md)', cursor: 'pointer',
        backgroundColor: isActive ? color : 'transparent',
        border: '1px solid ' + color,
        color: isActive ? 'var(--q-bg)' : color,
        fontSize: '12px', fontFamily: 'var(--font-interface)', fontWeight: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease',
      },
      children: level
    })
  }

  // HeaderBtn — border + text, hover → green (uses DOM events, NO useState = no re-render flash)
  function HeaderBtn({ label, icon, onClick, active }: any) {
    function applyStyle(el: any, isGreen: boolean) {
      el.style.borderColor = isGreen ? 'var(--q-accent-success)' : 'var(--q-border)'
      el.style.color = isGreen ? 'var(--q-accent-success)' : 'var(--q-text-secondary)'
    }
    return zjsxs('button', {
      onClick,
      onMouseEnter: (e: any) => applyStyle(e.currentTarget, true),
      onMouseLeave: (e: any) => applyStyle(e.currentTarget, active || false),
      style: {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '0 8px', height: '32px', borderRadius: 'var(--radius-md)',
        border: '1px solid ' + (active ? 'var(--q-accent-success)' : 'var(--q-border)'),
        cursor: 'pointer',
        backgroundColor: 'transparent',
        color: active ? 'var(--q-accent-success)' : 'var(--q-text-secondary)',
        fontSize: '12px', fontFamily: 'var(--font-interface)',
        transition: 'border-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease',
      },
      children: [icon, label]
    })
  }

  return zjsxs('div', {
    className: 'h-full flex flex-col',
    style: { maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%' },
    children: [
      // Header — EXACT same structure as ChatHeader/SettingsPanel
      zjsxs('div', {
        style: { marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center' },
        children: [
          // Panel 1: Home — same panelStyle + IconBtn as other tabs
          zjsx('div', { style: panelStyle, children: zjsx(IconBtn, { icon: '__HOME__', onClick: () => props.onSelectPanel('home') }) }),
          zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
          // Panel 2: Main header — same panelStyle, position: relative for dropdown
          zjsxs('div', { style: { ...panelStyle, flex: 1 }, children: [
            zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
            // Activity icon — WHITE (var(--q-text-secondary)), not green
            zjsx('__ACTIVITY__', { size: 18, style: { color: 'var(--q-text-secondary)', flexShrink: 0 } }),
            zjsx('div', { style: { width: '12px', flexShrink: 0 } }),
            zjsx('span', { style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }, children: 'Log' }),
            zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
            zjsx('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }, children: '(' + filtered.length + ')' }),
            zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
            // Filter pills — simple pills with 8px spacers between (matching Flutter exactly)
            zjsx(FilterPill, { level: 'error' }),
            zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
            zjsx(FilterPill, { level: 'warn' }),
            zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
            zjsx(FilterPill, { level: 'ui' }),
            zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
            // More button + dropdown — NO React state, pure DOM toggle (no re-render = no flash)
            zjsxs('div', { style: { position: 'relative', display: 'flex', alignItems: 'center' }, children: [
              zjsxs('button', {
                onClick: (e: any) => {
                  const btn = e.currentTarget
                  const isOpen = btn.dataset.open === '1'
                  if (dropdownRef.current) dropdownRef.current.style.display = isOpen ? 'none' : 'flex'
                  if (overlayRef.current) overlayRef.current.style.display = isOpen ? 'none' : 'block'
                  const arrow = btn.querySelector('svg')
                  if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)'
                  btn.dataset.open = isOpen ? '0' : '1'
                  btn.style.borderColor = isOpen ? 'var(--q-border)' : 'var(--q-accent-success)'
                  btn.style.color = isOpen ? 'var(--q-text-secondary)' : 'var(--q-accent-success)'
                },
                onMouseEnter: (e: any) => { e.currentTarget.style.borderColor = 'var(--q-accent-success)'; e.currentTarget.style.color = 'var(--q-accent-success)' },
                onMouseLeave: (e: any) => {
                  const btn = e.currentTarget
                  const isOpen = btn.dataset.open === '1'
                  btn.style.borderColor = isOpen ? 'var(--q-accent-success)' : 'var(--q-border)'
                  btn.style.color = isOpen ? 'var(--q-accent-success)' : 'var(--q-text-secondary)'
                },
                style: {
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '0 8px', height: '32px', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--q-border)', cursor: 'pointer',
                  backgroundColor: 'transparent', color: 'var(--q-text-secondary)',
                  fontSize: '12px', fontFamily: 'var(--font-interface)',
                  transition: 'border-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease',
                },
                children: [
                  zjsx('__CHEVRONRIGHT__', { size: 14, style: { transition: 'transform 120ms ease' } }),
                  'More'
                ]
              }),
              zjsx('div', { ref: overlayRef, style: { position: 'fixed', inset: 0, zIndex: 40, backgroundColor: 'transparent', display: 'none' }, onClick: () => {
                if (dropdownRef.current) dropdownRef.current.style.display = 'none'
                if (overlayRef.current) overlayRef.current.style.display = 'none'
                // Reset More button
                const moreBtn = dropdownRef.current?.parentElement?.querySelector('button')
                if (moreBtn) {
                  moreBtn.dataset.open = '0'
                  moreBtn.style.borderColor = 'var(--q-border)'
                  moreBtn.style.color = 'var(--q-text-secondary)'
                  const arrow = moreBtn.querySelector('svg')
                  if (arrow) arrow.style.transform = 'rotate(0deg)'
                }
              } }),
              zjsx('div', {
                ref: dropdownRef,
                style: {
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: '0',
                  zIndex: 50,
                  backgroundColor: 'var(--q-bg-panel)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-modal)',
                  border: '1px solid var(--q-border)',
                  padding: '4px',
                  display: 'none',
                  flexDirection: 'column',
                  gap: '4px',
                },
                children: moreFilters.map(level => zjsx(FilterPill, { key: level, level }))
              })
            ] }),
            zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
            zjsx('span', { style: { flex: 1 } }),
            // Action buttons — all same style, green on hover
            zjsx(HeaderBtn, { label: 'export all', icon: zjsx('__DOWNLOAD__', { size: 14 }), onClick: () => setShowExport(true) }),
            zjsx('div', { style: { width: '4px', flexShrink: 0 } }),
            zjsx(HeaderBtn, { label: 'copy', icon: zjsx('__COPY__', { size: 14 }), onClick: () => {} }),
            zjsx('div', { style: { width: '4px', flexShrink: 0 } }),
            zjsx(HeaderBtn, { label: 'refresh', icon: zjsx('__REFRESH__', { size: 14 }), onClick: () => {} }),
            zjsx('div', { style: { width: '4px', flexShrink: 0 } }),
            zjsx(HeaderBtn, { label: 'clear', icon: zjsx('__TRASH__', { size: 14 }), onClick: () => setShowClear(true) }),
          ] }),
        ]
      }),

      // Log list
      zjsx('div', {
        ref: bodyRef,
        style: { flex: 1, overflowY: 'auto', padding: '1px 16px 8px 16px' },
        children: filtered.length === 0
          ? zjsx('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: 'log vuoto' })
          : filtered.map((e: any, i: number) => {
              const level = deriveLevel(e.tag)
              const colors = levelColors[level] || levelColors.info
              const payload = formatPayload(e.data)
              const isHovered = hoveredIdx === i
              return zjsxs('div', {
                key: i,
                onMouseEnter: () => setHoveredIdx(i),
                onMouseLeave: () => setHoveredIdx(null),
                style: { width: '100%', padding: '16px', marginBottom: '8px', borderRadius: 'var(--radius-lg)', backgroundColor: colors.bg, boxShadow: 'var(--shadow-floating)', position: 'relative' },
                children: [
                  zjsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [
                    zjsx('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', flexShrink: 0 }, children: fmtTimestampFull(e.ts) }),
                    zjsx('span', { style: { color: colors.tag, fontSize: '12px', fontFamily: 'var(--font-code)', fontWeight: 600, flexShrink: 0 }, children: '[' + e.tag + ']' }),
                  ] }),
                  payload ? zjsx('div', { style: { marginTop: '4px', color: colors.text, fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }, children: payload }) : null,
                  zjsx('button', {
                    onClick: (ev: any) => { ev.stopPropagation(); navigator.clipboard.writeText(formatPayload(e.data)) },
                    style: { position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: 'var(--radius-md)', color: 'var(--q-text)', display: 'flex', opacity: isHovered ? 1 : 0, transition: 'opacity 150ms ease' },
                    children: zjsx('__COPY__', { size: 16 })
                  }),
                ]
              })
            })
      }),

      // Search bar — exact copy from SettingsPanel
      zjsxs('div', {
        style: { marginTop: '8px', flexShrink: 0, ...panelStyle },
        children: [
          zjsx('div', { style: { width: '12px', flexShrink: 0 } }),
          zjsx('__SEARCH__', { size: 16, style: { color: 'var(--q-text-tertiary)', flexShrink: 0 } }),
          zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
          zjsx('input', { type: 'text', placeholder: 'Search in logs...', value: search, onChange: (e: any) => setSearch(e.target.value), style: { flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0', margin: '0' } }),
          zjsx('button', { onClick: () => setSearch(''), style: { background: 'none', border: 'none', cursor: search ? 'pointer' : 'default', padding: '8px', color: search ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', fontSize: '14px', opacity: search ? 1 : 0.3 }, children: '✕' }),
          zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
          zjsx('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', opacity: (!search || searchMatches.length === 0) ? 0.3 : 1 }, children: search ? (searchMatches.length === 0 ? '0/0' : (currentMatch + 1) + '/' + searchMatches.length) : '0/0' }),
          zjsx('div', { style: { width: '8px', flexShrink: 0 } }),
          zjsx('button', { onClick: () => searchMatches.length > 0 && setCurrentMatch((p: number) => (p - 1 + searchMatches.length) % searchMatches.length), style: { background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: searchMatches.length > 0 ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', opacity: searchMatches.length > 0 ? 1 : 0.3, display: 'flex' }, children: zjsx('__CHEVRONUP__', { size: 16 }) }),
          zjsx('button', { onClick: () => searchMatches.length > 0 && setCurrentMatch((p: number) => (p + 1) % searchMatches.length), style: { background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: searchMatches.length > 0 ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', opacity: searchMatches.length > 0 ? 1 : 0.3, display: 'flex' }, children: zjsx('__CHEVRONDOWN__', { size: 16 }) }),
        ]
      }),

      // Export modal
      showExport && zjsx('div', { style: { position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setShowExport(false), children: zjsxs('div', { style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', padding: '24px', maxWidth: '400px', width: '90%' }, onClick: (e: any) => e.stopPropagation(), children: [ zjsx('div', { style: { color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }, children: 'Export log entries?' }), zjsxs('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }, children: [filtered.length, ' entries will be exported to clipboard as markdown.'] }), zjsxs('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }, children: [ zjsx('button', { className: 'q-press', onClick: () => setShowExport(false), style: { padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '15px', fontFamily: 'var(--font-interface)' }, children: 'Cancel' }), zjsx('div', { style: { width: '8px' } }), zjsx('button', { className: 'q-press', onClick: () => { const md = filtered.map((e: any) => '### [' + deriveLevel(e.tag) + '] ' + fmtTimestampFull(e.ts) + '\n**Tag:** ' + e.tag + '\n\n' + formatPayload(e.data) + '\n').join('\n---\n\n'); navigator.clipboard.writeText(md); setShowExport(false) }, style: { padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-success)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)' }, children: 'Export' }) ] }) ] }) }),

      // Clear confirmation modal
      showClear && zjsx('div', { style: { position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setShowClear(false), children: zjsxs('div', { style: { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)', padding: '24px', maxWidth: '400px', width: '90%' }, onClick: (e: any) => e.stopPropagation(), children: [ zjsx('div', { style: { color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }, children: 'Clear all log entries?' }), zjsxs('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }, children: [entries.length, ' entries will be removed.'] }), zjsxs('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }, children: [ zjsx('button', { className: 'q-press', onClick: () => setShowClear(false), style: { padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '15px', fontFamily: 'var(--font-interface)' }, children: 'Cancel' }), zjsx('div', { style: { width: '8px' } }), zjsx('button', { className: 'q-press', onClick: () => { setEntries([]); setShowClear(false) }, style: { padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-success)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)' }, children: 'Clear' }) ] }) ] }) }),
    ]
  })
}

// Placeholder icons
const __HOME__: any = () => null
const __ACTIVITY__: any = () => null
const __SEARCH__: any = () => null
const __CHEVRONDOWN__: any = () => null
const __CHEVRONRIGHT__: any = () => null
const __CHEVRONUP__: any = () => null
const __CHECK__: any = () => null
const __COPY__: any = () => null
const __DOWNLOAD__: any = () => null
const __REFRESH__: any = () => null
const __TRASH__: any = () => null

export { LogPanel }
