// src/main/executor.ts — A2.1: esecuzione autonoma di task (fondamenta H24)
//
// Ogni task autonomo ("execution") vive su disco in ~/.quinki/executions/<id>/:
//   execution.json  → stato (status, owner, heartbeat, ecc.) — scrittura atomica
//   events.jsonl    → event log persistente (append-only)
// Il worker riusa TUTTA la meccanica delle chat di PiBridge (create/setChatAgents/
// setMode/setWorkingDir/send), guidando l'agente in modo "headless" con un ws finto.
// Niente stato importante in RAM: se il sidecar muore, al boot si classifica da disco (A2.3).
// Per A2.1: runTask / cancel / list / get / events + heartbeat + notifiche WS.

import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

const AGENT_DIR = process.env.QUINKI_AGENT_DIR || path.join(homedir(), ".quinki");
const EXEC_BASE = path.join(AGENT_DIR, "executions");

export interface ExecutionParams {
  label?: string;
  agentIds?: string | string[];
  workingDir?: string;
  mode?: string;
  model?: string;
  thinkingLevel?: string;
  text: string;
  owner?: "main" | "expert";
  scheduleId?: string;
  scheduledFor?: number;
}

export interface ExecutionState {
  id: string;
  label: string;
  owner: string;
  agentIds: string[];
  workingDir: string | null;
  mode: string | null;
  model: string | null;
  thinkingLevel: string | null;
  text: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  lastHeartbeat: number | null;
  progressNote: string | null;
  error: string | null;
  scheduleId: string | null;
  scheduledFor: number | null;
}

export class ExecutionEngine {
  #piBridge: any = null;
  onUpdate: ((payload: any) => void) | null = null;
  #runs = new Map<string, { timer: any; aborted: boolean }>();

