// useSidecarData.ts — High-level hook that loads real data from sidecar
// NO mock data — starts empty, fills when sidecar connects

import { useEffect, useState, useCallback } from "react";
import { useSidecar } from "./useSidecar";
import type { Session, Agent, Provider, Message } from "../types";

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
  const [error] = useState<string | null>(null);

  // Load initial data when connected
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    console.log("[useSidecarData] Sidecar connected, loading data...");

    const loadData = async () => {
      try {
        // Load agents (with files)
        const agentsResult = await call("listAgents", {});
        if (!cancelled && agentsResult?.agents) {
          console.log("[useSidecarData] Got agents:", agentsResult.agents.map((a: any) => a.name));
          // Load files for each agent in parallel
          const agentsWithFiles = await Promise.all(agentsResult.agents.map(async (a: any) => {
            let files: string[] = [];
            try {
              const filesResult = await call("listAgentFiles", { id: a.id });
              if (filesResult?.files) {
                files = filesResult.files.map((f: any) => f.name || f.path || f);
              }
            } catch (e) { console.log("[useSidecarData] No files for", a.id); }
            return {
              id: a.id,
              name: a.name,
              systemPrompt: a.prompt || "",
              model: a.model || "",
              thinking: a.thinking || "off",
              skills: (a.skills || []).map((s: string) => ({ name: s, source: "local", installed: true })),
              tools: (a.tools || []).map((t: string) => ({ name: t, enabled: true })),
              files,
              isDeletable: a.id !== "orchestrator",
            };
          }));
          setAgents(agentsWithFiles);
        }

        // Load sessions
        try {
          const sessionsResult = await call("listSessions", {});
          if (!cancelled && sessionsResult?.sessions) {
            console.log("[useSidecarData] Got sessions:", sessionsResult.sessions.length);
            setSessions(sessionsResult.sessions.map((s: any) => ({
              id: s.sessionKey || s.id,
              title: s.title || "Untitled",
              type: "chat" as const,
              updatedAt: s.updatedAt || new Date().toISOString(),
              messageCount: s.messageCount || 0,
              agents: s.agents || [],
              unread: s.unread || false,
            })));
          }
        } catch (e) {
          console.log("[useSidecarData] No sessions loaded (might be empty)");
        }

        // Load providers + models
        try {
          const modelsResult = await call("getModels", {});
          const providersResult = await call("getProvidersConfig", {});
          
          // Group models by provider
          const modelsByProvider: Record<string, any[]> = {};
          if (modelsResult?.models) {
            for (const m of modelsResult.models) {
              const p = m.provider || "unknown";
              if (!modelsByProvider[p]) modelsByProvider[p] = [];
              modelsByProvider[p].push({
                id: m.id,
                name: m.name || m.id,
                contextWindow: m.contextWindow,
              });
            }
          }

          // Build provider list from providersConfig + models
          const providerList: any[] = [];
          
          // Add providers from config
          if (providersResult?.providers) {
            for (const [id, p] of Object.entries(providersResult.providers) as [string, any]) {
              providerList.push({
                id,
                name: id,
                type: p.api || "ollama",
                apiKeyStatus: p.apiKey || p.apiKeySet ? "configured" : "missing",
                models: modelsByProvider[id] || [],
                enabled: p.enabled !== false,
              });
              delete modelsByProvider[id];
            }
          }
          
          // Add any providers that only have models (not in config)
          for (const [id, models] of Object.entries(modelsByProvider)) {
            providerList.push({
              id,
              name: id,
              type: "unknown",
              apiKeyStatus: "missing",
              models,
              enabled: true,
            });
          }
          
          console.log("[useSidecarData] Got providers:", providerList.length, "with", providerList.reduce((sum: number, p: any) => sum + p.models.length, 0), "models");
          setProviders(providerList);
        } catch (e) {
          console.log("[useSidecarData] No providers loaded:", e);
        }

        setLoading(false);
        console.log("[useSidecarData] Data loaded successfully");
      } catch (e) {
        console.error("[useSidecarData] Failed to load data:", e);
        setLoading(false);
      }
    };

    loadData();
    return () => { cancelled = true; };
  }, [ready, call]);

  // Subscribe to stream events
  useEffect(() => {
    if (!ready) return;

    const unsubReady = subscribe("ready", () => {
      console.log("[useSidecarData] Sidecar ready notification");
    });

    const unsubStream = subscribe("stream_event", (params: any) => {
      const { type, content, messageId } = params;
      console.log("[useSidecarData] Stream event:", type);

      if (type === "text") {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, content: (last.content || "") + content }];
          }
          return [...prev, { id: messageId || `msg-${Date.now()}`, role: "assistant" as const, content, timestamp: new Date().toISOString(), isStreaming: true }];
        });
        setStatusLabel("Writing");
        setStatusKind("writing");
      } else if (type === "thinking") {
        setStatusLabel("Thinking");
        setStatusKind("thinking");
      } else if (type === "toolCall") {
        setStatusLabel("Tool call");
        setStatusKind("tool_call");
      } else if (type === "toolResult") {
        setStatusLabel("Tool result");
        setStatusKind("tool_result");
      } else if (type === "delegation_start") {
        setStatusLabel("Delegating");
        setStatusKind("delegation");
      } else if (type === "delegation_end") {
        setStatusLabel("Running");
        setStatusKind("running");
      } else if (type === "error") {
        setStatusLabel("Failed");
        setStatusKind("failed");
        setIsStreaming(false);
      } else if (type === "done" || type === "end") {
        setIsStreaming(false);
        setStatusLabel("");
        setStatusKind("");
        setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
      }
    });

    const unsubCompaction = subscribe("compaction", () => {
      setStatusLabel("Compacting");
      setStatusKind("compacting");
    });

    const unsubContext = subscribe("context_update", (params: any) => {
      if (params.tokens !== undefined) setContextTokens(params.tokens);
      if (params.window !== undefined) setContextWindow(params.window);
    });

    return () => {
      unsubReady();
      unsubStream();
      unsubCompaction();
      unsubContext();
    };
  }, [ready, subscribe]);

  // Select session
  const selectSession = useCallback(async (sessionKey: string) => {
    if (!ready) return;
    setActiveSessionId(sessionKey);
    setMessages([]);

    try {
      const history = await call("getHistory", { sessionKey });
      if (history?.messages) {
        setMessages(history.messages.map((m: any) => ({
          id: m.id || `msg-${Math.random()}`,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || new Date().toISOString(),
          thinking: m.thinking,
          toolCalls: m.toolCalls,
          toolResults: m.toolResults,
          agentName: m.agentName,
          tokensIn: m.tokensIn,
          tokensOut: m.tokensOut,
          isCompacted: m.isCompacted,
        })));
      }

      const ctx = await call("getContextUsage", { sessionKey });
      if (ctx) {
        setContextTokens(ctx.tokens || 0);
        setContextWindow(ctx.window || 1000000);
      }
    } catch (e) {
      console.error("[useSidecarData] Failed to load session:", e);
    }
  }, [ready, call]);

  // Send message
  const sendMessage = useCallback(async (text: string, sessionKey?: string, agents?: string[]) => {
    if (!ready) return;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      tokensIn: Math.ceil(text.length / 4),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setStatusLabel("Thinking");
    setStatusKind("thinking");

    try {
      const result = await call("sendMessage", {
        sessionKey: sessionKey || activeSessionId || "",
        text,
        agents: agents || [],
      });

      if (result?.sessionKey && !activeSessionId) {
        setActiveSessionId(result.sessionKey);
      }
    } catch (e) {
      console.error("[useSidecarData] Failed to send message:", e);
      setIsStreaming(false);
      setStatusLabel("Failed");
      setStatusKind("failed");
    }
  }, [ready, call, activeSessionId]);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    if (!ready) return;
    notify("stopStream", { sessionKey: activeSessionId });
    setIsStreaming(false);
    setStatusLabel("");
    setStatusKind("");
  }, [ready, notify, activeSessionId]);

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
    selectSession,
    sendMessage,
    stopStreaming,
    call,
    notify,
  };
}