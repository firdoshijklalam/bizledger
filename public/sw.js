// BizLedger Service Worker — DISABLED for preview stability.
// The previous stale-while-revalidate SW was caching error responses when the
// dev server temporarily restarted, causing "client-side exception" errors in
// the preview iframe. This no-op SW immediately unregisters itself and passes
// all requests straight through to the network.
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete ALL existing caches
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      // Unregister this service worker so future loads have NO SW at all
      const regs = await self.registration.scope
      const allRegs = await self.clients.matchAll()
      void regs
      void allRegs
      await self.registration.unregister()
      await self.clients.claim()
    })()
  )
})

// Pass-through: never intercept any request
self.addEventListener('fetch', () => {
  // no-op — let the browser handle it
})
