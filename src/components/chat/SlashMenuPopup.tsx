import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react'
import { ChevronRight } from '../icons'

export const SlashMenuPopup = forwardRef(function SlashMenuPopup(props: any, ref: any) {
  const { filter, providers, selectedModel, thinking, mode, onSelectModel, onSelectThinking, onSelectMode, onReset, onClose } = props
  const [tab, setTab] = useState('main')
  const [selIdx, setSelIdx] = useState(0)
  let items: any[] = []

  if (tab === 'main') {
    items = [
      { label: 'Model', sub: selectedModel || 'Select model', action: () => setTab('model') },
      { label: 'Thinking', sub: thinking || 'Select level', action: () => setTab('thinking') },
      { label: 'Mode', sub: mode || 'Select mode', action: () => setTab('mode') },
      { label: 'Reset', sub: 'Reset session', action: onReset },
    ]
  } else if (tab === 'model') {
    items = []
    for (const p of (providers || [])) {
      for (const m of (p.enabledModels || [])) {
        items.push({ label: m, sub: p.name, action: () => onSelectModel(m) })
      }
    }
  } else if (tab === 'thinking') {
    for (const t of ['off', 'low', 'medium', 'high', 'xhigh']) {
      items.push({ label: t.charAt(0).toUpperCase() + t.slice(1), sub: '', action: () => onSelectThinking(t) })
    }
  } else if (tab === 'mode') {
    items = [
      { label: 'Plan', sub: 'Explore without changes', action: () => onSelectMode('plan') },
      { label: 'Build', sub: 'Execute changes', action: () => onSelectMode('build') },
    ]
  }

  if (filter) {
    items = items.filter((e: any) => e.label.toLowerCase().includes(filter.toLowerCase()))
  }

  useEffect(() => { setSelIdx(0) }, [tab, filter])

  useImperativeHandle(ref, () => ({
    navUp: () => setSelIdx((e: number) => (e - 1 + items.length) % items.length),
    navDown: () => setSelIdx((e: number) => (e + 1) % items.length),
    navLeft: () => { if (tab !== 'main') setTab('main') },
    navRight: () => { if (items[selIdx] && items[selIdx].action && tab === 'main') items[selIdx].action() },
    navEnter: () => { if (items[selIdx] && items[selIdx].action) items[selIdx].action() }
  }))

  if (items.length === 0) items = [{ label: 'No results', sub: '', action: () => {} }]

  const backBtn = tab !== 'main' ? React.createElement('div', {
    style: { padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--q-border)', cursor: 'pointer', onClick: () => setTab('main') },
    children: [
      React.createElement(ChevronRight, { size: 14, style: { color: 'var(--q-text-tertiary)', transform: 'rotate(180deg)' } }),
      React.createElement('span', { style: { color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }, children: 'Back' })
    ]
  }) : null

  const itemElements = items.map((item, idx) => React.createElement('div', {
    key: idx,
    onClick: () => item.action && item.action(),
    onMouseEnter: () => setSelIdx(idx),
    style: { padding: '8px 16px', backgroundColor: idx === selIdx ? 'var(--q-hover)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', transition: 'background-color 120ms ease' },
    children: [
      React.createElement('span', { style: { color: idx === selIdx ? 'var(--q-text)' : 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }, children: item.label }),
      item.sub ? React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)' }, children: item.sub }) : null
    ]
  }))

  return React.createElement(React.Fragment, null,
    React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 40 }, onClick: onClose }),
    React.createElement('div', {
      style: { position: 'absolute', bottom: 'calc(100% + 8px)', left: '0', right: '0', zIndex: 50, backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)', maxHeight: '300px', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      children: [
        backBtn,
        React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '4px 0' }, children: itemElements })
      ]
    })
  )
})
