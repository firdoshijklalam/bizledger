// BizLedger Service Worker — network-first (NO caching in dev)
const CACHE_NAME = 'bizledger-v2'

self.addEventListener('install', (event) => {
  // Skip waiting — activate immediately
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Delete ALL old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Network-first for EVERYTHING — never serve stale cache
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  // Always go to network first, only use cache if network fails
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  )
})
