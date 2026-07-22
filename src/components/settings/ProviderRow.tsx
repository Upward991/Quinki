import { useState } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Check, ChevronDown, ChevronRight, RefreshCw, Search, Trash } from '../icons'

interface ProviderModel {
  id: string
  name?: string
  contextWindow?: number
}

interface Provider {
  enabled: boolean
  apiKeyStatus?: string
  baseUrl?: string
  models: ProviderModel[]
}

interface ProviderRowProps {
  name: string
  provider: Provider
  onDeleted?: (name: string) => void
}

export function ProviderRow({ name, provider, onDeleted }: ProviderRowProps) {
  const { call } = useSidecarContext()
  const [expanded, setExpanded] = useState(false)
  const [enabled, setEnabled] = useState(provider.enabled)
  const [filter, setFilter] = useState('')
  const [enabledModels, setEnabledModels] = useState<Set<string>>(new Set(provider.models.map(m => m.id)))
  const [showDelete, setShowDelete] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; count?: number; error?: string } | null>(null)

  const fmt = (n?: number) => {
    if (!n || n === 0) return '—'
    if (n >= 1e6) { const m = n / 1e6; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }
    if (n >= 1e3) return `${Math.floor(n / 1e3)}K`
    return `${n}`
  }

  const displayName = name === 'ollama' ? 'Ollama' : name === 'openrouter' ? 'OpenRouter' : name === 'anthropic' ? 'Anthropic Direct' : name

  const filteredModels = (filter
    ? provider.models.filter(m => m.id.toLowerCase().includes(filter.toLowerCase()) || (m.name || '').toLowerCase().includes(filter.toLowerCase()))
    : provider.models
  ).sort((a, b) => {
    const ae = enabledModels.has(a.id), be = enabledModels.has(b.id)
    return ae && !be ? -1 : !ae && be ? 1 : 0
  })

  const toggleModel = (id: string) => {
    setEnabledModels(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mb-2 bg-bg-panel rounded-lg shadow-floating overflow-hidden border border-border">
      {/* Header */}
      <div className="p-2 px-3 flex items-center">
        {/* Drag handle */}
        <div className="cursor-grab p-1 flex items-center shrink-0" style={{ color: 'var(--q-text-tertiary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </div>
        {/* Expand/collapse */}
        <div onClick={() => setExpanded(!expanded)} className="cursor-pointer flex items-center">
          {expanded ? <ChevronDown size={20} className="text-text-tertiary" /> : <ChevronRight size={20} className="text-text-tertiary" />}
        </div>
        <div className="w-2 shrink-0" />
        {/* Name / rename */}
        {isRenaming ? (
          <input
            type="text"
            value={displayName}
            autoFocus
            onBlur={() => setIsRenaming(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') setIsRenaming(false) }}
            onChange={() => {}}
            className="w-[200px] text-text text-15 font-medium font-interface bg-transparent border-none outline-none p-0"
          />
        ) : (
          <span onClick={() => setIsRenaming(true)} className="text-text text-15 font-medium font-interface cursor-text">{displayName}</span>
        )}
        <div className="w-2 shrink-0" />
        {!isRenaming && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            onClick={() => setIsRenaming(true)}
            className="text-text-tertiary cursor-pointer shrink-0"
          >
            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        )}
        <div className="w-2 shrink-0" />
        <span className="text-text-tertiary text-13 font-interface">({enabledModels.size} models)</span>
        <span className="flex-1" />
        {/* Enabled toggle */}
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            setEnabled(e.target.checked)
            try {
              const cfg = await call?.('getProvidersConfig', {})
              if (cfg?.providers?.[name]) {
                cfg.providers[name].enabled = e.target.checked
                await call?.('setProvidersConfig', cfg)
              }
            } catch (err) { console.error('Failed to update provider:', err) }
          }}
          style={{ accentColor: 'var(--q-accent-primary)' }}
        />
        <div className="w-2 shrink-0" />
        <span className="text-text-secondary text-14 font-interface">enabled</span>
        <div className="w-2 shrink-0" />
        <Trash size={20} onClick={() => setShowDelete(true)} className="text-text-tertiary cursor-pointer" style={{ padding: '6px', boxSizing: 'content-box' }} />
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4">
          {/* Base URL */}
          <span className="text-text-tertiary text-13 font-interface">Base URL</span>
          <div className="h-2" />
          <input
            type="text"
            defaultValue={provider.baseUrl || ''}
            placeholder="https://api.example.com/v1"
            className="w-full h-9 bg-bg-elevated border border-border rounded-md text-text text-14 font-interface px-3 outline-none"
          />
          <div className="h-2" />
          {/* API Key */}
          <div className="flex items-center gap-2">
            <span className="text-text-tertiary text-13 font-interface">API Key</span>
            {provider.apiKeyStatus === 'configured' && (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-accent-success" />
                <span className="text-accent-success text-12 font-interface">saved</span>
              </>
            )}
          </div>
          <div className="h-2" />
          <input
            type="password"
            placeholder={provider.apiKeyStatus === 'configured' ? '•••••••• (leave empty to keep)' : 'api key'}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                const val = (e.target as HTMLInputElement).value.trim()
                if (val) try { await call?.('storeApiKey', { service: name, key: val }) } catch (err) { console.error('Failed to save API key:', err) }
              }
            }}
            className="w-full h-9 bg-bg-elevated border border-border rounded-md text-text text-14 font-interface px-3 outline-none"
          />
          <div className="h-2" />
          {/* Test connection */}
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setTesting(true)
                try {
                  const res = await call?.('testProviderConnection', { providerName: name, baseUrl: provider.baseUrl || '', apiKey: '' })
                  setTesting(false)
                  if (res?.success === false) setTestResult({ success: false, error: res?.error || 'Connection failed' })
                  else setTestResult({ success: true, count: provider.models.length })
                } catch (err: any) {
                  setTesting(false)
                  setTestResult({ success: false, error: err?.message || 'Connection failed' })
                }
              }}
              disabled={testing}
              className="px-4 py-2 rounded-md border border-border text-14 font-interface"
              style={{
                cursor: testing ? 'default' : 'pointer',
                backgroundColor: 'transparent',
                color: 'var(--q-text-secondary)',
              }}
            >
              {testing ? '...' : 'Test connection'}
            </button>
            <RefreshCw size={20} className="text-text-tertiary cursor-pointer" style={{ padding: '8px', boxSizing: 'content-box' }} />
            {testResult?.success && (
              <>
                <Check size={16} className="text-accent-success" />
                <span className="text-accent-success text-13 font-interface">{testResult.count} models</span>
              </>
            )}
            {testResult && !testResult.success && (
              <span className="text-accent-danger text-13 font-interface">Connection failed</span>
            )}
          </div>

          {/* Models */}
          {provider.models.length > 0 && (
            <>
              <div className="h-2" />
              <div className="flex justify-between items-center">
                <span className="text-text-tertiary text-13 font-interface">
                  Available models ({filteredModels.length}{filter && filteredModels.length !== provider.models.length ? ` of ${provider.models.length}` : ''}{enabledModels.size > 0 ? ` · ${enabledModels.size} active` : ''})
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEnabledModels(new Set(provider.models.map(m => m.id)))}
                    className="px-3 py-2 rounded-md border border-border text-13 font-interface cursor-pointer bg-transparent text-text-secondary"
                  >
                    Enable all
                  </button>
                  <button
                    onClick={() => setEnabledModels(new Set())}
                    className="px-3 py-2 rounded-md border border-border text-13 font-interface cursor-pointer bg-transparent text-accent-danger"
                  >
                    Disable all
                  </button>
                </div>
              </div>
              <div className="h-2" />
              {/* Model filter */}
              <div className="flex items-center gap-2 p-2 px-3 bg-bg-elevated border border-border rounded-md mb-2">
                <Search size={16} className="text-text-tertiary shrink-0" />
                <input
                  type="text"
                  placeholder="Filter models..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-text text-14 font-interface"
                />
                {filter && <button onClick={() => setFilter('')} className="bg-none border-none cursor-pointer text-text-tertiary text-14">✕</button>}
              </div>
              {/* Model list */}
              {filteredModels.map(m => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={enabledModels.has(m.id)}
                    onChange={() => toggleModel(m.id)}
                    style={{ accentColor: 'var(--q-accent-primary)' }}
                  />
                  <span className="text-text text-14 font-interface flex-1">{m.id}</span>
                  <span className="text-text-tertiary text-12 font-code">{fmt(m.contextWindow)} ctx</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Delete modal */}
      {showDelete && (
        <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setShowDelete(false)}>
          <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter p-6 max-w-[400px] w-[90%]" onClick={(e) => e.stopPropagation()}>
            <div className="text-text text-16 font-interface mb-2">Delete provider "{displayName}"?</div>
            <div className="text-text-tertiary text-13 font-interface mb-5">{enabledModels.size} models will be removed. Saved API keys will be lost.</div>
            <div className="flex justify-end items-center">
              <button className="q-press px-4 py-2 rounded-md border-none cursor-pointer bg-transparent text-accent-danger text-15 font-interface" onClick={() => setShowDelete(false)}>Cancel</button>
              <div className="w-2" />
              <button
                className="q-press px-4 py-2 rounded-lg border-none cursor-pointer text-15 font-medium font-interface bg-accent-primary text-bg"
                onClick={async () => {
                  try {
                    const cfg = await call?.('getProvidersConfig', {})
                    if (cfg?.providers) {
                      delete cfg.providers[name]
                      await call?.('setProvidersConfig', cfg)
                      try { await call?.('deleteApiKey', { service: name }) } catch {}
                      setShowDelete(false)
                      onDeleted?.(name)
                    }
                  } catch (err) { console.error('Failed to delete provider:', err) }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}