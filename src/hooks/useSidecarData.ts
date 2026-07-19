// ============================================================
// useSidecarData — High-level hook that loads real data from sidecar
// NO mock data — starts empty, fills when sidecar connects
// ============================================================

import { useEffect, useState, useCallback, useRef } from "react";
import { useSidecar } from "./useSidecar";
import type { Session, Agent, Provider, Message, ThinkingBlock, ToolCall, ToolResult, DelegationBlock } from "../types";

// ── Helpers: map sidecar flat messages → app Message format ──

function mapHistoryMessages(raw: any[]): Message[] {
  const result: Message[] = [];
  let current: Partial<Message> & { thinking?: ThinkingBlock[]; toolCalls?: ToolCall[]; toolResults?: ToolResult[]; delegations?: DelegationBlock[]; content?: string } = {};
  let hasBlocks = false;

  const flush = () => {
    if (hasBlocks || current.content || current.id) {
      result.push({
        id: current.id || `msg-${Date.now()}-${Math.random()}`,
        role: current.role || "assistant",
        content: current.content || "",
        timestamp: current.timestamp || new Date().toISOString(),
        thinking: current.thinking?.length ? current.thinking : undefined,
        toolCalls: current.toolCalls?.length ? current.toolCalls : undefined,
        toolResults: current.toolResults?.length ? current.toolResults : undefined,
        delegations: current.delegations?.length ? current.delegations : undefined,
        compaction: current.compaction?.length ? current.compaction : undefined,
        agentName: current.agentName,
        agentModel: current.agentModel,
        thinkingLevel: current.thinkingLevel,
        isError: current.isError,
        errorType: current.errorType,
        errorContent: current.errorContent,
        isCompacted: current.isCompacted,
        tokensIn: current.tokensIn,
        tokensOut: current.tokensOut,
      } as Message);
    }
    current = {};
    hasBlocks = false;
  };

  for (const m of raw) {
    if (m.role === "user" || m.role === "system") {
      flush();
      result.push({
        id: m.id || `msg-${Date.now()}-${Math.random()}`,
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : m.timestamp,
        tokensIn: m.tokensIn,
      });
      continue;
    }

    if (m.isCompactionSummary || m.isCompactionWarning) {
      flush();
      result.push({
        id: m.id || `comp-${Date.now()}`,
        role: "assistant",
        content: "",
        timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : m.timestamp,
        compaction: [{ content: m.content || "", isNoop: !!m.isCompactionWarning }],
      });
      continue;
    }

    if (m.role === "tool_call") {
      if (!hasBlocks) {
        current = { id: m.id, role: "assistant" as const, timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : m.timestamp, thinking: [], toolCalls: [], toolResults: [], delegations: [] };
        hasBlocks = true;
      }
      if (m.reasoning) current.thinking!.push({ level: current.thinkingLevel || "on", content: m.reasoning });
      current.toolCalls!.push({ name: m.toolName || "tool", input: typeof m.toolArgs === "string" ? m.toolArgs : JSON.stringify(m.toolArgs || "") });
      continue;
    }

    if (m.role === "tool_result") {
      if (!hasBlocks) {
        current = { id: m.id, role: "assistant" as const, timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : m.timestamp, thinking: [], toolCalls: [], toolResults: [], delegations: [] };
        hasBlocks = true;
      }
      current.toolResults!.push({ name: m.toolName || "tool", output: typeof m.content === "string" ? m.content : JSON.stringify(m.content), isError: !!m.isError });
      continue;
    }

    // Assistant text message
    if (m.role === "assistant" || m.role === undefined) {
      // If we have accumulated blocks and this is a text message, merge
      if (hasBlocks && m.content) {
        current.content = (current.content || "") + (typeof m.content === "string" ? m.content : "");
        current.agentName = m.agentName || current.agentName;
        current.agentModel = m.model || current.agentModel;
        current.thinkingLevel = m.thinkingLevel || current.thinkingLevel;
        if (m.reasoning && !current.thinking?.length) {
          current.thinking = [{ level: m.thinkingLevel || "on", content: m.reasoning }];
        }
        continue;
      }
      // Standalone assistant message
      flush();
      const msg: Message = {
        id: m.id || `msg-${Date.now()}-${Math.random()}`,
        role: "assistant",
        content: typeof m.content === "string" ? m.content : "",
        timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : m.timestamp,
        agentName: m.agentName,
        agentModel: m.model,
        thinkingLevel: m.thinkingLevel,
        isError: !!m.isError,
        errorContent: m.errorMessage || (m.isError ? (typeof m.content === "string" ? m.content : "") : undefined),
        tokensOut: m.tokensOut,
      };
      if (m.reasoning) msg.thinking = [{ level: m.thinkingLevel || "on", content: m.reasoning }];
      result.push(msg);
      continue;
    }

    // Fallback
    flush();
    result.push({
      id: m.id || `msg-${Date.now()}-${Math.random()}`,
      role: "assistant",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""),
      timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : m.timestamp,
    });
  }

  flush();
  return result;
}

