const CACHE_NAME = 'ca-timesheet-v5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/module-select.html',
  '/udin-coming-soon.html',
  '/dashboard.html',
  '/timesheet.html',
  '/my-timesheets.html',
  '/approvals.html',
  '/clients.html',
  '/staff.html',
  '/reports.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json'
];

// Install: cache static shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function networkFirst(request, fallbackPath = '/index.html') {
  return fetch(request).then(response => {
    if (response && response.status === 200) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(c => c.put(request, clone));
    }
    return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match(fallbackPath)));
}

// Fetch: network-first for API, HTML, CSS, and JS so deployments stay visually consistent.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network-first for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — no network.' }), {
          headers: { 'Content-Type': 'application/json' }, status: 503
        })
      )
    );
    return;
  }

  // Use network-first for document navigations so deployed HTML updates are picked up.
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Keep CSS and JS fresh too, otherwise newly deployed pages can render against old assets
  // until the user manually refreshes.
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/') || url.pathname.endsWith('.html'))
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
