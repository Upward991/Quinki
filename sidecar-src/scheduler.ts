// src/main/scheduler.ts — A2.2: programmazione compiti (Schedule Object, NON cron)
// Riscritto in EVENT-DRIVEN (A2.9): niente polling ogni 30s.
// Un solo setTimeout per la prossima occorrenza; ricalcolo su ogni modifica;
// scan catch-up solo al boot (app ripartita: i task scaduti partono comunque).
//
// schedules.json in ~/.quinki/ (condiviso tra main + Expert):
//   { id, title, agentIds, workingDir, mode, model, thinkingLevel, text, owner,
//     when: { type: once|daily|weekly|monthly, at: "HH:MM", daysOfWeek: [1..7], dayOfMonth: n, date: ISO },
//     enabled, catchUp, lastFiredAt, lastExecutionId, nextFireAt, createdAt }
//
// Ogni sidecar esegue SOLO le schedule con owner == se stesso (main 9182 / expert 9183).

import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { ExecutionEngine } from "./executor";

export interface ScheduleWhen {
  type: "once" | "daily" | "weekly" | "monthly" | "yearly" | "hourly" | "minutely";
  at?: string;            // HH:MM locale (daily/weekly/monthly/yearly; hourly = minuto dell'ora)
  daysOfWeek?: number[];  // 1=Mon..7=Sun (weekly)
  dayOfMonth?: number;    // 1..31 (monthly, clamp a fine mese; yearly)
  month?: number;          // 1..12 (yearly)
  interval?: number;       // N: minutely→ogni N min, hourly→ogni N ore, daily→ogni N giorni, weekly→ogni N settimane
  date?: string;          // ISO (once)
}

export interface Schedule {
  id: string;
  title: string;
  sourceSession?: { key: string; label: string };  // chat da cui è stata schedulata
  agentIds: string[];
  workingDir?: string;
  mode?: string;
  model?: string;
  thinkingLevel?: string;
  text: string;
  owner: "main" | "expert";
  when: ScheduleWhen;          // BACKWARD COMPAT: singola regola (vecchio formato)
  rules?: ScheduleWhen[];      // NUOVO: lista di regole — il task scatta quando QUALSIASI regola si attiva
  enabled: boolean;
  catchUp?: boolean;
  lastFiredAt: number;
  lastExecutionId: string | null;
  nextFireAt: number | null;
  createdAt: number;
}

export class Scheduler {
  #agentDir: string;
  #executor: ExecutionEngine;
  #owner: "main" | "expert";
  #timer: any = null;
  #scanning = false;
  #logger: ((tag: string, data: any) => void) | null = null;
  onNotify: ((payload: any) => void) | null = null;

  setLogger(fn: (tag: string, data: any) => void) { this.#logger = fn; }

  constructor(agentDir: string, executor: ExecutionEngine) {
    this.#agentDir = agentDir;
    this.#executor = executor;
    this.#owner = (process.env.QUINKI_ROLE || "").toLowerCase() === "expert" || process.env.QUINKI_WS_PORT === "9183" ? "expert" : "main";
  }

  get owner() { return this.#owner; }
  #file() { return path.join(this.#agentDir, "schedules.json"); }

  #log(tag: string, data: any) {
    try { this.#logger?.(tag, data); } catch {}
  }

  readSchedules(): Schedule[] {
    try {
      if (!fs.existsSync(this.#file())) return [];
      return JSON.parse(fs.readFileSync(this.#file(), "utf8") || "[]");
    } catch { return []; }
  }

  #writeSchedules(list: Schedule[]) {
    try {
      const tmp = this.#file() + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
      fs.renameSync(tmp, this.#file());
    } catch {}
  }

  #notify() {
    try { this.onNotify?.({ schedules: this.readSchedules() }); } catch {}
  }

  // === EVENT-DRIVEN: un solo timer per la prossima occorrenza ===
  start() {
    // Catch-up immediato al boot (app ripartita: i task scaduti DEVONO partire, anche in ritardo)
    // poi #scan() riposiziona il timer sulla prossima occorrenza.
    this.#scan();
    this.#log("scheduler-started", { owner: this.#owner, mode: "event-driven" });
  }

  stop() { if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; } }

  // Ricalcola e riposiziona il timer sulla prossima occorrenza (una sola attiva).
  #scheduleNext() {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    const now = Date.now();
    let earliest: number | null = null;
    for (const s of this.readSchedules()) {
      if (!s.enabled) continue;
      if (s.owner !== this.#owner) continue; // il main esegue solo le sue, l'expert solo le sue
      const next = s.nextFireAt ?? this.#computeNext(s, s.lastFiredAt || 0);
      if (next == null) continue;
      if (earliest == null || next < earliest) earliest = next;
    }
    if (earliest == null) return;
    // +50ms di sicurezza: mai scattare prima dell'ora esatta
    const delay = Math.max(0, earliest - Date.now()) + 50;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#scan();
    }, delay);
  }

  // === Calcolo prossima occorrenza > afterTs ===
  // Supporta: when singolo (backward compat) + rules[] (multi-rule, libertà totale)
  #parseAt(at: string): { h: number; m: number } {
    const p = String(at || "08:00").split(":");
    return { h: parseInt(p[0], 10) || 0, m: parseInt(p[1], 10) || 0 };
  }

  #rulesOf(s: Schedule): ScheduleWhen[] {
    if (Array.isArray(s.rules) && s.rules.length > 0) return s.rules;
    return [s.when];
  }

