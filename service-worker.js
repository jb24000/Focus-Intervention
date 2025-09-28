/* Focus Intervention — Service Worker (v3, with Snooze Scheduling)
 * - Navigations: network-first (fallback to cached index.html)
 * - Static assets: stale-while-revalidate
 * - Keeps SKIP_WAITING, Background Sync, Push & Notification actions
 * - Snooze: uses Notification Triggers when available; otherwise short-hop fallback
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

/* -------------------------------------------------------------------------- */
/* Snooze helpers                                                             */
/* -------------------------------------------------------------------------- */

function supportsTimestampTrigger() {
  // Available on some Chromium builds/platforms
  // eslint-disable-next-line no-undef
  return typeof TimestampTrigger === 'function';
}

/**
 * Schedule a local notification inside the SW.
 * - If Notification Triggers exist → schedule exactly at "whenMs".
 * - Else → best-effort fallback: hop with short timers until "whenMs".
 */
async function scheduleLocalNotificationAt(
  whenMs,
  title,
  body,
  tag = 'scheduled-reminder',
  data = {}
) {
  if (supportsTimestampTrigger()) {
    try {
      // eslint-disable-next-line no-undef
      await self.registration.showNotification(title || 'Reminder', {
        body: body || '',
        icon: './icons/icon-192.png',
        tag,
        data,
        requireInteraction: true,
        showTrigger: new TimestampTrigger(whenMs)
      });
      return true;
    } catch (e) {
      // fall through to fallback
    }
  }

  // Fallback: hop in short intervals (best-effort; SW may still be suspended)
  const HOP = 29000; // keep under ~30s to reduce termination risk
  while (Date.now() < whenMs) {
    await new Promise((r) => setTimeout(r, Math.min(HOP, whenMs - Date.now())));
  }
  await self.registration.showNotification(title || 'Reminder', {
    body: body || '',
    icon: './icons/icon-192.png',
    tag,
    data,
    requireInteraction: true
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Install / Activate                                                         */
/* -------------------------------------------------------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

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

/* -------------------------------------------------------------------------- */
/* Fetch routing                                                              */
/* -------------------------------------------------------------------------- */

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((networkResp) => {
    if (networkResp && networkResp.ok) cache.put(request, networkResp.clone());
    return networkResp;
  }).catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin GET
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

  // Everything else → cache-first then network
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((net) => net))
  );
});

/* -------------------------------------------------------------------------- */
/* Messages from the page                                                     */
/* -------------------------------------------------------------------------- */

self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }

  if (data.type === 'SCHEDULE_NOTIFICATION') {
    const delay = Math.max(0, Number(data.delay || 0));
    const when = Date.now() + delay;
    event.waitUntil(
      scheduleLocalNotificationAt(
        when,
        data.title || 'Reminder',
        data.body || '',
        'scheduled-reminder',
        data.payload || {}
      )
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Background Sync (placeholder)                                              */
/* -------------------------------------------------------------------------- */

self.addEventListener('sync', (event) => {
  if (event.tag === 'focus-data-sync') {
    event.waitUntil(syncFocusData());
  }
});

async function syncFocusData() {
  try {
    const stored = await getStoredData(); // implement as needed
    if (stored.length > 0) {
      // Example:
      // await fetch('/api/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(stored) });
      await clearStoredData();
      const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const client of clientsList) {
        client.postMessage({ type: 'SYNC_SUCCESS', data: stored.length });
      }
    }
  } catch (err) {
    // no-op
  }
}

async function getStoredData() { return []; }
async function clearStoredData() { /* no-op */ }

/* -------------------------------------------------------------------------- */
/* Push & Notification actions                                                */
/* -------------------------------------------------------------------------- */

self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'Time for a focus check!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png', // keep if you have it; else switch to 192
    image: './icons/icon-512.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'focus-reminder',
    requireInteraction: true,
    renotify: true,
    sticky: false,
    silent: false,
    data: { url: './?action=focus', timestamp: Date.now() },
    actions: [
      { action: 'focus-now', title: '🎯 Focus Now', icon: './icons/icon-96.png' },
      { action: 'snooze-5',  title: '⏰ Snooze 5m', icon: './icons/icon-96.png' },
      { action: 'snooze-15', title: '⏰ Snooze 15m', icon: './icons/icon-96.png' }
    ]
  };

  event.waitUntil(self.registration.showNotification('🎯 Focus Intervention', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const clickAction = event.action;

  const openOrFocus = async (url) => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clientsList.find((c) => c.url && c.url.startsWith(self.location.origin));
    if (existing) { existing.navigate(url); existing.focus(); }
    else { await self.clients.openWindow(url); }
  };

  event.waitUntil((async () => {
    if (clickAction === 'focus-now') {
      return openOrFocus('./?action=focus&notification=true');
    }

    if (clickAction === 'snooze-5' || clickAction === 'snooze-15') {
      const mins = clickAction === 'snooze-5' ? 5 : 15;
      const when = Date.now() + mins * 60 * 1000;
      return scheduleLocalNotificationAt(
        when,
        '🔔 Focus Time!',
        'Snooze over. Ready to focus?',
        'snooze-reminder',
        { url: './?action=focus' }
      );
    }

    // Default: just open the app
    return openOrFocus('./');
  })());
});

/* -------------------------------------------------------------------------- */
/* Periodic background sync (optional)                                        */
/* -------------------------------------------------------------------------- */

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'focus-reminder') {
    event.waitUntil(
      self.registration.showNotification('🎯 Periodic Focus Check', {
        body: "How's your focus going?",
        icon: './icons/icon-192.png',
        tag: 'periodic-focus',
        requireInteraction: false
      })
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Error hooks (for dev diagnostics)                                          */
/* -------------------------------------------------------------------------- */

self.addEventListener('error', (event) => {
  // Note: some browsers may not emit this in SW; keep for development
  // console.error('[SW] Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  // console.error('[SW] Unhandled promise rejection:', event.reason);
});

/* -------------------------------------------------------------------------- */

console.log('[SW] Loaded', CACHE_VERSION);
