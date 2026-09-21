/* Pulse service worker — app-shell cache only.
   Cross-origin requests (Supabase realtime, jsDelivr, esm.sh) are never
   intercepted: they must go to the network. */

const CACHE = 'pulse-v1'
const SHELL = [
  './',
  './index.html',
  './config.js',
  './fingerprint.js',
  './pulse.js',
  './manifest.webmanifest',
  './icon.svg',
  './favicon-32.png',
  './apple-touch-icon.png',
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Anything not on this origin (Supabase, CDNs, avatar images) — let the
  // browser handle it directly. No caching, no offline behaviour.
  if (url.origin !== self.location.origin) return

  // Navigations: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    )
    return
  }

  // Same-origin assets: cache first, refresh in the background.
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(req, copy))
        }
        return res
      }).catch(() => cached)
      return cached || network
    })
  )
})