/* SnipRing offline support.
   Pages: network first (so updates show up right away), cached copy when offline.
   Static files: served from cache, refreshed in the background.
   Nothing the user creates passes through here; analytics and other sites are never touched. */
const CACHE = 'snipring-v6';
const CORE = [
  './', 'index.html', 'app.css', 'icons.svg', 'discover.html', 'discover.js', 'studio.html', 'studio.js', 'sounds/catalog.json', 'manifest.webmanifest', 'fonts/fonts.css',
  'fonts/karantina-400.woff', 'fonts/karantina-700.woff', 'fonts/plexhe-400.woff', 'fonts/plexhe-500.woff',
  'fonts/plexhe-600.woff', 'fonts/plexmono-500.woff', 'vendor/lame.min.js',
  'icon-192.png', 'apple-touch-icon.png', 'legal.css', 'legal.js',
  'privacy.html', 'terms.html', 'accessibility.html'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // analytics etc. go straight to the network
  if (url.pathname.startsWith('/media/') || req.headers.has('range')) return; // demo video streams normally
  if (url.pathname.endsWith('/config.js')) return;                       // marketing config: always fresh
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copy)); }
      return res;
    }).catch(() => caches.match(url.pathname, { ignoreSearch: true })
      .then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
