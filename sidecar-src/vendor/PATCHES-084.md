# RE-VENDOR Pi SDK 0.78.0 → 0.84.4 — WIP (branch pi-sdk-084-wip)

Stato: vendor copiato a 0.84.4, patch estratti ma NON riapplicati. Main resta a 0.78 (verde).

## I 4 patch esatti da riapplicare su 0.84.4

### 1. session-manager.js (dist/core/session-manager.js)
In `buildSessionContext` (walk dell'albero, dove ci sono i `messages.push` per i vari tipi di entry):
```js
// QUINKI: include delegation entries in messages (position automatic from .jsonl)
// Filtered out before LLM call in agent-session.js — zero context cost
else if (entry.type === "delegation" && entry.delegationData) {
    messages.push({ role: "delegation", id: entry.id, delegationData: entry.delegationData, timestamp: new Date(entry.timestamp || Date.now()).getTime() });
}
```
Verificare: `_appendEntry` esiste ancora in 0.84.4 ✓ (10 occorrenze). Trovare l'equivalente punto nel nuovo walker.

### 2. agent-session.js (dist/core/agent-session.js) — DUE patch
a) **systemPrompt override** (trovare l'equivalente di `this.agent.state.systemPrompt = this._baseSystemPrompt;`):
```js
// PATCH: Don't overwrite systemPrompt here — pi-bridge.ts manages it.
if (!this._customSystemPromptOverride) {
    this.agent.state.systemPrompt = this._baseSystemPrompt;
}
```
b) **Filtro delegation zero-context**: filtrare `role === "delegation"` dai messaggi PRIMA delle chiamate LLM. In 0.78 erano 3 call sites. In 0.84.4 il file è stato riscritto (grep "delegation" = 0) — trovare TUTTI i punti dove i messaggi vanno al LLM (llmContext build) e aggiungere il filtro. Usare /tmp/vendor-patches-ref/agent-session.js (copia 0.78 patchata) come riferimento per l'intenzione.

### 3. compaction.js (dist/core/compaction/compaction.js) — BPE
Aggiungere in cima (dopo gli import):
```js
// BPE tokenizer (replaces chars/4 heuristic)
let _encoder = null;
function getEncoder() { if (!_encoder) { try { const m = require("gpt-tokenizer"); _encoder = m.encode; } catch { _encoder = null; } } return _encoder; }
function bpeTokens(text) { const enc = getEncoder(); if (enc && typeof text === "string" && text.length > 0) return enc(text).length; return Math.ceil((text || "").length / 4); }
```
Poi sostituire OGNI stima euristica (chars/4) con `bpeTokens(...)` — confrontare /tmp/vendor-patches-ref/compaction.js per i punti esatti del 0.78; in 0.84.4 la funzione di stima può avere un nome diverso (cercare estimate*/len/4).

### 4. model-registry.js (dist/core/model-registry.js)
⚠️ **File interamente riscritto upstream** (ora è una "compatibility facade", gli internals usano ModelRuntime). Il patch 0.78 era microscopico:
```js
const _parsed = this.parseModels(config);
return { models: _parsed, overrides, modelOverrides, error: undefined };
```
(evitava la doppia chiamata di parseModels). Verificare se il problema esiste ancora nel 0.84 (il codice è nuovo) — se `parseModels` non viene più chiamato due volte, il patch NON serve.

## Note upstream 0.84.4
- `completeSimple` ora importato da `@earendil-works/pi-ai/compat` (visto nel nuovo compaction.js) — verificare i nostri import in pi-bridge.ts dopo il ri-patch.
- session-manager 0.84 usa prefissi `node:` negli import (come i nostri).
- agent-session: riscritto — fare diff completo con /tmp/vendor-patches-ref/agent-session.js per NON perdere patch.

## Procedura dopo il patch
1. `cd sidecar-src && bun build --target=bun --outdir /tmp/chk sidecar-ws.ts` (compile check)
2. build-sidecar.sh + vite + tauri build
3. **DEPLOY SOLO VM** (dalla copia FIRMATA di /Applications; killare SEMPRE anche il sidecar: pkill -9 -f quinki-sidecar-ws)
4. Regressione completa con la suite scripts/vm-tests/ (batch 1-9), in particolare: deleghe (T3), compaction (T7 auto-80%), streaming, recovery
5. Se tutto verde → deploy Mac main + sync Expert

## File di riferimento
- /tmp/vendor-patches-ref/{session-manager,agent-session,compaction,model-registry}.js = 0.78 PATCHATI
- /tmp/sdk078/node_modules/... = 0.78 PRISTINO (per il diff patch-vs-upstream)
- (04 set) openai-completions.js — openrouter branch: aggiunto `include_reasoning = true` (senza, OpenRouter ragiona ma non restituisce il reasoning text → thinking invisibile all'agente)