  #isAllOnce(s: Schedule): boolean {
    return this.#rulesOf(s).every((r: ScheduleWhen) => r.type === "once");
  }

  #computeNext(s: Schedule, afterTs: number): number | null {
    const rules = this.#rulesOf(s);
    // Multi-rule: prendi il SOONEST tra tutte le regole
    let soonest: number | null = null;
    for (const rule of rules) {
      const next = this.#computeNextSingle(rule, s, afterTs);
      if (next != null && (soonest == null || next < soonest)) soonest = next;
    }
    return soonest;
  }

  #computeNextSingle(when: ScheduleWhen, s: Schedule, afterTs: number): number | null {
    if (!when || !when.type) return null;
    const now = Date.now();
    const interval = Math.max(1, Number(when.interval || 1));

    // === MINUTELY: ogni N minuti da createdAt ===
    if (when.type === "minutely") {
      const created = s.createdAt || now;
      const step = interval * 60000;
      const elapsed = now - created;
      const next = created + Math.ceil(elapsed / step) * step;
      return next > afterTs ? next : null;
    }

    // === HOURLY: ogni N ore, al minuto specificato (default :00) ===
    if (when.type === "hourly") {
      const { m } = this.#parseAt(when.at || "00:00");
      const step = interval * 3600000;
      // allinea all'ora piena più vicina + minuto
      const now2 = new Date(now);
      now2.setMinutes(m, 0, 0);
      let candidate = now2.getTime();
      // se il candidato con interval è nel passato, avanz a step
      while (candidate <= afterTs) candidate += step;
      // riallinea al minuto dell'ora
      const c = new Date(candidate);
      c.setMinutes(m, 0, 0);
      return c.getTime() > afterTs ? c.getTime() : c.getTime() + step;
    }

    // === ONCE: una data specifica ===
    if (when.type === "once") {
      const d = new Date(when.date || 0);
      if (isNaN(d.getTime())) return null;
      return d.getTime() > afterTs ? d.getTime() : null;
    }

    // === DAILY: ogni N giorni (interval=1 default) all'ora 'at' ===
    // === WEEKLY: giorni specifici, ogni N settimane ===
    // === MONTHLY: giorno del mese ===
    // === YEARLY: mese + giorno ===
    const { h, m } = this.#parseAt(when.at || "08:00");
    const base = new Date(); base.setHours(h, m, 0, 0);

    // === YEARLY: mese + giorno ===
    if (when.type === "yearly") {
      const mo = Math.max(0, Math.min(11, Number(when.month || 1) - 1));
      const dom = Math.max(1, Math.min(31, Number(when.dayOfMonth || 1)));
      for (let y = 0; y < 3; y++) {
        const cand = new Date(base.getFullYear() + y, mo, dom, h, m, 0, 0);
        if (cand.getTime() > afterTs) return cand.getTime();
      }
      return null;
    }

    // === DAILY / WEEKLY / MONTHLY: itera giorni ===
    const maxIter = when.type === "monthly" ? 800 : 400;
    for (let i = 0; i < maxIter; i++) {
      const cand = new Date(base.getTime() + i * 86400000);
      if (cand.getTime() <= afterTs) continue;

      if (when.type === "daily") {
        // ogni N giorni: verifica che la differenza da createdAt sia multiplo di interval
        if (interval > 1) {
          const createdDay = Math.floor((s.createdAt || now) / 86400000);
          const candDay = Math.floor(cand.getTime() / 86400000);
          if ((candDay - createdDay) % interval !== 0) continue;
        }
        return cand.getTime();
      }

      if (when.type === "weekly") {
        const days = (when.daysOfWeek || [1, 2, 3, 4, 5]).map((d: any) => Number(d));
        const jsDay = cand.getDay();
        const dayNum = jsDay === 0 ? 7 : jsDay;
        if (!days.includes(dayNum)) continue;
        // ogni N settimane: verifica la settimana relativa a createdAt
        if (interval > 1) {
          const createdWeek = Math.floor((s.createdAt || now) / (7 * 86400000));
          const candWeek = Math.floor(cand.getTime() / (7 * 86400000));
          if ((candWeek - createdWeek) % interval !== 0) continue;
        }
        return cand.getTime();
      }

      if (when.type === "monthly") {
        const dom = Number(when.dayOfMonth || 1);
        const candidateDay = new Date(cand.getFullYear(), cand.getMonth(), dom);
        if (candidateDay.getMonth() !== cand.getMonth()) {
          // dom non esiste in questo mese → salta
        } else if (cand.getDate() === dom) {
          return candidateDay.getTime();
        }
      }
    }
    return null;
  }

  // === Scan: fire le mie schedule in scadenza, poi riposiziona il timer ===
  async #scan() {
    if (this.#scanning) return;
    this.#scanning = true;
    try {
      const now = Date.now();
      const all = this.readSchedules();
      for (const s of all) {
        if (!s.enabled) continue;
        if (s.owner !== this.#owner) continue;
        const next = s.nextFireAt ?? this.#computeNext(s, s.lastFiredAt || 0);
        if (next == null) continue;
        if (now >= next) {
          this.#fire(s, next);
        }
      }
      // niente log a ogni tick (rumore): si logga solo quando qualcosa scatta
    } catch (e: any) {
      this.#log("scheduler-scan-error", { error: e?.message });
    } finally {
      this.#scanning = false;
      this.#scheduleNext();
    }
  }

  #fire(s: Schedule, scheduledFor: number) {
    const now = Date.now();
    const delayMs = Math.max(0, now - scheduledFor);
    // === Aggiorna lo stato PRIMA del run: la schedule non è più in scadenza (niente doppio fire) ===
    const all = this.readSchedules();
    const idx = all.findIndex((x: Schedule) => x.id === s.id);
    if (this.#isAllOnce(s)) {
      // tutte regole once → dopo il fire la schedule sparisce (l'esecuzione resta in history)
      if (idx >= 0) all.splice(idx, 1);
    } else {
      s.nextFireAt = this.#computeNext(s, now);
      if (idx >= 0) all[idx] = s;
    }
    this.#writeSchedules(all);
    this.#notify();
    // === Fire-and-forget: l'agente gira in background, la UI si aggiorna via execution_update ===
    this.#executor.runTask({
      label: s.title || "Scheduled task",
      agentIds: s.agentIds,
      workingDir: s.workingDir,
      mode: s.mode,
      model: s.model,
      thinkingLevel: s.thinkingLevel,
      text: s.text || "",
      owner: s.owner || this.#owner,
      scheduleId: s.id,
      scheduledFor,
      sourceSession: s.sourceSession,
    }).then((r: any) => {
      s.lastFiredAt = Date.now();
      s.lastExecutionId = r.executionId;
      const all2 = this.readSchedules();
      const idx2 = all2.findIndex((x: Schedule) => x.id === s.id);
      if (idx2 >= 0) { all2[idx2] = s; this.#writeSchedules(all2); }
      this.#log("schedule-fired", {
        scheduleId: s.id,
        title: s.title,
        delaySec: Math.round(delayMs / 1000),
        executionId: r.executionId,
        scheduledFor,
      });
      this.#notify();
    }).catch((e: any) => {
      this.#log("schedule-fire-error", { scheduleId: s.id, error: e?.message });
    });
  }

  // === RPC API ===
  createSchedule(p: any): { id: string; schedule: Schedule } {
    const validTypes = ["once", "daily", "weekly", "monthly", "yearly", "hourly", "minutely"];
    const when: ScheduleWhen = p.when || {};
    // Multi-rule: se p.rules è un array valido, 'when' può essere vuoto
    let rules: ScheduleWhen[] | undefined = undefined;
    if (Array.isArray(p.rules) && p.rules.length > 0) {
      rules = p.rules.filter((r: any) => validTypes.includes(r?.type));
      if (rules.length === 0) rules = undefined;
    }
    // Se né when né rules hanno un type valido → errore
    if (!validTypes.includes(when.type as string) && !rules) {
      throw new Error("when.type must be " + validTypes.join("|") + " (or pass rules[])");
    }
    // Se when è vuoto ma ci sono rules, usa la prima come 'when' per compat
    if (!validTypes.includes(when.type as string) && rules) {
      when.type = rules[0].type as any;
      if (rules[0].at) when.at = rules[0].at;
      if (rules[0].daysOfWeek) when.daysOfWeek = rules[0].daysOfWeek;
      if (rules[0].dayOfMonth) when.dayOfMonth = rules[0].dayOfMonth;
      if (rules[0].month) when.month = rules[0].month;
      if (rules[0].interval) when.interval = rules[0].interval;
      if (rules[0].date) when.date = rules[0].date;
    }
    const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let rawIds: any = p.agentIds;
    if (typeof rawIds === 'string') {
      const t = rawIds.trim();
      if (t.startsWith('[')) { try { rawIds = JSON.parse(t); } catch {} }
    }
    const s: Schedule = {
      id,
      title: String(p.title || "Scheduled task"),
      sourceSession: p.sourceSession ? { key: String(p.sourceSession.key || ''), label: String(p.sourceSession.label || '') } : undefined,
      agentIds: Array.isArray(rawIds) ? rawIds.map((x: any) => String(x).trim()).filter(Boolean)
        : String(rawIds || "orchestrator").split(",").map((x: string) => x.trim()).filter(Boolean),
      workingDir: p.workingDir ?? undefined,
      mode: "build", // A2.10: i task girano SEMPRE in build mode (tutti i tool configurati)
      model: p.model ?? undefined,
      thinkingLevel: p.thinkingLevel ?? undefined,
      text: String(p.text || ""),
      owner: p.owner === "expert" ? "expert" : this.#owner,
      when,
      rules,
      enabled: p.enabled !== false,
      catchUp: p.catchUp !== false,
      lastFiredAt: 0,
      lastExecutionId: null,
      nextFireAt: null,
      createdAt: Date.now(),
    };
    s.nextFireAt = this.#computeNext(s, 0);
    const all = this.readSchedules();
    all.push(s);
    this.#writeSchedules(all);
    this.#log("schedule-created", { scheduleId: id, title: s.title, type: when.type, nextFireAt: s.nextFireAt });
    this.#notify();
    this.#scheduleNext();
    return { id, schedule: s };
  }

  updateSchedule(p: any): { ok: boolean } {
    const all = this.readSchedules();
    const s = all.find((x: Schedule) => x.id === p.id);
    if (!s) throw new Error("schedule not found");
    if (p.title !== undefined) s.title = String(p.title);
    if (p.agentIds !== undefined) {
      let rawIds: any = p.agentIds;
      if (typeof rawIds === 'string') {
        const t = rawIds.trim();
        if (t.startsWith('[')) { try { rawIds = JSON.parse(t); } catch {} }
      }
      s.agentIds = Array.isArray(rawIds) ? rawIds.map((x: any) => String(x).trim()).filter(Boolean) : [String(rawIds)];
    }
    if (p.workingDir !== undefined) s.workingDir = p.workingDir || undefined;
    if (p.mode !== undefined) s.mode = p.mode || undefined;
    if (p.model !== undefined) s.model = p.model || undefined;
    if (p.thinkingLevel !== undefined) s.thinkingLevel = p.thinkingLevel || undefined;
    if (p.text !== undefined) s.text = String(p.text);
    if (p.when !== undefined || p.rules !== undefined) {
      if (p.when !== undefined) s.when = { ...s.when, ...p.when } as ScheduleWhen;
      if (Array.isArray(p.rules)) s.rules = p.rules as ScheduleWhen[];
      // se cambia 'when'/'rules', ricalcola; mantieni lastFiredAt per non rifare il passato in doppio
      s.nextFireAt = this.#computeNext(s, s.lastFiredAt || 0);
    }
    if (p.enabled !== undefined) s.enabled = !!p.enabled;
    if (p.catchUp !== undefined) s.catchUp = !!p.catchUp;
    if (p.owner !== undefined) s.owner = p.owner === "expert" ? "expert" : "main";
    const idx = all.findIndex((x: Schedule) => x.id === p.id);
    all[idx] = s;
    this.#writeSchedules(all);
    this.#log("schedule-updated", { scheduleId: s.id });
    this.#notify();
    this.#scheduleNext();
    return { ok: true };
  }

  deleteSchedule(p: any): { ok: boolean } {
    const all = this.readSchedules();
    const next = all.filter((x: Schedule) => x.id !== p.id);
    this.#writeSchedules(next);
    this.#log("schedule-deleted", { scheduleId: p.id });
    this.#notify();
    this.#scheduleNext();
    return { ok: true };
  }

  async runScheduleNow(p: any): Promise<{ ok: boolean; executionId?: string; error?: string }> {
    const all = this.readSchedules();
    const s = all.find((x: Schedule) => x.id === p.id);
    if (!s) return { ok: false, error: "schedule not found" };
    if (s.owner !== this.#owner) return { ok: false, error: `schedule owned by ${s.owner} (run it from that app)` };
    if (!s.enabled) return { ok: false, error: "schedule disabled" };
    const now = Date.now();
    // === Aggiorna lo stato PRIMA del fire: il #scan event-driven non deve rifare la task ===
    const idx = all.findIndex((x: Schedule) => x.id === s.id);
    if (this.#isAllOnce(s)) {
      // tutte once → dopo Run now la schedule sparisce (l'esecuzione resta in history)
      if (idx >= 0) all.splice(idx, 1);
    } else {
      s.nextFireAt = this.#computeNext(s, now);
      if (idx >= 0) all[idx] = s;
    }
    this.#writeSchedules(all);
    this.#notify();
    this.#scheduleNext();
    // === Fire-and-forget: risposta immediata, la UI si aggiorna via execution_update ===
    const sCopy = { ...s };
    this.#executor.runTask({
      label: s.title || "Scheduled task (manual)",
      sourceSession: s.sourceSession,
      agentIds: s.agentIds,
      workingDir: s.workingDir,
      mode: s.mode,
      model: s.model,
      thinkingLevel: s.thinkingLevel,
      text: s.text || "",
      owner: s.owner || this.#owner,
      scheduleId: s.id,
      scheduledFor: now,
    }).then((r: any) => {
      sCopy.lastFiredAt = Date.now();
      sCopy.lastExecutionId = r.executionId;
      const all2 = this.readSchedules();
      const idx2 = all2.findIndex((x: Schedule) => x.id === sCopy.id);
      if (idx2 >= 0) { all2[idx2] = sCopy; this.#writeSchedules(all2); }
      this.#log("schedule-run-now", { scheduleId: sCopy.id, executionId: r.executionId });
      this.#notify();
    }).catch((e: any) => {
      this.#log("schedule-run-now-error", { scheduleId: sCopy.id, error: e?.message || String(e) });
    });
    return { ok: true };
  }
}
