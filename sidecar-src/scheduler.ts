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

// FIX DST + ORARI (16 ott, verificati con test /tmp/dst-test.cjs — 7/7 casi sbagliati prima):
// i calcoli a passi fissi di 86400000ms slittavano di +-1h al cambio d'ora; le monthly
// tornavano candidateDay (00:00!) perdendo l'orario; le hourly appena create potevano
// puntare a un'ora gia' passata (fire immediato).
const dayIndex = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

// === FUSI ORARI (16 ott): ogni task ha il SUO fuso (timeZone IANA, es. Europe/Rome). ===
// Default: fuso della macchina catturato alla creazione. Le task restano ancorate al loro
// orario MURALE anche se il computer cambia fuso/ora o se il paese non ha il cambio d'ora.
const machineZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
const zoneOk = (z: string): boolean => { try { new Intl.DateTimeFormat("en-GB", { timeZone: z }); return true; } catch { return false; } };
const _zoneFmt = new Map<string, Intl.DateTimeFormat>();
function zonedParts(ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number } {
  let f = _zoneFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); _zoneFmt.set(tz, f); }
  const parts = f.formatToParts(new Date(ms));
  const g = (t: string) => parts.find((x) => x.type === t)?.value || "0";
  return { y: parseInt(g("year"), 10), mo: parseInt(g("month"), 10) - 1, d: parseInt(g("day"), 10), h: parseInt(g("hour"), 10), mi: parseInt(g("minute"), 10) };
}
// orario murale (y, mo 0-based, d, h, mi) nel fuso tz -> epoch ms (iterativo, regge i cambi d'ora)
function epochFromWall(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const target = Date.UTC(y, mo, d, h, mi, 0);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(guess, tz);
    const asUTC = Date.UTC(p.y, p.mo, p.d, p.h, p.mi, 0);
    const off = asUTC - guess;
    if (off === 0) break;
    guess = target - off;
  }
  return guess;
}
// somma ore al murale (aritmetica in "spazio UTC" = solo calendario, senza fuso)
const addWallHours = (w: { y: number; mo: number; d: number; h: number; mi: number }, hh: number) => {
  const t = new Date(Date.UTC(w.y, w.mo, w.d, w.h + hh, 0));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), mi: 0 };
};

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
  timeZone?: string;           // fuso IANA della task (default: quello della macchina alla creazione)
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
  #watchdog: any = null;
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
    // GARANZIA ORARIO (16 ott): watchdog ogni 60s. Copre: cambio di fuso orario o di ora sul
    // computer, cambio d'ora con un timer gia' armato (la zona della task puo' NON avere il
    // cambio d'ora), sleep/wake. Ricalcola le occorrenze FUTURE (solo quelle a >90s: quelle
    // imminenti non si toccano mai — mai perdere un fire in volo) e ripiazza il timer.
    if (this.#watchdog) clearInterval(this.#watchdog);
    this.#watchdog = setInterval(() => {
      try {
        const nowTs = Date.now();
        const all = this.readSchedules();
        let dirty = false;
        for (const sw of all) {
          if (!sw.enabled || sw.owner !== this.#owner) continue;
          if (sw.nextFireAt == null || sw.nextFireAt - nowTs > 90000) {
            // FIX (16 ott, visto live): da max(lastFiredAt, ADESSO) — con 0 un task MAI partito
            // (es. Tokyo daily creato nel pomeriggio) veniva riportato a un'occorrenza di
            // STAMATTINA (gia' passata) e partiva come catch-up "in ritardo" senza motivo.
            const nx = this.#computeNext(sw, Math.max(sw.lastFiredAt || 0, nowTs));
            if (nx !== sw.nextFireAt) { sw.nextFireAt = nx; dirty = true; }
          }
        }
        if (dirty) { this.#writeSchedules(all); this.#notify(); }
      } catch {}
      this.#scan();
    }, 60000);
    this.#log("scheduler-started", { owner: this.#owner, mode: "event-driven+watchdog60s", zone: machineZone() });
  }

  stop() { if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; } if (this.#watchdog) { clearInterval(this.#watchdog); this.#watchdog = null; } }

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
    const tz = String((s as any).timeZone || machineZone());

    // === SECONDS (nuovo): ogni N secondi da createdAt (durata pura: indipendente dal fuso) ===
    if (when.type === "seconds") {
      const created = s.createdAt || now;
      const step = interval * 1000;
      const next = created + (Math.floor(Math.max(0, now - created) / step) + 1) * step;
      return next > afterTs ? next : null;
    }

    // === MINUTELY: ogni N minuti da createdAt (durata pura) ===
    if (when.type === "minutely") {
      const created = s.createdAt || now;
      const step = interval * 60000;
      const elapsed = Math.max(0, now - created);
      const next = created + (Math.floor(elapsed / step) + 1) * step;
      return next > afterTs ? next : null;
    }

    // === HOURLY: ogni N ore al minuto m, in ORE DI CALENDARIO nel fuso della task ===
    if (when.type === "hourly") {
      const { m } = this.#parseAt(when.at || "00:00");
      const floor = Math.max(now, afterTs);
      let w = zonedParts(floor, tz);
      let cand = epochFromWall(w.y, w.mo, w.d, w.h, m, tz);
      let guard = 0;
      while (cand <= floor && guard++ < 2000) {
        w = addWallHours(w, interval);
        cand = epochFromWall(w.y, w.mo, w.d, w.h, m, tz);
      }
      return cand > afterTs ? cand : null;
    }

    // === ONCE: con offset (Z o +hh:mm) = istante assoluto; senza = orario murale nel fuso della task ===
    if (when.type === "once") {
      const raw = String(when.date || "");
      let ms: number;
      if (/[zZ]$/.test(raw) || /[+-]\d\d:?\d\d$/.test(raw)) {
        ms = new Date(raw).getTime();
      } else {
        const mm = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
        ms = mm ? epochFromWall(+mm[1], +mm[2] - 1, +mm[3], +mm[4], +mm[5], tz) : new Date(raw).getTime();
      }
      return isNaN(ms) ? null : (ms > afterTs ? ms : null);
    }

    // === DAILY / WEEKLY / MONTHLY / YEARLY: giorno di CALENDARIO nel fuso della task ===
    const { h, m } = this.#parseAt(when.at || "08:00");
    const nowW = zonedParts(now, tz);
    const createdW = zonedParts(s.createdAt || now, tz);

    if (when.type === "yearly") {
      const mo = Math.max(0, Math.min(11, Number(when.month || 1) - 1));
      const dom = Math.max(1, Math.min(31, Number(when.dayOfMonth || 1)));
      const span = Math.max(13, interval * 2 + 2);
      for (let k = 0; k < span; k++) {
        const y = nowW.y + k;
        if (interval > 1 && (((y - createdW.y) % interval) + interval) % interval !== 0) continue;
        const cand = epochFromWall(y, mo, dom, h, m, tz);
        if (cand > afterTs) return cand;
      }
      return null;
    }

    const maxIter = when.type === "monthly" ? 1500 : 400;
    for (let i = 0; i < maxIter; i++) {
      const day = new Date(Date.UTC(nowW.y, nowW.mo, nowW.d + i));
      const yr = day.getUTCFullYear(), mo2 = day.getUTCMonth(), da = day.getUTCDate();
      const cand = epochFromWall(yr, mo2, da, h, m, tz);
      if (cand <= afterTs) continue;
      if (when.type === "daily") {
        if (interval > 1) {
          const di = Math.floor(Date.UTC(yr, mo2, da) / 86400000);
          const d0 = Math.floor(Date.UTC(createdW.y, createdW.mo, createdW.d) / 86400000);
          if ((((di - d0) % interval) + interval) % interval !== 0) continue;
        }
        return cand;
      }
      if (when.type === "weekly") {
        const days = (when.daysOfWeek || [1, 2, 3, 4, 5]).map((d: any) => Number(d));
        const jsDay = day.getUTCDay();
        const dayNum = jsDay === 0 ? 7 : jsDay;
        if (!days.includes(dayNum)) continue;
        if (interval > 1) {
          const di = Math.floor(Date.UTC(yr, mo2, da) / 86400000);
          const d0 = Math.floor(Date.UTC(createdW.y, createdW.mo, createdW.d) / 86400000);
          const cw = Math.floor(di / 7), sw2 = Math.floor(d0 / 7);
          if ((((cw - sw2) % interval) + interval) % interval !== 0) continue;
        }
        return cand;
      }
      if (when.type === "monthly") {
        const dom = Number(when.dayOfMonth || 1);
        if (da !== dom) continue; // giorno inesistente in quel mese (es. 31) -> salta il mese (voluto)
        if (interval > 1) {
          const mi2 = yr * 12 + mo2, mi0 = createdW.y * 12 + createdW.mo;
          if ((((mi2 - mi0) % interval) + interval) % interval !== 0) continue;
        }
        return cand;
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
    // DEDUPE (16 ott, bug utente "a volte ne schedulа DUE"): se un task IDENTICO (titolo+testo+regole+agenti)
    // e' stato creato negli ultimi 2 minuti, NON ne creo un doppione: restituisco quello esistente.
    try {
      const norm = (x: any) => JSON.stringify(x ?? null);
      const existing = this.readSchedules().find((x: Schedule) =>
        Date.now() - (x.createdAt || 0) < 120000 &&
        x.title === String(p.title || "Scheduled task") &&
        String(x.text || "") === String(p.text || "") &&
        norm(x.when) === norm(p.when) &&
        norm((Array.isArray(p.rules) && p.rules.length > 0) ? p.rules : null) === norm(x.rules ?? null) &&
        norm(x.agentIds) === norm(Array.isArray(p.agentIds) ? p.agentIds.map((z: any) => String(z).trim()) : String(p.agentIds || "orchestrator").split(",").map((z: string) => z.trim()))
      );
      if (existing) {
        this.#log("schedule-dedupe", { scheduleId: existing.id, title: existing.title });
        return { id: existing.id, schedule: existing };
      }
    } catch {}

    const validTypes = ["once", "daily", "weekly", "monthly", "yearly", "hourly", "minutely", "seconds"];
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
      timeZone: p.timeZone && zoneOk(String(p.timeZone)) ? String(p.timeZone) : machineZone(),
      when,
      rules,
      enabled: p.enabled !== false,
      catchUp: p.catchUp !== false,
      lastFiredAt: 0,
      lastExecutionId: null,
      nextFireAt: null,
      createdAt: Date.now(),
    };
    // FIX (16 ott, visto live): la prima occorrenza si calcola da ADESSO, non dalla epoch 0 —
    // un task per un'ora già passata oggi (es. creo alle 22:00 un daily delle 09:00) NON deve
    // partire subito: parte domani alle 09:00.
    s.nextFireAt = this.#computeNext(s, Date.now());
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
      s.nextFireAt = this.#computeNext(s, Math.max(s.lastFiredAt || 0, Date.now()));
    }
    if (p.enabled !== undefined) s.enabled = !!p.enabled;
    if (p.catchUp !== undefined) s.catchUp = !!p.catchUp;
    if (p.owner !== undefined) s.owner = p.owner === "expert" ? "expert" : "main";
    if (p.timeZone !== undefined) { s.timeZone = p.timeZone && zoneOk(String(p.timeZone)) ? String(p.timeZone) : machineZone(); s.nextFireAt = this.#computeNext(s, Math.max(s.lastFiredAt || 0, Date.now())); }
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
