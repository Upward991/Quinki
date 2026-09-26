// Sidecar WebSocket client.
// The CLI speaks the SAME JSON-RPC protocol as the app frontend: chats run in
// the real Quinki runtime (agents, skills, delegation, custom tools) and stay
// in sync with the app in real time — instead of a bare SDK session.
export class Sc {
  ws: any = null;
  connected = false;
  #url: string;
  #nextId = 1;
  #pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  #events: Array<(method: string, params: any) => void> = [];

  constructor(url: string) {
    this.#url = url;
  }

  connect(timeoutMs = 900): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      try {
        const ws = new WebSocket(this.#url);
        this.ws = ws;
        const to = setTimeout(() => {
          try {
            ws.close();
          } catch {}
          finish(false);
        }, timeoutMs);
        ws.onopen = () => {
          clearTimeout(to);
          this.connected = true;
          finish(true);
        };
        ws.onerror = () => {
          clearTimeout(to);
          finish(false);
        };
        ws.onclose = () => {
          this.connected = false;
        };
        ws.onmessage = (ev: any) => {
          let msg: any;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (msg && msg.id !== undefined) {
            const p = this.#pending.get(msg.id);
            if (p) {
              this.#pending.delete(msg.id);
              if (msg.error) p.reject(msg.error);
              else p.resolve(msg.result);
            }
            return;
          }
          if (msg && msg.method) {
            for (const h of this.#events) {
              try {
                h(msg.method, msg.params);
              } catch {}
            }
          }
        };
      } catch {
        finish(false);
      }
    });
  }

  onEvent(cb: (method: string, params: any) => void) {
    this.#events.push(cb);
  }

  call(method: string, params: any = {}, timeoutMs = 120000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        reject(new Error("sidecar not connected"));
        return;
      }
      const id = ++this.#nextId;
      this.#pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
      } catch (e) {
        this.#pending.delete(id);
        reject(e);
        return;
      }
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error("timeout: " + method));
        }
      }, timeoutMs);
    });
  }
}
