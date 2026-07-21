import { useState, useRef, useEffect, useCallback } from 'react'
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from 'react/jsx-runtime'

export function useSidecar(url = "ws://127.0.0.1:9182") {
	const wsRef = (0, useRef)(null);
	const [ready, setReady] = (0, useState)(false);
	const [error, setError] = (0, useState)(null);
	const pendingRef = (0, useRef)(/* @__PURE__ */ new Map());
	const handlersRef = (0, useRef)(/* @__PURE__ */ new Map());
	let nextId = 1;
	(0, useEffect)(() => {
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
				if (!closed) setTimeout(connect, 2e3);
			};
		};
		connect();
		return () => {
			closed = true;
			wsRef.current?.close();
		};
	}, [url]);
	return {
		call: (0, useCallback)((method, params = {}) => {
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
				}, 3e4);
			});
		}, []),
		notify: (0, useCallback)((method, params = {}) => {
			if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({
				jsonrpc: "2.0",
				method,
				params
			}));
		}, []),
		ready,
		error,
		subscribe: (0, useCallback)((method, handler) => {
			if (!handlersRef.current.has(method)) handlersRef.current.set(method, /* @__PURE__ */ new Set());
			handlersRef.current.get(method).add(handler);
			return () => {
				handlersRef.current.get(method)?.delete(handler);
			};
		}, [])
	};
}

