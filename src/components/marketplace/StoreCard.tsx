// StoreCard.tsx — card degli elementi del Market (usata ovunque: home, account,
// pagina sviluppatore). IDENTICA in ogni punto: tutte le info sempre visibili.
import React from 'react'
import { Check, Bot, BookOpen, Plug, Palette, Package } from '../icons'
import type { CatalogItem } from '../../catalog'
import { prettifyMcpName } from '../../mcpNaming'

// Icone del Market = le STESSE icone della app (richiesta utente 9 ott): robottino per
// gli agenti, libro per le skill, spina per gli MCP, palette per i temi — MAI più emoji
// casuali per item. Stesso schema della tab Agents.
export function categoryIcon(category: string): any {
  switch (category) {
    case 'agent': return Bot
    case 'skill': return BookOpen
    case 'mcp': return Plug
    case 'theme': return Palette
    default: return Package
  }
}
// Colori di categoria (richiesta utente 9 ott): agent = accent della tab Agents,
// skill = blu info (ok così), MCP = accent della tab Log, tema = arancio.
const CATEGORY_COLOR: Record<string, string> = {
  agent: 'var(--q-accent-secondary)',
  skill: 'var(--q-accent-info)',
  mcp: 'var(--q-accent-success)',
  theme: '#d9a066',
  tab: '#e879a8',
}
export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] || '#888'
}

export function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k'
  return String(n)
}

// Renderizza l'icona: STRINGA (emoji dall'adattatore) → span; COMPONENTE React → istanza.
// (React.createElement con una stringa non-tag → InvalidCharacterError.)
export function renderItemIcon(icon: any, size: number, color: string) {
  if (typeof icon === 'string') {
    return React.createElement('div', { style: { fontSize: size, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, icon)
  }
  return React.createElement(icon, { size, style: { color } })
}

export function StoreCard({ item, onOpen, onInstall, installed, onRemove, badge, action }: { item: CatalogItem, onOpen: () => void, onInstall?: () => void, installed: boolean, onRemove?: () => void, badge?: string, action?: { label: string, onClick: () => void, kind?: 'primary' | 'danger' } }) {
  return React.createElement('div', {
    onClick: onOpen,
    onMouseEnter: (e: any) => { e.currentTarget.style.borderColor = 'var(--mp-accent)'; e.currentTarget.style.boxShadow = '0 4px 16px color-mix(in srgb, var(--mp-accent) 25%, transparent)' },
    onMouseLeave: (e: any) => { e.currentTarget.style.borderColor = 'var(--mp-border)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(20,24,40,0.06)' },
    style: { backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(20,24,40,0.06)', transition: 'none' }
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
      React.createElement('div', { style: { width: '52px', height: '52px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'inset 0 0 0 1px ' + categoryColor(item.category) } },
        renderItemIcon(categoryIcon(item.category), 26, categoryColor(item.category))
      ),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-interface)', lineHeight: 1.3 } }, prettifyMcpName(item.name)),
        React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '3px', lineHeight: 1.4 } }, item.author + ' · v' + item.version)
      ),
      action
        ? React.createElement('button', {
            onClick: (e: any) => { e.stopPropagation(); action.onClick() },
            onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = action.kind === 'danger' ? 'rgba(255,255,255,0.06)' : 'var(--mp-accent)'; e.currentTarget.style.color = action.kind === 'danger' ? 'var(--mp-danger)' : 'var(--mp-bg)' },
            onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--mp-panel)'; e.currentTarget.style.color = action.kind === 'danger' ? 'var(--mp-danger)' : 'var(--mp-accent)' },
            style: { padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (action.kind === 'danger' ? 'var(--mp-border)' : 'var(--mp-accent)'), backgroundColor: 'var(--mp-panel)', color: action.kind === 'danger' ? 'var(--mp-danger)' : 'var(--mp-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer', transition: 'none', flexShrink: 0 }
          }, action.label)
        : installed && !badge
        ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--mp-success)', fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 } }, React.createElement(Check, { size: 14 }), 'Installed')
        : badge
        ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '3px', color: badge === 'Draft' ? 'var(--mp-text-secondary)' : 'var(--mp-success)', fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 } }, badge)
        : React.createElement('button', {
            onClick: (e: any) => { e.stopPropagation(); onInstall() },
            onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--mp-accent)'; e.currentTarget.style.color = 'var(--mp-bg)' },
            onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--mp-accent)' },
            style: { padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-accent)', backgroundColor: 'var(--mp-panel)', color: 'var(--mp-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer', transition: 'none', flexShrink: 0 }
          }, 'Install')
    ),
    React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5 } }, item.description),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } },
      React.createElement('span', {}, fmt(item.downloads) + ' downloads'),
      React.createElement('span', {}, '·'),
      React.createElement('span', {}, item.size),
      React.createElement('span', {}, '·'),
      React.createElement('span', {}, item.category)
    )
  )
}
