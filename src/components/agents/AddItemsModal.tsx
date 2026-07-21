import { useState } from 'react'
import { Search, X } from '../icons'

interface AddItemsModalProps {
  title: string
  items: { name: string; description?: string }[]
  onClose: () => void
}

export function AddItemsModal({ title, items, onClose }: AddItemsModalProps) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-bg-elevated border border-border rounded-lg max-w-[500px] max-h-[500px] w-[90%] flex flex-col shadow-modal q-modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center">
          <span className="text-text text-16 font-semibold font-interface">{title}</span>
          <span className="flex-1" />
          <button onClick={onClose} className="bg-none border-none cursor-pointer p-0 flex">
            <X size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Search */}
        <div className="p-2 px-4">
          <div className="flex items-center pl-2.5 bg-bg-panel border border-border rounded-md">
            <Search size={14} className="text-text-tertiary shrink-0" />
            <div className="w-2 shrink-0" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-text text-14 font-interface py-2"
            />
          </div>
        </div>

        {/* Items list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.sort((a, b) => Number(!selected.has(a.name)) - Number(!selected.has(b.name))).map(item => {
            const isSelected = selected.has(item.name)
            return (
              <div
                key={item.name}
                onClick={() => toggle(item.name)}
                className="px-4 py-1 flex items-center cursor-pointer"
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-text text-14 font-interface">{item.name}</div>
                  {item.description && (
                    <div className="text-text-tertiary text-12 font-interface overflow-hidden text-ellipsis whitespace-nowrap">
                      {item.description}
                    </div>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(item.name)}
                  className="shrink-0 ml-2"
                  style={{ accentColor: 'var(--q-accent-secondary)' }}
                />
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="p-2 px-4 flex items-center border-t border-border">
          <button
            className="q-press bg-none border-none text-13 font-interface p-1 px-2"
            onClick={() => setSelected(new Set(filtered.map(i => i.name)))}
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
          <button
            className="q-press bg-none border-none cursor-pointer text-accent-danger text-15 font-interface p-1 px-2"
            onClick={onClose}
          >
            Cancel
          </button>
          <div className="w-2" />
          <button
            className="q-press rounded-md border-none text-15 font-interface p-1 px-4"
            onClick={onClose}
            disabled={selected.size === 0}
            style={{
              cursor: selected.size === 0 ? 'default' : 'pointer',
              backgroundColor: selected.size === 0 ? 'transparent' : 'var(--q-accent-secondary)',
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