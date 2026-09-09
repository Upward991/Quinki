# Studio: Distribuire Quinki SENZA pagare i 99€/anno ad Apple

> Ricerca approfondita (01 set 2026) — fonti: Hacker News #45907259, GitHub alacritty#8749,
> Homebrew 5.0 announcement, Tauri docs, HackTricks, macOS security docs.

## Verdetto rapido

**Notarizzazione gratis NON esiste.** Confermato da ogni fonte: Apple controlla i server
del notary service e richiede l'account Developer Program ($99/anno). Nessun tool
(electron/notarize, rcodesign, GoReleaser/quill) può bypassare — sono solo client del
servizio Apple.

**MA** distribuire l'app a utenti reali senza pagare SI PUÒ. È esattamente quello che fa
Alacritty (65k⭐, rifiuta Apple su principio) e LibreWolf. Ecco i workaround reali.

---

## 🔴 ROOT CAUSE TROVATA E FIXATA (01 set, test in VM macOS 26.6.2)

**Il DMG che distribuivamo era senza firma di bundle.** `npx tauri build` produce il
bundle con SOLO la firma automatica del linker (flags=0x20002) e SENZA
Resources/CodeResources. Verdetto spctl: *"code has no resources but signature
indicates they must be present"* → su Sequoia chi scarica via browser/WhatsApp
vede **"damaged and can't be opened"** — NON bypassabile col tasto destro.
Era esattamente il problema dell'amico. (Su macOS 26 invece: App Translocation →
l'app gira traslocata in sandbox con sidecar morto.)

**Fix**: `scripts/build-dmg.sh` — firma il bundle (identità stabile
"Quinki Self-Signing" via codesign-quinki.sh) e POI crea il DMG.

```
VERIFICATO IN VM (01 set):
  DMG firmato → install pulita → app ATTIVA + sidecar ATTIVO ✓
  spctl: "rejected" (classe MITE: seal valido, solo self-signed)
  → su Sequoia: "Apple could not verify" — BYPASSABILE tasto destro → Apri ✓
  → via curl installer: NESSUN dialog ✓
```

Per distribuire: SEMPRE `bash scripts/build-dmg.sh` dopo `npx tauri build`.
Per installare da utente finale: `bash scripts/install-curl.sh <DMG>`.

## Come funziona il blocco (per capire i workaround)

```
Browser (Safari/Chrome) scarica → aggiunge xattr "com.apple.quarantine"
    ↓
Utente doppio-click → Gatekeeper controlla: quarantine + firma Developer ID + notarizzazione
    ↓
Firma ad-hoc + quarantine = "damaged and can't be opened" (Sequoia+, non bypassabile con
tasto destro → Apri)
```

**La chiave di tutto: il quarantine è settato dal BROWSER, non dal sistema.**
Un file scaricato via `curl` NON ha quarantine → Gatekeeper NON scatta MAI.

Conferme trovate:
- HN: "Command-line download tools like curl do not apply the com.apple.quarantine
  extended attribute, allowing scripts to run without immediate OS blocks."
- alacritty#8749 (GunniBusch): "The quarantine flag is only set if you download via
  safari google etc. so if you use like curl it should not apply the quarantine flag.
  That's why homebrew sets it manually."
- I binari compilati in locale non hanno quarantine (per questo MacPorts funziona).

---

## Soluzioni concrete (in ordine di UX per il nostro target dev)

### Soluzione 1 — Installer via curl ⭐ (consigliata, gratis, UX fluida)

```bash
curl -fsSL https://quinki.app/install.sh | sh
```

Lo script: scarica via curl (niente quarantine) → copia in /Applications → pulisce xattr
per sicurezza → lancia l'app. Gatekeeper non appare MAI.

**Perché è perfetta per Quinki**: il target sono DEVELOPER (usano il terminale ogni
giorno). È lo stesso pattern di rustup, nvm, homebrew stesso. Zero frizioni per il target
giusto. Il tool interno `install-main.sh` fa già quasi tutto questo.

**Costo: 0€.** Serve solo hosting dello script (GitHub raw / sito).

### Soluzione 2 — Comando xattr documentato sul sito (fallback universale)

Per chi scarica il DMG/zip dal browser e vede "damaged":

```bash
xattr -cr /Applications/Quinki.app
```

