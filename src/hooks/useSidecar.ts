import React from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'

export function useSidecar(url = "ws://127.0.0.1:9182") {
	const wsRef = useRef(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState(null);
	const pendingRef = useRef(/* @__PURE__ */ new Map());
	const handlersRef = useRef(/* @__PURE__ */ new Map());
	let nextId = Math.floor(Math.random() * 100000) + 1;
	useEffect(() => {
		let closed = false;
		const connect = () => {
			if (closed) return;
			const ws = new WebSocket(url);
			wsRef.current = ws;
			ws.onopen = () => {
				setReady(true);
				setError(null);
			};
			ws.onmessage = (ev) => {
				let msg;
				try {
					msg = JSON.parse(ev.data);
				} catch {
					return;
				}
				if (msg.id !== void 0) {
					const pending = pendingRef.current.get(msg.id);
					if (pending) {
						pendingRef.current.delete(msg.id);
						if (msg.error) pending.reject(msg.error);
						else pending.resolve(msg.result);
					}
				}
				if (msg.method && msg.id === void 0) {
					const handlers = handlersRef.current.get(msg.method);
					if (handlers) for (const h of handlers) h(msg.params);
				}
			};
			ws.onerror = () => {
				setError("WebSocket connection error");
			};
			ws.onclose = () => {
				setReady(false);
				if (!closed) setTimeout(connect, 300);
			};
		};
		connect();
		return () => {
			closed = true;
			wsRef.current?.close();
		};
	}, [url]);
	return {
		call: useCallback((method, params = {}, timeoutMs = 3e4) => {
			return new Promise((resolve, reject) => {
				if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
					reject(/* @__PURE__ */ new Error("Not connected"));
					return;
				}
				const id = nextId++;
				pendingRef.current.set(id, {
					resolve,
					reject
				});
				wsRef.current.send(JSON.stringify({
					jsonrpc: "2.0",
					method,
					params,
					id
				}));
				setTimeout(() => {
					if (pendingRef.current.has(id)) {
						pendingRef.current.delete(id);
						reject(/* @__PURE__ */ new Error("Timeout: " + method));
					}
				}, timeoutMs);
			});
		}, []),
		notify: useCallback((method, params = {}) => {
			if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({
				jsonrpc: "2.0",
				method,
				params
			}));
		}, []),
		ready,
		error,
		subscribe: useCallback((method, handler) => {
			if (!handlersRef.current.has(method)) handlersRef.current.set(method, /* @__PURE__ */ new Set());
			handlersRef.current.get(method).add(handler);
			return () => {
				handlersRef.current.get(method)?.delete(handler);
			};
		}, [])
	};
}

