// src/main/longhorizon.ts — A2.11: Long Horizon support agent (virtual user)
// Guida la SESSIONE NORMALE attraverso un piano con auto-prompting.
// Non è un'AI: è un timer che legge i file della sessione (plan/handoff/progress)
// e scrive in chat (come bubble utente) i prompt "continua" finché il piano è finito.
//
// File per sessione (in ~/.quinki/longhorizon/<session-key>/):
//   plan.md      — il piano (leggibile/modificabile dall'utente)
//   handoff.md   — la memoria (cosa/come/perché, scritto dal modello)
//   progress.json— lo stato machine-readable (unità corrente)
//   workdir/     — cartella di lavoro dell'agente (git obbligatorio)
//   state.json   — stato interno dell'agente di supporto

import * as fs from "node:fs";
import * as path from "node:path";

interface LHUnit {
  id: number;
  desc: string;
  status: "pending" | "current" | "done";
}

interface LHState {
  active: boolean;
  goal: string;
  pendingGoal?: string;
  phase: "discussion" | "planning" | "running" | "paused" | "done";
  status: "idle" | "running" | "done" | "paused";
  units: LHUnit[];
  currentIdx: number; // 0-based; -1 = nessuna unità ancora
  promptCount: number; // prompt inviati per l'unità corrente (anti-loop)
  lastHandoffSig: string;
  startedAt: number;
  lastActivity: number;
}

const UNIT_PROMPT_TEMPLATE = `Continue the work. Current unit: {desc}.

Context: {handoff}

ALWAYS remember:
- Update handoff.md (what you did, how, why) at ~/.quinki/longhorizon/{sessionKey}/handoff.md
- Update the plan (plan.md)
- Use all the skills available
- Create what you need (agents, files, tools)
- Do no harm
- Before starting: git commit 'unit-{n}: before' in the workdir
- When done: run the tests, and move on ONLY if everything works
- Then: git commit 'unit-{n}: after'

BE SKEPTICAL ABOUT YOUR OWN WORK:
- Do not claim the unit is done until you have PROVEN it works: run the code, run the tests, check the output.
- Verify you actually did what the plan says — not something similar, not a shortcut.
- Test multiple times, including edge cases. If something fails, fix it and test again.
- If you are stuck repeating the same action, stop and take a different approach.

Reply when you have completed the unit.`;

const STUCK_MESSAGE = `What are you doing? You are going in circles: you repeated the same actions without updating handoff.md. Stop, re-read the current unit, and restart with a different approach. Update handoff.md as soon as you make progress.`;

const DONE_MESSAGE = `The plan is complete. Do a final full verification: check that everything works, update handoff.md with the final summary, and make a final commit 'plan: complete'. Then reply with a summary of the work done.`;

export class LongHorizon {
  #agentDir: string;
  #piBridge: any = null;
  #timer: any = null;
  #logger: ((tag: string, data: any) => void) | null = null;
  onNotify: ((payload: any) => void) | null = null;
  #states = new Map<string, LHState>();
  #inflight = new Map<string, boolean>(); // sessione con send in corso

  constructor(agentDir: string) {
    this.#agentDir = agentDir;
    this.#loadAll();
  }

