# Ollama cloud bug: `deepseek-v4.1-flash:cloud` returns 500 with image input over ~655,360 tokens

**Status:** server-side bug of ollama.com — fixed nowhere yet. Reproducible with raw HTTP, no Quinki code in the chain.
**Last independent verification:** 2026-10-07, daemon 0.40.0, macOS (Apple Silicon).
**Owner of the fix:** ollama.com (cloud backend), not the local daemon.

---

## Independent verification (App Expert, 2026-10-07, on the production machine)

Environment check: daemon 0.40.0, model listed locally (`deepseek-v4.1-flash:cloud`), declared
`context length 1048576`, capability `vision` present. Local OpenAI-compatible endpoint
`http://127.0.0.1:11434/v1/chat/completions`.

Identical payload, single variable = the image (1×1 PNG, 67 bytes), filler sized as in the
original minimal reproduction:

| with_image | result | time | detail |
|---|---|---|---|
| **yes** | **HTTP 500** | **1.9 s** | `Internal Server Error (ref: 7cd59b77-feee-42d8-abfb-511d450d41cd)` |
| **no** | **HTTP 200** | **9.6 s** | `prompt_tokens: 660,836` |

Conclusions added by this run:

- The bug is **still live** as of 2026-10-07 and deterministic (new ref captured above).
- **Timing proves it is a validation-path crash, not an inference/compute problem**: the failing
  request dies in **1.9 s**, i.e. before any real prefill; the same-size passing request takes
  **9.6 s** of actual prompt processing (660,836 tokens).
- The 1×1 image being enough shows the trigger is the **multimodal code path**, not image bytes.

Reproduction script: `/tmp/ollama-repro.py` (same as the one embedded in the report below).

---

## Original report (from a Quinki session, 2026-10-07)

**Verdetto:** bug del backend di ollama.com — **non** dell'app, **non** del conteggio token, **non** della macchina. Deterministico e riproducibile con richieste HTTP grezze (nessun codice Quinki in mezzo). Persistente dal **19 settembre** al **7 ottobre** nonostante gli aggiornamenti.

### 1) Il bug in una riga

> Su `deepseek-v4.1-flash:cloud`, **qualsiasi richiesta che contiene un'immagine e supera ≈655.360 token reali** (640×1024 = **62,5%** del milione dichiarato) riceve **HTTP 500** `{"message":"Internal Server Error (ref: …)","type":"api_error","param":null,"code":null}` in ~2 secondi. Senza immagine, la stessa richiesta passa anche a 865.502 token. Con la stessa immagine, `glm-5.3-flash:cloud` passa a 665.327.

### 2) Riproduzione minima (con esito atteso vs reale)

```python
import json, urllib.request, urllib.error

# ~520k token cl100k di filler → il server conta ≈662k.
# Non serve la dimensione esatta: qualunque cosa sopra ~655.360 (con immagine) triggera.
text = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt "
        "ut labore et dolore magna aliqua. ") * 23600
img  = ("data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")  # PNG 1x1, 67 byte

for with_image in (True, False):
    content = [{"type": "text", "text": text + "\n\nReply with exactly: OK"}]
    if with_image:
        content.append({"type": "image_url", "image_url": {"url": img}})
    body = {"model": "deepseek-v4.1-flash:cloud",
            "messages": [{"role": "user", "content": content}],
            "max_completion_tokens": 16}
    req = urllib.request.Request("http://127.0.0.1:11434/v1/chat/completions",
                                 data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=300)
        print("with_image =", with_image, "->", r.status)
    except urllib.error.HTTPError as e:
        print("with_image =", with_image, "->", e.code, e.read()[:160])
```
**Atteso:** 200 per entrambi. **Reale:** con immagine → **500 + ref**; senza → **200** (`prompt_tokens: 661.856`).

### 3) Confini misurati (stesso contenuto, unica variabile: l'immagine)

