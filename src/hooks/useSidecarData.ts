import { useState, useEffect, useRef, useCallback } from 'react'

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

    // Stream events — costruisce i toggle LIVE durante lo streaming (thinking/tool/delega appaiono in tempo reale)
    const ensureStreamingMsg = (prev: any[], messageId?: string) => {
      const last = prev[prev.length - 1]
      if (last && last.role === 'assistant' && last.isStreaming) return { arr: prev.slice(0, -1), msg: last }
      const msg = { id: messageId || `msg-${Date.now()}`, role: 'assistant' as const, content: '', timestamp: new Date().toISOString(), isStreaming: true }
      return { arr: prev, msg }
    }
    const unsubStream = subscribe('stream_event', (p: any) => {
      const { type, eventType, delta, content, messageId, toolName, isError } = p
      const _type = eventType || type
      const _content = delta || content || ''
      if (_type === 'text' || _type === 'text_delta' || _type === 'text_start') {
        setMessages(prev => {
          const { arr, msg } = ensureStreamingMsg(prev, messageId)
          return [...arr, { ...msg, content: (msg.content || '') + _content }]
        })
        setStatusLabel('Writing'); setStatusKind('writing')
      } else if (_type === 'thinking' || _type === 'thinking_delta' || _type === 'thinking_start') {
        setStatusLabel('Thinking'); setStatusKind('thinking')
        if (_content) {
          setMessages(prev => {
            const { arr, msg } = ensureStreamingMsg(prev, messageId)
            return [...arr, { ...msg, thinking: (msg.thinking || '') + _content }]
          })
        }
      } else if (_type === 'toolcall_start' || _type === 'tool_call') {
        setStatusLabel('Tool call'); setStatusKind('tool_call')
        setMessages(prev => {
          const { arr, msg } = ensureStreamingMsg(prev, messageId)
          const tcs = [...(msg.toolCalls || []), { name: toolName || delta || 'tool', input: '' }]
          return [...arr, { ...msg, toolCalls: tcs }]
        })
      } else if (_type === 'toolcall_delta') {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant' || !last.isStreaming || !last.toolCalls?.length) return prev
          const tcs = [...last.toolCalls]
          tcs[tcs.length - 1] = { ...tcs[tcs.length - 1], input: (tcs[tcs.length - 1].input || '') + _content }
          return [...prev.slice(0, -1), { ...last, toolCalls: tcs }]
        })
      } else if (_type === 'toolcall_end' || _type === 'tool_result') {
        setStatusLabel(isError ? 'Tool error' : 'Tool result'); setStatusKind(isError ? 'tool_error' : 'tool_result')
        setMessages(prev => {
          const { arr, msg } = ensureStreamingMsg(prev, messageId)
          const tcs = [...(msg.toolCalls || [])]
          const lastName = tcs.length > 0 ? tcs[tcs.length - 1].name : (toolName || 'tool')
          const trs = [...(msg.toolResults || []), { name: lastName, output: String(_content || ''), isError: !!isError }]
          return [...arr, { ...msg, toolResults: trs }]
        })
      } else if (_type === 'delegation_start') {
        setStatusLabel('Delegating'); setStatusKind('delegation')
      } else if (_type === 'delegation_end') {
        setStatusLabel('Running'); setStatusKind('running')
      } else if (_type === 'error') {
        setStatusLabel('Failed'); setStatusKind('failed'); setIsStreaming(false)
      } else if (_type === 'done' || _type === 'end') {
        setIsStreaming(false); setStatusLabel(''); setStatusKind('')
        setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m))
      }
    })

    // Streaming started/stopped
    const unsubStreamStart = subscribe('streaming_started', () => {
      setIsStreaming(true)
    })
    // Done event (sent as separate notification, not stream_event)
    const unsubDone = subscribe('done', (p: any) => {
      setIsStreaming(false); setStatusLabel(''); setStatusKind('')
      const { text, model, agentName, thinkingLevel, stopReason, errorMessage } = p || {}
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
            return prev.map(m => m.isStreaming ? { ...m, isStreaming: false, isError: true, content: errorMessage || 'Unknown error' } : m)
          }
          // Nessun messaggio in streaming (errore prima del primo delta) → aggiungi messaggio errore
          return [...prev, { id: `err-${Date.now()}`, role: 'assistant' as const, content: errorMessage || 'Unknown error', timestamp: new Date().toISOString(), isError: true, model, agentName }]
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

    // Agent status
    const unsubAgentStatus = subscribe('agent_status', (p: any) => {
      if (p?.sessionKey) setAgentStatus(p)
      // Status pill: traccia running. idle NON cancella: fra i turni tool il SDK emette idle a metà stream.
      // La pill si cancella solo con done / streaming_stopped / error.
      if (p?.status === 'running') { setStatusLabel('Running'); setStatusKind('running') }
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

    // History reload
    const unsubHistory = subscribe('history', (p: any) => {
      if (p?.sessionKey && p.sessionKey === activeSessionId && p.messages) {
        setMessages(p.messages.map((m: any) => ({
          id: m.id || `msg-${Math.random()}`,
          role: m.role,
          content: m.content || '',
          timestamp: m.timestamp || new Date().toISOString(),
          thinking: m.reasoning || m.thinking,
          toolCalls: m.toolCalls, toolResults: m.toolResults,
          agentName: m.agentName, agentModel: m.model, thinkingLevel: m.thinkingLevel,
          tokensIn: m.tokensIn, tokensOut: m.tokensOut,
          isCompacted: m.isCompacted, isError: m.isError,
        })))
      }
    })

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
      unsubStream(); unsubStreamStart(); unsubStreamStop(); unsubDone()
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
    setMessages([])
    setIsStreaming(false)
    setStatusLabel(''); setStatusKind('')
    try {
      const history = await call('getHistory', { sessionKey })
      if (history?.messages) {
        setMessages(history.messages.map((m: any) => ({
          id: m.id || `msg-${Math.random()}`,
          role: m.role,
          content: m.content || '',
          timestamp: m.timestamp || new Date().toISOString(),
          thinking: m.reasoning || m.thinking,
          toolCalls: m.toolCalls, toolResults: m.toolResults,
          agentName: m.agentName, agentModel: m.model, thinkingLevel: m.thinkingLevel,
          tokensIn: m.tokensIn, tokensOut: m.tokensOut,
          isCompacted: m.isCompacted, isError: m.isError,
          errorType: m.errorType, errorContent: m.errorContent,
        })))
      }
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
          setChatAgentIds(meta.agentId ? String(meta.agentId).split(',').filter(Boolean) : [])
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
    try { await call('resetSession', { sessionKey }) } catch (e) { console.error('resetSession:', e) }
  }, [ready, call])

  const reloadSession = useCallback(async (sessionKey: string) => {
    if (!ready) return
    try {
      notify('reloadSession', { sessionKey })
      const history = await call('getHistory', { sessionKey })
      if (history?.messages && sessionKey === activeSessionId) {
        setMessages(history.messages.map((m: any) => ({
          id: m.id || `msg-${Math.random()}`, role: m.role,
          content: m.content || '', timestamp: m.timestamp || new Date().toISOString(),
          thinking: m.reasoning, toolCalls: m.toolCalls, toolResults: m.toolResults,
          agentName: m.agentName, agentModel: m.model, thinkingLevel: m.thinkingLevel,
        })))
      }
    } catch (e) { console.error('reloadSession:', e) }
  }, [ready, call, notify, activeSessionId])

  const moveSession = useCallback((sessionKey: string, folderId: string | null, order: number) => {
    if (!ready) return
    notify('moveSession', { sessionKey, folderId, order })
  }, [ready, notify])

  const compactSession = useCallback(async (sessionKey: string) => {
    if (!ready) return
    try { await call('compactSession', { sessionKey }) } catch (e) { console.error('compactSession:', e) }
  }, [ready, call])

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

  return {
    // State
    connected: ready, loading, sessions, agents, providers, messages, folders, models,
    activeSessionId, isStreaming, statusLabel, statusKind, contextTokens, contextWindow,
    thinkingLevels, agentStatus, compactingSessions, sessionTokens, debugLog, piConfigNeeded,
    chatAgentIds, agentOverrides,
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
    deleteApiKey, hasApiKey, renameProvider,
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