  setPiBridge(pb: any) { this.#piBridge = pb; }

  #dir(id: string) { return path.join(EXEC_BASE, id); }
  #file(id: string) { return path.join(this.#dir(id), "execution.json"); }
  #eventsFile(id: string) { return path.join(this.#dir(id), "events.jsonl"); }

  #writeState(id: string, state: any) {
    try {
      const dir = this.#dir(id);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = this.#file(id) + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
      fs.renameSync(tmp, this.#file(id)); // atomico: niente execution.json parziale
    } catch (e: any) { this.#log("exec-write-error", { executionId: id, error: e?.message }); }
  }

  #appendEvent(id: string, type: string, data: any = {}) {
    try {
      const dir = this.#dir(id);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(this.#eventsFile(id), JSON.stringify({ ts: Date.now(), executionId: id, type, ...data }) + "\n", "utf8");
      this.#log("exec-event", { executionId: id, type, ...data });
    } catch (e: any) { this.#log("exec-event-write-error", { executionId: id, error: e?.message }); }
  }

  #log(tag: string, data: any) { try { this.#piBridge?.logDebug?.(tag, data); } catch {} }

  #notify(payload: any) { try { this.onUpdate?.(payload); } catch {} }

  list(): ExecutionState[] {
    const out: ExecutionState[] = [];
    try {
      if (!fs.existsSync(EXEC_BASE)) return out;
      for (const d of fs.readdirSync(EXEC_BASE)) {
        try {
          const p = path.join(EXEC_BASE, d, "execution.json");
          if (fs.existsSync(p)) out.push(JSON.parse(fs.readFileSync(p, "utf8")));
        } catch {}
      }
    } catch {}
    out.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
    return out;
  }

  get(id: string): ExecutionState | null {
    try {
      if (fs.existsSync(this.#file(id))) return JSON.parse(fs.readFileSync(this.#file(id), "utf8"));
      return null;
    } catch { return null; }
  }

  events(id: string): any[] {
    const out: any[] = [];
    try {
      if (!fs.existsSync(this.#eventsFile(id))) return out;
      const lines = fs.readFileSync(this.#eventsFile(id), "utf8").split("\n").filter((l: string) => l.trim().length > 0);
      for (const l of lines) { try { out.push(JSON.parse(l)); } catch {} }
    } catch {}
    return out;
  }

  async runTask(p: ExecutionParams): Promise<{ executionId: string; status: string }> {
    const pb = this.#piBridge;
    if (!pb) throw new Error("PiBridge not ready");

    const id = `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const agentIds = Array.isArray(p.agentIds)
      ? p.agentIds.map((s: string) => s.trim()).filter(Boolean)
      : String(p.agentIds || "orchestrator").split(",").map((s: string) => s.trim()).filter(Boolean);

    const state: ExecutionState = {
      id,
      label: p.label || "Task",
      owner: p.owner || "main",
      agentIds,
      workingDir: p.workingDir || null,
      mode: p.mode || null,
      model: p.model || null,
      thinkingLevel: p.thinkingLevel || null,
      text: p.text,
      status: "queued",
      createdAt: now,
      startedAt: null,
      endedAt: null,
      lastHeartbeat: null,
      progressNote: null,
      error: null,
      scheduleId: p.scheduleId || null,
      scheduledFor: p.scheduledFor || null,
    };
    this.#writeState(id, state);
    this.#appendEvent(id, "execution_queued", { label: state.label, owner: state.owner });
    this.#notify({ executionId: id, status: "queued", label: state.label, owner: state.owner });

    // Esecuzione asincrona (l'RPC ritorna subito con l'id)
    (async () => {
      const sk = `__exec_${id}`;
      try {
        state.status = "running";
        state.startedAt = Date.now();
        this.#writeState(id, state);
        this.#appendEvent(id, "execution_started", { sessionKey: sk });
        this.#notify({ executionId: id, status: "running", label: state.label });

        // Heartbeat ogni 5s mentre è running (base per recovery in A2.3)
        const timer = setInterval(() => {
          try {
            const cur = this.get(id);
            if (cur && cur.status === "running") {
              cur.lastHeartbeat = Date.now();
              this.#writeState(id, cur);
              this.#notify({ executionId: id, status: "running", heartbeat: cur.lastHeartbeat, label: cur.label });
            }
          } catch {}
        }, 5000);
        this.#runs.set(id, { timer, aborted: false });

        // Setup sessione headless (riuso totale della meccanica chat)
        const prevLabel = this.get(id)?.label || state.label;
        pb.create(sk, prevLabel !== "Task" ? `__exec_${prevLabel.slice(0, 16)}` : `__exec_${id.slice(0, 14)}`);
        if (agentIds.length > 0) pb.setChatAgents(sk, agentIds.join(","));
        if (state.mode) pb.setMode(sk, state.mode);
        if (state.workingDir) pb.setWorkingDir(sk, state.workingDir);
        if (state.model) await pb.setModel(sk, state.model);
        if (state.thinkingLevel) pb.setThinkingLevel(sk, state.thinkingLevel);
        this.#appendEvent(id, "session_ready", { sessionKey: sk, agentIds });
        this.#log("exec-session-ready", { executionId: id, sessionKey: sk, agentIds, mode: state.mode, model: state.model });

        // Esegue l'agente in headless: il ws finto cattura done/error + testo progressivo
        const result = await new Promise<{ ok: boolean; stopReason?: string; errorMessage?: string; text: string }>((resolve) => {
          let resolved = false;
          const finish = (r: { ok: boolean; stopReason?: string; errorMessage?: string; text: string }) => {
            if (!resolved) { resolved = true; resolve(r); }
          };
          const dummyWs = {
            send: (msg: string) => {
              try {
                const m = JSON.parse(msg);
                if (m.type === "done") {
                  finish({ ok: m.stopReason !== "error" && m.stopReason !== "cancelled", stopReason: m.stopReason, errorMessage: m.errorMessage, text: m.text || "" });
                } else if (m.type === "error") {
                  finish({ ok: false, errorMessage: m.message || m.errorMessage, text: "" });
                } else if (m.type === "aborted") {
                  finish({ ok: false, stopReason: "cancelled", text: "" });
                } else if (m.type === "stream_event" && m.eventType === "text_delta" && typeof m.text === "string" && m.text.trim().length > 0) {
                  // Log compatto del progresso (limite caratteri per non esplodere su disco)
                  this.#appendEvent(id, "message_delta", { text: m.text.slice(0, 300) });
                }
              } catch {}
            },
          };
          pb.send(dummyWs, { sessionKey: sk, text: state.text }).then(
            () => finish({ ok: true, stopReason: "completed", text: "" }),
            (e: any) => finish({ ok: false, errorMessage: e?.message || String(e), text: "" })
          );
        });

        clearInterval(timer);
        const run = this.#runs.get(id);
        this.#runs.delete(id);

        if (run?.aborted) {
          state.status = "cancelled";
          state.endedAt = Date.now();
          this.#appendEvent(id, "execution_cancelled", { by: "user" });
        } else if (result.ok) {
          state.status = "completed";
          state.endedAt = Date.now();
          state.progressNote = result.stopReason || "completed";
          this.#appendEvent(id, "execution_completed", { stopReason: result.stopReason, resultPreview: result.text.slice(0, 3000) });
        } else {
          state.status = "failed";
          state.endedAt = Date.now();
          state.error = result.errorMessage || "unknown error";
          this.#appendEvent(id, "execution_failed", { error: state.error });
        }
        this.#writeState(id, state);
        this.#appendEvent(id, "execution_end", { status: state.status });
        this.#notify({ executionId: id, status: state.status, label: state.label, error: state.error });
      } catch (e: any) {
        const run = this.#runs.get(id);
        if (run?.timer) clearInterval(run.timer);
        this.#runs.delete(id);
        state.status = "failed";
        state.endedAt = Date.now();
        state.error = e?.message || String(e);
        this.#writeState(id, state);
        this.#appendEvent(id, "execution_failed", { error: state.error });
        this.#notify({ executionId: id, status: "failed", label: state.label, error: state.error });
      }
    })();

    return { executionId: id, status: "queued" };
  }

  async cancel(id: string): Promise<{ ok: boolean; error?: string }> {
    const state = this.get(id);
    if (!state) return { ok: false, error: "not found" };
    if (state.status === "running") {
      const run = this.#runs.get(id);
      if (run) run.aborted = true;
      try { this.#piBridge?.abort?.(`__exec_${id}`); } catch {}
      // Lo stato finale viene scritto dal runner (cancelled)
    } else if (state.status === "queued") {
      state.status = "cancelled";
      state.endedAt = Date.now();
      this.#writeState(id, state);
      this.#appendEvent(id, "execution_cancelled", { by: "user", beforeStart: true });
      this.#notify({ executionId: id, status: "cancelled", label: state.label });
    }
    return { ok: true };
  }

  remove(id: string): { ok: boolean; error?: string } {
    try {
      try {
        const run = this.#runs.get(id);
        if (run) { run.aborted = true; }
        this.#piBridge?.abort?.(`__exec_${id}`);
        this.#piBridge?.remove?.(`__exec_${id}`);
      } catch {}
      fs.rmSync(this.#dir(id), { recursive: true, force: true });
      return { ok: true };
    } catch (e: any) { return { ok: false, error: e?.message }; }
  }
}