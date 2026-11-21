// BizLedger Service Worker — Production-safe caching strategy.
//
// §CACHING-POLICY:
// 1. NETWORK-FIRST for the app shell (HTML pages) — always fetch fresh, fall
//    back to cache only when offline. This ensures users get updates immediately
//    but can still load the app when the network is flaky.
// 2. CACHE-FIRST for static assets (_next/static, fonts, images, icons) —
//    these are content-hashed so cached versions are always safe to serve.
// 3. NEVER cache API responses — all /api/* requests go straight to the network.
//    This prevents stale financial data, session leaks, and ensures
//    authenticated responses are never stored in the SW cache.
//
// §SECURITY: No authenticated API response is ever cached. The cache only
// contains public static assets and the app shell HTML.

const CACHE_VERSION = 'bizledger-v1'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const SHELL_CACHE = `${CACHE_VERSION}-shell`

// Static assets that are safe to cache (content-hashed, immutable)
const STATIC_PATTERNS = [
  /\/_next\/static\//,
  /\/fonts\//,
  /\/icon-\d+\.png$/,
  /\/apple-touch-icon\.png$/,
  /\/logo\.svg$/,
  /\/manifest\.json$/,
]

// App shell routes (HTML pages)
const SHELL_PATTERNS = [
  /^\/$/,
  /^\/login$/,
]

// Never cache API requests
function isApiRequest(url) {
  return url.pathname.startsWith('/api/')
}

function isStaticAsset(url) {
  return STATIC_PATTERNS.some(p => p.test(url.pathname))
}

function isShellRoute(url) {
  return SHELL_PATTERNS.some(p => p.test(url.pathname))
}

self.addEventListener('install', (event) => {
  // Pre-cache the app shell for offline access
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(['/', '/login', '/manifest.json', '/icon-192.png', '/icon-512.png']).catch(() => {
        // If any pre-cache fails, continue anyway — we'll cache on demand
      })
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Clean up old caches from previous versions
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle GET requests
  if (request.method !== 'GET') return

  // §NEVER-CACHE: All API requests go straight to network — no caching of
  // authenticated responses, financial data, or session info.
  if (isApiRequest(url)) return

  // §CACHE-FIRST: Static assets (immutable, content-hashed)
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone))
          }
          return response
        })
      })
    )
    return
  }

  // §NETWORK-FIRST: App shell (HTML pages) — fetch fresh, fall back to cache
  if (request.mode === 'navigate' || isShellRoute(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => {
          // Offline — serve cached shell
          return caches.match(request).then((cached) => {
            return cached || caches.match('/')
          })
        })
    )
    return
  }

  // Default: try network, fall back to cache
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  )
})

// Allow the page to trigger immediate activation on update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
