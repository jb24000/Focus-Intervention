const CACHE_NAME = 'focus-intervention-v1.2';
const STATIC_CACHE_NAME = 'focus-static-v1.2';
const DYNAMIC_CACHE_NAME = 'focus-dynamic-v1.2';

// Files to cache immediately
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './?action=focus',
  './?action=start', 
  './?action=emergency',
  // Add icon paths when you have actual icon files
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Force activation of new service worker
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE_NAME && 
                cacheName !== DYNAMIC_CACHE_NAME &&
                cacheName.startsWith('focus-')) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Take control of all clients immediately
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip cross-origin requests
  if (!request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[SW] Serving from cache:', request.url);
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(request)
          .then((networkResponse) => {
            // Don't cache if not a success response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // Clone the response for caching
            const responseToCache = networkResponse.clone();

            caches.open(DYNAMIC_CACHE_NAME)
              .then((cache) => {
                console.log('[SW] Caching new resource:', request.url);
                cache.put(request, responseToCache);
              });

            return networkResponse;
          })
          .catch((error) => {
            console.error('[SW] Fetch failed:', error);
            
            // Return offline fallback for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('./');
            }
            
            return new Response('Offline - Please check your connection', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
      })
  );
});

// Background sync for offline functionality
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'focus-data-sync') {
    event.waitUntil(syncFocusData());
  }
});

async function syncFocusData() {
  try {
    // Get stored offline data
    const stored = await getStoredData();
    
    if (stored.length > 0) {
      console.log('[SW] Syncing', stored.length, 'items');
      
      // Send data to server when back online
      // await fetch('/api/sync', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(stored)
      // });
      
      // Clear stored data after successful sync
      await clearStoredData();
      
      // Notify all clients about successful sync
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'SYNC_SUCCESS',
          data: stored.length
        });
      });
    }
  } catch (error) {
    console.error('[SW] Sync failed:', error);
  }
}

async function getStoredData() {
  // Get data from IndexedDB or localStorage
  // This is a placeholder - implement based on your data structure
  return [];
}

async function clearStoredData() {
  // Clear synced data from local storage
  console.log('[SW] Clearing synced data');
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
  const options = {
    body: event.data ? event.data.text() : 'Time for a focus check!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png',
    image: './icons/icon-512.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'focus-reminder',
    requireInteraction: true,
    renotify: true,
    sticky: false,
    silent: false,
    data: {
      url: './?action=focus',
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'focus-now',
        title: '🎯 Focus Now',
        icon: './icons/icon-96.png'
      },
      {
        action: 'snooze-5',
        title: '⏰ Snooze 5min',
        icon: './icons/icon-96.png'
      },
      {
        action: 'snooze-15',
        title: '⏰ Snooze 15min',
        icon: './icons/icon-96.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('🎯 Focus Intervention', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();

  const clickAction = event.action;
  const notificationData = event.notification.data;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });

      // Check if app is already open
      const existingClient = clients.find(client => 
        client.url.includes(self.location.origin)
      );

      if (clickAction === 'focus-now') {
        const targetUrl = './?action=focus&notification=true';
        
        if (existingClient) {
          existingClient.navigate(targetUrl);
          existingClient.focus();
        } else {
          await self.clients.openWindow(targetUrl);
        }
        
      } else if (clickAction === 'snooze-5') {
        console.log('[SW] Snoozed for 5 minutes');
        setTimeout(() => {
          self.registration.showNotification('🔔 Snooze Over!', {
            body: 'Time to focus again!',
            icon: './icons/icon-192.png',
            tag: 'snooze-reminder',
            requireInteraction: true
          });
        }, 5 * 60 * 1000); // 5 minutes
        
      } else if (clickAction === 'snooze-15') {
        console.log('[SW] Snoozed for 15 minutes');
        setTimeout(() => {
          self.registration.showNotification('🔔 Focus Time!', {
            body: '15 minute snooze is over. Ready to focus?',
            icon: './icons/icon-192.png',
            tag: 'snooze-reminder',
            requireInteraction: true
          });
        }, 15 * 60 * 1000); // 15 minutes
        
      } else {
        // Default action - open app
        const targetUrl = './';
        
        if (existingClient) {
          existingClient.focus();
        } else {
          await self.clients.openWindow(targetUrl);
        }
      }
    })()
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
  
  if (event.data && event.data.type === 'SCHEDULE_NOTIFICATION') {
    const { title, body, delay } = event.data;
    setTimeout(() => {
      self.registration.showNotification(title, {
        body: body,
        icon: './icons/icon-192.png',
        tag: 'scheduled-reminder'
      });
    }, delay);
  }
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event.notification.tag);
  
  // Track notification dismissals
  // Could send analytics data here
});

// Error handling
self.addEventListener('error', (event) => {
  console.error('[SW] Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'focus-reminder') {
    event.waitUntil(
      self.registration.showNotification('🎯 Periodic Focus Check', {
        body: 'How\'s your focus going?',
        icon: './icons/icon-192.png',
        tag: 'periodic-focus'
      })
    );
  }
});

console.log('[SW] Service Worker loaded successfully');
