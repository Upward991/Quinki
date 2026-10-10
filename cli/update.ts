// =============================================================================
// cli/update.ts — Quinki CLI self-update.
//
// Fonte di verita': le release GitHub di Upward991/Quinki (asset "Quinki_CLI_*
// _macos-arm64"). Funziona anche per chi usa SOLO la CLI (senza app installata).
//
// Flusso:
//   - ad ogni avvio la CLI stampa la sua versione e, se esiste una release piu'
//     nuova, lo segnala e chiede se aggiornare (Y/n);
//   - `quinki update` aggiorna su comando; `quinki update --check` solo verifica;
//   - `quinki --version` stampa la versione.
// =============================================================================
import fs from "node:fs";
import path from "node:path";

// Versione: inietta in build da build-cli.sh (--define __QUINKI_CLI_VERSION__).
// Fallback: package.json accanto al binario (cli/dist in sviluppo). Ultimo: "dev".
declare const __QUINKI_CLI_VERSION__: string | undefined;
export function cliVersion(): string {
  try {
    if (typeof __QUINKI_CLI_VERSION__ === "string" && __QUINKI_CLI_VERSION__) return __QUINKI_CLI_VERSION__;
  } catch {}
  try {
    const pkg = path.join(path.dirname(process.execPath), "package.json");
    const v = JSON.parse(fs.readFileSync(pkg, "utf8"))?.version;
    if (typeof v === "string" && v) return v;
  } catch {}
  return "dev";
}

const REPO = "Upward991/Quinki";
const ASSET_RE = /^Quinki_CLI_.*_macos-arm64$/;

export type UpdateInfo = { version: string; url: string };

// Legge l'ultima release (tag) e trova l'asset della CLI. Null = rete KO / niente.
export async function fetchLatestCli(timeoutMs = 3500): Promise<UpdateInfo | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "quinki-cli" },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return null;
    const j: any = await r.json();
    const ver = String(j?.tag_name || "").replace(/^v/, "");
    if (!ver) return null;
    const asset = (j?.assets || []).find((a: any) => ASSET_RE.test(String(a?.name || "")));
    if (!asset?.browser_download_url) return null;
    return { version: ver, url: String(asset.browser_download_url) };
  } catch {
    return null;
  }
}

// beta.44 vs beta.45 (o x.y.z): confronta base e numero di beta.
export function isNewer(remote: string, current: string): boolean {
  const p = (v: string) => {
    const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : -1] : null;
  };
  const a = p(remote);
  const b = p(current);
  if (!a || !b) return false;
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  return false;
}

// Scarica l'asset e sostituisce il binario in esecuzione (rename atomico: il
// processo vivo continua con la vecchia immagine, il prossimo avvio usa la nuova).
export async function selfUpdate(url: string): Promise<{ ok: boolean; error?: string }> {
  let tmp = "";
  try {
    const target = process.execPath;
    const dir = path.dirname(target);
    tmp = path.join(dir, ".quinki-new-" + Date.now());
    const r = await fetch(url, { headers: { "User-Agent": "quinki-cli" }, redirect: "follow" });
    if (!r.ok) return { ok: false, error: "download failed (HTTP " + r.status + ")" };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1024 * 1024) return { ok: false, error: "downloaded file looks wrong (" + buf.length + " bytes)" };
    fs.writeFileSync(tmp, buf);
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, target);
    return { ok: true };
  } catch (e: any) {
    try { if (tmp) fs.unlinkSync(tmp); } catch {}
    return { ok: false, error: String(e?.message || e) };
  }
}

// Prompt Y/n sul terminale (Invio = si'). Usato solo quando c'e' un update.
export function askYesNo(q: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const onData = (d: Buffer) => {
      const s = d.toString().trim().toLowerCase();
      resolve(s === "" || s === "y" || s === "yes" || s === "s" || s === "si" || s === "sì");
    };
    try {
      process.stdin.resume();
      process.stdin.once("data", onData);
    } catch {
      resolve(false);
    }
  });
}
