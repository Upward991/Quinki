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
  status: "idle" | "running" | "done" | "paused";
  units: LHUnit[];
  currentIdx: number; // 0-based; -1 = nessuna unità ancora
  promptCount: number; // prompt inviati per l'unità corrente (anti-loop)
  lastHandoffSig: string;
  startedAt: number;
  lastActivity: number;
}

const UNIT_PROMPT_TEMPLATE = `Continua il lavoro. Unità corrente: {desc}.

Contesto: {handoff}

Ricorda SEMPRE:
- Aggiorna handoff.md (cosa hai fatto, come, perché) in ~/.quinki/longhorizon/{sessionKey}/handoff.md
- Aggiorna il piano (plan.md)
- Usa tutte le skill a disposizione
- Crea ciò che ti serve (agenti, file, tool)
- Non fare danni
- Prima di iniziare: git commit 'unit-{n}: before' nella workdir
- Quando finisci: fai i test, e vai avanti SOLO se tutto funziona
- Poi: git commit 'unit-{n}: after'

Rispondi quando hai completato l'unità.`;

const STUCK_MESSAGE = `Ma che cazzo stai facendo? Stai girando a vuoto: hai ripetuto le stesse azioni senza aggiornare handoff.md. Fermati, rileggi l'unità corrente, e riparti con un approccio diverso. Aggiorna handoff.md appena fai progresso.`;

const DONE_MESSAGE = `Il piano è completo. Fai una verifica finale completa: controlla che tutto funzioni, aggiorna handoff.md con il riepilogo finale, e fai un commit finale 'plan: complete'. Poi rispondi con il riepilogo del lavoro svolto.`;

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
        units: st.units.map((u, i) => ({ id: u.id, desc: u.desc, status: u.status, current: i === st.currentIdx })),
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
            this.#states.set(d, { ...st });
            this.#log("lh-loaded", { sessionKey: d, status: st.status });
          }
        } catch {}
      }
    } catch {}
  }

  // === RPC API ===

  // Attiva Long Horizon per la sessione (il piano verrà impostato con setPlan)
  activate(sk: string): { ok: boolean; error?: string } {
    if (!sk) return { ok: false, error: "sessionKey required" };
    const existing = this.#states.get(sk);
    if (existing?.active) return { ok: true, note: "already active" };
    const st: LHState = {
      active: true,
      goal: "",
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
    return { ok: true };
  }

  // Disattiva (pausa) Long Horizon per la sessione
  deactivate(sk: string): { ok: boolean; error?: string } {
    const st = this.#states.get(sk);
    if (!st) return { ok: false, error: "not active" };
    st.active = false;
    st.status = "paused";
    st.lastActivity = Date.now();
    this.#writeState(sk);
    this.#writeProgress(sk);
    this.#log("lh-deactivated", { sessionKey: sk });
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
      const wd = this.#workdir(sk);
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
      status: st.status,
      currentIdx: st.currentIdx,
      units: st.units,
      promptCount: st.promptCount,
      startedAt: st.startedAt,
      lastActivity: st.lastActivity,
    };
  }

  listActive(): string[] {
    const out: string[] = [];
    for (const [sk, st] of this.#states) if (st.active) out.push(sk);
    return out;
  }

  // === Git helpers (workdir della sessione) ===
  #git(sk: string, args: string[]): { ok: boolean; out: string; err: string } {
    const wd = this.#workdir(sk);
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
    if (st.status !== "running") return;
    if (this.#inflight.get(sk)) return; // send in corso

    // Se la sessione sta ancora generando (streaming attivo) → aspetta
    try {
      const ss = this.#piBridge?.getStreamingStatus?.();
      const streaming = (ss || []).includes(sk);
      if (streaming) return;
    } catch {}

    if (st.currentIdx < 0) return; // nessuna unità impostata
    let unit = st.units[st.currentIdx];
    if (!unit) return;

    if (unit.status === "done") {
      // passa alla prossima unità pending
      const next = st.units.findIndex((u, i) => i > st.currentIdx && u.status === "pending");
      if (next === -1) {
        // piano completo
        st.status = "done";
        st.lastActivity = Date.now();
        this.#writeState(sk);
        this.#writeProgress(sk);
        this.#log("lh-completed", { sessionKey: sk, units: st.units.length });
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
      await this.#sendUnitPrompt(sk, unit);
    }
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
        const u = st2.units[st2.currentIdx];
        if (u) { u.status = "done"; }
        st2.lastHandoffSig = sig;
        st2.promptCount = 0;
        this.#log("lh-unit-done", { sessionKey: sk, unit: unit.id, source: "model-handoff" });
      } else {
        // Fallback deterministico: se il modello non ha scritto handoff.md,
        // l'agente di supporto lo scrive dall'ultima risposta (il loop non si ferma mai).
        const resp = this.#lastAssistantText(sk);
        if (resp.trim()) {
          const u = st2.units[st2.currentIdx];
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
      const u2 = st2.units[st2.currentIdx];
      if (u2?.status === "done") {
        try { this.#git(sk, ["add", "-A"]); this.#git(sk, ["commit", "-m", `unit-${unit.id}: after`, "--allow-empty", "-q"]); } catch {}
      }
      this.#writeState(sk);
      this.#writeProgress(sk);
    }
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
}