  setPiBridge(pb: any) { this.#piBridge = pb; }
  setLogger(fn: (tag: string, data: any) => void) { this.#logger = fn; }
  #log(tag: string, data: any) { try { this.#logger?.(tag, data); } catch {} }
  #notify(payload: any) { try { this.onNotify?.(payload); } catch {} }

  // === Paths per sessione ===
  #dir(sk: string) { return path.join(this.#agentDir, "longhorizon", String(sk).replace(/[^a-zA-Z0-9_-]/g, "_")); }
  #stateFile(sk: string) { return path.join(this.#dir(sk), "state.json"); }
  #planFile(sk: string) { return path.join(this.#dir(sk), "plan.md"); }
  #handoffFile(sk: string) { return path.join(this.#dir(sk), "handoff.md"); }
  #progressFile(sk: string) { return path.join(this.#dir(sk), "progress.json"); }
  #workdir(sk: string) { return path.join(this.#dir(sk), "workdir"); }

  #readHandoff(sk: string): string {
    try { if (fs.existsSync(this.#handoffFile(sk))) return fs.readFileSync(this.#handoffFile(sk), "utf8"); } catch {}
    return "";
  }

  #handoffSig(sk: string): string {
    const h = this.#readHandoff(sk);
    return h ? h.trim().slice(-500) : "";
  }

  #writeState(sk: string) {
    const st = this.#states.get(sk);
    if (!st) return;
    try {
      fs.mkdirSync(this.#dir(sk), { recursive: true });
      fs.writeFileSync(this.#stateFile(sk), JSON.stringify(st, null, 2), "utf8");
    } catch {}
  }

  #writeProgress(sk: string) {
    const st = this.#states.get(sk);
    if (!st) return;
    try {
      fs.mkdirSync(this.#dir(sk), { recursive: true });
      fs.writeFileSync(this.#progressFile(sk), JSON.stringify({
        goal: st.goal,
        status: st.status,
        units: (st.units || []).map((u, i) => ({ id: u.id, desc: u.desc, status: u.status, current: i === st.currentIdx })),
      }, null, 2), "utf8");
    } catch {}
    this.#notify({ sessionKey: sk, ...this.getState(sk) });
  }

  #loadAll() {
    try {
      const base = path.join(this.#agentDir, "longhorizon");
      if (!fs.existsSync(base)) return;
      for (const d of fs.readdirSync(base)) {
        const sf = path.join(base, d, "state.json");
        if (!fs.existsSync(sf)) continue;
        try {
          const st = JSON.parse(fs.readFileSync(sf, "utf8"));
          if (st && st.active) {
            // Normalizzazione difensiva: un state.json vecchio/troncato può mancare di campi
            // (es. {"active":true,"status":"running"} senza units) → senza normalize il tick crasha
            // con "st.units is undefined" a OGNI tick.
            const norm: any = {
              active: true,
              goal: st.goal || "",
              phase: st.phase || "discussion",
              status: st.status || "idle",
              units: Array.isArray(st.units) ? st.units : [],
              currentIdx: typeof st.currentIdx === "number" ? st.currentIdx : -1,
              promptCount: typeof st.promptCount === "number" ? st.promptCount : 0,
              lastHandoffSig: st.lastHandoffSig || "",
              startedAt: st.startedAt || Date.now(),
              lastActivity: st.lastActivity || Date.now(),
            };
            // Stato incoerente: "running" senza unità → torna idle (il tick non gira a vuoto)
            if (norm.status === "running" && norm.units.length === 0) {
              norm.status = "idle";
              norm.phase = "discussion";
              norm.currentIdx = -1;
            }
            this.#states.set(d, norm);
            this.#log("lh-loaded", { sessionKey: d, status: norm.status });
          }
        } catch {}
      }
    } catch {}
  }

  // === RPC API ===

  // Attiva Long Horizon per la sessione (il piano verrà impostato con setPlan)
  async activate(sk: string): Promise<{ ok: boolean; error?: string }> {
    if (!sk) return { ok: false, error: "sessionKey required" };
    const existing = this.#states.get(sk);
    if (existing?.active) return { ok: true, note: "already active" };
    const st: LHState = {
      active: true,
      goal: "",
      phase: "discussion",
      status: "idle",
      units: [],
      currentIdx: -1,
      promptCount: 0,
      lastHandoffSig: "",
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.#states.set(sk, st);
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-activated", { sessionKey: sk });
    this.#piBridge?.setLongHorizonPhase(sk, "discussion");
    // Messaggio di SISTEMA per l'UTENTE (hardcoded, sempre uguale): UI-only, NON entra nel contesto del modello.
    st.systemMessage = `Long Horizon is now active for this session. It is a guided, phase-based working mode. The conversation moves through three phases, and you control every transition with the buttons that appear in the chat.\n\nPHASE 1 — DISCUSSION (automatic, starts now)\nYou and the agent discuss the problem together to understand the goal, the constraints, and the approach. The agent can examine files, search the codebase, and use its skills to study the problem. It CANNOT modify, create, or delete anything.\n\nPHASE 2 — PLANNING\nWhen you are satisfied with the discussion, press "Proceed to planning". The agent proposes a concrete plan divided into units, one per line, in '- [ ]' format. You can keep discussing and adding things. The agent still CANNOT modify anything.\n\nPHASE 3 — START (EXECUTION)\nWhen you press "Start", the agent creates the final plan and the support files, then works through the plan units one at a time, autonomously. It updates handoff.md after each unit and commits progress to git.\n\nHOW THE MODES WORK\n- During DISCUSSION and PLANNING the session runs in PLAN MODE: the agent can read, search, and use skills, but the write/edit/bash tools are disabled (bash is available read-only). It is physically unable to modify anything.\n- During START the session switches to BUILD MODE: all tools are enabled and the agent can create, edit, and execute freely.\n- If you pause, the session returns to DISCUSSION (PLAN MODE again). You can discuss changes, then go through PLANNING and START again.\n\nRULES\n- The agent is always in exactly one phase and cannot change it on its own.\n- Only you can advance the phases, with the buttons in the chat.\n- During DISCUSSION and PLANNING the agent never executes anything.\n- During EXECUTION the agent works autonomously.\n\nThe first phase (DISCUSSION) starts now. Tell the agent the problem you want to work on.`;
    this.#writeState(sk);
    return { ok: true };
    return { ok: true };
  }

  // Disattiva COMPLETAMENTE Long Horizon per la sessione (usato quando la chat viene eliminata)
  disable(sk: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st) return { ok: true };
    st.active = false;
    st.phase = "discussion";
    st.status = "idle";
    st.units = [];
    st.currentIdx = -1;
    st.promptCount = 0;
    st.pendingGoal = undefined;
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-disabled", { sessionKey: sk });
    this.#piBridge?.setLongHorizonPhase(sk, "");
    return { ok: true };
  }

  // Disattiva (pausa) Long Horizon per la sessione — torna alla DISCUSSION
  deactivate(sk: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st) return { ok: false, error: "not active" };
    st.active = true;
    st.phase = "discussion";
    st.status = "paused";
    st.lastActivity = Date.now();
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-deactivated", { sessionKey: sk, note: "back to discussion" });
    this.#piBridge?.setLongHorizonPhase(sk, "discussion");
    this.#sendToSession(sk, `Long Horizon is paused. We are back in the DISCUSSION phase. Discuss with me what you want to change. Do not execute anything.`);
    return { ok: true };
  }

  // Nuova discussione (post-completamento): azzera il piano e torna alla discussion
  newDiscussion(sk: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st || !st.active) return { ok: false, error: "Long Horizon not active" };
    st.phase = "discussion";
    st.status = "idle";
    st.units = [];
    st.currentIdx = -1;
    st.promptCount = 0;
    st.pendingGoal = undefined;
    st.lastActivity = Date.now();
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-new-discussion", { sessionKey: sk });
    this.#piBridge?.setLongHorizonPhase(sk, "discussion");
    this.#sendToSession(sk, `Long Horizon is back in the DISCUSSION phase. Ask me what new problem I want to work on. Do not execute anything.`);
    return { ok: true };
  }