| Configurazione | prompt_tokens (server) | Esito |
|---|---|---|
| + immagine (1×1 o 514KB, uguale) | 647.758 / 651.572 / **654.764** | ✅ 200 |
| + immagine | **≈655.400 / ≈655.800 / ≈657.300** | ❌ 500 (deterministico, 5+ ref) |
| **senza** immagine | 657.414 / 659.318 / 662.517 / 674.596 / 678.412 / 698.281 / **865.502** | ✅ tutti 200 |

→ Il muro scatta tra **654.764 e ~655.403**: coincide con **655.360 = 640×1024 = 62,5% di 1.048.576**.

### 4) Esclusioni (perché NON è "nostro")

1. **Riprodotto senza l'app**: stesse richieste via `curl`/Python diretti al daemon → stesso 500. Nessun codice dell'app nella catena → non può essere un problema dell'app.
2. **Non è il conteggio token**: il numero a cui si applica il limite è **calcolato dal loro server** (`prompt_tokens` nella risposta). Il contatore dell'app è solo UI e non viene inviato. Controprova: stesso testo senza immagine, stesso conteggio, 200.
3. **Non è la macchina/il daemon locale**: il daemon (0.35.0 prima, **0.40.0 ora** — bug identico) è un puro proxy; l'errore nasce a monte (stessa firma `(ref: UUID)` dei loro errori di quota).
4. **Non è il modello in generale**: `glm-5.3-flash:cloud` con la stessa immagine a 665.327 → 200. È specifico di `deepseek-v4.1-flash:cloud`.

### 5) Ref per i loro log (da citare nell'issue)

**Test miei controllati — 7 ott 2026, ≈17:54–17:56 UTC** (PNG 1×1):
- `c7b680ec-1ec4-456c-915d-619dd79c4ea3` (≈662K)
- `952231f2-9e86-49e6-acdc-cf8132690026` (≈675K)
- `ccad8e2f-28a8-47ac-bc82-ee5af0cfd8af` (≈700K)

**Test miei — 2 ott 2026, ≈18:28–18:40 UTC**:
- `6b53f2e8-fa44-4a07-9a84-d3bcb86c9840`, `9a5980b1-549d-4acd-af2c-045e0f91e29b`, `cf876873-7d77-4b40-b069-23d1e56ed149` (replay conversazione reale + immagine, 3/3 fail)
- `04c6a1f9-98fb-4182-997c-6950236eea32`, `dd451637-45eb-4b44-bb6a-afd44a155916` (soglia)
- `c60ec807-60fd-4d4b-802b-cd38fe2b0050`, `1a82bbe0-7427-406a-9cab-81702b3ab4c7` (sintetici, uno con immagine vera e uno con PNG 67 byte)

**Produzione (dalla app, stesso modello)**:
- `1b837243-6169-41a8-8ee1-a30126e671cf` — 2 ott, 17:51:16 UTC
- `adbe3da6-074a-429d-8ffd-2ad4aeb5820a` — 30 set, 23:48 UTC
- `5c64715f-4af3-4bd2-a958-58dfccaf5001` — 6 ott, 22:02 UTC
- + **129 errori totali registrati dal 19 set al 7 ott**, tutti di questo modello, sempre sulla prima richiesta con immagine oltre ~655–660K.

**Verifica indipendente (App Expert) — 7 ott 2026**:
- `7cd59b77-feee-42d8-abfb-511d450d41cd` (≈661K, con immagine, fail in 1,9s)

### 6) Note tecniche utili

- Le immagini contribuiscono **≈0** al `prompt_tokens` (647.860 → 647.758 stesso payload ± immagine da 514KB): ma la loro **presenza** sposta la richiesta sul percorso che crasha oltre la soglia.
- Ipotesi per loro: il percorso "vision" applica/assume un limite effettivo di ~640Ki token e oltre soglia risponde con un'eccezione non gestita invece di un errore pulito.
- Perché l'utente lo vede "sempre al 60%": il contatore dell'app (cl100k) legge ~4-5% in meno del tokenizer reale di DeepSeek → 655.360 reali ≈ 59,5-60% mostrati. Non è un problema di conteggio: è un muro **assoluto** che coincide con quella percentuale.
- *(Contesto app: Quinki gestisce già le immagini con cap a 3 e rimozione per modelli senza vision, e sul 500 fa fallback di modello — mitigazioni che a volte mascherano il bug, ma la causa resta a monte.)*

