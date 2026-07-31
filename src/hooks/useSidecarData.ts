import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// useSidecar — WebSocket connection
function useSidecar(url: string = 'ws://127.0.0.1:9182') {
  const wsRef = useRef<WebSocket | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>>(new Map())
  const handlersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map())
  const nextIdRef = useRef(1)

  useEffect(() => {
    let closed = false
    const connect = () => {
      if (closed) return
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => { setReady(true); setError(null) }
      ws.onmessage = (ev) => {
        let msg: any
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.id !== undefined) {
          const pending = pendingRef.current.get(msg.id)
          if (pending) {
            pendingRef.current.delete(msg.id)
            if (msg.error) pending.reject(msg.error)
            else pending.resolve(msg.result)
          }
        }
        if (msg.method && msg.id === undefined) {
          const handlers = handlersRef.current.get(msg.method)
          if (handlers) for (const h of handlers) h(msg.params)
        }
      }
      ws.onerror = () => { setError('WebSocket connection error') }
      ws.onclose = () => {
        setReady(false)
        if (!closed) setTimeout(connect, 2000)
      }
    }
    connect()
    return () => { closed = true; wsRef.current?.close() }
  }, [url])

  const call = useCallback((method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) { reject(new Error('Not connected')); return }
      const id = nextIdRef.current++
      pendingRef.current.set(id, { resolve, reject })
      wsRef.current.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
      setTimeout(() => { if (pendingRef.current.has(id)) { pendingRef.current.delete(id); reject(new Error('Timeout: ' + method)) } }, 30000)
    })
  }, [])

  const notify = useCallback((method: string, params: any = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }, [])

  const subscribe = useCallback((method: string, handler: (data: any) => void) => {
    if (!handlersRef.current.has(method)) handlersRef.current.set(method, new Set())
    handlersRef.current.get(method)!.add(handler)
    return () => { handlersRef.current.get(method)?.delete(handler) }
  }, [])

  return { call, notify, ready, error, subscribe }
}

// ── helper: map session from sidecar format ──
function mapSession(s: any) {
  return {
    id: s.sessionKey || s.id || s.key,
    title: s.label || s.title || 'Untitled',
    type: 'chat' as const,
    updatedAt: new Date(s.lastActivity || Date.now()).toISOString(),
    order: s.order || s.lastActivity || Date.now(),
    messageCount: s.messageCount || 0,
    agents: s.agents || [],
    model: s.model,
    thinkingLevel: s.thinkingLevel,
    mode: s.mode || 'plan',
    folderId: s.folderId || null,
    compactionAuto: s.compactionAuto ?? true,
    compactionThreshold: s.compactionThreshold ?? 80,
    agentId: s.agentId,
  }
}

function mapSessions(arr: any[]) { return arr.map(mapSession) }

// ── helper: map agent from sidecar format ──
function mapAgent(a: any) {
  // Descrizione: prime 3 righe non-vuote e non-header del PROMPT.md
  const desc = (a.prompt || '').split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 140)
  return {
    id: a.id,
    name: a.name,
    description: desc,
    systemPrompt: a.prompt || '',
    model: a.model || '',
    thinking: a.thinking || 'off',
    skills: (a.skills || []).map((s: string) => ({ name: s, source: 'local', installed: true })),
    tools: (a.tools || []).map((t: string) => ({ name: t, enabled: true })),
    directory: a.directory || '',
    isDeletable: a.id !== 'orchestrator',
  }
}

