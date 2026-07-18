// useSidecar.ts — React hook for WebSocket → JSON-RPC → sidecar
// Provides call(), notify(), and event subscriptions
//
// Usage:
//   const { call, notify, ready, events } = useSidecar('ws://127.0.0.1:9182')
//   const agents = await call('listAgents', {})

import { useEffect, useRef, useState, useCallback } from "react";


interface RPCNotification {
  jsonrpc: "2.0";
  method: string;
  params: any;
}

type MessageHandler = (data: any) => void;

let nextId = 1;

export function useSidecar(url: string = "ws://127.0.0.1:9182") {
  const wsRef = useRef<WebSocket | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>>(new Map());
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const [events, setEvents] = useState<RPCNotification[]>([]);

  // Connect
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setReady(true);
        setError(null);
      };

      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }

        // RPC response (has id)
        if (msg.id !== undefined) {
          const pending = pendingRef.current.get(msg.id);
          if (pending) {
            pendingRef.current.delete(msg.id);
            if (msg.error) pending.reject(msg.error);
            else pending.resolve(msg.result);
          }
        }

        // Notification (has method, no id)
        if (msg.method && msg.id === undefined) {
          // Notify subscribers
          const handlers = handlersRef.current.get(msg.method);
          if (handlers) {
            for (const h of handlers) h(msg.params);
          }
          // Also push to events array
          setEvents(prev => [...prev.slice(-99), msg]);
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
      };

      ws.onclose = () => {
        setReady(false);
        if (!closed) {
          // Reconnect after 2s
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [url]);

  // RPC call
  const call = useCallback((method: string, params: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const id = nextId++;
      pendingRef.current.set(id, { resolve, reject });
      wsRef.current.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
      
      // Timeout after 30s
      setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 30000);
    });
  }, []);

  // RPC notify (fire-and-forget)
  const notify = useCallback((method: string, params: any = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    }
  }, []);

  // Subscribe to notifications
  const subscribe = useCallback((method: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(method)) {
      handlersRef.current.set(method, new Set());
    }
    handlersRef.current.get(method)!.add(handler);
    return () => {
      handlersRef.current.get(method)?.delete(handler);
    };
  }, []);

  return { call, notify, ready, error, events, subscribe };
}
