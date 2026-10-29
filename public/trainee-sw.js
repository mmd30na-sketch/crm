/* Carla CRM trainee portal service worker (پرتال کارآموز).
 * Offline shell for /?portal=1: network-first navigations (portal page cached), stale-while-revalidate for the
 * hashed Vite assets and images. API, uploads and /p/ payment links are never intercepted or cached.
 * Bump CACHE to invalidate. */
const CACHE = 'carla-trainee-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      return Promise.allSettled([
        cache.add('/'),
        cache.add('/?portal=1'),
        cache.add('/trainee-manifest.webmanifest'),
        cache.add('/logo.png'),
        cache.add('/trainee-icon-192.png'),
        cache.add('/trainee-icon-512.png'),
        cache.add('/trainee-icon-512-maskable.png'),
      ]);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('carla-trainee-') && key !== CACHE) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/p/')) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok && url.searchParams.get('portal') === '1') {
          const cacheResponse = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/?portal=1', cacheResponse));
        }
        return response;
      }).catch(() => {
        return caches.match('/?portal=1').then((cached) => cached || caches.match('/'));
      })
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot)$/)) {
    event.respondWith(
      caches.open(CACHE).then((cache) => {
        return cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached || Response.error());
          return cached || networkFetch;
        });
      })
    );
  }
});
