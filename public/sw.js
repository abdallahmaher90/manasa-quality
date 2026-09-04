self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // A simple fetch handler is required by PWA specifications
  // We can just let the browser handle everything normally
  event.respondWith(fetch(event.request))
})