Una riga, documentata nella download page con tasto Copy. È il workaround UFFICIALE di
Alacritty ("You first need to run xattr -rd com.apple.quarantine Alacritty.app on the
extracted application directory" — nixpulvis, maintainer) e di LibreWolf.

**Nota**: `xattr -cr` (clear recursive) è migliore di `-rd` (rimuove TUTTI gli xattr).

### Soluzione 3 — Homebrew tap di terze parti con postflight xattr

I tap UFFICIALI hanno bandito i cask unsigned (deadline 2026-09-01, Homebrew 5.0), MA
i tap di terze parti restano liberi. Precedenti reali:

- `github.com/deskflow/homebrew-tap` — cask con postflight che pulisce quarantine
  automaticamente. "You will need to run xattr but this can be done in post flight."
- `github.com/m99coder/homebrew-tap` — creato apposta per i cask banditi.

Per l'utente: `brew install --cask quinki/tap/quinki` → postflight pulisce xattr →
app funziona. Zero passaggi manuali.

**Costo: 0€.** (Un repository in più da mantenere.)

### Soluzione 4 — Install-Quinki.command (doppio click, via Terminal)

Un file .command scaricabile: doppio click → apre Terminal → esegue lo script della
Soluzione 1. Il .command scaricato dal browser ha quarantine → serve un "tasto destro →
Apri" sul .command una volta sola, poi tutto automatico. Compromesso decente per chi non
vuole copiare comandi a mano.

### Soluzione 5 — Build da sorgente (dev puristi)

Locally-built = no quarantine, per costruzione. Alacritty lo offre come via nobile:
`make app && cp -r Alacritty.app /Applications/`. Per Quinki: troppo pesante (Tauri/Rust),
ma documentabile nel README.

---

## Cosa NON funziona (bocciato dalla ricerca)

| Via | Esito |
|---|---|
| electron/notarize & simili | Solo client del servizio Apple → serve l'account $99 |
| Certificato self-signed (Keychain Access) | Gatekeeper lo blocca comunque sui Mac altrui |
| Tasto destro → Apri su ad-hoc+quarantine | Sequoia+ mostra "damaged", non più bypassabile così |
| `brew install` da tap ufficiale | Cask unsigned disabilitati dal 2026-09-01 |
| `brew install --cask --no-quarantine` | Flag RIMOSSO in Homebrew 5.0 |
| spctl --master-disable | Globale, disattiva TUTTE le verifiche — mai per utenti finali |
| "Notarization as a service" di terzi | Non esiste: Apple non accetta account di terzi per il tuo binario |

---

## Il precedente Alacritty (il caso più istruttivo)

Issue #8749 (nov 2025 → apr 2026): Homebrew depreca il cask → chieste di notarizzare →

- **chrisduerr (maintainer)**: "We do sign things [ad-hoc]. The problem is that we're not
  authorized as apple developers, and that costs 99$ a year." → "Closing this issue since
  I'm not interested in going the route of signing our application with an Apple signature."
- Un volontario (ex-Cloudflare, senior engineer CrowdStrike) si è OFFERTO di pagare i $99
  e fare la CI: rifiutato. "Not sure what else has to be said for people to stop offering
  to pay Apple's ransom demands." (principio, non solo denaro)
- Soluzione ufficiale per gli utenti: DMG + `xattr` documentato, oppure compile da sorgente.

Se un progetto da 65k stelle distribuisce così, Quinki può fare lo stesso durante la fase
gratuita/alpha. **Il $99 resta l'unica via per il "doppio click perfetto per non-dev"** —
da fare quando c'è pubblico/revenue, non prima.

---

## Piano consigliato per Quinki

1. **Ora (0€)**: download page con DMG + box "If macOS says damaged, run:" `xattr -cr …`
   + lo script `install.sh` via curl come via primaria per dev.
2. **Ora (0€)**: testare TUTTO nella VM UTM (macOS vergine) — verifica anche il dialog
   notifiche che era il dubbio originale: UNUserNotificationCenter dovrebbe funzionare
   anche con firma ad-hoc (il permesso notifiche NON richiede Developer ID).
3. **Dopo (opzionale)**: tap homebrew nostro con postflight xattr.
4. **Quando ha senso economicamente**: account $99 → `tauri build` fa firma+notarizza
   tutto da solo (config già pronta: signingIdentity + APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID).

## Fonti

- news.ycombinator.com/item?id=45907259 (Homebrew/Gatekeeper, discussione 700+ commenti)
- github.com/alacritty/alacritty/issues/8749 (il caso Alacritty completo)
- github.com/Homebrew/brew/issues/20755 (rimozione --no-quarantine)
- github.com/deskflow/homebrew-tap (precedente tap con postflight xattr)
- github.com/m99coder/homebrew-tap (tap per cask banditi)
- v2.tauri.app/distribute/sign/macos (config Tauri per quando arriverà il $99)
- hacktricks.wiki (dettagli tecnici quarantine/Gatekeeper)