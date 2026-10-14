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
import { poolActive, ownerPool, poolIndex, isPoolWorkerAlive, ensureWorker } from "./pool-router";
import { isExpertSidecar } from "./pi-bridge";

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
  // LH v2 (14 ott): messaggio di sistema UI + save/restore della compaction
  systemMessage?: string;
  prevCompactionAuto?: boolean;
  prevCompactionThreshold?: number;
  prevCompactionSaved?: boolean;
  compactionForced?: boolean;
  compactionEnsured?: boolean;
}

const UNIT_PROMPT_TEMPLATE = `We are in the EXECUTION phase. Continue the work. Current unit: {desc} (unit {n} of {total}; {remaining} remaining after this one).

ALREADY COMPLETED — do NOT redo, revisit or re-verify these units (they are done):
{doneList}

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

const DONE_MESSAGE = `The plan is complete. Do a final full verification: check that everything works, update handoff.md with the final summary, and make a final commit 'plan: complete'. Then reply with a summary of the work done.`;

export class LongHorizon {
  #agentDir: string;
  #piBridge: any = null;
  #timer: any = null;
  #logger: ((tag: string, data: any) => void) | null = null;
  onNotify: ((payload: any) => void) | null = null;
  #states = new Map<string, LHState>();
  #inflight = new Map<string, boolean>(); // sessione con send in corso
  #lastPhaseSent = new Map<string, string>(); // LH v2: ultima fase propagata al pi-bridge (anti-spam log)

  constructor(agentDir: string) {
    this.#agentDir = agentDir;
    this.#loadAll();
  }

  setPiBridge(pb: any) {
    this.#piBridge = pb;
    // LH v2 (14 ott): al wiring propaga la fase di TUTTI gli stati attivi già caricati da
    // disco (il constructor gira PRIMA di setPiBridge → #loadAll non poteva chiamare il
    // bridge). È la cura del bug "la sessione non sapeva di essere in LH" sui worker.
    try {
      for (const [sk, st] of this.#states) {
        if (!st.active) continue;
        try { pb.setLongHorizonPhase?.(sk, st.phase || "discussion"); this.#lastPhaseSent.set(sk, st.phase || "discussion"); } catch {}
        try { if (st.compactionForced) pb.setSessionCompaction?.(sk, true, 80); } catch {}
      }
    } catch {}
  }
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
              ...st,
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
    // FIX F6 (02 set): RIATTIVAZIONE CHE RIPRENDE — se esiste uno stato spento (disable
    // precedente), NON si riparte da zero: goal/piano/handoff restano, fase discussion,
    // l'utente ridiscute/approva e riparte come col pause.
    if (existing) {
      existing.active = true;
      existing.phase = "discussion";
      existing.status = "idle";
      existing.promptCount = 0;
      existing.pendingGoal = undefined;
      existing.startedAt = Date.now();
      existing.lastActivity = Date.now();
      this.#states.set(sk, existing);
      this.#writeState(sk);
      this.#writeProgress(sk);
      this.#log("lh-reactivated-from-previous", { sessionKey: sk, units: existing.units.length });
      this.#piBridge?.setLongHorizonPhase(sk, "discussion");
      this.#lastPhaseSent.set(sk, "discussion");
      // LH v2: compaction SEMPRE ON in LH (save della precedente → restore all'uscita)
      this.#forceCompaction(sk, existing);
      return { ok: true, note: "resumed previous state" };
    }
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
    this.#lastPhaseSent.set(sk, "discussion");
    // LH v2: compaction SEMPRE ON in LH (save della precedente → restore all'uscita)
    this.#forceCompaction(sk, st);
    // Messaggio di SISTEMA per l'UTENTE (hardcoded, sempre uguale): UI-only, NON entra nel contesto del modello.
    st.systemMessage = `Long Horizon is now active for this session. It is a guided, phase-based working mode. The conversation moves through three phases, and you control every transition with the buttons that appear in the chat.\n\nPHASE 1 — DISCUSSION (automatic, starts now)\nYou and the agent discuss the problem together to understand the goal, the constraints, and the approach. The agent can examine files, search the codebase, and use its skills to study the problem. It CANNOT modify, create, or delete anything.\n\nPHASE 2 — PLANNING\nWhen you are satisfied with the discussion, press "Proceed to planning". The agent proposes a concrete plan divided into units, one per line, in '- [ ]' format. You can keep discussing and adding things. The agent still CANNOT modify anything.\n\nPHASE 3 — START (EXECUTION)\nWhen you press "Start", the agent creates the final plan and the support files, then works through the plan units one at a time, autonomously. It updates handoff.md after each unit and commits progress to git.\n\nHOW THE MODES WORK\n- During DISCUSSION and PLANNING the session runs in PLAN MODE: the agent can read, search, and use skills, but the write/edit/bash tools are disabled (bash is available read-only). It is physically unable to modify anything.\n- During START the session switches to BUILD MODE: all tools are enabled and the agent can create, edit, and execute freely.\n- If you pause, the session returns to DISCUSSION (PLAN MODE again). You can discuss changes, then go through PLANNING and START again.\n\nRULES\n- The agent is always in exactly one phase and cannot change it on its own.\n- Only you can advance the phases, with the buttons in the chat.\n- During DISCUSSION and PLANNING the agent never executes anything.\n- During EXECUTION the agent works autonomously.\n\nThe first phase (DISCUSSION) starts now. Tell the agent the problem you want to work on.`;
    this.#writeState(sk);
    return { ok: true };
  }

  // LH v2: compaction ON durante LH + save/restore del valore precedente.
  #forceCompaction(sk: string, st: any) {
    try {
      if (!st.prevCompactionSaved) {
        const cur = this.#piBridge?.getSessionCompaction?.(sk) || {};
        st.prevCompactionAuto = cur.auto;
        st.prevCompactionThreshold = cur.threshold;
        st.prevCompactionSaved = true;
      }
      st.compactionForced = true;
      this.#piBridge?.setSessionCompaction?.(sk, true, 80);
      this.#log("lh-compaction-forced", { sessionKey: sk, prevAuto: st.prevCompactionAuto });
    } catch {}
  }
  #restoreCompaction(sk: string, st: any) {
    try {
      if (!st.prevCompactionSaved) return;
      this.#piBridge?.setSessionCompaction?.(
        sk,
        typeof st.prevCompactionAuto === "boolean" ? st.prevCompactionAuto : true,
        typeof st.prevCompactionThreshold === "number" ? st.prevCompactionThreshold : undefined
      );
      this.#log("lh-compaction-restored", { sessionKey: sk, auto: st.prevCompactionAuto, threshold: st.prevCompactionThreshold });
      st.prevCompactionSaved = false;
      st.compactionForced = false;
    } catch {}
  }

  // Disattiva COMPLETAMENTE Long Horizon per la sessione (usato quando la chat viene eliminata)
  disable(sk: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st) return { ok: true };
    // LH v2: uscita da LH → si ripristina la compaction com'era prima
    this.#restoreCompaction(sk, st);
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

  // Pausa (LH v2, decisione utente 14 ott): NON spegne la modalità — torna alla DISCUSSION,
  // Long Horizon resta ATTIVO (banner in chat con "Proceed to planning"). Da lì si ridiscute,
  // si aggiorna il piano e si riparte. Lo spegnimento VERO è disable() (RPC longHorizonDisable).
  deactivate(sk: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st) return { ok: false, error: "not active" };
    // LH v2: la PAUSA ferma la generazione in maniera COMPLETA (regola utente: "quando vai
    // in pausa devi stoppare la generazione"). L'abort è per-QUESTA-sessione e il router
    // lo copre su tutti i processi dove la sessione può girare.
    try { this.#piBridge?.abort?.(sk); } catch {}
    st.phase = "discussion";
    st.status = "paused";
    st.lastActivity = Date.now();
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-paused", { sessionKey: sk, note: "long horizon resta attivo, fase discussion" });
    this.#piBridge?.setLongHorizonPhase(sk, "discussion");
    // LH v2.1 (regola utente): fermare il turno E mandare il messaggio nello STESSO istante
    // perdeva lo streaming (race). Ora: prima si ferma, si ASPETTA che il turno sia davvero
    // finito, POI parte il messaggio di fase.
    this.#sendWhenTurnIdle(sk, `Long Horizon is paused. We are now back in the DISCUSSION phase. Do not execute anything.`);
    return { ok: true };
  }

  // Manda un messaggio di fase SOLO quando non c'è nessun turno in corso/in coda (con cap).
  #sendWhenTurnIdle(sk: string, text: string, maxWaitMs = 20000) {
    const started = Date.now();
    const tickFn = () => {
      try {
        const t = this.#piBridge?.getTurnState?.(sk);
        const streaming = (this.#piBridge?.getStreamingStatus?.() || []).includes(sk);
        if ((!t || !t.pending) && !streaming) { this.#sendToSession(sk, text); return; }
      } catch {}
      if (Date.now() - started > maxWaitMs) { this.#sendToSession(sk, text); return; }
      setTimeout(tickFn, 500);
    };
    setTimeout(tickFn, 400);
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
    this.#sendToSession(sk, `Long Horizon: we are now in the DISCUSSION phase again. Ask me what new problem I want to work on. Do not execute anything.`);
    return { ok: true };
  }

  // Transizione di fase controllata dall'utente (via la sezione in chat)
  setPhase(sk: string, phase: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st || !st.active) return { ok: false, error: "Long Horizon not active" };
    // LH v2 (regola utente 14 ott): le transizioni di fase NON procedono MAI mentre un turno
    // è in corso o in coda — "finché la generazione non si è fermata, non deve succedere nulla".
    try {
      const t = this.#piBridge?.getTurnState?.(sk);
      const streaming = (this.#piBridge?.getStreamingStatus?.() || []).includes(sk);
      if (streaming || t?.pending) {
        this.#log("lh-phase-blocked-turn-active", { sessionKey: sk, phase, streaming, pending: !!t?.pending });
        return { ok: false, error: "A turn is running. Wait for it to finish, or press Stop." };
      }
    } catch {}
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
        this.#sendToSession(sk, `We are now in the PLANNING phase. Update the previous plan you were following based on our latest discussion. Keep the units that are still valid, modify the ones that changed, and add new ones if needed. Output the updated plan with units in '- [ ]' format. Do not execute anything.`);
      } else {
        this.#sendToSession(sk, `We are now in the PLANNING phase. Propose a plan for the goal we discussed, divided into units in '- [ ]' format. Do not execute anything.`);
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
      this.#sendToSession(sk, `We are now in the EXECUTION phase. Begin working through the plan units one at a time. Update handoff.md after each unit and commit to git.`);
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
    if (!st || !st.active) return { ok: false, error: "Long Horizon not active. Use /LongHorizon first." };
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

  // === LH v2 (14 ott): RAGGRUPPAMENTO commit di servizio (soglia 25) ===
  // I commit unit-N restano nella storia del PROGETTO (voluto dall'utente), ma non se ne
  // accumulano più di ~25 "fini": i più vecchi vengono collassati in UN blocco unico.
  // Sicurezze: gira solo a tree pulito (mai durante un turno), e su qualunque errore
  // fa rebase --abort senza toccare nulla.
  #gitCollapse(sk: string) {
    const KEEP = 25;
    const isLhCommit = (s: string) => /^unit-\d+: (before|after)/.test(s) || s === "plan: complete" || s.startsWith("Long Horizon: ");
    try {
      const stt = this.#git(sk, ["status", "--porcelain"]);
      if (!stt.ok || stt.out.trim()) return; // tree sporco → si riprova la prossima volta
      const lg = this.#git(sk, ["log", "--reverse", "--format=%H%x1f%s"]);
      if (!lg.ok) return;
      const all = lg.out.split("\n").filter(Boolean).map(l => { const p = l.split("\x1f"); return { h: p[0], s: p[1] || "" }; });
      const lhCount = all.filter(c => isLhCommit(c.s)).length;
      if (lhCount <= KEEP) return;
      const howMany = lhCount - KEEP;
      // blocco più vecchio CONTIGUO di commit LH
      const run: { h: string; s: string }[] = [];
      for (const c of all) { if (isLhCommit(c.s)) run.push(c); else if (run.length) break; }
      if (run.length < 2) return;
      const toCollapse = run.slice(0, Math.min(run.length, howMany));
      if (toCollapse.length < 2) return;
      const first = toCollapse[0], last = toCollapse[toCollapse.length - 1];
      const parent = this.#git(sk, ["rev-parse", first.h + "^"]);
      if (!parent.ok) return;
      const tree = this.#git(sk, ["rev-parse", last.h + "^{tree}"]);
      if (!tree.ok) return;
      const msg = `Long Horizon: grouped ${toCollapse.length} service commits`;
      const nt = this.#git(sk, ["commit-tree", tree.out.trim(), "-p", parent.out.trim(), "-m", msg]);
      if (!nt.ok || !nt.out.trim()) return;
      const rb = this.#git(sk, ["rebase", "--onto", nt.out.trim(), last.h]);
      if (!rb.ok) {
        try { this.#git(sk, ["rebase", "--abort"]); } catch {}
        this.#log("lh-git-collapse-fail", { sessionKey: sk, err: (rb.err || "").slice(0, 160) });
        return;
      }
      this.#log("lh-git-collapse", { sessionKey: sk, collapsed: toCollapse.length, from: first.h.slice(0, 8), to: last.h.slice(0, 8) });
    } catch (e: any) {
      this.#log("lh-git-collapse-error", { sessionKey: sk, err: e?.message });
    }
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
    // FIX POOL (31 ago): re-scan degli stati da disco a OGNI tick. Il Long Horizon
    // ora gira su TUTTI i processi del pool — l'ATTIVAZIONE avviene sul MAIN (RPC),
    // ma il SUPPORT AGENT gira sul WORKER che possiede la sessione. Senza re-scan,
    // il worker non vedrebbe MAI le sessioni attivate dopo il suo boot.
    try { this.#rescan(); } catch {}
    for (const sk of this.listActive()) {
      try { await this.#tickSession(sk); } catch (e: any) { this.#log("lh-tick-error", { sessionKey: sk, error: e?.message }); }
    }
  }

  #rescan() {
    try {
      const dir = path.join(this.#agentDir, "longhorizon");
      if (!fs.existsSync(dir)) return;
      for (const d of fs.readdirSync(dir)) {
        if (this.#inflight.get(d)) continue;
        try {
          const sf = path.join(dir, d, "state.json");
          if (!fs.existsSync(sf)) continue;
          const st = JSON.parse(fs.readFileSync(sf, "utf8"));
          if (!st || !st.active) {
            if (this.#states.has(d)) { this.#states.delete(d); this.#log("lh-rescan-deactivated", { sessionKey: d }); }
            // LH v2: stato spento → fase azzerata anche nel pi-bridge di QUESTO processo
            // (solo se l'avevamo pubblicata: niente chiamate/log inutili a ogni rescan)
            try { if (this.#lastPhaseSent.has(d)) { this.#piBridge?.setLongHorizonPhase?.(d, ""); this.#lastPhaseSent.delete(d); } } catch {}
            continue;
          }
          const cur = this.#states.get(d);
          if (!cur) {
            this.#states.set(d, { ...st, units: Array.isArray(st.units) ? st.units : [] });
            this.#log("lh-rescan-new", { sessionKey: d, status: st.status });
            // LH v2: propaga la fase al pi-bridge di QUESTO processo (worker del pool inclusi)
            try { this.#piBridge?.setLongHorizonPhase?.(d, st.phase || "discussion"); this.#lastPhaseSent.set(d, st.phase || "discussion"); } catch {}
            // LH v2: compaction SEMPRE ON in LH (self-heal, una volta per stato)
            try {
              if (!(st as any).compactionEnsured) {
                (this.#states.get(d) as any).compactionEnsured = true;
                this.#writeState(d);
                this.#piBridge?.setSessionCompaction?.(d, true, 80);
                this.#log("lh-compaction-forced-rescan", { sessionKey: d });
              }
            } catch {}
          } else {
            cur.phase = st.phase || cur.phase;
            cur.status = st.status || cur.status;
            cur.active = !!st.active;
            if (Array.isArray(st.units)) cur.units = st.units;
            // LH v2: fase cambiata da un altro processo (es. RPC sul main) → ripubblica qui
            const ph = st.phase || cur.phase;
            if (this.#lastPhaseSent.get(d) !== ph) {
              try { this.#piBridge?.setLongHorizonPhase?.(d, ph); this.#lastPhaseSent.set(d, ph); } catch {}
            }
          }
        } catch {}
      }
    } catch {}
  }

  async #tickSession(sk: string) {
    const st = this.#states.get(sk);
    if (!st || !st.active) return;
    if (this.#inflight.get(sk)) return; // send in corso

    // === LH v2.2 (14 ott, evidenza nei log): il sidecar EXPERT non tocca MAI le sessioni LH
    // che non sono le sue. Prima l'Expert correva IN PARALLELO all'owner worker sulla stessa
    // sessione → prompt doppi, unità avanti a strappi, race continue/recovery. ===
    if (isExpertSidecar() && sk !== "__app_expert__") return;

    // === FIX POOL (31 ago): il Long Horizon gira SOLO sul MAIN, ma la sessione
    // può appartenere a un WORKER del pool. Senza questo check, il support agent
    // === FIX POOL SOLIDO (31 ago): ogni processo del pool ha il SUO Long Horizon.
    // Il support agent gira dove VIVE la sessione (owner check). L'ATTIVAZIONE avviene
    // sul MAIN (RPC → state.json su disco) — ogni worker la vede tramite #rescan().
    // STATIC import (affidabile nel binary compilato, zero overhead del dynamic).
    try {
      if (poolActive() && ownerPool(sk) !== poolIndex()) {
        // LH v2 (regola utente 14 ott: "la Long Horizon deve funzionare nel worker/pool come
        // tutto il resto"): il support agent NON lavora MAI sessioni di altri processi.
        // Se il worker owner non è vivo, il MAIN lo fa NASCERE: al boot il worker #rescan
        // trova lo stato attivo e prende in carico il ticking (come ogni altra cosa).
        // Prima il main "prendeva in carico" la sessione → split-brain: turni sul main,
        // stop instradato al worker, streaming perso.
        if (poolIndex() === 0 && !isPoolWorkerAlive(ownerPool(sk))) {
          // Solo se c'è VERO lavoro da fare (running o auto-plan): niente spawn a vuoto
          // durante la discussione in attesa dell'utente (evita churn ogni 10 min).
          if (st.status === "running" || st.pendingGoal) {
            this.#log("lh-spawn-owner-worker", { sessionKey: sk, owner: ownerPool(sk), status: st.status });
            try { ensureWorker(ownerPool(sk)); } catch {}
          }
        } else {
          this.#log("lh-skip-pool-worker-session", { sessionKey: sk, owner: ownerPool(sk), myIndex: poolIndex() });
        }
        return;
      }
    } catch {}

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

    // (LH v2.3: RIMOSSO il rilevatore anti-loop — regola utente 14 ott: "niente prompt anti loop".
    // Partiva anche DURANTE i turni attivi e faceva casino; il support agent ora parla SOLO a
    // turno finito e pulito, e non deve mai giudicare/fermare il lavoro da solo.)

    // Se la sessione sta ancora generando (streaming attivo) → aspetta
    try {
      const ss = this.#piBridge?.getStreamingStatus?.();
      const streaming = (ss || []).includes(sk);
      if (streaming) return;
    } catch {}

    // === LH v2 (regola utente 14 ott): il support agent parla SOLO a turno COMPLETAMENTE
    // finito e PULITO. pending = turno in corso O in coda (mai prompt a raffica: il bug dei
    // 10 secondi dopo Start); clean=false = ultimo turno chiuso con STOP dell'utente o con
    // errore → il support agent sta zitto e aspetta (gli errori li gestisce l'autoprompt
    // standard dell'app; dopo un turno pulito nato da un messaggio utente, riprende). ===
    try {
      const tstate = this.#piBridge?.getTurnState?.(sk);
      if (tstate?.pending) return;
      if (tstate && tstate.clean === false) { this.#log("lh-wait-dirty-turn", { sessionKey: sk, stopReason: tstate.stopReason }); return; }
    } catch {}

    if (st.currentIdx < 0) return; // nessuna unità impostata
    let unit = st.units?.[st.currentIdx];
    if (!unit) return;

    if (unit.status === "done") {
      // passa alla prossima unità pending
      const next = (st.units || []).findIndex((u, i) => i > st.currentIdx && u.status === "pending");
      if (next === -1) {
        // LH v2.3 (evidenza 14 ott): IL PIANO È COMPLETO SOLO SE TUTTE LE UNITÀ SONO DONE.
        // La ricerca era solo in AVANTI: un'unità rimasta indietro (aggiornamento perso in
        // una race) veniva ignorata e il piano "si completava da solo" (visto: unit 1
        // pending, unit 2-10 done → discussion senza motivo).
        const firstPending = (st.units || []).findIndex(u => u.status === "pending");
        if (firstPending !== -1) {
          st.currentIdx = firstPending;
          st.promptCount = 0;
          st.lastHandoffSig = this.#handoffSig(sk);
          st.lastActivity = Date.now();
          this.#writeState(sk);
          this.#writeProgress(sk);
          this.#log("lh-back-to-pending-unit", { sessionKey: sk, unit: (st.units || [])[firstPending]?.id });
          return;
        }
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
    // (LH v2.3: rimosso lo STUCK_MESSAGE — mai più prompt "anti-loop": il support agent
    // manda solo il "continue" e nulla più; mai mentre un turno è attivo/in coda.)
    if (unit.status === "pending") {
      st.promptCount++;
      st.lastActivity = Date.now();
      this.#writeState(sk);
      this.#writeProgress(sk);
      this.#sendUnitPrompt(sk, unit).catch(() => {});
    }
  }

  async #sendPlanRequest(sk: string, st: LHState, goal: string) {
    const prompt = `We are now in the PLANNING phase (Long Horizon mode). The user's goal is: "${goal}".\n\nCreate a plan to achieve this goal. Divide it into units, one per line, in this exact format:\n- [ ] Unit 1: description\n- [ ] Unit 2: description\n...\n\nDo NOT execute anything yet. Only output the plan with the units.`;
    this.#inflight.set(sk, true);
    this.#log("lh-plan-request", { sessionKey: sk });
    try {
      const fakeWs = { readyState: 1, constructor: { OPEN: 1 }, send: () => {} };
      await this.#piBridge?.send(fakeWs, { sessionKey: sk, text: prompt, _preserveWs: true, _lean: true, _lhPhase: st.phase || "planning" });
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
    const handoff = this.#readHandoff(sk).slice(-1500) || "(no handoff yet — write the first one after unit 1)";
    const totalUnits = st?.units?.length || 0;
    const doneUnits = (st?.units || []).filter(u => u.status === "done");
    const remaining = Math.max(0, (st?.units || []).filter(u => u.status !== "done").length - 1);
    const doneList = doneUnits.length > 0
      ? doneUnits.slice(-12).map(u => `- Unit ${u.id}: ${String(u.desc || "").slice(0, 90)}`).join("\n")
      : "(none yet)";
    const prompt = UNIT_PROMPT_TEMPLATE
      .replace("{desc}", unit.desc)
      .replace("{handoff}", handoff)
      .replace("{sessionKey}", String(sk).replace(/[^a-zA-Z0-9_-]/g, "_"))
      .replace("{n}", String(unit.id))
      .replace("{total}", String(totalUnits))
      .replace("{remaining}", String(remaining))
      .replace("{doneList}", doneList);
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
      await this.#piBridge?.send(fakeWs, { sessionKey: sk, text: prompt, _preserveWs: true, _lean: true, _lhPhase: "running" });
      this.#log("lh-response-done", { sessionKey: sk, unit: unit.id });
    } catch (e: any) {
      this.#log("lh-send-error", { sessionKey: sk, unit: unit.id, error: e?.message });
    } finally {
      this.#inflight.set(sk, false);
    }
    // Dopo la risposta: l'handoff è stato aggiornato dal modello?
    const st2 = this.#states.get(sk);
    if (st2) {
      // LH v2: se il turno è finito SPORCO (stop utente o errore) non si segna nulla e non
      // si ri-promptа: si aspetta un turno pulito (errori → autoprompt standard dell'app).
      try {
        const tstate = this.#piBridge?.getTurnState?.(sk);
        if (tstate && tstate.clean === false) {
          this.#log("lh-turn-dirty-skip", { sessionKey: sk, unit: unit.id, stopReason: tstate.stopReason });
          this.#writeState(sk);
          return;
        }
      } catch {}
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
          const entry = `\n## Unit ${unit.id} (completed)\n- What: ${u?.desc || unit.desc}\n- Result: ${resp.slice(0, 800)}\n`;
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
        // LH v2: raggruppamento (soglia 25) — mai più di ~25 commit LH "fini" in storia
        try { this.#gitCollapse(sk); } catch {}
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
      // FIX 084 (03 set): NON await — send() resolve a FINE TURNO (l'LLM risponde
      // al messaggio). I messaggi di FASE (pause/resume/discussion) bloccavano la
      // RPC per 30-60s (timeout lato frontend!). Fire-and-forget: il cambio di fase
      // è già avvenuto nello stato, il messaggio è informativo.
      // LH v2: _lhPhase viaggia nel payload (tutti i processi sanno la fase) e _lean
      // (al modello va SOLO il testo del prompt, senza blocchi extra: regola token).
      this.#piBridge?.send(fakeWs, { sessionKey: sk, text, _preserveWs: true, _lean: true, _lhPhase: this.#states.get(sk)?.phase || "" }).catch(() => {});
    } catch {}
  }
}