  // Transizione di fase controllata dall'utente (via la sezione in chat)
  setPhase(sk: string, phase: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st || !st.active) return { ok: false, error: "Long Horizon not active" };
    if (phase === "planning") {
      const isRevision = st.units.length > 0;
      st.phase = "planning";
      st.units = []; // azzera: allo Start verrà ri-parsato il piano (nuovo o rivisto)
      st.currentIdx = -1;
      st.promptCount = 0;
      st.lastActivity = Date.now();
      this.#writeState(sk);
      this.#writeProgress(sk);
      this.#log("lh-phase-planning", { sessionKey: sk, revision: isRevision });
      this.#piBridge?.setLongHorizonPhase(sk, "planning");
      if (isRevision) {
        this.#sendToSession(sk, `We are in the PLANNING phase. Update the previous plan you were following based on our latest discussion. Keep the units that are still valid, modify the ones that changed, and add new ones if needed. Output the updated plan with units in '- [ ]' format. Do not execute anything.`);
      } else {
        this.#sendToSession(sk, `We are in the PLANNING phase. Propose a plan for the goal we discussed, divided into units in '- [ ]' format. Do not execute anything.`);
      }
      return { ok: true };
    }
    if (phase === "running") {
      // Start: se non c'è ancora un piano, parsa l'ultimo messaggio assistente (il piano della fase planning)
      if (st.units.length === 0) {
        const resp = this.#lastAssistantText(sk);
        const units = this.#parseUnits(resp);
        if (units.length > 0) {
          st.goal = st.goal || resp.slice(0, 120);
          st.units = units.map((u, i) => ({ id: i + 1, desc: u.desc, status: "pending" as const }));
          st.currentIdx = 0;
          st.promptCount = 0;
          st.lastHandoffSig = this.#handoffSig(sk);
          try {
            fs.mkdirSync(this.#dir(sk), { recursive: true });
            fs.writeFileSync(this.#planFile(sk), units.map((u, i) => `- [ ] Unit ${i + 1}: ${u.desc}`).join("\n"), "utf8");
            const wd = this.#gitDir(sk);
            fs.mkdirSync(wd, { recursive: true });
            if (!fs.existsSync(path.join(wd, ".git"))) { try { this.#git(sk, ["init", "-q"]); } catch {} }
          } catch {}
          this.#log("lh-plan-parsed-from-chat", { sessionKey: sk, units: units.length });
          this.#piBridge?.setLongHorizonPhase(sk, "running");
        } else if (st.pendingGoal) {
          const goal = st.pendingGoal;
          st.pendingGoal = undefined;
          this.#writeState(sk);
          this.#sendPlanRequest(sk, st, goal).then(() => {
            const st2 = this.#states.get(sk);
            if (st2 && st2.status === "running") {
              st2.phase = "running";
              this.#writeState(sk);
              this.#writeProgress(sk);
              this.#log("lh-phase-running", { sessionKey: sk });
            }
          });
          return { ok: true };
        } else {
          return { ok: false, error: "No plan found. Finish the planning phase first." };
        }
      }
      st.phase = "running";
      st.status = "running";
      st.promptCount = 0;
      st.lastActivity = Date.now();
      this.#writeState(sk);
      this.#writeProgress(sk);
      this.#log("lh-phase-running", { sessionKey: sk });
      this.#piBridge?.setLongHorizonPhase(sk, "running");
      this.#sendToSession(sk, `The execution has started. Begin working through the plan units one at a time. Update handoff.md after each unit and commit to git.`);
      return { ok: true };
    }
    return { ok: false, error: "unknown phase" };
  }

  // Salva l'obiettivo dell'utente (Long Horizon idle). Il modello NON lo riceve come task:
  // il support agent crea il piano e poi guida. L'utente vede il suo messaggio (bubble) ma il
  // modello non esegue nulla finché il piano non è creato.
  setGoal(sk: string, goal: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st || !st.active) return { ok: false, error: "Long Horizon not active" };
    if (!goal.trim()) return { ok: false, error: "goal required" };
    st.pendingGoal = goal.trim();
    st.lastActivity = Date.now();
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-goal-set", { sessionKey: sk, goal: goal.slice(0, 80) });
    return { ok: true };
  }

