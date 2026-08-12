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
import { spawn } from "node:child_process";

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
  keepAwake?: boolean;
  sourceSession?: { key: string; label: string };
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
  sourceSession?: { key: string; label: string };
  resultPreview?: string;
  keepAwake: boolean;
  resumeCount: number;
}

export class ExecutionEngine {
  #piBridge: any = null;
  onUpdate: ((payload: any) => void) | null = null;
  #runs = new Map<string, { timer: any; aborted: boolean; stopped?: boolean }>();

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

  // A2.8: mappa i messaggi della sessione di esecuzione nella shape delle chat (per la Timeline)
  messages(id: string): any[] {
    const state = this.get(id);
    const out: any[] = [];
    const dir = path.join(AGENT_DIR, "sessions", "quinki", `__exec_${id}`);
    if (!fs.existsSync(dir)) return out;
    const entries: any[] = [];
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
          if (!l.trim()) continue;
          try { const e = JSON.parse(l); if (e.type === "message") entries.push(e); } catch {}
        }
      }
    } catch {}
    entries.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
    let lastAssistant: any = null;
    for (const e of entries) {
      const role = e.message?.role;
      const contentArr = Array.isArray(e.message?.content) ? e.message.content : [];
      const ts = e.timestamp || new Date().toISOString();
      if (role === "user") {
        const text = contentArr.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
        out.push({ id: e.id, role: "user", content: text || "(task)", timestamp: ts });
      } else if (role === "assistant") {
        const text = contentArr.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
        const thinking = contentArr.filter((c: any) => c.type === "thinking").map((c: any) => ({ level: "on", content: c.thinking || "" }));
        const toolCalls = contentArr.filter((c: any) => c.type === "toolCall").map((c: any) => ({ name: c.name || c.toolName || "tool", input: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments || {}) }));
        const m: any = { id: e.id, role: "assistant", content: text, timestamp: ts, thinking, toolCalls, toolResults: [], agentModel: state?.model || undefined, thinkingLevel: state?.thinkingLevel || undefined, agentName: ((state?.agentIds || []).join(", ")) || undefined };
        out.push(m);
        lastAssistant = m;
      } else if (role === "toolResult") {
        if (lastAssistant) {
          const output = contentArr.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
          lastAssistant.toolResults.push({ name: e.message?.toolName || "tool", output: output || "(empty)", isError: !!e.message?.isError });
        }
      }
    }
    return out;
  }

  #handoffPath(chatKey: string): string | null {
    if (!chatKey) return null;
    return path.join(AGENT_DIR, "handoffs", chatKey.replace(/[^a-zA-Z0-9_-]/g, "_"), "handoff.md");
  }
  async #readLastAssistantTextWithRetry(sk: string): Promise<string> {
    let t = this.#readLastAssistantText(sk);
    for (let i = 0; i < 8 && !t; i++) {
      await new Promise(r => setTimeout(r, 800));
      t = this.#readLastAssistantText(sk);
    }
    return t;
  }
  #readLastAssistantText(sk: string): string {
    try {
      const dir = path.join(AGENT_DIR, "sessions", "quinki", sk);
      if (!fs.existsSync(dir)) return "";
      let last = "";
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
          if (!l.trim()) continue;
          try {
            const e = JSON.parse(l);
            if (e.type === "message" && e.message?.role === "assistant" && Array.isArray(e.message.content)) {
              const text = e.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
              if (text.trim()) last = text.trim();
            }
          } catch {}
        }
      }
      return last;
    } catch { return ""; }
  }
  #appendHandoff(state: ExecutionState) {
    if (!state.sourceSession?.key) return;
    const p = this.#handoffPath(state.sourceSession.key);
    if (!p) return;
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const status = state.status || "?";
      const record = [
        `## T-${state.id} · ${state.label || "Task"} — ${status.toUpperCase()} — ${new Date().toISOString()}`,
        `- Agente: ${(state.agentIds || []).join(", ")}`,
        `- Modello: ${state.model || "default"} · Thinking: ${state.thinkingLevel || "default"}`,
        state.error ? `- Errore: ${state.error}` : `- Note: ${state.progressNote || "ok"}`,
        state.resultPreview ? `- Risultato: ${state.resultPreview.replace(/\n/g, " ").slice(0, 400)}` : "",
        "",
      ].join("\n");
      fs.appendFileSync(p, record, "utf8");
    } catch (e: any) {
      this.#log("handoff-append-failed", { executionId: state.id, error: e?.message });
    }
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
      sourceSession: p.sourceSession,
      keepAwake: !!p.keepAwake,
      resumeCount: 0,
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
        let keepAcquired = false;
        if (state.keepAwake) { this.#acquireKeepAwake(); keepAcquired = true; }

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
        // === A2.7.4: risoluzione model/thinking — schedule → sessione (chat-meta) → default ===
        if (!state.model || !state.thinkingLevel) {
          try {
            const metaPath = path.join(AGENT_DIR, "sessions", "quinki", state.sourceSession?.key || "", "chat-meta.json");
            if (fs.existsSync(metaPath)) {
              const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
              if (!state.model && meta.model) state.model = meta.model;
              if (!state.thinkingLevel && meta.thinkingLevel) state.thinkingLevel = meta.thinkingLevel;
            }
          } catch (e: any) {
            this.#log("exec-model-resolve-failed", { executionId: id, error: e?.message });
          }
        }
        // === A2.7.2: fork della chat — copia la storia della sourceSession nella sessione di esecuzione ===
        if (state.sourceSession?.key) {
          try {
            const srcDir = path.join(AGENT_DIR, "sessions", "quinki", state.sourceSession.key);
            const dstDir = path.join(AGENT_DIR, "sessions", "quinki", sk);
            if (fs.existsSync(srcDir)) {
              fs.mkdirSync(dstDir, { recursive: true });
              let copied = 0;
              for (const f of fs.readdirSync(srcDir)) {
                if (f.endsWith(".jsonl")) {
                  fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
                  copied++;
                }
              }
              this.#log("exec-fork-chat", { executionId: id, source: state.sourceSession.key, copied });
            }
          } catch (e: any) {
            this.#log("exec-fork-failed", { executionId: id, error: e?.message });
          }
        }
        if (agentIds.length > 0) pb.setChatAgents(sk, agentIds.join(","));
        if (state.mode) pb.setMode(sk, state.mode);
        if (state.workingDir) pb.setWorkingDir(sk, state.workingDir);
        if (state.model) await pb.setModel(sk, state.model);
        if (state.thinkingLevel) pb.setThinkingLevel(sk, state.thinkingLevel);
        this.#appendEvent(id, "session_ready", { sessionKey: sk, agentIds });
        this.#log("exec-session-ready", { executionId: id, sessionKey: sk, agentIds, mode: state.mode, model: state.model });

        // Esegue l'agente in headless: il ws finto cattura done/error + testo progressivo
        // Direttiva: il task va ESEGUITO DAVVERO con i tool, non solo dichiarato completato
        const execText = "[Scheduled task - EXECUTE IT NOW] You are running an autonomous scheduled task. Actually perform the task using your tools (write/edit/bash/etc.). Do NOT just claim completion: do it, then VERIFY the result objectively (check the file exists, run the tests, confirm the output). If the task gives verification criteria, follow them exactly. End your final message with a short 'Verification:' section stating what you checked and the outcome. Task: " + state.text;
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
          pb.send(dummyWs, { sessionKey: sk, text: execText }).then(
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
        } else if (run?.stopped) {
          state.status = "interrupted";
          state.endedAt = Date.now();
          state.progressNote = "stopped by user";
          this.#appendEvent(id, "execution_interrupted", { by: "user" });
        } else if (result.ok) {
          state.status = "completed";
          state.endedAt = Date.now();
          state.progressNote = result.stopReason || "completed";
          state.resultPreview = ((result.text && result.text.trim()) ? result.text : await this.#readLastAssistantTextWithRetry(sk)).slice(0, 1000);
          this.#appendEvent(id, "execution_completed", { stopReason: result.stopReason, resultPreview: state.resultPreview.slice(0, 3000) });
        } else if (result.stopReason === "aborted") {
          // Fermato dall'utente dalla CHAT (stop streaming) → riprendibile, non fallita
          state.status = "interrupted";
          state.endedAt = Date.now();
          state.progressNote = "stopped from chat";
          this.#appendEvent(id, "execution_interrupted", { by: "chat" });
        } else {
          state.status = "failed";
          state.endedAt = Date.now();
          state.error = result.errorMessage || "unknown error";
          this.#appendEvent(id, "execution_failed", { error: state.error });
        }
        this.#appendHandoff(state);
        this.#writeState(id, state);
        this.#appendEvent(id, "execution_end", { status: state.status });
        this.#notify({ executionId: id, status: state.status, label: state.label, error: state.error });
        if (keepAcquired) this.#releaseKeepAwake();
      } catch (e: any) {
        if (keepAcquired) this.#releaseKeepAwake();
        const run = this.#runs.get(id);
        if (run?.timer) clearInterval(run.timer);
        this.#runs.delete(id);
        state.status = "failed";
        state.endedAt = Date.now();
        state.error = e?.message || String(e);
        this.#appendHandoff(state);
        this.#writeState(id, state);
        this.#appendEvent(id, "execution_failed", { error: state.error });
        this.#notify({ executionId: id, status: "failed", label: state.label, error: state.error });
      }
    })();

    return { executionId: id, status: "queued" };
  }

  // Interrompi un'execution running/queued → diventa interrupted (riprendibile da Calendar)
  async stop(id: string): Promise<{ ok: boolean; error?: string }> {
    const state = this.get(id);
    if (!state) return { ok: false, error: "not found" };
    if (state.status === "running") {
      const run = this.#runs.get(id);
      if (run) run.stopped = true;
      try { this.#piBridge?.abort?.(`__exec_${id}`); } catch {}
      // lo stato finale viene scritto dal runner (interrupted)
    } else if (state.status === "queued") {
      state.status = "interrupted";
      state.endedAt = Date.now();
      state.progressNote = "stopped before start";
      this.#writeState(id, state);
      this.#appendEvent(id, "execution_interrupted", { by: "user", beforeStart: true });
      this.#notify({ executionId: id, status: "interrupted", label: state.label });
    }
    return { ok: true };
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

  // === A2.3: Keep Awake (caffeinate, ref-counted: 1 processo finché ALMENO un task keepAwake gira) ===
  #caffeinate: any = null;
  #keepCount = 0;

  #acquireKeepAwake() {
    if (process.platform !== "darwin") return;
    this.#keepCount++;
    if (this.#keepCount === 1 && !this.#caffeinate) {
      try {
        this.#caffeinate = spawn("caffeinate", ["-dimsu"], { stdio: "ignore" });
        this.#log("keep-awake-start", { pid: this.#caffeinate?.pid });
      } catch (e: any) { this.#log("keep-awake-error", { error: e?.message }); }
    }
  }

  #releaseKeepAwake() {
    if (process.platform !== "darwin") return;
    if (this.#keepCount > 0) this.#keepCount--;
    if (this.#keepCount === 0 && this.#caffeinate) {
      try { this.#caffeinate.kill(); } catch {}
      this.#caffeinate = null;
      this.#log("keep-awake-stop", {});
    }
  }

  stopCaffeinate() { this.#releaseKeepAwake(); }

  // Resume manuale (per la futura UI Calendar): riprende un'execution interrupted/resumable
  async resumeExecution(id: string): Promise<{ ok: boolean; error?: string }> {
    const st = this.get(id);
    if (!st) return { ok: false, error: "not found" };
    if (st.status !== "interrupted" && st.status !== "failed") return { ok: false, error: `status is ${st.status}` };
    this.#resume(id).catch(() => {});
    return { ok: true };
  }

  // === A2.3: Recovery Manager vic1 (resume SEMANTICO) ===
  // Al boot + ogni 60s: execution running/queued con heartbeat stantio → interrupted →
  // se autoResume (default) → CONTINUA la stessa sessione con un messaggio di ripresa.
  startRecovery(autoResume = true) {
    this.recover(autoResume);
    this.#recoveryTimer = setInterval(() => { this.recover(autoResume); }, 60000);
    this.#log("recovery-started", { autoResume });
  }
  #recoveryTimer: any = null;
  stopRecovery() { if (this.#recoveryTimer) clearInterval(this.#recoveryTimer); }

  async recover(autoResume = true): Promise<{ recovered: number; resumed: number }> {
    let recovered = 0, resumed = 0;
    const now = Date.now();
    try {
      for (const st of this.list()) {
        if (st.status !== "running" && st.status !== "queued") continue;
        if (st.status === "running") {
          const stale = st.lastHeartbeat ? (now - st.lastHeartbeat > 120000)
            : (st.startedAt ? now - st.startedAt > 60000 : true);
          if (!stale) continue;
          st.status = "interrupted";
          this.#writeState(st.id, st);
          this.#appendEvent(st.id, "execution_interrupted", { atBoot: true, staleSec: Math.round((now - (st.lastHeartbeat || st.startedAt || now)) / 1000) });
          this.#notify({ executionId: st.id, status: "interrupted", label: st.label });
          recovered++;
          if ((st.resumeCount || 0) >= 3) {
            st.status = "failed"; st.error = "auto-resume limit reached (3)";
            this.#writeState(st.id, st); this.#appendEvent(st.id, "execution_failed", { error: st.error });
            this.#notify({ executionId: st.id, status: "failed", label: st.label, error: st.error });
          } else if (autoResume) {
            resumed++;
            this.#resume(st.id).catch(() => {});
          }
        } else if (st.status === "queued") {
          // crash prima dell'avvio → interrupt + resume da zero (azzera session key se serve)
          st.status = "interrupted";
          this.#writeState(st.id, st);
          this.#appendEvent(st.id, "execution_interrupted", { atBoot: true, queueCrash: true });
          recovered++;
          if (autoResume) { resumed++; this.#resume(st.id).catch(() => {}); }
        }
      }
      this.#log("recovery-scan", { recovered, resumed, total: this.list().length });
    } catch (e: any) { this.#log("recovery-error", { error: e?.message }); }
    return { recovered, resumed };
  }

  // Ripresa semantica: stessa sessione (stessa history su disco) + messaggio di continuazione.
  async #resume(id: string): Promise<void> {
    const pb = this.#piBridge;
    if (!pb) return;
    const st = this.get(id);
    if (!st) return;
    const sk = `__exec_${id}`;
    st.status = "running";
    st.lastHeartbeat = Date.now();
    st.resumeCount = (st.resumeCount || 0) + 1;
    st.error = null;
    this.#writeState(id, st);
    this.#appendEvent(id, "execution_resumed", { attempt: st.resumeCount });
    this.#notify({ executionId: id, status: "running", label: st.label, resumed: true });
    try { pb.abort?.(sk); } catch {}
    // Ricostruisci entry + configurazione sessione (dopo un riavvio l'entry può mancare)
    try {
      pb.create(sk, `__exec_${id.slice(0, 14)}`);
      if (st.agentIds && st.agentIds.length) pb.setChatAgents(sk, st.agentIds.join(","));
      if (st.mode) pb.setMode(sk, st.mode);
      if (st.workingDir) pb.setWorkingDir(sk, st.workingDir);
      if (st.model) await pb.setModel(sk, st.model);
      if (st.thinkingLevel) pb.setThinkingLevel(sk, st.thinkingLevel);
    } catch (e: any) { this.#log("resume-setup-error", { executionId: id, error: e?.message }); }
    const timer = setInterval(() => {
      const cur = this.get(id);
      if (cur && cur.status === "running") { cur.lastHeartbeat = Date.now(); this.#writeState(id, cur); }
    }, 5000);
    this.#runs.set(id, { timer, aborted: false });
    const continuation = `[AUTO-RESUME after interruption] You are continuing an autonomous task\n\nOriginal task: ${st.text}\n\nReview what was already done in this conversation, then CONTINUE and COMPLETE the task. If a step may already have been performed, VERIFY before repeating it (check files/tools). Don't invent results.`;
    try {
      const result = await new Promise<{ ok: boolean; stopReason?: string; errorMessage?: string }>((resolve) => {
        let done = false;
        const finish = (r: any) => { if (!done) { done = true; resolve(r); } };
        const dummyWs = {
          send: (msg: string) => {
            try {
              const m = JSON.parse(msg);
              if (m.type === "done") finish({ ok: m.stopReason !== "error" && m.stopReason !== "cancelled", stopReason: m.stopReason, errorMessage: m.errorMessage });
              else if (m.type === "error") finish({ ok: false, errorMessage: m.message || m.errorMessage });
              else if (m.type === "aborted") finish({ ok: false, stopReason: "cancelled" });
            } catch {}
          },
        };
        pb.send(dummyWs, { sessionKey: sk, text: continuation }).then(
          () => finish({ ok: true, stopReason: "completed" }),
          (e: any) => finish({ ok: false, errorMessage: e?.message || String(e) })
        );
      });
      clearInterval(timer);
      this.#runs.delete(id);
      const run = this.#runs.get(id);
      if (run?.aborted) {
        st.status = "cancelled"; st.endedAt = Date.now();
        this.#appendEvent(id, "execution_cancelled", { afterResume: true });
      } else if (result.ok) {
        st.status = "completed"; st.endedAt = Date.now();
        this.#appendEvent(id, "execution_completed", { afterResume: true, stopReason: result.stopReason });
      } else {
        st.status = "failed"; st.endedAt = Date.now();
        st.error = result.errorMessage || "resume failed";
        this.#appendEvent(id, "execution_failed", { afterResume: true, error: st.error });
      }
      this.#writeState(id, st);
      this.#appendEvent(id, "execution_end", { status: st.status });
      this.#notify({ executionId: id, status: st.status, label: st.label, error: st.error, resumed: true });
    } catch (e: any) {
      clearInterval(timer);
      this.#runs.delete(id);
      st.status = "failed"; st.endedAt = Date.now(); st.error = e?.message || String(e);
      this.#writeState(id, st);
      this.#appendEvent(id, "execution_failed", { afterResume: true, error: st.error });
      this.#notify({ executionId: id, status: "failed", label: st.label, error: st.error, resumed: true });
    }
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