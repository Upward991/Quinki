import React, { useState } from 'react'
import { Search } from '../icons'
import { useLayout } from '../../platform/layout'

// AgentPickerModal — il picker agenti ORIGINALE della chat (riusato dal grafo per
// "add sub agent" e "change agent"). Vive in un file suo per evitare import circolari.
export function AgentPickerModal({ agents, initialSelected, onClose, onAdd, embedded, title, single }: {
  agents: Agent[]
  initialSelected?: string[]
  onClose: () => void
  onAdd: (ids: string[]) => void
  embedded?: boolean
    title?: string
    single?: boolean
}) {
  const mob = useLayout().mode === 'mobile'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  // NASCONDI gli agenti già in chat
  const available = agents.filter(a => !(initialSelected || []).includes(a.id))
  const filtered = available.filter(a => a.name.toLowerCase().includes(query.toLowerCase()))
    // single = "cambia agente": ne scegli UNO e via.
    const toggle = (id: string) => {
      // single = "change agent": una sola scelta, ma si conferma con il tasto Add.
      if (single) { setSelected(new Set([id])); return }
      setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s })
    }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e: any) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '500px', maxHeight: '500px', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', flex: 1 }}>{title || 'Add agents to chat'}</span>
        </div>
        {/* Search */}
        <div style={{ padding: '8px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '10px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' }}>
            <Search size={14} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
            <div style={{ width: '8px', flexShrink: 0 }} />
            <input type="text" placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} autoFocus={!mob}
              style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '8px 0' }} />
          </div>
        </div>
        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>No agents found</div>
          )}
          {filtered.map(agent => (
            <div key={agent.id} onClick={() => toggle(agent.id)}
              style={{ display: 'flex', alignItems: 'center', padding: '4px 16px', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</div>
                {(agent as any).description && <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(agent as any).description}</div>}
              </div>
              <input type="checkbox" checked={selected.has(agent.id)} onChange={() => toggle(agent.id)} onClick={e => e.stopPropagation()}
                style={{ accentColor: 'var(--q-tab-accent)', width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0, marginLeft: '8px' }} />
            </div>
          ))}
        </div>
        {/* Footer */}
        <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => setSelected(new Set(filtered.map(a => a.id)))} disabled={filtered.length === 0}
            style={{ background: 'none', border: 'none', cursor: filtered.length === 0 ? 'default' : 'pointer', color: filtered.length === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Select all</button>
          <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}
            style={{ background: 'none', border: 'none', cursor: selected.size === 0 ? 'default' : 'pointer', color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '4px 8px' }}>Deselect</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }} style={{ height: 34, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', padding: '0 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 400, cursor: 'pointer' }}>Cancel</button>
          <div style={{ width: '8px' }} />
          <button onClick={() => onAdd([...selected])} disabled={selected.size === 0}
            onMouseEnter={e => { if (!e.currentTarget.disabled) { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' } }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}
            style={{ height: 34, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', padding: '0 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: selected.size === 0 ? 'default' : 'pointer', opacity: selected.size === 0 ? 0.5 : 1 }}>Add ({selected.size})</button>
        </div>
      </div>
    </div>
  )
}
