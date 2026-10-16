# SYNC — Pi SDK Vendor Re-synchronization

> NOTA (17 ott): al re-sync NON copiare: i `*.map` (solo puntatori di debug), la cartella
> `dist/bundle/` (chunks pre-bundle mai usati) e i `.js` non importati (harness/testing/cli dei SDK):
> erano stati rimossi perche' il binario compilato non li puo' comunque usare. Tieni i 13 file
> PATCHATI a mano (vedi PATCHES-084.md) e i `.d.ts` (utili all'IDE).


Questo file contiene le istruzioni per aggiornare il Pi SDK embedded quando esce una nuova versione upstream.

## Struttura vendor

```
sidecar-src/vendor/@earendil-works/
├── pi-coding-agent/
│   ├── dist/           ← codice compilato (modificare in Fase C)
│   ├── package.json    ← riferimento versione
│   └── README.md
├── pi-agent-core/
│   ├── dist/
│   ├── package.json
│   └── README.md
├── pi-ai/
│   ├── dist/
│   ├── package.json
│   └── README.md
└── pi-tui/
    ├── dist/
    ├── package.json
    └── README.md
```

## Procedura di re-sync

1. **Installare temporaneamente la nuova versione upstream**:
   ```bash
   npm install @earendil-works/pi-coding-agent@<new-version> --no-save
   ```

2. **Copiare i 4 pacchetti dist/ in vendor/**:
   ```bash
   # pi-coding-agent
   rm -rf sidecar-src/vendor/@earendil-works/pi-coding-agent/dist
   cp -R node_modules/@earendil-works/pi-coding-agent/dist sidecar-src/vendor/@earendil-works/pi-coding-agent/dist
   cp node_modules/@earendil-works/pi-coding-agent/package.json sidecar-src/vendor/@earendil-works/pi-coding-agent/package.json

   # pi-agent-core (nested)
   rm -rf sidecar-src/vendor/@earendil-works/pi-agent-core/dist
   cp -R node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist sidecar-src/vendor/@earendil-works/pi-agent-core/dist
   cp node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/package.json sidecar-src/vendor/@earendil-works/pi-agent-core/package.json

   # pi-ai (nested)
   rm -rf sidecar-src/vendor/@earendil-works/pi-ai/dist
   cp -R node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist sidecar-src/vendor/@earendil-works/pi-ai/dist
   cp node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json sidecar-src/vendor/@earendil-works/pi-ai/package.json

   # pi-tui (nested)
   rm -rf sidecar-src/vendor/@earendil-works/pi-tui/dist
   cp -R node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist sidecar-src/vendor/@earendil-works/pi-tui/dist
   cp node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/package.json sidecar-src/vendor/@earendil-works/pi-tui/package.json
   ```

3. **Aggiornare package.json**: verificare se nuove dipendenze sono state aggiunte nei 4 package.json vendor e aggiungerle al `package.json` root.

4. **Rimuovere la dipendenza temporanea**:
   ```bash
   npm install  # reinstalla senza @earendil-works/pi-coding-agent
   ```

5. **Test**: build + typecheck + test + smoke (avvia app, crea chat, invia messaggio)

## Attenzione

- Se sono state applicate modifiche in Fase C (Fix nativi) ai file vendor, il re-sync **sovrascriverà** quelle modifiche. Rialleggerle dopo il sync.
- Verificare sempre il CHANGELOG upstream per breaking changes.
- La versione embedded è congelata: `updatePi()` è disabilitato.