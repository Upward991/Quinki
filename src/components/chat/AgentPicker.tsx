import { useState } from 'react'
import { Bot, Search, X } from '../icons'

interface AgentPickerProps {
  agents: { id: string; name: string; systemPrompt?: string }[]
  onSelect: (id: string) => void
  onClose: () => void
}

export function AgentPicker({ agents, onSelect, onClose }: AgentPickerProps) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = search
    ? agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.id.toLowerCase().includes(search.toLowerCase()))
    : agents

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="bg-bg-elevated border border-border rounded-lg w-[90%] max-w-[450px] max-h-[70vh] flex flex-col shadow-modal q-modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 px-4 text-text text-16 font-semibold font-interface">Add agents to chat</div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="flex items-center pl-2.5 bg-bg-panel border border-border rounded-md">
            <Search size={14} className="text-text-tertiary shrink-0" />
            <div className="w-2 shrink-0" />
            <input
              type="text"
              placeholder="Search agent..."
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-text text-14 font-interface py-2"
            />
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-text-tertiary text-14 font-interface">
              All agents are already in this chat.
            </div>
          ) : (
            filtered.sort((a, b) => Number(!selected.has(a.id)) - Number(!selected.has(b.id))).map((agent) => {
              const isSelected = selected.has(agent.id)
              return (
                <div
                  key={agent.id}
                  onClick={() => toggle(agent.id)}
                  className="px-4 py-2 cursor-pointer flex items-center gap-2"
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <Bot size={16} className="text-text-secondary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-text text-14 font-interface">{agent.name}</div>
                    <div className="text-text-tertiary text-12 font-interface overflow-hidden text-ellipsis whitespace-nowrap">
                      {agent.systemPrompt ? agent.systemPrompt.substring(0, 80) + (agent.systemPrompt.length > 80 ? '...' : '') : agent.id}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(agent.id)}
                    className="shrink-0"
                    style={{ accentColor: 'var(--q-accent-info)' }}
                  />
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-2 px-4 pb-2.5 border-t border-border flex items-center gap-1">
          <button
            className="q-press bg-none border-none text-13 font-interface p-1 px-2"
            onClick={() => { filtered.forEach(a => selected.add(a.id)); setSelected(new Set(selected)) }}
            disabled={filtered.length === 0}
            style={{
              cursor: filtered.length === 0 ? 'default' : 'pointer',
              color: filtered.length === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)',
            }}
          >
            Select all
          </button>
          <button
            className="q-press bg-none border-none text-13 font-interface p-1 px-2"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            style={{
              cursor: selected.size === 0 ? 'default' : 'pointer',
              color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-text-secondary)',
            }}
          >
            Deselect
          </button>
          <span className="flex-1" />
          <button onClick={onClose} className="q-press bg-none border-none cursor-pointer text-accent-danger text-15 font-interface p-1 px-2">
            Cancel
          </button>
          <div className="w-2" />
          <button
            onClick={() => { selected.forEach(id => onSelect(id)); onClose() }}
            disabled={selected.size === 0}
            className="q-press rounded-md border-none text-15 font-interface p-1 px-4"
            style={{
              cursor: selected.size === 0 ? 'default' : 'pointer',
              backgroundColor: selected.size === 0 ? 'transparent' : 'var(--q-accent-info)',
              color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-bg)',
              opacity: selected.size === 0 ? 0.5 : 1,
            }}
          >
            Add ({selected.size})
          </button>
        </div>
      </div>
    </div>
  )
}