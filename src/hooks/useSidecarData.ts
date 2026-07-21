import { useState, useEffect, useCallback } from 'react'
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from 'react/jsx-runtime'
import { Settings } from '../components/icons'
import { useSidecar } from './useSidecar'

export function useSidecarData(sidecarUrl = "ws://127.0.0.1:9182") {
	const { call, notify, ready, subscribe } = ug(sidecarUrl);
	const [loading, setLoading] = (0, useState)(true);
	const [sessions, setSessions] = (0, useState)([]);
	const [agents, setAgents] = (0, useState)([]);
	const [providers, setProviders] = (0, useState)([]);
	const [messages, setMessages] = (0, useState)([]);
	const [activeSessionId, setActiveSessionId] = (0, useState)(null);
	const [isStreaming, setIsStreaming] = (0, useState)(false);
	const [statusLabel, setStatusLabel] = (0, useState)("");
	const [statusKind, setStatusKind] = (0, useState)("");
	const [contextTokens, setContextTokens] = (0, useState)(0);
	const [contextWindow, setContextWindow] = (0, useState)(1e6);
	(0, useEffect)(() => {
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
							isDeletable: a.id !== "orchestrator"
						};
					}));
					setAgents(agentsWithFiles);
				}
				try {
					const sessionsResult = await call("listSessions", {});
					if (!cancelled && sessionsResult?.sessions) setSessions(sessionsResult.sessions.map((s) => ({
						id: s.sessionKey || s.id || s.key,
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
							models: modelsByProvider[id] || [],
							enabled: p.enabled !== false
						});
						for (const [id, models] of Object.entries(modelsByProvider)) if (!providerList.find((p) => p.id === id)) providerList.push({
							id,
							name: id,
							type: "unknown",
							apiKeyStatus: "missing",
							models,
							enabled: true
						});
						setProviders(providerList);
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
	(0, useEffect)(() => {
		if (!ready) return;
		const unsubStream = subscribe("stream_event", (params) => {
			const { type, content, messageId } = params;
			if (type === "text" || type === "text_delta") {
				setMessages((prev) => {
					const last = prev[prev.length - 1];
					if (last && last.role === "assistant" && last.isStreaming) return [...prev.slice(0, -1), {
						...last,
						content: (last.content || "") + (content || "")
					}];
					return [...prev, {
						id: messageId || `msg-${Date.now()}`,
						role: "assistant",
						content: content || "",
						timestamp: (/* @__PURE__ */ new Date()).toISOString(),
						isStreaming: true
					}];
				});
				setStatusLabel("Writing");
				setStatusKind("writing");
			} else if (type === "thinking" || type === "thinking_delta") {
				setStatusLabel("Thinking");
				setStatusKind("thinking");
			} else if (type === "toolCall" || type === "toolcall_start") {
				setStatusLabel("Tool call");
				setStatusKind("tool_call");
			} else if (type === "toolResult" || type === "toolcall_end") {
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
				setMessages((prev) => prev.map((m) => m.isStreaming ? {
					...m,
					isStreaming: false
				} : m));
			}
		});
		const unsubContext = subscribe("context_update", (params) => {
			if (params.tokens !== void 0) setContextTokens(params.tokens);
			if (params.window !== void 0) setContextWindow(params.window);
		});
		const unsubCompaction = subscribe("compaction", () => {
			setStatusLabel("Compacting");
			setStatusKind("compacting");
		});
		const unsubSessionUpdate = subscribe("session_updated", (params) => {
			call("listSessions", {}).then((r) => {
				if (r?.sessions) setSessions(r.sessions.map((s) => ({
					id: s.sessionKey || s.id || s.key,
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
			unsubContext();
			unsubCompaction();
			unsubSessionUpdate();
		};
	}, [
		ready,
		subscribe,
		call
	]);
	return {
		connected: ready,
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
		selectSession: (0, useCallback)(async (sessionKey) => {
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
		sendMessage: (0, useCallback)(async (text, sessionKey, agents) => {
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
					if (createResult?.sessionKey) {
						sk = createResult.sessionKey;
						setActiveSessionId(sk);
						try {
							const sessionsResult = await call("listSessions", {});
							if (sessionsResult?.sessions) setSessions(sessionsResult.sessions.map((s) => ({
								id: s.sessionKey || s.id || s.key,
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
					agents: agents || []
				});
				if (result?.sessionKey && !activeSessionId) setActiveSessionId(result.sessionKey);
				try {
					const sessionsResult = await call("listSessions", {});
					if (sessionsResult?.sessions) setSessions(sessionsResult.sessions.map((s) => ({
						id: s.sessionKey || s.id || s.key,
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
		stopStreaming: (0, useCallback)(() => {
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
		setChatAgents: (0, useCallback)(async (sessionKey, agentIds) => {
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
		setModel: (0, useCallback)(async (sessionKey, model) => {
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
		setThinkingLevel: (0, useCallback)(async (sessionKey, level) => {
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
		deleteSession: (0, useCallback)(async (sessionKey) => {
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
		renameSession: (0, useCallback)(async (sessionKey, title) => {
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
		setProvidersConfig: (0, useCallback)(async (config) => {
			if (!ready) return;
			try {
				await call("setProvidersConfig", config);
			} catch (e) {
				console.error("setProvidersConfig:", e);
			}
		}, [ready, call]),
		fetchProviderModels: (0, useCallback)(async (providerName, baseUrl, apiKey) => {
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
		testProviderConnection: (0, useCallback)(async (providerName, baseUrl, apiKey) => {
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
		storeApiKey: (0, useCallback)(async (service, key) => {
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
		clearLogs: (0, useCallback)(async () => {
			if (!ready) return;
			try {
				await call("clearDebugLogFile", {});
			} catch (e) {
				console.error("clearLogs:", e);
			}
		}, [ready, call]),
		loadLogs: (0, useCallback)(async () => {
			if (!ready) return [];
			try {
				return (await call("getFullDebugLog", {}))?.log || [];
			} catch (e) {
				return [];
			}
		}, [ready, call])
	};
}
