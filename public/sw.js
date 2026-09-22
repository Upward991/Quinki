// Quinki service worker — richiesto da Chrome/Android per l'installazione come PWA.
// NESSUNA cache: l'app deve sempre caricare l'ultima versione servita dal sidecar
// (durante lo sviluppo e gli aggiornamenti non vogliamo mai UI vecchie).
self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', () => { /* pass-through: nessuna cache */ })


// === PUSH: notifiche anche con app chiusa ===
self.addEventListener('push', function (e) {
  var d = {}
  try { d = e.data ? e.data.json() : {} } catch (e2) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Quinki', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { sessionKey: d.sessionKey || '' },
  }))
})
self.addEventListener('notificationclick', function (e) {
  e.notification.close()
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { try { cs[i].focus(); return } catch (e2) {} }
    return clients.openWindow('/')
  }))
})
