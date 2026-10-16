// =============================================================================
// /tmp BAN — regola utente (16 ott 2026): i file temporanei NON vanno nel /tmp
// di sistema. Ognuno lavora nella PROPRIA directory (~/.quinki).
//
// Perche' esiste questo file: os.tmpdir()/TMPDIR e' la "temperatura" usata da
// TUTTO (SDK, strumenti, librerie, processi figli) per i file temporanei.
// Impostandolo qui, prima di ogni altro import, quei file finiscono in
// ~/.quinki/tmp invece che in /tmp — senza doverlo chiedere a nessuno.
//
// Va importato come PRIMISSIMO import di un entry point (sidecar, CLI) cosi'
// che parta prima che l'SDK e le librerie leggano TMPDIR.
// =============================================================================
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const QUINKI_TMP =
  process.env.QUINKI_TMP_DIR || join(homedir(), ".quinki", "tmp");

try {
  mkdirSync(QUINKI_TMP, { recursive: true });
  // TMPDIR = Unix/macOS; TMP/TEMP = fallback cross-platform (porting Win/Linux).
  process.env.TMPDIR = QUINKI_TMP;
  process.env.TMP = QUINKI_TMP;
  process.env.TEMP = QUINKI_TMP;
} catch {}

// Pulizia di boot (sincrona ma velocissima: una readdir di una cartella piccola):
// cancella i temporanei piu' vecchi di 3 giorni. I file in uso sono recenti per
// definizione, quindi non si rischia di cancellare qualcosa mentre serve.
try {
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(QUINKI_TMP)) {
    try {
      const p = join(QUINKI_TMP, name);
      if (statSync(p).mtimeMs < cutoff) rmSync(p, { recursive: true, force: true });
    } catch {}
  }
} catch {}
