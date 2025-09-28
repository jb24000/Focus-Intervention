/* Focus Intervention — Service Worker (v3)
 * - Navigations: network-first (fallback to cached index.html)
 * - Static assets: stale-while-revalidate
 * - Keeps SKIP_WAITING, Background Sync, Push/notification click handlers
 */

const CACHE_VERSION = 'fi-v3-2025-09-28';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
  // If you add 256px: './icons/icon-256.png',
];

/* ---------- Install: pre-cache essentials ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---------- Activate: clear old caches ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------- Helpers ---------- */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((networkResp) => {
    if (networkResp && networkResp.ok) cache.put(request, networkResp.clone());
    return networkResp;
  }).catch(() => cached);
  return cached || fetchPromise;
}

/* ---------- Fetch: smart routing ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only same-origin GET
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // HTML navigations → network first, fallback to cached index
  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, net.clone());
        return net;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(req)) || (await cache.match('./index.html'));
      }
    })());
    return;
  }

  // Static assets → stale-while-revalidate
  if (/\.(?:js|css|png|jpg|jpeg|svg|webp|json|woff2?)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Everything else → cache-first then network (optional)
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((net) => net))
  );
});

/* ---------- Messages from the page ---------- */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();

  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }

  if (data.type === 'SCHEDULE_NOTIFICATION') {
    // WARNING: long timers are unreliable in SW (worker may stop).
    const { title, body, delay } = data;
    setTimeout(() => {
      self.registration.showNotification(title || 'Reminder', {
        body: body || '',
        icon: './icons/icon-192.png',
        tag: 'scheduled-reminder'
      });
    }, Math.min(Number(delay || 0), 30000)); // keep short, or move to page/extension
  }
});

/* ---------- Background Sync (placeholder) ---------- */
self.addEventListener('sync', (event) => {
  if (event.tag === 'focus-data-sync') {
    event.waitUntil(syncFocusData());
  }
});
async function syncFocusData() {
  try {
    const stored = await getStoredData(); // implement as needed
    if (stored.length > 0) {
      // await fetch('/api/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(stored) });
      await clearStoredData();
      const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const client of clientsList) client.postMessage({ type: 'SYNC_SUCCESS', data: stored.length });
    }
  } catch (err) { /* noop */ }
}
async function getStoredData(){ return []; }
async function clearStoredData(){ /* noop */ }

/* ---------- Push ---------- */
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'Time for a focus check!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    image: './icons/icon-512.png',
    vibrate: [200,100,200,100,200],
    tag: 'focus-reminder',
    requireInteraction: true,
    renotify: true,
    data: { url: './?action=focus', timestamp: Date.now() },
    actions: [
      { action: 'focus-now', title: '🎯 Focus Now', icon: './icons/icon-192.png' },
      { action: 'snooze-5',  title: '⏰ Snooze 5m', icon: './icons/icon-192.png' },
      { action: 'snooze-15', title: '⏰ Snooze 15m', icon: './icons/icon-192.png' }
    ]
  };
  event.waitUntil(self.registration.showNotification('🎯 Focus Intervention', options));
});

/* ---------- Notification clicks ---------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const data = event.notification.data || {};
  const go = async (url) => {
    const clientsList = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const existing = clientsList.find(c => c.url && c.url.startsWith(self.location.origin));
    if (existing) { existing.navigate(url); existing.focus(); }
    else { await self.clients.openWindow(url); }
  };

  event.waitUntil((async () => {
    if (action === 'focus-now') return go('./?action=focus&notification=true');

    if (action === 'snooze-5' || action === 'snooze-15') {
      // WARNING: setTimeout in SW is not reliable for long delays.
      const mins = action === 'snooze-5' ? 5 : 15;
      setTimeout(() => {
        self.registration.showNotification('🔔 Focus Time!', {
          body: `Snooze over. Ready to focus?`,
          icon: './icons/icon-192.png',
          tag: 'snooze-reminder',
          requireInteraction: true
        });
      }, Math.min(mins * 60 * 1000, 30000)); // cap to 30s to avoid termination
      return;
    }

    // Default: open app
    return go('./');
  })());
});

/* ---------- Periodic Sync (optional) ---------- */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'focus-reminder') {
    event.waitUntil(
      self.registration.showNotification('🎯 Periodic Focus Check', {
        body: "How's your focus going?",
        icon: './icons/icon-192.png',
        tag: 'periodic-focus'
      })
    );
  }
});

console.log('[SW] Loaded', CACHE_VERSION);
