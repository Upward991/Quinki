# VENDOR PATCHES — le nostre modifiche all'SDK Pi

> Creato il **16 ott 2026** durante la ricognizione per l'update **0.84.4 → 1.3.0**.
> Sostituisce il metodo manuale descritto in `../PATCHES-084.md` (che resta come riferimento storico dei *perché*).
> Il vecchio elenco "13 file" era incompleto: i file realmente patchati sono **14** (vedi sotto).

## Cosa sono

14 patch = TUTTE le modifiche che Quinki ha fatto al codice compilato dell'SDK Pi.
Recuperate **automaticamente** con `diff -u` tra:

- il pacchetto npm **0.84.4 puro** (`npm view` → `npm pack @earendil-works/pi-coding-agent@0.84.4`)
- le nostre copie patchate in `../@earendil-works/<pkg>/`

→ il risultato è la modifica **esatta**, niente fatto a mano.

Verifiche fatte il 16 ott 2026:

1. **Fedeltà** ✅ — applicando i 14 patch a una 0.84.4 pura si riproducono i nostri file **byte-per-byte** (0 differenze su 14).
2. **Compatibilità 1.3.0** ✅ — tutti e 14 si applicano **puliti** (dry-run) sulla 1.3.0 (`c130`/`t130` in `/tmp/pi-recon`).

## Elenco

| # | Patch | File nel pacchetto | Pacchetto |
|---|---|---|---|
| 01 | `01-agent-session.patch` | `dist/core/agent-session.js` | pi-coding-agent |
| 02 | `02-compaction.patch` | `dist/core/compaction/compaction.js` | pi-coding-agent |
| 03 | `03-session-manager.patch` | `dist/core/session-manager.js` | pi-coding-agent |
| 04 | `04-interactive-mode.patch` | `dist/modes/interactive/interactive-mode.js` | pi-coding-agent |
| 05 | `05-image-process.patch` | `dist/utils/image-process.js` | pi-coding-agent |
| 06 | `06-image-resize-core.patch` | `dist/utils/image-resize-core.js` | pi-coding-agent |
| 07 | `07-autocomplete.patch` | `dist/autocomplete.js` | pi-tui |
| 08 | `08-editor.patch` | `dist/components/editor.js` | pi-tui |
| 09 | `09-markdown.patch` | `dist/components/markdown.js` | pi-tui |
| 10 | `10-scroll-view.patch` | `dist/components/scroll-view.js` | pi-tui |
| 11 | `11-select-list.patch` | `dist/components/select-list.js` | pi-tui |
| 12 | `12-terminal.patch` | `dist/terminal.js` | pi-tui |
| 13 | `13-tui-alt-screen.patch` | `dist/tui-alt-screen.js` | pi-tui |
| 14 | `14-tui.patch` | `dist/tui.js` | pi-tui |

Note: `keybindings.js` (presente nel vecchio elenco) **non è patchato** (identico all'originale).
`agent-session.js` e `session-manager.js` (assenti dal vecchio elenco) **sono patchati**.

## Come riapplicare (es. dopo un update SDK)

Dalla root del repo:

```bash
# pi-coding-agent (patch 01–06)
for p in sidecar-src/vendor/patches/0[1-6]-*.patch; do
  patch -p1 -d sidecar-src/vendor/@earendil-works/pi-coding-agent --forward < "$p"
done

# pi-tui (patch 07–14)
for p in sidecar-src/vendor/patches/0[7-9]-*.patch sidecar-src/vendor/patches/1[0-4]-*.patch; do
  patch -p1 -d sidecar-src/vendor/@earendil-works/pi-tui --forward < "$p"
done
```

(`-p1` perché gli header sono in formato standard `a/dist/... b/dist/...`; `-d` = radice del pacchetto.)

## Verifica dopo l'applicazione

1. `git diff --stat -- sidecar-src/vendor` → devono comparire **esattamente 14 file**.
2. Ri-dry-run: se già applicati, `patch` segnala *"Reversed (or previously applied) patch detected"* → è la conferma che lo stato è quello atteso.
3. Build + batteria di test (vedi `internal/PI-SDK-RECON.md`).


---

# SET PER LA 1.3.0 (aggiornamento del 17 ott) — `patches/1.3.0/`

Il set sopra (`patches/*.patch`, da 0.84.4) è **storico**: riproduce le modifiche a partire dalla 0.84.4.
Dal 17 ott il vendor è alla **1.3.0** e il set di riferimento è **`1.3.0/`** (13 file): ciascuno si applica
**pulito** alla 1.3.0 pristina (verificato: 13/13, `patch -p1 --forward`).

Differenze di metodo nel set 1.3.0 (l'upstream ha rifattorizzato):
- **agent-session**: invece di 11 hunk sparsi → **6 punti mirati**: (1) auto-compaction spenta in UN punto
  (`_runAutoCompaction` → `return false`), (2) auth mai-lanciare (`if (false && !hasConfiguredAuth)`),
  (3–6) filtro delle delegazioni prima dell'LLM (provider path, boundary, agent state, compaction context).
- **session-manager**: delegazioni nei messaggi di contesto dentro `buildSessionProjection`.
- **editor (pi-tui)**: i 3 hunk che non entravano sono stati **riadattati a mano** sul render rifattorizzato
  (blocco dipinto senza bordi, chips row, footer, menu panel, placeholder).
- **NON riapplicato**: `interactive-mode` (2 hunk) — la NOSTRA CLI ha un TUI proprio e non usa la modalità
  interattiva dell'SDK. E l'hunk "cursore dentro le chip" dell'editor (cosmetico) → vedi la nota nel changelog dei patch (sezione 'Skipped').
- Il prompt di sistema: in 1.3.0 `agent.state.systemPrompt` è **solo un getter** → l'override vive nel
  NOSTRO bridge (`quinkiSetSystemPrompt` → proiezione su `transformContext`), non più come patch SDK.

**Come si applicano** (da `scripts/update-pi-sdk.sh`, o a mano):
```bash
for f in sidecar-src/vendor/patches/1.3.0/0[1-6]-*.patch; do
  patch -p1 -d sidecar-src/vendor/@earendil-works/pi-coding-agent --forward < "$f"; done
for f in sidecar-src/vendor/patches/1.3.0/0[7-9]-*.patch sidecar-src/vendor/patches/1.3.0/1[0-4]-*.patch; do
  patch -p1 -d sidecar-src/vendor/@earendil-works/pi-tui --forward < "$f"; done
```