export function useSidecarData(sidecarUrl: string = "ws://127.0.0.1:9182") {
  const { call, notify, ready, subscribe } = useSidecar(sidecarUrl);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusLabel, setStatusLabel] = useState("");
  const [statusKind, setStatusKind] = useState("");
  const [contextTokens, setContextTokens] = useState(0);
  const [contextWindow, setContextWindow] = useState(1000000);
  const [logs, setLogs] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs for streaming state
  const streamingMsgRef = useRef<Partial<Message> & { thinking?: ThinkingBlock[]; toolCalls?: ToolCall[]; toolResults?: ToolResult[]; delegations?: DelegationBlock[]; content?: string }>({});
  const hasBlocksRef = useRef(false);
  const activeSessionRef = useRef<string | null>(null);
  const streamingSessionRef = useRef<string | null>(null);

  // Keep ref in sync
  useEffect(() => { activeSessionRef.current = activeSessionId; }, [activeSessionId]);

  // ── Load initial data when connected ──
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const loadData = async () => {
      try {
        // Load full state (sessions + models)
        const stateResult = await call("getFullState", {});
        if (cancelled) return;

        // Parse sessions
        if (stateResult?.sessions) {
          const mappedSessions: Session[] = stateResult.sessions.map((s: any) => ({
            id: s.key || s.id,
            title: s.label || "Untitled",
            type: "chat" as const,
            updatedAt: new Date(s.lastActivity || s.order || Date.now()).toISOString(),
            messageCount: s.messageCount || 0,
            agents: s.agentId ? [s.agentId] : [],
          }));
          if (!cancelled) setSessions(mappedSessions);
        }

        // Parse models into providers
        if (stateResult?.models) {
          const modelsByProvider: Record<string, any[]> = {};
          for (const m of stateResult.models) {
            const p = m.provider || "unknown";
            if (!modelsByProvider[p]) modelsByProvider[p] = [];
            modelsByProvider[p].push({ id: m.id, name: m.name || m.id, contextWindow: m.contextWindow });
          }

          // Load providers config
          let providerList: Provider[] = [];
          try {
            const providersResult = await call("getProvidersConfig", {});
            if (providersResult?.providers) {
              for (const [id, p] of Object.entries(providersResult.providers) as [string, any]) {
                providerList.push({
                  id, name: id,
                  type: p.api || "ollama",
                  apiKeyStatus: (p.apiKey || p.apiKeySet) ? "configured" : "missing",
                  models: modelsByProvider[id] || [],
                  enabled: p.enabled !== false,
                });
                delete modelsByProvider[id];
              }
            }
          } catch {}

          // Add providers only from models (not in config)
          for (const [id, models] of Object.entries(modelsByProvider)) {
            providerList.push({ id, name: id, type: "unknown", apiKeyStatus: "missing", models, enabled: true });
          }
          if (!cancelled) setProviders(providerList);
        }

        // Load agents
        try {
          const agentsResult = await call("listAgents", {});
          if (!cancelled && agentsResult?.agents) {
            const agentsWithFiles = await Promise.all(agentsResult.agents.map(async (a: any) => {
              let files: string[] = [];
              try {
                const filesResult = await call("listAgentFiles", { id: a.id });
                if (filesResult?.files) {
                  files = filesResult.files.map((f: any) => f.name || f.path || f).filter((n: string) => n !== "config.json");
                }
              } catch {}
              return {
                id: a.id,
                name: a.name || a.id,
                systemPrompt: a.prompt || a.systemPrompt || "",
                model: a.model || "",
                thinking: a.thinking || "off",
                skills: (a.skills || []).map((s: string) => ({ name: s, source: "local", installed: true })),
                tools: (a.tools || []).map((t: string) => ({ name: t, enabled: true })),
                files,
                isDeletable: a.id !== "orchestrator" && a.id !== "quinki-expert",
              } as Agent;
            }));
            setAgents(agentsWithFiles);
          }
        } catch {}

        // Load folders
        try {
          const foldersResult = await call("getFolders", {});
          if (!cancelled && foldersResult?.folders) {
            setFolders(foldersResult.folders);
          }
        } catch {}

        // Load app version
        try {
          const versionResult = await call("getAppVersion", {});
          if (!cancelled && versionResult?.version) {
            (window as any).__quinkiVersion = versionResult.version;
          }
        } catch {}

        if (!cancelled) setLoading(false);
      } catch (e: any) {
        console.error("[useSidecarData] Failed to load data:", e);
        setError(e?.message || String(e));
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    return () => { cancelled = true; };
  }, [ready, call]);

  // ── Subscribe to notifications ──
  useEffect(() => {
    if (!ready) return;

    const unsubReady = subscribe("ready", () => {
      console.log("[useSidecarData] Sidecar ready");
    });

    // ── Stream events: accumulate into streaming message ──
    const unsubStream = subscribe("stream_event", (params: any) => {
      const { eventType, delta, toolName, sessionKey, messageId } = params;
      // Only process if this is for our active session
      if (sessionKey && streamingSessionRef.current && sessionKey !== streamingSessionRef.current) return;

      const sm = streamingMsgRef.current;

      switch (eventType) {
        case "thinking_start":
          setStatusLabel("Thinking");
          setStatusKind("thinking");
          if (!sm.thinking) sm.thinking = [];
          break;
        case "thinking_delta":
          setStatusLabel("Thinking");
          setStatusKind("thinking");
          if (!sm.thinking) sm.thinking = [];
          if (sm.thinking.length === 0) sm.thinking.push({ level: "on", content: delta || "" });
          else sm.thinking[0].content = (sm.thinking[0].content || "") + (delta || "");
          updateStreamingMessage();
          break;
        case "thinking_end":
          break;
        case "text_start":
          setStatusLabel("Writing");
          setStatusKind("writing");
          if (!hasBlocksRef.current) {
            streamingMsgRef.current = { id: messageId, role: "assistant", content: "", thinking: sm.thinking, toolCalls: [], toolResults: [], delegations: [] };
            hasBlocksRef.current = true;
          }
          break;
        case "text_delta":
          setStatusLabel("Writing");
          setStatusKind("writing");
          if (!hasBlocksRef.current) {
            streamingMsgRef.current = { id: messageId, role: "assistant", content: "", thinking: sm.thinking, toolCalls: [], toolResults: [], delegations: [] };
            hasBlocksRef.current = true;
          }
          streamingMsgRef.current.content = (streamingMsgRef.current.content || "") + (delta || "");
          updateStreamingMessage();
          break;
        case "text_end":
          break;
        case "toolcall_start":
          setStatusLabel("Tool call");
          setStatusKind("tool_call");
          if (!hasBlocksRef.current) {
            streamingMsgRef.current = { id: messageId, role: "assistant", content: "", thinking: [], toolCalls: [], toolResults: [], delegations: [] };
            hasBlocksRef.current = true;
          }
          streamingMsgRef.current.toolCalls!.push({ name: toolName || "tool", input: "" });
          updateStreamingMessage();
          break;
        case "toolcall_delta":
          if (streamingMsgRef.current.toolCalls && streamingMsgRef.current.toolCalls.length > 0) {
            streamingMsgRef.current.toolCalls[streamingMsgRef.current.toolCalls.length - 1].input += delta || "";
            updateStreamingMessage();
          }
          break;
        case "toolcall_end":
          setStatusLabel("Tool result");
          setStatusKind("tool_result");
          // The delta in toolcall_end is the result text
          if (streamingMsgRef.current.toolResults) {
            streamingMsgRef.current.toolResults.push({ name: toolName || "tool", output: delta || "", isError: !!params.isError });
          }
          updateStreamingMessage();
          break;
        case "delegation_start":
          setStatusLabel("Delegating");
          setStatusKind("delegation");
          if (!hasBlocksRef.current) {
            streamingMsgRef.current = { id: messageId, role: "assistant", content: "", thinking: [], toolCalls: [], toolResults: [], delegations: [] };
            hasBlocksRef.current = true;
          }
          streamingMsgRef.current.delegations!.push({
            agentName: params.agentName || "",
            agentModel: "",
            mode: "build",
            tools: [],
            systemPrompt: "",
            taskContent: params.task || "",
            response: "",
          });
          updateStreamingMessage();
          break;
        case "delegation_end":
          if (streamingMsgRef.current.delegations && streamingMsgRef.current.delegations.length > 0) {
            const d = streamingMsgRef.current.delegations[streamingMsgRef.current.delegations.length - 1];
            d.response = params.response || "";
            d.agentModel = params.model || "";
            d.thinkingLevel = params.thinkingLevel;
          }
          updateStreamingMessage();
          break;
        case "error":
          setStatusLabel("Failed");
          setStatusKind("failed");
          setIsStreaming(false);
          streamingSessionRef.current = null;
          // Add error message
          setMessages(prev => [...prev, {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString(),
            isError: true,
            errorType: "generic",
            errorContent: delta || params.message || "An error occurred",
          }]);
          break;
      }
    });

    // ── Done notification: finalize streaming message ──
    const unsubDone = subscribe("done", (params: any) => {
      const { sessionKey, model, agentName, thinkingLevel, errorMessage } = params;
      if (sessionKey && streamingSessionRef.current && sessionKey !== streamingSessionRef.current) return;

      setIsStreaming(false);
      setStatusLabel("");
      setStatusKind("");
      streamingSessionRef.current = null;

      // Finalize the streaming message
      const sm = streamingMsgRef.current;
      if (hasBlocksRef.current || sm.content || (sm.toolCalls && sm.toolCalls.length) || (sm.thinking && sm.thinking.length)) {
        const finalMsg: Message = {
          id: sm.id || `msg-${Date.now()}`,
          role: "assistant",
          content: sm.content || "",
          timestamp: new Date().toISOString(),
          thinking: sm.thinking?.length ? sm.thinking : undefined,
          toolCalls: sm.toolCalls?.length ? sm.toolCalls : undefined,
          toolResults: sm.toolResults?.length ? sm.toolResults : undefined,
          delegations: sm.delegations?.length ? sm.delegations : undefined,
          agentName: agentName || sm.agentName,
          agentModel: model || sm.agentModel,
          thinkingLevel: thinkingLevel || sm.thinkingLevel,
          isError: !!errorMessage,
          errorContent: errorMessage,
        };
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming) {
            return [...prev.slice(0, -1), finalMsg];
          }
          return [...prev, finalMsg];
        });
      }

      // Reset streaming state
      streamingMsgRef.current = {};
      hasBlocksRef.current = false;

      // Reload sessions to get updated title/lastMessage
      refreshSessions();
    });

    // ── Context usage updates ──
    const unsubContext = subscribe("context_usage", (params: any) => {
      if (params.usage) {
        setContextTokens(params.usage.tokens || params.usage.used || 0);
        setContextWindow(params.usage.window || params.usage.total || 1000000);
      } else {
        if (params.tokens !== undefined) setContextTokens(params.tokens);
        if (params.window !== undefined) setContextWindow(params.window);
      }
    });

    // ── Compaction ──
    const unsubCompaction = subscribe("compaction", () => {
      setStatusLabel("Compacting");
      setStatusKind("compacting");
    });

    // ── Session updated (title/label change) ──
    const unsubSessionUpdate = subscribe("session_updated", (params: any) => {
      if (params.sessionKey || params.key) {
        const key = params.sessionKey || params.key;
        setSessions(prev => prev.map(s => s.id === key ? { ...s, title: params.label || s.title, updatedAt: new Date().toISOString() } : s));
      }
      refreshSessions();
    });

    // ── Debug log entries ──
    const unsubDebugLog = subscribe("debug_log", (params: any) => {
      if (params.log) {
        setLogs(prev => [...prev, ...params.log].slice(-500));
      }
    });

    // ── Full state update (sessions list) ──
    const unsubFullState = subscribe("full_state", (params: any) => {
      if (params.sessions) {
        setSessions(params.sessions.map((s: any) => ({
          id: s.key || s.id,
          title: s.label || "Untitled",
          type: "chat" as const,
          updatedAt: new Date(s.lastActivity || s.order || Date.now()).toISOString(),
          messageCount: s.messageCount || 0,
          agents: s.agentId ? [s.agentId] : [],
        })));
      }
    });

    return () => {
      unsubReady();
      unsubStream();
      unsubDone();
      unsubContext();
      unsubCompaction();
      unsubSessionUpdate();
      unsubDebugLog();
      unsubFullState();
    };
  }, [ready, subscribe]);

  // ── Update streaming message in state ──
  const updateStreamingMessage = useCallback(() => {
    const sm = streamingMsgRef.current;
    const msg: Message = {
      id: sm.id || `streaming-${Date.now()}`,
      role: "assistant",
      content: sm.content || "",
      timestamp: new Date().toISOString(),
      thinking: sm.thinking?.length ? sm.thinking : undefined,
      toolCalls: sm.toolCalls?.length ? sm.toolCalls : undefined,
      toolResults: sm.toolResults?.length ? sm.toolResults : undefined,
      delegations: sm.delegations?.length ? sm.delegations : undefined,
      isStreaming: true,
    };
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.isStreaming) {
        return [...prev.slice(0, -1), msg];
      }
      return [...prev, msg];
    });
  }, []);

  // ── Refresh sessions list ──
  const refreshSessions = useCallback(async () => {
    if (!ready) return;
    try {
      const state = await call("getFullState", {});
      if (state?.sessions) {
        setSessions(state.sessions.map((s: any) => ({
          id: s.key || s.id,
          title: s.label || "Untitled",
          type: "chat" as const,
          updatedAt: new Date(s.lastActivity || s.order || Date.now()).toISOString(),
          messageCount: s.messageCount || 0,
          agents: s.agentId ? [s.agentId] : [],
        })));
      }
    } catch {}
  }, [ready, call]);

  // ── Select session: load history ──
  const selectSession = useCallback(async (sessionKey: string) => {
    if (!ready) return;
    setActiveSessionId(sessionKey);
    activeSessionRef.current = sessionKey;
    setMessages([]);
    setContextTokens(0);

    try {
      const history = await call("getHistory", { sessionKey });
      if (history?.messages) {
        setMessages(mapHistoryMessages(history.messages));
      }

      try {
        const ctx = await call("getContextUsage", { sessionKey });
        if (ctx?.usage) {
          setContextTokens(ctx.usage.tokens || ctx.usage.used || 0);
          setContextWindow(ctx.usage.window || ctx.usage.total || 1000000);
        }
      } catch {}
    } catch (e) {
      console.error("[useSidecarData] Failed to load session:", e);
    }
  }, [ready, call]);

  // ── Create new session ──
  const createSession = useCallback(async (label?: string): Promise<string | null> => {
    if (!ready) return null;
    try {
      const result = await call("createSession", { label: label || "New chat" });
      if (result?.key) {
        const newSession: Session = {
          id: result.key,
          title: result.label || "New chat",
          type: "chat",
          updatedAt: new Date().toISOString(),
          messageCount: 0,
        };
        setSessions(prev => [newSession, ...prev]);
        return result.key;
      }
    } catch (e) {
      console.error("[useSidecarData] Failed to create session:", e);
    }
    return null;
  }, [ready, call]);

  // ── Delete session ──
  const deleteSession = useCallback(async (sessionKey: string) => {
    if (!ready) return;
    try {
      await call("deleteSession", { sessionKey });
      setSessions(prev => prev.filter(s => s.id !== sessionKey));
      if (activeSessionId === sessionKey) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error("[useSidecarData] Failed to delete session:", e);
    }
  }, [ready, call, activeSessionId]);

  // ── Rename session ──
  const renameSession = useCallback(async (sessionKey: string, label: string) => {
    if (!ready) return;
    try {
      await call("renameSession", { sessionKey, label });
      setSessions(prev => prev.map(s => s.id === sessionKey ? { ...s, title: label } : s));
    } catch (e) {
      console.error("[useSidecarData] Failed to rename session:", e);
    }
  }, [ready, call]);

  // ── Reset session ──
  const resetSession = useCallback(async (sessionKey: string) => {
    if (!ready) return;
    try {
      await call("resetSession", { sessionKey });
      setMessages([]);
      setContextTokens(0);
    } catch (e) {
      console.error("[useSidecarData] Failed to reset session:", e);
    }
  }, [ready, call]);

  // ── Send message ──
  const sendMessage = useCallback(async (text: string, options?: { sessionKey?: string; agentId?: string; model?: string; thinkingLevel?: string; workingDirs?: string[] }) => {
    if (!ready) return;

    let sessionKey: string = options?.sessionKey || activeSessionRef.current || "";

    // If no session, create one (welcome mode)
    if (!sessionKey || sessionKey === "welcome") {
      const newKey = await createSession("New chat");
      if (!newKey) return;
      sessionKey = newKey;
      setActiveSessionId(sessionKey);
      activeSessionRef.current = sessionKey;
    }

    // Add user message
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      tokensIn: Math.ceil(text.length / 4),
    };
    setMessages(prev => [...prev, userMsg]);

    // Set up streaming state
    setIsStreaming(true);
    setStatusLabel("Thinking");
    setStatusKind("thinking");
    streamingSessionRef.current = sessionKey;
    streamingMsgRef.current = { role: "assistant", content: "", thinking: [], toolCalls: [], toolResults: [], delegations: [] };
    hasBlocksRef.current = false;

    try {
      await call("sendMessage", {
        sessionKey,
        text,
        agentId: options?.agentId,
        model: options?.model,
        thinkingLevel: options?.thinkingLevel,
        workingDirs: options?.workingDirs,
      });
    } catch (e: any) {
      console.error("[useSidecarData] Failed to send message:", e);
      setIsStreaming(false);
      setStatusLabel("Failed");
      setStatusKind("failed");
      streamingSessionRef.current = null;
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        isError: true,
        errorType: "generic",
        errorContent: e?.message || "Failed to send message",
      }]);
    }
  }, [ready, call, createSession]);

  // ── Stop streaming ──
  const stopStreaming = useCallback(() => {
    if (!ready || !activeSessionRef.current) return;
    notify("abort", { sessionKey: activeSessionRef.current });
    setIsStreaming(false);
    setStatusLabel("");
    setStatusKind("");
    streamingSessionRef.current = null;
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
    streamingMsgRef.current = {};
    hasBlocksRef.current = false;
  }, [ready, notify]);

  // ── Set model ──
  const setModel = useCallback(async (model: string, sessionKey?: string) => {
    if (!ready) return;
    const sk = sessionKey || activeSessionRef.current;
    if (!sk) return;
    try { await call("setModel", { sessionKey: sk, model }); } catch {}
  }, [ready, call]);

  // ── Set thinking level ──
  const setThinkingLevel = useCallback(async (level: string, sessionKey?: string) => {
    if (!ready) return;
    const sk = sessionKey || activeSessionRef.current;
    if (!sk) return;
    try { await call("setThinking", { sessionKey: sk, thinkingLevel: level }); } catch {}
  }, [ready, call]);

  // ── Set working directory ──
  const setWorkingDir = useCallback(async (path: string, sessionKey?: string) => {
    if (!ready) return;
    const sk = sessionKey || activeSessionRef.current;
    if (!sk) return;
    try { await call("setWorkingDir", { sessionKey: sk, path }); } catch {}
  }, [ready, call]);

  // ── Set mode ──
  const setMode = useCallback(async (mode: string, sessionKey?: string) => {
    if (!ready) return;
    const sk = sessionKey || activeSessionRef.current;
    if (!sk) return;
    try { await call("setMode", { sessionKey: sk, mode }); } catch {}
  }, [ready, call]);

  // ── Compact session ──
  const compactSession = useCallback(async (sessionKey?: string) => {
    if (!ready) return;
    const sk = sessionKey || activeSessionRef.current;
    if (!sk) return;
    try { await call("compactSession", { sessionKey: sk }); } catch {}
  }, [ready, call]);

  // ── Ensure session exists (for expert) ──
  const ensureSession = useCallback(async (sessionKey: string, label?: string) => {
    if (!ready) return;
    try { await call("ensureSession", { sessionKey, label: label || "Expert" }); } catch {}
  }, [ready, call]);

  // ── Set chat agents ──
  const setChatAgents = useCallback(async (agentIds: string[], sessionKey?: string) => {
    if (!ready) return;
    const sk = sessionKey || activeSessionRef.current;
    if (!sk) return;
    try { await call("setChatAgents", { sessionKey: sk, agentIds: agentIds.join(",") }); } catch {}
  }, [ready, call]);

  // ── Save folders ──
  const saveFolders = useCallback(async (newFolders: any[]) => {
    if (!ready) return;
    try { await call("setFolders", { folders: newFolders }); setFolders(newFolders); } catch {}
  }, [ready, call]);

  // ── Load full debug log ──
  const loadFullLog = useCallback(async () => {
    if (!ready) return;
    try {
      const result = await call("getFullDebugLog", {});
      if (result?.log) setLogs(result.log.slice(-500));
    } catch {}
  }, [ready, call]);

  // ── Clear debug log ──
  const clearLog = useCallback(async () => {
    if (!ready) return;
    try { await call("clearDebugLogFile", {}); setLogs([]); } catch {}
  }, [ready, call]);

  return {
    connected: ready,
    error,
    loading,
    sessions,
    agents,
    providers,
    messages,
    activeSessionId,
    isStreaming,
    statusLabel,
    statusKind,
    contextTokens,
    contextWindow,
    logs,
    folders,
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    resetSession,
    sendMessage,
    stopStreaming,
    setModel,
    setThinkingLevel,
    setWorkingDir,
    setMode,
    compactSession,
    ensureSession,
    setChatAgents,
    saveFolders,
    refreshSessions,
    loadFullLog,
    clearLog,
    call,
    notify,
  };
}