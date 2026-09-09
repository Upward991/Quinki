#!/usr/bin/env node
/**
 * Bundle sidecar with esbuild → single JS files runnable with `node`.
 * 20x faster startup vs `npx tsx`.
 *
 * Output: sidecar-src/bundle/ws-bridge.js + sidecar-src/bundle/sidecar.js
 */
import { build } from "esbuild";
import { rm, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

// Build-time secret injection (NEVER in the repo): value from ~/.quinki/oauth.conf
function readGhSecret() {
  try {
    if (process.env.QUINKI_GH_SECRET) return String(process.env.QUINKI_GH_SECRET);
    const p = process.env.HOME + "/.quinki/oauth.conf";
    if (existsSync(p)) {
      const m = require("fs").readFileSync(p, "utf8").match(/^GH_CLIENT_SECRET=(.+)$/m);
      if (m) return m[1].trim();
    }
  } catch {}
  return "";
}
const GH_SECRET = (function () { try { const m = existsSync(process.env.HOME + "/.quinki/oauth.conf") ? readFileSync(process.env.HOME + "/.quinki/oauth.conf", "utf8").match(/^GH_CLIENT_SECRET=(.+)$/m) : null; return m ? m[1].trim() : ""; } catch { return ""; } })();

const outdir = "sidecar-src/bundle";

// Clean
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// Common esbuild options
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  legalComments: "none",
  minify: false,          // readable for debugging, minify adds little for node
  write: true,
  logLevel: "info",
  // Node.js built-ins + optional native deps → external (resolved at runtime)
  external: [
    "child_process",
    "node:child_process",
    "fs",
    "node:fs",
    "path",
    "node:path",
    "os",
    "node:os",
    "http",
    "node:http",
    "https",
    "node:https",
    "url",
    "node:url",
    "crypto",
    "node:crypto",
    "stream",
    "node:stream",
    "util",
    "node:util",
    "zlib",
    "node:zlib",
    "net",
    "node:net",
    "tls",
    "node:tls",
    "dns",
    "node:dns",
    "buffer",
    "node:buffer",
    "events",
    "node:events",
    "querystring",
    "node:querystring",
    // Optional deps loaded lazily at runtime
    "pdf-parse",
    "mammoth",
    "xlsx",
    "adm-zip",
    "jiti",
    "jiti/static",
    "@silvia-odwyer/photon-node",
    // ws is in node_modules, let esbuild bundle it
  ],
  // Override __dirname to process.cwd() so relative paths resolve
  // to sidecar-src/ (the cwd set by start.sh / ws-bridge)
  // Also polyfill import.meta.url for vendor code that uses fileURLToPath
  banner: {
    js: `var __dirname = process.cwd();\nvar __import_meta_url = require("url").pathToFileURL(__filename).href;`,
  },
  define: {
    'import.meta.url': '__import_meta_url',
    ...(GH_SECRET ? { 'process.env.QUINKI_GH_SECRET': JSON.stringify(GH_SECRET) } : {}),
  },
};

// 1. Bundle ws-bridge.ts
console.log("Bundling ws-bridge.ts...");
await build({
  ...common,
  entryPoints: ["sidecar-src/ws-bridge.ts"],
  outfile: `${outdir}/ws-bridge.cjs`,
});

// 2. Bundle sidecar.ts
console.log("Bundling sidecar.ts...");
await build({
  ...common,
  entryPoints: ["sidecar-src/sidecar.ts"],
  outfile: `${outdir}/sidecar.cjs`,
});

console.log("✅ Sidecar bundled to sidecar-src/bundle/");