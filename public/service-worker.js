/* Fleet Management System — Service Worker v1.2 */
const CACHE_NAME = 'fms-v2'

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS)
    }).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    }).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url)

    // Skip non-GET requests entirely — let them pass through
    if (event.request.method !== 'GET') return

    // Skip Supabase API — always network, never cache
    if (url.hostname.includes('supabase.co')) {
      event.respondWith(
        fetch(event.request.clone()).catch(() => {
          return new Response(
            JSON.stringify({ error: 'No internet connection' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          )
        })
      )
      return
    }

    // Skip cross-origin requests
    if (url.origin !== self.location.origin) return

    // App shell — network first, cache fallback
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseClone = response.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone)
            })
          }
          return response
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html')
            }
          })
        })
    )
  } catch (e) {
    // If anything throws, just let the request pass through normally
    console.warn('SW fetch error:', e)
  }
})