---

# GitHub issue draft (English, for ollama/ollama)

**Title:**
```
[Cloud] deepseek-v4.1-flash:cloud returns 500 (Internal Server Error, ref) for any request containing image input when the prompt exceeds ~655,360 tokens
```

**Body:**
```markdown
### Summary
On ollama.com (via local daemon, OpenAI-compatible endpoint `/v1/chat/completions`), `deepseek-v4.1-flash:cloud` deterministically returns HTTP 500 `{"message":"Internal Server Error (ref: …)","type":"api_error","param":null,"code":null}` for any request that contains an image once the prompt exceeds ≈655,360 tokens (640×1024 = 62.5% of the declared 1,048,576 context). A 1×1 PNG (67 bytes) is enough to trigger it. The identical payload without the image returns 200 at 661,856 prompt tokens. `glm-5.3-flash:cloud` handles the same image at 665,327 tokens fine.

### Environment
- Client: Ollama daemon 0.40.0 (bug also present on 0.35.0), macOS (Apple Silicon); requests to http://127.0.0.1:11434/v1/chat/completions (proxied to ollama.com)
- Model: deepseek-v4.1-flash:cloud (remote_host: https://ollama.com; declared context_length: 1048576; capabilities include vision)

### Minimal reproduction
[insert the Python script from the report — section 2]
Actual: `with_image=True -> 500 {"message":"Internal Server Error (ref: …)"}`; `with_image=False -> 200` (prompt_tokens ≈ 661,856).

### Measured boundary (with/without image, same payload)
| prompt_tokens | image | result |
|---|---|---|
| 654,764 | yes | 200 |
| ~655,403 | yes | 500 |
| ~657,290 | yes | 500 (3/3 retries) |
| 657,414 | no | 200 |
| 662,517 | no | 200 |
| 678,412 | no | 200 |
| 865,502 | no | 200 |

### Timing evidence (validation-path crash, not compute)
With image: 500 in **1.9 s** (before any prefill). Without image, same size: 200 in **9.6 s**
(660,836 prompt tokens actually processed). The failure happens before inference starts.

### Cross-model control
glm-5.3-flash:cloud + same image: 650,323 -> 200; 665,327 -> 200.

### Error refs (for server-log lookup; all UTC)
2026-10-07: c7b680ec-1ec4-456c-915d-619dd79c4ea3, 952231f2-9e86-49e6-acdc-cf8132690026,
ccad8e2f-28a8-47ac-bc82-ee5af0cfd8af, 7cd59b77-feee-42d8-abfb-511d450d41cd
2026-10-02: 6b53f2e8-fa44-4a07-9a84-d3bcb86c9840, 9a5980b1-549d-4acd-af2c-045e0f91e29b,
cf876873-7d77-4b40-b069-23d1e56ed149, 04c6a1f9-98fb-4182-997c-6950236eea32,
dd451637-45eb-4b44-bb6a-afd44a155916, c60ec807-60fd-4d4b-802b-cd38fe2b0050,
1a82bbe0-7427-406a-9cab-81702b3ab4c7

### Notes
- Images contribute ≈0 to prompt_tokens (647,860 vs 647,758 for the same payload ± 514 KB image), yet their presence flips the request on the failing path above the threshold.
- Likely the vision path enforces/assumes an effective ~640Ki limit and mishandles over-limit input (unhandled error instead of a graceful response).
- In production this hits long agentic sessions deterministically (129 occurrences Sep 19 - Oct 7), always on the first request whose image-bearing prompt crosses ~655-660k tokens.
```

## Channels

1. **GitHub (main):** `https://github.com/ollama/ollama/issues/new` — paste Title + Body above.
2. **Discord (officially faster for cloud):** `https://discord.gg/ollama` — 2-line message: model, condition (image + >655K), 2-3 refs, link to the issue.
3. Possibly support@ollama.com with the same text.
