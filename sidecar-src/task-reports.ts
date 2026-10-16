// src/main/task-reports.ts — FASE 1 (16 ott): report automatico delle task nella chat di origine
// Regole (utente, 16 ott):
//  - le task finite entrano in CODA (persistente, owner-scoped come le schedule)
//  - consegna SOLO a turno DAVVERO finito e pulito (getTurnState) — mai durante recovery/turni attivi
//  - se la chat è in LONG HORIZON attiva → NIENTE prompt: messaggio ROSSO dell'app (il support agent ha la precedenza)
//  - se la compaction è OFF e il contesto è >80% → NIENTE prompt: messaggio ROSSO dell'app (non riempire il contesto)
//  - il prompt è VISIBILE (\u2063t → bubble teal "task") e chiede al modello di riportare SOLO il risultato
//  - consegna quando l'utente riapre la chat (getHistory) oppure dopo 3 minuti di quiete
//  - dopo la compaction i report in coda ripartono automaticamente al prossimo turno pulito

import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

export interface PendingReport { key: string; executionId: string; title: string; ts: number; owner: "main" | "expert"; }

const QUIET_MS = 3 * 60 * 1000;
const RED_COOLDOWN_MS = 10 * 60 * 1000;

export class TaskReports {
  #owner: "main" | "expert";
  #piBridge: any;
  #lhCheck: (sk: string) => boolean = () => false;
  #log: (tag: string, data: any) => void = () => {};
  #timer: any = null;
  #sending = new Set<string>();
  #redAt = new Map<string, number>();

