# QUINKI — RECOVERY & BACKUP (stato stabile pre-B0)

> Creato: 20 ago 2026 — **stato stabile** prima di iniziare B0 (chiusura app C11 risolta, recovery testato, git pushato).
> HEAD: `57e3df57` · TAG GIT: **`pre-B0`** · Backup completo: `~/Backups/quinki-pre-B0-20260820-132159`

---

## 1. COSA È SALVATO

| Cosa | Dove | Copia di sicurezza |
|---|---|---|
| Codice sorgente (repo) | `/Users/andreamaddalena/Projects/Quinki` | GitHub `origin/main` (push) + **tag `pre-B0`** |
| App installata main | `/Applications/Quinki.app` | `~/Backups/quinki-pre-B0-*/Quinki.app` (ditto) |
| App installata Expert | `/Applications/App Expert.app` | `~/Backups/quinki-pre-B0-*/App Expert.app` (ditto) |
| Dati utente (`~/.quinki`) | sessioni, agenti, skill, config, auth, read-state, notifiche, attachments | `~/Backups/quinki-pre-B0-*/quinki-data/` (rsync, esclusi log/cache/backups) |

---

## 2. COME RIPRISTINARE

### Caso A — codice (se una modifica rompe il repo)
```bash
cd /Users/andreamaddalena/Projects/Quinki
git checkout pre-B0        # o: git reset --hard pre-B0
```
(Tutto quello che viene dopo B0 è comunque committato fase per fase: ogni fase ha il suo commit e si può fare `git revert`/`checkout` della singola fase.)

### Caso B — app installata (se l'installazione di una build rompe la main o l'Expert)
```bash
BK=~/Backups/quinki-pre-B0-20260820-132159
# main
bash scripts/install-main.sh   # di solito ripristina dal bundle buildato
# oppure ripristino manuale dal backup:
pkill -f "Quinki.app/Contents/MacOS/quinki" 2>/dev/null   # BRACKET TRICK — mai pkill nudo
lsof -ti:9182 | xargs kill -9 2>/dev/null
sudo rm -rf /Applications/Quinki.app
sudo ditto "$BK/Quinki.app" /Applications/Quinki.app
open /Applications/Quinki.app
# expert (solo se l'Expert è rotto):
lsof -ti:9183 | xargs kill -9 2>/dev/null
pkill -f expert-watchdog 2>/dev/null
sudo rm -rf "/Applications/App Expert.app"
sudo ditto "$BK/App Expert.app" "/Applications/App Expert.app"
open "/Applications/App Expert.app"
```
> Attenzione: il kill dei processi va fatto con attenzione (regola: MAI uccidere la main dell'utente mentre sta lavorando — chiedere prima).

### Caso B — dati utente (se qualcosa corrompe ~/.quinki)
```bash
BK=/Users/andreamaddalena/Backups/quinki-pre-B0-20260820-132159
# PRIMA ferma le app (main + expert) — con quit dal modale, NON kill-and-pray
cp -a ~/.quinki ~/.quinki-corrotto   # salva lo stato rotto per diagnosi
rsync -a --delete "$BK/quinki-data/" ~/.quinki/
open /Applications/Quinki.app
```

---

## 3. QUANDO FARE ROLLBACK (durante B0)
- Ogni fase B0 è un commit separato → se una fase rompe qualcosa:
  1. `git revert <hash-fase>` oppure `git checkout pre-B0` per il codice
  2. Rialla alla versione precedente con `bash scripts/install-main.sh` (usa il bundle buildato) oppure `ditto` dal backup
  3. I DATI non si toccano (le fasi B0 non modificano il formato dei dati se non il vacuum S3, che sarà comunque in un commit separato con backup prima)
- **S3 (vacuum jsonl)**: PRIMA di farlo, rsync di `~/.quinki/sessions` → backup separato.

---

## 4. VERIFICA DELLO STATO ATTUALE (comando)
```bash
cd /Users/andreamaddalena/Projects/Quinki && git status --short && git log --oneline -1
cat /Applications/Quinki.app/Contents/Resources/resources/sidecar/version.txt
```
Atteso: working tree pulito, HEAD = `57e3df95`, version main = `215311c0`.
