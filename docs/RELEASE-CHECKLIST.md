# Release Checklist — repo pubblico FRESH (INTERNAL, mai nel repo pubblico)

> Checklist per creare i repo pubblici al lancio. Il repo attuale viene RESETTATO:
> un solo commit iniziale con lo stato attuale, la storia resta sul Mac.

## 1. File da ESCLUDERE dal repo pubblico (repo Quinki)

### Escludere SEMPRE (piani interni / business)
- `docs/ROAD-TO-PUBLIC-aggiornata.md` — piano business
- `docs/COMPARE.md` — analisi competitor (mai pubblico)
- `docs/RELEASE-CHECKLIST.md` — questa checklist
- `docs/A2.5-ENDURO-PROIEZIONI.md`, `docs/A2.5b-CONCORRENZA-STUDIO.md` — studi interni
- `docs/B0-*.md`, `docs/B0b/B0c/B0d-*` — indagini performance (ok da tenere? NO: interni, numeri server e strategie)
- `docs/B4-STUDIO-PROCESS-POOL.md`, `docs/A4-MARKETPLACE-STUDIO.md`, `docs/APP0-*`
- `docs/RECOVERY.md` — interno
- `docs/MARKET-REPO-README.md` — è per il repo market, non qui
- `docs/auto-merge.yml` — è il WORKFLOW del market repo (copia lì, non qui)

### Verificare caso per caso (possibili segreti/privati)
- `~/.quinki/` non è nel repo (ok, fuori)
- `sidecar-src/oauth.conf` o file simili (non esistono, secret già spostato)
- `src-tauri/resources/sidecar/quinki-sidecar-ws` — il binario compilato: NON committarlo? È grande (35MB). Nel repo fresh il binario NON va (si builda). Verificare se il repo lo traccia: se sì, aggiungere a .gitignore e escludere
- `scripts/` — controllare che nessuno script contenga path privati o segreti (build-sidecar.sh legge da ~/.quinki: ok)
- `docs/` file piano (tutti quelli sopra)
- `/tmp/*` — mai nel repo

### Escludere: file obsoleti nel codice (inventario 28 ago, NON eliminati ora)
- `sidecar-src/ws-bridge-bundled.ts`, `ws-bridge-debug.ts`, `ws-bridge-full.ts`, `ws-bridge-log.ts`, `ws-bridge-standalone.ts` — varianti debug/vecchie del ws-bridge; il build usa SOLO sidecar-ws.ts
- `sidecar-src/seed.ts` — GIÀ ELIMINATO (file morto pre-riscrittura, conteneva il prompt markdown)
- `sidecar-src/standalone-entry.ts` — verificare uso prima di escludere
- Decisione: al repo fresh pubblicare SOLO i file usati dal build (sidecar-ws.ts → sidecar.ts → pi-bridge.ts → agent-handlers.ts → providers.ts → pool-router.ts → scheduler.ts → executor.ts → longhorizon.ts → mcp.ts → tab-plugins.ts → seed-defaults.ts → sidecar-helper.ts → gh-token.ts + vendor/)

### TENERE nel repo pubblico
- `src/`, `sidecar-src/`, `src-tauri/`, `scripts/`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `vite.config.ts`, `capabilities` (in src-tauri), `icons/`
- `README.md`, `LICENSE` (AGPL-3.0), `PRIVACY.md`, `TERMS.md`, `CHANGELOG.md`, `CONTRIBUTING.md`
- `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/USER-GUIDE.md`, `docs/DEVELOPER.md`, `docs/MARKET.md`
- `.gitignore` aggiornato (escludere dist, target, bundle, oauth.conf)

## 2. Procedura repo fresh (al lancio)

```bash
# 1. crea cartella temporanea con SOLO i file da pubblicare (o orfan-branch)
git checkout --orphan release-public
git add -A && git commit -m "Quinki v1.0.0-beta.1 — first public release"
# 2. su GitHub: crea repo nuovo (o svuota quello esistente)
# 3. push del singolo commit
# 4. il repo PRIVATO attuale resta sul disco come archivio (branch main)
```

Per il market repo: stesso approccio fresh (README + workflow auto-merge + packages/ + catalog.json).

## 3. Prima del push pubblico

- [ ] Nuovo secret OAuth sulla GitHub App + aggiornare ~/.quinki/oauth.conf
- [ ] `git grep` del vecchio secret nel tree da pubblicare = vuoto
- [ ] rimuovere docs/ interni (lista sopra)
- [ ] rimuovere screenshot placeholder e aggiungere screenshot reali
- [ ] CHANGELOG.md con data release
- [ ] tag v1.0.0-beta.1