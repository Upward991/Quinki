import React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Settings } from '../components/icons'
import { useSidecar } from './useSidecar'

export function useSidecarData(sidecarUrl = "ws://127.0.0.1:9182") {
	const { call, notify, ready, subscribe } = useSidecar(sidecarUrl);
	const [loading, setLoading] = useState(true);
	const [sessions, setSessions] = useState([]);
	const [agents, setAgents] = useState([]);
	const [providers, setProviders] = useState([]);
	const [messages, setMessages] = useState([]);
	const [activeSessionId, setActiveSessionId] = useState(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const [statusLabel, setStatusLabel] = useState("");
	const [statusKind, setStatusKind] = useState("");
	const [contextTokens, setContextTokens] = useState(0);
	const [contextWindow, setContextWindow] = useState(1e6);
	useEffect(() => {
		if (!ready) return;
		let cancelled = false;
		const loadData = async () => {
			try {
				const agentsResult = await call("listAgents", {});
				if (!cancelled && agentsResult?.agents) {
					const agentsWithFiles = await Promise.all(agentsResult.agents.map(async (a) => {
						let files = [];
						try {
							const filesResult = await call("listAgentFiles", { id: a.id });
							if (filesResult?.files) files = filesResult.files.map((f) => f.name || f.path || f);
						} catch {}
						return {
							id: a.id,
							name: a.name,
							systemPrompt: a.prompt || "",
							model: a.model || "",
							thinking: a.thinking || "off",
							skills: (a.skills || []).map((s) => ({
								name: s,
								source: "local",
								installed: true
							})),
							tools: (a.tools || []).map((t) => ({
								name: t,
								enabled: true
							})),
							files,
							isDeletable: a.id !== "orchestrator" && a.id !== "quinki-expert"
						};
					}));
					setAgents(agentsWithFiles);
				}
				try {
					const sessionsResult = await call("listSessions", {});
					if (!cancelled && sessionsResult?.sessions) setSessions(sessionsResult.sessions.map((s) => ({
						id: s.key || s.sessionKey || s.id,
						title: s.label || s.title || "Untitled",
						type: "chat",
						updatedAt: new Date(s.lastActivity || Date.now()).toISOString(),
						messageCount: s.messageCount || 0,
						agents: s.agents || []
					})));
				} catch {}
				try {
					const [providersResult, modelsResult] = await Promise.all([call("getProvidersConfig", {}), call("getModels", {})]);
					if (!cancelled) {
						const modelsByProvider = {};
						if (modelsResult?.models) for (const m of modelsResult.models) {
							const p = m.provider || "unknown";
							if (!modelsByProvider[p]) modelsByProvider[p] = [];
							modelsByProvider[p].push({
								id: m.id,
								name: m.name || m.id,
								contextWindow: m.contextWindow
							});
						}
						const providerList = [];
						if (providersResult?.providers) for (const [id, p] of Object.entries(providersResult.providers)) providerList.push({
							id,
							name: id,
							type: p.api || "ollama",
							apiKeyStatus: p.apiKey || p.apiKeySet ? "configured" : "missing",
							baseUrl: p.baseUrl || "",
							models: modelsByProvider[id] || [],
							enabled: p.enabled !== false,
							enabledModels: p.enabledModels || []
						});
						// Auto-fetch models for enabled providers with no models loaded yet
						for (const provider of providerList) {
							if (provider.models.length === 0 && provider.enabled) {
								try {
									const fetched = await call("fetchProviderModels", {
										providerName: provider.id,
										baseUrl: provider.baseUrl || "",
										apiKey: ""
									});
									if (fetched?.models && !cancelled) {
										provider.models = fetched.models.map((m) => ({
											id: m.id || m.name || m,
											name: m.name || m.id || m,
											contextWindow: m.contextWindow || (m.details && m.details.context_length) || 0
										}));
									}
								} catch (e) { console.error("Auto-fetch models failed for", provider.id, e); }
							}
						}
						for (const [id, models] of Object.entries(modelsByProvider)) if (!providerList.find((p) => p.id === id)) providerList.push({
							id,
							name: id,
							type: "unknown",
							apiKeyStatus: "missing",
							models,
							enabled: true
						});
						if (!cancelled) setProviders([...providerList]);
					}
				} catch {}
				setLoading(false);
			} catch (e) {
				setLoading(false);
			}
		};
		loadData();
		return () => {
			cancelled = true;
		};
	}, [ready, call]);
	useEffect(() => {
		if (!ready) return;
		// === Stream events: content (text/thinking/toolcall) ===
		const unsubStream = subscribe("stream_event", (params) => {
			const { eventType, delta, messageId } = params;
			const isDelegation = (messageId || "").startsWith("del-");
			// Skip non-delegation toolcall events (handled separately)
			if (eventType.startsWith("toolcall") && !isDelegation) return;
			if (eventType === "delegation_start") {
				setStatusLabel("Delegating"); setStatusKind("delegation");
				return;
			}
			if (eventType === "delegation_end") {
				setStatusLabel("Running"); setStatusKind("running");
				return;
			}
			if (eventType === "text_delta" || eventType === "text_start") {
				setMessages((prev) => {
					const last = prev[prev.length - 1];
					if (last && last.role === "assistant" && last.isStreaming) {
						return [...prev.slice(0, -1), { ...last, content: (last.content || "") + (delta || "") }];
					}
					return [...prev, { id: messageId || `msg-${Date.now()}`, role: "assistant", content: delta || "", timestamp: new Date().toISOString(), isStreaming: true }];
				});
			} else if (eventType === "toolcall_start") {
				setMessages((prev) => {
					const last = prev[prev.length - 1];
					if (last && last.role === "assistant" && last.isStreaming) {
						const toolCalls = last.toolCalls || [];
						toolCalls.push({ name: delta || "tool", input: "" });
						return [...prev.slice(0, -1), { ...last, toolCalls }];
					}
					return [...prev, { id: messageId || `msg-${Date.now()}`, role: "assistant", content: "", toolCalls: [{ name: delta || "tool", input: "" }], timestamp: new Date().toISOString(), isStreaming: true }];
				});
			} else if (eventType === "toolcall_delta") {
				setMessages((prev) => {
					const last = prev[prev.length - 1];
					if (last && last.role === "assistant" && last.isStreaming && last.toolCalls && last.toolCalls.length > 0) {
						const toolCalls = [...last.toolCalls];
						toolCalls[toolCalls.length - 1] = { ...toolCalls[toolCalls.length - 1], input: (toolCalls[toolCalls.length - 1].input || "") + (delta || "") };
						return [...prev.slice(0, -1), { ...last, toolCalls }];
					}
					return prev;
				});
			} else if (eventType === "toolcall_end") {
				setMessages((prev) => {
					const last = prev[prev.length - 1];
					if (last && last.role === "assistant" && last.isStreaming) {
						const toolResults = last.toolResults || [];
						toolResults.push({ name: last.toolCalls?.[last.toolCalls.length - 1]?.name || "tool", output: delta || "", isError: params.isError || false });
						return [...prev.slice(0, -1), { ...last, toolResults }];
					}
					return prev;
				});
			}
			if (eventType === "thinking_delta" || eventType === "thinking_start") {
				setMessages((prev) => {
					const last = prev[prev.length - 1];
					if (last && last.role === "assistant" && last.isStreaming) {
						return [...prev.slice(0, -1), { ...last, thinking: (last.thinking || "") + (delta || "") }];
					}
					return [...prev, { id: messageId || `msg-${Date.now()}`, role: "assistant", content: "", thinking: delta || "", timestamp: new Date().toISOString(), isStreaming: true }];
				});
			}
		});
		// === Tool call/result (separate notifications, not stream_event) ===
		const unsubToolCall = subscribe("tool_call", (params) => {
			setStatusLabel("Tool call"); setStatusKind("tool_call");
			setMessages((prev) => {
				const last = prev[prev.length - 1];
				if (last && last.role === "assistant" && last.isStreaming) {
					const toolCalls = last.toolCalls || [];
					toolCalls.push({ name: params.toolName || "tool", input: params.toolArgs || "" });
					return [...prev.slice(0, -1), { ...last, toolCalls }];
				}
				return [...prev, { id: `msg-${Date.now()}`, role: "assistant", content: "", toolCalls: [{ name: params.toolName || "tool", input: params.toolArgs || "" }], timestamp: new Date().toISOString(), isStreaming: true }];
			});
		});
		const unsubToolResult = subscribe("tool_result", (params) => {
			setStatusLabel("Tool result"); setStatusKind("tool_result");
			setMessages((prev) => {
				const last = prev[prev.length - 1];
				if (last && last.role === "assistant" && last.isStreaming) {
					const toolResults = last.toolResults || [];
					toolResults.push({ name: params.toolName || "tool", output: params.output || "", isError: params.isError || false });
					return [...prev.slice(0, -1), { ...last, toolResults }];
				}
				return prev;
			});
		});
		// === Agent status: drives the status pill ===
		const unsubAgentStatus = subscribe("agent_status", (params) => {
			const status = params.status;
			if (status === "thinking") { setStatusLabel("Thinking"); setStatusKind("thinking"); }
			else if (status === "writing") { setStatusLabel("Writing"); setStatusKind("writing"); }
			else if (status === "tool") { setStatusLabel("Tool call"); setStatusKind("tool_call"); }
			else if (status === "retrying") { setStatusLabel(`Retrying ${params.attempt || 1}/${params.maxAttempts || 3}`); setStatusKind("retrying"); }
			else if (status === "idle") { setStatusLabel(""); setStatusKind(""); }
			else if (status) { setStatusLabel(status.charAt(0).toUpperCase() + status.slice(1)); setStatusKind(status); }
		});
		// === Streaming started/stopped ===
		const unsubStreamStart = subscribe("streaming_started", () => {
			setIsStreaming(true);
		});
		const unsubStreamStop = subscribe("streaming_stopped", () => {
			setIsStreaming(false);
			setStatusLabel(""); setStatusKind("");
			setMessages((prev) => prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m));
		});
		// === Done: finalize message with model/agent info ===
		const unsubDone = subscribe("done", (params) => {
			setIsStreaming(false);
			setStatusLabel(""); setStatusKind("");
			const { messageId, text, model, agentName, thinkingLevel, stopReason, errorMessage } = params;
			if (stopReason === "error") {
				setMessages((prev) => prev.map((m) =>
					m.isStreaming ? { ...m, isStreaming: false, isError: true, errorContent: errorMessage || "Unknown error", content: "" } : m
				));
			} else {
				setMessages((prev) => prev.map((m) =>
					m.isStreaming ? { ...m, isStreaming: false, model, agentName, thinkingLevel, content: text || m.content } : m
				));
			}
		});
		// === Context usage ===
		const unsubContext = subscribe("context_usage", (params) => {
			const u = params.usage || params;
			if (u && u.tokens !== void 0) setContextTokens(u.tokens);
			if (u && u.window !== void 0) setContextWindow(u.window);
		});
		// === Compaction ===
		const unsubCompaction = subscribe("compaction_status", () => {
			setStatusLabel("Compacting"); setStatusKind("compacting");
		});
		// === Session events ===
		const unsubSessionCreated = subscribe("session_created", () => {
			call("listSessions", {}).then((r) => {
				if (r?.sessions) setSessions(r.sessions.map((s) => ({
					id: s.key || s.sessionKey || s.id,
					title: s.label || s.title || "Untitled",
					type: "chat",
					updatedAt: new Date(s.lastActivity || Date.now()).toISOString(),
					messageCount: s.messageCount || 0,
					agents: s.agents || []
				})));
			}).catch(() => {});
		});
		const unsubSessionUpdate = subscribe("session_updated", () => {
			call("listSessions", {}).then((r) => {
				if (r?.sessions) setSessions(r.sessions.map((s) => ({
					id: s.key || s.sessionKey || s.id,
					title: s.label || s.title || "Untitled",
					type: "chat",
					updatedAt: new Date(s.lastActivity || Date.now()).toISOString(),
					messageCount: s.messageCount || 0,
					agents: s.agents || []
				})));
			}).catch(() => {});
		});
		subscribe("debug_log", (params) => {
			if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("quinki-log", { detail: params }));
		});
		return () => {
			unsubStream();
			unsubToolCall();
			unsubToolResult();
			unsubAgentStatus();
			unsubStreamStart();
			unsubStreamStop();
			unsubDone();
			unsubContext();
			unsubCompaction();
			unsubSessionCreated();
			unsubSessionUpdate();
		};
	}, [
		ready,
		subscribe,
		call
	]);
	const refreshProviders = useCallback(async () => {
		if (!ready) return;
		try {
			const [providersResult, modelsResult] = await Promise.all([call("getProvidersConfig", {}), call("getModels", {})]);
			const modelsByProvider = {};
			if (modelsResult?.models) for (const m of modelsResult.models) {
				const p = m.provider || "unknown";
				if (!modelsByProvider[p]) modelsByProvider[p] = [];
				modelsByProvider[p].push({ id: m.id, name: m.name || m.id, contextWindow: m.contextWindow });
			}
			const providerList = [];
			if (providersResult?.providers) for (const [id, p] of Object.entries(providersResult.providers)) providerList.push({
				id, name: id, type: p.api || "ollama",
				apiKeyStatus: p.apiKey || p.apiKeySet ? "configured" : "missing",
				baseUrl: p.baseUrl || "",
				models: modelsByProvider[id] || [],
				enabled: p.enabled !== false,
				enabledModels: p.enabledModels || []
			});
			for (const provider of providerList) {
				if (provider.models.length === 0 && provider.enabled) {
					try {
						const fetched = await call("fetchProviderModels", { providerName: provider.id, baseUrl: provider.baseUrl || "", apiKey: "" });
						if (fetched?.models) provider.models = fetched.models.map((m) => ({ id: m.id || m.name || m, name: m.name || m.id || m, contextWindow: m.contextWindow || (m.details && m.details.context_length) || 0 }));
					} catch {}
				}
			}
			setProviders([...providerList]);
		} catch (e) { console.error("refreshProviders:", e); }
	}, [ready, call]);

	const refreshAgents = useCallback(async () => {
		if (!ready) return;
		try {
			const agentsResult = await call("listAgents", {});
			if (agentsResult?.agents) {
				const agentsWithFiles = await Promise.all(agentsResult.agents.map(async (a) => {
					let files = [];
					try {
						const filesResult = await call("listAgentFiles", { id: a.id });
						if (filesResult?.files) files = filesResult.files.map((f) => f.name || f.path || f);
					} catch {}
					return {
						id: a.id,
						name: a.name,
						systemPrompt: a.prompt || "",
						model: a.model || "",
						thinking: a.thinking || "off",
						skills: (a.skills || []).map((s) => ({ name: s, source: "local", installed: true })),
						tools: (a.tools || []).map((t) => ({ name: t, enabled: true })),
						files,
						isDeletable: a.id !== "orchestrator" && a.id !== "quinki-expert"
					};
				}));
				setAgents(agentsWithFiles);
			}
		} catch (e) { console.error("refreshAgents:", e); }
	}, [ready, call]);

	return {
		connected: ready,
		loading,
		sessions,
		refreshProviders,
		refreshAgents,
		agents,
		providers,
		messages,
		activeSessionId,
		isStreaming,
		statusLabel,
		statusKind,
		contextTokens,
		contextWindow,
		selectSession: useCallback(async (sessionKey) => {
			if (!ready) return;
			setActiveSessionId(sessionKey);
			setMessages([]);
			setIsStreaming(false);
			setStatusLabel("");
			setStatusKind("");
			try {
				const history = await call("getHistory", { sessionKey });
				if (history?.messages) setMessages(history.messages.map((m) => ({
					id: m.id || `msg-${Math.random()}`,
					role: m.role,
					content: m.content || "",
					timestamp: m.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
					thinking: m.thinking,
					toolCalls: m.toolCalls,
					toolResults: m.toolResults,
					agentName: m.agentName,
					agentModel: m.agentModel,
					tokensIn: m.tokensIn,
					tokensOut: m.tokensOut,
					isCompacted: m.isCompacted,
					isError: m.isError,
					errorType: m.errorType,
					errorContent: m.errorContent
				})));
				try {
					const ctx = await call("getContextUsage", { sessionKey });
					if (ctx) {
						setContextTokens(ctx.tokens || 0);
						setContextWindow(ctx.window || 1e6);
					}
				} catch {}
			} catch (e) {
				console.error("Failed to load session:", e);
			}
		}, [ready, call]),
		sendMessage: useCallback(async (text, sessionKey, agents) => {
			if (!ready) return;
			if (!providers.some((p) => p.models && p.models.length > 0)) {
				setMessages((prev) => [
					...prev,
					{
						id: `msg-${Date.now()}`,
						role: "user",
						content: text,
						timestamp: (/* @__PURE__ */ new Date()).toISOString(),
						tokensIn: Math.ceil(text.length / 4)
					},
					{
						id: `err-${Date.now()}`,
						role: "assistant",
						content: "No model configured. Add a provider in Settings first.",
						timestamp: (/* @__PURE__ */ new Date()).toISOString(),
						isError: true
					}
				]);
				return;
			}
			const userMsg = {
				id: `msg-${Date.now()}`,
				role: "user",
				content: text,
				timestamp: (/* @__PURE__ */ new Date()).toISOString(),
				tokensIn: Math.ceil(text.length / 4)
			};
			setMessages((prev) => [...prev, userMsg]);
			setIsStreaming(true);
			setStatusLabel("Thinking");
			setStatusKind("thinking");
			try {
				let sk = sessionKey || activeSessionId || "";
				if (!sk) try {
					const createResult = await call("createSession", { label: "New chat" });
					if (createResult?.key || createResult?.sessionKey) {
						sk = createResult.key || createResult.sessionKey;
						setActiveSessionId(sk);
						try {
							const sessionsResult = await call("listSessions", {});
							if (sessionsResult?.sessions) setSessions(sessionsResult.sessions.map((s) => ({
								id: s.key || s.sessionKey || s.id,
								title: s.label || s.title || "Untitled",
								type: "chat",
								updatedAt: new Date(s.lastActivity || Date.now()).toISOString(),
								messageCount: s.messageCount || 0,
								agents: s.agents || []
							})));
						} catch {}
					}
				} catch (e) {
					console.error("Failed to create session:", e);
					setIsStreaming(false);
					setStatusLabel("Failed");
					setStatusKind("failed");
					return;
				}
				const result = await call("sendMessage", {
					sessionKey: sk,
					text,
					agentId: (agents && agents.length > 0) ? agents[0] : undefined
				});
				if (result?.sessionKey && !activeSessionId) setActiveSessionId(result.sessionKey);
				try {
					const sessionsResult = await call("listSessions", {});
					if (sessionsResult?.sessions) setSessions(sessionsResult.sessions.map((s) => ({
						id: s.key || s.sessionKey || s.id,
						title: s.label || s.title || "Untitled",
						type: "chat",
						updatedAt: new Date(s.lastActivity || Date.now()).toISOString(),
						messageCount: s.messageCount || 0,
						agents: s.agents || []
					})));
				} catch {}
			} catch (e) {
				console.error("Failed to send message:", e);
				setIsStreaming(false);
				setStatusLabel("Failed");
				setStatusKind("failed");
			}
		}, [
			ready,
			call,
			activeSessionId,
			providers
		]),
		stopStreaming: useCallback(() => {
			if (!ready) return;
			notify("stopStream", { sessionKey: activeSessionId });
			setIsStreaming(false);
			setStatusLabel("");
			setStatusKind("");
			setMessages((prev) => prev.map((m) => m.isStreaming ? {
				...m,
				isStreaming: false
			} : m));
		}, [
			ready,
			notify,
			activeSessionId
		]),
		call,
		notify,
		setChatAgents: useCallback(async (sessionKey, agentIds) => {
			if (!ready) return;
			try {
				await call("setChatAgents", {
					sessionKey,
					agents: agentIds
				});
			} catch (e) {
				console.error("setChatAgents:", e);
			}
		}, [ready, call]),
		setModel: useCallback(async (sessionKey, model) => {
			if (!ready) return;
			try {
				await call("setModel", {
					sessionKey,
					model
				});
			} catch (e) {
				console.error("setModel:", e);
			}
		}, [ready, call]),
		setThinkingLevel: useCallback(async (sessionKey, level) => {
			if (!ready) return;
			try {
				await call("setThinkingLevel", {
					sessionKey,
					thinkingLevel: level
				});
			} catch (e) {
				console.error("setThinkingLevel:", e);
			}
		}, [ready, call]),
		deleteSession: useCallback(async (sessionKey) => {
			if (!ready) return;
			try {
				await call("deleteSession", { sessionKey });
				setSessions((prev) => prev.filter((s) => s.id !== sessionKey));
				if (activeSessionId === sessionKey) {
					setActiveSessionId(null);
					setMessages([]);
				}
			} catch (e) {
				console.error("deleteSession:", e);
			}
		}, [
			ready,
			call,
			activeSessionId
		]),
		renameSession: useCallback(async (sessionKey, title) => {
			if (!ready) return;
			try {
				await call("renameSession", {
					sessionKey,
					label: title
				});
				setSessions((prev) => prev.map((s) => s.id === sessionKey ? {
					...s,
					title
				} : s));
			} catch (e) {
				console.error("renameSession:", e);
			}
		}, [ready, call]),
		setProvidersConfig: useCallback(async (config) => {
			if (!ready) return;
			try {
				await call("setProvidersConfig", config);
			} catch (e) {
				console.error("setProvidersConfig:", e);
			}
		}, [ready, call]),
		fetchProviderModels: useCallback(async (providerName, baseUrl, apiKey) => {
			if (!ready) return [];
			try {
				return await call("fetchProviderModels", {
					providerName,
					baseUrl,
					apiKey
				});
			} catch (e) {
				console.error("fetchProviderModels:", e);
				return [];
			}
		}, [ready, call]),
		testProviderConnection: useCallback(async (providerName, baseUrl, apiKey) => {
			if (!ready) return {
				success: false,
				error: "Not connected"
			};
			try {
				return await call("testProviderConnection", {
					providerName,
					baseUrl,
					apiKey
				});
			} catch (e) {
				return {
					success: false,
					error: String(e)
				};
			}
		}, [ready, call]),
		storeApiKey: useCallback(async (service, key) => {
			if (!ready) return;
			try {
				await call("storeApiKey", {
					service,
					key
				});
			} catch (e) {
				console.error("storeApiKey:", e);
			}
		}, [ready, call]),
		clearLogs: useCallback(async () => {
			if (!ready) return;
			try {
				await call("clearDebugLogFile", {});
			} catch (e) {
				console.error("clearLogs:", e);
			}
		}, [ready, call]),
		loadLogs: useCallback(async () => {
			if (!ready) return [];
			try {
				return (await call("getFullDebugLog", {}))?.log || [];
			} catch (e) {
				return [];
			}
		}, [ready, call])
	};
}
