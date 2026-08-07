import React from 'react'
import { useState, useEffect } from 'react'
import { Search, X } from '../icons'

interface AddItemsModalProps {
  title: string
  items: { name: string; description?: string }[]
  initialSelected?: string[]
  onClose: () => void
  onConfirm: (selected: string[]) => void
}

export function AddItemsModal({ title, items, initialSelected, onClose, onConfirm }: AddItemsModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected || []))
  const [query, setQuery] = useState('')

  useEffect(() => { setSelected(new Set(initialSelected || [])) }, [initialSelected])

  const filtered = items
    .filter(item => item.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (selected.has(a.name) ? 0 : 1) - (selected.has(b.name) ? 0 : 1))

  const toggle = (name: string) => setSelected(prev => {
    const s = new Set(prev)
    if (s.has(name)) s.delete(name); else s.add(name)
    return s
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', maxWidth: '500px', maxHeight: '500px', width: '90%', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-modal)', animation: 'modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center' }}>
          <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{title}</span>
          <span style={{ flex: 1 }} />
        </div>
        {/* Search */}
        <div style={{ padding: '0 16px 8px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '10px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' }}>
            <Search size={14} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
            <div style={{ width: '8px', flexShrink: 0 }} />
            <input type="text" placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} autoFocus
              style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '8px 0' }} />
          </div>
        </div>
        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map(item => (
            <div key={item.name} onClick={() => toggle(item.name)}
              style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{item.name}</div>
                {item.description && <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</div>}
              </div>
              <input type="checkbox" checked={selected.has(item.name)} onChange={() => toggle(item.name)}
                style={{ accentColor: 'var(--q-accent-secondary)', flexShrink: 0, marginLeft: '8px' }} />
            </div>
          ))}
        </div>
        {/* Footer */}
        <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center' }}>
          <button className="q-press" onClick={() => setSelected(new Set(filtered.map(i => i.name)))} disabled={filtered.length === 0}
            style={{ background: 'none', border: 'none', cursor: filtered.length === 0 ? 'default' : 'pointer', color: filtered.length === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Select all</button>
          <button className="q-press" onClick={() => setSelected(new Set())} disabled={selected.size === 0}
            style={{ background: 'none', border: 'none', cursor: selected.size === 0 ? 'default' : 'pointer', color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Deselect</button>
          <span style={{ flex: 1 }} />
          <button className="q-press" onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: '15px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Cancel</button>
          <div style={{ width: '8px' }} />
          <button onClick={() => onConfirm([...selected])} disabled={selected.size === 0} onMouseEnter={e => { if (!selected.size === 0) { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' } }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }} style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', cursor: selected.size === 0 ? 'default' : 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', opacity: selected.size === 0 ? 0.5 : 1 }}>Add ({selected.size})</button>
        </div>
      </div>
    </div>
  )
}