// useSidecarData — COMPLETE implementation with ALL Flutter-parity RPC methods + event handlers
function useSidecarData(sidecarUrl: string = 'ws://127.0.0.1:9182') {
  const { call, notify, ready, subscribe } = useSidecar(sidecarUrl)
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [providers, setProviders] = useState<any[]>([])
  const [messages, setMessages] = useState<any[]>([])
  const [folders, setFolders] = useState<any[]>([])
  const [models, setModels] = useState<any[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [statusLabel, setStatusLabel] = useState('')
  const [statusKind, setStatusKind] = useState('')
  const [contextTokens, setContextTokens] = useState(0)
  const [contextWindow, setContextWindow] = useState(1000000)
  const [thinkingLevels, setThinkingLevels] = useState<string[]>(['off', 'low', 'medium', 'high', 'xhigh'])
  const [agentStatus, setAgentStatus] = useState<any>(null)
  const [isCompacting, setIsCompacting] = useState(false)
  const [chatAgentIds, setChatAgentIds] = useState<string[]>([])
  const [agentOverrides, setAgentOverrides] = useState<Record<string, { model?: string; thinkingLevel?: string }>>({})
  const [compactingSessions, setCompactingSessions] = useState<Set<string>>(new Set())
  const [sessionTokens, setSessionTokens] = useState<Record<string, { input: number; output: number }>>({})
  const [debugLog, setDebugLog] = useState<any[]>([])
  const [piConfigNeeded, setPiConfigNeeded] = useState(false)

  // ── Load initial data when connected ──
  useEffect(() => {
    if (!ready) return
    let cancelled = false

    const loadData = async () => {
      try {
        // Load agents with files
        const agentsResult = await call('listAgents', {})
        if (!cancelled && agentsResult?.agents) {
          const agentsWithFiles = await Promise.all(agentsResult.agents.map(async (a: any) => {
            const agent = mapAgent(a)
            let files: any[] = []
            try {
              const filesResult = await call('listAgentFiles', { id: a.id })
              if (filesResult?.files) files = filesResult.files.map((f: any) => f.name || f.path || f)
            } catch {}
            return { ...agent, files }
          }))
          setAgents(agentsWithFiles)
        }

        // Load sessions (use getFullState like Flutter, fallback to listSessions)
        try {
          let sessionsList: any[] = []
          try {
            const fullState = await call('getFullState', {})
            if (fullState?.sessions) sessionsList = fullState.sessions
          } catch {
            const r = await call('listSessions', {})
            if (r?.sessions) sessionsList = r.sessions
          }
          if (!cancelled) setSessions(mapSessions(sessionsList))
        } catch {}

        // Load folders
        try {
          const foldersResult = await call('getFolders', {})
          if (!cancelled && foldersResult?.folders) setFolders(foldersResult.folders)
        } catch {}

        // Load providers + models
        try {
          const [providersResult, modelsResult] = await Promise.all([
            call('getProvidersConfig', {}),
            call('getModels', {}),
          ])
          if (!cancelled) {
            const modelsByProvider: Record<string, any[]> = {}
            if (modelsResult?.models) {
              const allModels = modelsResult.models.map((m: any) => {
                const p = m.provider || 'unknown'
                if (!modelsByProvider[p]) modelsByProvider[p] = []
                modelsByProvider[p].push({ id: m.id, name: m.name || m.id, contextWindow: m.contextWindow })
                return { id: m.id, name: m.name || m.id, provider: p, contextWindow: m.contextWindow }
              })
              setModels(allModels)
            }
            const providerList: any[] = []
            if (providersResult?.providers) {
              for (const [id, p] of Object.entries(providersResult.providers) as [string, any][]) {
                providerList.push({
                  id, name: id, type: p.api || 'ollama',
                  apiKeyStatus: id.toLowerCase() === 'ollama' ? 'local' : (p.apiKey && p.apiKey !== '••••••••' && !p.apiKey.startsWith('•')) || p.apiKeySet ? 'configured' : 'missing',
                  models: modelsByProvider[id] || [], enabled: p.enabled !== false, enabledModels: p.enabledModels || [],
                  baseUrl: p.baseUrl || '',
                })
              }
            }
            for (const [id, mods] of Object.entries(modelsByProvider)) {
              if (!providerList.find(p => p.id === id)) {
                providerList.push({ id, name: id, type: 'unknown', apiKeyStatus: 'missing', models: mods, enabled: true, baseUrl: '' })
              }
            }
            // Also add enabledModels as model entries (for providers without full model data)
            for (const p of providerList) {
              const safeP = providersResult?.providers?.[p.id]
              if (safeP?.enabledModels && p.models.length === 0) {
                p.models = safeP.enabledModels.map((id: string) => ({ id, name: id, contextWindow: 0 }))
              }
            }
            setProviders(providerList)
          }
        } catch {}

        // Load all context usage
        try {
          const allCtx = await call('getAllContextUsage', {})
          if (!cancelled && allCtx?.usage) {
            // Update sessions with context info
          }
        } catch {}

        setLoading(false)
      } catch (e) {
        setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true }
  }, [ready, call])

  // ── Subscribe to ALL sidecar events (Flutter parity) ──
  useEffect(() => {
    if (!ready) return

    // Deleghe attive (id) — per filtrare gli eventi nested dal flusso principale
    const activeDelegationsRef = { current: new Set<string>() }
    // Stream events — costruisce i toggle LIVE durante lo streaming (thinking/tool/delega appaiono in tempo reale)
    const ensureStreamingMsg = (prev: any[], messageId?: string) => {
      const last = prev[prev.length - 1]
      if (last && last.role === 'assistant' && last.isStreaming) return { arr: prev.slice(0, -1), msg: last }
      const msg = { id: messageId || `msg-${Date.now()}`, role: 'assistant' as const, content: '', blocks: [], timestamp: new Date().toISOString(), isStreaming: true }
      return { arr: prev, msg }
    }
    // Text come blocco cronologico (appare dopo i toggle precedenti)
    const pushText = (msg: any, delta: string) => {
      const blocks = [...(msg.blocks || [])]
      const lastB = blocks[blocks.length - 1]
      if (lastB?.type === 'text') {
        blocks[blocks.length - 1] = { ...lastB, content: (lastB.content || '') + delta }
      } else {
        blocks.push({ type: 'text', content: delta })
      }
      return blocks
    }
    // Blocchi cronologici: thinking N volte (una per turno), tool_call, tool_result — nell'ORDINE in cui arrivano
    const pushBlock = (msg: any, block: any) => {
      const blocks = [...(msg.blocks || [])]
      const lastB = blocks[blocks.length - 1]
      if (block.type === 'thinking' && lastB?.type === 'thinking') {
        blocks[blocks.length - 1] = { ...lastB, content: (lastB.content || '') + (block.content || '') }
      } else if (block.type === 'tool_call_args' && lastB?.type === 'tool_call') {
        blocks[blocks.length - 1] = { ...lastB, input: (lastB.input || '') + (block.input || '') }
      } else if (block.type === 'thinking' || block.type === 'tool_call' || block.type === 'tool_result' || block.type === 'delegation') {
        blocks.push(block)
      }
      return blocks
    }
    const unsubStream = subscribe('stream_event', (p: any) => {
      const { type, eventType, delta, content, messageId, toolName, isError } = p
      const _type = eventType || type
      const _content = delta || content || ''
      // Eventi nested di una delega attiva: vanno nel blocco delegation, NON nel messaggio principale
      if (messageId && activeDelegationsRef.current.has(messageId) && _type !== 'delegation_end') {
        const nestedBlock = (() => {
          if (_type === 'thinking_delta' || _type === 'thinking' || _type === 'thinking_start') return { type: 'thinking', content: _content }
          if (_type === 'text_delta' || _type === 'text' || _type === 'text_start') return { type: 'text', content: _content }
          if (_type === 'toolcall_start') return { type: 'tool_call', name: toolName || delta || 'tool', input: '' }
          if (_type === 'toolcall_delta') return { type: 'tool_call_args', input: _content }
          if (_type === 'toolcall_end' || _type === 'tool_result') return { type: 'tool_result', name: toolName || 'tool', output: String(_content || ''), isError: !!isError }
          return null
        })()
        if (nestedBlock) {
          setMessages(prev => prev.map(m => {
            const blocks = (m.blocks || []).map((b: any) => {
              if (b.type === 'delegation' && b.id === messageId) {
                const db = [...(b.blocks || [])]
                // thinking: appendi all'ultimo blocco thinking se è lo stesso tipo
                const lastB = db[db.length - 1]
                if (nestedBlock.type === 'thinking' && lastB?.type === 'thinking') {
                  db[db.length - 1] = { ...lastB, content: (lastB.content || '') + (nestedBlock.content || '') }
                } else if (nestedBlock.type === 'text' && lastB?.type === 'text') {
                  db[db.length - 1] = { ...lastB, content: (lastB.content || '') + (nestedBlock.content || '') }
                } else if (nestedBlock.type === 'tool_call_args' && lastB?.type === 'tool_call') {
                  db[db.length - 1] = { ...lastB, input: (lastB.input || '') + (nestedBlock.input || '') }
                } else {
                  db.push(nestedBlock)
                }
                return { ...b, blocks: db }
              }
              return b
            })
            return { ...m, blocks }
          }))
        }
        return
      }
      if (_type === 'text' || _type === 'text_delta' || _type === 'text_start') {
        setMessages(prev => {
          const { arr, msg } = ensureStreamingMsg(prev, messageId)
          // Blocchi cronologici (testo incluso) + content accumulato (per footer/persist)
          return [...arr, { ...msg, blocks: pushText(msg, _content), content: (msg.content || '') + _content }]
        })
        setStatusLabel('Writing'); setStatusKind('writing')
      } else if (_type === 'thinking' || _type === 'thinking_delta' || _type === 'thinking_start') {
        setStatusLabel('Thinking'); setStatusKind('thinking')
        if (_content) {
          setMessages(prev => {
            const { arr, msg } = ensureStreamingMsg(prev, messageId)
            return [...arr, { ...msg, blocks: pushBlock(msg, { type: 'thinking', content: _content }) }]
          })
        }
      } else if (_type === 'toolcall_start' || _type === 'tool_call') {
        setStatusLabel('Tool call'); setStatusKind('tool_call')
        setMessages(prev => {
          const { arr, msg } = ensureStreamingMsg(prev, messageId)
          return [...arr, { ...msg, blocks: pushBlock(msg, { type: 'tool_call', name: toolName || delta || 'tool', input: '' }) }]
        })
      } else if (_type === 'toolcall_delta') {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant' || !last.isStreaming) return prev
          return [...prev.slice(0, -1), { ...last, blocks: pushBlock(last, { type: 'tool_call_args', input: _content }) }]
        })
      } else if (_type === 'toolcall_end' || _type === 'tool_result') {
        // toolcall_end nel stream_event = FINE ARGOMENTI del tool call, NON il risultato.
        // Il risultato vero arriva dalla notifica separata 'tool_result'. Qui NON si crea niente.
      } else if (_type === 'delegation_start') {
        // NON mostrare "Delegating" nella pill — nel Flutter non esiste questo status
        activeDelegationsRef.current.add(messageId)
        // Blocco delegation CRONOLOGICO (dopo il tool_call delegate_to_agent, prima del tool_result)
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant' || !last.isStreaming) return prev
          return [...prev.slice(0, -1), { ...last, blocks: pushBlock(last, { type: 'delegation', id: messageId, agentName: p.agentName || 'agent', taskContent: p.task || '', blocks: [], streaming: true }) }]
        })
      } else if (_type === 'delegation_end') {
        setStatusLabel('Running'); setStatusKind('running')
        activeDelegationsRef.current.delete(messageId)
        setMessages(prev => prev.map(m => {
          const blocks = (m.blocks || []).map((b: any) => b.type === 'delegation' && b.id === messageId
            ? { ...b, streaming: false, response: p.response || b.response, agentModel: p.model || b.agentModel, thinkingLevel: p.thinkingLevel || b.thinkingLevel }
            : b)
          return { ...m, blocks }
        }))
      } else if (_type === 'error') {
        setStatusLabel('Failed'); setStatusKind('failed'); setIsStreaming(false)
      } else if (_type === 'done' || _type === 'end') {
        setIsStreaming(false); setStatusLabel(''); setStatusKind('')
        setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m))
      }
    })

    // Tool result arriva come notifica SEPARATA (type: "tool_result", non stream_event)
    const unsubToolResult = subscribe('tool_result', (p: any) => {
      setStatusLabel(p?.isError ? 'Tool error' : 'Tool result'); setStatusKind(p?.isError ? 'tool_error' : 'tool_result')
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant') return prev
        return [...prev.slice(0, -1), { ...last, blocks: pushBlock(last, { type: 'tool_result', name: p?.toolName || 'tool', output: String(p?.content || ''), isError: !!p?.isError }) }]
      })
    })

    // Streaming started/stopped
    const unsubStreamStart = subscribe('streaming_started', () => {
      setIsStreaming(true)
    })
    // Done event (sent as separate notification, not stream_event)
    const unsubDone = subscribe('done', (p: any) => {
      const { text, model, agentName, thinkingLevel, stopReason, errorMessage } = p || {}
      // stopReason "toolUse" = turno intermedio (l'assistant ha chiamato un tool, la risposta continua).
      // NON finalizzare: la fine vera arriva con stop/length/error/aborted + streaming_stopped.
      // Finalizza SOLO per stop finali veri. toolUse = turno intermedio (ignora).
      if (!stopReason || stopReason === 'toolUse') return
      setIsStreaming(false); setStatusLabel(''); setStatusKind('')
      // Accumula input/output totali sessione (mai resettati dalle risposte; solo reset sessione)
      const u: any = p?.usage
      if (u && p?.sessionKey) {
        const inp = u.input ?? u.input_tokens ?? 0
        const outp = u.output ?? u.output_tokens ?? 0
        if (inp > 0 || outp > 0) {
          setSessionTokens(prev => ({ ...prev, [p.sessionKey]: { input: (prev[p.sessionKey]?.input || 0) + inp, output: (prev[p.sessionKey]?.output || 0) + outp } }))
        }
      }
      if (stopReason === 'error') {
        setMessages(prev => {
          const hasStreaming = prev.some(m => m.isStreaming)
          if (hasStreaming) {
            return prev.map(m => m.isStreaming ? { ...m, isStreaming: false, isError: true, content: '', errorContent: errorMessage || 'Unknown error' } : m)
          }
          // Nessun messaggio in streaming (errore prima del primo delta) → aggiungi messaggio errore
          return [...prev, { id: `err-${Date.now()}`, role: 'assistant' as const, content: '', errorContent: errorMessage || 'Unknown error', timestamp: new Date().toISOString(), isError: true, model, agentName }]
        })
      } else {
        setMessages(prev => {
          // Aggiorna l'ULTIMO messaggio assistant (streaming o no: streaming_stopped può arrivare prima di done)
          let lastIdx = -1
          for (let i = prev.length - 1; i >= 0; i--) { if (prev[i].role === 'assistant') { lastIdx = i; break } }
          if (lastIdx < 0) return prev
          return prev.map((m, i) => i === lastIdx ? { ...m, isStreaming: false, model: model || m.model, agentModel: model || m.agentModel, agentName: agentName || m.agentName, thinkingLevel: thinkingLevel || m.thinkingLevel, content: text || m.content } : m)
        })
      }
    })

    const unsubStreamStop = subscribe('streaming_stopped', () => {
      setIsStreaming(false); setStatusLabel(''); setStatusKind('')
      setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m))
    })

    // Session lifecycle
    const unsubSessCreated = subscribe('session_created', () => {
      call('getFullState', {}).then((r: any) => { if (r?.sessions) setSessions(mapSessions(r.sessions)) }).catch(() => {})
    })
    const unsubSessUpdated = subscribe('session_updated', (p: any) => {
      if (p?.sessionKey) {
        setSessions(prev => prev.map(s => s.id === p.sessionKey ? {
          ...s, title: p.label || s.title, model: p.model ?? s.model,
          thinkingLevel: p.thinkingLevel ?? s.thinkingLevel, mode: p.mode ?? s.mode,
        } : s))
      } else {
        call('getFullState', {}).then((r: any) => { if (r?.sessions) setSessions(mapSessions(r.sessions)) }).catch(() => {})
      }
    })
    const unsubSessDeleted = subscribe('session_deleted', (p: any) => {
      if (p?.sessionKey) {
        setSessions(prev => prev.filter(s => s.id !== p.sessionKey))
        if (activeSessionId === p.sessionKey) { setActiveSessionId(null); setMessages([]) }
      }
    })

    // Model updated
    const unsubModelUpdate = subscribe('model_updated', (p: any) => {
      if (p?.sessionKey) {
        setSessions(prev => prev.map(s => s.id === p.sessionKey ? { ...s, model: p.model } : s))
      }
    })

    // Thinking updated
    const unsubThinkUpdate = subscribe('thinking_updated', (p: any) => {
      if (p?.sessionKey && p.accepted !== false) {
        setSessions(prev => prev.map(s => s.id === p.sessionKey ? { ...s, thinkingLevel: p.level || 'off' } : s))
      }
    })
    const unsubThinkLevels = subscribe('thinking_levels', (p: any) => {
      if (p?.levels) setThinkingLevels(p.levels)
    })

    // Session meta
    const unsubSessMeta = subscribe('session_meta', (p: any) => {
      if (p?.sessionKey) {
        setSessions(prev => prev.map(s => s.id === p.sessionKey ? {
          ...s, model: p.model ?? s.model, thinkingLevel: p.thinkingLevel ?? s.thinkingLevel, mode: p.mode ?? s.mode,
        } : s))
        if (p.availableThinkingLevels) setThinkingLevels(p.availableThinkingLevels)
      }
    })

    // Agent status — TUTTI gli stati tracciati (parity Flutter _statusLabel)
    const unsubAgentStatus = subscribe('agent_status', (p: any) => {
      if (p?.sessionKey) setAgentStatus(p)
      // idle NON cancella: fra i turni tool il SDK emette idle a metà stream.
      // La pill si cancella solo con done / streaming_stopped / error.
      switch (p?.status) {
        case 'running': setStatusLabel('Running'); setStatusKind('running'); break
        case 'thinking': setStatusLabel('Thinking'); setStatusKind('thinking'); break
        case 'writing': setStatusLabel('Writing'); setStatusKind('writing'); break
        case 'tool': setStatusLabel('Tool call'); setStatusKind('tool_call'); break
        case 'compacting': setStatusLabel('Compacting'); setStatusKind('compacting'); break
        case 'retrying': setStatusLabel(`Retrying ${p.attempt || 1}/${p.maxAttempts || 3}`); setStatusKind('retrying'); break
        case 'failed': setStatusLabel('Failed'); setStatusKind('failed'); setIsStreaming(false); break
      }
    })

    // Context usage
    const unsubCtxUsage = subscribe('context_usage', (p: any) => {
      if (p?.sessionKey && p.usage) {
        if (typeof p.usage.input === 'number' || typeof p.usage.output === 'number') {
          setSessionTokens(prev => ({ ...prev, [p.sessionKey]: { input: p.usage.input || 0, output: p.usage.output || 0 } }))
        }
        if (p.sessionKey === activeSessionId) {
          setContextTokens(p.usage.tokens ?? p.usage.used ?? 0)
          if (p.usage.contextWindow || p.usage.window || p.usage.total) setContextWindow(p.usage.contextWindow ?? p.usage.window ?? p.usage.total)
        }
      }
    })
    const unsubAllCtx = subscribe('all_context_usage', (p: any) => {
      if (p?.usage) {
        // Update context for active session
        const sk = activeSessionId
        if (sk && p.usage[sk]) {
          setContextTokens(p.usage[sk].tokens || p.usage[sk].used || 0)
          setContextWindow(p.usage[sk].window || p.usage[sk].total || 1000000)
        }
      }
    })
    const unsubModelCtx = subscribe('model_context', (p: any) => {
      if (p?.modelId) {
        // Could store model context windows
      }
    })

    // Debug log
    const unsubDebugLog = subscribe('debug_log', (p: any) => {
      if (p?.log) setDebugLog(p.log)
    })

    // Compaction status
    const unsubCompaction = subscribe('compaction_status', (p: any) => {
      const sk = p?.sessionKey
      const status = p?.status
      if (sk && status) {
        if (status === 'start') {
          setCompactingSessions(prev => new Set(prev).add(sk))
          setStatusLabel('Compacting'); setStatusKind('compacting')
        } else if (status === 'end' || status === 'error' || status === 'noop') {
          setCompactingSessions(prev => { const n = new Set(prev); n.delete(sk); return n })
          if (activeSessionId === sk) { setStatusLabel(''); setStatusKind('') }
          if (status === 'end' && p.summary) {
            setMessages(prev => [...prev, { id: `compact-${Date.now()}`, role: 'assistant', content: p.summary, timestamp: new Date().toISOString(), isCompactionSummary: true }])
          }
        }
      }
    })

    // History reload — RIMOSSO: selectSession gestisce il caricamento con merge completo (delegations, blocks, compaction)
    // Questo handler sovrascriveva i messaggi SENZA delegations → toggle delega scompariva
    const unsubHistory = () => {}

    // Pi config
    const unsubPiNeeded = subscribe('pi_config_needed', () => setPiConfigNeeded(true))
    const unsubPiOk = subscribe('pi_config_ok', () => setPiConfigNeeded(false))
    const unsubPiCreated = subscribe('pi_config_created', () => {
      setPiConfigNeeded(false)
      call('getFullState', {}).then((r: any) => { if (r?.sessions) setSessions(mapSessions(r.sessions)) }).catch(() => {})
    })

    // Models list
    const unsubModelsList = subscribe('models_list', (p: any) => {
      if (p?.models) setModels(p.models)
    })

    // Thinking start/delta/end (granular)
    const unsubThinkStart = subscribe('thinking_start', () => { setStatusLabel('Thinking'); setStatusKind('thinking') })
    const unsubThinkEnd = subscribe('thinking_end', () => { setStatusLabel('Writing'); setStatusKind('writing') })

    // Progress
    const unsubProgress = subscribe('progress_start', (p: any) => {
      if (p?.sessionKey) { setStatusLabel('Thinking'); setStatusKind('thinking') }
    })

    return () => {
      unsubStream(); unsubStreamStart(); unsubStreamStop(); unsubDone(); unsubToolResult()
      unsubSessCreated(); unsubSessUpdated(); unsubSessDeleted()
      unsubModelUpdate(); unsubThinkUpdate(); unsubThinkLevels()
      unsubSessMeta(); unsubAgentStatus()
      unsubCtxUsage(); unsubAllCtx(); unsubModelCtx()
      unsubDebugLog(); unsubCompaction(); unsubHistory()
      unsubPiNeeded(); unsubPiOk(); unsubPiCreated()
      unsubModelsList(); unsubThinkStart(); unsubThinkEnd()
      unsubProgress()
    }
  }, [ready, subscribe, call, activeSessionId])

  // ── Session management ──
  const selectSession = useCallback(async (sessionKey: string) => {
    if (!ready) return
    setActiveSessionId(sessionKey)
    // NON svuotare messages qui: evita il flash quando si ricarica la stessa chat (es. dopo compaction)
    setIsStreaming(false)
    setStatusLabel(''); setStatusKind('')
    try {
      const history = await call('getHistory', { sessionKey })
      if (history?.messages) {
        // La history ha tool_call/tool_result come messaggi SEPARATI (ordine cronologico).
        // Il renderer li vuole DENTRO il messaggio assistant come array → merge cronologico.
        const merged: any[] = []
        for (const m of history.messages) {
          const base: any = {
            id: m.id || `msg-${Math.random()}`,
            role: m.role,
            content: m.content || '',
            timestamp: m.timestamp || new Date().toISOString(),
            thinking: m.reasoning || m.thinking,
            agentName: m.agentName, agentModel: m.model, thinkingLevel: m.thinkingLevel,
            tokensIn: m.tokensIn, tokensOut: m.tokensOut,
            isCompacted: m.isCompacted, isError: m.isError,
            errorType: m.errorType, errorContent: m.errorContent,
          }
          if (m.role === 'tool_call') {
            let last = merged[merged.length - 1]
            if (!last || last.role !== 'assistant') { last = { id: `tc-parent-${m.id}`, role: 'assistant', content: '', blocks: [], timestamp: base.timestamp }; merged.push(last) }
            const input = typeof m.toolArgs === 'string' ? m.toolArgs : JSON.stringify(m.toolArgs ?? '')
            last.toolCalls = [...(last.toolCalls || []), { name: m.toolName || 'tool', input }]
            last.blocks = [...(last.blocks || [])]
            // Thinking PRIMA del tool call (reasoning attaccato al tool_call nel mapper)
            if (m.reasoning) last.blocks.push({ type: 'thinking', content: m.reasoning })
            last.blocks.push({ type: 'tool_call', name: m.toolName || 'tool', input })
          } else if (m.role === 'tool_result') {
            let last = merged[merged.length - 1]
            if (!last || last.role !== 'assistant') { last = { id: `tr-parent-${m.id}`, role: 'assistant', content: '', blocks: [], timestamp: base.timestamp }; merged.push(last) }
            last.toolResults = [...(last.toolResults || []), { name: m.toolName || 'tool', output: String(m.content || ''), isError: !!m.isError }]
            last.blocks = [...(last.blocks || []), { type: 'tool_result', name: m.toolName || 'tool', output: String(m.content || ''), isError: !!m.isError }]
          } else if (m.isCompactionSummary || m.isCompactionWarning) {
            // Compaction toggle (blu = summary, arancione = noop warning)
            merged.push({ id: base.id, role: 'assistant', content: '', timestamp: base.timestamp, compaction: [{ content: m.content || '', isNoop: !!m.isCompactionWarning }] })
          } else {
            if (base.role === 'assistant') {
              if (base.thinking) {
                base.blocks = [...(base.blocks || []), { type: 'thinking', content: typeof base.thinking === 'string' ? base.thinking : (Array.isArray(base.thinking) ? base.thinking.map((x: any) => x?.content ?? x ?? '').join('') : String(base.thinking)) }]
              }
              // Text come blocco (altrimenti il testo intermedio scompare nel render blocks)
              if (base.content) {
                base.blocks = [...(base.blocks || []), { type: 'text', content: base.content }]
              }
            }
            merged.push(base)
          }
        }
        // === Deleghe persistite: inserisci DOPO il tool_call delegate_to_agent (al contrario per evitare index shift) ===
        try {
          const delList = (history as any).delegations || []
          if (Array.isArray(delList) && delList.length > 0) {
            // Crea i messaggi delega
            const delMsgs = delList.map((d: any) => {
              const nb: any[] = []
              if (Array.isArray(d.content)) {
                for (const b of d.content) {
                  if (b?.type === 'thinking') nb.push({ type: 'thinking', content: b.thinking || b.content || '' })
                  else if (b?.type === 'toolCall') nb.push({ type: 'tool_call', name: b.text || b.name || 'tool', input: b.thinking || b.input || b.args || '' })
                  else if (b?.type === 'toolResult') nb.push({ type: 'tool_result', name: b.text || b.name || 'tool', output: b.thinking || b.content || '', isError: !!b.isError })
                  else if (b?.type === 'text') nb.push({ type: 'text', content: b.text || b.content || '' })
                }
              }
              const delBlock = { id: d.id, agentName: d.agentName || 'agent', agentModel: d.model || '', taskContent: d.delegatedMessage || '', response: typeof d.content === 'string' ? d.content : '', blocks: nb, thinkingLevel: d.thinkingLevel || '' }
              return { id: `delmsg-${d.id}`, role: 'assistant', content: '', delegations: [delBlock], timestamp: new Date(d.timestamp || Date.now()).toISOString() }
            })
            // Itera al contrario: SPLI il messaggio al tool_call delegate_to_agent, inserisci delega TRA tool_call e tool_result
            let delIdx = delMsgs.length - 1
            for (let i = merged.length - 1; i >= 0 && delIdx >= 0; i--) {
              if (merged[i].role !== 'assistant') continue
              const blocks = (merged[i] as any).blocks || []
              const tcIdx = blocks.findIndex((b: any) => b.type === 'tool_call' && (b.name === 'delegate_to_agent' || (b.name || '').includes('delegate')))
              if (tcIdx >= 0) {
                // Split: [thinking, tool_call] | [tool_result, text, ...]
                const beforeBlocks = blocks.slice(0, tcIdx + 1)
                const afterBlocks = blocks.slice(tcIdx + 1)
                // Modifica il messaggio originale: tiene solo i blocchi prima+durante il tool_call
                ;(merged[i] as any).blocks = beforeBlocks
                // Inserisci la delega DOPO il tool_call
                merged.splice(i + 1, 0, delMsgs[delIdx--])
                // Inserisci i blocchi rimanenti (tool_result, text) come nuovo messaggio
                if (afterBlocks.length > 0) {
                  merged.splice(i + 2, 0, { id: `split-${i}-${Date.now()}`, role: 'assistant', content: '', blocks: afterBlocks, timestamp: merged[i].timestamp })
                }
              }
            }
            // Deleghe rimanenti in fondo
            while (delIdx >= 0) merged.push(delMsgs[delIdx--])
          }
        } catch (e) { console.error('[DELEGATIONS] merge error:', e) }
        setMessages(merged)
      }
      // === Ripristino streaming: se la sessione sta ancora generando, recupera stato + buffer ===
      try {
        const ss = await call('getStreamingStatus', { sessionKey })
        if (ss?.streaming) {
          setIsStreaming(true)
          setStatusLabel('Thinking'); setStatusKind('thinking')
          const buf = await call('getStreamingMessage', { sessionKey })
          if (buf?.streaming && (buf.streaming.text || buf.streaming.thinking || (buf.streaming.toolCalls || []).length > 0)) {
            const sb = buf.streaming
            const blocks: any[] = []
            if (sb.thinking) blocks.push({ type: 'thinking', content: sb.thinking })
            for (const tc of sb.toolCalls || []) blocks.push({ type: 'tool_call', name: tc.name || 'tool', input: tc.input || '' })
            if (sb.text) blocks.push({ type: 'text', content: sb.text })
            setMessages(prev => {
              // Se l'ultimo messaggio è già l'assistant streaming, non duplicare
              const last = prev[prev.length - 1]
              if (last?.role === 'assistant' && last.isStreaming) return prev
              return [...prev, { id: sb.messageId || `msg-restored-${Date.now()}`, role: 'assistant' as const, content: sb.text || '', blocks, timestamp: new Date().toISOString(), isStreaming: true }]
            })
          }
        }
      } catch {}

      // Load context usage
      try {
        const ctx = await call('getContextUsage', { sessionKey })
        const u = ctx?.usage || ctx
        if (u) {
          setContextTokens(u.tokens ?? u.used ?? 0)
          if (u.contextWindow || u.window || u.total) setContextWindow(u.contextWindow ?? u.window ?? u.total)
          if (typeof u.input === 'number' || typeof u.output === 'number') {
            setSessionTokens(prev => ({ ...prev, [sessionKey]: { input: u.input || 0, output: u.output || 0 } }))
          }
        }
      } catch {}
      // Load session meta
      try {
        const meta = await call('getSessionMeta', { sessionKey })
        if (meta) {
          setSessions(prev => prev.map(s => s.id === sessionKey ? {
            ...s, model: meta.model ?? s.model, thinkingLevel: meta.thinkingLevel ?? s.thinkingLevel, mode: meta.mode ?? s.mode,
          } : s))
          if (meta.availableThinkingLevels) setThinkingLevels(meta.availableThinkingLevels)
          // Agenti in chat + override per-agente (model/thinking)
          const ids = meta.agentId ? String(meta.agentId).split(',').filter(Boolean) : []
          // Sessione Expert: quinki-expert SEMPRE presente di default (si possono AGGIUNGERE altri agenti)
          if (sessionKey === '__quinki_expert__' && ids.length === 0) {
            ids.push('quinki-expert')
            try { await call('setChatAgents', { sessionKey, agentIds: 'quinki-expert' }) } catch {}
          }
          setChatAgentIds(ids)
          setAgentOverrides(meta.agentOverrides || {})
        }
      } catch {}
      // Load thinking levels
      try {
        const tl = await call('getThinkingLevels', { sessionKey })
        if (tl?.levels) setThinkingLevels(tl.levels)
      } catch {}
      // Load attachments
      try {
        // Load attachments (processed by message mapper)
      } catch {}
    } catch (e) {
      console.error('Failed to load session:', e)
    }
  }, [ready, call])

  const sendMessage = useCallback(async (text: string, sessionKeyOrOpts?: string | any, agents?: string[]) => {
    // Backwards compat: (text, {agentId, model, thinkingLevel}) or (text, sessionKey, agents)
    let sk: string | undefined
    let ag: string[] | undefined
    let optsModel: string | undefined
    let optsThinking: string | undefined
    if (typeof sessionKeyOrOpts === 'string') { sk = sessionKeyOrOpts; ag = agents }
    else if (sessionKeyOrOpts && typeof sessionKeyOrOpts === 'object') { sk = activeSessionId || undefined; ag = sessionKeyOrOpts.agentId ? [sessionKeyOrOpts.agentId] : undefined; if (sessionKeyOrOpts.model) optsModel = sessionKeyOrOpts.model; if (sessionKeyOrOpts.thinkingLevel) optsThinking = sessionKeyOrOpts.thinkingLevel }
    if (!ready) return
    const hasModels = providers.some((p: any) => p.models && p.models.length > 0)
    if (!hasModels) {
      setMessages(prev => [...prev,
        { id: `msg-${Date.now()}`, role: 'user' as const, content: text, timestamp: new Date().toISOString(), tokensIn: Math.ceil(text.length / 4) },
        { id: `err-${Date.now()}`, role: 'assistant' as const, content: 'No model configured. Add a provider in Settings first.', timestamp: new Date().toISOString(), isError: true }
      ])
      return
    }
    const userMsg = { id: `msg-${Date.now()}`, role: 'user' as const, content: text, timestamp: new Date().toISOString(), tokensIn: Math.ceil(text.length / 4) }
    setMessages(prev => [...prev, userMsg])
    setIsStreaming(true)
    setStatusLabel('Thinking'); setStatusKind('thinking')
    try {
      sk = sk || activeSessionId || ''
      if (!sk) {
        try {
          // Applica i default delle impostazioni alla nuova chat (modello + thinking)
          let defs: any = {}
          try { defs = JSON.parse(localStorage.getItem('quinki-settings') || '{}') } catch {}
          const createParams: any = { label: 'New chat' }
          const dm = optsModel || defs.defaultModel
          const dt = optsThinking || defs.defaultThinking
          if (dm) createParams.model = dm
          if (dt) createParams.thinkingLevel = dt
          if (defs.defaultMode) createParams.mode = defs.defaultMode
          const createResult = await call('createSession', createParams)
          if (createResult?.key || createResult?.sessionKey) {
            sk = createResult.key || createResult.sessionKey
            setActiveSessionId(sk as string)
            // Persisti gli agenti selezionati nella nuova sessione (orchestrator incluso)
            if (ag && ag.length > 0) {
              try { await call('setChatAgents', { sessionKey: sk, agentIds: ag.join(',') }) } catch {}
            }
            try {
              const r = await call('getFullState', {})
              if (r?.sessions) setSessions(mapSessions(r.sessions))
            } catch {}
          }
        } catch (e) {
          console.error('Failed to create session:', e)
          setIsStreaming(false); setStatusLabel('Failed'); setStatusKind('failed')
          return
        }
      }
      await call('sendMessage', { sessionKey: sk, text, agentId: ag && ag.length > 0 ? ag[0] : undefined, model: optsModel, thinkingLevel: optsThinking }, 600000)
      // Reload sessions to get auto-generated title
      try {
        const r = await call('getFullState', {})
        if (r?.sessions) setSessions(mapSessions(r.sessions))
      } catch {}
    } catch (e) {
      console.error('Failed to send message:', e)
      setIsStreaming(false); setStatusLabel('Failed'); setStatusKind('failed')
    }
  }, [ready, call, activeSessionId, providers])

  const deselectSession = useCallback(() => {
    setActiveSessionId(null)
    setMessages([])
    setIsStreaming(false)
    setStatusLabel(''); setStatusKind('')
  }, [])

  const stopStreaming = useCallback(() => {
    if (!ready) return
    call('abort', { sessionKey: activeSessionId }).catch(() => {})
    setIsStreaming(false); setStatusLabel(''); setStatusKind('')
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m))
  }, [ready, call, activeSessionId])

  // ── Session CRUD ──
  const createSession = useCallback(async (label?: string, opts?: any) => {
    if (!ready) return null
    try {
      const params: any = { label: label || 'New chat' }
      if (opts?.model) params.model = opts.model
      if (opts?.thinkingLevel) params.thinkingLevel = opts.thinkingLevel
      if (opts?.agentId) params.agentId = opts.agentId
      const r = await call('createSession', params)
      if (r?.sessionKey) {
        try {
          const fs = await call('getFullState', {})
          if (fs?.sessions) setSessions(mapSessions(fs.sessions))
        } catch {}
        return r
      }
    } catch (e) { console.error('createSession:', e) }
    return null
  }, [ready, call])

  const deleteSession = useCallback(async (sessionKey: string) => {
    if (!ready) return
    try {
      notify('deleteSession', { sessionKey })
      setSessions(prev => prev.filter(s => s.id !== sessionKey))
      if (activeSessionId === sessionKey) { setActiveSessionId(null); setMessages([]) }
    } catch (e) { console.error('deleteSession:', e) }
  }, [ready, notify, activeSessionId])

  const renameSession = useCallback(async (sessionKey: string, title: string) => {
    if (!ready) return
    try {
      await call('renameSession', { sessionKey, label: title })
      setSessions(prev => prev.map(s => s.id === sessionKey ? { ...s, title } : s))
    } catch (e) { console.error('renameSession:', e) }
  }, [ready, call])

  const resetSession = useCallback(async (sessionKey: string) => {
    if (!ready) return
    try {
      await call('resetSession', { sessionKey })
      // Ricarica la sessione: messaggi spariscono subito, mantieni model/thinking/mode/agents
      notify('reloadSession', { sessionKey })
      await selectSession(sessionKey)
    } catch (e) { console.error('resetSession:', e) }
  }, [ready, call, notify, selectSession])

  const reloadSession = useCallback(async (sessionKey: string) => {
    if (!ready) return
    notify('reloadSession', { sessionKey })
    await selectSession(sessionKey)
  }, [ready, notify, selectSession])

  const moveSession = useCallback((sessionKey: string, folderId: string | null, order: number) => {
    if (!ready) return
    notify('moveSession', { sessionKey, folderId, order })
  }, [ready, notify])

  const compactSession = useCallback(async (sessionKey: string) => {
    if (!ready) return
    setIsCompacting(true); setStatusLabel('Compacting'); setStatusKind('compacting')
    try {
      const r = await call('compactSession', { sessionKey }, 120000)
      // Ricarica per mostrare il toggle compaction
      if (sessionKey === activeSessionId) {
        await selectSession(sessionKey)
      }
    } catch (e) { console.error('compactSession:', e) }
    setIsCompacting(false); setStatusLabel(''); setStatusKind('')
  }, [ready, call, activeSessionId, selectSession])

  // ── Session settings ──
  const setChatAgents = useCallback(async (sessionKeyOrIds: string | string[], agentIds?: string[]) => {
    let sk: string, ids: string[]
    if (Array.isArray(sessionKeyOrIds)) { sk = activeSessionId || ''; ids = sessionKeyOrIds }
    else { sk = sessionKeyOrIds; ids = agentIds || [] }
    // Il sidecar si aspetta agentIds come STRINGA comma-separated (non array `agents`)
    try { await call('setChatAgents', { sessionKey: sk, agentIds: ids.join(',') }) } catch (e) { console.error('setChatAgents:', e) }
    setChatAgentIds(ids)
    if (!ready) return

  }, [ready, call, activeSessionId])

  const setModel = useCallback(async (sessionKeyOrModel: string, model?: string) => {
    if (!ready) return
    let sk: string, m: string
    if (model !== undefined) { sk = sessionKeyOrModel; m = model }
    else { sk = activeSessionId || ''; m = sessionKeyOrModel }
    notify('setModel', { sessionKey: sk, model: m })
    setSessions(prev => prev.map(s => s.id === sk ? { ...s, model: m } : s))
    // Aggiorna subito il contatore contesto (il sidecar resetta l'usage al cambio modello — B16)
    const mi = models.find((x: any) => x.id === m)
    if (mi?.contextWindow) setContextWindow(mi.contextWindow)
    setContextTokens(0)
  }, [ready, notify, activeSessionId, models])

  const setThinkingLevel = useCallback(async (sessionKeyOrLevel: string, level?: string) => {
    if (!ready) return
    let sk: string, l: string
    if (level !== undefined) { sk = sessionKeyOrLevel; l = level }
    else { sk = activeSessionId || ''; l = sessionKeyOrLevel }
    notify('setThinking', { sessionKey: sk, thinkingLevel: l })
    setSessions(prev => prev.map(s => s.id === sk ? { ...s, thinkingLevel: l } : s))
  }, [ready, notify, activeSessionId])

  const setMode = useCallback((sessionKeyOrMode: string, mode?: string) => {
    if (!ready) return
    let sk: string, m: string
    if (mode !== undefined) { sk = sessionKeyOrMode; m = mode }
    else { sk = activeSessionId || ''; m = sessionKeyOrMode }
    notify('setMode', { sessionKey: sk, mode: m })
    setSessions(prev => prev.map(s => s.id === sk ? { ...s, mode: m } : s))
  }, [ready, notify, activeSessionId])

  const setSessionCompaction = useCallback((sessionKey: string, auto: boolean, threshold: number) => {
    if (!ready) return
    notify('setSessionCompaction', { sessionKey, auto, threshold })
  }, [ready, notify])

  const setWorkingDir = useCallback(async (arg1: string, arg2: string) => {
    if (!ready) return
    // Backwards compat: App.tsx calls setWorkingDir(dir, sessionKey)
    // New API: setWorkingDir(sessionKey, dir)
    // Detect: if arg1 looks like a path and arg2 looks like a sessionKey
    let sk: string, dir: string
    if (arg1.startsWith('/') || arg1.startsWith('~') || arg1.includes('/')) {
      dir = arg1; sk = arg2
    } else {
      sk = arg1; dir = arg2
    }
    notify('setWorkingDir', { sessionKey: sk, workingDir: dir })
  }, [ready, notify])

  const ensureSession = useCallback(async (sessionKey: string, label: string) => {
    if (!ready) return
    try { await call('ensureSession', { sessionKey, label }) } catch (e) { console.error('ensureSession:', e) }
  }, [ready, call])

  // ── Folders ──
  const updateFolders = useCallback((newFolders: any[]) => {
    if (!ready) return
    notify('setFolders', { folders: newFolders })
    setFolders(newFolders)
  }, [ready, notify])

  // ── Agent management ──
  const createAgent = useCallback(async (agentId: string, name: string, config: any) => {
    if (!ready) return
    try {
      await call('createAgent', { agentId, name, ...config })
      const r = await call('listAgents', {})
      if (r?.agents) setAgents(r.agents.map(mapAgent))
    } catch (e) { console.error('createAgent:', e) }
  }, [ready, call])

  const updateAgent = useCallback(async (agentId: string, config: any) => {
    if (!ready) return
    try {
      await call('updateAgent', { agentId, ...config })
      const r = await call('listAgents', {})
      if (r?.agents) setAgents(r.agents.map(mapAgent))
    } catch (e) { console.error('updateAgent:', e) }
  }, [ready, call])

  const deleteAgent = useCallback(async (agentId: string) => {
    if (!ready) return
    try {
      await call('deleteAgent', { agentId })
      setAgents(prev => prev.filter(a => a.id !== agentId))
    } catch (e) { console.error('deleteAgent:', e) }
  }, [ready, call])

  const setAgent = useCallback(async (agentId: string, config: any) => {
    if (!ready) return
    try { await call('setAgent', { agentId, ...config }) } catch (e) { console.error('setAgent:', e) }
  }, [ready, call])

  const setAgentOverride = useCallback(async (sessionKey: string, agentId: string, overrides: any) => {
    if (!ready) return
    try { await call('setAgentOverride', { sessionKey, agentId, ...overrides }) } catch (e) { console.error('setAgentOverride:', e) }
    // Aggiorna lo stato locale (stessa semantica del sidecar: null = rimuovi campo)
    setAgentOverrides(prev => {
      const next = { ...prev }
      const cur = { ...(next[agentId] || {}) }
      if ('model' in overrides) { if (overrides.model == null) delete cur.model; else cur.model = overrides.model }
      if ('thinkingLevel' in overrides) { if (overrides.thinkingLevel == null) delete cur.thinkingLevel; else cur.thinkingLevel = overrides.thinkingLevel }
      if (Object.keys(cur).length === 0) delete next[agentId]; else next[agentId] = cur
      return next
    })
  }, [ready, call])

  const getAgentOverrides = useCallback(async (sessionKey: string) => {
    if (!ready) return {}
    try { return await call('getAgentOverrides', { sessionKey }) } catch (e) { return {} }
  }, [ready, call])

  const readAgentFile = useCallback(async (agentId: string, path: string) => {
    if (!ready) return ''
    try { const r = await call('readAgentFile', { agentId, path }); return r?.content || r || '' } catch (e) { console.error('readAgentFile:', e); return '' }
  }, [ready, call])

  const writeAgentFile = useCallback(async (agentId: string, path: string, content: string) => {
    if (!ready) return
    try { await call('writeAgentFile', { agentId, path, content }) } catch (e) { console.error('writeAgentFile:', e) }
  }, [ready, call])

  const createAgentFile = useCallback(async (agentId: string, path: string) => {
    if (!ready) return
    try { await call('createAgentFile', { agentId, path }) } catch (e) { console.error('createAgentFile:', e) }
  }, [ready, call])

  // ── Skills ──
  const listSkills = useCallback(async () => {
    if (!ready) return []
    try { const r = await call('listSkills', {}); return r?.skills || [] } catch (e) { return [] }
  }, [ready, call])

  const installSkill = useCallback(async (skillId: string) => {
    if (!ready) return
    try { await call('installSkill', { skillId }) } catch (e) { console.error('installSkill:', e) }
  }, [ready, call])

  const createSkill = useCallback(async (skillId: string, name: string, content: string) => {
    if (!ready) return
    try { await call('createSkill', { skillId, name, content }) } catch (e) { console.error('createSkill:', e) }
  }, [ready, call])

  const deleteSkill = useCallback(async (skillId: string) => {
    if (!ready) return
    try { await call('deleteSkill', { skillId }) } catch (e) { console.error('deleteSkill:', e) }
  }, [ready, call])

  const readSkillFile = useCallback(async (skillId: string, path: string) => {
    if (!ready) return ''
    try { const r = await call('readSkillFile', { skillId, path }); return r?.content || '' } catch (e) { return '' }
  }, [ready, call])

  const writeSkillFile = useCallback(async (skillId: string, path: string, content: string) => {
    if (!ready) return
    try { await call('writeSkillFile', { skillId, path, content }) } catch (e) { console.error('writeSkillFile:', e) }
  }, [ready, call])

  // ── Tools ──
  const listTools = useCallback(async () => {
    if (!ready) return []
    try { const r = await call('listTools', {}); return r?.tools || [] } catch (e) { return [] }
  }, [ready, call])

  const getCommands = useCallback(async () => {
    if (!ready) return []
    try { const r = await call('getCommands', {}); return r?.commands || [] } catch (e) { return [] }
  }, [ready, call])

  // ── Providers ──
  const setProvidersConfig = useCallback(async (config: any) => {
    if (!ready) return
    try { await call('setProvidersConfig', config) } catch (e) { console.error('setProvidersConfig:', e) }
  }, [ready, call])

  const fetchProviderModels = useCallback(async (providerName: string, baseUrl: string, apiKey: string) => {
    if (!ready) return []
    try { return await call('fetchProviderModels', { providerName, baseUrl, apiKey }) } catch (e) { console.error('fetchProviderModels:', e); return [] }
  }, [ready, call])

  const testProviderConnection = useCallback(async (providerName: string, baseUrl: string, apiKey: string) => {
    if (!ready) return { success: false, error: 'Not connected' }
    try { return await call('testProviderConnection', { providerName, baseUrl, apiKey }) } catch (e) { return { success: false, error: String(e) } }
  }, [ready, call])

  const storeApiKey = useCallback(async (service: string, key: string) => {
    if (!ready) return
    try { await call('storeApiKey', { service, key }) } catch (e) { console.error('storeApiKey:', e) }
  }, [ready, call])

  const deleteApiKey = useCallback(async (service: string) => {
    if (!ready) return
    try { await call('deleteApiKey', { service }) } catch (e) { console.error('deleteApiKey:', e) }
  }, [ready, call])

  const hasApiKey = useCallback(async (service: string) => {
    if (!ready) return false
    try { const r = await call('hasApiKey', { service }); return r?.hasKey || false } catch (e) { return false }
  }, [ready, call])

  const renameProvider = useCallback(async (oldName: string, newName: string) => {
    if (!ready) return
    try { await call('renameProvider', { oldName, newName }) } catch (e) { console.error('renameProvider:', e) }
  }, [ready, call])

  // ── Context / models ──
  const getModelContext = useCallback(async (modelId: string) => {
    if (!ready) return null
    try { return await call('getModelContext', { modelId }) } catch (e) { return null }
  }, [ready, call])

  const getContextUsage = useCallback(async (sessionKey: string) => {
    if (!ready) return null
    try { return await call('getContextUsage', { sessionKey }) } catch (e) { return null }
  }, [ready, call])

  const getAllContextUsage = useCallback(async () => {
    if (!ready) return {}
    try { return await call('getAllContextUsage', {}) } catch (e) { return {} }
  }, [ready, call])

  // ── History / errors ──
  const getChatErrors = useCallback(async (sessionKey: string) => {
    if (!ready) return []
    try { const r = await call('getChatErrors', { sessionKey }); return r?.errors || [] } catch (e) { return [] }
  }, [ready, call])

  const getDelegations = useCallback(async (sessionKey: string) => {
    if (!ready) return []
    try { const r = await call('getDelegations', { sessionKey }); return r?.delegations || [] } catch (e) { return [] }
  }, [ready, call])

  const getSystemPrompt = useCallback(async (agentId: string) => {
    if (!ready) return ''
    try { const r = await call('getSystemPrompt', { agentId }); return r?.prompt || '' } catch (e) { return '' }
  }, [ready, call])

  const getStreamingStatus = useCallback(async (sessionKey: string) => {
    if (!ready) return false
    try { const r = await call('getStreamingStatus', { sessionKey }); return r?.streaming || false } catch (e) { return false }
  }, [ready, call])

  const getStreamingMessage = useCallback(async (sessionKey: string) => {
    if (!ready) return null
    try { return await call('getStreamingMessage', { sessionKey }) } catch (e) { return null }
  }, [ready, call])

  const refreshProviders = useCallback(async () => {
    try {
      const [providersResult, modelsResult] = await Promise.all([
        call('getProvidersConfig', {}), call('getModels', {})
      ])
      if (providersResult?.providers) {
        const providerList: any[] = []
        const modelsByProvider: Record<string, any[]> = {}
        if (modelsResult?.models) {
          for (const m of modelsResult.models) {
            const p = m.provider || 'unknown'
            if (!modelsByProvider[p]) modelsByProvider[p] = []
            modelsByProvider[p].push({ id: m.id, name: m.name || m.id, contextWindow: m.contextWindow })
          }
        }
        for (const [id, p] of Object.entries(providersResult.providers) as [string, any][]) {
          providerList.push({
            id, name: id, type: p.api || 'ollama',
            apiKeyStatus: id.toLowerCase() === 'ollama' ? 'local' : (p.apiKey && p.apiKey !== '••••••••' && !p.apiKey.startsWith('•')) || p.apiKeySet ? 'configured' : 'missing',
            models: modelsByProvider[id] || [], enabled: p.enabled !== false, enabledModels: p.enabledModels || [],
            baseUrl: p.baseUrl || '',
          })
        }
        setProviders(providerList)
      }
    } catch {}
  }, [call])

  const refreshAgents = useCallback(async () => {
    try {
      const r = await call('listAgents', {})
      if (r?.agents) {
        const agentsWithFiles = await Promise.all(r.agents.map(async (a: any) => {
          let files: any[] = []
          try {
            const filesResult = await call('listAgentFiles', { id: a.id })
            if (filesResult?.files) files = filesResult.files.map((f: any) => f.name || f.path || f)
          } catch {}
          return {
            id: a.id, name: a.name, files,
            description: (a.prompt || '').split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 140),
            model: a.model || '', thinking: a.thinking || 'off', skills: (a.skills || []).map((s: string) => ({ name: s, source: 'local', installed: true })),
            tools: (a.tools || []).map((t: string) => ({ name: t, enabled: true })), directory: a.directory || '', isDeletable: a.id !== 'orchestrator',
          }
        }))
        setAgents(agentsWithFiles)
      }
    } catch {}
  }, [call])

  // ── Settings / config ──
  const getSettings = useCallback(async () => {
    if (!ready) return {}
    try { return await call('getSettings', {}) } catch (e) { return {} }
  }, [ready, call])

  const saveSettings = useCallback(async (settings: any) => {
    if (!ready) return
    try { await call('saveSettings', settings) } catch (e) { console.error('saveSettings:', e) }
  }, [ready, call])

  const getGlobalConfig = useCallback(async () => {
    if (!ready) return {}
    try { return await call('getGlobalConfig', {}) } catch (e) { return {} }
  }, [ready, call])

  const updateGlobalConfig = useCallback(async (config: any) => {
    if (!ready) return
    try { await call('updateGlobalConfig', config) } catch (e) { console.error('updateGlobalConfig:', e) }
  }, [ready, call])

  const checkForPiUpdate = useCallback(async () => {
    if (!ready) return null
    try { return await call('checkForPiUpdate', {}) } catch (e) { return null }
  }, [ready, call])

  // ── Logs ──
  const clearLogs = useCallback(async () => {
    if (!ready) return
    try { await call('clearDebugLogFile', {}) } catch (e) { console.error('clearLogs:', e) }
  }, [ready, call])

  const loadLogs = useCallback(async () => {
    if (!ready) return []
    try { const r = await call('getFullDebugLog', {}); return r?.log || [] } catch (e) { return [] }
  }, [ready, call])

  // ── Attachments ──
  const saveAttachments = useCallback((sessionKey: string, attachments: any[]) => {
    if (!ready) return
    notify('saveAttachments', { sessionKey, attachments })
  }, [ready, notify])

  const loadAttachments = useCallback(async (sessionKey: string) => {
    if (!ready) return {}
    try { return await call('loadAttachments', { sessionKey }) } catch (e) { return {} }
  }, [ready, call])

  // ── Steer ──
  const steer = useCallback((sessionKey: string, text: string) => {
    if (!ready) return
    notify('steer', { sessionKey, text })
  }, [ready, notify])
  // Merge sessions + folders into one list for sidebar (memoized — no flash on re-render)
  const sidebarSessions = useMemo(() => {
    const chats = sessions.filter(s => s.id !== '__quinki_expert__')
    const folderItems = (folders || []).map(f => ({
      id: f.id, title: f.title || f.name || 'Folder', type: 'folder' as const,
      isExpanded: !!f.isExpanded, parentId: f.parentId || null, order: f.order || Date.now(),
    }))
    return [...chats, ...folderItems].sort((a, b) => (b.order || 0) - (a.order || 0))
  }, [sessions, folders])

  return {
    // State
    connected: ready, loading, sessions, agents, providers, messages, folders, models, isCompacting,
    activeSessionId, isStreaming, statusLabel, statusKind, contextTokens, contextWindow,
    thinkingLevels, agentStatus, compactingSessions, sessionTokens, debugLog, piConfigNeeded,
    chatAgentIds, agentOverrides,
    // Sidebar
    sidebarSessions,
    // Session management
    selectSession, sendMessage, stopStreaming, createSession, deleteSession, renameSession, deselectSession,
    resetSession, reloadSession, moveSession, compactSession, ensureSession,
    // Session settings
    setChatAgents, setModel, setThinkingLevel, setMode, setSessionCompaction, setWorkingDir,
    // Folders
    updateFolders,
    // Agent management
    createAgent, updateAgent, deleteAgent, setAgent, setAgentOverride, getAgentOverrides,
    readAgentFile, writeAgentFile, createAgentFile,
    // Skills
    listSkills, installSkill, createSkill, deleteSkill, readSkillFile, writeSkillFile,
    // Tools
    listTools, getCommands,
    // Providers
    setProvidersConfig, fetchProviderModels, testProviderConnection, storeApiKey,
    deleteApiKey, hasApiKey, renameProvider, refreshProviders, refreshAgents,
    // Context / models
    getModelContext, getContextUsage, getAllContextUsage,
    // History / errors
    getChatErrors, getDelegations, getSystemPrompt, getStreamingStatus, getStreamingMessage,
    // Settings / config
    getSettings, saveSettings, getGlobalConfig, updateGlobalConfig, checkForPiUpdate,
    // Logs
    clearLogs, loadLogs,
    // Attachments
    saveAttachments, loadAttachments,
    // Other
    steer, call, notify,
  }
}

export { useSidecarData }