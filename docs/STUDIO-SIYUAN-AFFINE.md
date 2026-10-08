# Studio: SiYuan e AFFiNE — cosa sono, cosa ci insegnano, cosa possiamo riusare (8 ott 2026)

Su richiesta utente: studiare a fondo i due repo per (a) valutare alternative a Notion/Obsidian,
(b) estrarre idee e parti riusabili dentro Quinki, anche se non li adottiamo.

Fonti: GitHub API + README + LICENSE + docs/ (letti l'8 ott 2026).

---

## 1. SiYuan (`github.com/siyuan-note/siyuan`)

- **Numeri**: 46.7k stelle, branch `master`, **AGPL-3.0** — la stessa famiglia di licenza di Quinki,
  quindi il codice e' **direttamente riusabile** nel nostro progetto (con attribuzione).
- **Stack**: TypeScript (13.7 MB) + **Go** (12.4 MB). Due parti nette:
  - `kernel/` = kernel in Go: HTTP server, storage, sync, query SQL.
  - `app/` = frontend Electron + TS; dentro `app/stage/protyle/` c'e' **Protyle** (il loro editor
    WYSIWYG block-based) e `lute.min.js` = **Lute**, il motore di parsing/rendering markdown
    scritto in Go dall'autore (repo separato `88250/lute`).
- **Ecosistema** (tabella nel README): lute (editor engine) · dejavu (**data repo**: sync
  versionata e cifrata con chiave) · petal (**plugin API**) · riff (spaced repetition) ·
  app Android/iOS/HarmonyOS · estensione Chrome · bazaar (marketplace).
- **Feature rilevanti**: blocchi con reference bidirezionali, attributi custom, **embed di query
  SQL**, markdown WYSIWYG, block zoom, documenti da 1M parole, formule/grafici/flowchart/gantt,
  export (MD+assets, PDF, Word, HTML), **database con vista tabella**, flashcard,
  **AI writing e chat Q&A via OpenAI API**, OCR, API HTTP completa, Docker, marketplace.
- **Storage**: workspace su cartella (`assets/`, `storage/`, `templates/`, `plugins/`, ...);
  le note sono file **`.sy` in JSON** (blocchi strutturati); sync via dejavu o dischi terzi.
- **docs/ notevoli**: `API.md` (API completa HTTP: notebooks/documents/blocks/assets, contratti
  TypeScript, auth), `API-CONTRACTS.md`, `APPEARANCE-SYNC.md`, `DOCUMENT-ADDRESSING.md`, ecc.
- **`AGENTS.md` alla radice**: guida per agenti AI che lavorano sul repo (regole: non editare
  lute.min.js, non committare senza richiesta, come verificare la UI in browser...). Pratica
  che possiamo adottare anche in Quinki.
- **Posizionamento attuale** (descrizione GitHub 2026): "open-source, privacy-first, self-hosted
  knowledge workspace **where humans and AI agents work together**" — hanno virato sull'agentico.
- **Docker**: modalita' headless `serve --workspace=... --accessAuthCode=...` — stessa forma del
  nostro futuro `quinki serve`.

### Cosa portiamo a casa
1. **Licenza compatibile**: AGPL come noi -> il loro codice e' una libreria di idee/pezzi legale.
2. **Lute + Protyle** = riferimento per un eventuale editor markdown WYSIWYG interno.
3. **Modello a blocchi + query SQL + `.sy` JSON** -> idea per "note come blocchi interrogabili
   dagli agenti" (ponte naturale tra la tab Knowledge e gli agenti).
4. **dejavu** -> studio per un nostro sync multi-dispositivo di `~/.quinki` (versionato, cifrato).
5. **docs/API.md** -> modello di contratto/documentazione per la nostra Agent API.
6. **`AGENTS.md`** -> da adottare nel repo Quinki (gli agenti di chiunque — CLI compresa —
   trovano subito le regole; noi abbiamo la skill in ~/.quinki ma l'AGENTS.md vale per tutti).
7. **Docker serve + accessAuthCode** -> confronto diretto col nostro piano `quinki serve`.

---

## 2. AFFiNE (`github.com/toeverything/AFFiNE`)

- **Numeri**: 73.3k stelle, branch `canary`, **licenza mista**:
  - **MIT** per tutto tranne `packages/backend` e `packages/common/native` -> riusabile liberamente.
  - `packages/backend/server` = **AFFiNE Enterprise Edition (EE)**: uso in produzione consentito
    solo con sottoscrizione -> **da NON copiare** (solo studio).
- **Stack**: TS (24.8 MB) + **Rust** (3.2 MB, engine nativo/sync) + **Swift** e **Kotlin** (app
  mobile native nuove).
- **BlockSuite** (il loro editor, repo separato `toeverything/blocksuite`): **MPL-2.0**, attivo
  (ultimo push 5 ott 2026), 6k stelle. Toolkit per editor/collab: **PageEditor** (documenti a
  blocchi) + **EdgelessEditor** (canvas/whiteboard), **native web components** ->
  framework-agnostic, usabile dentro il nostro React. ⚠️ Il README avverte: "questo repo subira'
  cambiamenti importanti, PR sospese" -> adottarlo oggi = rischio, ma da tenere d'occhio.
- Idee chiave: docs+canvas nello stesso spazio, CRDT (Yjs) per collab realtime, collezioni
  (database con righe-documento) = la conferma del pattern "viste-database sopra documenti"
  che avevamo ipotizzato per la tab Knowledge/DB.

### Cosa portiamo a casa
1. **BlockSuite (MPL)** = candidato concreto per l'editor della futura tab note/DB — con
   l'avviso "in rifacimento": valutare a versione bloccata o rimandare.
2. **PageEditor + Edgeless** = ispirazione per unire note e canvas (sinergia con l'Intelligent UI:
   gli agenti che disegnano/aggiornano diagrammi).
3. **Modello collezioni/righe** = validazione del nostro piano "database-lite sopra file".
4. Backend EE: **solo studio**, nessun riuso in produzione.

---

## 3. Verdetto

### Per la migrazione dell'utente (Notion -> ???)
- **SiYuan** ora e' una candidata **seria**, forse la piu' vicina al "feel Notion": blocchi,
  database a tabella, self-host (Docker), AI con endpoint custom, mobile, e licenza AGPL.
  Punto unico: ha una **plugin API (petal)** -> un plugin SiYuan potrebbe parlare con la NOSTRA
  Agent API e portare gli agenti Quinki dentro SiYuan (stessa mossa prevista per Obsidian).
- **AFFiNE**: piu' bella (docs+canvas), ma backend EE-gated e repo editor in rifacimento.
- **Obsidian** resta la piu' matura per note pure + ecosistema plugin enorme; perde su
  block/database nativi. La scelta migliore = provarle: importer di Obsidian per il test,
  SiYuan in Docker per il test.

### Per Quinki (autonomia dal caso migrazione)
- Adottiamo **subito** la pratica `AGENTS.md` (costo ~mezz'ora, beneficio per tutte le sessioni).
- Riusiamo lo **schema di docs/API.md** come modello per la nostra Agent API.
- Studiamo **Lute/Protyle** e **BlockSuite** quando faremo la tab note/DB.
- **dejavu** resta il riferimento se faremo sync nostro dei dati.

## Link
- SiYuan: https://github.com/siyuan-note/siyuan (AGPL-3.0) · Lute: https://github.com/88250/lute
- AFFiNE: https://github.com/toeverything/AFFiNE (MIT + EE per il backend)
- BlockSuite: https://github.com/toeverything/blocksuite (MPL-2.0, in rifacimento)
