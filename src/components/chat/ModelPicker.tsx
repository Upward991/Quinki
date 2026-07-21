import { useState, forwardRef, useImperativeHandle, useRef } from 'react'
import { Search, Settings, X } from '../icons'

export interface ModelPickerRef {
  navUp: () => void
  navDown: () => void
  navLeft: () => void
  navRight: () => void
  navEnter: () => void
}

interface ModelPickerProps {
  currentModel?: string
  models: { id: string; name?: string; provider: string; contextWindow?: number }[]
  onClose: () => void
  filter?: string
  providers?: any[]
  selectedModel?: string
  thinking?: string
  onSelectModel?: (m: string) => void
  onSelectThinking?: (t: string) => void
  onReset?: () => void
}

export const ModelPicker = forwardRef<ModelPickerRef, ModelPickerProps>(function ModelPicker(props, ref) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(props.currentModel || null)
  const listRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    navUp: () => {},
    navDown: () => {},
    navLeft: () => {},
    navRight: () => {},
    navEnter: () => { props.onClose() },
  }))

  const filtered = search
    ? props.models.filter(m => m.id.toLowerCase().includes(search.toLowerCase()) || m.provider.toLowerCase().includes(search.toLowerCase()))
    : props.models

  const grouped: Record<string, typeof filtered> = {}
  for (const m of filtered) {
    if (!grouped[m.provider]) grouped[m.provider] = []
    grouped[m.provider].push(m)
  }

  const fmt = (n?: number) => {
    if (!n || n === 0) return '—'
    if (n >= 1e6) { const m = n / 1e6; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }
    if (n >= 1e3) return `${Math.floor(n / 1e3)}K`
    return `${n}`
  }

  return (
    <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={props.onClose}>
      <div
        className="bg-bg-elevated border border-border rounded-lg w-[90%] max-w-[480px] h-[80vh] max-h-[500px] flex flex-col shadow-modal q-modal-enter overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3 px-4 bg-bg-panel border-b border-border flex items-center shrink-0">
          <Settings size={18} className="text-accent-info shrink-0" />
          <div className="w-2 shrink-0" />
          <span className="text-text text-16 font-semibold font-interface">Agent model</span>
          <span className="flex-1" />
          <button onClick={props.onClose} className="bg-none border-none cursor-pointer p-0 flex">
            <X size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Search */}
        <div className="p-2 px-4 shrink-0">
          <div className="flex items-center pl-2.5 bg-bg-panel border border-border rounded-md">
            <Search size={14} className="text-text-tertiary shrink-0" />
            <div className="w-2 shrink-0" />
            <input
              type="text"
              placeholder="Search model..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-text text-14 font-interface py-2"
            />
          </div>
        </div>

        {/* Model list */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {/* Chat default */}
          <div
            onClick={() => setSelected(null)}
            className="px-4 py-2 cursor-pointer flex items-center gap-2"
            style={{ backgroundColor: selected === null ? 'rgba(122, 162, 247, 0.10)' : 'transparent' }}
          >
            <div
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0"
              style={{
                border: `2px solid ${selected === null ? 'var(--q-accent-info)' : 'var(--q-text-tertiary)'}`,
                backgroundColor: selected === null ? 'var(--q-accent-info)' : 'transparent',
              }}
            >
              {selected === null && <div className="w-1.5 h-1.5 rounded-full bg-bg" />}
            </div>
            <span className="text-text text-14 font-interface flex-1">Chat default</span>
            <span className="text-text-tertiary text-12 font-interface">Use chat default model</span>
          </div>

          {/* Grouped models */}
          {Object.entries(grouped).map(([provider, models]) => (
            <div key={provider}>
              <div className="px-4 pt-2 pb-1 text-text-tertiary text-12 font-interface">{provider}</div>
              {models.map((m) => (
                <div
                  key={m.id}
                  onClick={() => setSelected(m.id)}
                  className="px-4 py-2 cursor-pointer flex items-center gap-2"
                  style={{ backgroundColor: selected === m.id ? 'rgba(122, 162, 247, 0.10)' : 'transparent' }}
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      border: `2px solid ${selected === m.id ? 'var(--q-accent-info)' : 'var(--q-text-tertiary)'}`,
                      backgroundColor: selected === m.id ? 'var(--q-accent-info)' : 'transparent',
                    }}
                  >
                    {selected === m.id && <div className="w-1.5 h-1.5 rounded-full bg-bg" />}
                  </div>
                  <span className="text-text text-14 font-interface flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {m.name || m.id}
                  </span>
                  <span className="text-text-tertiary text-12 font-interface shrink-0">
                    {fmt(m.contextWindow)} ctx
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-2 px-4 flex items-center shrink-0">
          <span className="text-text-tertiary text-13 font-interface">
            {selected === null ? 'Chat default' : selected.length > 30 ? selected.substring(0, 30) + '...' : selected}
          </span>
          <span className="flex-1" />
          <button
            onClick={props.onClose}
            className="bg-none border-none cursor-pointer text-accent-danger text-15 font-interface p-1 px-2"
          >
            Cancel
          </button>
          <div className="w-2" />
          <button
            className="q-press rounded-md border-none cursor-pointer text-15 font-interface p-1 px-4 bg-accent-info text-bg"
            onClick={props.onClose}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
})