  #canRun = true;
  constructor(piBridge: any, owner: "main" | "expert") {
    this.#piBridge = piBridge; this.#owner = owner;
    // GUARDIA (16 ott): i worker del pool NON gestiscono i report (li manda SOLO il processo principale)
    try { const pi = parseInt(process.env.QUINKI_POOL_INDEX || "0", 10); this.#canRun = !(Number.isFinite(pi) && pi > 0); } catch {}
  }
  setLogger(fn: (tag: string, data: any) => void) { this.#log = fn; }
  setLhCheck(fn: (sk: string) => boolean) { this.#lhCheck = fn; }

  #file() { return path.join(homedir(), ".quinki", "task-reports.json"); }
  #read(): PendingReport[] {
    try { if (!fs.existsSync(this.#file())) return []; return JSON.parse(fs.readFileSync(this.#file(), "utf8") || "[]"); } catch { return []; }
  }
  #write(list: PendingReport[]) {
    try { const tmp = this.#file() + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8"); fs.renameSync(tmp, this.#file()); } catch {}
  }

  // === Fine task → in coda ===
  enqueue(r: { key: string; executionId: string; title: string }) {
    if (!r || !r.key || !r.executionId) return;
    const all = this.#read();
    if (all.some((x) => x.executionId === r.executionId)) return; // dedupe
    all.push({ key: r.key, executionId: r.executionId, title: r.title || "Task", ts: Date.now(), owner: this.#owner });
    this.#write(all);
    this.#log("task-report-queued", { sessionKey: r.key, executionId: r.executionId });
  }

  // === Riapertura chat (getHistory) → prova subito (con piccolo respiro per far finire il caricamento) ===
  onChatOpened(key: string) {
    if (!key || !this.#canRun) return;
    setTimeout(() => { try { this.#check(key, true); } catch {} }, 1500);
  }

  start() {
    if (!this.#canRun) return;
    if (this.#timer) clearInterval(this.#timer);
    const round = () => {
      try {
        const keys = Array.from(new Set(this.#read().filter((r) => r.owner === this.#owner).map((r) => r.key)));
        for (const k of keys) this.#check(k, false);
      } catch {}
    };
    this.#timer = setInterval(round, 30000);
    setTimeout(round, 8000); // primo giro dopo il boot
    this.#log("task-reports-started", { owner: this.#owner });
  }

  // === Messaggio ROSSO dell'app (arriva anche come notifica) ===
  #red(sk: string, reason: string, text: string) {
    const last = this.#redAt.get(sk) || 0;
    if (Date.now() - last < RED_COOLDOWN_MS) return;
    this.#redAt.set(sk, Date.now());
    const fakeWs = { readyState: 1, constructor: { OPEN: 1 }, send: () => {} };
    try { this.#piBridge?.send?.(fakeWs, { sessionKey: sk, text: "\u2063x" + text, _preserveWs: true, _lean: true }).catch(() => {}); } catch {}
    try { this.#piBridge?.appendNotification?.({ kind: "app_message", sessionKey: sk, body: text, label: "Tasks", title: "Tasks" }); } catch {}
    this.#log("task-report-blocked", { sessionKey: sk, reason });
  }

  async #check(sk: string, opened: boolean) {
    if (!this.#canRun) return;
    const pend = this.#read().filter((r) => r.key === sk && r.owner === this.#owner);
    if (pend.length === 0 || this.#sending.has(sk)) return;

    // 1) turno DAVVERO finito e pulito (mai durante turni correnti né recovery)
    let ts: any = null;
    try { ts = this.#piBridge?.getTurnState?.(sk); } catch {}
    if (!ts || ts.pending || !ts.clean) return;

    // 2) LONG HORIZON attiva → solo messaggio rosso, niente prompt
    let lh = false;
    try { lh = this.#lhCheck(sk); } catch {}
    if (lh) {
      this.#red(sk, "long-horizon", "Long Horizon is active. To receive task results in the chat, disable Long Horizon — or open the \u201cTask executed\u201d section above the text box.");
      return;
    }

    // 3) compaction OFF + contesto ≥80% → solo messaggio rosso (protezione contesto)
    let compactionOff = false;
    let lastActivity = 0;
    try {
      const sess = (this.#piBridge?.getSessions?.() || []).find((x: any) => x?.key === sk || x?.id === sk);
      compactionOff = !!sess && sess.compactionAuto === false;
      lastActivity = Number(sess?.lastActivity || 0);
    } catch {}
    if (compactionOff) {
      let usage: any = null;
      try { usage = this.#piBridge?.getContextUsage?.(sk); } catch {}
      if (usage && typeof usage.percent === "number" && usage.percent >= 80) {
        this.#red(sk, "context-80", "Some tasks in this session have finished. To receive their results in the chat, run compaction — or open the \u201cTask executed\u201d section above the text box.");
        return;
      }
    }

    // 4) quiete: SOLO riapertura della chat oppure ≥3 min senza attività (mai a metà del lavoro)
    if (!opened) {
      if (lastActivity > 0 && Date.now() - lastActivity < QUIET_MS) return;
    }

    // 5) INVIO: prompt VISIBILE (\u2063t → bubble teal) — tolgo dalla coda PRIMA (niente doppi invii)
    this.#sending.add(sk);
    this.#write(this.#read().filter((r) => !(r.key === sk && r.owner === this.#owner)));
    const text = pend.length === 1
      ? `The scheduled task \u201c${pend[0].title}\u201d just finished. Read its outcome with the getTaskExecuted tool (executionId: ${pend[0].executionId}) and report it in this chat with ONLY the actual result content \u2014 nothing else: no commentary, no mention of the process, no \u201cVerification\u201d.`
      : `The scheduled tasks just finished: ${pend.map((p) => `\u201c${p.title}\u201d (${p.executionId})`).join(", ")}. Read each outcome with the getTaskExecuted tool and report them in this chat, each with ONLY the actual result content \u2014 nothing else.`;
    const fakeWs = { readyState: 1, constructor: { OPEN: 1 }, send: () => {} };
    try {
      await this.#piBridge?.send?.(fakeWs, { sessionKey: sk, text: "\u2063t" + text, _preserveWs: true, _lean: true });
      this.#log("task-report-sent", { sessionKey: sk, count: pend.length });
    } catch (e: any) {
      this.#write([...this.#read(), ...pend]); // rimetti in coda: riprova al prossimo giro
      this.#log("task-report-send-error", { sessionKey: sk, error: e?.message || String(e) });
    } finally { this.#sending.delete(sk); }
  }
}
