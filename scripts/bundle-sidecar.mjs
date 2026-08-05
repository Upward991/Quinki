#!/usr/bin/env node
/**
 * Bundle sidecar with esbuild → single JS files runnable with `node`.
 * 20x faster startup vs `npx tsx`.
 *
 * Output: sidecar-src/bundle/ws-bridge.js + sidecar-src/bundle/sidecar.js
 */
import { build } from "esbuild";
import { rm, mkdir } from "node:fs/promises";

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