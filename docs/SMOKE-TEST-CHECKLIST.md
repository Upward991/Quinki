# Quinki Smoke Test Checklist — v1.0.0-beta.2

Test completi da fare con l'amico. Spunta ogni casella. Se qualcosa fallisce, annota cosa succede.

---

## 1. PRIMO AVVIO (5 min)

- [ ] L'app si apre senza errori (può volerci 2-3 secondi al primo avvio)
- [ ] Il tutorial appare (se prima volta)
- [ ] Il tutorial si può skippare (bottone Skip)
- [ ] Il tutorial si può completare (naviga le tab)
- [ ] Dopo il tutorial, l'app mostra la Home

## 2. SETUP PROVIDER (5 min)

- [ ] Settings → ai provider (Anthropic, OpenAI, OpenRouter, Ollama) elencati
- [ ] Aggiungere una API key (anche solo OpenRouter per test)
- [ ] Test connection funziona
- [ ] I modelli vengono scaricati
- [ ] Selezionare un modello per la chat

## 3. CHAT BASE (10 min)

- [ ] Nuova chat dalla sidebar (bottone +)
- [ ] Scrivere un messaggio → invio con Enter
- [ ] La pill "Sending" appare brevemente
- [ ] La pill "Running" appare durante la generazione
- [ ] Lo streaming è fluido (non a pezzettini)
- [ ] La risposta arriva completa
- [ ] Il titolo della chat si aggiorna automaticamente
- [ ] Modalità Plan vs Build (Tab per cambiare)
- [ ] Il tasto destro su una textbox mostra il menu custom (Cut/Copy/Paste/Select All)
- [ ] Paste funziona (incolla dalla clipboard)
- [ ] Cut funziona (taglia senza auto-paste)
- [ ] Right-click NON evidenzia automaticamente
- [ ] Esc ferma la generazione
- [ ] Slash menu (/) apre le opzioni (modello, thinking, reset)

## 4. MULTI-AGENT (5 min)

- [ ] Aggiungere un secondo agente alla chat (@ o dal menu)
- [ ] Taggare un agente con @nome
- [ ] L'Orchestrator delega a un agente specifico
- [ ] Il blocco delegation appare in chat
- [ ] La risposta del delegato è visibile

## 5. QUICK CHAT (5 min)

- [ ] Tasto sinistro sull'icona Quinki nel menu bar → apre Quick Chat
- [ ] Shortcut ⌥+Spazio apre Quick Chat
- [ ] Il cursore è già nella textbox (autofocus)
- [ ] Scrivere una domanda → risposta streaming nella finestra
- [ ] Chiudere la finestra → la chat appare nella sidebar della Main
- [ ] La finestra ricorda la dimensione (ridimensiona → chiudi → riapri)
- [ ] Settings → Shortcuts → cambiare lo shortcut → funziona
- [ ] Il tutorial NON si apre nella Quick Chat (solo se non completato)

## 6. RECOVERY / AUTOPROMPT (5 min)

- [ ] Avviare una generazione lunga
- [ ] Forzare la chiusura dell'app (⌘Q) durante la generazione
- [ ] Riaprire l'app → aprire la chat interrotta
- [ ] La pill "Recovering" appare (arancione)
- [ ] La bubble "The app was interrupted..." appare IN TEMPO REALE
- [ ] La generazione riprende automaticamente
- [ ] Il badge nella sidebar mostra 1 (non 2)

## 7. LONG HORIZON (10 min)

- [ ] Attivare Long Horizon su una chat
- [ ] Dare un obiettivo all'agente
- [ ] Il support agent crea il piano (unità in - [ ] formato)
- [ ] Il prompt del support agent appare IN TEMPO REALE nella chat
- [ ] Premere "Proceed to planning"
- [ ] Premere "Start execution"
- [ ] L'agente lavora autonomamente attraverso le unità
- [ ] Il support agent guida tra un'unità e l'altra

## 8. STEERING (3 min)

- [ ] Durante una generazione, premere Ctrl+Enter
- [ ] Scrivere contesto aggiuntivo
- [ ] Il messaggio viene iniettato SENZA che l'autoprompt scatti
- [ ] La risposta continua fluida

## 9. POOL (5 min)

- [ ] Aprire 3-4 chat contemporaneamente
- [ ] Mandare messaggi in tutte
- [ ] Verificare che generano IN PARALLELO (non in serie)
- [ ] Nessun messaggio si blocca in "Sending"

## 10. SIDEBAR (3 min)

- [ ] Creare una cartella
- [ ] Trascinare una chat nella cartella
- [ ] Rinominare una chat (doppio click)
- [ ] Eliminare una chat
- [ ] Il drag&drop funziona

## 11. SHORTCUTS (2 min)

- [ ] Settings → Shortcuts → la lista è completa
- [ ] Tab cambia Plan/Build ovunque nella chat
- [ ] / apre lo slash menu
- [ ] @ apre il mention menu

## 12. EXPORT (2 min)

- [ ] Esportare una chat in Markdown
- [ ] Esportare una chat in HTML
- [ ] Il file si apre correttamente

## 13. SETTINGS (3 min)

- [ ] Cambiare tema
- [ ] Cambire Opening tab
- [ ] Compaction settings visibili
- [ ] Shortcuts section visibile
- [ ] Quick Chat shortcut configurabile

## 14. APP EXPERT (se applicabile) (5 min)

- [ ] Tab App Expert → modale Install
- [ ] Install Expert App funziona
- [ ] L'icona dell'Expert è CORRETTA (non quella della Main)
- [ ] L'app Expert si apre
- [ ] L'onboarding chiede la directory
- [ ] Settings → App Expert → Sync funziona

---

## RISULTATI

| Categoria | Pass | Fail | Note |
|---|---|---|---|
| Primo avvio | | | |
| Provider | | | |
| Chat base | | | |
| Multi-agent | | | |
| Quick Chat | | | |
| Recovery | | | |
| Long Horizon | | | |
| Steering | | | |
| Pool | | | |
| Sidebar | | | |
| Shortcuts | | | |
| Export | | | |
| Settings | | | |
| App Expert | | | |

**Tempo totale stimato: ~60 minuti**
