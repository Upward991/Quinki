import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// === Web build (F1): the same UI, made to run in a browser (served by the sidecar) ===
// The @tauri-apps/* imports are redirected to the light shims in src/platform/web/.
// The desktop build is untouched (it keeps the real Tauri API).
const shim = (name: string) => new URL(`./src/platform/web/${name}`, import.meta.url).pathname

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2020',
  },
  resolve: {
    alias: [
      { find: '@tauri-apps/api/core', replacement: shim('core.ts') },
      { find: '@tauri-apps/api/event', replacement: shim('event.ts') },
      { find: '@tauri-apps/api/window', replacement: shim('window.ts') },
      { find: '@tauri-apps/api/app', replacement: shim('app.ts') },
      { find: '@tauri-apps/api/webview', replacement: shim('webview.ts') },
    ],
  },
})
