// Quinki service worker — richiesto da Chrome/Android per l'installazione come PWA.
// NESSUNA cache: l'app deve sempre caricare l'ultima versione servita dal sidecar
// (durante lo sviluppo e gli aggiornamenti non vogliamo mai UI vecchie).
self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', () => { /* pass-through: nessuna cache */ })