  // Riprende dopo una pausa: se c'è un piano → running, altrimenti discussion
  resume(sk: string): { ok: boolean; error?: string } {
    const st0 = this.#states.get(sk);
    if (st0) this.#piBridge?.setLongHorizonPhase(sk, st0.units.length > 0 ? "running" : "discussion");
    const st = this.#states.get(sk);
    if (!st) return { ok: false, error: "not found" };
    st.active = true;
    if (st.units.length > 0 && st.status !== "done") {
      st.phase = "running";
      st.status = "running";
      st.promptCount = 0;
    } else {
      st.phase = "discussion";
      st.status = "idle";
    }
    st.lastActivity = Date.now();
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-resumed", { sessionKey: sk, phase: st.phase });
    return { ok: true };
  }

  // Imposta il piano (markdown con unità) — chiamato dopo l'approvazione
  setPlan(sk: string, planMd: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st || !st.active) return { ok: false, error: "Long Horizon not active. Use /longhorizon first." };
    const units: LHUnit[] = [];
    let goal = "";
    for (const line of String(planMd || "").split("\n")) {
      const t = line.trim();
      if (!goal && t && !t.startsWith("-") && !t.startsWith("#")) goal = t;
      const m = t.match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
      if (m) {
        units.push({ id: units.length + 1, desc: m[2].trim(), status: m[1].toLowerCase() === "x" ? "done" : "pending" });
      }
    }
    if (units.length === 0) {
      // fallback: righe non vuote dopo il titolo
      for (const line of String(planMd || "").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        if (!goal) { goal = t; continue; }
        if (!t.startsWith("-")) units.push({ id: units.length + 1, desc: t.replace(/^[-*]\s*/, "").trim(), status: "pending" });
      }
    }
    if (units.length === 0) return { ok: false, error: "No units found in the plan. Use '- [ ] Description' lines." };
    st.goal = goal || st.goal;
    st.units = units;
    // prima unità pending diventa current
    const first = st.units.findIndex(u => u.status === "pending");
    st.currentIdx = first >= 0 ? first : 0;
    st.status = "running";
    st.promptCount = 0;
    st.lastHandoffSig = this.#handoffSig(sk);
    st.lastActivity = Date.now();
    // scrivi plan.md
    try {
      fs.mkdirSync(this.#dir(sk), { recursive: true });
      fs.writeFileSync(this.#planFile(sk), String(planMd || ""), "utf8");
      // workdir + git init
      const wd = this.#gitDir(sk);
      fs.mkdirSync(wd, { recursive: true });
      if (!fs.existsSync(path.join(wd, ".git"))) {
        try { this.#git(sk, ["init", "-q"]); } catch {}
      }
    } catch {}
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-plan-set", { sessionKey: sk, units: units.length, goal: goal.slice(0, 60) });
    return { ok: true, units: units.length };
  }

  getState(sk: string): any {
    const st = this.#states.get(sk);
    if (!st) return { active: false };
    return {
      active: st.active,
      goal: st.goal,
      phase: st.phase,
      status: st.status,
      currentIdx: st.currentIdx,
      units: st.units,
      promptCount: st.promptCount,
      startedAt: st.startedAt,
      lastActivity: st.lastActivity,
      systemMessage: st.systemMessage || "",
    };
  }

  listActive(): string[] {
    const out: string[] = [];
    for (const [sk, st] of this.#states) if (st.active) out.push(sk);
    return out;
  }

  // === Git helpers: il git va nella directory di lavoro della sessione (dove il modello crea il progetto) ===
  #gitDir(sk: string): string {
    try {
      const cwd = this.#piBridge?.getEffectiveCwd?.(sk);
      if (cwd && cwd.trim().length > 0) return cwd;
    } catch {}
    return this.#workdir(sk);
  }

  #git(sk: string, args: string[]): { ok: boolean; out: string; err: string } {
    const wd = this.#gitDir(sk);
    try {
      const res = require("child_process").spawnSync("git", args, { cwd: wd, encoding: "utf8", timeout: 15000 });
      return { ok: res.status === 0, out: String(res.stdout || ""), err: String(res.stderr || "") };
    } catch (e: any) { return { ok: false, out: "", err: e?.message }; }
  }

  gitLog(sk: string): any[] {
    const r = this.#git(sk, ["log", "--oneline", "-20"]);
    if (!r.ok) return [];
    return r.out.split("\n").filter(Boolean).map(line => {
      const sp = line.indexOf(" ");
      return { hash: sp > 0 ? line.slice(0, sp) : line, msg: sp > 0 ? line.slice(sp + 1) : "" };
    });
  }

  gitDiff(sk: string, commit?: string): string {
    const args = commit ? ["diff", commit + "^", commit, "--stat"] : ["diff", "--stat"];
    const r = this.#git(sk, args);
    return r.ok ? r.out : r.err;
  }

  gitRevert(sk: string, commit?: string): { ok: boolean; error?: string } {
    if (commit) {
      const r = this.#git(sk, ["revert", "--no-edit", commit]);
      return { ok: r.ok, error: r.err || undefined };
    }
    const r = this.#git(sk, ["checkout", "."]);
    return { ok: r.ok, error: r.err || undefined };
  }

  // === Session files ===
  getSessionFiles(sk: string): { name: string; content: string }[] {
    const out: { name: string; content: string }[] = [];
    const dir = this.#dir(sk);
    try {
      if (fs.existsSync(path.join(dir, "plan.md"))) out.push({ name: "plan.md", content: fs.readFileSync(path.join(dir, "plan.md"), "utf8") });
      if (fs.existsSync(path.join(dir, "handoff.md"))) out.push({ name: "handoff.md", content: fs.readFileSync(path.join(dir, "handoff.md"), "utf8") });
      if (fs.existsSync(path.join(dir, "progress.json"))) out.push({ name: "progress.json", content: fs.readFileSync(path.join(dir, "progress.json"), "utf8") });
    } catch {}
    return out;
  }

  saveSessionFile(sk: string, name: string, content: string): { ok: boolean } {
    try {
      if (!["plan.md", "handoff.md"].includes(name)) return { ok: false };
      fs.mkdirSync(this.#dir(sk), { recursive: true });
      fs.writeFileSync(path.join(this.#dir(sk), name), String(content || ""), "utf8");
      return { ok: true };
    } catch { return { ok: false }; }
  }

  // === Loop ===
  start() {
    this.#timer = setInterval(() => { this.tick().catch(() => {}); }, 15000);
    this.tick().catch(() => {});
    this.#log("lh-started", { active: this.listActive().length });
  }

  stop() { if (this.#timer) clearInterval(this.#timer); }

  async tick() {
    for (const sk of this.listActive()) {
      try { await this.#tickSession(sk); } catch (e: any) { this.#log("lh-tick-error", { sessionKey: sk, error: e?.message }); }
    }
  }

  async #tickSession(sk: string) {
    const st = this.#states.get(sk);
    if (!st || !st.active) return;
    if (this.#inflight.get(sk)) return; // send in corso

    // === Automatico: se idle e c'è un obiettivo pendente → crea il piano e parti ===
    if (st.status === "idle" && st.pendingGoal) {
      const goal = st.pendingGoal;
      st.pendingGoal = undefined;
      this.#writeState(sk);
      this.#log("lh-auto-plan", { sessionKey: sk, goal: goal.slice(0, 80) });
      this.#sendPlanRequest(sk, st, goal).catch(() => {});
      return;
    }

    if (st.status !== "running") return;

    // === Rilevamento loop per PATTERN (non per tempo): legge gli ultimi tool call della sessione.
    // Se lo stesso tool con gli stessi argomenti si ripete 3+ volte, è un loop → interviene. ===
    try {
      const tcs = this.#piBridge?.getRecentToolCalls?.(sk, 12) || [];
      if (tcs.length >= 3) {
        const last = tcs[tcs.length - 1];
        const count = tcs.filter((t: any) => t.name === last.name && t.args === last.args).length;
        if (count >= 3) {
          this.#log("lh-loop-pattern", { sessionKey: sk, tool: last.name, count });
          try { this.#piBridge?.abort?.(sk); } catch {}
          this.#sendToSession(sk, `I notice you are repeating the same action (${last.name}) with the same arguments. This looks like a loop. Stop, re-read the current unit and the handoff, and take a different approach. Update handoff.md as soon as you make progress.`);
          st.promptCount = 0;
          st.lastHandoffSig = this.#handoffSig(sk);
          this.#writeState(sk);
          return;
        }
      }
    } catch (e: any) { this.#log("lh-loop-pattern-error", { sessionKey: sk, error: e?.message }); }

    // Se la sessione sta ancora generando (streaming attivo) → aspetta
    try {
      const ss = this.#piBridge?.getStreamingStatus?.();
      const streaming = (ss || []).includes(sk);
      if (streaming) return;
    } catch {}

    if (st.currentIdx < 0) return; // nessuna unità impostata
    let unit = st.units?.[st.currentIdx];
    if (!unit) return;

    if (unit.status === "done") {
      // passa alla prossima unità pending
      const next = (st.units || []).findIndex((u, i) => i > st.currentIdx && u.status === "pending");
      if (next === -1) {
        // piano completo → torna alla DISCUSSION per discutere cosa è successo
        st.status = "done";
        st.phase = "discussion";
        st.lastActivity = Date.now();
        this.#writeState(sk);
        this.#writeProgress(sk);
        this.#log("lh-completed", { sessionKey: sk, units: st.units.length });
        this.#piBridge?.setLongHorizonPhase(sk, "discussion");
        this.#sendToSession(sk, DONE_MESSAGE);
        return;
      }
      st.currentIdx = next;
      st.promptCount = 0;
      st.lastHandoffSig = this.#handoffSig(sk);
      this.#writeState(sk);
      this.#writeProgress(sk);
      unit = st.units[next];
    }

    // Unità corrente pending → manda il prompt
    if (unit.status === "pending") {
      if (st.promptCount >= 3) {
        // girando a vuoto → messaggio di stop
        this.#sendToSession(sk, STUCK_MESSAGE);
        st.promptCount = 0;
        st.lastHandoffSig = this.#handoffSig(sk);
        this.#writeState(sk);
        return;
      }
      st.promptCount++;
      st.lastActivity = Date.now();
      this.#writeState(sk);
      this.#writeProgress(sk);
      this.#sendUnitPrompt(sk, unit).catch(() => {});
    }
  }

  async #sendPlanRequest(sk: string, st: LHState, goal: string) {
    const prompt = `You are in Long Horizon mode. The user's goal is: "${goal}".\n\nCreate a plan to achieve this goal. Divide it into units, one per line, in this exact format:\n- [ ] Unit 1: description\n- [ ] Unit 2: description\n...\n\nDo NOT execute anything yet. Only output the plan with the units.`;
    this.#inflight.set(sk, true);
    this.#log("lh-plan-request", { sessionKey: sk });
    try {
      const fakeWs = { readyState: 1, constructor: { OPEN: 1 }, send: () => {} };
      await this.#piBridge?.send(fakeWs, { sessionKey: sk, text: prompt, _preserveWs: true });
    } catch (e: any) {
      this.#log("lh-plan-request-error", { sessionKey: sk, error: e?.message });
    } finally {
      this.#inflight.set(sk, false);
    }
    // Parsa il piano dalla risposta del modello
    const resp = this.#lastAssistantText(sk);
    const units = this.#parseUnits(resp);
    if (units.length === 0) {
      this.#log("lh-plan-parse-fail", { sessionKey: sk, respLen: resp.length });
      st.pendingGoal = goal; // riprova al prossimo tick
      this.#writeState(sk);
      return;
    }
    const planMd = units.map((u, i) => `- [ ] Unit ${i + 1}: ${u.desc}`).join("\n");
    st.goal = goal;
    st.units = units.map((u, i) => ({ id: i + 1, desc: u.desc, status: "pending" as const }));
    st.currentIdx = 0;
    st.status = "running";
    st.promptCount = 0;
    st.lastHandoffSig = this.#handoffSig(sk);
    st.lastActivity = Date.now();
    try {
      fs.mkdirSync(this.#dir(sk), { recursive: true });
      fs.writeFileSync(this.#planFile(sk), planMd, "utf8");
      const wd = this.#workdir(sk);
      fs.mkdirSync(wd, { recursive: true });
      if (!fs.existsSync(path.join(wd, ".git"))) { try { this.#git(sk, ["init", "-q"]); } catch {} }
    } catch {}
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-auto-plan-set", { sessionKey: sk, units: units.length });
  }

  async #sendUnitPrompt(sk: string, unit: LHUnit) {
    const st = this.#states.get(sk);
    const handoff = this.#readHandoff(sk).slice(-1500) || "(nessun handoff ancora — scrivi il primo dopo l'unità 1)";
    const prompt = UNIT_PROMPT_TEMPLATE
      .replace("{desc}", unit.desc)
      .replace("{handoff}", handoff)
      .replace("{sessionKey}", String(sk).replace(/[^a-zA-Z0-9_-]/g, "_"))
      .replace("{n}", String(unit.id));
    st!.lastHandoffSig = this.#handoffSig(sk);
    // commit before (stato prima dell'unità — per revert)
    try { this.#git(sk, ["add", "-A"]); this.#git(sk, ["commit", "-m", `unit-${unit.id}: before`, "--allow-empty", "-q"]); } catch {}
    this.#inflight.set(sk, true);
    this.#log("lh-prompt", { sessionKey: sk, unit: unit.id, promptCount: st!.promptCount });
    try {
      const fakeWs = { readyState: 1, constructor: { OPEN: 1 }, send: () => {} };
      // Nessun timeout: il send si risolve quando il modello finisce (anche ore).
      // Se il modello si blocca, l'utente usa STOP → il send si risolve con errore →
      // il support agent recupera e riprompta (promptCount aumenta → anti-loop).
      await this.#piBridge?.send(fakeWs, { sessionKey: sk, text: prompt, _preserveWs: true });
      this.#log("lh-response-done", { sessionKey: sk, unit: unit.id });
    } catch (e: any) {
      this.#log("lh-send-error", { sessionKey: sk, unit: unit.id, error: e?.message });
    } finally {
      this.#inflight.set(sk, false);
    }
    // Dopo la risposta: l'handoff è stato aggiornato dal modello?
    const st2 = this.#states.get(sk);
    if (st2) {
      const sig = this.#handoffSig(sk);
      if (sig && sig !== st2.lastHandoffSig) {
        // handoff aggiornato dal modello → unità done
        const u = st2.units?.[st2.currentIdx];
        if (u) { u.status = "done"; }
        st2.lastHandoffSig = sig;
        st2.promptCount = 0;
        this.#log("lh-unit-done", { sessionKey: sk, unit: unit.id, source: "model-handoff" });
      } else {
        // Fallback deterministico: se il modello non ha scritto handoff.md,
        // l'agente di supporto lo scrive dall'ultima risposta (il loop non si ferma mai).
        const resp = this.#lastAssistantText(sk);
        if (resp.trim()) {
          const u = st2.units?.[st2.currentIdx];
          const entry = `\n## Unità ${unit.id} (completata)\n- Cosa: ${u?.desc || unit.desc}\n- Risultato: ${resp.slice(0, 800)}\n`;
          try {
            fs.mkdirSync(this.#dir(sk), { recursive: true });
            fs.appendFileSync(this.#handoffFile(sk), entry, "utf8");
          } catch {}
          if (u) u.status = "done";
          st2.lastHandoffSig = this.#handoffSig(sk);
          st2.promptCount = 0;
          this.#log("lh-unit-done", { sessionKey: sk, unit: unit.id, source: "auto-handoff" });
        } else {
          st2.lastHandoffSig = sig;
          this.#log("lh-unit-no-progress", { sessionKey: sk, unit: unit.id });
        }
      }
      // git after (sempre, se l'unità è andata avanti)
      const u2 = st2.units?.[st2.currentIdx];
      if (u2?.status === "done") {
        try { this.#git(sk, ["add", "-A"]); this.#git(sk, ["commit", "-m", `unit-${unit.id}: after`, "--allow-empty", "-q"]); } catch {}
      }
      this.#writeState(sk);
      this.#writeProgress(sk);
    }
  }

  #parseUnits(planMd: string): { desc: string }[] {
    const units: { desc: string }[] = [];
    for (const line of String(planMd || "").split("\n")) {
      const m = line.trim().match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
      if (m) units.push({ desc: m[2].trim() });
    }
    return units;
  }

  #lastAssistantText(sk: string): string {
    try {
      const hist = this.#piBridge?.getHistory?.(sk);
      if (Array.isArray(hist)) {
        for (let i = hist.length - 1; i >= 0; i--) {
          const m = hist[i];
          if (m?.role === "assistant") {
            const c = m.content;
            if (typeof c === "string") return c;
            if (Array.isArray(c)) {
              const t = c.filter((b: any) => b?.type === "text" && b.text).map((b: any) => b.text).join(" ");
              if (t) return t;
            }
          }
        }
      }
    } catch {}
    return "";
  }

  async #sendToSession(sk: string, text: string) {
    try {
      const fakeWs = { readyState: 1, constructor: { OPEN: 1 }, send: () => {} };
      await this.#piBridge?.send(fakeWs, { sessionKey: sk, text, _preserveWs: true });
    } catch {}
  }

  // Prompt nascosto: messaggio utente che entra nel contesto (triggera il modello)
  // ma NON è visibile in chat (flag hidden:true, filtrato in getHistory).
  async #sendHiddenToSession(sk: string, text: string) {
    try {
      await this.#piBridge?.sendHiddenUserMessage(sk, text);
    } catch {}
  }
}
